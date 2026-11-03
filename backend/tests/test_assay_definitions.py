"""Assay definitions: the reusable procedure, its one result, its executions, and the mean of its numeric results."""
from decimal import Decimal


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def create_definition(client, **fields):
    payload = {"assay_name": "LACV qPCR v3", "assay_type": "qPCR", "target": "LACV", "result_name": "LACV CT", "result_unit": "cycles", **fields}
    response = client.post("/assay-definitions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


_codes = iter(range(1, 10_000))


def execute(client, definition_id, results):
    samples = [{"sample_id": create_root(client, f"T-{next(_codes):04d}")["sample_id"], "result": result} for result in results]
    response = client.post(f"/assay-definitions/{definition_id}/executions", json={"samples": samples})
    assert response.status_code == 201, response.text
    return response.json()


def summary(client, definition_id):
    return client.get(f"/assay-definitions/{definition_id}").json()["result_summary"]


def test_a_definition_describes_the_procedure_and_its_one_result(client):
    definition = create_definition(client, kit="PowerUp SYBR Green", instrument="QuantStudio 5", typical_volume="2", typical_volume_unit="uL", description="40 cycles")

    assert definition["assay_code"] == "LACV-QPCR-V3"
    assert (definition["kit"], definition["instrument"], definition["typical_volume"], definition["typical_volume_unit"]) == ("PowerUp SYBR Green", "QuantStudio 5", "2.000000", "uL")
    assert (definition["result_name"], definition["result_unit"], definition["result_value_type"]) == ("LACV CT", "cycles", "either")
    assert (definition["execution_count"], definition["sample_count"], definition["executions"]) == (0, 0, [])
    assert "expected_results" not in definition and "operator_name" not in definition


def test_the_mean_uses_numeric_results_only(client):
    definition = create_definition(client)
    execute(client, definition["assay_definition_id"], ["30", "not detected", None])
    execute(client, definition["assay_definition_id"], ["33", None])

    result = summary(client, definition["assay_definition_id"])

    assert Decimal(result["mean"]) == Decimal("31.5"), "blank results are not zeros and text is not averaged"
    assert (result["numeric_count"], result["text_count"], result["empty_count"], result["unit"], result["averageable"]) == (2, 1, 2, "cycles", True)


def test_the_mean_follows_result_edits(client):
    definition = create_definition(client)
    execution = execute(client, definition["assay_definition_id"], ["30", None])
    later = execution["samples"][1]["sample"]["sample_id"]

    client.patch(f"/assay-executions/{execution['assay_execution_id']}/samples/{later}", json={"result": "36"})

    assert (Decimal(summary(client, definition["assay_definition_id"])["mean"]), summary(client, definition["assay_definition_id"])["numeric_count"]) == (Decimal("33"), 2)


def test_no_mean_without_numeric_results_or_for_text_results(client):
    empty = create_definition(client)
    text = create_definition(client, assay_name="Culture check", assay_type="Culture", result_name="CPE", result_unit=None, result_value_type="text")
    execute(client, empty["assay_definition_id"], [None, "not detected"])
    execute(client, text["assay_definition_id"], ["CPE observed"])

    assert (summary(client, empty["assay_definition_id"])["mean"], summary(client, empty["assay_definition_id"])["numeric_count"]) == (None, 0)
    assert (summary(client, text["assay_definition_id"])["mean"], summary(client, text["assay_definition_id"])["averageable"]) == (None, False)


def test_executions_are_grouped_with_their_samples(client):
    definition = create_definition(client)
    first = execute(client, definition["assay_definition_id"], ["30", "31", "32"])
    second = execute(client, definition["assay_definition_id"], [None])

    detail = client.get(f"/assay-definitions/{definition['assay_definition_id']}").json()

    assert sorted((row["assay_execution_id"], len(row["samples"])) for row in detail["executions"]) == sorted(
        [(first["assay_execution_id"], 3), (second["assay_execution_id"], 1)]
    )
    assert (detail["execution_count"], detail["sample_count"]) == (2, 4)
    listed = next(row for row in client.get("/assay-definitions").json() if row["assay_definition_id"] == definition["assay_definition_id"])
    assert (listed["execution_count"], listed["sample_count"]) == (2, 4)


def test_definition_names_are_unique_per_type_and_editable(client):
    definition = create_definition(client)

    duplicate = client.post("/assay-definitions", json={"assay_name": "lacv QPCR v3", "assay_type": "qpcr"})
    edited = client.patch(f"/assay-definitions/{definition['assay_definition_id']}", json={"kit": "TaqPath", "is_active": False, "result_value_type": "numeric"})

    assert duplicate.status_code == 400 and "already exists" in duplicate.text
    assert (edited.json()["kit"], edited.json()["is_active"], edited.json()["result_value_type"]) == ("TaqPath", False, "numeric")
    assert client.post("/assay-definitions", json={"assay_name": "No unit", "assay_type": "qPCR", "typical_volume": "2"}).status_code == 422
    assert client.post("/assay-definitions", json={"assay_name": "Bad type", "assay_type": "qPCR", "result_value_type": "boolean"}).status_code == 422


def test_seeded_plates_hold_many_samples_and_some_samples_were_run_twice(client):
    definitions = {row["assay_code"]: row for row in client.get("/assay-definitions").json()}
    sybr = definitions["LACV-QPCR-SYBR"]
    detail = client.get(f"/assay-definitions/{sybr['assay_definition_id']}").json()
    rows = sum(len(execution["samples"]) for execution in detail["executions"])

    assert sybr["execution_count"] == len(detail["executions"]) < rows, "one execution per plate, not per sample"
    assert sybr["sample_count"] < rows, "some samples are on a failed plate and its repeat"
    assert max(len(execution["samples"]) for execution in detail["executions"]) >= 5
    assert detail["result_summary"]["numeric_count"] > 0 and detail["result_summary"]["empty_count"] > 0
    assert not definitions["LACV-QPCR-V1"]["is_active"]


def test_assay_definitions_are_no_longer_imported_from_workbooks(client):
    for path in ("/assay-definitions/import/preview", "/assay-definitions/import"):
        assert client.post(path, files={"file": ("a.xlsx", b"x")}).status_code in (404, 405)
    assert client.get("/assay-definitions/import-template").status_code in (404, 422)
