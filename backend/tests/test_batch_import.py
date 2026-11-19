"""A shipping batch of root Samples from an .xlsx workbook: template and its documentation, preview, readable problems, save.

The template, its documentation and the importer come from one column list (app/batch_import.COLUMNS);
these tests hold them to each other through the API, the way a user meets them.
"""
from io import BytesIO

from openpyxl import Workbook, load_workbook

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def workbook(rows, sheet_name="Samples") -> bytes:
    book = Workbook()
    sheet = book.active
    sheet.title = sheet_name
    for row in rows:
        sheet.append(list(row))
    output = BytesIO()
    book.save(output)
    return output.getvalue()


def preview(client, content, name="shipment.xlsx"):
    response = client.post("/batches/sample-import/preview", files={"file": (name, content, XLSX)})
    assert response.status_code == 200, response.text
    return response.json()


def save(client, rows, batch_name="Shipment"):
    columns = ("sample_code", "subject_code", "external_sample_id", "aliquot_number", "sample_type", "source_type", "source_description",
               "collection_date", "received_date", "status", "latitude", "longitude", "notes")
    return client.post("/batches/sample-import", json={"batch_name": batch_name, "samples": [{key: row.get(key) for key in columns} for row in rows]})


def problems_by_row(shown):
    return {row["row_number"]: [(problem["column"], problem["value"], problem["message"]) for problem in row["problems"]] for row in shown["samples"]}


def test_template_documentation_and_importer_agree(client):
    template = client.get("/batches/sample-template")
    docs = client.get("/batches/sample-template/columns").json()
    headers = [cell.value for cell in load_workbook(BytesIO(template.content))["Samples"][1]]
    [sheet] = docs["sheets"]

    assert template.headers["content-type"] == XLSX
    assert headers == [column["header"] for column in sheet["columns"] if column["in_template"]]
    assert headers[0] == "sample_code *" and [column["name"] for column in sheet["columns"] if column["required"]] == ["sample_code"]
    assert all(not header.endswith("*") for header in headers[1:])
    assert any("* are required" in note for note in docs["notes"])
    for column in sheet["columns"]:
        assert column["description"] and column["format"] and column["example"], column["name"]
    # The sample type column lists the types that exist, so its example is one the importer accepts.
    sample_type = next(column for column in sheet["columns"] if column["name"] == "sample_type")
    assert "Serum" in sample_type["format"] and "CSF" in sample_type["format"]

    # Every documented example, typed into the downloaded template, imports without a problem.
    book = load_workbook(BytesIO(template.content))
    book["Samples"].append([column["example"] for column in sheet["columns"] if column["in_template"]])
    filled = BytesIO()
    book.save(filled)
    shown = preview(client, filled.getvalue())
    assert shown["can_import"] and shown["problems"] == [] and shown["warnings"] == []
    assert problems_by_row(shown) == {2: []}

    saved = save(client, shown["samples"])
    assert saved.status_code == 200, saved.text
    [created] = saved.json()["samples"]
    assert (created["sample_code"], created["sample_type"], created["aliquot_number"], created["status"]) == ("LACV-2026-0042", "Serum", 1, "received")
    detail = client.get(f"/samples/{created['sample_id']}").json()
    assert (detail["latitude"], detail["longitude"]) == ("35.595100", "-82.551500")
    assert detail["collection_date"].startswith("2026-05-13") and detail["received_date"].startswith("2026-05-15T09:30")


def test_workbooks_without_the_required_marker_still_import(client):
    # Written before the template marked required columns, with Excel's own spacing and capitals.
    legacy = workbook([("sample_code", "Subject Code", "Collection Date"), ("OLD-1", "SUBJ-1", "2026-04-01")])
    marked = workbook([("sample_code *", "subject_code"), ("NEW-1", "SUBJ-2")])
    marked_tightly = workbook([("Sample_Code*",), ("NEW-2",)])

    for content, code in ((legacy, "OLD-1"), (marked, "NEW-1"), (marked_tightly, "NEW-2")):
        shown = preview(client, content)
        assert shown["can_import"], shown
        assert [row["sample_code"] for row in shown["samples"]] == [code]
    assert preview(client, legacy)["samples"][0]["collection_date"] == "2026-04-01"


def test_problems_name_the_row_column_and_value_and_say_what_to_enter(client):
    from datetime import datetime

    content = workbook([
        ("sample_code", "subject_code", "aliquot_number", "sample_type", "collection_date", "latitude", "longitude"),
        ("GOOD-1", "SUBJ-1", 1, "Serum", datetime(2026, 5, 13), 35.6, -82.55),
        ("BAD-DATE", "SUBJ-1", 2, "Serum", "13/05/2026", None, None),
        ("BAD-ALIQUOT", "SUBJ-2", "two", "serum", None, None, None),
        ("BAD-TYPE", None, None, "Mosquito", None, None, None),
        (None, "SUBJ-3", None, None, None, None, None),
        ("GOOD-1", None, None, None, None, None, None),
        ("BAD-PLACE", None, None, None, None, 95, -82.5),
        ("HALF-PLACE", None, None, None, None, 35.5, None),
        ("SAME-TUBE", "SUBJ-1", 1, "SERUM", "2026-05-13 08:00", None, None),
    ])

    shown = preview(client, content)
    found = problems_by_row(shown)

    assert shown["problems"] == [] and shown["can_import"], "row problems are fixed on the confirm page"
    assert found[2] == []
    assert found[3] == [("collection_date", "13/05/2026", '"13/05/2026" is not a date LACV can read; use YYYY-MM-DD (e.g. 2026-05-13), optionally with a time (2026-05-13 14:30), or format the cell as a date in Excel')]
    assert found[4] == [("aliquot_number", "two", '"two" is not a whole number; enter a number such as 1, 2 or 3')]
    assert found[5][0][:2] == ("sample_type", "Mosquito") and found[5][0][2].startswith('"Mosquito" is not a sample type in LACV; use one of: ')
    assert found[6] == [("sample_code", None, "sample_code is required; this row has none")]
    assert found[7] == [("sample_code", "GOOD-1", '"GOOD-1" is also on row 2; each Sample needs its own code')]
    assert found[8] == [("latitude", "95", '"95" is out of range; latitude must be between -90 and 90 decimal degrees')]
    assert found[9] == [("longitude", None, "longitude is blank but latitude is given; enter both, or neither")]
    # Same subject, Material (by name or code, any case) and collection day as row 2.
    assert found[10] == [("aliquot_number", "1", "aliquot 1 is also row 2: the same subject and Material collected 2026-05-13 cannot have two tubes with one number")]
    # Nothing was saved by previewing.
    assert client.get("/samples/lookup", params={"code": "GOOD-1"}).status_code == 404


