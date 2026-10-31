"""Assays: reusable procedures the lab performs on many Samples. Each execution lives in assay_executions."""
import re
from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..assay_import import WORKBOOK_TEMPLATE, read_assay_workbook
from ..database import get_db
from ..models import Assay, AssayDefinition, AssayDefinitionResult
from ..schemas import (
    AssayDefinitionCreate, AssayDefinitionDetail, AssayDefinitionImportPreview, AssayDefinitionListItem, AssayDefinitionUpdate, ExpectedResult,
)
from .assay_executions import executions_where, field_error

router = APIRouter(prefix="/assay-definitions", tags=["assays"])

MAX_WORKBOOK_BYTES = 2 * 1024 * 1024


@router.get("", response_model=list[AssayDefinitionListItem])
def list_assay_definitions(active_only: bool = False, db: Session = Depends(get_db)):
    query = select(AssayDefinition).options(selectinload(AssayDefinition.expected_results)).order_by(func.lower(AssayDefinition.assay_name), AssayDefinition.assay_definition_id)
    if active_only:
        query = query.where(AssayDefinition.is_active.is_(True))
    definitions = db.scalars(query).all()
    usage = _usage_by_definition(db)
    return [{**_definition_fields(definition), **usage.get(definition.assay_definition_id, {})} for definition in definitions]


@router.post("", response_model=AssayDefinitionDetail, status_code=status.HTTP_201_CREATED)
def create_assay_definition(payload: AssayDefinitionCreate, db: Session = Depends(get_db)):
    definition = add_definition(payload, db)
    db.commit()
    return get_assay_definition(definition.assay_definition_id, db)


@router.get("/import-template")
def download_import_template():
    """A workbook in the shape the import reads: an Assay sheet of fields and a Results sheet."""
    from openpyxl import Workbook

    workbook = Workbook()
    assay_sheet = workbook.active
    assay_sheet.title = "Assay"
    assay_sheet.append(["field", "value"])
    for field, example in WORKBOOK_TEMPLATE["Assay"]:
        assay_sheet.append([field, example])
    results_sheet = workbook.create_sheet("Results")
    for row in WORKBOOK_TEMPLATE["Results"]:
        results_sheet.append(row)
    for sheet in (assay_sheet, results_sheet):
        for column in ("A", "B", "C", "D"):
            sheet.column_dimensions[column].width = 28
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="assay-definition-template.xlsx"'},
    )


