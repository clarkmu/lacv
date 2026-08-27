from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload
from ..database import get_db
from ..models import Assay, AssayDefinition, Material, MaterialQuantityEvent, MaterialType, ProcessEvent, ProcessEventInput, ProcessEventOutput, ProcessType, Sample, StorageEvent, StorageLocation
from ..schemas import AliquotCreate, AssayCreate, MaterialBrief, MaterialCreate, MaterialDetail, MaterialTypeBrief, MaterialUpdate

router = APIRouter(prefix="/materials", tags=["materials"])

@router.get("", response_model=list[MaterialBrief])
def list_materials(db: Session = Depends(get_db)):
    return db.scalars(select(Material).order_by(Material.material_id.desc())).all()

@router.get("/types", response_model=list[MaterialTypeBrief])
def list_material_types(db: Session = Depends(get_db)):
    return db.scalars(select(MaterialType).where(MaterialType.is_active == True).order_by(MaterialType.sort_order, MaterialType.type_name)).all()

@router.get("/{material_id}", response_model=MaterialDetail)
def get_material(material_id: int, db: Session = Depends(get_db)):
    stmt = select(Material).where(Material.material_id == material_id).options(
        selectinload(Material.parent),
        selectinload(Material.offspring),
        selectinload(Material.sample),
        selectinload(Material.storage_location),
    )
    material = db.scalar(stmt)
    if not material:
        raise HTTPException(404, "Material not found")
    input_events = db.scalars(
        select(ProcessEvent)
        .join(ProcessEventInput, ProcessEvent.process_event_id == ProcessEventInput.process_event_id)
        .where(ProcessEventInput.material_id == material_id)
        .options(selectinload(ProcessEvent.process_type_ref))
    ).all()
    output_events = db.scalars(
        select(ProcessEvent)
        .join(ProcessEventOutput, ProcessEvent.process_event_id == ProcessEventOutput.process_event_id)
        .where(ProcessEventOutput.material_id == material_id)
        .options(selectinload(ProcessEvent.process_type_ref))
    ).all()
    assays = db.scalars(
        select(Assay)
        .where(Assay.material_id == material_id)
        .options(selectinload(Assay.definition))
        .order_by(Assay.assay_id.desc())
    ).all()
    storage_events = db.scalars(select(StorageEvent).where(StorageEvent.material_id == material_id).order_by(StorageEvent.event_date.desc())).all()
    quantity_events = db.scalars(select(MaterialQuantityEvent).where(MaterialQuantityEvent.material_id == material_id).order_by(MaterialQuantityEvent.event_date.desc())).all()
    storage_location_ids = {
        location_id
        for event in storage_events
        for location_id in (event.from_location_id, event.to_location_id)
        if location_id is not None
    }
    storage_locations = {
        location.storage_location_id: location
        for location in db.scalars(select(StorageLocation).where(StorageLocation.storage_location_id.in_(storage_location_ids))).all()
    } if storage_location_ids else {}
    return {
        **{field: getattr(material, field) for field in ("material_id", "material_code", "material_type", "status", "sample_id", "sample", "storage_location_id", "storage_location", "material_subtype", "material_label", "current_quantity", "quantity_unit", "concentration", "concentration_unit", "is_consumed", "is_disposed", "expiration_date", "notes")},
        "parent": material.parent,
        "offspring": material.offspring,
        "process_events": [{"process_event_id": event.process_event_id, "process_code": event.process_code, "process_type": event.process_type, "status": event.status, "operator_name": event.operator_name} for event in {event.process_event_id: event for event in [*input_events, *output_events]}.values()],
        "assays": [{"assay_id": assay.assay_id, "assay_code": assay.assay_instance_code, "assay_type": assay.definition.assay_type, "target": assay.definition.target, "status": assay.status, "qc_status": assay.qc_status} for assay in assays],
        "storage_events": [
            {
                "storage_event_id": event.storage_event_id,
                "event_type": event.event_type,
                "event_date": event.event_date,
                "from_location_id": event.from_location_id,
                "to_location_id": event.to_location_id,
                "from_location_code": storage_locations[event.from_location_id].location_code if event.from_location_id in storage_locations else None,
                "from_location_name": storage_locations[event.from_location_id].location_name if event.from_location_id in storage_locations else None,
                "to_location_code": storage_locations[event.to_location_id].location_code if event.to_location_id in storage_locations else None,
                "to_location_name": storage_locations[event.to_location_id].location_name if event.to_location_id in storage_locations else None,
                "operator_name": event.operator_name,
            }
            for event in storage_events
        ],
        "quantity_events": [
            {
                "quantity_event_id": event.quantity_event_id,
                "event_type": event.event_type,
                "quantity_change": event.quantity_change,
                "quantity_unit": event.quantity_unit,
                "quantity_before": event.quantity_before,
                "quantity_after": event.quantity_after,
                "event_date": event.event_date,
                "operator_name": event.operator_name,
                "notes": event.notes,
            }
            for event in quantity_events
        ],
    }

