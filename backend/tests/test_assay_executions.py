"""Assay definition -> execution -> many Samples -> one result set per Sample (a value, interpretation and QC per result field)."""

DUPLEX_FIELDS = [
    {"analyte": "LACV", "result_name": "CT", "unit": "cycles"},
    {"analyte": "RNase P", "result_name": "CT", "unit": "cycles", "value_type": "numeric"},
]


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def create_definition(client, name="LACV duplex v3", result_fields=DUPLEX_FIELDS, **fields):
    payload = {"assay_name": name, "assay_type": "qPCR", "target": "LACV", "result_fields": result_fields, **fields}
    response = client.post("/assay-definitions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def field_ids(definition):
    return [field["assay_definition_result_id"] for field in definition["result_fields"]]


def execute(client, definition_id, samples, **fields):
    return client.post(f"/assay-definitions/{definition_id}/executions", json={"samples": samples, **fields})


def created(response):
    assert response.status_code == 201, response.text
    return response.json()


def field_errors(response):
    return {tuple(item["loc"][1:]): item["msg"] for item in response.json()["detail"]}


def execution_count(client):
    return sum(row["execution_count"] for row in client.get("/assay-definitions").json())


def results_of(row):
    """A Sample row's result set as {field id: (numeric, text, interpretation, qc)}."""
    return {item["assay_definition_result_id"]: (item["numeric_value"], item["text_value"], item["interpretation"], item["qc_status"]) for item in row["results"]}


def set_result(client, execution, sample, field_id, **changes):
    return client.patch(f"/assay-executions/{execution['assay_execution_id']}/samples/{sample['sample_id']}/results/{field_id}", json=changes)


def test_ten_samples_are_added_before_the_assay_is_done_with_every_result_field_null(client):
    definition = create_definition(client)
    samples = [create_root(client, f"S-{n:03d}") for n in range(1, 11)]

    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]} for sample in samples]))
    blanks = created(execute(client, definition["assay_definition_id"], [
        {"sample_id": samples[0]["sample_id"], "results": [{"assay_definition_result_id": field_id, "value": "", "interpretation": " "} for field_id in field_ids(definition)]},
    ]))

    assert len(execution["samples"]) == 10
    assert all(row["results"] == [] for row in execution["samples"]), "nothing is stored until something is entered"
    assert blanks["samples"][0]["results"] == [], "blank cells are null, not empty strings"
    detail = client.get(f"/assay-definitions/{definition['assay_definition_id']}").json()
    assert [field["label"] for field in detail["result_fields"]] == ["LACV CT", "RNase P CT"]
    assert all(summary["empty_count"] == 11 and summary["mean"] is None for summary in detail["result_summaries"])


def test_results_are_entered_later_field_by_field_and_each_sample_keeps_its_own(client):
    definition = create_definition(client)
    lacv, rnase = field_ids(definition)
    a, b = create_root(client, "S-A"), create_root(client, "S-B")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": a["sample_id"]}, {"sample_id": b["sample_id"]}]))

    set_result(client, execution, a, lacv, value="31.2", interpretation="positive")
    set_result(client, execution, a, rnase, value="25.9")
    after = set_result(client, execution, b, lacv, value="not detected", interpretation="negative").json()

    rows = {row["sample"]["sample_code"]: results_of(row) for row in after["samples"]}
    assert rows["S-A"] == {lacv: ("31.20000000", None, "positive", "not_reviewed"), rnase: ("25.90000000", None, None, "not_reviewed")}
    assert rows["S-B"] == {lacv: (None, "not detected", "negative", "not_reviewed")}, "partial: Sample B has no RNase P CT yet"

    changed = set_result(client, execution, a, lacv, value="30.8").json()
    rows = {row["sample"]["sample_code"]: results_of(row) for row in changed["samples"]}
    assert rows["S-A"][lacv] == ("30.80000000", None, "positive", "not_reviewed"), "only the value changed; the interpretation stays"
    assert rows["S-B"] == {lacv: (None, "not detected", "negative", "not_reviewed")}, "changing Sample A leaves Sample B alone"


def test_results_can_be_given_when_the_execution_is_created(client):
    definition = create_definition(client)
    lacv, rnase = field_ids(definition)
    a, b, c = (create_root(client, code) for code in ("S-A", "S-B", "S-C"))

    execution = created(execute(client, definition["assay_definition_id"], [
        {"sample_id": a["sample_id"], "results": [{"assay_definition_result_id": lacv, "value": "33.1", "interpretation": "positive", "qc_status": "accepted"}, {"assay_definition_result_id": rnase, "value": "24.2"}]},
        {"sample_id": b["sample_id"], "results": [{"assay_definition_result_id": rnase, "value": "26"}]},
        {"sample_id": c["sample_id"]},
    ]))

    assert [results_of(row) for row in execution["samples"]] == [
        {lacv: ("33.10000000", None, "positive", "accepted"), rnase: ("24.20000000", None, None, "not_reviewed")},
        {rnase: ("26.00000000", None, None, "not_reviewed")},
        {},
    ]


