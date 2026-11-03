"""Assay definition -> execution -> many Samples -> at most one result per Sample in an execution."""


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def create_definition(client, name="LACV qPCR v3", **fields):
    payload = {"assay_name": name, "assay_type": "qPCR", "target": "LACV", "result_name": "LACV CT", "result_unit": "cycles", **fields}
    response = client.post("/assay-definitions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def execute(client, definition_id, samples, **fields):
    return client.post(f"/assay-definitions/{definition_id}/executions", json={"samples": samples, **fields})


def created(response):
    assert response.status_code == 201, response.text
    return response.json()


def field_errors(response):
    return {tuple(item["loc"][1:]): item["msg"] for item in response.json()["detail"]}


def execution_count(client):
    return sum(row["execution_count"] for row in client.get("/assay-definitions").json())


def test_one_execution_holds_several_samples_each_with_its_own_result(client):
    definition = create_definition(client)
    samples = [create_root(client, f"S-00{n}") for n in (1, 2, 3)]

    execution = created(execute(client, definition["assay_definition_id"], [
        {"sample_id": samples[0]["sample_id"], "result": "31.2"},
        {"sample_id": samples[1]["sample_id"], "result": "not detected"},
        {"sample_id": samples[2]["sample_id"]},
    ], operator_name="Ana", assay_date="2026-11-03T10:00:00"))

    assert [(row["sample"]["sample_code"], row["result_numeric"], row["result_text"]) for row in execution["samples"]] == [
        ("S-001", "31.20000000", None), ("S-002", None, "not detected"), ("S-003", None, None),
    ]
    assert (execution["operator_name"], execution["status"], execution["qc_status"]) == ("Ana", "completed", "not_reviewed")
    detail = client.get(f"/assay-definitions/{definition['assay_definition_id']}").json()
    assert (detail["execution_count"], detail["sample_count"]) == (1, 3)
    assert [len(row["samples"]) for row in detail["executions"]] == [3]


def test_a_sample_takes_part_in_several_executions_including_of_the_same_assay(client):
    qpcr = create_definition(client)
    culture = create_definition(client, name="Culture check", assay_type="Culture", result_name="CPE", result_unit=None, result_value_type="text")
    sample = create_root(client, "S-001")
    other = create_root(client, "S-002")

    first = created(execute(client, qpcr["assay_definition_id"], [{"sample_id": sample["sample_id"]}, {"sample_id": other["sample_id"]}], status="failed"))
    repeat = created(execute(client, qpcr["assay_definition_id"], [{"sample_id": sample["sample_id"], "result": "30"}]))
    created(execute(client, culture["assay_definition_id"], [{"sample_id": sample["sample_id"], "result": "CPE observed"}]))

    history = client.get(f"/samples/{sample['sample_id']}").json()["assays"]
    assert sorted((row["execution_name"], row["sample_count"], row["result_numeric"], row["result_text"]) for row in history) == [
        ("CULTURE-CHECK-001", 1, None, "CPE observed"), ("LACV-QPCR-V3-001", 2, None, None), ("LACV-QPCR-V3-002", 1, "30.00000000", None),
    ]
    qpcr_detail = client.get(f"/assay-definitions/{qpcr['assay_definition_id']}").json()
    assert (qpcr_detail["execution_count"], qpcr_detail["sample_count"]) == (2, 2), "executions, not Sample rows; distinct Samples"
    assert first["assay_execution_id"] != repeat["assay_execution_id"]


def test_a_sample_appears_once_per_execution(client):
    definition = create_definition(client)
    sample = create_root(client, "S-001")
    before = execution_count(client)

    twice = execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}, {"sample_id": sample["sample_id"], "result": "1"}])
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}]))
    added_again = client.post(f"/assay-executions/{execution['assay_execution_id']}/samples", json={"sample_id": sample["sample_id"]})

    assert twice.status_code == 422 and "already in this execution" in field_errors(twice)[("samples", 1, "sample_id")]
    assert added_again.status_code == 422 and "already in this execution" in added_again.text
    assert execution_count(client) == before + 1


def test_creation_is_all_or_nothing(client):
    definition = create_definition(client, result_value_type="numeric")
    good = create_root(client, "S-001", current_quantity="10", quantity_unit="uL")
    before = execution_count(client)

    response = execute(client, definition["assay_definition_id"], [
        {"sample_id": good["sample_id"], "result": "30", "volume_used": "2"},
        {"sample_id": 999999},
        {"sample_id": create_root(client, "S-002")["sample_id"], "result": "positive"},
    ])

    assert response.status_code == 422
    assert field_errors(response) == {
        ("samples", 1, "sample_id"): "Sample not found: 999999",
        ("samples", 2, "result"): 'S-002: LACV CT must be a number, not "positive"',
    }
    assert execution_count(client) == before
    reloaded = client.get(f"/samples/{good['sample_id']}").json()
    assert (reloaded["current_quantity"], reloaded["quantity_events"], reloaded["assays"]) == ("10.000000", [], []), "the valid row was not kept either"


