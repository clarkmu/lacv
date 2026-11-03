"""Assay executions: one run of an assay definition on one or more Samples, each Sample with zero or one result.

Executions are created under their assay (POST /assay-definitions/{id}/executions) and edited here.
"""
import re
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Integer, func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import AssayDefinition, AssayExecution, AssayExecutionSample, AssayOutput, DataFile, Sample, SampleQuantityEvent
from ..sample_rules import consume, create_derived_sample, get_sample_or_404
from ..schemas import (
    AssayExecutionCreate, AssayExecutionDetail, AssayExecutionUpdate, DerivedSampleCreate, ExecutionSampleCreate,
    ExecutionSampleResultUpdate,
)

router = APIRouter(prefix="/assay-executions", tags=["assays"])

NUMBER = re.compile(r"^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")


@router.get("/performed-by", response_model=list[str])
def list_performed_by(db: Session = Depends(get_db)):
    """Names that have performed executions, most recently used first, as suggestions for the next one.

    Names are only whitespace-tidied and deduplicated exactly; similar-looking names (e.g. "M. Clark" and
    "Michael Clark") stay separate because they may be different people.
    """
    rows = db.execute(
        select(AssayExecution.operator_name, func.max(AssayExecution.assay_execution_id).label("latest"))
        .where(AssayExecution.operator_name.is_not(None))
        .group_by(AssayExecution.operator_name)
        .order_by(func.max(AssayExecution.assay_execution_id).desc())
    ).all()
    names: list[str] = []
    for operator_name, _ in rows:
        name = " ".join(operator_name.split())
        if name and name not in names:
            names.append(name)
    return names


@router.get("/{execution_id}", response_model=AssayExecutionDetail)
def get_assay_execution(execution_id: int, db: Session = Depends(get_db)):
    executions = load_executions(AssayExecution.assay_execution_id == execution_id, db)
    if not executions:
        raise HTTPException(404, "Assay execution not found")
    return executions[0]


@router.patch("/{execution_id}", response_model=AssayExecutionDetail)
def update_assay_execution(execution_id: int, payload: AssayExecutionUpdate, db: Session = Depends(get_db)):
    execution = _execution_or_404(execution_id, db)
    changes = payload.model_dump(exclude_unset=True)
    for key in ("execution_name", "status", "qc_status"):
        if key in changes and not changes[key]:
            raise field_error(key, "This field is required")
    if "execution_name" in changes:
        _require_unique_name(execution.assay_definition_id, changes["execution_name"], db, execution_id)
    for key, value in changes.items():
        setattr(execution, key, value)
    db.commit()
    return get_assay_execution(execution_id, db)


@router.post("/{execution_id}/samples", response_model=AssayExecutionDetail, status_code=status.HTTP_201_CREATED)
def add_execution_sample(execution_id: int, payload: ExecutionSampleCreate, db: Session = Depends(get_db)):
    execution = _execution_or_404(execution_id, db)
    errors = _add_samples(execution, [payload], db, loc_prefix=[])
    if errors:
        raise HTTPException(422, errors)
    db.commit()
    return get_assay_execution(execution_id, db)


@router.patch("/{execution_id}/samples/{sample_id}", response_model=AssayExecutionDetail)
def update_execution_sample_result(execution_id: int, sample_id: int, payload: ExecutionSampleResultUpdate, db: Session = Depends(get_db)):
    """Enter, change or clear one Sample's result in this execution."""
    row = _execution_sample_or_404(execution_id, sample_id, db)
    try:
        row.result_numeric, row.result_text = parse_result(payload.result, row.execution.definition)
    except ValueError as error:
        raise field_error("result", str(error)) from error
    db.commit()
    return get_assay_execution(execution_id, db)


@router.delete("/{execution_id}/samples/{sample_id}", response_model=AssayExecutionDetail)
def remove_execution_sample(execution_id: int, sample_id: int, db: Session = Depends(get_db)):
    """Take a Sample added by mistake out of an execution. Refused once the execution used some of it or made something from it."""
    row = _execution_sample_or_404(execution_id, sample_id, db)
    used = db.scalar(select(SampleQuantityEvent.quantity_event_id).where(
        SampleQuantityEvent.related_assay_execution_id == execution_id, SampleQuantityEvent.sample_id == sample_id,
    ))
    produced = db.scalar(select(AssayOutput.sample_id).join(Sample, Sample.sample_id == AssayOutput.sample_id).where(
        AssayOutput.assay_execution_id == execution_id, Sample.parent_sample_id == sample_id,
    ))
    if used or produced:
        reason = "used some of its volume" if used else "produced a derived sample from it"
        raise HTTPException(409, f"{row.sample.sample_code} cannot be removed: this execution {reason}.")
    if len(row.execution.samples) == 1:
        raise HTTPException(409, "An execution needs at least one sample.")
    db.delete(row)
    db.commit()
    return get_assay_execution(execution_id, db)