def test_codes_already_in_use_are_reported_before_saving(client):
    assert client.post("/samples", json={"sample_code": "TAKEN-1"}).status_code == 201

    found = problems_by_row(preview(client, workbook([("sample_code",), ("TAKEN-1",), ("FREE-1",)])))

    assert found == {2: [("sample_code", "TAKEN-1", '"TAKEN-1" is already a Sample in LACV; give this Sample a new code')], 3: []}


def test_saving_checks_every_row_again_and_saves_all_or_nothing(client):
    rows = [{"sample_code": "SHIP-1", "collection_date": "2026-05-13"}, {"sample_code": "SHIP-2", "collection_date": "May 13"}, {"sample_code": "SHIP-3", "aliquot_number": "0"}]

    refused = save(client, rows)

    assert refused.status_code == 422
    assert [(item["loc"], item["msg"]) for item in refused.json()["detail"]] == [
        (["body", "samples", 1, "collection_date"], '"May 13" is not a date LACV can read; use YYYY-MM-DD (e.g. 2026-05-13), optionally with a time (2026-05-13 14:30), or format the cell as a date in Excel'),
        (["body", "samples", 2, "aliquot_number"], '"0" is not allowed; enter a whole number of 1 or more'),
    ]
    assert client.get("/samples/lookup", params={"code": "SHIP-1"}).status_code == 404
    assert all(batch["batch_name"] != "Shipment" for batch in client.get("/batches").json())

    rows[1]["collection_date"], rows[2]["aliquot_number"] = "2026-05-14", 2
    saved = save(client, rows)
    assert saved.status_code == 200, saved.text
    assert [sample["sample_code"] for sample in saved.json()["samples"]] == ["SHIP-1", "SHIP-2", "SHIP-3"]
    assert all(sample["status"] == "expected" for sample in saved.json()["samples"]), "a blank status means expected"


def test_a_blank_batch_name_is_a_readable_field_error(client):
    response = save(client, [{"sample_code": "X-1"}], batch_name="  ")

    assert response.status_code == 422
    assert response.json()["detail"] == [{"loc": ["body", "batch_name"], "msg": "is required", "type": "string_type"}]


def test_files_that_cannot_be_used_say_why_and_what_to_do(client):
    url = "/batches/sample-import/preview"
    not_a_workbook = client.post(url, files={"file": ("shipment.xlsx", b"sample_code,subject\nS-1,A\n", XLSX)})
    csv = client.post(url, files={"file": ("shipment.csv", b"sample_code\nS-1\n", "text/csv")})
    no_code_column = preview(client, workbook([("code", "Collection Date"), ("S-1", "2026-01-01")]))
    header_only = preview(client, workbook([("sample_code *", "subject_code")]))
    empty = preview(client, workbook([]))
    extra_columns = preview(client, workbook([("sample_code", "Freezer", "Comments"), ("S-1", "F2", "ok")]))
    repeated = preview(client, workbook([("sample_code", "Sample Code"), ("S-1", "S-2")]))
    other_sheet = preview(client, workbook([("sample_code",), ("S-9",)], sheet_name="Sheet1"))

    assert not_a_workbook.status_code == 200
    assert not_a_workbook.json()["problems"] == ['The file is not a readable .xlsx workbook. Save it from Excel as "Excel Workbook (.xlsx)" (not .xls, .csv or a renamed file) and choose it again.']
    assert csv.status_code == 400 and "ending in .xlsx" in csv.json()["detail"] and "save as" in csv.json()["detail"]
    assert no_code_column["problems"] == ['Samples sheet, row 1: there is no sample_code column (columns found: "code", "Collection Date"). The first filled row must hold the column names from the template.']
    assert header_only["problems"] == ["Samples sheet has column names but no Samples below them."]
    assert empty["problems"][0].startswith("Samples sheet is empty")
    assert repeated["problems"] == ["Samples sheet, row 1: sample_code appears more than once; keep one column of each name."]
    assert not any(item["can_import"] for item in (not_a_workbook.json(), no_code_column, header_only, empty, repeated))
    # Extra columns do not block the import, but the user is told they are not read.
    assert extra_columns["can_import"] and extra_columns["warnings"] == [
        "Samples sheet: 2 columns not in the template will be ignored: Freezer, Comments. Expected columns: sample_code, subject_code, external_sample_id, aliquot_number, "
        "sample_type, source_type, source_description, collection_date, received_date, status, latitude, longitude, notes.",
    ]
    # Workbooks whose only sheet is not named Samples are read from that sheet, as before.
    assert [row["sample_code"] for row in other_sheet["samples"]] == ["S-9"]
    for item in (not_a_workbook.json(), no_code_column, header_only, empty, repeated):
        assert all("Traceback" not in problem and "Error" not in problem for problem in item["problems"])
