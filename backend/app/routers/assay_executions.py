"""Assay executions: one assay definition performed on one Sample, with its results.

Executions are stored in the assays table; each row names its definition and its Sample.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import Integer, func, select, true
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Assay, AssayDefinition, AssayOutput, AssayResult, DataFile, Sample, SampleQuantityEvent
from ..sample_rules import consume, create_derived_sample
from ..schemas import (
    AssayExecutionBrief, AssayExecutionCreate, AssayExecutionDetail, AssayExecutionUpdate, AssayResultCreate, AssayResultUpdate,
    DerivedSampleCreate,
)

router = APIRouter(prefix="/assay-executions", tags=["assays"])

# A result whose QC is accepted is part of the reviewed record: it is not edited or removed until QC is reopened.
LOCKED_RESULT_QC = "accepted"


@router.get("", response_model=list[AssayExecutionBrief])
def list_assay_executions(assay_definition_id: int | None = None, db: Session = Depends(get_db)):
    condition = Assay.assay_definition_id == assay_definition_id if assay_definition_id is not None else true()
    return executions_where(condition, db)


@router.get("/performed-by", response_model=list[str])
def list_performed_by(db: Session = Depends(get_db)):
    """Names that have performed assays, most recently used first, as suggestions for the next one.

    Names are only whitespace-tidied and deduplicated exactly; similar-looking names (e.g. "M. Clark" and
    "Michael Clark") stay separate because they may be different people.
    """
    rows = db.execute(
        select(Assay.operator_name, func.max(Assay.assay_id).label("latest"))
        .where(Assay.operator_name.is_not(None))
        .group_by(Assay.operator_name)
        .order_by(func.max(Assay.assay_id).desc())
    ).all()
    names: list[str] = []
    for operator_name, _ in rows:
        name = " ".join(operator_name.split())
        if name and name not in names:
            names.append(name)
    return names


@router.get("/{execution_id}", response_model=AssayExecutionDetail)
def get_assay_execution(execution_id: int, db: Session = Depends(get_db)):
    execution = db.scalar(
        select(Assay)
        .where(Assay.assay_id == execution_id)
        .options(
            selectinload(Assay.definition).selectinload(AssayDefinition.expected_results),
            selectinload(Assay.sample).selectinload(Sample.sample_type_ref),
            selectinload(Assay.results),
        )
    )
    if not execution:
        raise HTTPException(404, "Assay execution not found")
    output_samples = db.scalars(
        select(Sample)
        .join(AssayOutput, AssayOutput.sample_id == Sample.sample_id)
        .where(AssayOutput.assay_id == execution_id)
        .options(selectinload(Sample.sample_type_ref))
        .order_by(Sample.sample_id)
    ).all()
    volume_event = db.scalar(select(SampleQuantityEvent).where(SampleQuantityEvent.related_assay_id == execution_id))
    return {
        **_execution_fields(execution, len(execution.results)),
        "definition": execution.definition,
        "notes": execution.notes,
        "volume_used": -volume_event.quantity_change if volume_event else None,
        "volume_unit": volume_event.quantity_unit if volume_event else None,
        "results": execution.results,
        "output_samples": output_samples,
        "data_files": db.scalars(select(DataFile).where(DataFile.assay_id == execution_id).order_by(DataFile.data_file_id)).all(),
    }


@router.patch("/{execution_id}", response_model=AssayExecutionDetail)
def update_assay_execution(execution_id: int, payload: AssayExecutionUpdate, db: Session = Depends(get_db)):
    execution = _execution_or_404(execution_id, db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if key in ("status", "qc_status") and not value:
            raise field_error(key, "This field is required")
        setattr(execution, key, value)
    db.commit()
    return get_assay_execution(execution_id, db)


@router.post("/{execution_id}/results", response_model=AssayExecutionDetail, status_code=status.HTTP_201_CREATED)
def create_assay_result(execution_id: int, payload: AssayResultCreate, db: Session = Depends(get_db)):
    _execution_or_404(execution_id, db)
    db.add(AssayResult(assay_id=execution_id, **payload.model_dump()))
    db.commit()
    return get_assay_execution(execution_id, db)


@router.patch("/{execution_id}/results/{result_id}", response_model=AssayExecutionDetail)
def update_assay_result(execution_id: int, result_id: int, payload: AssayResultUpdate, db: Session = Depends(get_db)):
    result = _result_or_404(execution_id, result_id, db)
    changes = payload.model_dump(exclude_unset=True)
    if "result_name" in changes and not changes["result_name"]:
        raise field_error("result_name", "This field is required")
    if "qc_status" in changes and not changes["qc_status"]:
        raise field_error("qc_status", "This field is required")
    content_changes = {key for key, value in changes.items() if key != "qc_status" and getattr(result, key) != value}
    if result.qc_status == LOCKED_RESULT_QC and content_changes and changes.get("qc_status", LOCKED_RESULT_QC) == LOCKED_RESULT_QC:
        raise HTTPException(409, f"{result.result_name} is QC accepted, so it cannot be changed. Set its QC back to not reviewed first.")
    for key, value in changes.items():
        setattr(result, key, value)
    if result.numeric_value is None and result.text_value is None:
        raise field_error("numeric_value", "Enter a value: a number, or text such as \"not detected\"")
    db.commit()
    return get_assay_execution(execution_id, db)


@router.delete("/{execution_id}/results/{result_id}", response_model=AssayExecutionDetail)
def delete_assay_result(execution_id: int, result_id: int, db: Session = Depends(get_db)):
    """Remove a result entered by mistake. Accepted results are kept; reopen QC (or reject the result) instead."""
    result = _result_or_404(execution_id, result_id, db)
    if result.qc_status == LOCKED_RESULT_QC:
        raise HTTPException(409, f"{result.result_name} is QC accepted, so it cannot be removed. Reject it, or set its QC back to not reviewed first.")
    db.delete(result)
    db.commit()
    return get_assay_execution(execution_id, db)


@router.post("/{execution_id}/output-samples", response_model=AssayExecutionDetail, status_code=status.HTTP_201_CREATED)
def create_assay_output_sample(execution_id: int, payload: DerivedSampleCreate, db: Session = Depends(get_db)):
    """An execution may produce a derived Sample (for example a sequencing library); it becomes a child of the assayed Sample."""
    execution = _execution_or_404(execution_id, db)
    output = create_derived_sample(execution.sample_id, payload, db, execution.operator_name)
    db.add(AssayOutput(assay_id=execution_id, sample_id=output.sample_id))
    db.commit()
    return get_assay_execution(execution_id, db)


def record_execution(sample: Sample, payload: AssayExecutionCreate, db: Session) -> Assay:
    """An execution, the volume it used and its results, added as one change (the caller commits)."""
    definition = db.get(AssayDefinition, payload.assay_definition_id)
    if not definition:
        raise field_error("assay_definition_id", f"Assay not found: {payload.assay_definition_id}", 404)
    if not definition.is_active:
        raise field_error("assay_definition_id", f"{definition.assay_name} is retired; choose an assay in use")
    code = payload.execution_code or next_execution_code(db)
    if db.scalar(select(Assay.assay_id).where(Assay.assay_instance_code == code)):
        raise field_error("execution_code", f"Assay execution code already exists: {code}", 400)
    execution = Assay(
        assay_instance_code=code,
        sample_id=sample.sample_id,
        assay_definition_id=definition.assay_definition_id,
        operator_name=payload.operator_name,
        assay_date=payload.assay_date,
        status=payload.status,
        qc_status=payload.qc_status,
        notes=payload.notes,
    )
    db.add(execution)
    db.flush()
    if payload.volume_used is not None:
        _record_volume_used(sample, execution, payload, db)
    for result in payload.results:
        db.add(AssayResult(assay_id=execution.assay_id, **result.model_dump()))
    return execution


def _record_volume_used(sample: Sample, execution: Assay, payload: AssayExecutionCreate, db: Session) -> None:
    """One removal on the Sample's own ledger, linked to the execution. Unknown availability is refused, not assumed."""
    if sample.current_quantity is None or not sample.quantity_unit:
        raise field_error("volume_used", f"{sample.sample_code} has no recorded quantity and unit, so the volume used cannot be deducted. Record its quantity first, or leave Volume used blank.")
    try:
        consume(sample, payload.volume_used, db, payload.volume_unit, None, payload.operator_name,
                f"Used by assay {execution.assay_instance_code}", assay_id=execution.assay_id)
    except HTTPException as error:
        raise field_error("volume_used", error.detail) from error


