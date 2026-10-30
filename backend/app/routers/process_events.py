from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import ProcessEvent, ProcessEventInput, ProcessEventOutput, ProcessType, Protocol, Sample
from ..sample_rules import consume, create_derived_sample, get_or_create_process_type, get_sample_or_404
from ..schemas import ProcessEventCreate, ProcessEventDetail, ProcessTypeBrief

router = APIRouter(prefix="/process-events", tags=["process-events"])


@router.post("", response_model=ProcessEventDetail, status_code=status.HTTP_201_CREATED)
def create_process_event(payload: ProcessEventCreate, db: Session = Depends(get_db)):
    """A transformation consumes input Samples and creates derived output Samples."""
    if not payload.input_sample_ids:
        raise HTTPException(400, "At least one input sample is required")
    if len(set(payload.input_sample_ids)) != len(payload.input_sample_ids):
        raise HTTPException(400, "Each input sample may be listed only once")
    if not payload.output_samples:
        raise HTTPException(400, "At least one output sample is required")
    if db.scalar(select(ProcessEvent.process_event_id).where(ProcessEvent.process_code == payload.process_code)):
        raise HTTPException(400, f"Process code already exists: {payload.process_code}")
    if payload.protocol_id is not None and not db.get(Protocol, payload.protocol_id):
        raise HTTPException(404, f"Protocol not found: {payload.protocol_id}")
    inputs = [get_sample_or_404(sample_id, db, "Input sample") for sample_id in payload.input_sample_ids]
    parent_ids = [_output_parent_id(output.parent_sample_id, payload.input_sample_ids) for output in payload.output_samples]

    process = ProcessEvent(
        process_code=payload.process_code,
        process_type_id=get_or_create_process_type(payload.process_type, db).process_type_id,
        protocol_id=payload.protocol_id,
        operator_name=payload.operator_name,
        started_at=payload.started_at or datetime.utcnow(),
        completed_at=payload.completed_at,
        status=payload.status,
        notes=payload.notes,
    )
    db.add(process)
    db.flush()

    for sample in inputs:
        db.add(ProcessEventInput(
            process_event_id=process.process_event_id,
            sample_id=sample.sample_id,
            quantity_used=payload.quantity_used,
            quantity_unit=payload.quantity_unit,
            notes=payload.notes,
        ))
        consume(sample, payload.quantity_used, db, payload.quantity_unit, process.process_event_id, payload.operator_name, payload.notes)

    for output, parent_id in zip(payload.output_samples, parent_ids):
        sample = create_derived_sample(parent_id, output, db, payload.operator_name)
        db.add(ProcessEventOutput(
            process_event_id=process.process_event_id,
            sample_id=sample.sample_id,
            quantity_generated=output.quantity_generated,
            quantity_unit=output.quantity_unit,
            notes=payload.notes,
        ))

    db.commit()
    return get_process_event(process.process_event_id, db)


@router.get("/types", response_model=list[ProcessTypeBrief])
def list_process_types(db: Session = Depends(get_db)):
    return db.scalars(select(ProcessType).order_by(ProcessType.sort_order, ProcessType.type_name)).all()


@router.get("/{process_event_id}", response_model=ProcessEventDetail)
def get_process_event(process_event_id: int, db: Session = Depends(get_db)):
    process = db.scalar(
        select(ProcessEvent).where(ProcessEvent.process_event_id == process_event_id).options(selectinload(ProcessEvent.process_type_ref))
    )
    if not process:
        raise HTTPException(404, "Process event not found")
    return {
        "process_event_id": process.process_event_id,
        "process_code": process.process_code,
        "process_type": process.process_type,
        "status": process.status,
        "operator_name": process.operator_name,
        "started_at": process.started_at,
        "completed_at": process.completed_at,
        "notes": process.notes,
        "inputs": _linked_samples(ProcessEventInput, process_event_id, db),
        "outputs": _linked_samples(ProcessEventOutput, process_event_id, db),
    }


def _output_parent_id(requested_parent_id: int | None, input_ids: list[int]) -> int:
    """Each output gets exactly one parent from the inputs; pooled processes must say which."""
    if requested_parent_id is None:
        if len(input_ids) == 1:
            return input_ids[0]
        raise HTTPException(400, "Processes with several inputs must name each output's parent_sample_id")
    if requested_parent_id not in input_ids:
        raise HTTPException(400, "An output's parent_sample_id must be one of the process inputs")
    return requested_parent_id


def _linked_samples(link_model, process_event_id: int, db: Session) -> list[Sample]:
    return db.scalars(
        select(Sample)
        .join(link_model, link_model.sample_id == Sample.sample_id)
        .where(link_model.process_event_id == process_event_id)
        .options(selectinload(Sample.sample_type_ref))
        .order_by(Sample.sample_id)
    ).all()
