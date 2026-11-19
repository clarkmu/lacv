import logging
import re
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased, selectinload

from ..batch_import import COLUMNS, MAX_WORKBOOK_BYTES, column_docs, parse_row, read_batch_workbook, sample_type_lookup, validate_rows
from ..database import get_db
from ..models import Batch, Sample, SampleType, StorageLocation
from ..sample_rules import apply_sample_changes
from ..schemas import BatchBrief, BatchDetail, BatchListItem, BatchSampleImportCreate, BatchSampleImportPreview, BatchSamplesUpdate, TemplateDoc
from ..spreadsheet import XLSX_MEDIA_TYPE, template_workbook

router = APIRouter(prefix="/batches", tags=["batches"])
logger = logging.getLogger("lacv")

@router.get("", response_model=list[BatchListItem])
def list_batches(db: Session = Depends(get_db)):
    counts = dict(db.execute(select(Sample.batch_id, func.count()).where(Sample.batch_id.is_not(None)).group_by(Sample.batch_id)).all())
    return [
        {**{key: getattr(batch, key) for key in ("batch_id", "batch_code", "batch_name", "description", "is_active")}, "sample_count": counts.get(batch.batch_id, 0)}
        for batch in db.scalars(select(Batch).order_by(Batch.batch_id.desc())).all()
    ]

@router.get("/sample-template")
def download_sample_batch_template():
    """The batch workbook: a Samples sheet whose header row is app/batch_import.COLUMNS (required columns marked *)."""
    return Response(
        template_workbook({"Samples": (COLUMNS, [])}),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="sample-batch-template.xlsx"'},
    )

@router.get("/sample-template/columns", response_model=TemplateDoc)
def describe_sample_batch_template(db: Session = Depends(get_db)):
    """What each column of the batch template means, from the same column list the importer reads."""
    return column_docs(db)