@router.post("", response_model=MaterialDetail, status_code=status.HTTP_201_CREATED)
def create_material(payload: MaterialCreate, db: Session = Depends(get_db)):
    _validate_material_payload(payload, db)
    material = Material(**payload.model_dump())
    db.add(material)
    db.flush()
    _record_initial_storage_event(material, db)
    db.commit()
    db.refresh(material)
    return get_material(material.material_id, db)

@router.patch("/{material_id}", response_model=MaterialDetail)
def update_material(material_id: int, payload: MaterialUpdate, db: Session = Depends(get_db)):
    material = db.get(Material, material_id)
    if not material:
        raise HTTPException(404, "Material not found")
    data = payload.model_dump(exclude_unset=True)
    if "sample_id" in data:
        next_sample_id = data["sample_id"]
        if next_sample_id is None:
            raise HTTPException(400, "Material must be linked to a sample")
        if not db.get(Sample, next_sample_id):
            raise HTTPException(404, "Sample not found")
        material.sample_id = next_sample_id
    if "storage_location_id" in data:
        next_location_id = data["storage_location_id"]
        if next_location_id is not None and not db.get(StorageLocation, next_location_id):
            raise HTTPException(404, "Storage location not found")
        if material.storage_location_id != next_location_id:
            event_type = "stored" if material.storage_location_id is None else "moved"
            db.add(StorageEvent(
                material_id=material.material_id,
                from_location_id=material.storage_location_id,
                to_location_id=next_location_id,
                event_type=event_type,
                event_date=datetime.utcnow(),
            ))
            material.storage_location_id = next_location_id
    if "current_quantity" in data and material.current_quantity != data["current_quantity"]:
        quantity_unit = data.get("quantity_unit") or material.quantity_unit or ""
        if quantity_unit:
            before = material.current_quantity
            after = data["current_quantity"]
            db.add(MaterialQuantityEvent(
                material_id=material.material_id,
                event_type="adjusted",
                quantity_change=(after or 0) - (before or 0),
                quantity_unit=quantity_unit,
                quantity_before=before,
                quantity_after=after,
                event_date=datetime.utcnow(),
            ))
        material.current_quantity = data["current_quantity"]
    for key in ("quantity_unit", "concentration", "concentration_unit", "status", "is_consumed", "is_disposed", "expiration_date", "notes"):
        if key in data:
            setattr(material, key, data[key])
    db.commit()
    return get_material(material_id, db)

