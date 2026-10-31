"""Sample availability: starting quantity minus removals from that Sample, from its own ledger."""
from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace

from app.quantity import availability


def lookup(client, code):
    response = client.get("/samples/lookup", params={"code": code})
    assert response.status_code == 200, response.text
    return response.json()


def create_root(client, code, **fields):
    response = client.post("/samples", json={"sample_code": code, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def availability_of(client, sample_id):
    return client.get(f"/samples/{sample_id}").json()["availability"]


def summary(result):
    return (result["state"], result["starting_quantity"], result["available_quantity"], result["removed_quantity"], result["percent_remaining"])


def test_untouched_sample_is_fully_available(client):
    sample = create_root(client, "Q-001", current_quantity="100", quantity_unit="uL")

    assert summary(sample["availability"]) == ("tracked", "100.000000", "100.000000", "0", 100.0)
    assert sample["availability"]["dimension"] == "volume"


def test_child_allocation_is_removed_from_the_parent_once(client):
    parent = create_root(client, "Q-001", current_quantity="100", quantity_unit="uL")

    child = client.post(f"/samples/{parent['sample_id']}/children", json={
        "sample_code": "Q-001-A", "current_quantity": "20", "quantity_unit": "uL", "quantity_taken_from_parent": "20",
    })

    assert child.status_code == 201, child.text
    reloaded = client.get(f"/samples/{parent['sample_id']}").json()
    assert summary(reloaded["availability"]) == ("tracked", "100.000000", "80.000000", "20.000000", 80.0)
    assert [(event["event_type"], event["quantity_change"]) for event in reloaded["quantity_events"]] == [("allocated", "-20.000000")]
    assert summary(child.json()["availability"]) == ("tracked", "20.000000", "20.000000", "0", 100.0)


def test_child_without_an_amount_taken_leaves_the_parent_unchanged(client):
    parent = create_root(client, "Q-001", current_quantity="100", quantity_unit="uL")

    client.post(f"/samples/{parent['sample_id']}/children", json={"sample_code": "Q-001-A", "current_quantity": "20", "quantity_unit": "uL"})

    assert summary(availability_of(client, parent["sample_id"])) == ("tracked", "100.000000", "100.000000", "0", 100.0)


def test_multiple_allocations_accumulate(client):
    parent = create_root(client, "Q-001", current_quantity="100", quantity_unit="uL")

    client.post(f"/samples/{parent['sample_id']}/children", json={"sample_code": "Q-001-A", "quantity_taken_from_parent": "10"})
    aliquots = client.post(f"/samples/{parent['sample_id']}/aliquots", json={
        "process_code": "ALQ-1", "aliquot_count": 3, "sample_code_prefix": "Q-001-AL", "quantity_per_aliquot": "20", "quantity_unit": "uL",
    })

    assert aliquots.status_code == 201, aliquots.text
    # 10 uL for the child and one 60 uL removal for the aliquoting process, which also created three children.
    assert summary(aliquots.json()["availability"]) == ("tracked", "100.000000", "30.000000", "70.000000", 30.0)


def test_using_a_child_does_not_give_volume_back_to_the_parent(client):
    parent = create_root(client, "Q-001", current_quantity="100", quantity_unit="uL")
    child = client.post(f"/samples/{parent['sample_id']}/children", json={
        "sample_code": "Q-001-A", "current_quantity": "20", "quantity_unit": "uL", "quantity_taken_from_parent": "20",
    }).json()

    used = client.post("/process-events", json={
        "process_code": "QC-1", "process_type": "Quality check", "input_sample_ids": [child["sample_id"]],
        "output_samples": [{"sample_code": "Q-001-A-QC"}], "quantity_used": "5", "quantity_unit": "uL",
    })

    assert used.status_code == 201, used.text
    assert summary(availability_of(client, child["sample_id"])) == ("tracked", "20.000000", "15.000000", "5.000000", 75.0)
    assert summary(availability_of(client, parent["sample_id"])) == ("tracked", "100.000000", "80.000000", "20.000000", 80.0)


def test_using_everything_leaves_zero_and_more_is_rejected(client):
    sample = create_root(client, "Q-001", current_quantity="50", quantity_unit="uL")
    payload = {"process_code": "USE-1", "process_type": "Extraction", "input_sample_ids": [sample["sample_id"]], "output_samples": [{"sample_code": "Q-001-X"}], "quantity_used": "50", "quantity_unit": "uL"}

    assert client.post("/process-events", json=payload).status_code == 201
    assert summary(availability_of(client, sample["sample_id"])) == ("tracked", "50.000000", "0.000000", "50.000000", 0.0)

    too_much = client.post("/process-events", json={**payload, "process_code": "USE-2", "output_samples": [{"sample_code": "Q-001-Y"}], "quantity_used": "1"})
    assert too_much.status_code == 400 and "only 0 uL is recorded" in too_much.json()["detail"]
    assert client.get("/samples/lookup", params={"code": "Q-001-Y"}).status_code == 404


def test_unknown_starting_quantity_has_no_percentage(client):
    no_quantity = create_root(client, "Q-001")
    no_unit = create_root(client, "Q-002", current_quantity="12")

    assert (no_quantity["availability"]["state"], no_quantity["availability"]["percent_remaining"]) == ("not_recorded", None)
    assert (no_unit["availability"]["state"], no_unit["availability"]["available_quantity"], no_unit["availability"]["percent_remaining"]) == ("no_unit", "12.000000", None)


def test_removals_in_compatible_units_are_converted_and_others_rejected(client):
    sample = create_root(client, "Q-001", current_quantity="1", quantity_unit="mL")

    taken = client.post(f"/samples/{sample['sample_id']}/children", json={"sample_code": "Q-001-A", "quantity_taken_from_parent": "250", "quantity_taken_unit": "µL"})
    wrong = client.post(f"/samples/{sample['sample_id']}/children", json={"sample_code": "Q-001-B", "quantity_taken_from_parent": "5", "quantity_taken_unit": "ng"})

    assert taken.status_code == 201, taken.text
    assert summary(availability_of(client, sample["sample_id"])) == ("tracked", "1.000000", "0.750000", "0.250000", 75.0)
    assert wrong.status_code == 400 and "recorded in mL" in wrong.json()["detail"]
    assert client.get("/samples/lookup", params={"code": "Q-001-B"}).status_code == 404


def test_manual_adjustments_are_part_of_the_ledger(client):
    sample = create_root(client, "Q-001", current_quantity="100", quantity_unit="uL")

    client.patch(f"/samples/{sample['sample_id']}", json={"current_quantity": "90", "change_notes": "Recount"})

    assert summary(availability_of(client, sample["sample_id"])) == ("tracked", "100.000000", "90.000000", "10.000000", 90.0)


def test_seed_examples_show_each_case(client):
    expected = {
        "DEMO-UNTOUCHED": ("100.000000", "100.000000", 100.0),
        "DEMO-ONE-CHILD": ("100.000000", "80.000000", 80.0),
        "DEMO-ONE-CHILD-A": ("20.000000", "15.000000", 75.0),
        "DEMO-ALIQUOTED": ("100.000000", "40.000000", 40.0),
        "DEMO-ALIQUOTED-01": ("20.000000", "20.000000", 100.0),
        "DEMO-DEPLETED": ("50.000000", "0.000000", 0.0),
        "DEMO-DNA-MASS": ("500.000000", "380.000000", 76.0),
        # Workflow seed: a 0.1 mL blood tube used up by its extraction, and a swab with 0.2 of 2.5 mL extracted.
        "PEDS-2026-08-01": ("0.100000", "0.000000", 0.0),
        "PEDS-2026-08-02": ("2.500000", "2.300000", 92.0),
    }
    for code, (starting, available, percent) in expected.items():
        result = availability_of(client, lookup(client, code)["sample_id"])
        assert (result["state"], result["starting_quantity"], result["available_quantity"], result["percent_remaining"]) == ("tracked", starting, available, percent), code


def test_every_seeded_ledger_reconciles(client):
    states = {}
    for row in client.get("/samples").json():
        result = availability_of(client, row["sample_id"])
        states.setdefault(result["state"], []).append(row["sample_code"])

    assert set(states) <= {"tracked", "not_recorded"}, {state: codes[:5] for state, codes in states.items()}
    assert len(states["tracked"]) > 200


def event(change, before, after, unit="uL"):
    return SimpleNamespace(event_date=datetime(2026, 10, 1), quantity_unit=unit, quantity_change=Decimal(change),
                           quantity_before=None if before is None else Decimal(before), quantity_after=None if after is None else Decimal(after))


def test_history_that_does_not_reconcile_is_reported_not_hidden():
    gap = availability(Decimal("60"), "uL", [event("-20", "100", "80")])
    negative = availability(Decimal("-5"), "uL", [event("-105", "100", "-5")])

    assert gap["state"] == "inconsistent" and gap["percent_remaining"] is None
    assert "does not match its history" in gap["problems"][0]
    assert negative["state"] == "inconsistent" and any("negative" in problem for problem in negative["problems"])


def test_history_in_incomparable_units_has_no_percentage():
    result = availability(Decimal("80"), "uL", [event("-20", "100", "80", unit="ng")])

    assert (result["state"], result["available_quantity"], result["percent_remaining"]) == ("unit_mismatch", Decimal("80"), None)


def test_quantity_first_measured_after_creation_starts_the_accounting():
    result = availability(Decimal("30"), "uL", [event("40", None, "40"), event("-10", "40", "30")])

    assert (result["state"], result["starting_quantity"], result["removed_quantity"], result["percent_remaining"]) == ("tracked", Decimal("40"), Decimal("10"), 75.0)