@router.post("/sample-import/preview", response_model=BatchSampleImportPreview)
async def preview_sample_batch_import(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Read a batch workbook and check every row, without saving anything."""
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(400, "Choose an Excel workbook ending in .xlsx (start from the template). Older .xls, .xlsm and .csv files are not accepted; open them in Excel and save as \"Excel Workbook (.xlsx)\".")
    content = await file.read(MAX_WORKBOOK_BYTES + 1)
    if len(content) > MAX_WORKBOOK_BYTES:
        raise HTTPException(413, "The workbook is larger than 2 MB. Remove other sheets or images, or split the batch into several files.")
    return read_batch_workbook(content, file.filename, db)

@router.post("/sample-import", response_model=BatchDetail)
def create_sample_batch(payload: BatchSampleImportCreate, db: Session = Depends(get_db)):
    """A shipping batch of root Samples, all saved or none. Derived Samples are created later from their parents, not imported.

    Every row is checked as in the preview; problems come back in FastAPI's validation shape, located at
    samples.<index>.<column>, so the confirm page can mark each cell.
    """
    rows = [row.model_dump() for row in payload.samples]
    problems = validate_rows(rows, db)
    if problems:
        raise HTTPException(422, [
            {"loc": ["body", "samples", index, problem["column"]], "msg": problem["message"], "type": "value_error"}
            for index, row_problems in sorted(problems.items()) for problem in row_problems
        ])

    type_ids = sample_type_lookup(db)
    batch = Batch(batch_code=_next_batch_code(payload.batch_name, db), batch_name=payload.batch_name)
    db.add(batch)
    db.flush()
    for row in rows:
        values = parse_row(row, lambda *_: None)
        sample_type = values.pop("sample_type", None)
        values["status"] = values.get("status") or "expected"
        db.add(Sample(batch_id=batch.batch_id, sample_type_id=type_ids.get(sample_type.strip().lower()) if sample_type else None, **values))
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
        logger.warning("Batch list import of %r failed", file.filename, exc_info=True)
        raise HTTPException(400, "The spreadsheet could not be imported. Check that it is an .xlsx workbook whose first sheet has batch_code and batch_name columns.") from exc

@router.get("/{batch_id}", response_model=BatchDetail)
def get_batch(batch_id: int, db: Session = Depends(get_db)):
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")
    child = aliased(Sample)
    child_counts = (
        select(child.parent_sample_id, func.count().label("child_count")).group_by(child.parent_sample_id).subquery()
    )
    rows = db.execute(
        select(Sample, StorageLocation.location_code, child_counts.c.child_count)
        .outerjoin(StorageLocation, StorageLocation.storage_location_id == Sample.storage_location_id)
        .outerjoin(child_counts, child_counts.c.parent_sample_id == Sample.sample_id)
        .where(Sample.batch_id == batch_id)
        .options(selectinload(Sample.sample_type_ref))
        .order_by(Sample.sample_code)
    ).all()
    return {
        **{key: getattr(batch, key) for key in ("batch_id", "batch_code", "batch_name", "description", "is_active")},
        "samples": [_batch_sample_row(sample, location_code, child_count or 0) for sample, location_code, child_count in rows],
    }


@router.patch("/{batch_id}/samples", response_model=BatchDetail)
def update_batch_samples(batch_id: int, payload: BatchSamplesUpdate, db: Session = Depends(get_db)):
    """Edit several root Samples of a Batch at once. Every change is checked first; if any is refused, nothing is saved."""
    if not db.get(Batch, batch_id):
        raise HTTPException(404, "Batch not found")
    members = {sample.sample_id: sample for sample in db.scalars(select(Sample).where(Sample.batch_id == batch_id)).all()}
    errors: list[dict] = []
    planned: list[tuple[Sample, dict]] = []
    seen: set[int] = set()
    for index, change in enumerate(payload.changes):
        data = change.model_dump(exclude_unset=True)
        sample_id = data.pop("sample_id")
        sample = members.get(sample_id)
        if sample is None or sample_id in seen:
            errors.append(_change_error(index, "sample_id", f"Sample {sample_id} is not in this batch" if sample is None else f"Sample {sample.sample_code} is changed twice"))
            continue
        seen.add(sample_id)
        errors.extend(_reference_errors(index, data, db))
        planned.append((sample, data))
    errors.extend(_aliquot_conflicts(members, planned, payload.changes))
    if errors:
        raise HTTPException(422, errors)
    for sample, data in planned:
        apply_sample_changes(sample, data, db, payload.operator_name, payload.change_notes)
    db.commit()
    return get_batch(batch_id, db)


def _batch_sample_row(sample: Sample, location_code: str | None, child_count: int) -> dict:
    return {
        **{key: getattr(sample, key) for key in (
            "sample_id", "sample_code", "subject_code", "external_sample_id", "sample_type_id", "aliquot_number", "collection_date",
            "received_date", "status", "current_quantity", "quantity_unit", "storage_location_id",
        )},
        "sample_type": sample.sample_type,
        "storage_location_code": location_code,
        "child_count": child_count,
    }


def _change_error(index: int, field: str, message: str) -> dict:
    return {"loc": ["body", "changes", index, field], "msg": message, "type": "value_error"}


def _reference_errors(index: int, data: dict, db: Session) -> list[dict]:
    errors = []
    if "status" in data and not data["status"]:
        errors.append(_change_error(index, "status", "Status cannot be blank"))
    if data.get("sample_type_id") is not None and not db.get(SampleType, data["sample_type_id"]):
        errors.append(_change_error(index, "sample_type_id", f"Sample type not found: {data['sample_type_id']}"))
    if data.get("storage_location_id") is not None and not db.get(StorageLocation, data["storage_location_id"]):
        errors.append(_change_error(index, "storage_location_id", f"Storage location not found: {data['storage_location_id']}"))
    return errors


def _aliquot_conflicts(members: dict[int, Sample], planned: list[tuple[Sample, dict]], changes) -> list[dict]:
    """Aliquot numbers tell apart the tubes of one subject's collection of one Material, so two such tubes cannot share a number.

    Checked on the Batch as it would be after the changes. Tubes without a subject or an aliquot number are not compared.
    """
    change_index = {sample.sample_id: index for index, (sample, _) in enumerate(planned)}
    planned_data = {sample.sample_id: data for sample, data in planned}
    holders: dict[tuple, list[Sample]] = {}
    for sample in sorted(members.values(), key=lambda member: member.sample_code):
        final = {**{key: getattr(sample, key) for key in ("subject_code", "sample_type_id", "collection_date", "aliquot_number")}, **planned_data.get(sample.sample_id, {})}
        if not final["subject_code"] or final["aliquot_number"] is None:
            continue
        collected = final["collection_date"].date() if final["collection_date"] else None
        key = (final["subject_code"].lower(), final["sample_type_id"], collected, final["aliquot_number"])
        holders.setdefault(key, []).append(sample)
    errors = []
    for (_, _, collected, number), samples in holders.items():
        if len(samples) < 2:
            continue
        for sample in samples:
            if sample.sample_id not in change_index:
                continue
            others = ", ".join(other.sample_code for other in samples if other is not sample)
            index = next(i for i, change in enumerate(changes) if change.sample_id == sample.sample_id)
            when = f" collected {collected.isoformat()}" if collected else ""
            errors.append(_change_error(index, "aliquot_number", f"Aliquot {number} is also {others}: same subject and Material{when}"))
    return errors


def _next_batch_code(batch_name: str, db: Session) -> str:
    base = re.sub(r"[^a-zA-Z0-9]+", "-", batch_name.strip()).strip("-").upper()[:32] or "BATCH"
    date_part = datetime.utcnow().strftime("%Y%m%d")
    candidate = f"{base}-{date_part}"
    suffix = 2
    while db.scalar(select(Batch.batch_id).where(Batch.batch_code == candidate)):
        candidate = f"{base}-{date_part}-{suffix}"
        suffix += 1
    return candidate
