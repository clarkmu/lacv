"""Recording an assay execution on a Sample: an existing assay, generated code, performed by, volume used and results."""
import re


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def create_definition(client, name="LACV screening qPCR", **fields):
    response = client.post("/assay-definitions", json={"assay_name": name, "assay_type": "qPCR", "target": "LACV", **fields})
    assert response.status_code == 201, response.text
    return response.json()


def record(client, sample_id, definition_id, **fields):
    return client.post(f"/samples/{sample_id}/assay-executions", json={"assay_definition_id": definition_id, **fields})


def field_errors(response):
    return {item["loc"][-1]: item["msg"] for item in response.json()["detail"]}


def execution_count(client):
    return len(client.get("/assay-executions").json())


def highest_seeded_code(client):
    return max(int(match.group(1)) for row in client.get("/assay-executions").json() if (match := re.fullmatch(r"ASSAY-(\d+)", row["execution_code"])))


def test_recorded_execution_gets_a_code_and_starts_completed_and_unreviewed(client):
    sample = create_root(client, "S-001")
    definition = create_definition(client)
    seeded = highest_seeded_code(client)

    first = record(client, sample["sample_id"], definition["assay_definition_id"], assay_date="2026-10-30T14:05:00")
    second = record(client, sample["sample_id"], definition["assay_definition_id"])

    assert first.status_code == 201, first.text
    execution = first.json()
    assert (execution["execution_code"], second.json()["execution_code"]) == (f"ASSAY-{seeded + 1:03d}", f"ASSAY-{seeded + 2:03d}")
    assert (execution["status"], execution["qc_status"]) == ("completed", "not_reviewed")
    assert (execution["assay_name"], execution["assay_type"], execution["target"]) == ("LACV screening qPCR", "qPCR", "LACV")
    assert execution["definition"]["assay_definition_id"] == definition["assay_definition_id"]
    assert execution["assay_date"] == "2026-10-30T14:05:00"


def test_a_code_can_still_be_given(client):
    sample = create_root(client, "S-001")
    definition = create_definition(client)

    execution = record(client, sample["sample_id"], definition["assay_definition_id"], execution_code="QPCR-7").json()

    assert execution["execution_code"] == "QPCR-7"
    assert record(client, sample["sample_id"], definition["assay_definition_id"], execution_code="QPCR-7").status_code == 400


def test_an_execution_needs_an_existing_assay_and_never_creates_one(client):
    sample = create_root(client, "S-001")
    definitions_before = len(client.get("/assay-definitions").json())

    missing = client.post(f"/samples/{sample['sample_id']}/assay-executions", json={"operator_name": "Ana", "assay_type": "qPCR"})
    unknown = record(client, sample["sample_id"], 999999)

    assert missing.status_code == 422 and "assay_definition_id" in field_errors(missing)
    assert unknown.status_code == 404 and "Assay not found" in field_errors(unknown)["assay_definition_id"]
    assert len(client.get("/assay-definitions").json()) == definitions_before


def test_a_retired_assay_cannot_be_recorded(client):
    sample = create_root(client, "S-001")
    retired = next(row for row in client.get("/assay-definitions").json() if not row["is_active"])

    response = record(client, sample["sample_id"], retired["assay_definition_id"])

    assert response.status_code == 422 and "retired" in field_errors(response)["assay_definition_id"]
    assert all(row["is_active"] for row in client.get("/assay-definitions", params={"active_only": True}).json())


def test_performed_by_is_stored_as_the_operator_name(client):
    sample = create_root(client, "S-001")
    definition = create_definition(client)

    execution = record(client, sample["sample_id"], definition["assay_definition_id"], operator_name="  Jane   Doe ").json()

    assert execution["operator_name"] == "Jane Doe"
    assert client.get(f"/assay-executions/{execution['execution_id']}").json()["operator_name"] == "Jane Doe"


def test_performed_by_suggestions_are_distinct_and_most_recent_first(client):
    sample = create_root(client, "S-001")
    definition = create_definition(client)
    for name in ["Michael Clark", "M. Clark", "Jane  Doe", "", "Michael Clark"]:
        record(client, sample["sample_id"], definition["assay_definition_id"], operator_name=name)

    names = client.get("/assay-executions/performed-by").json()

    assert names[:3] == ["Michael Clark", "Jane Doe", "M. Clark"]
    assert len(names) == len(set(names)) and "" not in names
    assert "A. Rivera" in names, "seeded names are suggested too"


