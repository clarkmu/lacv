from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import (
    Assay, AssayDefinition, AssayOutput, AssayResult, Batch, DataFile, LegacyMaterialRecord, ProcessEvent,
    ProcessEventInput, ProcessEventOutput, Sample, SampleQuantityEvent, StorageEvent, StorageLocation,
)
from ..sample_rules import (
    consume, create_derived_sample, get_or_create_process_type, get_sample_or_404, record_initial_storage,
    record_quantity_change, record_storage_move, require_unique_sample_code, validate_parent, validate_references,
)
from ..schemas import (
    AliquotCreate, AssayCreate, AssayDetail, DataFileCreate, DerivedSampleCreate, SampleCreate, SampleDetail,
    SampleLineage, SampleListItem, SampleRef, SampleUpdate,
)
from .assays import assay_definition_for, get_assay

router = APIRouter(prefix="/samples", tags=["samples"])

SAMPLE_LOAD_OPTIONS = (selectinload(Sample.sample_type_ref), selectinload(Sample.legacy_material_records))


@router.get("", response_model=list[SampleListItem])
def list_samples(root_only: bool = False, db: Session = Depends(get_db)):
    """List Samples, newest first. root_only=true keeps only base Samples (no parent Sample)."""
    query = select(Sample).options(*SAMPLE_LOAD_OPTIONS).order_by(Sample.sample_id.desc())
    if root_only:
        query = query.where(Sample.parent_sample_id.is_(None))
    return db.scalars(query).all()


@router.get("/lookup", response_model=SampleRef)
def lookup_sample(code: str, db: Session = Depends(get_db)):
    """Find a Sample by its code or by a legacy Material code printed on an older label."""
    sample = db.scalar(
        select(Sample)
        .outerjoin(LegacyMaterialRecord, LegacyMaterialRecord.sample_id == Sample.sample_id)
        .where(or_(Sample.sample_code == code, LegacyMaterialRecord.material_code == code))
        .options(selectinload(Sample.sample_type_ref))
    )
    if not sample:
        raise HTTPException(404, f"No sample or legacy material code matches {code}")
    return sample


@router.get("/{sample_id}", response_model=SampleDetail)
def get_sample(sample_id: int, db: Session = Depends(get_db)):
    sample = db.scalar(
        select(Sample)
        .where(Sample.sample_id == sample_id)
        .options(
            *SAMPLE_LOAD_OPTIONS,
            selectinload(Sample.batch),
            selectinload(Sample.parent).selectinload(Sample.sample_type_ref),
            selectinload(Sample.children).selectinload(Sample.sample_type_ref),
            selectinload(Sample.storage_location),
        )
    )
    if not sample:
        raise HTTPException(404, "Sample not found")
    own_assays = _assays_where(Assay.sample_id == sample_id, db)
    return {
        **{column.key: getattr(sample, column.key) for column in Sample.__table__.columns},
        "sample_type": sample.sample_type,
        "legacy_codes": sample.legacy_codes,
        "batch": sample.batch,
        "parent": sample.parent,
        "children": sample.children,
        "storage_location": sample.storage_location,
        "legacy_identifiers": sample.legacy_material_records,
        "generated_by_assays": _assay_summaries(
            _assays_where(Assay.assay_id.in_(select(AssayOutput.assay_id).where(AssayOutput.sample_id == sample_id)), db), db
        ),
        "process_events": _process_events_for(sample_id, db),
        "assays": _assay_summaries(own_assays, db),
        "storage_events": _storage_events_for(sample_id, db),
        "quantity_events": db.scalars(
            select(SampleQuantityEvent).where(SampleQuantityEvent.sample_id == sample_id).order_by(SampleQuantityEvent.event_date.desc())
        ).all(),
        "data_files": db.scalars(
            select(DataFile)
            .where(or_(DataFile.sample_id == sample_id, DataFile.assay_id.in_([assay.assay_id for assay in own_assays])))
            .order_by(DataFile.data_file_id)
        ).all(),
    }


@router.get("/{sample_id}/children", response_model=list[SampleRef])
def list_children(sample_id: int, db: Session = Depends(get_db)):
    get_sample_or_404(sample_id, db)
    return db.scalars(
        select(Sample).where(Sample.parent_sample_id == sample_id).options(selectinload(Sample.sample_type_ref)).order_by(Sample.sample_id)
    ).all()


