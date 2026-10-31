"""Sample-centric API scenarios (see TDD.md), against a fresh schema.sql + seed.sql database."""


def lookup(client, code):
    response = client.get("/samples/lookup", params={"code": code})
    assert response.status_code == 200, response.text
    return response.json()


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_create_root_sample_with_inventory_fields(client):
    sample = create_root(
        client, "S-001", sample_type_id=1, label="Tube A", current_quantity="200", quantity_unit="uL",
        storage_location_id=1, status="received", notes="Arrived on ice",
    )

    assert sample["sample_type"] == "Blood (RNA shield)"
    assert sample["parent"] is None and sample["children"] == []
    assert (sample["current_quantity"], sample["storage_location"]["storage_location_id"]) == ("200.000000", 1)
    assert [event["event_type"] for event in sample["storage_events"]] == ["stored"]
    assert any(row["sample_code"] == "S-001" for row in client.get("/samples").json())


def test_duplicate_sample_codes_are_rejected(client):
    create_root(client, "S-001", notes="original")

    duplicate = client.post("/samples", json={"sample_code": "S-001", "notes": "copy"})

    assert duplicate.status_code == 400
    assert "already exists" in duplicate.json()["detail"]
    assert lookup(client, "S-001")["sample_id"] and client.get(f"/samples/{lookup(client, 'S-001')['sample_id']}").json()["notes"] == "original"


def test_inline_edit_persists(client):
    sample = create_root(client, "S-001")

    updated = client.patch(f"/samples/{sample['sample_id']}", json={"status": "received", "sample_type_id": 2, "notes": "checked"})

    assert updated.status_code == 200
    reloaded = client.get(f"/samples/{sample['sample_id']}").json()
    assert (reloaded["status"], reloaded["sample_type"], reloaded["notes"]) == ("received", "Swab (RNA shield)", "checked")


def test_children_link_to_parent_without_inheriting_values(client):
    parent = create_root(client, "S-001", sample_type_id=1, current_quantity="100", quantity_unit="uL", storage_location_id=1, notes="parent notes")

    first = client.post(f"/samples/{parent['sample_id']}/children", json={"sample_code": "S-001-A"}).json()
    second = client.post(f"/samples/{parent['sample_id']}/children", json={"sample_code": "S-001-B", "sample_type_id": 3}).json()

    assert first["parent"]["sample_code"] == "S-001"
    assert (first["sample_type"], first["current_quantity"], first["storage_location"], first["notes"], first["batch"]) == (None, None, None, None, None)
    assert second["sample_type"] == "Serum"
    assert [child["sample_code"] for child in client.get(f"/samples/{parent['sample_id']}/children").json()] == ["S-001-A", "S-001-B"]

    client.patch(f"/samples/{first['sample_id']}", json={"notes": "changed"})
    assert client.get(f"/samples/{second['sample_id']}").json()["notes"] is None
    assert client.get(f"/samples/{parent['sample_id']}").json()["notes"] == "parent notes"


def test_multi_generation_lineage_from_any_sample(client):
    root = create_root(client, "S-001")
    child = client.post(f"/samples/{root['sample_id']}/children", json={"sample_code": "S-001-A"}).json()
    grandchild = client.post(f"/samples/{child['sample_id']}/children", json={"sample_code": "S-001-A-1"}).json()

    lineage = client.get(f"/samples/{child['sample_id']}/lineage").json()
    assert [a["sample_code"] for a in lineage["ancestors"]] == ["S-001"]
    assert [d["sample_code"] for d in lineage["descendants"]] == ["S-001-A-1"]

    root_lineage = client.get(f"/samples/{root['sample_id']}/lineage").json()
    assert root_lineage["descendants"][0]["sample_code"] == "S-001-A"
    assert root_lineage["descendants"][0]["children"][0]["sample_id"] == grandchild["sample_id"]
    assert grandchild["parent"]["sample_id"] == child["sample_id"]


def test_invalid_lineage_is_rejected(client):
    root = create_root(client, "S-001")
    child = client.post(f"/samples/{root['sample_id']}/children", json={"sample_code": "S-001-A"}).json()

    assert client.patch(f"/samples/{root['sample_id']}", json={"parent_sample_id": root["sample_id"]}).status_code == 400
    cycle = client.patch(f"/samples/{root['sample_id']}", json={"parent_sample_id": child["sample_id"]})
    assert cycle.status_code == 400
    assert "descend from itself" in cycle.json()["detail"]
    assert client.patch(f"/samples/{child['sample_id']}", json={"parent_sample_id": 999999}).status_code == 404
    assert client.get(f"/samples/{root['sample_id']}").json()["parent"] is None


