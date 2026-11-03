"""Assay definitions: the reusable procedure, its result fields, its executions, and a mean per numeric field."""
from decimal import Decimal

FIELDS = [
    {"analyte": "LACV", "result_name": "CT", "unit": "cycles"},
    {"analyte": "RNase P", "result_name": "CT", "unit": "cycles", "value_type": "numeric"},
    {"result_name": "Call", "value_type": "text"},
]


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def create_definition(client, **fields):
    payload = {"assay_name": "LACV duplex v3", "assay_type": "qPCR", "target": "LACV", "result_fields": FIELDS, **fields}
    response = client.post("/assay-definitions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


_codes = iter(range(1, 10_000))


def execute(client, definition, rows):
    """rows: one dict per Sample of {field label: value} (None or missing = not entered)."""
    ids = {field["label"]: field["assay_definition_result_id"] for field in definition["result_fields"]}
    samples = [
        {"sample_id": create_root(client, f"T-{next(_codes):04d}")["sample_id"], "results": [{"assay_definition_result_id": ids[label], "value": value} for label, value in row.items()]}
        for row in rows
    ]
    response = client.post(f"/assay-definitions/{definition['assay_definition_id']}/executions", json={"samples": samples})
    assert response.status_code == 201, response.text
    return response.json()


def summaries(client, definition):
    detail = client.get(f"/assay-definitions/{definition['assay_definition_id']}").json()
    return {summary["label"]: summary for summary in detail["result_summaries"]}


def test_a_definition_describes_the_procedure_and_its_result_fields(client):
    definition = create_definition(client, kit="TaqPath", instrument="QuantStudio 5", typical_volume="5", typical_volume_unit="uL")

    assert definition["assay_code"] == "LACV-DUPLEX-V3"
    assert [(field["label"], field["unit"], field["value_type"]) for field in definition["result_fields"]] == [
        ("LACV CT", "cycles", "either"), ("RNase P CT", "cycles", "numeric"), ("Call", None, "text"),
    ]
    assert (definition["execution_count"], definition["sample_count"], definition["executions"]) == (0, 0, [])
    duplicate = client.post("/assay-definitions", json={"assay_name": "Twice", "assay_type": "qPCR", "result_fields": [{"result_name": "CT"}, {"result_name": "ct"}]})
    assert duplicate.status_code == 422


def test_each_numeric_field_has_its_own_mean_without_nulls_or_text(client):
    definition = create_definition(client)
    execute(client, definition, [{"LACV CT": "30", "RNase P CT": "24"}, {"LACV CT": "not detected", "RNase P CT": "26"}, {}])
    execute(client, definition, [{"LACV CT": "33", "Call": "positive"}, {"RNase P CT": None}])

    result = summaries(client, definition)

    assert Decimal(result["LACV CT"]["mean"]) == Decimal("31.5"), "blank results are not zeros and text is not averaged"
    assert (result["LACV CT"]["numeric_count"], result["LACV CT"]["text_count"], result["LACV CT"]["empty_count"], result["LACV CT"]["unit"]) == (2, 1, 2, "cycles")
    assert Decimal(result["RNase P CT"]["mean"]) == Decimal("25") and result["RNase P CT"]["empty_count"] == 3
    assert (result["Call"]["mean"], result["Call"]["averageable"], result["Call"]["text_count"]) == (None, False, 1), "text fields are never averaged"


def test_the_means_follow_result_edits(client):
    definition = create_definition(client)
    execution = execute(client, definition, [{"LACV CT": "30"}, {}])
    later = execution["samples"][1]["sample"]["sample_id"]
    lacv = definition["result_fields"][0]["assay_definition_result_id"]

    client.patch(f"/assay-executions/{execution['assay_execution_id']}/samples/{later}/results/{lacv}", json={"value": "36"})

    result = summaries(client, definition)["LACV CT"]
    assert (Decimal(result["mean"]), result["numeric_count"]) == (Decimal("33"), 2)


def test_executions_are_grouped_with_their_samples(client):
    definition = create_definition(client)
    first = execute(client, definition, [{"LACV CT": "30"}, {"LACV CT": "31"}, {"LACV CT": "32"}])
    second = execute(client, definition, [{}])

    detail = client.get(f"/assay-definitions/{definition['assay_definition_id']}").json()

    assert sorted((row["assay_execution_id"], len(row["samples"])) for row in detail["executions"]) == sorted(
        [(first["assay_execution_id"], 3), (second["assay_execution_id"], 1)]
    )
    assert (detail["execution_count"], detail["sample_count"]) == (2, 4)
    listed = next(row for row in client.get("/assay-definitions").json() if row["assay_definition_id"] == definition["assay_definition_id"])
    assert (listed["execution_count"], listed["sample_count"]) == (2, 4)


def test_definition_names_are_unique_per_type_and_editable(client):
    definition = create_definition(client)

    duplicate = client.post("/assay-definitions", json={"assay_name": "lacv DUPLEX v3", "assay_type": "qpcr"})
    edited = client.patch(f"/assay-definitions/{definition['assay_definition_id']}", json={"kit": "TaqPath", "is_active": False})

    assert duplicate.status_code == 400 and "already exists" in duplicate.text
    assert (edited.json()["kit"], edited.json()["is_active"]) == ("TaqPath", False)
    assert client.post("/assay-definitions", json={"assay_name": "No unit", "assay_type": "qPCR", "typical_volume": "2"}).status_code == 422
    assert client.post("/assay-definitions", json={"assay_name": "Bad type", "assay_type": "qPCR", "result_fields": [{"result_name": "CT", "value_type": "boolean"}]}).status_code == 422


def test_seeded_plates_keep_every_result_field(client):
    definitions = {row["assay_code"]: row for row in client.get("/assay-definitions").json()}
    duplex = client.get(f"/assay-definitions/{definitions['LACV-RNASEP-DUPLEX']['assay_definition_id']}").json()
    sybr = client.get(f"/assay-definitions/{definitions['LACV-QPCR-SYBR']['assay_definition_id']}").json()

    assert [field["label"] for field in duplex["result_fields"]] == ["LACV CT", "RNase P CT"]
    assert all(len(row["results"]) == 2 for execution in duplex["executions"] for row in execution["samples"]), "both CTs for every Sample"
    rows = sum(len(execution["samples"]) for execution in sybr["executions"])
    assert sybr["execution_count"] == len(sybr["executions"]) < rows and sybr["sample_count"] < rows
    assert any(row["results"] == [] for execution in sybr["executions"] for row in execution["samples"]), "some results are not read yet"
    assert {summary["label"]: summary["numeric_count"] for summary in duplex["result_summaries"]}["RNase P CT"] == 19


def test_assay_definitions_are_no_longer_imported_from_workbooks(client):
    for path in ("/assay-definitions/import/preview", "/assay-definitions/import"):
        assert client.post(path, files={"file": ("a.xlsx", b"x")}).status_code in (404, 405)
    assert client.get("/assay-definitions/import-template").status_code in (404, 422)
