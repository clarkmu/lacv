"""Sample rules shared by the samples, process-event and assay routers.

Sample is the only physical identity. Derived Samples get a parent link and
nothing else from their parent: every other value comes from the request.
"""
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Batch, LegacyMaterialRecord, ProcessType, Sample, SampleQuantityEvent, SampleType, StorageEvent, StorageLocation
from .quantity import convert
from .schemas import DerivedSampleCreate


def get_sample_or_404(sample_id: int, db: Session, label: str = "Sample") -> Sample:
    sample = db.get(Sample, sample_id)
    if not sample:
        raise HTTPException(404, f"{label} not found: {sample_id}")
    return sample


def require_unique_sample_code(sample_code: str, db: Session, sample_id: int | None = None) -> None:
    """Sample codes and legacy Material codes share one namespace, so old labels stay unambiguous."""
    existing = db.scalar(select(Sample.sample_id).where(Sample.sample_code == sample_code))
    if existing is not None and existing != sample_id:
        raise HTTPException(400, f"Sample code already exists: {sample_code}")
    legacy_owner = db.scalar(select(LegacyMaterialRecord.sample_id).where(LegacyMaterialRecord.material_code == sample_code))
    if legacy_owner is not None and legacy_owner != sample_id:
        raise HTTPException(400, f"Sample code is already used as a legacy material code: {sample_code}")


def validate_references(data: dict, db: Session) -> None:
    if data.get("sample_type_id") is not None and not db.get(SampleType, data["sample_type_id"]):
        raise HTTPException(404, f"Sample type not found: {data['sample_type_id']}")
    if data.get("storage_location_id") is not None and not db.get(StorageLocation, data["storage_location_id"]):
        raise HTTPException(404, f"Storage location not found: {data['storage_location_id']}")


def validate_parent(sample: Sample | None, parent_id: int | None, batch_id: int | None, db: Session) -> None:
    """A parent must exist, must not be the sample or one of its descendants, and derived samples carry no batch."""
    if parent_id is None:
        return
    if batch_id is not None:
        raise HTTPException(400, "Shipping batches contain only root samples; a sample with a parent cannot have a batch")
    parent = get_sample_or_404(parent_id, db, "Parent sample")
    if sample is None:
        return
    ancestor = parent
    while ancestor is not None:
        if ancestor.sample_id == sample.sample_id:
            raise HTTPException(400, "A sample cannot be its own parent or descend from itself")
        ancestor = ancestor.parent


def apply_sample_changes(sample: Sample, data: dict, db: Session, operator_name: str | None = None, change_notes: str | None = None) -> None:
    """Validate and apply edits to one Sample. Storage moves and quantity edits get their history rows."""
    if "sample_code" in data:
        require_unique_sample_code(data["sample_code"], db, sample.sample_id)
    validate_references(data, db)
    if "parent_sample_id" in data or "batch_id" in data:
        next_parent = data.get("parent_sample_id", sample.parent_sample_id)
        next_batch = data.get("batch_id", sample.batch_id)
        validate_parent(sample, next_parent, next_batch, db)
        if next_batch is not None and not db.get(Batch, next_batch):
            raise HTTPException(404, f"Batch not found: {next_batch}")
    if "storage_location_id" in data and data["storage_location_id"] != sample.storage_location_id:
        record_storage_move(sample, sample.storage_location_id, data["storage_location_id"], db, operator_name, change_notes)
    if "current_quantity" in data and data["current_quantity"] != sample.current_quantity:
        record_quantity_change(sample, data["current_quantity"], "adjusted", db, data.get("quantity_unit"), None, operator_name, change_notes)
    for key, value in data.items():
        setattr(sample, key, value)


def create_derived_sample(parent_id: int | None, payload: DerivedSampleCreate, db: Session, operator_name: str | None = None) -> Sample:
    data = payload.model_dump(exclude={"parent_sample_id", "quantity_generated"})
    require_unique_sample_code(data["sample_code"], db)
    validate_references(data, db)
    sample = Sample(**data, parent_sample_id=parent_id)
    db.add(sample)
    db.flush()
    record_initial_storage(sample, db, operator_name)
    return sample


def record_initial_storage(sample: Sample, db: Session, operator_name: str | None = None) -> None:
    if sample.storage_location_id is not None:
        record_storage_move(sample, None, sample.storage_location_id, db, operator_name)


def record_storage_move(sample: Sample, from_location_id: int | None, to_location_id: int | None, db: Session, operator_name: str | None = None, notes: str | None = None) -> None:
    event_type = "stored" if from_location_id is None else ("removed" if to_location_id is None else "moved")
    db.add(StorageEvent(
        sample_id=sample.sample_id,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        event_type=event_type,
        event_date=datetime.utcnow(),
        operator_name=operator_name,
        notes=notes,
    ))


def record_quantity_change(
    sample: Sample,
    new_quantity: Decimal | None,
    event_type: str,
    db: Session,
    unit: str | None = None,
    process_event_id: int | None = None,
    operator_name: str | None = None,
    notes: str | None = None,
    assay_id: int | None = None,
) -> None:
    before = sample.current_quantity
    sample.current_quantity = new_quantity
    quantity_unit = unit or sample.quantity_unit
    if not quantity_unit:
        return
    db.add(SampleQuantityEvent(
        sample_id=sample.sample_id,
        event_type=event_type,
        quantity_change=(new_quantity or 0) - (before or 0),
        quantity_unit=quantity_unit,
        quantity_before=before,
        quantity_after=new_quantity,
        related_process_event_id=process_event_id,
        related_assay_id=assay_id,
        event_date=datetime.utcnow(),
        operator_name=operator_name,
        notes=notes,
    ))


def consume(
    sample: Sample,
    amount: Decimal | None,
    db: Session,
    unit: str | None,
    process_event_id: int | None,
    operator_name: str | None,
    notes: str | None,
    event_type: str = "consumed",
    assay_id: int | None = None,
) -> None:
    """Record a physical removal from sample, in the sample's own unit."""
    if amount is None or sample.current_quantity is None:
        return
    if amount < 0:
        raise HTTPException(400, f"The amount removed from {sample.sample_code} cannot be negative")
    if sample.quantity_unit:
        converted = convert(amount, unit or sample.quantity_unit, sample.quantity_unit)
        if converted is None:
            raise HTTPException(400, f"Cannot remove {amount} {unit} from {sample.sample_code}: its quantity is recorded in {sample.quantity_unit}")
        amount, unit = converted, sample.quantity_unit
    if amount > sample.current_quantity:
        raise HTTPException(400, f"Cannot remove {_amount(amount, unit)} from {sample.sample_code}: only {_amount(sample.current_quantity, sample.quantity_unit)} is recorded")
    record_quantity_change(sample, sample.current_quantity - amount, event_type, db, unit, process_event_id, operator_name, notes, assay_id)


def _amount(value: Decimal, unit: str | None) -> str:
    return f"{value.normalize():f} {unit}" if unit else f"{value.normalize():f}"


def get_or_create_process_type(type_name: str, db: Session) -> ProcessType:
    type_code = "_".join(type_name.lower().split())[:100] or "process"
    process_type = db.scalar(select(ProcessType).where(ProcessType.type_code == type_code))
    if process_type:
        return process_type
    process_type = ProcessType(type_code=type_code, type_name=type_name, sort_order=0)
    db.add(process_type)
    db.flush()
    return process_type
