"""Recording an assay on a Sample: generated code, workflow state, performed by, and the volume it used."""


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def record(client, sample_id, **fields):
    return client.post(f"/samples/{sample_id}/assays", json={"assay_type": "qPCR", **fields})


def field_errors(response):
    return {item["loc"][-1]: item["msg"] for item in response.json()["detail"]}


def assay_count(client):
    return len(client.get("/assays").json())


def test_recorded_assay_gets_a_code_and_starts_completed_and_unreviewed(client):
    sample = create_root(client, "S-001")

    first = record(client, sample["sample_id"], assay_name="LACV screening", target="LACV", assay_date="2026-10-30T14:05:00")
    second = record(client, sample["sample_id"])

    assert first.status_code == 201, first.text
    assay = first.json()
    # Seed data holds ASSAY-001 to ASSAY-050.
    assert (assay["assay_code"], second.json()["assay_code"]) == ("ASSAY-051", "ASSAY-052")
    assert (assay["status"], assay["qc_status"]) == ("completed", "not_reviewed")
    assert (assay["assay_type"], assay["assay_name"], assay["target"]) == ("qPCR", "LACV screening", "LACV")
    assert assay["assay_date"] == "2026-10-30T14:05:00"


def test_a_code_can_still_be_given(client):
    sample = create_root(client, "S-001")

    assay = record(client, sample["sample_id"], assay_instance_code="QPCR-7").json()

    assert assay["assay_code"] == "QPCR-7"
    assert record(client, sample["sample_id"], assay_instance_code="QPCR-7").status_code == 400


def test_an_existing_assay_definition_can_be_chosen(client):
    sample = create_root(client, "S-001")
    definition = client.get("/assays/definitions").json()[0]

    assay = client.post(f"/samples/{sample['sample_id']}/assays", json={"assay_definition_id": definition["assay_definition_id"]}).json()

    assert (assay["assay_name"], assay["assay_type"], assay["target"]) == (definition["assay_name"], definition["assay_type"], definition["target"])


def test_an_assay_needs_a_definition_or_a_type(client):
    sample = create_root(client, "S-001")

    response = client.post(f"/samples/{sample['sample_id']}/assays", json={"operator_name": "Ana"})

    assert response.status_code == 422 and "assay_type" in field_errors(response)


def test_performed_by_is_stored_as_the_operator_name(client):
    sample = create_root(client, "S-001")

    assay = record(client, sample["sample_id"], operator_name="  Jane   Doe ").json()

    assert assay["operator_name"] == "Jane Doe"
    assert client.get(f"/assays/{assay['assay_id']}").json()["operator_name"] == "Jane Doe"


def test_performed_by_suggestions_are_distinct_and_most_recent_first(client):
    sample = create_root(client, "S-001")
    for name in ["Michael Clark", "M. Clark", "Jane  Doe", "", "Michael Clark"]:
        record(client, sample["sample_id"], operator_name=name)

    names = client.get("/assays/performed-by").json()

    assert names[:3] == ["Michael Clark", "Jane Doe", "M. Clark"]
    assert len(names) == len(set(names)) and "" not in names
    assert "Seed Operator 50" in names


def test_volume_used_is_one_removal_on_the_samples_ledger(client):
    sample = create_root(client, "S-001", current_quantity="100", quantity_unit="uL")

    assay = record(client, sample["sample_id"], volume_used="20", operator_name="Ana").json()

    detail = client.get(f"/samples/{sample['sample_id']}").json()
    assert (detail["availability"]["available_quantity"], detail["availability"]["percent_remaining"]) == ("80.000000", 80.0)
    assert [(event["event_type"], event["quantity_change"], event["related_assay_id"]) for event in detail["quantity_events"]] == [("consumed", "-20.000000", assay["assay_id"])]
    assert (assay["volume_used"], assay["volume_unit"]) == ("20.000000", "uL")


def test_volume_in_a_compatible_unit_is_converted(client):
    sample = create_root(client, "S-001", current_quantity="1", quantity_unit="mL")

    assay = record(client, sample["sample_id"], volume_used="250", volume_unit="µL").json()

    assert client.get(f"/samples/{sample['sample_id']}").json()["availability"]["available_quantity"] == "0.750000"
    assert (assay["volume_used"], assay["volume_unit"]) == ("0.250000", "mL")


def test_volume_beyond_what_is_available_records_nothing(client):
    sample = create_root(client, "S-001", current_quantity="10", quantity_unit="uL")
    before = assay_count(client)

    too_much = record(client, sample["sample_id"], volume_used="15")
    wrong_unit = record(client, sample["sample_id"], volume_used="5", volume_unit="ng")

    assert too_much.status_code == 422 and "only 10 uL is recorded" in field_errors(too_much)["volume_used"]
    assert wrong_unit.status_code == 422 and "recorded in uL" in field_errors(wrong_unit)["volume_used"]
    assert assay_count(client) == before
    assert client.get(f"/samples/{sample['sample_id']}").json()["quantity_events"] == []


def test_unknown_availability_is_not_treated_as_unlimited(client):
    no_quantity = create_root(client, "S-001")
    no_unit = create_root(client, "S-002", current_quantity="10")

    for sample in (no_quantity, no_unit):
        response = record(client, sample["sample_id"], volume_used="5")
        assert response.status_code == 422 and "cannot be deducted" in field_errors(response)["volume_used"]
    assert record(client, no_quantity["sample_id"]).status_code == 201, "an assay without a volume is still fine"


def test_outputs_and_further_assays_do_not_count_the_volume_twice(client):
    sample = create_root(client, "S-001", current_quantity="100", quantity_unit="uL")
    first = record(client, sample["sample_id"], volume_used="20").json()

    client.post(f"/assays/{first['assay_id']}/output-samples", json={"sample_code": "S-001-LIB", "current_quantity": "15", "quantity_unit": "uL"})
    record(client, sample["sample_id"], volume_used="5")

    detail = client.get(f"/samples/{sample['sample_id']}").json()
    assert detail["availability"]["available_quantity"] == "75.000000"
    assert sorted(event["quantity_change"] for event in detail["quantity_events"]) == ["-20.000000", "-5.000000"]
