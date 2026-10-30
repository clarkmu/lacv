from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Assay, AssayDefinition, AssayOutput, AssayResult, DataFile, Sample
from ..sample_rules import create_derived_sample
from ..schemas import AssayBrief, AssayDetail, AssayResultCreate, AssayUpdate, DerivedSampleCreate

router = APIRouter(prefix="/assays", tags=["assays"])


@router.get("", response_model=list[AssayBrief])
def list_assays(db: Session = Depends(get_db)):
    assays = db.scalars(
        select(Assay)
        .options(selectinload(Assay.definition), selectinload(Assay.sample).selectinload(Sample.sample_type_ref))
        .order_by(Assay.assay_id.desc())
    ).all()
    return [_serialize_assay(assay) for assay in assays]


@router.get("/{assay_id}", response_model=AssayDetail)
def get_assay(assay_id: int, db: Session = Depends(get_db)):
    assay = db.scalar(
        select(Assay)
        .where(Assay.assay_id == assay_id)
        .options(selectinload(Assay.definition), selectinload(Assay.sample).selectinload(Sample.sample_type_ref), selectinload(Assay.results))
    )
    if not assay:
        raise HTTPException(404, "Assay not found")
    output_samples = db.scalars(
        select(Sample)
        .join(AssayOutput, AssayOutput.sample_id == Sample.sample_id)
        .where(AssayOutput.assay_id == assay_id)
        .options(selectinload(Sample.sample_type_ref))
        .order_by(Sample.sample_id)
    ).all()
    return {
        **_serialize_assay(assay),
        "notes": assay.notes,
        "results": assay.results,
        "output_samples": output_samples,
        "data_files": db.scalars(select(DataFile).where(DataFile.assay_id == assay_id).order_by(DataFile.data_file_id)).all(),
    }


@router.patch("/{assay_id}", response_model=AssayDetail)
def update_assay(assay_id: int, payload: AssayUpdate, db: Session = Depends(get_db)):
    assay = db.get(Assay, assay_id)
    if not assay:
        raise HTTPException(404, "Assay not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(assay, key, value)
    db.commit()
    return get_assay(assay_id, db)


@router.post("/{assay_id}/results", response_model=AssayDetail, status_code=status.HTTP_201_CREATED)
def create_assay_result(assay_id: int, payload: AssayResultCreate, db: Session = Depends(get_db)):
    if not db.get(Assay, assay_id):
        raise HTTPException(404, "Assay not found")
    db.add(AssayResult(assay_id=assay_id, **payload.model_dump()))
    db.commit()
    return get_assay(assay_id, db)


@router.post("/{assay_id}/output-samples", response_model=AssayDetail, status_code=status.HTTP_201_CREATED)
def create_assay_output_sample(assay_id: int, payload: DerivedSampleCreate, db: Session = Depends(get_db)):
    """An assay may produce a derived Sample (for example a sequencing library); it becomes a child of the assayed Sample."""
    assay = db.get(Assay, assay_id)
    if not assay:
        raise HTTPException(404, "Assay not found")
    output = create_derived_sample(assay.sample_id, payload, db, assay.operator_name)
    db.add(AssayOutput(assay_id=assay_id, sample_id=output.sample_id))
    db.commit()
    return get_assay(assay_id, db)


def assay_definition_for(assay_type: str, target: str | None, assay_name: str | None, db: Session) -> AssayDefinition:
    type_code = "_".join(assay_type.lower().split())
    target_code = "_".join(target.lower().split()) if target else "any"
    definition_code = f"{type_code}_{target_code}"[:100]
    definition = db.scalar(select(AssayDefinition).where(AssayDefinition.assay_code == definition_code))
    if definition is None:
        definition = AssayDefinition(assay_code=definition_code, assay_name=assay_name or assay_type, assay_type=assay_type, target=target)
        db.add(definition)
        db.flush()
    return definition


def _serialize_assay(assay: Assay) -> dict:
    return {
        "assay_id": assay.assay_id,
        "assay_code": assay.assay_instance_code,
        "assay_name": assay.definition.assay_name,
        "assay_type": assay.definition.assay_type,
        "target": assay.definition.target,
        "sample": assay.sample,
        "operator_name": assay.operator_name,
        "assay_date": assay.assay_date,
        "status": assay.status,
        "qc_status": assay.qc_status,
    }