@router.post("/{execution_id}/samples/{sample_id}/outputs", response_model=AssayExecutionDetail, status_code=status.HTTP_201_CREATED)
def create_assay_output_sample(execution_id: int, sample_id: int, payload: DerivedSampleCreate, db: Session = Depends(get_db)):
    """A derived Sample made from one Sample of the execution (for example a sequencing library); it becomes that Sample's child."""
    row = _execution_sample_or_404(execution_id, sample_id, db)
    output = create_derived_sample(sample_id, payload, db, row.execution.operator_name)
    db.add(AssayOutput(assay_execution_id=execution_id, sample_id=output.sample_id))
    db.commit()
    return get_assay_execution(execution_id, db)


def create_execution(definition: AssayDefinition, payload: AssayExecutionCreate, db: Session) -> AssayExecution:
    """An execution with all its Samples, their results and volumes, or nothing: every problem is collected and raised together."""
    if not definition.is_active:
        raise field_error("assay_definition_id", f"{definition.assay_name} is retired; choose an assay in use")
    name = payload.execution_name or next_execution_name(definition, db)
    _require_unique_name(definition.assay_definition_id, name, db)
    execution = AssayExecution(
        execution_name=name,
        assay_definition_id=definition.assay_definition_id,
        operator_name=payload.operator_name,
        assay_date=payload.assay_date,
        status=payload.status,
        qc_status=payload.qc_status,
        notes=payload.notes,
    )
    execution.definition = definition
    db.add(execution)
    db.flush()
    errors = _add_samples(execution, payload.samples, db, loc_prefix=["samples"])
    if errors:
        db.rollback()
        raise HTTPException(422, errors)
    return execution


def _add_samples(execution: AssayExecution, rows: list[ExecutionSampleCreate], db: Session, loc_prefix: list) -> list[dict]:
    errors: list[dict] = []
    present = {row.sample_id for row in execution.samples}
    samples = {sample.sample_id: sample for sample in db.scalars(select(Sample).where(Sample.sample_id.in_([row.sample_id for row in rows]))).all()}
    for index, row in enumerate(rows):
        loc = [*loc_prefix, index] if loc_prefix else []
        sample = samples.get(row.sample_id)
        if sample is None:
            errors.append(_error([*loc, "sample_id"], f"Sample not found: {row.sample_id}"))
            continue
        if row.sample_id in present:
            errors.append(_error([*loc, "sample_id"], f"{sample.sample_code} is already in this execution"))
            continue
        present.add(row.sample_id)
        try:
            numeric, text = parse_result(row.result, execution.definition)
        except ValueError as error:
            errors.append(_error([*loc, "result"], f"{sample.sample_code}: {error}"))
            continue
        execution.samples.append(AssayExecutionSample(sample=sample, sample_id=sample.sample_id, result_numeric=numeric, result_text=text))
        if row.volume_used is not None:
            problem = _record_volume_used(sample, execution, row, db)
            if problem:
                errors.append(_error([*loc, "volume_used"], problem))
    return errors


def _record_volume_used(sample: Sample, execution: AssayExecution, row: ExecutionSampleCreate, db: Session) -> str | None:
    """One removal on the Sample's own ledger, linked to the execution. Unknown availability is refused, not assumed."""
    if sample.current_quantity is None or not sample.quantity_unit:
        return f"{sample.sample_code} has no recorded quantity and unit, so the volume used cannot be deducted. Record its quantity first, or leave Volume used blank."
    try:
        consume(sample, row.volume_used, db, row.volume_unit, None, execution.operator_name,
                f"Used by assay execution {execution.execution_name}", assay_execution_id=execution.assay_execution_id)
    except HTTPException as error:
        return str(error.detail)
    return None


def parse_result(raw: str | None, definition: AssayDefinition) -> tuple[Decimal | None, str | None]:
    """A typed result as (numeric, text). Blank is no result. A number is stored as a number unless the assay's result is text."""
    value = (raw or "").strip()
    if not value:
        return None, None
    if definition.result_value_type == "text":
        return None, value
    if NUMBER.match(value):
        try:
            return Decimal(value), None
        except InvalidOperation:
            pass
    if definition.result_value_type == "numeric":
        raise ValueError(f"{definition.result_name or 'The result'} must be a number, not \"{value}\"")
    return None, value


