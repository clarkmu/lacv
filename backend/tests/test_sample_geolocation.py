"""Sample latitude and longitude: optional, validated, stored, and served for the sample map."""


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def test_coordinates_are_optional_and_round_trip(client):
    placed = create_root(client, "GEO-1", latitude="35.595100", longitude=-82.5515)
    unplaced = create_root(client, "GEO-2")

    assert (placed["latitude"], placed["longitude"]) == ("35.595100", "-82.551500")
    assert (unplaced["latitude"], unplaced["longitude"]) == (None, None)

    moved = client.patch(f"/samples/{unplaced['sample_id']}", json={"latitude": 35.7884})
    assert moved.status_code == 200 and moved.json()["latitude"] == "35.788400" and moved.json()["longitude"] is None, "saved one field at a time"
    moved = client.patch(f"/samples/{unplaced['sample_id']}", json={"longitude": -83.5543})
    assert (moved.json()["latitude"], moved.json()["longitude"]) == ("35.788400", "-83.554300")

    cleared = client.patch(f"/samples/{placed['sample_id']}", json={"latitude": None, "longitude": None})
    assert (cleared.json()["latitude"], cleared.json()["longitude"]) == (None, None)
    assert client.get(f"/samples/{placed['sample_id']}").json()["latitude"] is None


def test_children_do_not_inherit_coordinates(client):
    parent = create_root(client, "GEO-P", latitude=35.6, longitude=-82.5)

    child = client.post(f"/samples/{parent['sample_id']}/children", json={"sample_code": "GEO-P-1"}).json()

    assert (child["latitude"], child["longitude"]) == (None, None)


def test_out_of_range_coordinates_are_refused_with_a_readable_message(client):
    sample = create_root(client, "GEO-3")
    cases = [
        ({"latitude": 90.0001}, "latitude", "Latitude must be between -90 and 90 decimal degrees, not 90.0001"),
        ({"latitude": -91}, "latitude", "Latitude must be between -90 and 90 decimal degrees, not -91"),
        ({"longitude": 180.5}, "longitude", "Longitude must be between -180 and 180 decimal degrees, not 180.5"),
        ({"longitude": "west"}, "longitude", 'must be a number, not "west"'),
    ]
    for payload, field, message in cases:
        response = client.patch(f"/samples/{sample['sample_id']}", json=payload)
        assert response.status_code == 422, payload
        assert response.json()["detail"] == [{"loc": ["body", field], "msg": message, "type": response.json()["detail"][0]["type"]}]
    for edge in ({"latitude": 90, "longitude": -180}, {"latitude": -90, "longitude": 180}):
        assert client.patch(f"/samples/{sample['sample_id']}", json=edge).status_code == 200, edge
    refused_create = client.post("/samples", json={"sample_code": "GEO-4", "latitude": 100, "longitude": 0})
    assert refused_create.status_code == 422
    assert client.get("/samples/lookup", params={"code": "GEO-4"}).status_code == 404


def test_the_map_groups_samples_at_one_point_and_leaves_out_samples_without_both_coordinates(client):
    before = client.get("/samples/map").json()
    create_root(client, "TRAP-A-1", latitude=35.6, longitude=-82.5)
    create_root(client, "TRAP-A-2", latitude="35.600000", longitude="-82.500000")
    create_root(client, "TRAP-B-1", latitude=35.600001, longitude=-82.5)
    create_root(client, "NO-PLACE")
    half = create_root(client, "HALF-PLACE")
    client.patch(f"/samples/{half['sample_id']}", json={"latitude": 36.0})

    shown = client.get("/samples/map").json()

    sites = {(site["latitude"], site["longitude"]): [sample["sample_code"] for sample in site["samples"]] for site in shown["sites"]}
    assert sites[("35.600000", "-82.500000")] == ["TRAP-A-1", "TRAP-A-2"], "one marker for samples at exactly one point"
    assert sites[("35.600001", "-82.500000")] == ["TRAP-B-1"], "a nearby point is its own site"
    assert all("NO-PLACE" not in codes and "HALF-PLACE" not in codes for codes in sites.values())
    assert shown["located_count"] == before["located_count"] + 3
    assert shown["unlocated_count"] == before["unlocated_count"] + 2
    sample = shown["sites"][0]["samples"][0]
    assert {"sample_id", "sample_code", "sample_type", "status", "subject_code", "collection_date"} <= sample.keys()


