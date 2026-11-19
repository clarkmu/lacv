"""A shipping batch of root Samples from an .xlsx workbook: template, preview and save.

COLUMNS is the workbook contract. It writes the template (GET /api/batches/sample-template), is served
as the template's documentation (GET /api/batches/sample-template/columns), decides which headers are
read, and each column's parser is what both the preview and the save use to check a value. Headers
match without regard to case, spacing or a trailing "*" (required marker); other columns are reported
as ignored.

The workbook is read from its "Samples" sheet, or from the first sheet when there is none. Row 1 is
the header; every non-empty row below it is one root Sample. Cell values are read as stored (a
formula gives its last calculated value).

Every problem names its row and column, quotes the value, and says what was expected. The preview
returns them for the user to fix on the confirm page; saving checks every row again and saves all of
them or none.
"""
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import LegacyMaterialRecord, Sample, SampleType
from .schemas import COORDINATE_RANGES, coordinate_problem
from .spreadsheet import TemplateColumn, WorkbookError, cell_text, normalize_header, open_workbook, parse_date

SHEET = "Samples"
MAX_ROWS = 2000
MAX_WORKBOOK_BYTES = 2 * 1024 * 1024


class Problem(ValueError):
    """Why a cell's value cannot be used, written for the person fixing the spreadsheet."""


def _text(max_length: int) -> Callable[[str], str]:
    def parse(value: str) -> str:
        if len(value) > max_length:
            raise Problem(f"is {len(value)} characters long; the most allowed is {max_length}")
        return value
    return parse


def _whole_number(value: str) -> int:
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise Problem(f"\"{value}\" is not a whole number; enter a number such as 1, 2 or 3") from None
    if number != number.to_integral_value() or number < 1:
        raise Problem(f"\"{value}\" is not allowed; enter a whole number of 1 or more")
    return int(number)


def _date(value: str):
    parsed = parse_date(value)
    if parsed is None:
        raise Problem(f"\"{value}\" is not a date LACV can read; use YYYY-MM-DD (e.g. 2026-05-13), optionally with a time (2026-05-13 14:30), or format the cell as a date in Excel")
    return parsed


def _coordinate(name: str) -> Callable[[str], Decimal]:
    def parse(value: str) -> Decimal:
        try:
            number = Decimal(value.replace("°", "").strip())
        except InvalidOperation:
            raise Problem(f"\"{value}\" is not a number; enter decimal degrees such as {'35.5951' if name == 'latitude' else '-82.5515'}") from None
        if coordinate_problem(name, number):
            low, high = COORDINATE_RANGES[name]
            raise Problem(f"\"{value}\" is out of range; {name} must be between {low} and {high} decimal degrees")
        return number
    return parse


@dataclass(frozen=True)
class ImportColumn(TemplateColumn):
    parse: Callable[[str], object] = field(default=lambda value: value, compare=False, repr=False)


COLUMNS: list[ImportColumn] = [
    ImportColumn("sample_code", True, "The Sample's own code, as printed on the tube label. It must be new: not used by another Sample or an old Material label.",
                 "Text, up to 100 characters", "LACV-2026-0042", parse=_text(100)),
    ImportColumn("subject_code", False, "The study subject (participant) the Sample came from.", "Text, up to 100 characters", "SUBJ-017", parse=_text(100)),
    ImportColumn("external_sample_id", False, "The sender's own identifier for the tube, if it has one.", "Text, up to 100 characters", "MH-88213", parse=_text(100)),
    ImportColumn("aliquot_number", False, "Which tube this is among one subject's tubes of one Material from one collection. Two such tubes in the batch cannot share a number.",
                 "Whole number, 1 or more", "1", parse=_whole_number),
    # The format lists the sample types in use; see column_docs.
    ImportColumn("sample_type", False, "The Material (sample type). It must name a sample type already set up in LACV, by its name or code; capitals do not matter.",
                 "One of the sample types in LACV", "Serum"),
    ImportColumn("source_type", False, "What kind of source the Sample came from.", "Text, up to 100 characters", "Human", parse=_text(100)),
    ImportColumn("source_description", False, "More about the source, such as the clinic or trap site.", "Text, up to 255 characters", "Mission Hospital ED", parse=_text(255)),
    ImportColumn("collection_date", False, "When the Sample was collected.", "Date as YYYY-MM-DD, optionally with a time (YYYY-MM-DD HH:MM), or an Excel date cell", "2026-05-13", parse=_date),
    ImportColumn("received_date", False, "When the lab received the Sample.", "Date as YYYY-MM-DD, optionally with a time (YYYY-MM-DD HH:MM), or an Excel date cell", "2026-05-15 09:30", parse=_date),
    ImportColumn("status", False, "Where the Sample is in its workflow. Blank means expected (not yet received).",
                 "Text, up to 50 characters; usually expected, received or available", "received", parse=_text(50)),
    ImportColumn("latitude", False, "Where the Sample was collected: latitude in decimal degrees (WGS 84). Give the longitude too, or the Sample is not shown on the map.",
                 "Number from -90 to 90; north is positive", "35.5951", parse=_coordinate("latitude")),
    ImportColumn("longitude", False, "Where the Sample was collected: longitude in decimal degrees (WGS 84).",
                 "Number from -180 to 180; west is negative", "-82.5515", parse=_coordinate("longitude")),
    ImportColumn("notes", False, "Anything else about this Sample.", "Text", "Hemolyzed", parse=lambda value: value),
]
COLUMN_NAMES = [column.name for column in COLUMNS]
_BY_NAME = {column.name: column for column in COLUMNS}