def test_volume_used_is_one_removal_on_the_samples_ledger(client):
    sample = create_root(client, "S-001", current_quantity="100", quantity_unit="uL")
    definition = create_definition(client)

    execution = record(client, sample["sample_id"], definition["assay_definition_id"], volume_used="20", operator_name="Ana").json()

    detail = client.get(f"/samples/{sample['sample_id']}").json()
    assert (detail["availability"]["available_quantity"], detail["availability"]["percent_remaining"]) == ("80.000000", 80.0)
    assert [(event["event_type"], event["quantity_change"], event["related_assay_id"]) for event in detail["quantity_events"]] == [("consumed", "-20.000000", execution["execution_id"])]
    assert (execution["volume_used"], execution["volume_unit"]) == ("20.000000", "uL")


def test_volume_in_a_compatible_unit_is_converted(client):
    sample = create_root(client, "S-001", current_quantity="1", quantity_unit="mL")
    definition = create_definition(client)

    execution = record(client, sample["sample_id"], definition["assay_definition_id"], volume_used="250", volume_unit="µL").json()

    assert client.get(f"/samples/{sample['sample_id']}").json()["availability"]["available_quantity"] == "0.750000"
    assert (execution["volume_used"], execution["volume_unit"]) == ("0.250000", "mL")


def test_volume_beyond_what_is_available_records_nothing(client):
    sample = create_root(client, "S-001", current_quantity="10", quantity_unit="uL")
    definition = create_definition(client)
    before = execution_count(client)

    too_much = record(client, sample["sample_id"], definition["assay_definition_id"], volume_used="15", results=[{"result_name": "CT", "numeric_value": "30"}])
    wrong_unit = record(client, sample["sample_id"], definition["assay_definition_id"], volume_used="5", volume_unit="ng")

    assert too_much.status_code == 422 and "only 10 uL is recorded" in field_errors(too_much)["volume_used"]
    assert wrong_unit.status_code == 422 and "recorded in uL" in field_errors(wrong_unit)["volume_used"]
    assert execution_count(client) == before
    assert client.get(f"/samples/{sample['sample_id']}").json()["quantity_events"] == []


def test_unknown_availability_is_not_treated_as_unlimited(client):
    no_quantity = create_root(client, "S-001")
    no_unit = create_root(client, "S-002", current_quantity="10")
    definition = create_definition(client)

    for sample in (no_quantity, no_unit):
        response = record(client, sample["sample_id"], definition["assay_definition_id"], volume_used="5")
        assert response.status_code == 422 and "cannot be deducted" in field_errors(response)["volume_used"]
    assert record(client, no_quantity["sample_id"], definition["assay_definition_id"]).status_code == 201, "an execution without a volume is still fine"


def test_outputs_and_further_executions_do_not_count_the_volume_twice(client):
    sample = create_root(client, "S-001", current_quantity="100", quantity_unit="uL")
    definition = create_definition(client)
    first = record(client, sample["sample_id"], definition["assay_definition_id"], volume_used="20").json()

    client.post(f"/assay-executions/{first['execution_id']}/output-samples", json={"sample_code": "S-001-LIB", "current_quantity": "15", "quantity_unit": "uL"})
    record(client, sample["sample_id"], definition["assay_definition_id"], volume_used="5")

    detail = client.get(f"/samples/{sample['sample_id']}").json()
    assert detail["availability"]["available_quantity"] == "75.000000"
    assert sorted(event["quantity_change"] for event in detail["quantity_events"]) == ["-20.000000", "-5.000000"]


def test_results_can_be_recorded_with_the_execution(client):
    sample = create_root(client, "S-001", current_quantity="20", quantity_unit="uL")
    duplex = create_definition(client, "Duplex", expected_results=[{"analyte": "LACV", "result_name": "CT"}, {"analyte": "RNase P", "result_name": "CT"}])

    execution = record(client, sample["sample_id"], duplex["assay_definition_id"], volume_used="5", results=[
        {"analyte": "LACV", "result_name": "CT", "text_value": "not detected", "interpretation": "negative"},
        {"analyte": "RNase P", "result_name": "CT", "numeric_value": "26.4", "unit": "cycles"},
    ])

    assert execution.status_code == 201, execution.text
    assert [(r["analyte"], r["numeric_value"], r["text_value"], r["qc_status"]) for r in execution.json()["results"]] == [
        ("LACV", None, "not detected", "not_reviewed"), ("RNase P", "26.40000000", None, "not_reviewed"),
    ]
    blank = record(client, sample["sample_id"], duplex["assay_definition_id"], results=[{"result_name": "CT"}])
    assert blank.status_code == 422 and "Enter a value" in blank.text
