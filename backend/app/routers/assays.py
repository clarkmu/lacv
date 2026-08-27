from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Assay, AssayResult
from ..schemas import AssayBrief, AssayDetail, AssayResultCreate

router = APIRouter(prefix="/assays", tags=["assays"])


@router.get("", response_model=list[AssayBrief])
def list_assays(db: Session = Depends(get_db)):
    assays = db.scalars(
        select(Assay)
        .options(selectinload(Assay.definition), selectinload(Assay.material))
        .order_by(Assay.assay_id.desc())
    ).all()
    return [_serialize_assay(assay) for assay in assays]


@router.get("/{assay_id}", response_model=AssayDetail)
def get_assay(assay_id: int, db: Session = Depends(get_db)):
    assay = db.scalar(
        select(Assay)
        .where(Assay.assay_id == assay_id)
        .options(selectinload(Assay.definition), selectinload(Assay.material), selectinload(Assay.results))
    )
    if not assay:
        raise HTTPException(404, "Assay not found")
    return _serialize_assay(assay)


@router.post("/{assay_id}/results", response_model=AssayDetail, status_code=status.HTTP_201_CREATED)
def create_assay_result(assay_id: int, payload: AssayResultCreate, db: Session = Depends(get_db)):
    if not db.get(Assay, assay_id):
        raise HTTPException(404, "Assay not found")
    result = AssayResult(assay_id=assay_id, **payload.model_dump())
    db.add(result)
    db.commit()
    return get_assay(assay_id, db)


def _serialize_assay(assay: Assay):
    return {
        "assay_id": assay.assay_id,
        "assay_code": assay.assay_instance_code,
        "assay_name": assay.definition.assay_name,
        "assay_type": assay.definition.assay_type,
        "target": assay.definition.target,
        "material": assay.material,
        "operator_name": assay.operator_name,
        "assay_date": assay.assay_date,
        "status": assay.status,
        "qc_status": assay.qc_status,
        "notes": assay.notes,
        "results": sorted(getattr(assay, "results", []), key=lambda result: result.assay_result_id),
    }
