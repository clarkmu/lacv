"""The 20261103_0007 migration: executions with many Samples, at most one result per Sample.

Each test takes the pre-Sample-centric fixture through 20261101_0006 (one execution per Sample, several
results per execution), shapes the results, then runs the real upgrade.
"""
import pytest

from conftest import alembic, query, run_sql

BEFORE = "20261101_0006"


def at_0006(database_url: str) -> str:
    alembic(database_url, "upgrade", BEFORE)
    return database_url


def definition_of(database_url: str, code: str) -> int:
    return query(database_url, "SELECT assay_definition_id FROM assays WHERE assay_instance_code = %s", (code,))[0][0]


def test_each_execution_keeps_its_sample_and_name(legacy_database_url):
    url = at_0006(legacy_database_url)
    before = query(url, "SELECT assay_id, assay_instance_code, sample_id, assay_definition_id, status, qc_status FROM assays ORDER BY assay_id")
    ledger_before = query(url, "SELECT quantity_event_id, related_assay_id FROM sample_quantity_events ORDER BY 1")
    files_before = query(url, "SELECT data_file_id, assay_id FROM data_files ORDER BY 1")

    alembic(url, "upgrade", "20261103_0007")

    after = query(url, """
        SELECT e.assay_execution_id, e.execution_name, x.sample_id, e.assay_definition_id, e.status, e.qc_status
        FROM assay_executions e JOIN assay_execution_samples x USING (assay_execution_id) ORDER BY 1
    """)
    assert after == before and len(after) == 50
    assert query(url, "SELECT count(*) FROM assay_execution_samples") == [(50,)], "one Sample row per former execution"
    assert query(url, "SELECT quantity_event_id, related_assay_execution_id FROM sample_quantity_events ORDER BY 1") == ledger_before
    assert query(url, "SELECT data_file_id, assay_execution_id FROM data_files ORDER BY 1") == files_before
    assert query(url, "SELECT to_regclass('assays'), to_regclass('assay_results'), to_regclass('assay_runs'), to_regclass('assay_definition_results')") == [(None, None, None, None)]


def test_a_single_result_moves_onto_its_sample_and_extra_detail_goes_to_notes(legacy_database_url):
    url = at_0006(legacy_database_url)
    run_sql(url, "UPDATE assay_results SET text_value = NULL, interpretation = NULL, unit = NULL, qc_status = 'not_reviewed' WHERE assay_id = (SELECT assay_id FROM assays WHERE assay_instance_code = 'ASSAY-004')")

    alembic(url, "upgrade", "20261103_0007")

    rows = dict((name, (numeric, text, notes)) for name, numeric, text, notes in query(url, """
        SELECT e.execution_name, x.result_numeric, x.result_text, e.notes
        FROM assay_executions e JOIN assay_execution_samples x USING (assay_execution_id)
        WHERE e.execution_name IN ('ASSAY-003', 'ASSAY-004')
    """))
    numeric, text, notes = rows["ASSAY-003"]
    assert (str(numeric), text) == ("3.75000000", None), "the number is kept; its text value is not a second result"
    assert notes.splitlines()[-1] == "- Analyte 3 Result 3: 3.75 Ct (Seeded result; QC not_reviewed); text negative", "everything else is kept verbatim in the notes"
    assert (str(rows["ASSAY-004"][0]), rows["ASSAY-004"][2]) == ("5.00000000", "Seeded assay"), "nothing to keep beyond the value, so notes are unchanged"


def test_several_results_keep_the_one_matching_the_assay_and_list_all_in_notes(legacy_database_url):
    url = at_0006(legacy_database_url)
    matching, unmatched = definition_of(url, "ASSAY-010"), definition_of(url, "ASSAY-012")
    run_sql(
        url,
        f"INSERT INTO assay_definition_results (assay_definition_id, analyte, result_name, unit, value_type, sort_order) VALUES ({matching}, 'Analyte 10', 'Result 10', 'Ct', 'numeric', 0), ({matching}, 'RNase P', 'CT', 'Ct', 'numeric', 1)",
        "INSERT INTO assay_results (assay_id, analyte, result_name, numeric_value, unit, qc_status) SELECT assay_id, 'RNase P', 'CT', 26.4, 'Ct', 'accepted' FROM assays WHERE assay_instance_code IN ('ASSAY-010', 'ASSAY-012')",
    )

    alembic(url, "upgrade", "20261103_0007")

    assert query(url, f"SELECT result_name, result_unit, result_value_type, description FROM assay_definitions WHERE assay_definition_id = {matching}") == [
        ("Analyte 10 Result 10", "Ct", "numeric", "Seeded definition\n\nAlso reported before executions held one result per sample: RNase P CT (Ct)."),
    ]
    kept = dict((name, (numeric, text, notes)) for name, numeric, text, notes in query(url, """
        SELECT e.execution_name, x.result_numeric, x.result_text, e.notes
        FROM assay_executions e JOIN assay_execution_samples x USING (assay_execution_id)
        WHERE e.execution_name IN ('ASSAY-010', 'ASSAY-012')
    """))
    assert str(kept["ASSAY-010"][0]) == "12.50000000", "the result named by the assay is kept"
    assert (kept["ASSAY-012"][0], kept["ASSAY-012"][1]) == (None, None), "no match: no result is chosen arbitrarily"
    for name in ("ASSAY-010", "ASSAY-012"):
        notes = kept[name][2]
        assert "Results recorded before executions held several samples (kept verbatim):" in notes
        assert "- RNase P CT: 26.4 Ct (QC accepted)" in notes
    assert unmatched != matching, "two different assays"


def test_the_migration_cannot_be_undone_by_alembic(legacy_database_url):
    url = at_0006(legacy_database_url)
    alembic(url, "upgrade", "20261103_0007")

    with pytest.raises(NotImplementedError, match="restore the backup"):
        alembic(url, "downgrade", BEFORE)
