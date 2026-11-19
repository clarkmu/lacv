"""What a user reads when a request fails: plain sentences, never Pydantic internals or Python exceptions."""
from fastapi.testclient import TestClient


def test_validation_errors_are_plain_language_and_do_not_echo_internals(client):
    response = client.post("/samples", json={"sample_code": "E-1", "aliquot_number": "two", "collection_date": "13/05/2026", "current_quantity": "lots"})

    assert response.status_code == 422
    assert {tuple(item["loc"]): item["msg"] for item in response.json()["detail"]} == {
        ("body", "aliquot_number"): 'must be a whole number, not "two"',
        ("body", "collection_date"): 'must be a date such as 2026-05-13 or 2026-05-13 14:30, not "13/05/2026"',
        ("body", "current_quantity"): 'must be a number, not "lots"',
    }
    assert all(set(item) == {"loc", "msg", "type"} for item in response.json()["detail"]), "no echoed input, ctx or url"
    assert client.post("/samples", json={"sample_code": "E-2", "aliquot_number": 0}).json()["detail"][0]["msg"] == 'must be 1 or more, not "0"'
    assert client.post("/samples", json={}).json()["detail"][0]["msg"] == "is required"


def test_an_unexpected_failure_is_logged_and_shown_as_a_short_message(current_database_url, monkeypatch, caplog):
    from conftest import api_client
    from app.routers import batches

    def broken(*args, **kwargs):
        raise RuntimeError("psycopg.errors.Something: column x does not exist")

    monkeypatch.setattr(batches, "column_docs", broken)
    with api_client(current_database_url) as client:
        quiet = TestClient(client.app, raise_server_exceptions=False)
        with caplog.at_level("ERROR", logger="lacv"):
            response = quiet.get("/batches/sample-template/columns")

    assert response.status_code == 500
    body = response.json()
    assert body["detail"].startswith("Something went wrong on the server and nothing was saved.")
    assert body["reference"] in body["detail"]
    assert "psycopg" not in body["detail"] and "RuntimeError" not in body["detail"]
    # The developer detail is in the log, under the same reference.
    assert any(body["reference"] in record.getMessage() and record.exc_info for record in caplog.records)