def test_names_are_generated_per_assay_and_editable(client):
    definition = create_definition(client)
    sample = create_root(client, "S-001")
    detail = client.get(f"/assay-definitions/{definition['assay_definition_id']}").json()

    first = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}]))
    named = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}], execution_name="Plate 7"))
    third = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}]))
    renamed = client.patch(f"/assay-executions/{first['assay_execution_id']}", json={"execution_name": "Plate 1, rerun 2026-11-03"})
    clash = client.patch(f"/assay-executions/{third['assay_execution_id']}", json={"execution_name": "Plate 7"})

    assert detail["next_execution_name"] == "LACV-QPCR-V3-001"
    assert (first["execution_name"], named["execution_name"], third["execution_name"]) == ("LACV-QPCR-V3-001", "Plate 7", "LACV-QPCR-V3-002")
    assert renamed.status_code == 200 and renamed.json()["execution_name"] == "Plate 1, rerun 2026-11-03"
    assert renamed.json()["assay_execution_id"] == first["assay_execution_id"], "the name is a label; the id is the identity"
    assert clash.status_code == 400 and "already has an execution named Plate 7" in clash.text
    other = create_definition(client, name="Other qPCR")
    assert created(execute(client, other["assay_definition_id"], [{"sample_id": sample["sample_id"]}], execution_name="Plate 7"))["execution_name"] == "Plate 7"


def test_results_start_empty_and_are_entered_changed_and_cleared(client):
    definition = create_definition(client)
    sample = create_root(client, "S-001")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}]))
    url = f"/assay-executions/{execution['assay_execution_id']}/samples/{sample['sample_id']}"

    assert (execution["samples"][0]["result_numeric"], execution["samples"][0]["result_text"]) == (None, None)
    entered = client.patch(url, json={"result": " 33.4 "}).json()["samples"][0]
    as_text = client.patch(url, json={"result": "not detected"}).json()["samples"][0]
    cleared = client.patch(url, json={"result": ""}).json()["samples"][0]

    assert (entered["result_numeric"], entered["result_text"]) == ("33.40000000", None)
    assert (as_text["result_numeric"], as_text["result_text"]) == (None, "not detected")
    assert (cleared["result_numeric"], cleared["result_text"]) == (None, None)
    assert client.patch(f"/assay-executions/{execution['assay_execution_id']}/samples/{create_root(client, 'S-X')['sample_id']}", json={"result": "1"}).status_code == 404


def test_result_types_follow_the_assay(client):
    numeric = create_definition(client, name="Qubit", assay_type="Quantification", result_name="Concentration", result_unit="ng/uL", result_value_type="numeric")
    text = create_definition(client, name="Culture", assay_type="Culture", result_name="CPE", result_unit=None, result_value_type="text")
    sample = create_root(client, "S-001")
    number_execution = created(execute(client, numeric["assay_definition_id"], [{"sample_id": sample["sample_id"], "result": "12.5"}]))
    text_execution = created(execute(client, text["assay_definition_id"], [{"sample_id": sample["sample_id"], "result": "12"}]))

    refused = client.patch(f"/assay-executions/{number_execution['assay_execution_id']}/samples/{sample['sample_id']}", json={"result": "high"})

    assert refused.status_code == 422 and "must be a number" in refused.text
    assert (text_execution["samples"][0]["result_numeric"], text_execution["samples"][0]["result_text"]) == (None, "12")


def test_execution_details_are_edited_on_the_execution(client):
    definition = create_definition(client)
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": create_root(client, "S-001")["sample_id"]}]))

    edited = client.patch(f"/assay-executions/{execution['assay_execution_id']}", json={
        "operator_name": "  Jane   Doe ", "qc_status": "accepted", "notes": "Plate 3", "assay_date": "2026-11-02T09:30:00",
    }).json()

    assert (edited["operator_name"], edited["qc_status"], edited["notes"], edited["assay_date"]) == ("Jane Doe", "accepted", "Plate 3", "2026-11-02T09:30:00")
    assert client.patch(f"/assay-executions/{execution['assay_execution_id']}", json={"status": ""}).status_code == 422