@router.get("/{sample_id}/lineage", response_model=SampleLineage)
def get_sample_lineage(sample_id: int, db: Session = Depends(get_db)):
    """Ancestors from the root down, and the full descendant tree with what produced each node."""
    sample = get_sample_or_404(sample_id, db)
    ancestors = []
    ancestor = sample.parent
    while ancestor is not None:
        ancestors.append(ancestor)
        ancestor = ancestor.parent
    ancestors.reverse()

    descendants: list[Sample] = []
    frontier = [sample_id]
    while frontier:
        level = db.scalars(
            select(Sample).where(Sample.parent_sample_id.in_(frontier)).options(selectinload(Sample.sample_type_ref)).order_by(Sample.sample_id)
        ).all()
        descendants.extend(level)
        frontier = [child.sample_id for child in level]

    generated_by = _generated_by([child.sample_id for child in descendants], db)
    children_by_parent: dict[int, list[Sample]] = {}
    for child in descendants:
        children_by_parent.setdefault(child.parent_sample_id, []).append(child)

    def node(child: Sample) -> dict:
        return {
            **SampleRef.model_validate(child).model_dump(),
            "generated_by": generated_by.get(child.sample_id),
            "children": [node(grandchild) for grandchild in children_by_parent.get(child.sample_id, [])],
        }

    return {
        "sample": sample,
        "ancestors": ancestors,
        "descendants": [node(child) for child in children_by_parent.get(sample_id, [])],
    }


@router.post("", response_model=SampleDetail, status_code=status.HTTP_201_CREATED)
def create_sample(payload: SampleCreate, db: Session = Depends(get_db)):
    data = payload.model_dump()
    require_unique_sample_code(data["sample_code"], db)
    validate_references(data, db)
    validate_parent(None, data["parent_sample_id"], data["batch_id"], db)
    if data["batch_id"] is not None and not db.get(Batch, data["batch_id"]):
        raise HTTPException(404, f"Batch not found: {data['batch_id']}")
    # Lineage only: no values are copied from the parent.
    sample = Sample(**data)
    db.add(sample)
    db.flush()
    record_initial_storage(sample, db)
    db.commit()
    return get_sample(sample.sample_id, db)


@router.post("/{parent_id}/children", response_model=SampleDetail, status_code=status.HTTP_201_CREATED)
def create_child(parent_id: int, payload: DerivedSampleCreate, db: Session = Depends(get_db)):
    get_sample_or_404(parent_id, db, "Parent sample")
    # Intentionally do not inherit any parent properties.
    child = create_derived_sample(parent_id, payload, db)
    db.commit()
    return get_sample(child.sample_id, db)


@router.patch("/{sample_id}", response_model=SampleDetail)
def update_sample(sample_id: int, payload: SampleUpdate, db: Session = Depends(get_db)):
    sample = get_sample_or_404(sample_id, db)
    data = payload.model_dump(exclude_unset=True)
    operator_name = data.pop("operator_name", None)
    change_notes = data.pop("change_notes", None)
    if "sample_code" in data:
        require_unique_sample_code(data["sample_code"], db, sample_id)
    validate_references(data, db)
    next_parent = data.get("parent_sample_id", sample.parent_sample_id)
    next_batch = data.get("batch_id", sample.batch_id)
    if "parent_sample_id" in data or "batch_id" in data:
        validate_parent(sample, next_parent, next_batch, db)
        if next_batch is not None and not db.get(Batch, next_batch):
            raise HTTPException(404, f"Batch not found: {next_batch}")

    if "storage_location_id" in data and data["storage_location_id"] != sample.storage_location_id:
        record_storage_move(sample, sample.storage_location_id, data["storage_location_id"], db, operator_name, change_notes)
    if "current_quantity" in data and data["current_quantity"] != sample.current_quantity:
        record_quantity_change(sample, data["current_quantity"], "adjusted", db, data.get("quantity_unit"), None, operator_name, change_notes)
    for key, value in data.items():
        setattr(sample, key, value)
    db.commit()
    return get_sample(sample_id, db)