def test_change_parent_keeps_own_fields(client):
    first = create_root(client, "S-001")
    second = create_root(client, "S-002")
    child = client.post(f"/samples/{first['sample_id']}/children", json={"sample_code": "S-001-A", "notes": "mine"}).json()

    moved = client.patch(f"/samples/{child['sample_id']}", json={"parent_sample_id": second["sample_id"]}).json()

    assert (moved["parent"]["sample_code"], moved["notes"]) == ("S-002", "mine")
    assert client.get(f"/samples/{first['sample_id']}/children").json() == []


def test_shipping_batches_contain_only_root_samples(client):
    root = lookup(client, "PEDS-2026-08-01")
    child = lookup(client, "PEDS-2026-08-01-RNA")

    assert client.patch(f"/samples/{child['sample_id']}", json={"batch_id": 1}).status_code == 400
    assert client.post("/samples", json={"sample_code": "S-X", "batch_id": 1, "parent_sample_id": root["sample_id"]}).status_code == 400
    batch = client.get("/batches/1").json()
    assert [sample["sample_code"] for sample in batch["samples"]] == [f"PEDS-2026-08-{n:02d}" for n in range(1, 13)]


def test_batch_import_creates_root_samples_with_lookup_types(client):
    imported = client.post("/batches/sample-import", json={
        "batch_name": "Mosquito shipment",
        "samples": [{"sample_code": "MQ-1", "sample_type": "csf"}, {"sample_code": "MQ-2", "sample_type": "whole_blood"}],
    })
    assert imported.status_code == 200, imported.text
    codes = {sample["sample_code"]: sample["sample_type"] for sample in imported.json()["samples"]}
    assert codes == {"MQ-1": "CSF", "MQ-2": "Whole blood"}

    unknown = client.post("/batches/sample-import", json={"batch_name": "Bad", "samples": [{"sample_code": "MQ-3", "sample_type": "mosquito"}]})
    assert unknown.status_code == 400
    assert "Unknown sample type: mosquito" in unknown.json()["detail"]
    assert client.get("/samples/lookup", params={"code": "MQ-3"}).status_code == 404


def test_sample_types_can_be_added(client):
    created = client.post("/sample-types", json={"type_name": "mosquito"})

    assert created.status_code == 201
    assert created.json()["type_code"] == "mosquito"
    assert client.post("/sample-types", json={"type_name": "Mosquito"}).status_code == 400
    assert "mosquito" in [t["type_name"] for t in client.get("/sample-types").json()]


def test_aliquot_creates_derived_samples_through_a_process(client):
    parent = create_root(client, "S-001", current_quantity="100", quantity_unit="uL")

    response = client.post(f"/samples/{parent['sample_id']}/aliquots", json={
        "process_code": "ALQ-1", "aliquot_count": 3, "sample_code_prefix": "S-001-AL", "sample_type_id": 2,
        "quantity_per_aliquot": "20", "quantity_unit": "uL", "storage_location_id": 3, "operator_name": "kim",
    })

    assert response.status_code == 201, response.text
    detail = response.json()
    assert [child["sample_code"] for child in detail["children"]] == ["S-001-AL-01", "S-001-AL-02", "S-001-AL-03"]
    assert detail["current_quantity"] == "40.000000"
    assert detail["quantity_events"][0]["event_type"] == "consumed"
    assert detail["process_events"][0]["process_type"] == "Aliquoting"
    assert detail["process_events"][0]["role"] == "input"
    assert len(detail["process_events"][0]["outputs"]) == 3

    aliquot = client.get(f"/samples/{detail['children'][0]['sample_id']}").json()
    assert (aliquot["sample_type"], aliquot["current_quantity"], aliquot["storage_location"]["storage_location_id"]) == ("Swab (RNA shield)", "20.000000", 3)
    assert aliquot["process_events"][0]["role"] == "output"
    assert aliquot["batch"] is None

    clash = client.post(f"/samples/{parent['sample_id']}/aliquots", json={"process_code": "ALQ-2", "aliquot_count": 1, "sample_code_prefix": "S-001-AL"})
    assert clash.status_code == 400
    assert client.get("/process-events/types").status_code == 200


