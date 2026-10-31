"""Batch Detail: the root Samples of a shipping batch, edited row by row or several at once."""


def batch_by_code(client, code):
    batch_id = next(row["batch_id"] for row in client.get("/batches").json() if row["batch_code"] == code)
    return client.get(f"/batches/{batch_id}").json()


def type_id(client, name):
    return next(row["sample_type_id"] for row in client.get("/sample-types").json() if row["type_name"] == name)


def save(client, batch, changes, **extra):
    return client.patch(f"/batches/{batch['batch_id']}/samples", json={"changes": changes, **extra})


def errors(response):
    return {(item["loc"][2], item["loc"][3]): item["msg"] for item in response.json()["detail"]}


def test_seeded_batches_hold_5_to_20_varied_root_samples(client):
    batches = client.get("/batches").json()

    assert len(batches) == 8 and all(5 <= batch["sample_count"] <= 20 for batch in batches)
    for batch in batches:
        detail = client.get(f"/batches/{batch['batch_id']}").json()
        assert len(detail["samples"]) == batch["sample_count"]
        assert all(sample["sample_id"] for sample in detail["samples"])
    hospital = batch_by_code(client, "HOSP-2025-01")
    assert len({sample["subject_code"] for sample in hospital["samples"]}) == 6
    assert {sample["sample_type"] for sample in hospital["samples"]} == {"Serum", "CSF"}
    assert {sample["aliquot_number"] for sample in hospital["samples"]} == {None, 1, 2, 3}
    assert any(sample["child_count"] for sample in hospital["samples"]) and any(not sample["child_count"] for sample in hospital["samples"])
    newest = batch_by_code(client, "PEDS-2026-10")
    assert {"available", "expected", "consumed"} == {sample["status"] for sample in newest["samples"]}, "received, on the way, and one used up by its extraction"


def test_batches_contain_root_samples_only(client):
    for batch in client.get("/batches").json():
        for row in client.get(f"/batches/{batch['batch_id']}").json()["samples"]:
            assert client.get(f"/samples/{row['sample_id']}").json()["parent"] is None


def test_rows_are_edited_in_one_save(client):
    batch = batch_by_code(client, "PEDS-2026-09")
    first, second = batch["samples"][0], batch["samples"][1]

    response = save(client, batch, [
        {"sample_id": first["sample_id"], "subject_code": " DEV-P900 ", "external_sample_id": "EXT-1"},
        {"sample_id": second["sample_id"], "current_quantity": "1.2", "storage_location_id": None},
    ], operator_name="Ana", change_notes="Manifest check")

    assert response.status_code == 200, response.text
    rows = {row["sample_id"]: row for row in response.json()["samples"]}
    assert (rows[first["sample_id"]]["subject_code"], rows[first["sample_id"]]["external_sample_id"]) == ("DEV-P900", "EXT-1")
    assert rows[second["sample_id"]]["current_quantity"] == "1.200000"
    assert rows[second["sample_id"]]["storage_location_id"] is None
    history = client.get(f"/samples/{second['sample_id']}").json()
    assert (history["quantity_events"][0]["event_type"], history["quantity_events"][0]["operator_name"]) == ("adjusted", "Ana")
    assert (history["storage_events"][0]["event_type"], history["storage_events"][0]["notes"]) == ("removed", "Manifest check")


def test_material_is_the_sample_type_and_can_be_set_on_several_rows(client):
    batch = batch_by_code(client, "MOSQ-2026-W31")
    whole_blood = type_id(client, "Whole blood")
    chosen = batch["samples"][:4]

    response = save(client, batch, [{"sample_id": row["sample_id"], "sample_type_id": whole_blood} for row in chosen])

    assert response.status_code == 200, response.text
    rows = {row["sample_id"]: row for row in response.json()["samples"]}
    assert {rows[row["sample_id"]]["sample_type"] for row in chosen} == {"Whole blood"}
    assert rows[batch["samples"][4]["sample_id"]]["sample_type"] == "Mosquito pool"
    assert client.get(f"/samples/{chosen[0]['sample_id']}").json()["sample_type_id"] == whole_blood


