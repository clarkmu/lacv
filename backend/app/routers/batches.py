from io import BytesIO
import re
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Batch, Sample
from ..schemas import BatchDetail, BatchBrief, BatchSampleImportCreate, BatchSampleImportPreview, BatchSampleImportRow

router = APIRouter(prefix="/batches", tags=["batches"])

SAMPLE_BATCH_COLUMNS = [
    "sample_code",
    "parent_sample_id",
    "external_sample_id",
    "sample_type",
    "source_type",
    "source_description",
    "collection_date",
    "received_date",
    "status",
    "notes",
]

@router.get("", response_model=list[BatchBrief])
def list_batches(db: Session = Depends(get_db)):
    return db.scalars(select(Batch).order_by(Batch.batch_id.desc())).all()

@router.get("/sample-template")
def download_sample_batch_template():
    from openpyxl import Workbook

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Samples"
    sheet.append(SAMPLE_BATCH_COLUMNS)
    for column_index, column_name in enumerate(SAMPLE_BATCH_COLUMNS, start=1):
        sheet.cell(row=1, column=column_index).value = column_name
        sheet.column_dimensions[sheet.cell(row=1, column=column_index).column_letter].width = max(len(column_name) + 2, 18)
    output = BytesIO()
    workbook.save(output)
    output.seek(0)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="sample-batch-template.xlsx"'},
    )

@router.post("/sample-import/preview", response_model=BatchSampleImportPreview)
async def preview_sample_batch_import(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Upload an .xlsx file")
    samples = _read_sample_rows(BytesIO(await file.read()))
    return {"samples": samples}

@router.post("/sample-import", response_model=BatchDetail)
def create_sample_batch(payload: BatchSampleImportCreate, db: Session = Depends(get_db)):
    batch_name = payload.batch_name.strip()
    if not batch_name:
        raise HTTPException(400, "Batch name is required")
    if not payload.samples:
        raise HTTPException(400, "At least one sample is required")

    batch = Batch(batch_code=_next_batch_code(batch_name, db), batch_name=batch_name)
    db.add(batch)
    db.flush()

    seen_codes = set()
    for row in payload.samples:
        sample_code = row.sample_code.strip()
        if not sample_code:
            raise HTTPException(400, "Every sample row must include sample_code")
        if sample_code in seen_codes:
            raise HTTPException(400, f"Duplicate sample_code in upload: {sample_code}")
        seen_codes.add(sample_code)
        if db.scalar(select(Sample.sample_id).where(Sample.sample_code == sample_code)):
            raise HTTPException(400, f"Sample already exists: {sample_code}")
        if row.parent_sample_id is not None and not db.get(Sample, row.parent_sample_id):
            raise HTTPException(404, f"Parent sample not found: {row.parent_sample_id}")
        sample_data = row.model_dump()
        sample_data["sample_code"] = sample_code
        db.add(Sample(batch_id=batch.batch_id, **sample_data))

    db.commit()
    return get_batch(batch.batch_id, db)

@router.post("/import", response_model=list[BatchBrief])
async def import_batches(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Upload an .xlsx file")
    try:
        from openpyxl import load_workbook
        workbook = load_workbook(BytesIO(await file.read()), read_only=True, data_only=True)
        rows = workbook.active.iter_rows(values_only=True)
        headers = [str(value).strip().lower() if value is not None else "" for value in next(rows)]
        required = {"batch_code", "batch_name"}
        if not required.issubset(headers):
            raise HTTPException(400, "The spreadsheet must include batch_code and batch_name columns")
        created = []
        for values in rows:
            data = dict(zip(headers, values))
            if not data.get("batch_code") or not data.get("batch_name"):
                continue
            batch = Batch(batch_code=str(data["batch_code"]), batch_name=str(data["batch_name"]), description=data.get("description"))
            db.add(batch)
            created.append(batch)
        db.commit()
        for batch in created:
            db.refresh(batch)
        return created
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(400, f"Could not import spreadsheet: {exc}") from exc

@router.get("/{batch_id}", response_model=BatchDetail)
def get_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.scalar(select(Batch).where(Batch.batch_id == batch_id).options(selectinload(Batch.samples)))
    if not batch:
        raise HTTPException(404, "Batch not found")
    return batch

def _read_sample_rows(file_data: BytesIO) -> list[BatchSampleImportRow]:
    try:
        from openpyxl import load_workbook
        workbook = load_workbook(file_data, read_only=True, data_only=True)
        rows = workbook.active.iter_rows(values_only=True)
        headers = [str(value).strip().lower() if value is not None else "" for value in next(rows)]
    except StopIteration:
        raise HTTPException(400, "The spreadsheet is empty")
    except Exception as exc:
        raise HTTPException(400, f"Could not read spreadsheet: {exc}") from exc

    if "sample_code" not in headers:
        raise HTTPException(400, "The spreadsheet must include a sample_code column")

    samples = []
    for values in rows:
        data = {header: _clean_cell_value(value) for header, value in zip(headers, values) if header in SAMPLE_BATCH_COLUMNS}
        if not any(value not in (None, "") for value in data.values()):
            continue
        if not data.get("sample_code"):
            raise HTTPException(400, "Every non-empty row must include sample_code")
        data["status"] = data.get("status") or "expected"
        samples.append(BatchSampleImportRow(**data))
    return samples

def _clean_cell_value(value):
    if isinstance(value, str):
        return value.strip() or None
    return value

def _next_batch_code(batch_name: str, db: Session) -> str:
    base = re.sub(r"[^a-zA-Z0-9]+", "-", batch_name.strip()).strip("-").upper()[:32] or "BATCH"
    date_part = datetime.utcnow().strftime("%Y%m%d")
    candidate = f"{base}-{date_part}"
    suffix = 2
    while db.scalar(select(Batch.batch_id).where(Batch.batch_code == candidate)):
        candidate = f"{base}-{date_part}-{suffix}"
        suffix += 1
    return candidate