def test_clearing_a_field_returns_it_to_null(client):
    definition = create_definition(client)
    lacv, _ = field_ids(definition)
    sample = create_root(client, "S-A")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"], "results": [{"assay_definition_result_id": lacv, "value": "30", "interpretation": "positive"}]}]))

    only_value = set_result(client, execution, sample, lacv, value="").json()["samples"][0]
    cleared = set_result(client, execution, sample, lacv, interpretation=None).json()["samples"][0]

    assert results_of(only_value) == {lacv: (None, None, "positive", "not_reviewed")}
    assert cleared["results"] == []
    assert set_result(client, execution, sample, lacv, qc_status="accepted").status_code == 422, "QC needs something entered"


def test_accepted_results_are_locked_until_qc_is_reopened(client):
    definition = create_definition(client)
    lacv, _ = field_ids(definition)
    sample = create_root(client, "S-A")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"], "results": [{"assay_definition_result_id": lacv, "value": "30", "qc_status": "accepted"}]}]))

    assert set_result(client, execution, sample, lacv, value="31").status_code == 409
    assert set_result(client, execution, sample, lacv, value="").status_code == 409
    reopened = set_result(client, execution, sample, lacv, qc_status="not_reviewed", value="31")
    assert reopened.status_code == 200 and results_of(reopened.json()["samples"][0])[lacv] == ("31.00000000", None, None, "not_reviewed")


def test_value_types_follow_each_field(client):
    definition = create_definition(client, result_fields=[
        {"result_name": "Concentration", "unit": "ng/uL", "value_type": "numeric"},
        {"result_name": "CPE", "value_type": "text"},
    ])
    concentration, cpe = field_ids(definition)
    sample = create_root(client, "S-A")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"], "results": [{"assay_definition_result_id": cpe, "value": "12"}]}]))

    refused = set_result(client, execution, sample, concentration, value="high")

    assert refused.status_code == 422 and "Concentration must be a number" in refused.text
    assert results_of(execution["samples"][0])[cpe] == (None, "12", None, "not_reviewed"), "a text field keeps numbers as text"


def test_a_sample_takes_part_in_several_executions_including_of_the_same_assay(client):
    qpcr = create_definition(client)
    lacv, _ = field_ids(qpcr)
    culture = create_definition(client, name="Culture check", assay_type="Culture", result_fields=[{"result_name": "CPE", "value_type": "text"}])
    sample = create_root(client, "S-001")
    other = create_root(client, "S-002")

    created(execute(client, qpcr["assay_definition_id"], [{"sample_id": sample["sample_id"]}, {"sample_id": other["sample_id"]}], status="failed"))
    created(execute(client, qpcr["assay_definition_id"], [{"sample_id": sample["sample_id"], "results": [{"assay_definition_result_id": lacv, "value": "30"}]}]))
    created(execute(client, culture["assay_definition_id"], [{"sample_id": sample["sample_id"], "results": [{"assay_definition_result_id": field_ids(culture)[0], "value": "CPE observed"}]}]))

    history = client.get(f"/samples/{sample['sample_id']}").json()["assays"]
    assert sorted((row["execution_name"], row["sample_count"], [(item["label"], item["numeric_value"], item["text_value"]) for item in row["results"]]) for row in history) == [
        ("CULTURE-CHECK-001", 1, [("CPE", None, "CPE observed")]),
        ("LACV-DUPLEX-V3-001", 2, []),
        ("LACV-DUPLEX-V3-002", 1, [("LACV CT", "30.00000000", None)]),
    ]
    detail = client.get(f"/assay-definitions/{qpcr['assay_definition_id']}").json()
    assert (detail["execution_count"], detail["sample_count"]) == (2, 2), "executions, not Sample rows; distinct Samples"


