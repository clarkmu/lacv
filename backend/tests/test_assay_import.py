"""Creating an assay definition from an .xlsx workbook: preview, validate, confirm."""
import hashlib
from io import BytesIO

from openpyxl import Workbook

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def workbook(assay_rows=None, result_rows=None, extra_sheet=None, assay_sheet="Assay") -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = assay_sheet
    for row in assay_rows if assay_rows is not None else [
        ("field", "value"), ("assay_name", "HRTV qPCR v2"), ("assay_type", "qPCR"), ("target", "HRTV"), ("kit", "PowerUp SYBR"),
        ("typical_volume", 2), ("typical_volume_unit", "uL"),
    ]:
        sheet.append(list(row))
    if result_rows is not None:
        results = book.create_sheet("Results")
        for row in result_rows:
            results.append(list(row))
    if extra_sheet:
        book.create_sheet(extra_sheet).append(["ignored"])
    output = BytesIO()
    book.save(output)
    return output.getvalue()


def upload(client, path, content, name="hrtv.xlsx"):
    return client.post(f"/assay-definitions/{path}", files={"file": (name, content, XLSX)})


def definition_count(client):
    return len(client.get("/assay-definitions").json())


def test_preview_reads_the_workbook_without_saving(client):
    content = workbook(result_rows=[("result_name", "analyte", "unit", "value_type"), ("CT", "HRTV", "cycles", "either")], extra_sheet="Notes")
    before = definition_count(client)

    preview = upload(client, "import/preview", content).json()

    assert preview["can_import"] and preview["problems"] == []
    assert (preview["definition"]["assay_name"], preview["definition"]["target"], preview["definition"]["typical_volume"]) == ("HRTV qPCR v2", "HRTV", "2")
    assert preview["definition"]["expected_results"] == [{"analyte": "HRTV", "result_name": "CT", "unit": "cycles", "value_type": "either"}]
    assert preview["source"] == {"file_name": "hrtv.xlsx", "sha256": hashlib.sha256(content).hexdigest(), "sheets": ["Assay", "Results", "Notes"]}
    assert definition_count(client) == before


def test_confirmed_import_creates_the_definition_with_its_provenance(client):
    content = workbook(result_rows=[("result_name", "analyte"), ("CT", "HRTV")])

    created = upload(client, "import", content)

    assert created.status_code == 201, created.text
    definition = created.json()
    assert (definition["assay_code"], definition["kit"], definition["expected_results"][0]["result_name"]) == ("HRTV-QPCR-V2", "PowerUp SYBR", "CT")
    assert (definition["source_file_name"], definition["source_sha256"]) == ("hrtv.xlsx", hashlib.sha256(content).hexdigest())
    assert definition["imported_at"]
    again = upload(client, "import/preview", content).json()
    assert not again["can_import"] and "already exists" in again["problems"][0]


def test_the_downloaded_template_imports_as_is(client):
    template = client.get("/assay-definitions/import-template")

    preview = upload(client, "import/preview", template.content, "template.xlsx").json()

    assert template.headers["content-type"] == XLSX
    # The template's example is the seeded SYBR assay's name, so it reports the duplicate and nothing else.
    assert preview["problems"] == ['Assay sheet: an assay named "LACV qPCR (SYBR Green)" (qPCR) already exists']
    assert preview["definition"]["expected_results"][0]["analyte"] == "LACV"


def test_malformed_files_fail_clearly(client):
    not_a_workbook = upload(client, "import/preview", b"subject,ct\n1,30\n", "data.xlsx").json()
    wrong_extension = upload(client, "import/preview", workbook(), "macros.xlsm")
    old_format = upload(client, "import/preview", workbook(), "old.xls")

    assert not not_a_workbook["can_import"] and "not a readable .xlsx workbook" in not_a_workbook["problems"][0]
    assert wrong_extension.status_code == 400 and old_format.status_code == 400
    assert ".xlsx" in wrong_extension.json()["detail"]


def test_missing_structure_is_reported_by_sheet_and_row(client):
    no_assay_sheet = upload(client, "import/preview", workbook(assay_sheet="Sheet1")).json()
    missing_fields = upload(client, "import/preview", workbook(assay_rows=[("target", "LACV"), ("colour", "blue"), ("target", "HRTV")])).json()
    bad_results = upload(client, "import/preview", workbook(result_rows=[("analyte", "unit"), ("LACV", "cycles")])).json()
    bad_value_type = upload(client, "import/preview", workbook(result_rows=[("result_name", "value_type"), ("CT", "boolean")])).json()

    assert no_assay_sheet["problems"] == ['The workbook needs a sheet named "Assay" (sheets found: Sheet1)']
    assert 'Assay sheet, row 2: unknown field "colour"' in missing_fields["problems"][0]
    assert "Assay sheet, row 3: target is given more than once" in missing_fields["problems"]
    assert "Assay sheet, assay_name: is required" in missing_fields["problems"]
    assert "Assay sheet, assay_type: is required" in missing_fields["problems"]
    assert bad_results["problems"] == ["Results sheet, row 1: the header row needs a result_name column"]
    assert bad_value_type["problems"] == ["Results sheet, row 2, value_type: must be numeric, text or either"]
    assert not any(preview["can_import"] for preview in (no_assay_sheet, missing_fields, bad_results, bad_value_type))


def test_formulas_are_refused_not_calculated(client):
    preview = upload(client, "import/preview", workbook(assay_rows=[("assay_name", "Calc"), ("assay_type", "qPCR"), ("typical_volume", "=1+1")])).json()

    assert preview["problems"] == ["Assay sheet, cell B3: contains a formula; enter the value itself"]


def test_a_refused_import_creates_nothing(client):
    before = definition_count(client)
    bad = workbook(assay_rows=[("assay_name", "Half"), ("assay_type", "qPCR"), ("typical_volume", "two")], result_rows=[("result_name",), ("CT",)])

    response = upload(client, "import", bad)

    assert response.status_code == 422
    assert response.json()["detail"]["problems"] == ['Assay sheet, row 3: typical_volume must be a number, not "two"']
    assert definition_count(client) == before
    assert not any(row["assay_name"] == "Half" for row in client.get("/assay-definitions").json())