@router.post("/import/preview", response_model=AssayDefinitionImportPreview)
async def preview_assay_import(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Read and check a workbook without saving anything."""
    return _check_workbook(await _workbook_bytes(file), file.filename, db)


@router.post("/import", response_model=AssayDefinitionDetail, status_code=status.HTTP_201_CREATED)
async def import_assay_definition(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Create the assay from the confirmed workbook. The file is read and checked again, so what is saved is what the file says."""
    preview = _check_workbook(await _workbook_bytes(file), file.filename, db)
    if not preview["can_import"]:
        raise HTTPException(422, {"message": "The workbook cannot be imported", "problems": preview["problems"]})
    definition = add_definition(preview["definition"], db)
    definition.source_file_name = preview["source"]["file_name"]
    definition.source_sha256 = preview["source"]["sha256"]
    definition.imported_at = datetime.now(timezone.utc)
    db.commit()
    return get_assay_definition(definition.assay_definition_id, db)


@router.get("/{definition_id}", response_model=AssayDefinitionDetail)
def get_assay_definition(definition_id: int, db: Session = Depends(get_db)):
    definition = db.scalar(select(AssayDefinition).where(AssayDefinition.assay_definition_id == definition_id).options(selectinload(AssayDefinition.expected_results)))
    if not definition:
        raise HTTPException(404, "Assay not found")
    return {
        **_definition_fields(definition),
        **_usage_by_definition(db, definition_id).get(definition_id, {}),
        "description": definition.description,
        "source_file_name": definition.source_file_name,
        "source_sha256": definition.source_sha256,
        "imported_at": definition.imported_at,
        "created_at": definition.created_at,
        "executions": executions_where(Assay.assay_definition_id == definition_id, db),
    }


@router.patch("/{definition_id}", response_model=AssayDefinitionDetail)
def update_assay_definition(definition_id: int, payload: AssayDefinitionUpdate, db: Session = Depends(get_db)):
    definition = db.get(AssayDefinition, definition_id)
    if not definition:
        raise HTTPException(404, "Assay not found")
    data = payload.model_dump(exclude_unset=True)
    for required in ("assay_name", "assay_type"):
        if required in data and not data[required]:
            raise field_error(required, "This field is required")
    expected_results = data.pop("expected_results", None)
    for key, value in data.items():
        setattr(definition, key, value)
    if definition.typical_volume is not None and not definition.typical_volume_unit:
        raise field_error("typical_volume_unit", "Give the unit of the typical volume")
    _require_unique_name(definition.assay_name, definition.assay_type, db, definition_id)
    if expected_results is not None:
        definition.expected_results = _expected_result_rows([ExpectedResult(**row) for row in expected_results])
    db.commit()
    return get_assay_definition(definition_id, db)


def add_definition(payload: AssayDefinitionCreate, db: Session) -> AssayDefinition:
    _require_unique_name(payload.assay_name, payload.assay_type, db)
    code = payload.assay_code or _generated_code(payload.assay_name, db)
    if db.scalar(select(AssayDefinition.assay_definition_id).where(AssayDefinition.assay_code == code)):
        raise field_error("assay_code", f"Assay code already exists: {code}", 400)
    definition = AssayDefinition(
        assay_code=code,
        **payload.model_dump(exclude={"assay_code", "expected_results"}),
        expected_results=_expected_result_rows(payload.expected_results),
    )
    db.add(definition)
    db.flush()
    return definition


def _check_workbook(content: bytes, file_name: str | None, db: Session) -> dict:
    preview = read_assay_workbook(content, file_name or "workbook.xlsx")
    definition = preview["definition"]
    if definition is not None:
        if _same_name_exists(definition.assay_name, definition.assay_type, db):
            preview["problems"].append(f"Assay sheet: an assay named \"{definition.assay_name}\" ({definition.assay_type}) already exists")
        if definition.assay_code and db.scalar(select(AssayDefinition.assay_definition_id).where(AssayDefinition.assay_code == definition.assay_code)):
            preview["problems"].append(f"Assay sheet: assay code {definition.assay_code} already exists")
    preview["can_import"] = definition is not None and not preview["problems"]
    return preview


async def _workbook_bytes(file: UploadFile) -> bytes:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Upload an .xlsx workbook (macro-enabled .xlsm and older .xls files are not accepted)")
    content = await file.read(MAX_WORKBOOK_BYTES + 1)
    if len(content) > MAX_WORKBOOK_BYTES:
        raise HTTPException(413, "The workbook is larger than 2 MB")
    return content


def _expected_result_rows(results: list[ExpectedResult]) -> list[AssayDefinitionResult]:
    return [AssayDefinitionResult(**result.model_dump(), sort_order=index) for index, result in enumerate(results)]


def _same_name_exists(name: str, assay_type: str, db: Session, definition_id: int | None = None) -> bool:
    query = select(AssayDefinition.assay_definition_id).where(
        func.lower(AssayDefinition.assay_name) == name.lower(), func.lower(AssayDefinition.assay_type) == assay_type.lower(),
    )
    if definition_id is not None:
        query = query.where(AssayDefinition.assay_definition_id != definition_id)
    return db.scalar(query) is not None


def _require_unique_name(name: str, assay_type: str, db: Session, definition_id: int | None = None) -> None:
    if _same_name_exists(name, assay_type, db, definition_id):
        raise field_error("assay_name", f"An assay named \"{name}\" ({assay_type}) already exists", 400)


def _generated_code(name: str, db: Session) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").upper()[:90] or "ASSAY"
    code, suffix = base, 2
    while db.scalar(select(AssayDefinition.assay_definition_id).where(AssayDefinition.assay_code == code)):
        code, suffix = f"{base}-{suffix}", suffix + 1
    return code


def _definition_fields(definition: AssayDefinition) -> dict:
    return {
        key: getattr(definition, key)
        for key in ("assay_definition_id", "assay_code", "assay_name", "assay_type", "target", "kit", "instrument", "typical_volume", "typical_volume_unit", "is_active", "expected_results")
    }


def _usage_by_definition(db: Session, definition_id: int | None = None) -> dict[int, dict]:
    query = select(
        Assay.assay_definition_id, func.count(), func.count(func.distinct(Assay.sample_id)), func.max(Assay.assay_date),
    ).group_by(Assay.assay_definition_id)
    if definition_id is not None:
        query = query.where(Assay.assay_definition_id == definition_id)
    return {
        row[0]: {"execution_count": row[1], "sample_count": row[2], "last_performed": row[3]}
        for row in db.execute(query).all()
    }
