from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import StorageLocation
from ..schemas import StorageLocationBrief, StorageLocationCreate, StorageLocationUpdate

router = APIRouter(prefix="/storage-locations", tags=["storage locations"])

@router.get("", response_model=list[StorageLocationBrief])
def list_storage_locations(db: Session = Depends(get_db)):
    return db.scalars(select(StorageLocation).order_by(StorageLocation.location_code)).all()

@router.get("/{location_id}", response_model=StorageLocationBrief)
def get_storage_location(location_id: int, db: Session = Depends(get_db)):
    location = db.get(StorageLocation, location_id)
    if not location:
        raise HTTPException(404, "Storage location not found")
    return location

@router.post("", response_model=StorageLocationBrief, status_code=status.HTTP_201_CREATED)
def create_storage_location(payload: StorageLocationCreate, db: Session = Depends(get_db)):
    if payload.parent_location_id is not None and not db.get(StorageLocation, payload.parent_location_id):
        raise HTTPException(404, "Parent storage location not found")
    location = StorageLocation(**payload.model_dump())
    db.add(location)
    db.commit()
    db.refresh(location)
    return location

@router.patch("/{location_id}", response_model=StorageLocationBrief)
def update_storage_location(location_id: int, payload: StorageLocationUpdate, db: Session = Depends(get_db)):
    location = db.get(StorageLocation, location_id)
    if not location:
        raise HTTPException(404, "Storage location not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(location, key, value)
    db.commit()
    db.refresh(location)
    return location
