import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import SampleType
from ..schemas import SampleTypeBrief, SampleTypeCreate

router = APIRouter(prefix="/sample-types", tags=["sample types"])


@router.get("", response_model=list[SampleTypeBrief])
def list_sample_types(db: Session = Depends(get_db)):
    return db.scalars(select(SampleType).where(SampleType.is_active == True).order_by(SampleType.sort_order, SampleType.type_name)).all()


@router.post("", response_model=SampleTypeBrief, status_code=status.HTTP_201_CREATED)
def create_sample_type(payload: SampleTypeCreate, db: Session = Depends(get_db)):
    type_name = payload.type_name.strip()
    type_code = payload.type_code or re.sub(r"[^a-z0-9]+", "_", type_name.lower()).strip("_")[:100]
    if not type_name or not type_code:
        raise HTTPException(400, "Sample type name is required")
    if db.scalar(select(SampleType.sample_type_id).where(or_(SampleType.type_code == type_code, func.lower(SampleType.type_name) == type_name.lower()))):
        raise HTTPException(400, f"Sample type already exists: {type_name}")
    sample_type = SampleType(type_code=type_code, type_name=type_name, description=payload.description, sort_order=0)
    db.add(sample_type)
    db.commit()
    db.refresh(sample_type)
    return sample_type