def column_docs(db: Session) -> dict:
    """The template's documentation, from COLUMNS, with the sample types that exist right now."""
    types = sorted(sample_type.type_name for sample_type in db.scalars(select(SampleType).where(SampleType.is_active.is_(True))).all())
    columns = []
    for column in COLUMNS:
        doc = column.doc()
        if column.name == "sample_type" and types:
            doc["format"] = "One of: " + ", ".join(types)
            doc["example"] = "Serum" if "Serum" in types else types[0]
        columns.append(doc)
    return {
        "title": "Sample batch template",
        "file_name": "sample-batch-template.xlsx",
        "sheets": [{
            "name": SHEET,
            "description": "Row 1 holds the column names; each row below it is one root Sample of the shipping batch. Columns may be in any order, and optional columns may be left out or blank.",
            "columns": columns,
        }],
        "notes": [
            "Columns marked * are required. The * may be kept or removed; LACV reads the column either way.",
            "Nothing is saved when the file is chosen: LACV lists every row, and any problems, for you to check before saving the batch.",
        ],
    }


def read_batch_workbook(content: bytes, file_name: str, db: Session) -> dict:
    """Every row of the workbook as text, with each row's problems, plus problems and warnings about the file itself."""
    preview = {"file_name": file_name, "samples": [], "problems": [], "warnings": [], "can_import": False}
    try:
        workbook = open_workbook(content, file_name, data_only=True)
    except WorkbookError as error:
        preview["problems"].append(str(error))
        return preview
    try:
        by_name = {name.strip().lower(): name for name in workbook.sheetnames}
        sheet_name = by_name.get(SHEET.lower(), workbook.sheetnames[0] if workbook.sheetnames else None)
        if sheet_name is None:
            preview["problems"].append("The workbook has no sheets.")
            return preview
        rows = list(_sheet_rows(workbook[sheet_name], sheet_name, preview["problems"]))
    finally:
        workbook.close()
    if not rows:
        preview["problems"].append(f"{sheet_name} sheet is empty: row 1 should hold the column names (start from the template), with one Sample per row below it.")
        return preview

    header_row, header_values = rows[0]
    headers = [normalize_header(value) for value in header_values]
    if "sample_code" not in headers:
        found = ", ".join(f"\"{value}\"" for value in header_values if value not in (None, "")) or "none"
        preview["problems"].append(f"{sheet_name} sheet, row {header_row}: there is no sample_code column (columns found: {found}). The first filled row must hold the column names from the template.")
        return preview
    ignored = [str(value).strip() for value, header in zip(header_values, headers) if header and header not in _BY_NAME]
    if ignored:
        preview["warnings"].append(f"{sheet_name} sheet: {_plural(len(ignored), 'column')} not in the template will be ignored: {', '.join(ignored)}. Expected columns: {', '.join(COLUMN_NAMES)}.")
    repeated = sorted({header for header in headers if header and headers.count(header) > 1})
    if repeated:
        preview["problems"].append(f"{sheet_name} sheet, row {header_row}: {', '.join(repeated)} appears more than once; keep one column of each name.")
        return preview

    for row_number, values in rows[1:]:
        texts = {header: cell_text(value) for header, value in zip(headers, values) if header in _BY_NAME}
        if not any(texts.values()):
            continue
        preview["samples"].append({"row_number": row_number, **{name: texts.get(name) for name in COLUMN_NAMES}})
    if not preview["samples"]:
        preview["problems"].append(f"{sheet_name} sheet has column names but no Samples below them.")
        return preview

    problems = validate_rows(preview["samples"], db)
    for index, sample in enumerate(preview["samples"]):
        sample["problems"] = problems.get(index, [])
    preview["can_import"] = not preview["problems"]
    return preview


