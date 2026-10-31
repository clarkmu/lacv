"""Reading an assay definition from an .xlsx workbook, without saving anything.

The workbook contract (version 1), also served as a template at
GET /api/assay-definitions/import-template:

- Sheet "Assay" (required): one field per row, the field name in column A and
  its value in column B. An optional first row "field | value" is skipped.
  Fields: assay_name and assay_type (required), assay_code, target, kit,
  instrument, typical_volume, typical_volume_unit, description.
- Sheet "Results" (optional): the results an execution reports. A header row
  naming the columns result_name (required), analyte, unit, value_type
  (numeric, text or either), then one row per result.

Other sheets are ignored. Cells are read as stored values: a cell holding a
formula is refused rather than calculated, and macros are never read.
"""
import hashlib
import zipfile
from decimal import Decimal, InvalidOperation
from io import BytesIO

from pydantic import ValidationError

from .schemas import AssayDefinitionCreate, ExpectedResult

ASSAY_FIELDS = ["assay_name", "assay_type", "assay_code", "target", "kit", "instrument", "typical_volume", "typical_volume_unit", "description"]
RESULT_COLUMNS = ["result_name", "analyte", "unit", "value_type"]
MAX_ROWS = 500

WORKBOOK_TEMPLATE = {
    "Assay": [
        ("assay_name", "LACV qPCR (SYBR Green)"),
        ("assay_type", "qPCR"),
        ("assay_code", ""),
        ("target", "LACV"),
        ("kit", "PowerUp SYBR Green Master Mix (Thermo)"),
        ("instrument", "QuantStudio 5"),
        ("typical_volume", 2),
        ("typical_volume_unit", "uL"),
        ("description", "SYBR Green qPCR on cDNA; report CT, or 'not detected'."),
    ],
    "Results": [
        RESULT_COLUMNS,
        ["CT", "LACV", "cycles", "either"],
    ],
}


def read_assay_workbook(content: bytes, file_name: str) -> dict:
    """The definition a workbook describes and every problem found in it, each naming its sheet and row."""
    source = {"file_name": file_name, "sha256": hashlib.sha256(content).hexdigest(), "sheets": []}
    problems: list[str] = []
    try:
        from openpyxl import load_workbook

        # read_only streams the sheets; data_only=False keeps formulas visible so they can be refused.
        workbook = load_workbook(BytesIO(content), read_only=True, data_only=False, keep_vba=False)
    except (zipfile.BadZipFile, KeyError, ValueError, OSError) as error:
        return {"source": source, "definition": None, "problems": [f"The file is not a readable .xlsx workbook ({error.__class__.__name__})"]}
    try:
        source["sheets"] = list(workbook.sheetnames)
        sheets = {name.strip().lower(): workbook[name] for name in workbook.sheetnames}
        if "assay" not in sheets:
            found = ", ".join(workbook.sheetnames) or "none"
            return {"source": source, "definition": None, "problems": [f"The workbook needs a sheet named \"Assay\" (sheets found: {found})"]}
        fields = _read_assay_sheet(sheets["assay"], problems)
        results = _read_results_sheet(sheets["results"], problems) if "results" in sheets else []
    finally:
        workbook.close()

    definition = None
    try:
        definition = AssayDefinitionCreate(**fields, expected_results=results)
    except ValidationError as error:
        for item in error.errors():
            where = f", {item['loc'][0]}" if item["loc"] else ""
            problems.append(f"Assay sheet{where}: {_message(item)}")
    if problems:
        definition = None
    return {"source": source, "definition": definition, "problems": problems}


def _read_assay_sheet(sheet, problems: list[str]) -> dict:
    fields: dict = {}
    for row_number, row in _rows(sheet, problems, "Assay"):
        name = _header(row[0] if row else None)
        value = row[1] if len(row) > 1 else None
        if not name or (row_number == 1 and name == "field"):
            continue
        if name not in ASSAY_FIELDS:
            problems.append(f"Assay sheet, row {row_number}: unknown field \"{row[0]}\" (expected one of {', '.join(ASSAY_FIELDS)})")
            continue
        if name in fields:
            problems.append(f"Assay sheet, row {row_number}: {name} is given more than once")
            continue
        if name == "typical_volume" and value not in (None, ""):
            try:
                value = Decimal(str(value))
            except InvalidOperation:
                problems.append(f"Assay sheet, row {row_number}: typical_volume must be a number, not \"{value}\"")
                continue
        fields[name] = value if not isinstance(value, (int, float)) or name == "typical_volume" else str(value)
    return fields


def _read_results_sheet(sheet, problems: list[str]) -> list[dict]:
    rows = _rows(sheet, problems, "Results")
    if not rows:
        return []
    header_row_number, header = rows[0]
    columns = [_header(value) for value in header]
    unknown = [str(value) for value, column in zip(header, columns) if column and column not in RESULT_COLUMNS]
    if unknown:
        problems.append(f"Results sheet, row {header_row_number}: unknown column {', '.join(unknown)} (expected {', '.join(RESULT_COLUMNS)})")
    if "result_name" not in columns:
        problems.append(f"Results sheet, row {header_row_number}: the header row needs a result_name column")
        return []
    results = []
    for row_number, row in rows[1:]:
        data = {column: (str(value).strip() if value is not None else None) for column, value in zip(columns, row) if column in RESULT_COLUMNS}
        data = {key: value for key, value in data.items() if value}
        try:
            results.append(ExpectedResult(**data).model_dump())
        except ValidationError as error:
            for item in error.errors():
                problems.append(f"Results sheet, row {row_number}, {item['loc'][0] if item['loc'] else 'row'}: {_message(item)}")
    return results


def _rows(sheet, problems: list[str], sheet_label: str) -> list[tuple[int, list]]:
    """Non-empty rows with their 1-based row numbers. Formula cells are reported, never evaluated."""
    rows = []
    for row_number, cells in enumerate(sheet.iter_rows(), start=1):
        if row_number > MAX_ROWS:
            problems.append(f"{sheet_label} sheet: more than {MAX_ROWS} rows; this does not look like an assay definition")
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


def _message(item: dict) -> str:
    message = item["msg"].removeprefix("Value error, ")
    if item["type"] == "missing":
        return "is required"
    if item["type"] == "string_pattern_mismatch":
        return "must be numeric, text or either"
    return message
