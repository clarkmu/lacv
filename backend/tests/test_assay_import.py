"""One execution of an assay from an .xlsx workbook: template, preview with validation, then saving the rows."""
from io import BytesIO

from openpyxl import Workbook, load_workbook

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def definition(client, **fields):
    payload = {"assay_name": "Plate qPCR", "assay_type": "qPCR", "result_name": "LACV CT", "result_unit": "cycles", **fields}
    response = client.post("/assay-definitions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def workbook(sample_rows, execution_rows=None, sample_sheet="Samples") -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = sample_sheet
    for row in sample_rows:
        sheet.append(list(row))
    if execution_rows is not None:
        details = book.create_sheet("Execution")
        for row in execution_rows:
            details.append(list(row))
    output = BytesIO()
    book.save(output)
    return output.getvalue()


def preview(client, definition_id, content, name="plate.xlsx"):
    return client.post(f"/assay-definitions/{definition_id}/executions/import/preview", files={"file": (name, content, XLSX)})


def execution_count(client, definition_id):
    return client.get(f"/assay-definitions/{definition_id}").json()["execution_count"]


def test_a_workbook_of_several_samples_previews_and_then_saves_as_one_execution(client):
    assay = definition(client)
    create_root(client, "S-001", current_quantity="10", quantity_unit="uL")
    create_root(client, "S-002")
    create_root(client, "S-003")
    content = workbook(
        [("sample_code", "result", "volume_used", "volume_unit"), ("S-001", 31.2, 2, "uL"), ("S-002", "not detected", None, None), ("S-003", None, None, None)],
        [("field", "value"), ("execution_name", "Plate 4"), ("assay_date", "2026-11-03 14:05"), ("operator_name", "Ana"), ("notes", "From the instrument export")],
    )

    shown = preview(client, assay["assay_definition_id"], content).json()

    assert shown["can_import"] and shown["problems"] == []
    assert [(row["sample"]["sample_code"], row["result"], row["volume_used"]) for row in shown["rows"]] == [("S-001", "31.2", "2"), ("S-002", "not detected", None), ("S-003", None, None)]
    assert shown["execution"] == {"execution_name": "Plate 4", "assay_date": "2026-11-03T14:05:00", "operator_name": "Ana", "notes": "From the instrument export"}
    assert execution_count(client, assay["assay_definition_id"]) == 0, "a preview saves nothing"

    saved = client.post(f"/assay-definitions/{assay['assay_definition_id']}/executions", json={
        **shown["execution"],
        "samples": [{"sample_id": row["sample"]["sample_id"], "result": row["result"], "volume_used": row["volume_used"], "volume_unit": row["volume_unit"]} for row in shown["rows"]],
    })
    assert saved.status_code == 201, saved.text
    assert [(row["result_numeric"], row["result_text"]) for row in saved.json()["samples"]] == [("31.20000000", None), (None, "not detected"), (None, None)]
    assert execution_count(client, assay["assay_definition_id"]) == 1


def test_samples_resolve_by_legacy_material_code_too(legacy_database_url):
    from conftest import alembic, api_client

    alembic(legacy_database_url, "upgrade", "head")
    with api_client(legacy_database_url) as client:
        assay = definition(client)
        shown = preview(client, assay["assay_definition_id"], workbook([("sample_code",), ("MAT-010-CHILD",)])).json()

    assert shown["can_import"] and shown["rows"][0]["sample"]["sample_code"] == "SAMPLE-010-CHILD"


def test_every_row_problem_is_reported_and_nothing_can_be_saved(client):
    assay = definition(client, result_value_type="numeric")
    create_root(client, "S-001")
    content = workbook([
        ("sample_code", "result", "volume_used"),
        ("S-001", 30, None),
        ("NOPE-1", None, None),
        ("S-001", None, None),
        (None, 12, None),
        ("S-002-MISSING", "positive", -1),
    ], [("assay_date", "next Tuesday"), ("colour", "blue")])

    shown = preview(client, assay["assay_definition_id"], content).json()

    assert not shown["can_import"]
    assert shown["problems"] == [
        'Execution sheet, row 1: assay_date must be a date (e.g. 2026-11-03 14:05), not "next Tuesday"',
        'Execution sheet, row 2: unknown field "colour" (expected one of execution_name, assay_date, operator_name, notes)',
        "Samples sheet, row 3: No sample or legacy material code matches NOPE-1",
        "Samples sheet, row 4: S-001 is already on row 2; a sample appears once in an execution",
        "Samples sheet, row 5: sample_code is required",
        'Samples sheet, row 6: volume_used must be a positive number, not "-1"',
        "Samples sheet, row 6: No sample or legacy material code matches S-002-MISSING",
        'Samples sheet, row 6: LACV CT must be a number, not "positive"',
    ]
    assert execution_count(client, assay["assay_definition_id"]) == 0


def test_malformed_and_unsupported_files_fail_clearly(client):
    assay = definition(client)
    url = f"/assay-definitions/{assay['assay_definition_id']}/executions/import/preview"

    not_a_workbook = preview(client, assay["assay_definition_id"], b"sample_code,result\nS-1,30\n", "plate.xlsx").json()
    wrong_extension = client.post(url, files={"file": ("plate.xlsm", workbook([("sample_code",)]), XLSX)})
    no_samples_sheet = preview(client, assay["assay_definition_id"], workbook([("sample_code",)], sample_sheet="Sheet1")).json()
    no_code_column = preview(client, assay["assay_definition_id"], workbook([("code", "result"), ("S-1", 3)])).json()
    no_rows = preview(client, assay["assay_definition_id"], workbook([("sample_code", "result")])).json()
    formula = preview(client, assay["assay_definition_id"], workbook([("sample_code", "result"), ("S-1", "=1+1")])).json()

    assert "not a readable .xlsx workbook" in not_a_workbook["problems"][0]
    assert wrong_extension.status_code == 400 and ".xlsx" in wrong_extension.json()["detail"]
    assert no_samples_sheet["problems"] == ['The workbook needs a sheet named "Samples" (sheets found: Sheet1)']
    assert "the header row needs a sample_code column" in no_code_column["problems"][-1]
    assert no_rows["problems"] == ["Samples sheet: no sample rows"]
    assert "cell B2: contains a formula" in formula["problems"][0]
    assert not any(item["can_import"] for item in (not_a_workbook, no_samples_sheet, no_code_column, no_rows, formula))


def test_the_template_is_for_this_assay_and_reads_back(client):
    assay = definition(client)

    response = client.get(f"/assay-definitions/{assay['assay_definition_id']}/executions/import-template")
    book = load_workbook(BytesIO(response.content))

    assert response.headers["content-type"] == XLSX
    assert "plate-qpcr-execution.xlsx" in response.headers["content-disposition"]
    assert [cell.value for cell in book["Samples"][1]] == ["sample_code", "result", "volume_used", "volume_unit"]
    assert "LACV CT (cycles)" in book["Execution"]["B5"].value
    assert preview(client, assay["assay_definition_id"], response.content).json()["problems"] == ["Samples sheet: no sample rows"]
