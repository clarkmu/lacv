""".xlsx templates and imports: what both workbook imports share.

Each import declares its columns once, as TemplateColumns. The same list writes the downloadable
template's header row, is served as the template's documentation (GET .../columns), and tells the
importer which headers it accepts, so the three cannot drift apart.

A required column's header is written with a trailing " *" (e.g. "sample_code *"). The marker is
removed before headers are matched, so a header is accepted with or without it, and workbooks made
before the marker existed still import.
"""
import logging
import zipfile
from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO

logger = logging.getLogger("lacv")

REQUIRED_MARK = "*"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
UNREADABLE_WORKBOOK = (
    "The file is not a readable .xlsx workbook. Save it from Excel as \"Excel Workbook (.xlsx)\" "
    "(not .xls, .csv or a renamed file) and choose it again."
)


@dataclass(frozen=True)
class TemplateColumn:
    """One column of an import template, as the importer reads it and as its documentation describes it."""
    name: str
    required: bool
    description: str
    format: str
    example: str
    # False for optional columns the importer accepts but the template leaves out to stay narrow.
    in_template: bool = True

    @property
    def header(self) -> str:
        return f"{self.name} {REQUIRED_MARK}" if self.required else self.name

    def doc(self) -> dict:
        return {
            "name": self.name, "header": self.header, "required": self.required, "description": self.description,
            "format": self.format, "example": self.example, "in_template": self.in_template,
        }


class WorkbookError(Exception):
    """A workbook that cannot be read at all; the message is written for the person who uploaded it."""


def normalize_header(value) -> str:
    """A header as the importers compare it: no required marker, lower case, words joined by "_"."""
    if value in (None, ""):
        return ""
    text = str(value).strip()
    while text.endswith(REQUIRED_MARK):
        text = text[:-1].rstrip()
    return "_".join(text.lower().split())


def open_workbook(content: bytes, file_name: str, data_only: bool):
    """The workbook, read-only and without macros, or a WorkbookError the user can act on."""
    from openpyxl import load_workbook

    try:
        return load_workbook(BytesIO(content), read_only=True, data_only=data_only, keep_vba=False)
    except (zipfile.BadZipFile, KeyError, ValueError, OSError, TypeError, IndexError) as error:
        logger.info("Could not open workbook %r: %r", file_name, error)
        raise WorkbookError(UNREADABLE_WORKBOOK) from error
    except Exception as error:  # openpyxl raises many types for damaged files; none is the user's to read.
        logger.warning("Unexpected error opening workbook %r", file_name, exc_info=True)
        raise WorkbookError(UNREADABLE_WORKBOOK) from error


def template_workbook(sheets: dict[str, tuple[list[TemplateColumn] | None, list[list]]]) -> bytes:
    """A template: per sheet, its columns (written as a bold, frozen header with each column's description
    as a cell note) and any further rows."""
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    workbook.remove(workbook.active)
    for title, (columns, rows) in sheets.items():
        sheet = workbook.create_sheet(title)
        if columns is not None:
            shown = [column for column in columns if column.in_template]
            sheet.append([column.header for column in shown])
            for index, column in enumerate(shown, start=1):
                cell = sheet.cell(row=1, column=index)
                cell.font = Font(bold=True)
                note = f"{'Required' if column.required else 'Optional'}. {column.description}\nFormat: {column.format}\nExample: {column.example}"
                cell.comment = Comment(note, "LACV", width=320, height=140)
                sheet.column_dimensions[get_column_letter(index)].width = max(len(column.header) + 4, 18)
            sheet.freeze_panes = "A2"
        for row in rows:
            sheet.append(row)
        if columns is None:
            for index in range(1, sheet.max_column + 1):
                sheet.column_dimensions[get_column_letter(index)].width = 24
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def cell_text(value) -> str | None:
    """A cell as the text a user would type: dates as YYYY-MM-DD (with the time when it has one), whole numbers without ".0"."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M") if (value.hour, value.minute, value.second) != (0, 0, 0) else value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    return text or None


def parse_date(text: str) -> datetime | None:
    """YYYY-MM-DD, optionally with a time (HH:MM or HH:MM:SS, after a space or "T"). Other forms are not guessed:
    03/04/2026 is 3 April in one lab and 4 March in another."""
    try:
        return datetime.fromisoformat(text.strip().replace(" ", "T", 1))
    except ValueError:
        return None