def test_aliquot_numbers_tell_apart_one_subjects_tubes(client):
    batch = batch_by_code(client, "HOSP-2025-01")
    tubes = [row for row in batch["samples"] if row["aliquot_number"] is not None][:3]
    assert len({(row["subject_code"], row["sample_type_id"]) for row in tubes}) == 1, "three tubes of one collection"

    clash = save(client, batch, [{"sample_id": tubes[1]["sample_id"], "aliquot_number": 1}])
    renumbered = save(client, batch, [
        {"sample_id": tubes[0]["sample_id"], "aliquot_number": 3},
        {"sample_id": tubes[2]["sample_id"], "aliquot_number": 1},
    ])

    assert clash.status_code == 422
    assert "Aliquot 1 is also " + tubes[0]["sample_code"] in errors(clash)[(0, "aliquot_number")]
    assert renumbered.status_code == 200, "swapping numbers is fine: only the end state is checked"
    numbers = {row["sample_id"]: row["aliquot_number"] for row in renumbered.json()["samples"]}
    assert [numbers[row["sample_id"]] for row in tubes] == [3, 2, 1]


def test_the_same_aliquot_number_is_fine_for_other_subjects_or_materials(client):
    batch = batch_by_code(client, "PEDS-2026-08")

    response = save(client, batch, [{"sample_id": row["sample_id"], "aliquot_number": 1} for row in batch["samples"]])

    assert response.status_code == 200, "each blood and swab of a subject is the first tube of its own Material"
    assert {row["aliquot_number"] for row in response.json()["samples"]} == {1}


def test_a_refused_change_saves_nothing(client):
    batch = batch_by_code(client, "HOSP-2026-02")
    other = batch_by_code(client, "PEDS-2026-08")["samples"][0]
    first = batch["samples"][0]

    response = save(client, batch, [
        {"sample_id": first["sample_id"], "subject_code": "CHANGED"},
        {"sample_id": batch["samples"][1]["sample_id"], "sample_type_id": 999999, "aliquot_number": 0},
        {"sample_id": other["sample_id"], "subject_code": "X"},
        {"sample_id": batch["samples"][2]["sample_id"], "status": None},
    ])

    assert response.status_code == 422
    assert client.get(f"/batches/{batch['batch_id']}").json()["samples"][0]["subject_code"] == first["subject_code"]
    assert client.get(f"/samples/{other['sample_id']}").json()["subject_code"] == other["subject_code"]
    response_with_known_rows = save(client, batch, [
        {"sample_id": batch["samples"][1]["sample_id"], "sample_type_id": 999999},
        {"sample_id": other["sample_id"], "subject_code": "X"},
        {"sample_id": batch["samples"][2]["sample_id"], "status": None},
    ])
    assert errors(response_with_known_rows) == {
        (0, "sample_type_id"): "Sample type not found: 999999",
        (1, "sample_id"): f"Sample {other['sample_id']} is not in this batch",
        (2, "status"): "Status cannot be blank",
    }
    assert save(client, batch, [{"sample_id": first["sample_id"], "aliquot_number": 0}]).status_code == 422
    assert save(client, batch, []).status_code == 422


def test_subject_and_aliquot_number_are_sample_fields(client):
    created = client.post("/samples", json={"sample_code": "S-001", "subject_code": "SUBJ-1", "aliquot_number": 2}).json()

    assert (created["subject_code"], created["aliquot_number"]) == ("SUBJ-1", 2)
    row = next(row for row in client.get("/samples").json() if row["sample_code"] == "S-001")
    assert (row["subject_code"], row["aliquot_number"]) == ("SUBJ-1", 2)
    assert client.post("/samples", json={"sample_code": "S-002", "aliquot_number": 0}).status_code == 422
