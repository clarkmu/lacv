"""Reading one execution of an assay from an .xlsx workbook, without saving anything.

The workbook contract, also served as a template at
GET /api/assay-definitions/{id}/executions/import-template:

- Sheet "Samples" (required): a header row, then one row per Sample.
  Columns: sample_code (required; a Sample code or a legacy Material code),
  result (optional; a number such as 31.2 or text such as "not detected"),
  volume_used and volume_unit (optional; deducted from the Sample when saved).
- Sheet "Execution" (optional): one field per row, the field name in column A
  and its value in column B. Fields: execution_name (generated when blank),
  assay_date, operator_name, notes.

Other sheets are ignored. Cells are read as stored values: a cell holding a
formula is refused rather than calculated, and macros are never read.
"""
import hashlib
import zipfile
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import AssayDefinition, LegacyMaterialRecord, Sample

SAMPLE_COLUMNS = ["sample_code", "result", "volume_used", "volume_unit"]
EXECUTION_FIELDS = ["execution_name", "assay_date", "operator_name", "notes"]
MAX_ROWS = 2000


def template_rows(definition: AssayDefinition) -> dict[str, list[list]]:
    result_hint = f"{definition.result_name or 'result'}{f' ({definition.result_unit})' if definition.result_unit else ''}"
    return {
        # Header only: one row per Sample goes below it.
        "Samples": [SAMPLE_COLUMNS],
        "Execution": [
            ["field", "value"],
            ["execution_name", ""],
            ["assay_date", datetime.now().replace(second=0, microsecond=0)],
            ["operator_name", ""],
            ["notes", f"{definition.assay_name}; result column: {result_hint}, blank if not yet known"],
        ],
    }


def read_execution_workbook(content: bytes, file_name: str, definition: AssayDefinition, db: Session) -> dict:
    """The execution a workbook describes and every problem found in it, each naming its sheet and row."""
    from .routers.assay_executions import parse_result

    source = {"file_name": file_name, "sha256": hashlib.sha256(content).hexdigest(), "sheets": []}
    problems: list[str] = []
    try:
        from openpyxl import load_workbook

        # read_only streams the sheets; data_only=False keeps formulas visible so they can be refused.
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_vba=False)
    except (zipfile.BadZipFile, KeyError, ValueError, OSError) as error:
        return _preview(source, None, [], [f"The file is not a readable .xlsx workbook ({error.__class__.__name__})"])
    try:
        source["sheets"] = list(workbook.sheetnames)
        sheets = {name.strip().lower(): workbook[name] for name in workbook.sheetnames}
        if "samples" not in sheets:
            found = ", ".join(workbook.sheetnames) or "none"
            return _preview(source, None, [], [f"The workbook needs a sheet named \"Samples\" (sheets found: {found})"])
        rows = _read_samples_sheet(sheets["samples"], problems)
        execution = _read_execution_sheet(sheets["execution"], problems) if "execution" in sheets else {}
    finally:
        workbook.close()

    _resolve_samples(rows, db)
    seen: dict[int, int] = {}
    for row in rows:
        sample = row["sample"]
        if row["sample_code"] and sample is None:
            row["problems"].append(f"No sample or legacy material code matches {row['sample_code']}")
        if sample is not None:
            if sample.sample_id in seen:
                row["problems"].append(f"{sample.sample_code} is already on row {seen[sample.sample_id]}; a sample appears once in an execution")
            else:
                seen[sample.sample_id] = row["row_number"]
        try:
            parse_result(row["result"], definition)
        except ValueError as error:
            row["problems"].append(str(error))
        problems.extend(f"Samples sheet, row {row['row_number']}: {problem}" for problem in row["problems"])
    if not rows and not any(problem.startswith("Samples sheet") for problem in problems):
        problems.append("Samples sheet: no sample rows")
    return _preview(source, execution, rows, problems)


def _preview(source: dict, execution: dict | None, rows: list[dict], problems: list[str]) -> dict:
    return {"source": source, "execution": execution, "rows": rows, "problems": problems, "can_import": not problems and bool(rows)}


