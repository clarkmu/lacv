"""Storage location detail: its path, the locations inside it, and the Samples stored there."""


def location_id(client, code):
    return next(row["storage_location_id"] for row in client.get("/storage-locations").json() if row["location_code"] == code)


def test_a_box_lists_each_stored_tube_with_the_sample_it_came_from(client):
    box = client.get(f"/storage-locations/{location_id(client, 'BOX-RNA-01')}").json()

    assert [ancestor["location_code"] for ancestor in box["ancestors"]] == ["P3-80-2", "RACK-4"]
    assert box["sub_locations"] == []
    assert box["contents"], "seeded RNA is stored here"
    rna = next(row for row in box["contents"] if row["sample_code"] == "PEDS-2026-08-01-RNA")
    assert (rna["sample_type"], rna["quantity_unit"], rna["storage_location_code"]) == ("RNA", "uL", "BOX-RNA-01")
    assert rna["parent"]["sample_code"] == "PEDS-2026-08-01"
    assert rna["root"]["sample_code"] == "PEDS-2026-08-01"


def test_a_derived_tube_points_to_its_original_sample_two_generations_up(client):
    cdna_box = client.get(f"/storage-locations/{location_id(client, 'BOX-CDNA-01')}").json()

    cdna = next(row for row in cdna_box["contents"] if row["sample_code"] == "PEDS-2026-08-02-cDNA")
    assert (cdna["parent"]["sample_code"], cdna["root"]["sample_code"]) == ("PEDS-2026-08-02-RNA", "PEDS-2026-08-02")


def test_tubes_of_one_sample_stay_separate_rows(client):
    parent = client.post("/samples", json={"sample_code": "S-001", "current_quantity": "100", "quantity_unit": "uL"}).json()
    box_id = location_id(client, "BOX-148")
    client.post(f"/samples/{parent['sample_id']}/aliquots", json={
        "process_code": "ALQ-S-001", "aliquot_count": 3, "sample_code_prefix": "S-001-A", "quantity_per_aliquot": "10", "quantity_unit": "uL", "storage_location_id": box_id,
    })

    contents = client.get(f"/storage-locations/{box_id}").json()["contents"]

    mine = [row for row in contents if row["root"] and row["root"]["sample_code"] == "S-001"]
    assert [row["sample_code"] for row in mine] == ["S-001-A-01", "S-001-A-02", "S-001-A-03"]
    assert all(row["current_quantity"] == "10.000000" for row in mine)
    original = next(row for row in contents if row["sample_code"] == "HOSP-2025-01-04")
    assert original["root"] is None and original["parent"] is None, "an original tube is its own sample"


def test_a_freezer_shows_what_is_stored_below_it(client):
    freezer = client.get(f"/storage-locations/{location_id(client, 'LAB-80-A')}").json()

    assert [child["location_code"] for child in freezer["sub_locations"]] == ["RACK-A6"]
    assert freezer["sub_locations"][0]["sample_count"] == len(freezer["contents"]) > 0
    assert {row["storage_location_code"] for row in freezer["contents"]} == {"BOX-148", "BOX-149"}


def test_an_empty_location_has_no_contents(client):
    created = client.post("/storage-locations", json={"location_code": "SHELF-EMPTY", "location_type": "shelf"}).json()

    detail = client.get(f"/storage-locations/{created['storage_location_id']}").json()

    assert (detail["contents"], detail["sub_locations"], detail["ancestors"]) == ([], [], [])
    assert client.get("/storage-locations/999999").status_code == 404


def test_editing_keeps_the_hierarchy_sound(client):
    rack = location_id(client, "RACK-A6")
    box = location_id(client, "BOX-148")

    edited = client.patch(f"/storage-locations/{box}", json={"location_name": "Box 148", "description": "CSF only", "is_active": False})
    into_own_child = client.patch(f"/storage-locations/{rack}", json={"parent_location_id": box})
    into_itself = client.patch(f"/storage-locations/{box}", json={"parent_location_id": box})
    duplicate_code = client.patch(f"/storage-locations/{box}", json={"location_code": "BOX-149"})
    blank_code = client.patch(f"/storage-locations/{box}", json={"location_code": " "})

    assert edited.status_code == 200 and (edited.json()["location_name"], edited.json()["is_active"]) == ("Box 148", False)
    assert client.get(f"/storage-locations/{box}").json()["description"] == "CSF only"
    assert into_own_child.status_code == 422 and into_itself.status_code == 422
    assert duplicate_code.status_code == 400 and "same parent" in duplicate_code.text
    assert blank_code.status_code == 422
    assert client.get(f"/storage-locations/{rack}").json()["parent_location_id"] != box
