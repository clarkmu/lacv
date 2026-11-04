"""Reading one execution of an assay from an .xlsx workbook, without saving anything.

The workbook contract, also served as a template at
GET /api/assay-definitions/{id}/executions/import-template:

- Sheet "Samples" (required): a header row, then one row per Sample.
  Columns: sample_code (required; a Sample code or a legacy Material code);
  for each of the assay's result fields, a column named after it (for
  example "LACV CT": a number such as 31.2 or text such as "not detected"),
  optionally "<field> interpretation" and "<field> qc_status"; and
  volume_used and volume_unit (deducted from the Sample when saved).
  Every result column is optional and may be blank: a workbook of sample
  codes alone creates an execution whose assay has not been done yet.
- Sheet "Execution" (optional): one field per row, the field name in column A
  and its value in column B. Fields: execution_name (generated when blank),
  assay_date, operator_name, notes.

Other sheets are ignored. Cells are read as stored values: a cell holding a
formula is refused rather than calculated, and macros are never read.

Each row's sample_code is matched to a Sample:
- exact: it equals a Sample code, or failing that a legacy Material code;
- close: no exact match, but candidates were found (the same code apart from
  case, spaces or punctuation; a Sample whose external ID it equals; or a
  similar code). None is chosen: the user confirms one;
- none: no candidates; the user finds the Sample.
Problems with the file itself block the import. Problems with a row (no
match, a repeated Sample, an invalid value) are reported on the row for the
user to fix before the rows join the new execution, where saving checks
everything again.
"""
import difflib
import hashlib
import re
import zipfile
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from io import BytesIO

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import AssayDefinition, LegacyMaterialRecord, Sample

BASE_COLUMNS = ["sample_code", "volume_used", "volume_unit"]
EXECUTION_FIELDS = ["execution_name", "assay_date", "operator_name", "notes"]
MAX_ROWS = 2000
MAX_CANDIDATES = 5
# How alike two codes must be (0-1, difflib ratio) to be offered as a close match.
SIMILARITY_CUTOFF = 0.8


