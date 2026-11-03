"""20261104_0008: assay result fields come back, and 0007's verbatim notes are read back into them.

Each test shapes results at 20261101_0006 (one execution per Sample, several results each), then runs the real
0007 and 0008 upgrades in turn.
"""
import pytest

from conftest import alembic, query, run_sql

NOTES_HEADING = "Results recorded before executions held several samples (kept verbatim):"


def at_0006(database_url: str) -> str:
    alembic(database_url, "upgrade", "20261101_0006")
    return database_url


def values_of(url: str, execution_name: str) -> list[tuple]:
    return query(url, """
        SELECT r.result_name, r.unit, v.numeric_value::text, v.text_value, v.interpretation, v.qc_status
        FROM assay_executions e
        JOIN assay_execution_samples x USING (assay_execution_id)
        JOIN assay_execution_results v USING (assay_execution_sample_id)
        JOIN assay_definition_results r USING (assay_definition_result_id)
        WHERE e.execution_name = %s ORDER BY r.sort_order
    """, (execution_name,))


def test_several_results_of_one_execution_return_as_fields_with_interpretation_and_qc(legacy_database_url):
    url = at_0006(legacy_database_url)
    definition = query(url, "SELECT assay_definition_id FROM assays WHERE assay_instance_code = 'ASSAY-010'")[0][0]
    run_sql(
        url,
        f"INSERT INTO assay_definition_results (assay_definition_id, analyte, result_name, unit, value_type, sort_order) VALUES ({definition}, 'Analyte 10', 'Result 10', 'Ct', 'numeric', 0), ({definition}, 'RNase P', 'CT', 'Ct', 'numeric', 1)",
        "UPDATE assay_results SET text_value = NULL, qc_status = 'accepted' WHERE assay_id = (SELECT assay_id FROM assays WHERE assay_instance_code = 'ASSAY-010')",
        "INSERT INTO assay_results (assay_id, analyte, result_name, numeric_value, unit, interpretation, qc_status) SELECT assay_id, 'RNase P', 'CT', 26.4, 'Ct', 'detected', 'accepted' FROM assays WHERE assay_instance_code = 'ASSAY-010'",
    )
    alembic(url, "upgrade", "20261103_0007")
    assert NOTES_HEADING in query(url, "SELECT notes FROM assay_executions WHERE execution_name = 'ASSAY-010'")[0][0], "0007 kept them as text"

    alembic(url, "upgrade", "20261104_0008")

    assert query(url, f"SELECT result_name, unit, value_type, sort_order FROM assay_definition_results WHERE assay_definition_id = {definition} ORDER BY sort_order") == [
        ("Analyte 10 Result 10", "Ct", "numeric", 0), ("RNase P CT", "Ct", "either", 1),
    ]
    assert values_of(url, "ASSAY-010") == [
        ("Analyte 10 Result 10", "Ct", "12.50000000", None, "Seeded result", "accepted"),
        ("RNase P CT", "Ct", "26.40000000", None, "detected", "accepted"),
    ]
    assert query(url, "SELECT notes FROM assay_executions WHERE execution_name = 'ASSAY-010'") == [("Seeded assay",)], "the read-back text is removed"
    assert query(url, f"SELECT description FROM assay_definitions WHERE assay_definition_id = {definition}") == [("Seeded definition",)]


def test_text_that_does_not_read_back_completely_is_left_in_the_notes(legacy_database_url):
    url = at_0006(legacy_database_url)
    alembic(url, "upgrade", "20261104_0008")

    # Seeded results carry both a number and a text value; only the number fits a field, so the notes keep both.
    assert values_of(url, "ASSAY-011") == [("Result", None, "13.75000000", None, None, "not_reviewed")]
    notes = query(url, "SELECT notes FROM assay_executions WHERE execution_name = 'ASSAY-011'")[0][0]
    assert NOTES_HEADING in notes and "text negative" in notes


def test_every_sample_row_keeps_its_value_and_nothing_else_appears(legacy_database_url):
    url = at_0006(legacy_database_url)
    before = query(url, "SELECT a.assay_instance_code, r.numeric_value::text FROM assays a JOIN assay_results r ON r.assay_id = a.assay_id ORDER BY 1")

    alembic(url, "upgrade", "20261104_0008")

    after = query(url, """
        SELECT e.execution_name, v.numeric_value::text FROM assay_executions e
        JOIN assay_execution_samples x USING (assay_execution_id) JOIN assay_execution_results v USING (assay_execution_sample_id) ORDER BY 1
    """)
    assert after == before and len(after) == 50
    assert query(url, "SELECT count(*) FROM information_schema.columns WHERE table_name IN ('assay_execution_samples', 'assay_definitions') AND column_name LIKE 'result_%'") == [(0,)]


def test_0008_cannot_be_undone_by_alembic(legacy_database_url):
    url = at_0006(legacy_database_url)
    alembic(url, "upgrade", "20261104_0008")

    with pytest.raises(NotImplementedError, match="restore the backup"):
        alembic(url, "downgrade", "20261103_0007")