def validate_rows(rows: list[dict], db: Session) -> dict[int, list[dict]]:
    """Problems per row index, each {"column", "value", "message"}. The same checks run on preview and on save."""
    problems: dict[int, list[dict]] = {}

    def add(index: int, column: str, value, message: str) -> None:
        problems.setdefault(index, []).append({"column": column, "value": value, "message": message})

    parsed_rows = [parse_row(row, lambda column, value, message, index=index: add(index, column, value, message)) for index, row in enumerate(rows)]
    type_ids = sample_type_lookup(db)
    known_types = ", ".join(sorted({name for name in db.scalars(select(SampleType.type_name).where(SampleType.is_active.is_(True))).all()}))
    codes = [parsed.get("sample_code") for parsed in parsed_rows]
    taken = _codes_in_use([code for code in codes if code], db)
    first_row_of: dict[str, int] = {}
    aliquot_holders: dict[tuple, int] = {}
    for index, (row, parsed) in enumerate(zip(rows, parsed_rows)):
        code = parsed.get("sample_code")
        if code:
            if code in first_row_of:
                add(index, "sample_code", code, f"\"{code}\" is also on row {_row_label(rows, first_row_of[code])}; each Sample needs its own code")
            else:
                first_row_of[code] = index
            if code in taken:
                add(index, "sample_code", code, f"\"{code}\" is already {taken[code]} in LACV; give this Sample a new code")
        type_name = parsed.get("sample_type")
        if type_name and type_name.strip().lower() not in type_ids:
            add(index, "sample_type", type_name, f"\"{type_name}\" is not a sample type in LACV; use one of: {known_types}" if known_types else f"\"{type_name}\" is not a sample type in LACV; add it under sample types first")
        if (parsed.get("latitude") is None) != (parsed.get("longitude") is None):
            missing = "longitude" if parsed.get("longitude") is None else "latitude"
            if not any(problem["column"] == missing for problem in problems.get(index, [])):
                add(index, missing, None, f"{missing} is blank but {'latitude' if missing == 'longitude' else 'longitude'} is given; enter both, or neither")
        if parsed.get("subject_code") and parsed.get("aliquot_number") is not None:
            collected = parsed.get("collection_date")
            key = (parsed["subject_code"].lower(), type_ids.get((type_name or "").strip().lower()), collected.date() if collected else None, parsed["aliquot_number"])
            if key in aliquot_holders:
                add(index, "aliquot_number", row.get("aliquot_number"), f"aliquot {parsed['aliquot_number']} is also row {_row_label(rows, aliquot_holders[key])}: the same subject and Material{' collected ' + collected.date().isoformat() if collected else ''} cannot have two tubes with one number")
            else:
                aliquot_holders[key] = index
    return problems


def parse_row(row: dict, report: Callable[[str, object, str], None]) -> dict:
    """A row's values, each checked by its column's parser. Problems go to report(column, value, message)."""
    parsed: dict = {}
    for column in COLUMNS:
        raw = row.get(column.name)
        value = raw.strip() if isinstance(raw, str) else (cell_text(raw) if raw is not None else None)
        if not value:
            if column.required:
                report(column.name, None, f"{column.name} is required; this row has none")
            continue
        try:
            parsed[column.name] = column.parse(value)
        except Problem as problem:
            message = str(problem)
            report(column.name, value, message if message.startswith('"') else f"{column.name} {message}")
    return parsed


def sample_type_lookup(db: Session) -> dict[str, int]:
    """Sample type name or code, lower case, to its id."""
    lookup = {}
    for sample_type in db.scalars(select(SampleType).where(SampleType.is_active.is_(True))).all():
        lookup[sample_type.type_name.strip().lower()] = sample_type.sample_type_id
        lookup[sample_type.type_code.strip().lower()] = sample_type.sample_type_id
    return lookup


def _codes_in_use(codes: list[str], db: Session) -> dict[str, str]:
    """Codes already taken, and by what: Sample codes and legacy Material codes share one namespace."""
    if not codes:
        return {}
    taken = {code: "a Sample" for code in db.scalars(select(Sample.sample_code).where(Sample.sample_code.in_(codes))).all()}
    for code in db.scalars(select(LegacyMaterialRecord.material_code).where(LegacyMaterialRecord.material_code.in_(codes))).all():
        taken.setdefault(code, "an old Material label")
    return taken


def _sheet_rows(sheet, sheet_name: str, problems: list[str]):
    for row_number, values in enumerate(sheet.iter_rows(values_only=True), start=1):
        if row_number > MAX_ROWS + 1:
            problems.append(f"{sheet_name} sheet has more than {MAX_ROWS} Samples; split it into several batches.")
            return
        values = list(values)
        if any(value not in (None, "") for value in values):
            yield row_number, values


def _row_label(rows: list[dict], index: int):
    return rows[index].get("row_number") or index + 1


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'}"