def test_process_event_creates_derived_output_samples(client):
    tissue = create_root(client, "S-001", current_quantity="10", quantity_unit="mg")

    response = client.post("/process-events", json={
        "process_code": "EXT-1", "process_type": "RNA extraction", "input_sample_ids": [tissue["sample_id"]],
        "quantity_used": "4", "quantity_unit": "mg", "operator_name": "kim",
        "output_samples": [{"sample_code": "S-001-RNA", "sample_type_id": 7, "current_quantity": "30", "quantity_unit": "uL", "quantity_generated": "30"}],
    })

    assert response.status_code == 201, response.text
    process = response.json()
    assert [s["sample_code"] for s in process["inputs"]] == ["S-001"]
    assert [s["sample_code"] for s in process["outputs"]] == ["S-001-RNA"]
    rna = client.get(f"/samples/{process['outputs'][0]['sample_id']}").json()
    assert (rna["parent"]["sample_code"], rna["sample_type"]) == ("S-001", "RNA")
    assert client.get(f"/samples/{tissue['sample_id']}").json()["current_quantity"] == "6.000000"

    duplicate = client.post("/process-events", json={"process_code": "EXT-1", "process_type": "x", "input_sample_ids": [tissue["sample_id"]], "output_samples": [{"sample_code": "S-OTHER"}]})
    assert duplicate.status_code == 400
    assert client.get("/samples/lookup", params={"code": "S-OTHER"}).status_code == 404


def test_pooled_process_outputs_must_name_their_parent(client):
    first = create_root(client, "S-001")
    second = create_root(client, "S-002")
    base = {"process_type": "Pooling", "input_sample_ids": [first["sample_id"], second["sample_id"]]}

    missing = client.post("/process-events", json={**base, "process_code": "POOL-1", "output_samples": [{"sample_code": "POOL"}]})
    outsider = client.post("/process-events", json={**base, "process_code": "POOL-1", "output_samples": [{"sample_code": "POOL", "parent_sample_id": 1}]})
    named = client.post("/process-events", json={**base, "process_code": "POOL-1", "output_samples": [{"sample_code": "POOL", "parent_sample_id": second["sample_id"]}]})

    assert (missing.status_code, outsider.status_code, named.status_code) == (400, 400, 201)
    pool = client.get(f"/samples/{named.json()['outputs'][0]['sample_id']}").json()
    assert pool["parent"]["sample_code"] == "S-002"
    assert [s["sample_code"] for s in pool["process_events"][0]["inputs"]] == ["S-001", "S-002"]


def test_storage_moves_record_history(client):
    sample = create_root(client, "S-001", storage_location_id=1)

    client.patch(f"/samples/{sample['sample_id']}", json={"storage_location_id": 2, "operator_name": "kim", "change_notes": "rack swap"})
    moved = client.patch(f"/samples/{sample['sample_id']}", json={"storage_location_id": 3}).json()

    assert moved["storage_location"]["storage_location_id"] == 3
    history = [(e["event_type"], e["from_location_id"], e["to_location_id"]) for e in moved["storage_events"]]
    assert history == [("moved", 2, 3), ("moved", 1, 2), ("stored", None, 1)]
    assert (moved["storage_events"][1]["operator_name"], moved["storage_events"][1]["notes"]) == ("kim", "rack swap")


def test_assays_operate_on_samples_with_results_qc_and_outputs(client):
    sample = create_root(client, "S-001")

    sequencing = client.post("/assay-definitions", json={"assay_name": "16S amplicon sequencing", "assay_type": "Sequencing", "target": "16S"}).json()
    created = client.post(f"/samples/{sample['sample_id']}/assay-executions", json={"execution_code": "SEQ-1", "assay_definition_id": sequencing["assay_definition_id"]})
    assert created.status_code == 201, created.text
    execution_id = created.json()["execution_id"]
    assert created.json()["sample"]["sample_code"] == "S-001"

    with_result = client.post(f"/assay-executions/{execution_id}/results", json={"result_name": "Reads", "numeric_value": "120000"}).json()
    assert [r["result_name"] for r in with_result["results"]] == ["Reads"]
    reviewed = client.patch(f"/assay-executions/{execution_id}", json={"qc_status": "accepted"}).json()
    assert reviewed["qc_status"] == "accepted"
    assert [a["qc_status"] for a in client.get("/assay-executions").json() if a["execution_id"] == execution_id] == ["accepted"]

    with_output = client.post(f"/assay-executions/{execution_id}/output-samples", json={"sample_code": "S-001-LIB", "sample_type_id": 7})
    assert with_output.status_code == 201, with_output.text
    library = with_output.json()["output_samples"][0]
    library_detail = client.get(f"/samples/{library['sample_id']}").json()
    assert library_detail["parent"]["sample_code"] == "S-001"
    assert [a["execution_code"] for a in library_detail["generated_by_assays"]] == ["SEQ-1"]
    lineage = client.get(f"/samples/{sample['sample_id']}/lineage").json()
    assert lineage["descendants"][0]["generated_by"] == {"kind": "assay", "code": "SEQ-1", "type": "Sequencing"}

    assert client.post(f"/samples/{sample['sample_id']}/assay-executions", json={"execution_code": "SEQ-1", "assay_definition_id": sequencing["assay_definition_id"]}).status_code == 400


