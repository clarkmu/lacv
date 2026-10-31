"""Assay definition (reusable procedure) -> execution on one Sample -> results."""


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def create_definition(client, **fields):
    payload = {"assay_name": "LACV qPCR v3", "assay_type": "qPCR", "target": "LACV", **fields}
    response = client.post("/assay-definitions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def execute(client, sample_id, definition_id, **fields):
    response = client.post(f"/samples/{sample_id}/assay-executions", json={"assay_definition_id": definition_id, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_a_definition_describes_the_procedure_not_an_execution(client):
    definition = create_definition(
        client, kit="PowerUp SYBR Green", instrument="QuantStudio 5", typical_volume="2", typical_volume_unit="uL",
        description="40 cycles", expected_results=[{"analyte": "LACV", "result_name": "CT", "unit": "cycles"}],
    )

    assert definition["assay_code"] == "LACV-QPCR-V3"
    assert (definition["kit"], definition["instrument"], definition["typical_volume"], definition["typical_volume_unit"]) == ("PowerUp SYBR Green", "QuantStudio 5", "2.000000", "uL")
    assert definition["expected_results"] == [{"analyte": "LACV", "result_name": "CT", "unit": "cycles", "value_type": "either"}]
    assert (definition["execution_count"], definition["executions"]) == (0, [])
    assert "operator_name" not in definition and "sample" not in definition


def test_one_definition_is_used_by_many_samples(client):
    definition = create_definition(client)
    samples = [create_root(client, f"S-00{n}") for n in (1, 2, 3)]
    for sample in samples:
        execute(client, sample["sample_id"], definition["assay_definition_id"], operator_name="Ana")

    detail = client.get(f"/assay-definitions/{definition['assay_definition_id']}").json()
    listed = next(row for row in client.get("/assay-definitions").json() if row["assay_definition_id"] == definition["assay_definition_id"])

    assert sorted(execution["sample"]["sample_code"] for execution in detail["executions"]) == ["S-001", "S-002", "S-003"]
    assert (detail["execution_count"], detail["sample_count"]) == (3, 3)
    assert (listed["execution_count"], listed["sample_count"]) == (3, 3)
    assert len(client.get("/assay-executions", params={"assay_definition_id": definition["assay_definition_id"]}).json()) == 3


def test_one_sample_has_several_executions(client):
    sample = create_root(client, "S-001")
    qpcr = create_definition(client)
    culture = create_definition(client, assay_name="Viral culture", assay_type="Culture")

    first = execute(client, sample["sample_id"], qpcr["assay_definition_id"], status="failed", notes="NTC amplified")
    repeat = execute(client, sample["sample_id"], qpcr["assay_definition_id"])
    execute(client, sample["sample_id"], culture["assay_definition_id"])

    detail = client.get(f"/samples/{sample['sample_id']}").json()
    assert sorted((a["assay_name"], a["status"]) for a in detail["assays"]) == [
        ("LACV qPCR v3", "completed"), ("LACV qPCR v3", "failed"), ("Viral culture", "completed"),
    ]
    assert first["execution_id"] != repeat["execution_id"]
    assert client.get(f"/assay-definitions/{qpcr['assay_definition_id']}").json()["sample_count"] == 1


def test_one_execution_has_several_results_that_can_be_added_edited_and_removed(client):
    sample = create_root(client, "S-001")
    execution = execute(client, sample["sample_id"], create_definition(client)["assay_definition_id"])
    base = f"/assay-executions/{execution['execution_id']}/results"

    client.post(base, json={"analyte": "LACV", "result_name": "CT", "text_value": "not detected", "interpretation": "negative"})
    with_two = client.post(base, json={"analyte": "RNase P", "result_name": "CT", "numeric_value": "25.9", "unit": "cycles"}).json()
    rnase = with_two["results"][1]
    edited = client.patch(f"{base}/{rnase['assay_result_id']}", json={"numeric_value": "26.1"}).json()
    removed = client.delete(f"{base}/{with_two['results'][0]['assay_result_id']}").json()

    assert [(r["analyte"], r["numeric_value"]) for r in with_two["results"]] == [("LACV", None), ("RNase P", "25.90000000")]
    assert edited["results"][1]["numeric_value"] == "26.10000000"
    assert [r["analyte"] for r in removed["results"]] == ["RNase P"]
    assert all(result["assay_result_id"] for result in removed["results"])
    assert client.get(f"/samples/{sample['sample_id']}").json()["assays"][0]["result_count"] == 1


def test_results_belong_to_their_own_execution(client):
    sample = create_root(client, "S-001")
    definition = create_definition(client)
    first = execute(client, sample["sample_id"], definition["assay_definition_id"], results=[{"result_name": "CT", "numeric_value": "30"}])
    second = execute(client, sample["sample_id"], definition["assay_definition_id"])

    response = client.patch(f"/assay-executions/{second['execution_id']}/results/{first['results'][0]['assay_result_id']}", json={"numeric_value": "1"})

    assert response.status_code == 404
    assert client.get(f"/assay-executions/{first['execution_id']}").json()["results"][0]["numeric_value"] == "30.00000000"


def test_accepted_results_are_locked_until_qc_is_reopened(client):
    sample = create_root(client, "S-001")
    execution = execute(client, sample["sample_id"], create_definition(client)["assay_definition_id"], results=[{"result_name": "CT", "numeric_value": "30", "qc_status": "accepted"}])
    url = f"/assay-executions/{execution['execution_id']}/results/{execution['results'][0]['assay_result_id']}"

    assert client.patch(url, json={"numeric_value": "31"}).status_code == 409
    assert client.delete(url).status_code == 409
    reopened = client.patch(url, json={"qc_status": "not_reviewed"})
    corrected = client.patch(url, json={"numeric_value": "31"})

    assert reopened.status_code == 200 and corrected.json()["results"][0]["numeric_value"] == "31.00000000"
    assert client.patch(url, json={"numeric_value": None}).status_code == 422, "a result keeps a value"


def test_definition_names_are_unique_per_type_and_editable(client):
    definition = create_definition(client)

    duplicate = client.post("/assay-definitions", json={"assay_name": "lacv QPCR v3", "assay_type": "qpcr"})
    renamed = client.patch(f"/assay-definitions/{definition['assay_definition_id']}", json={
        "kit": "TaqPath", "is_active": False, "expected_results": [{"result_name": "CT", "value_type": "numeric"}],
    })

    assert duplicate.status_code == 400 and "already exists" in duplicate.text
    assert renamed.status_code == 200
    assert (renamed.json()["kit"], renamed.json()["is_active"], renamed.json()["expected_results"][0]["value_type"]) == ("TaqPath", False, "numeric")
    assert client.post("/assay-definitions", json={"assay_name": "No unit", "assay_type": "qPCR", "typical_volume": "2"}).status_code == 422


def test_seeded_definitions_are_reused_across_samples(client):
    definitions = {row["assay_code"]: row for row in client.get("/assay-definitions").json()}

    sybr = definitions["LACV-QPCR-SYBR"]
    duplex = client.get(f"/assay-definitions/{definitions['LACV-RNASEP-DUPLEX']['assay_definition_id']}").json()

    assert sybr["sample_count"] >= 20 and sybr["execution_count"] > sybr["sample_count"], "some Samples were run twice"
    assert all(len(execution_results(client, execution)) == 2 for execution in duplex["executions"][:3])
    assert not definitions["LACV-QPCR-V1"]["is_active"]


def execution_results(client, execution):
    return client.get(f"/assay-executions/{execution['execution_id']}").json()["results"]
