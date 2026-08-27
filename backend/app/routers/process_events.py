from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Material, MaterialQuantityEvent, ProcessEvent, ProcessEventInput, ProcessEventOutput, ProcessType, Sample, StorageEvent, StorageLocation
from ..routers.materials import get_material
from ..schemas import ProcessEventCreate

router = APIRouter(prefix="/process-events", tags=["process-events"])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_process_event(payload: ProcessEventCreate, db: Session = Depends(get_db)):
    if not payload.input_material_ids:
        raise HTTPException(400, "At least one input material is required")
    if not payload.output_materials:
        raise HTTPException(400, "At least one output material is required")
    input_materials = [db.get(Material, material_id) for material_id in payload.input_material_ids]
    if any(material is None for material in input_materials):
        raise HTTPException(404, "Input material not found")
    for output in payload.output_materials:
        if not db.get(Sample, output.sample_id):
            raise HTTPException(404, f"Sample not found: {output.sample_id}")
        if output.storage_location_id is not None and not db.get(StorageLocation, output.storage_location_id):
            raise HTTPException(404, f"Storage location not found: {output.storage_location_id}")

    process_type = _get_or_create_process_type(payload.process_type, db)
    process = ProcessEvent(
        process_code=payload.process_code,
        process_type_id=process_type.process_type_id,
        operator_name=payload.operator_name,
        started_at=payload.started_at or datetime.utcnow(),
        completed_at=payload.completed_at,
        status=payload.status,
        notes=payload.notes,
    )
    db.add(process)
    db.flush()

    for material in input_materials:
        db.add(ProcessEventInput(
            process_event_id=process.process_event_id,
            material_id=material.material_id,
            quantity_used=payload.quantity_used,
            quantity_unit=payload.quantity_unit,
            notes=payload.notes,
        ))
        if payload.quantity_used is not None and material.current_quantity is not None:
            before = material.current_quantity
            material.current_quantity = before - payload.quantity_used
            db.add(MaterialQuantityEvent(
                material_id=material.material_id,
                event_type="consumed",
                quantity_change=-payload.quantity_used,
                quantity_unit=payload.quantity_unit or material.quantity_unit or "",
                quantity_before=before,
                quantity_after=material.current_quantity,
                related_process_event_id=process.process_event_id,
                event_date=datetime.utcnow(),
                operator_name=payload.operator_name,
                notes=payload.notes,
            ))

    for output in payload.output_materials:
        output_data = output.model_dump(exclude={"quantity_generated"})
        if output_data.get("parent_material_id") is None and len(input_materials) == 1:
            output_data["parent_material_id"] = input_materials[0].material_id
        material = Material(**output_data)
        db.add(material)
        db.flush()
        db.add(ProcessEventOutput(
            process_event_id=process.process_event_id,
            material_id=material.material_id,
            quantity_generated=output.quantity_generated,
            quantity_unit=output.quantity_unit,
            notes=payload.notes,
        ))
        if material.storage_location_id is not None:
            db.add(StorageEvent(
                material_id=material.material_id,
                from_location_id=None,
                to_location_id=material.storage_location_id,
                event_type="stored",
                event_date=datetime.utcnow(),
            ))

    db.commit()
    return get_material(input_materials[0].material_id, db)


@router.get("/types")
def list_process_types(db: Session = Depends(get_db)):
    return db.scalars(select(ProcessType).order_by(ProcessType.sort_order, ProcessType.type_name)).all()


def _get_or_create_process_type(type_name: str, db: Session):
    type_code = "_".join(type_name.lower().split())[:100] or "process"
    process_type = db.scalar(select(ProcessType).where(ProcessType.type_code == type_code))
    if process_type:
        return process_type
    process_type = ProcessType(type_code=type_code, type_name=type_name, sort_order=0)
    db.add(process_type)
    db.flush()
    return process_type