@router.post("/{material_id}/aliquots", response_model=MaterialDetail, status_code=status.HTTP_201_CREATED)
def create_aliquots(material_id: int, payload: AliquotCreate, db: Session = Depends(get_db)):
    parent = db.get(Material, material_id)
    if not parent:
        raise HTTPException(404, "Parent material not found")
    if payload.aliquot_count < 1:
        raise HTTPException(400, "Aliquot count must be at least 1")
    if not db.get(MaterialType, payload.material_type_id):
        raise HTTPException(404, "Material type not found")
    if payload.storage_location_id is not None and not db.get(StorageLocation, payload.storage_location_id):
        raise HTTPException(404, "Storage location not found")

    process_type = _get_or_create_process_type("aliquoting", "Aliquoting", db)
    process = ProcessEvent(
        process_code=payload.process_code,
        process_type_id=process_type.process_type_id,
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
        material_id=parent.material_id,
        quantity_used=total_used,
        quantity_unit=payload.quantity_unit,
        notes=payload.notes,
    ))
    for index in range(1, payload.aliquot_count + 1):
        material = Material(
            sample_id=parent.sample_id,
            parent_material_id=parent.material_id,
            material_code=f"{payload.material_code_prefix}-{index:02d}",
            material_type_id=payload.material_type_id,
            current_quantity=payload.quantity_per_aliquot,
            quantity_unit=payload.quantity_unit,
            storage_location_id=payload.storage_location_id,
            status="available",
            notes=payload.notes,
        )
        db.add(material)
        db.flush()
        db.add(ProcessEventOutput(
            process_event_id=process.process_event_id,
            material_id=material.material_id,
            quantity_generated=payload.quantity_per_aliquot,
            quantity_unit=payload.quantity_unit,
            notes=payload.notes,
        ))
        _record_initial_storage_event(material, db)
    if total_used is not None and parent.current_quantity is not None:
        before = parent.current_quantity
        parent.current_quantity = before - total_used
        db.add(MaterialQuantityEvent(
            material_id=parent.material_id,
            event_type="consumed",
            quantity_change=-total_used,
            quantity_unit=payload.quantity_unit or parent.quantity_unit or "",
            quantity_before=before,
            quantity_after=parent.current_quantity,
            related_process_event_id=process.process_event_id,
            event_date=datetime.utcnow(),
            operator_name=payload.operator_name,
            notes=payload.notes,
        ))
    db.commit()
    return get_material(material_id, db)

@router.post("/{material_id}/assays", response_model=MaterialDetail, status_code=status.HTTP_201_CREATED)
def create_material_assay(material_id: int, payload: AssayCreate, db: Session = Depends(get_db)):
    if not db.get(Material, material_id):
        raise HTTPException(404, "Material not found")

    definition_code = _assay_definition_code(payload.assay_type, payload.target)
    definition = db.scalar(select(AssayDefinition).where(AssayDefinition.assay_code == definition_code))
    if definition is None:
        definition = AssayDefinition(
            assay_code=definition_code,
            assay_name=payload.assay_name or payload.assay_type,
            assay_type=payload.assay_type,
            target=payload.target,
        )
        db.add(definition)
        db.flush()

    assay = Assay(
        assay_instance_code=payload.assay_instance_code,
        material_id=material_id,
        assay_definition_id=definition.assay_definition_id,
        operator_name=payload.operator_name,
        assay_date=payload.assay_date,
        status=payload.status,
        qc_status=payload.qc_status,
        notes=payload.notes,
    )
    db.add(assay)
    db.commit()
    return get_material(material_id, db)

@router.post("/{parent_id}/offspring", response_model=MaterialDetail, status_code=status.HTTP_201_CREATED)
def create_offspring(parent_id: int, payload: MaterialCreate, db: Session = Depends(get_db)):
    if not db.get(Material, parent_id):
        raise HTTPException(404, "Parent material not found")
    _validate_material_payload(payload, db)
    data = payload.model_dump()
    data["parent_material_id"] = parent_id
    # Lineage only; other fields use request/default values.
    material = Material(**data)
    db.add(material)
    db.flush()
    _record_initial_storage_event(material, db)
    db.commit()
    db.refresh(material)
    return get_material(material.material_id, db)

def _validate_material_payload(payload: MaterialCreate, db: Session):
    if not db.get(Sample, payload.sample_id):
        raise HTTPException(404, "Sample not found")
    if payload.storage_location_id is not None and not db.get(StorageLocation, payload.storage_location_id):
        raise HTTPException(404, "Storage location not found")

def _record_initial_storage_event(material: Material, db: Session):
    if material.storage_location_id is None:
        return
    db.add(StorageEvent(
        material_id=material.material_id,
        from_location_id=None,
        to_location_id=material.storage_location_id,
        event_type="stored",
        event_date=datetime.utcnow(),
    ))

def _get_or_create_process_type(type_code: str, type_name: str, db: Session):
    process_type = db.scalar(select(ProcessType).where(ProcessType.type_code == type_code))
    if process_type:
        return process_type
    process_type = ProcessType(type_code=type_code, type_name=type_name, sort_order=0)
    db.add(process_type)
    db.flush()
    return process_type

def _assay_definition_code(assay_type: str, target: str | None) -> str:
    type_code = "_".join(assay_type.lower().split())
    target_code = "_".join(target.lower().split()) if target else "any"
    return f"{type_code}_{target_code}"[:100]