def template_rows(definition: AssayDefinition) -> dict[str, list[list]]:
    result_columns = [column for field in definition.result_fields for column in (field.label, f"{field.label} interpretation")]
    result_hint = ", ".join(f"{field.label}{f' ({field.unit})' if field.unit else ''}" for field in definition.result_fields) or "none"
    return {
        # Header only: one row per Sample goes below it.
        "Samples": [["sample_code", *result_columns, "volume_used", "volume_unit"]],
        "Execution": [
            ["field", "value"],
            ["execution_name", ""],
            ["assay_date", datetime.now().replace(second=0, microsecond=0)],
            ["operator_name", ""],
            ["notes", f"{definition.assay_name}; result columns: {result_hint}; leave them blank if the assay has not been done yet"],
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
        rows = _read_samples_sheet(sheets["samples"], problems, definition)
        execution = _read_execution_sheet(sheets["execution"], problems) if "execution" in sheets else {}
    finally:
        workbook.close()

    _resolve_samples(rows, db)
    _suggest_close_matches([row for row in rows if row["sample"] is None and row["sample_code"]], db)
    seen: dict[int, int] = {}
    for row in rows:
        sample = row["sample"]
        row["match"] = "exact" if sample is not None else ("close" if row["candidates"] else "none")
        if sample is not None:
            if sample.sample_id in seen:
                row["duplicate_of_row"] = seen[sample.sample_id]
            else:
                seen[sample.sample_id] = row["row_number"]
        fields = {field.assay_definition_result_id: field for field in definition.result_fields}
        for result in row["results"]:
            try:
                parse_result(result["value"], fields[result["assay_definition_result_id"]])
            except ValueError as error:
                row["problems"].append(str(error))
    if not rows and not any(problem.startswith("Samples sheet") for problem in problems):
        problems.append("Samples sheet: no sample rows")
    return _preview(source, execution, rows, problems)


def _preview(source: dict, execution: dict | None, rows: list[dict], problems: list[str]) -> dict:
    return {"source": source, "execution": execution, "rows": rows, "problems": problems, "can_import": not problems and bool(rows)}


def _result_columns(definition: AssayDefinition) -> dict[str, tuple[int, str]]:
    """Header (normalized) -> (result field id, part) for each field's value, interpretation and QC columns."""
    columns = {}
    for field in definition.result_fields:
        name = _header(field.label)
        columns[name] = (field.assay_definition_result_id, "value")
        columns[f"{name}_interpretation"] = (field.assay_definition_result_id, "interpretation")
        columns[f"{name}_qc_status"] = (field.assay_definition_result_id, "qc_status")
        columns[f"{name}_qc"] = (field.assay_definition_result_id, "qc_status")
    return columns


def _read_samples_sheet(sheet, problems: list[str], definition: AssayDefinition) -> list[dict]:
    table = _rows(sheet, problems, "Samples")
    if not table:
        return []
    header_number, header = table[0]
    columns = [_header(value) for value in header]
    result_columns = _result_columns(definition)
    known = set(BASE_COLUMNS) | result_columns.keys()
    unknown = [str(value) for value, column in zip(header, columns) if column and column not in known]
    if unknown:
        expected = ", ".join(["sample_code", *(field.label for field in definition.result_fields), "volume_used", "volume_unit"])
        problems.append(f"Samples sheet, row {header_number}: unknown column {', '.join(unknown)} (expected {expected}, and optional \"<field> interpretation\" columns)")
    if "sample_code" not in columns:
        problems.append(f"Samples sheet, row {header_number}: the header row needs a sample_code column")
        return []
    rows = []
    for row_number, values in table[1:]:
        data = {column: value for column, value in zip(columns, values) if column in known}
        results: dict[int, dict] = {}
        for column, value in data.items():
            if column in result_columns and _text(value) is not None:
                field_id, part = result_columns[column]
                results.setdefault(field_id, {"assay_definition_result_id": field_id, "value": None, "interpretation": None, "qc_status": None})[part] = _text(value)
        row = {"row_number": row_number, "sample_code": _text(data.get("sample_code")), "sample": None, "candidates": [], "duplicate_of_row": None, "results": list(results.values()),
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


def _suggest_close_matches(rows: list[dict], db: Session) -> None:
    """Candidates for codes with no exact match, best first; the user chooses, nothing is picked here."""
    if not rows:
        return
    samples = db.scalars(select(Sample).options(selectinload(Sample.sample_type_ref), selectinload(Sample.legacy_material_records))).all()
    by_key: dict[str, list[Sample]] = {}
    by_external: dict[str, list[Sample]] = {}
    for sample in samples:
        for code in (sample.sample_code, *sample.legacy_codes):
            by_key.setdefault(_key(code), []).append(sample)
        if sample.external_sample_id:
            by_external.setdefault(sample.external_sample_id.strip().lower(), []).append(sample)
    keys = list(by_key)
    for row in rows:
        code = row["sample_code"]
        candidates: dict[int, dict] = {}

        def offer(found: list[Sample], reason: str) -> None:
            for sample in found:
                candidates.setdefault(sample.sample_id, {"sample": sample, "reason": reason})

        offer(by_key.get(_key(code), []), "same code apart from case, spaces or punctuation")
        offer(by_external.get(code.strip().lower(), []), "matches the external ID")
        for similar in difflib.get_close_matches(_key(code), keys, n=MAX_CANDIDATES, cutoff=SIMILARITY_CUTOFF):
            offer(by_key[similar], "similar code")
        row["candidates"] = list(candidates.values())[:MAX_CANDIDATES]


def _key(code: str) -> str:
    """A code reduced to lower-case letters and digits, so "peds 2026_08-01" and "PEDS-2026-08-01" compare equal."""
    return re.sub(r"[^a-z0-9]", "", code.lower())


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
