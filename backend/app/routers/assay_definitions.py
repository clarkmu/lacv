"""Assays: reusable procedures and their result fields. Each execution holds one or more Samples, each with one result set."""
import re
from decimal import Decimal
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..execution_import import read_execution_workbook, template_rows
from ..models import AssayDefinition, AssayDefinitionResult, AssayExecution, AssayExecutionSample
from ..schemas import (
    AssayDefinitionCreate, AssayDefinitionDetail, AssayDefinitionListItem, AssayDefinitionUpdate, AssayExecutionCreate, AssayExecutionDetail,
    ExecutionImportPreview,
)
from .assay_executions import create_execution, field_error, get_assay_execution, load_executions, next_execution_name

router = APIRouter(prefix="/assay-definitions", tags=["assays"])

MAX_WORKBOOK_BYTES = 2 * 1024 * 1024
DEFINITION_FIELDS = (
    "assay_definition_id", "assay_code", "assay_name", "assay_type", "target", "kit", "instrument", "typical_volume", "typical_volume_unit",
    "result_fields", "is_active",
)


@router.get("", response_model=list[AssayDefinitionListItem])
def list_assay_definitions(active_only: bool = False, db: Session = Depends(get_db)):
    query = select(AssayDefinition).options(selectinload(AssayDefinition.result_fields)).order_by(func.lower(AssayDefinition.assay_name), AssayDefinition.assay_definition_id)
    if active_only:
        query = query.where(AssayDefinition.is_active.is_(True))
    usage = _usage_by_definition(db)
    return [{**_definition_fields(definition), **usage.get(definition.assay_definition_id, {})} for definition in db.scalars(query).all()]


@router.post("", response_model=AssayDefinitionDetail, status_code=status.HTTP_201_CREATED)
def create_assay_definition(payload: AssayDefinitionCreate, db: Session = Depends(get_db)):
    _require_unique_name(payload.assay_name, payload.assay_type, db)
    code = payload.assay_code or _generated_code(payload.assay_name, db)
    if db.scalar(select(AssayDefinition.assay_definition_id).where(AssayDefinition.assay_code == code)):
        raise field_error("assay_code", f"Assay code already exists: {code}", 400)
    labels = [f"{field.analyte} {field.result_name}".strip().lower() if field.analyte else field.result_name.lower() for field in payload.result_fields]
    if len(labels) != len(set(labels)):
        raise field_error("result_fields", "Each result field needs a different analyte or name")
    definition = AssayDefinition(
        assay_code=code,
        **payload.model_dump(exclude={"assay_code", "result_fields"}),
        result_fields=[AssayDefinitionResult(**field.model_dump(), sort_order=index) for index, field in enumerate(payload.result_fields)],
    )
    db.add(definition)
    db.commit()
    return get_assay_definition(definition.assay_definition_id, db)


@router.get("/{definition_id}", response_model=AssayDefinitionDetail)
def get_assay_definition(definition_id: int, db: Session = Depends(get_db)):
    """The assay with every execution, each with its Samples and their results, and the mean of the numeric results."""
    definition = _definition_or_404(definition_id, db)
    executions = load_executions(AssayExecution.assay_definition_id == definition_id, db)
    return {
        **_definition_fields(definition),
        **_usage_by_definition(db, definition_id).get(definition_id, {}),
        "description": definition.description,
        "created_at": definition.created_at,
        "next_execution_name": next_execution_name(definition, db),
        "result_summaries": _result_summaries(definition, executions),
        "executions": executions,
    }


@router.patch("/{definition_id}", response_model=AssayDefinitionDetail)
def update_assay_definition(definition_id: int, payload: AssayDefinitionUpdate, db: Session = Depends(get_db)):
    definition = _definition_or_404(definition_id, db)
    data = payload.model_dump(exclude_unset=True)
    for required in ("assay_name", "assay_type"):
        if required in data and not data[required]:
            raise field_error(required, "This field is required")
    for key, value in data.items():
        setattr(definition, key, value)
    if definition.typical_volume is not None and not definition.typical_volume_unit:
        raise field_error("typical_volume_unit", "Give the unit of the typical volume")
    _require_unique_name(definition.assay_name, definition.assay_type, db, definition_id)
    db.commit()
    return get_assay_definition(definition_id, db)


@router.post("/{definition_id}/executions", response_model=AssayExecutionDetail, status_code=status.HTTP_201_CREATED)
def create_assay_execution(definition_id: int, payload: AssayExecutionCreate, db: Session = Depends(get_db)):
    """One execution with all its Samples, results and volumes used, saved together; any problem saves nothing."""
    execution = create_execution(_definition_or_404(definition_id, db), payload, db)
    db.commit()
    return get_assay_execution(execution.assay_execution_id, db)