def test_sample_page_shows_own_activity_not_descendants(client):
    root = lookup(client, "PEDS-2026-08-04")

    detail = client.get(f"/samples/{root['sample_id']}").json()

    assert detail["assays"] == [], "the seeded qPCR belongs to the cDNA, two generations down"
    assert [p["process_code"] for p in detail["process_events"]] == ["EXT-PEDS-2026-08-04"]
    assert [c["sample_code"] for c in detail["children"]] == ["PEDS-2026-08-04-RNA"]
    rna = client.get(f"/samples/{detail['children'][0]['sample_id']}").json()
    assert rna["assays"] == []
    cdna = client.get(f"/samples/{rna['children'][0]['sample_id']}").json()
    assert [a["assay_name"] for a in cdna["assays"]] == ["LACV qPCR (SYBR Green)"]
    assert [f["file_name"] for f in cdna["data_files"]] == ["qpcr-peds-2026-08-04.csv"]


def test_attach_data_files_to_sample_and_assay(client):
    sample = create_root(client, "S-001")
    definition_id = client.get("/assay-definitions").json()[0]["assay_definition_id"]
    assay = client.post(f"/samples/{sample['sample_id']}/assay-executions", json={"execution_code": "QPCR-1", "assay_definition_id": definition_id}).json()

    client.post(f"/samples/{sample['sample_id']}/data-files", json={"file_type": "image", "file_name": "gel.png", "file_location": "/files/gel.png"})
    response = client.post(f"/samples/{sample['sample_id']}/data-files", json={
        "file_type": "result", "file_name": "ct.csv", "file_location": "/files/ct.csv", "assay_id": assay["execution_id"], "checksum_sha256": "a" * 64,
    })

    assert response.status_code == 201, response.text
    assert [f["file_name"] for f in response.json()["data_files"]] == ["gel.png", "ct.csv"]
    assert [f["file_name"] for f in client.get(f"/assay-executions/{assay['execution_id']}").json()["data_files"]] == ["ct.csv"]
    assert client.post(f"/samples/{sample['sample_id']}/data-files", json={"file_type": "x", "file_name": "y", "file_location": "z", "checksum_sha256": "nope"}).status_code == 422


def test_delete_only_samples_without_dependents(client):
    lonely = create_root(client, "S-001", storage_location_id=1)
    parent = lookup(client, "PEDS-2026-08-03")

    blocked = client.delete(f"/samples/{parent['sample_id']}")
    assert blocked.status_code == 409
    assert "child samples" in blocked.json()["detail"]
    assert client.get(f"/samples/{parent['sample_id']}").status_code == 200

    assert client.delete(f"/samples/{lonely['sample_id']}").status_code == 204
    assert client.get(f"/samples/{lonely['sample_id']}").status_code == 404


def test_search_fields_are_in_the_sample_list(client):
    create_root(client, "S-001", external_sample_id="EXT-77", label="Field tube")

    row = next(row for row in client.get("/samples").json() if row["sample_code"] == "S-001")

    assert (row["external_sample_id"], row["label"], row["legacy_codes"]) == ("EXT-77", "Field tube", [])


def test_validation_errors_are_readable_and_create_nothing(client):
    bad_type = client.post("/samples", json={"sample_code": "S-001", "sample_type_id": 999999})
    blank_code = client.post("/samples", json={"sample_code": ""})

    assert bad_type.status_code == 404 and "Sample type not found" in bad_type.json()["detail"]
    assert blank_code.status_code == 422
    assert client.get("/samples/lookup", params={"code": "S-001"}).status_code == 404


def test_root_only_list_excludes_derived_samples(client):
    root = create_root(client, "BASE-001", label="Field tube", external_sample_id="EXT-9")
    child = client.post(f"/samples/{root['sample_id']}/children", json={"sample_code": "BASE-001-A", "label": "Field tube aliquot"}).json()

    roots = client.get("/samples", params={"root_only": "true"}).json()
    everything = client.get("/samples").json()

    assert roots and all(row["parent_sample_id"] is None for row in roots)
    assert "BASE-001" in {row["sample_code"] for row in roots}
    assert "BASE-001-A" not in {row["sample_code"] for row in roots}
    assert {"BASE-001", "BASE-001-A"} <= {row["sample_code"] for row in everything}
    assert len(everything) == len(roots) + sum(row["parent_sample_id"] is not None for row in everything)
    assert client.get("/samples", params={"root_only": "false"}).json() == everything
    # The base-samples filter is for lists only: a derived Sample still opens by code or id.
    assert lookup(client, "BASE-001-A")["sample_id"] == child["sample_id"]
    assert client.get(f"/samples/{child['sample_id']}").status_code == 200
