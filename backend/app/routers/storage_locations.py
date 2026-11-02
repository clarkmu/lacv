from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Sample, StorageLocation
from ..schemas import StorageLocationBrief, StorageLocationCreate, StorageLocationDetail, StorageLocationUpdate

router = APIRouter(prefix="/storage-locations", tags=["storage locations"])

@router.get("", response_model=list[StorageLocationBrief])
def list_storage_locations(db: Session = Depends(get_db)):
    return db.scalars(select(StorageLocation).order_by(StorageLocation.location_code)).all()

@router.get("/{location_id}", response_model=StorageLocationDetail)
def get_storage_location(location_id: int, db: Session = Depends(get_db)):
    """A location with its path, the locations inside it, and every Sample stored in it or below it."""
    locations = {location.storage_location_id: location for location in db.scalars(select(StorageLocation)).all()}
    location = locations.get(location_id)
    if not location:
        raise HTTPException(404, "Storage location not found")
    children: dict[int | None, list[StorageLocation]] = {}
    for candidate in sorted(locations.values(), key=lambda item: item.location_code):
        children.setdefault(candidate.parent_location_id, []).append(candidate)
    within = _location_and_below(location_id, children)
    contents = db.scalars(
        select(Sample)
        .where(Sample.storage_location_id.in_(within))
        .options(selectinload(Sample.sample_type_ref), selectinload(Sample.legacy_material_records), selectinload(Sample.parent).selectinload(Sample.sample_type_ref))
        .order_by(Sample.sample_code)
    ).all()
    roots = _original_samples([sample for sample in contents if sample.parent_sample_id is not None], db)
    counts: dict[int, int] = {}
    for sample in contents:
        counts[sample.storage_location_id] = counts.get(sample.storage_location_id, 0) + 1
    return {
        **_location_fields(location),
        "description": location.description,
        "ancestors": _ancestors(location, locations),
        "sub_locations": [
            {**_location_fields(child), "sample_count": sum(counts.get(inner, 0) for inner in _location_and_below(child.storage_location_id, children))}
            for child in children.get(location_id, [])
        ],
        "contents": [_stored_sample(sample, roots.get(sample.sample_id), locations) for sample in contents],
    }

@router.post("", response_model=StorageLocationBrief, status_code=status.HTTP_201_CREATED)
def create_storage_location(payload: StorageLocationCreate, db: Session = Depends(get_db)):
    if payload.parent_location_id is not None and not db.get(StorageLocation, payload.parent_location_id):
        raise HTTPException(404, "Parent storage location not found")
    location = StorageLocation(**payload.model_dump())
    db.add(location)
    _commit_unique(location, db)
    return location

@router.patch("/{location_id}", response_model=StorageLocationBrief)
def update_storage_location(location_id: int, payload: StorageLocationUpdate, db: Session = Depends(get_db)):
    location = db.get(StorageLocation, location_id)
    if not location:
        raise HTTPException(404, "Storage location not found")
    data = payload.model_dump(exclude_unset=True)
    for required in ("location_code", "location_type"):
        if required in data and not (data[required] or "").strip():
            raise HTTPException(422, [{"loc": ["body", required], "msg": "This field is required", "type": "value_error"}])
    if data.get("parent_location_id") is not None:
        _require_valid_parent(location_id, data["parent_location_id"], db)
    for key, value in data.items():
        setattr(location, key, value)
    _commit_unique(location, db)
    return location


def _require_valid_parent(location_id: int, parent_id: int, db: Session) -> None:
    """A location cannot be inside itself or inside one of its own sub-locations."""
    parent = db.get(StorageLocation, parent_id)
    if not parent:
        raise HTTPException(404, "Parent storage location not found")
    while parent is not None:
        if parent.storage_location_id == location_id:
            raise HTTPException(422, [{"loc": ["body", "parent_location_id"], "msg": "A location cannot be inside itself or one of its own sub-locations", "type": "value_error"}])
        parent = db.get(StorageLocation, parent.parent_location_id) if parent.parent_location_id is not None else None


def _commit_unique(location: StorageLocation, db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(400, [{"loc": ["body", "location_code"], "msg": "Another location in the same parent already has this code", "type": "value_error"}]) from error
    db.refresh(location)


def _location_and_below(location_id: int, children: dict[int | None, list[StorageLocation]]) -> list[int]:
    found, pending = [], [location_id]
    while pending:
        current = pending.pop()
        found.append(current)
        pending.extend(child.storage_location_id for child in children.get(current, []) if child.storage_location_id not in found)
    return found


def _ancestors(location: StorageLocation, locations: dict[int, StorageLocation]) -> list[StorageLocation]:
    path, parent_id = [], location.parent_location_id
    while parent_id is not None and parent_id in locations and len(path) < 50:
        path.append(locations[parent_id])
        parent_id = locations[parent_id].parent_location_id
    return list(reversed(path))


def _original_samples(samples: list[Sample], db: Session) -> dict[int, Sample]:
    """For each derived Sample, the original (root) Sample at the top of its lineage."""
    parent_of: dict[int, int | None] = {}
    pending = {sample.parent_sample_id for sample in samples}
    while pending:
        rows = db.execute(select(Sample.sample_id, Sample.parent_sample_id).where(Sample.sample_id.in_(pending))).all()
        parent_of.update(dict(rows))
        pending = {parent for _, parent in rows if parent is not None and parent not in parent_of}
    root_ids = {}
    for sample in samples:
        current = sample.parent_sample_id
        while parent_of.get(current) is not None:
            current = parent_of[current]
        root_ids[sample.sample_id] = current
    loaded = {root.sample_id: root for root in db.scalars(select(Sample).where(Sample.sample_id.in_(set(root_ids.values()))).options(selectinload(Sample.sample_type_ref))).all()}
    return {sample_id: loaded[root_id] for sample_id, root_id in root_ids.items()}


def _location_fields(location: StorageLocation) -> dict:
    return {key: getattr(location, key) for key in ("storage_location_id", "parent_location_id", "location_code", "location_type", "location_name", "is_active")}


def _stored_sample(sample: Sample, root: Sample | None, locations: dict[int, StorageLocation]) -> dict:
    return {
        **{key: getattr(sample, key) for key in (
            "sample_id", "sample_code", "sample_type_id", "status", "subject_code", "aliquot_number", "label", "current_quantity", "quantity_unit",
            "concentration", "concentration_unit", "received_date", "storage_location_id",
        )},
        "sample_type": sample.sample_type,
        "legacy_codes": sample.legacy_codes,
        "parent": sample.parent,
        "root": root,
        "storage_location_code": locations[sample.storage_location_id].location_code,
    }