def test_performed_by_suggestions_are_distinct_and_most_recent_first(client):
    definition = create_definition(client)
    sample = create_root(client, "S-001")
    for name in ["Michael Clark", "M. Clark", "Jane  Doe", "", "Michael Clark"]:
        created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}], operator_name=name))

    names = client.get("/assay-executions/performed-by").json()

    assert names[:3] == ["Michael Clark", "Jane Doe", "M. Clark"]
    assert len(names) == len(set(names)) and "" not in names
    assert "A. Rivera" in names, "seeded names are suggested too"


def test_volume_used_is_one_removal_per_sample_on_its_ledger(client):
    definition = create_definition(client)
    tube = create_root(client, "S-001", current_quantity="1", quantity_unit="mL")
    other = create_root(client, "S-002", current_quantity="100", quantity_unit="uL")

    execution = created(execute(client, definition["assay_definition_id"], [
        {"sample_id": tube["sample_id"], "volume_used": "250", "volume_unit": "µL"},
        {"sample_id": other["sample_id"], "volume_used": "20"},
    ]))

    assert [(row["volume_used"], row["volume_unit"]) for row in execution["samples"]] == [("0.250000", "mL"), ("20.000000", "uL")]
    detail = client.get(f"/samples/{other['sample_id']}").json()
    assert detail["availability"]["available_quantity"] == "80.000000"
    assert [(event["quantity_change"], event["related_assay_execution_id"]) for event in detail["quantity_events"]] == [("-20.000000", execution["assay_execution_id"])]


def test_unknown_or_insufficient_quantity_is_refused_and_saves_nothing(client):
    definition = create_definition(client)
    small = create_root(client, "S-001", current_quantity="10", quantity_unit="uL")
    unknown = create_root(client, "S-002")
    before = execution_count(client)

    response = execute(client, definition["assay_definition_id"], [
        {"sample_id": small["sample_id"], "volume_used": "15"},
        {"sample_id": unknown["sample_id"], "volume_used": "5"},
    ])

    errors = field_errors(response)
    assert "only 10 uL is recorded" in errors[("samples", 0, "volume_used")]
    assert "cannot be deducted" in errors[("samples", 1, "volume_used")]
    assert execution_count(client) == before


def test_samples_are_added_later_and_removed_until_used(client):
    definition = create_definition(client)
    first = create_root(client, "S-001", current_quantity="10", quantity_unit="uL")
    second = create_root(client, "S-002")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": first["sample_id"], "volume_used": "2"}]))
    base = f"/assay-executions/{execution['assay_execution_id']}/samples"

    added = client.post(base, json={"sample_id": second["sample_id"], "result": "29.1"})
    used = client.delete(f"{base}/{first['sample_id']}")
    removed = client.delete(f"{base}/{second['sample_id']}")
    last = client.delete(f"{base}/{first['sample_id']}")

    assert added.status_code == 201 and [row["sample"]["sample_code"] for row in added.json()["samples"]] == ["S-001", "S-002"]
    assert used.status_code == 409 and "used some of its volume" in used.text
    assert removed.status_code == 200 and [row["sample"]["sample_code"] for row in removed.json()["samples"]] == ["S-001"]
    assert last.status_code == 409


def test_an_execution_can_produce_a_derived_sample_from_one_of_its_samples(client):
    definition = create_definition(client, name="Amplicon sequencing", assay_type="Sequencing")
    sample = create_root(client, "S-001")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}]))

    produced = client.post(f"/assay-executions/{execution['assay_execution_id']}/samples/{sample['sample_id']}/outputs", json={"sample_code": "S-001-LIB"})

    assert produced.status_code == 201 and [row["sample_code"] for row in produced.json()["output_samples"]] == ["S-001-LIB"]
    library = client.get(f"/samples/{produced.json()['output_samples'][0]['sample_id']}").json()
    assert library["parent"]["sample_code"] == "S-001"
    assert [row["execution_name"] for row in library["generated_by_assays"]] == [execution["execution_name"]]
    lineage = client.get(f"/samples/{sample['sample_id']}/lineage").json()
    assert lineage["descendants"][0]["generated_by"] == {"kind": "assay", "code": execution["execution_name"], "type": "Sequencing"}
    assert client.delete(f"/assay-executions/{execution['assay_execution_id']}/samples/{sample['sample_id']}").status_code == 409


def test_a_retired_assay_takes_no_new_executions(client):
    retired = next(row for row in client.get("/assay-definitions").json() if not row["is_active"])
    response = execute(client, retired["assay_definition_id"], [{"sample_id": create_root(client, "S-001")["sample_id"]}])

    assert response.status_code == 422 and "retired" in response.text
    assert all(row["is_active"] for row in client.get("/assay-definitions", params={"active_only": True}).json())