def next_execution_code(db: Session) -> str:
    """The next ASSAY-NNN code, following the existing execution codes."""
    number = db.scalar(select(func.max(func.substring(Assay.assay_instance_code, r"^ASSAY-(\d+)$").cast(Integer))))
    return f"ASSAY-{(number or 0) + 1:03d}"


def executions_where(condition, db: Session) -> list[dict]:
    executions = db.scalars(
        select(Assay)
        .where(condition)
        .options(selectinload(Assay.definition), selectinload(Assay.sample).selectinload(Sample.sample_type_ref))
        .order_by(Assay.assay_date.desc().nulls_last(), Assay.assay_id.desc())
    ).all()
    counts = result_counts([execution.assay_id for execution in executions], db)
    return [_execution_fields(execution, counts.get(execution.assay_id, 0)) for execution in executions]


def result_counts(execution_ids: list[int], db: Session) -> dict[int, int]:
    if not execution_ids:
        return {}
    return dict(db.execute(
        select(AssayResult.assay_id, func.count()).where(AssayResult.assay_id.in_(execution_ids)).group_by(AssayResult.assay_id)
    ).all())


def field_error(field: str, message: str, status_code: int = 422) -> HTTPException:
    """An error the form can show next to the field it is about, in FastAPI's validation-error shape."""
    return HTTPException(status_code, [{"loc": ["body", field], "msg": message, "type": "value_error"}])


def _execution_fields(execution: Assay, result_count: int) -> dict:
    return {
        "execution_id": execution.assay_id,
        "execution_code": execution.assay_instance_code,
        "assay_definition_id": execution.assay_definition_id,
        "assay_name": execution.definition.assay_name,
        "assay_type": execution.definition.assay_type,
        "target": execution.definition.target,
        "sample": execution.sample,
        "operator_name": execution.operator_name,
        "assay_date": execution.assay_date,
        "status": execution.status,
        "qc_status": execution.qc_status,
        "result_count": result_count,
    }


def _execution_or_404(execution_id: int, db: Session) -> Assay:
    execution = db.get(Assay, execution_id)
    if not execution:
        raise HTTPException(404, "Assay execution not found")
    return execution


def _result_or_404(execution_id: int, result_id: int, db: Session) -> AssayResult:
    result = db.get(AssayResult, result_id)
    if not result or result.assay_id != execution_id:
        raise HTTPException(404, "Result not found on this assay execution")
    return result