def next_execution_name(definition: AssayDefinition, db: Session) -> str:
    """<assay code>-NNN, one past the highest such name this assay has."""
    pattern = rf"^{re.escape(definition.assay_code)}-(\d+)$"
    highest = db.scalar(
        select(func.max(func.substring(AssayExecution.execution_name, pattern).cast(Integer)))
        .where(AssayExecution.assay_definition_id == definition.assay_definition_id)
    )
    return f"{definition.assay_code}-{(highest or 0) + 1:03d}"


def load_executions(condition, db: Session) -> list[dict]:
    """Executions with their Samples, results, volumes, outputs and files, in a fixed number of queries."""
    executions = db.scalars(
        select(AssayExecution)
        .where(condition)
        .options(selectinload(AssayExecution.samples).selectinload(AssayExecutionSample.sample).selectinload(Sample.sample_type_ref))
        .order_by(AssayExecution.assay_date.desc().nulls_last(), AssayExecution.assay_execution_id.desc())
    ).all()
    ids = [execution.assay_execution_id for execution in executions]
    if not ids:
        return []
    volumes = {
        (event.related_assay_execution_id, event.sample_id): event
        for event in db.scalars(select(SampleQuantityEvent).where(SampleQuantityEvent.related_assay_execution_id.in_(ids))).all()
    }
    outputs: dict[int, list[Sample]] = {}
    for execution_id, sample in db.execute(
        select(AssayOutput.assay_execution_id, Sample)
        .join(Sample, Sample.sample_id == AssayOutput.sample_id)
        .where(AssayOutput.assay_execution_id.in_(ids))
        .options(selectinload(Sample.sample_type_ref))
        .order_by(Sample.sample_id)
    ).all():
        outputs.setdefault(execution_id, []).append(sample)
    files: dict[int, list[DataFile]] = {}
    for data_file in db.scalars(select(DataFile).where(DataFile.assay_execution_id.in_(ids)).order_by(DataFile.data_file_id)).all():
        files.setdefault(data_file.assay_execution_id, []).append(data_file)
    return [
        {
            **{key: getattr(execution, key) for key in ("assay_execution_id", "execution_name", "assay_definition_id", "operator_name", "assay_date", "status", "qc_status", "notes")},
            "samples": [_sample_row(row, volumes.get((execution.assay_execution_id, row.sample_id))) for row in execution.samples],
            "output_samples": outputs.get(execution.assay_execution_id, []),
            "data_files": files.get(execution.assay_execution_id, []),
        }
        for execution in executions
    ]


def field_error(field: str, message: str, status_code: int = 422) -> HTTPException:
    """An error the form can show next to the field it is about, in FastAPI's validation-error shape."""
    return HTTPException(status_code, [_error([field], message)])


def _error(loc: list, message: str) -> dict:
    return {"loc": ["body", *loc], "msg": message, "type": "value_error"}


def _sample_row(row: AssayExecutionSample, volume_event: SampleQuantityEvent | None) -> dict:
    return {
        "assay_execution_sample_id": row.assay_execution_sample_id,
        "sample": row.sample,
        "result_numeric": row.result_numeric,
        "result_text": row.result_text,
        "volume_used": -volume_event.quantity_change if volume_event else None,
        "volume_unit": volume_event.quantity_unit if volume_event else None,
    }


def _require_unique_name(definition_id: int, name: str, db: Session, execution_id: int | None = None) -> None:
    query = select(AssayExecution.assay_execution_id).where(AssayExecution.assay_definition_id == definition_id, AssayExecution.execution_name == name)
    if execution_id is not None:
        query = query.where(AssayExecution.assay_execution_id != execution_id)
    if db.scalar(query):
        raise field_error("execution_name", f"This assay already has an execution named {name}", 400)


def _execution_or_404(execution_id: int, db: Session) -> AssayExecution:
    execution = db.scalar(select(AssayExecution).where(AssayExecution.assay_execution_id == execution_id).options(
        selectinload(AssayExecution.samples), selectinload(AssayExecution.definition),
    ))
    if not execution:
        raise HTTPException(404, "Assay execution not found")
    return execution


def _execution_sample_or_404(execution_id: int, sample_id: int, db: Session) -> AssayExecutionSample:
    get_sample_or_404(sample_id, db)
    row = db.scalar(select(AssayExecutionSample).where(
        AssayExecutionSample.assay_execution_id == execution_id, AssayExecutionSample.sample_id == sample_id,
    ).options(selectinload(AssayExecutionSample.execution).selectinload(AssayExecution.definition), selectinload(AssayExecutionSample.sample)))
    if not row:
        raise HTTPException(404, "That sample is not in this execution")
    return row