def _read_samples_sheet(sheet, problems: list[str]) -> list[dict]:
    table = _rows(sheet, problems, "Samples")
    if not table:
        return []
    header_number, header = table[0]
    columns = [_header(value) for value in header]
    unknown = [str(value) for value, column in zip(header, columns) if column and column not in SAMPLE_COLUMNS]
    if unknown:
        problems.append(f"Samples sheet, row {header_number}: unknown column {', '.join(unknown)} (expected {', '.join(SAMPLE_COLUMNS)})")
    if "sample_code" not in columns:
        problems.append(f"Samples sheet, row {header_number}: the header row needs a sample_code column")
        return []
    rows = []
    for row_number, values in table[1:]:
        data = {column: value for column, value in zip(columns, values) if column in SAMPLE_COLUMNS}
        row = {"row_number": row_number, "sample_code": _text(data.get("sample_code")), "sample": None, "result": _text(data.get("result")),
               "volume_used": None, "volume_unit": _text(data.get("volume_unit")), "problems": []}
        if not row["sample_code"]:
            row["problems"].append("sample_code is required")
        volume = data.get("volume_used")
        if volume not in (None, ""):
            try:
                amount = Decimal(str(volume))
                if amount <= 0:
                    raise InvalidOperation
                row["volume_used"] = amount
            except InvalidOperation:
                row["problems"].append(f"volume_used must be a positive number, not \"{volume}\"")
        rows.append(row)
    return rows


def _read_execution_sheet(sheet, problems: list[str]) -> dict:
    fields: dict = {}
    for row_number, values in _rows(sheet, problems, "Execution"):
        name = _header(values[0] if values else None)
        value = values[1] if len(values) > 1 else None
        if not name or (row_number == 1 and name == "field"):
            continue
        if name not in EXECUTION_FIELDS:
            problems.append(f"Execution sheet, row {row_number}: unknown field \"{values[0]}\" (expected one of {', '.join(EXECUTION_FIELDS)})")
        elif name in fields:
            problems.append(f"Execution sheet, row {row_number}: {name} is given more than once")
        elif name == "assay_date":
            parsed = _date_time(value)
            if value not in (None, "") and parsed is None:
                problems.append(f"Execution sheet, row {row_number}: assay_date must be a date (e.g. 2026-11-03 14:05), not \"{value}\"")
            fields[name] = parsed
        else:
            fields[name] = _text(value)
            if name == "execution_name" and fields[name] and len(fields[name]) > 100:
                problems.append(f"Execution sheet, row {row_number}: execution_name is longer than 100 characters")
    return fields


def _resolve_samples(rows: list[dict], db: Session) -> None:
    """Match codes to Samples, by sample code first and then by legacy Material code, in two queries."""
    codes = {row["sample_code"] for row in rows if row["sample_code"]}
    if not codes:
        return
    by_code = {sample.sample_code: sample for sample in db.scalars(select(Sample).where(Sample.sample_code.in_(codes)).options(selectinload(Sample.sample_type_ref))).all()}
    missing = codes - by_code.keys()
    if missing:
        for record in db.scalars(select(LegacyMaterialRecord).where(LegacyMaterialRecord.material_code.in_(missing)).options(
            selectinload(LegacyMaterialRecord.sample).selectinload(Sample.sample_type_ref),
        )).all():
            by_code[record.material_code] = record.sample
    for row in rows:
        row["sample"] = by_code.get(row["sample_code"])


def _rows(sheet, problems: list[str], sheet_label: str) -> list[tuple[int, list]]:
    """Non-empty rows with their 1-based row numbers. Formula cells are reported, never evaluated."""
    rows = []
    for row_number, cells in enumerate(sheet.iter_rows(), start=1):
        if row_number > MAX_ROWS:
            problems.append(f"{sheet_label} sheet: more than {MAX_ROWS} rows")
            break
        values = []
        for cell in cells:
            if getattr(cell, "data_type", None) == "f":
                problems.append(f"{sheet_label} sheet, cell {cell.coordinate}: contains a formula; enter the value itself")
                values.append(None)
            else:
                values.append(cell.value.strip() if isinstance(cell.value, str) else cell.value)
        if any(value not in (None, "") for value in values):
            rows.append((row_number, values))
    return rows


def _header(value) -> str:
    return "_".join(str(value).strip().lower().split()) if value not in (None, "") else ""


def _text(value) -> str | None:
    if value in (None, ""):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip() or None


def _date_time(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day)
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value.strip().replace(" ", "T", 1))
        except ValueError:
            return None
    return None