@router.get("/{definition_id}/executions/import-template")
def download_execution_template(definition_id: int, db: Session = Depends(get_db)):
    """A workbook in the shape the execution import reads: a Samples sheet and an Execution sheet."""
    from openpyxl import Workbook
    from openpyxl.utils import get_column_letter

    definition = _definition_or_404(definition_id, db)
    workbook = Workbook()
    workbook.remove(workbook.active)
    for title, rows in template_rows(definition).items():
        sheet = workbook.create_sheet(title)
        for row in rows:
            sheet.append(row)
        for index in range(1, sheet.max_column + 1):
            sheet.column_dimensions[get_column_letter(index)].width = 24
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    file_name = re.sub(r"[^A-Za-z0-9-]+", "-", definition.assay_code).lower()
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{file_name}-execution.xlsx"'},
    )


@router.post("/{definition_id}/executions/import/preview", response_model=ExecutionImportPreview)
async def preview_execution_import(definition_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Read and check a workbook against this assay without saving anything. The rows are then saved as a new execution."""
    definition = _definition_or_404(definition_id, db)
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Upload an .xlsx workbook (macro-enabled .xlsm and older .xls files are not accepted)")
    content = await file.read(MAX_WORKBOOK_BYTES + 1)
    if len(content) > MAX_WORKBOOK_BYTES:
        raise HTTPException(413, "The workbook is larger than 2 MB")
    return read_execution_workbook(content, file.filename, definition, db)


def _result_summaries(definition: AssayDefinition, executions: list[dict]) -> list[dict]:
    """Per result field: the mean of its numeric values; blanks and text are counted, never averaged; text fields have no mean."""
    rows = [row for execution in executions for row in execution["samples"]]
    summaries = []
    for field in definition.result_fields:
        values = [result for row in rows for result in row["results"] if result.assay_definition_result_id == field.assay_definition_result_id]
        numeric = [result.numeric_value for result in values if result.numeric_value is not None]
        text_count = sum(1 for result in values if result.text_value is not None)
        averageable = field.value_type != "text"
        summaries.append({
            "assay_definition_result_id": field.assay_definition_result_id,
            "label": field.label,
            "unit": field.unit,
            "mean": sum(numeric, Decimal(0)) / len(numeric) if numeric and averageable else None,
            "numeric_count": len(numeric),
            "text_count": text_count,
            "empty_count": len(rows) - len(numeric) - text_count,
            "averageable": averageable,
        })
    return summaries


def _usage_by_definition(db: Session, definition_id: int | None = None) -> dict[int, dict]:
    """Executions (not Sample rows), distinct Samples, and the latest execution date, per assay."""
    executions = select(
        AssayExecution.assay_definition_id, func.count().label("execution_count"), func.max(AssayExecution.assay_date).label("last_performed"),
    ).group_by(AssayExecution.assay_definition_id)
    samples = (
        select(AssayExecution.assay_definition_id, func.count(func.distinct(AssayExecutionSample.sample_id)))
        .join(AssayExecutionSample, AssayExecutionSample.assay_execution_id == AssayExecution.assay_execution_id)
        .group_by(AssayExecution.assay_definition_id)
    )
    if definition_id is not None:
        executions = executions.where(AssayExecution.assay_definition_id == definition_id)
        samples = samples.where(AssayExecution.assay_definition_id == definition_id)
    sample_counts = dict(db.execute(samples).all())
    return {
        row.assay_definition_id: {"execution_count": row.execution_count, "sample_count": sample_counts.get(row.assay_definition_id, 0), "last_performed": row.last_performed}
        for row in db.execute(executions).all()
    }


def _definition_fields(definition: AssayDefinition) -> dict:
    return {key: getattr(definition, key) for key in DEFINITION_FIELDS}


def _definition_or_404(definition_id: int, db: Session) -> AssayDefinition:
    definition = db.get(AssayDefinition, definition_id)
    if not definition:
        raise HTTPException(404, "Assay not found")
    return definition


def _require_unique_name(name: str, assay_type: str, db: Session, definition_id: int | None = None) -> None:
    query = select(AssayDefinition.assay_definition_id).where(
        func.lower(AssayDefinition.assay_name) == name.lower(), func.lower(AssayDefinition.assay_type) == assay_type.lower(),
    )
    if definition_id is not None:
        query = query.where(AssayDefinition.assay_definition_id != definition_id)
    if db.scalar(query) is not None:
        raise field_error("assay_name", f"An assay named \"{name}\" ({assay_type}) already exists", 400)


def _generated_code(name: str, db: Session) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper()[:90] or "ASSAY"
    code, suffix = base, 2
    while db.scalar(select(AssayDefinition.assay_definition_id).where(AssayDefinition.assay_code == code)):
        code, suffix = f"{base}-{suffix}", suffix + 1
    return code