@router.delete("/{sample_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sample(sample_id: int, db: Session = Depends(get_db)):
    sample = get_sample_or_404(sample_id, db)
    dependents = {
        "child samples": select(func.count()).where(Sample.parent_sample_id == sample_id),
        "process events": select(func.count()).select_from(ProcessEventInput).where(ProcessEventInput.sample_id == sample_id),
        "process outputs": select(func.count()).select_from(ProcessEventOutput).where(ProcessEventOutput.sample_id == sample_id),
        "assays": select(func.count()).select_from(Assay).where(Assay.sample_id == sample_id),
        "assay outputs": select(func.count()).select_from(AssayOutput).where(AssayOutput.sample_id == sample_id),
        "data files": select(func.count()).select_from(DataFile).where(DataFile.sample_id == sample_id),
        "legacy material records": select(func.count()).select_from(LegacyMaterialRecord).where(LegacyMaterialRecord.sample_id == sample_id),
    }
    blocking = [f"{db.scalar(query)} {label}" for label, query in dependents.items() if db.scalar(query)]
    if blocking:
        raise HTTPException(409, f"Cannot delete {sample.sample_code}: it has " + ", ".join(blocking))
    for event_model in (StorageEvent, SampleQuantityEvent):
        for event in db.scalars(select(event_model).where(event_model.sample_id == sample_id)).all():
            db.delete(event)
    db.flush()
    db.delete(sample)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{sample_id}/aliquots", response_model=SampleDetail, status_code=status.HTTP_201_CREATED)
def create_aliquots(sample_id: int, payload: AliquotCreate, db: Session = Depends(get_db)):
    """Aliquoting is a process: it consumes from the parent and creates derived Samples."""
    parent = get_sample_or_404(sample_id, db, "Parent sample")
    _require_unique_process_code(payload.process_code, db)
    process = ProcessEvent(
        process_code=payload.process_code,
        process_type_id=get_or_create_process_type("Aliquoting", db).process_type_id,
        operator_name=payload.operator_name,
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
        status="completed",
        notes=payload.notes,
    )
    db.add(process)
    db.flush()
    total_used = payload.quantity_per_aliquot * payload.aliquot_count if payload.quantity_per_aliquot is not None else None
    db.add(ProcessEventInput(
        process_event_id=process.process_event_id,
        sample_id=parent.sample_id,
        quantity_used=total_used,
        quantity_unit=payload.quantity_unit,
        notes=payload.notes,
    ))
    for index in range(1, payload.aliquot_count + 1):
        aliquot = create_derived_sample(parent.sample_id, DerivedSampleCreate(
            sample_code=f"{payload.sample_code_prefix}-{index:02d}",
            sample_type_id=payload.sample_type_id,
            current_quantity=payload.quantity_per_aliquot,
            quantity_unit=payload.quantity_unit,
            storage_location_id=payload.storage_location_id,
            notes=payload.notes,
        ), db, payload.operator_name)
        db.add(ProcessEventOutput(
            process_event_id=process.process_event_id,
            sample_id=aliquot.sample_id,
            quantity_generated=payload.quantity_per_aliquot,
            quantity_unit=payload.quantity_unit,
            notes=payload.notes,
        ))
    consume(parent, total_used, db, payload.quantity_unit, process.process_event_id, payload.operator_name, payload.notes)
    db.commit()
    return get_sample(sample_id, db)


@router.post("/{sample_id}/assays", response_model=AssayDetail, status_code=status.HTTP_201_CREATED)
def create_sample_assay(sample_id: int, payload: AssayCreate, db: Session = Depends(get_db)):
    get_sample_or_404(sample_id, db)
    if db.scalar(select(Assay.assay_id).where(Assay.assay_instance_code == payload.assay_instance_code)):
        raise HTTPException(400, f"Assay code already exists: {payload.assay_instance_code}")
    assay = Assay(
        assay_instance_code=payload.assay_instance_code,
        sample_id=sample_id,
        assay_definition_id=assay_definition_for(payload.assay_type, payload.target, payload.assay_name, db).assay_definition_id,
        operator_name=payload.operator_name,
        assay_date=payload.assay_date,
        status=payload.status,
        qc_status=payload.qc_status,
        notes=payload.notes,
    )
    db.add(assay)
    db.commit()
    return get_assay(assay.assay_id, db)


@router.post("/{sample_id}/data-files", response_model=SampleDetail, status_code=status.HTTP_201_CREATED)
def attach_data_file(sample_id: int, payload: DataFileCreate, db: Session = Depends(get_db)):
    get_sample_or_404(sample_id, db)
    if payload.assay_id is not None:
        assay = db.get(Assay, payload.assay_id)
        if not assay or assay.sample_id != sample_id:
            raise HTTPException(400, "The assay must belong to this sample")
    db.add(DataFile(sample_id=sample_id, **payload.model_dump()))
    db.commit()
    return get_sample(sample_id, db)


def _require_unique_process_code(process_code: str, db: Session) -> None:
    if db.scalar(select(ProcessEvent.process_event_id).where(ProcessEvent.process_code == process_code)):
        raise HTTPException(400, f"Process code already exists: {process_code}")


def _assays_where(condition, db: Session) -> list[Assay]:
    return db.scalars(select(Assay).where(condition).options(selectinload(Assay.definition)).order_by(Assay.assay_id.desc())).all()


def _assay_summaries(assays: list[Assay], db: Session) -> list[dict]:
    if not assays:
        return []
    result_counts = dict(db.execute(
        select(AssayResult.assay_id, func.count()).where(AssayResult.assay_id.in_([a.assay_id for a in assays])).group_by(AssayResult.assay_id)
    ).all())
    return [
        {
            "assay_id": assay.assay_id,
            "assay_code": assay.assay_instance_code,
            "assay_name": assay.definition.assay_name,
            "assay_type": assay.definition.assay_type,
            "target": assay.definition.target,
            "status": assay.status,
            "qc_status": assay.qc_status,
            "assay_date": assay.assay_date,
            "result_count": result_counts.get(assay.assay_id, 0),
        }
        for assay in assays
    ]


def _process_events_for(sample_id: int, db: Session) -> list[dict]:
    """Processes this Sample took part in, as an input, an output or both. Descendants' processes are not included."""
    input_ids = set(db.scalars(select(ProcessEventInput.process_event_id).where(ProcessEventInput.sample_id == sample_id)).all())
    output_ids = set(db.scalars(select(ProcessEventOutput.process_event_id).where(ProcessEventOutput.sample_id == sample_id)).all())
    process_ids = input_ids | output_ids
    if not process_ids:
        return []
    processes = db.scalars(
        select(ProcessEvent).where(ProcessEvent.process_event_id.in_(process_ids)).options(selectinload(ProcessEvent.process_type_ref))
        .order_by(ProcessEvent.started_at.desc().nulls_last(), ProcessEvent.process_event_id.desc())
    ).all()
    inputs = _samples_by_process(ProcessEventInput, process_ids, db)
    outputs = _samples_by_process(ProcessEventOutput, process_ids, db)
    return [
        {
            "process_event_id": process.process_event_id,
            "process_code": process.process_code,
            "process_type": process.process_type,
            "status": process.status,
            "operator_name": process.operator_name,
            "started_at": process.started_at,
            "completed_at": process.completed_at,
            "role": ", ".join(role for role, ids in (("input", input_ids), ("output", output_ids)) if process.process_event_id in ids),
            "inputs": inputs.get(process.process_event_id, []),
            "outputs": outputs.get(process.process_event_id, []),
        }
        for process in processes
    ]


def _samples_by_process(link_model, process_ids: set[int], db: Session) -> dict[int, list[Sample]]:
    rows = db.execute(
        select(link_model.process_event_id, Sample)
        .join(Sample, Sample.sample_id == link_model.sample_id)
        .where(link_model.process_event_id.in_(process_ids))
        .options(selectinload(Sample.sample_type_ref))
        .order_by(Sample.sample_id)
    ).all()
    grouped: dict[int, list[Sample]] = {}
    for process_event_id, sample in rows:
        grouped.setdefault(process_event_id, []).append(sample)
    return grouped


def _storage_events_for(sample_id: int, db: Session) -> list[dict]:
    events = db.scalars(select(StorageEvent).where(StorageEvent.sample_id == sample_id).order_by(StorageEvent.event_date.desc(), StorageEvent.storage_event_id.desc())).all()
    location_ids = {lid for event in events for lid in (event.from_location_id, event.to_location_id) if lid is not None}
    codes = dict(db.execute(
        select(StorageLocation.storage_location_id, StorageLocation.location_code).where(StorageLocation.storage_location_id.in_(location_ids))
    ).all()) if location_ids else {}
    return [
        {
            "storage_event_id": event.storage_event_id,
            "event_type": event.event_type,
            "event_date": event.event_date,
            "from_location_id": event.from_location_id,
            "to_location_id": event.to_location_id,
            "from_location_code": codes.get(event.from_location_id),
            "to_location_code": codes.get(event.to_location_id),
            "operator_name": event.operator_name,
            "notes": event.notes,
        }
        for event in events
    ]


def _generated_by(sample_ids: list[int], db: Session) -> dict[int, dict]:
    if not sample_ids:
        return {}
    generated = {}
    for sample_id, assay_code, assay_type in db.execute(
        select(AssayOutput.sample_id, Assay.assay_instance_code, AssayDefinition.assay_type)
        .join(Assay, Assay.assay_id == AssayOutput.assay_id)
        .join(AssayDefinition, AssayDefinition.assay_definition_id == Assay.assay_definition_id)
        .where(AssayOutput.sample_id.in_(sample_ids))
    ).all():
        generated[sample_id] = {"kind": "assay", "code": assay_code, "type": assay_type}
    for link, process in db.execute(
        select(ProcessEventOutput, ProcessEvent)
        .join(ProcessEvent, ProcessEvent.process_event_id == ProcessEventOutput.process_event_id)
        .where(ProcessEventOutput.sample_id.in_(sample_ids))
        .options(selectinload(ProcessEvent.process_type_ref))
    ).all():
        generated[link.sample_id] = {"kind": "process", "code": process.process_code, "type": process.process_type}
    return generated