def test_required_fields_cannot_be_cleared_by_an_inline_edit(client):
    sample = create_root(client, "KEEP-1")

    for field in ("sample_code", "status", "is_consumed"):
        response = client.patch(f"/samples/{sample['sample_id']}", json={field: None})
        assert response.status_code == 422, (field, response.text)
        assert response.json()["detail"][0]["loc"] == ["body", field]
        assert response.json()["detail"][0]["msg"].endswith("cannot be blank")
    assert client.get(f"/samples/{sample['sample_id']}").json()["sample_code"] == "KEEP-1"


def test_the_seed_data_geolocates_about_three_quarters_of_samples_across_western_nc(current_database_url):
    from conftest import query

    total, both, neither, only_one = query(current_database_url, """
        SELECT count(*), count(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL),
               count(*) FILTER (WHERE latitude IS NULL AND longitude IS NULL), count(*) FILTER (WHERE (latitude IS NULL) <> (longitude IS NULL))
        FROM samples""")[0]
    assert only_one == 0, "never just one coordinate"
    assert both + neither == total
    assert 0.70 <= both / total <= 0.80, f"{both} of {total} located"
    # Every point is in western North Carolina, spread over the region rather than piled on one town.
    assert query(current_database_url, """SELECT count(*) FROM samples WHERE latitude IS NOT NULL
        AND NOT (latitude BETWEEN 35.0 AND 36.4 AND longitude BETWEEN -84.32 AND -81.4)""") == [(0,)]
    (cells,) = query(current_database_url, "SELECT count(DISTINCT (round(latitude, 1), round(longitude, 1))) FROM samples WHERE latitude IS NOT NULL")[0]
    assert cells >= 12
    (lat_span, lng_span) = query(current_database_url, "SELECT max(latitude) - min(latitude), max(longitude) - min(longitude) FROM samples")[0]
    assert lat_span > 0.8 and lng_span > 1.8
    # Pools from one trap in one week were collected together: one shared point per trap-week.
    trap_weeks = query(current_database_url, """SELECT s.source_description, b.batch_code, count(DISTINCT (s.latitude, s.longitude)), count(*)
        FROM samples s JOIN batches b USING (batch_id) WHERE s.source_type = 'Field collection' GROUP BY 1, 2""")
    assert trap_weeks and all(points == 1 for _, _, points, _ in trap_weeks)
    # A subject's tubes share one point, or all have none.
    assert query(current_database_url, """SELECT count(*) FROM (SELECT subject_code FROM samples WHERE subject_code IS NOT NULL
        GROUP BY subject_code HAVING count(DISTINCT coalesce(latitude::text, 'none') || longitude::text) > 1) mixed""") == [(0,)]
    # Derived samples carry the location of the collection they came from.
    assert query(current_database_url, """SELECT count(*) FROM samples child JOIN samples parent ON parent.sample_id = child.parent_sample_id
        WHERE child.latitude IS DISTINCT FROM parent.latitude OR child.longitude IS DISTINCT FROM parent.longitude""") == [(0,)]


def test_the_seed_coordinates_are_the_same_on_every_reseed(make_database):
    from conftest import build_current_database, query

    first, second = (build_current_database(make_database()) for _ in range(2))
    sql = "SELECT sample_code, latitude, longitude FROM samples ORDER BY sample_code"

    assert query(first, sql) == query(second, sql)


def test_the_map_shows_the_seeded_sites_and_counts_the_rest(client):
    shown = client.get("/samples/map").json()

    located = sum(len(site["samples"]) for site in shown["sites"])
    assert located == shown["located_count"]
    assert shown["unlocated_count"] > 0
    assert 0.70 <= located / (located + shown["unlocated_count"]) <= 0.80
    assert any(len(site["samples"]) >= 5 for site in shown["sites"]), "pools from one trap-week share a marker"
    assert len(shown["sites"]) >= 20, "spread over many points, not one per area"