def test_a_sample_appears_once_per_execution_and_a_field_once_per_sample(client):
    definition = create_definition(client)
    lacv, _ = field_ids(definition)
    sample = create_root(client, "S-001")
    before = execution_count(client)

    twice = execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}, {"sample_id": sample["sample_id"]}])
    same_field = execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"], "results": [{"assay_definition_result_id": lacv, "value": "1"}, {"assay_definition_result_id": lacv, "value": "2"}]}])
    foreign = execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"], "results": [{"assay_definition_result_id": 999999, "value": "1"}]}])
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}]))
    added_again = client.post(f"/assay-executions/{execution['assay_execution_id']}/samples", json={"sample_id": sample["sample_id"]})

    assert "already in this execution" in field_errors(twice)[("samples", 1, "sample_id")]
    assert "is given twice" in field_errors(same_field)[("samples", 0, "results", 1, "assay_definition_result_id")]
    assert "not part of this assay" in field_errors(foreign)[("samples", 0, "results", 0, "assay_definition_result_id")]
    assert added_again.status_code == 422
    assert execution_count(client) == before + 1


def test_creation_is_all_or_nothing(client):
    definition = create_definition(client)
    _, rnase = field_ids(definition)
    good = create_root(client, "S-001", current_quantity="10", quantity_unit="uL")
    before = execution_count(client)

    response = execute(client, definition["assay_definition_id"], [
        {"sample_id": good["sample_id"], "results": [{"assay_definition_result_id": rnase, "value": "25"}], "volume_used": "2"},
        {"sample_id": 999999},
        {"sample_id": create_root(client, "S-002")["sample_id"], "results": [{"assay_definition_result_id": rnase, "value": "positive"}]},
    ])

    assert response.status_code == 422
    assert field_errors(response) == {
        ("samples", 1, "sample_id"): "Sample not found: 999999",
        ("samples", 2, "results", 0, "value"): 'S-002: RNase P CT must be a number, not "positive"',
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
    renamed = client.patch(f"/assay-executions/{first['assay_execution_id']}", json={"execution_name": "Plate 1, rerun"})
    clash = client.patch(f"/assay-executions/{third['assay_execution_id']}", json={"execution_name": "Plate 7"})

    assert detail["next_execution_name"] == "LACV-DUPLEX-V3-001"
    assert (first["execution_name"], named["execution_name"], third["execution_name"]) == ("LACV-DUPLEX-V3-001", "Plate 7", "LACV-DUPLEX-V3-002")
    assert renamed.status_code == 200 and renamed.json()["assay_execution_id"] == first["assay_execution_id"]
    assert clash.status_code == 400 and "already has an execution named Plate 7" in clash.text


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
    lacv, _ = field_ids(definition)
    first = create_root(client, "S-001", current_quantity="10", quantity_unit="uL")
    second = create_root(client, "S-002")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": first["sample_id"], "volume_used": "2"}]))
    base = f"/assay-executions/{execution['assay_execution_id']}/samples"

    added = client.post(base, json={"sample_id": second["sample_id"], "results": [{"assay_definition_result_id": lacv, "value": "29.1"}]})
    used = client.delete(f"{base}/{first['sample_id']}")
    removed = client.delete(f"{base}/{second['sample_id']}")
    last = client.delete(f"{base}/{first['sample_id']}")

    assert added.status_code == 201 and results_of(added.json()["samples"][1]) == {lacv: ("29.10000000", None, None, "not_reviewed")}
    assert used.status_code == 409 and "used some of its volume" in used.text
    assert removed.status_code == 200 and [row["sample"]["sample_code"] for row in removed.json()["samples"]] == ["S-001"]
    assert last.status_code == 409


def test_an_execution_can_produce_a_derived_sample_from_one_of_its_samples(client):
    definition = create_definition(client, name="Amplicon sequencing", assay_type="Sequencing", result_fields=[{"result_name": "Reads", "value_type": "numeric"}])
    sample = create_root(client, "S-001")
    execution = created(execute(client, definition["assay_definition_id"], [{"sample_id": sample["sample_id"]}]))

    produced = client.post(f"/assay-executions/{execution['assay_execution_id']}/samples/{sample['sample_id']}/outputs", json={"sample_code": "S-001-LIB"})

    assert produced.status_code == 201 and [row["sample_code"] for row in produced.json()["output_samples"]] == ["S-001-LIB"]
    library = client.get(f"/samples/{produced.json()['output_samples'][0]['sample_id']}").json()
    assert library["parent"]["sample_code"] == "S-001"
    assert [row["execution_name"] for row in library["generated_by_assays"]] == [execution["execution_name"]]
    assert client.delete(f"/assay-executions/{execution['assay_execution_id']}/samples/{sample['sample_id']}").status_code == 409


def test_a_retired_assay_takes_no_new_executions(client):
    retired = next(row for row in client.get("/assay-definitions").json() if not row["is_active"])
    response = execute(client, retired["assay_definition_id"], [{"sample_id": create_root(client, "S-001")["sample_id"]}])

    assert response.status_code == 422 and "retired" in response.text
    assert all(row["is_active"] for row in client.get("/assay-definitions", params={"active_only": True}).json())
