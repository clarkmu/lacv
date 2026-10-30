"""The 20261030_0004 migration that folds Material into Sample.

Each test starts from the pre-migration shape (old schema + old seed data,
stamped at 20260826_0003) and runs the real Alembic upgrade.
"""
import pytest

from conftest import alembic, api_client, build_current_database, query, run_sql

HEAD = "20261030_0004"

MATERIAL_SNAPSHOT = """
    SELECT m.material_code, s.sample_code, t.type_name, m.material_label, m.material_subtype, m.current_quantity,
           m.quantity_unit, m.concentration, m.concentration_unit, m.storage_location_id, m.status, m.is_consumed,
           m.is_disposed, m.notes
    FROM materials m
    JOIN samples s ON s.sample_id = m.sample_id
    LEFT JOIN material_types t ON t.material_type_id = m.material_type_id
    ORDER BY m.material_code
"""

MIGRATED_SNAPSHOT = """
    SELECT r.material_code, s.sample_code, t.type_name, s.label, s.subtype, s.current_quantity,
           s.quantity_unit, s.concentration, s.concentration_unit, s.storage_location_id, s.status, s.is_consumed,
           s.is_disposed, s.notes
    FROM legacy_material_records r
    JOIN samples s ON s.sample_id = r.sample_id
    LEFT JOIN sample_types t ON t.sample_type_id = s.sample_type_id
    ORDER BY r.material_code
"""

# Every material-linked history row, expressed through sample codes so it survives the retargeting.
LINK_SNAPSHOTS = {
    "process inputs": (
        "SELECT p.process_code, s.sample_code FROM process_event_inputs i JOIN process_events p USING (process_event_id) JOIN materials m USING (material_id) JOIN samples s ON s.sample_id = m.sample_id ORDER BY 1, 2",
        "SELECT p.process_code, s.sample_code FROM process_event_inputs i JOIN process_events p USING (process_event_id) JOIN samples s USING (sample_id) ORDER BY 1, 2",
    ),
    "process outputs": (
        "SELECT p.process_code, s.sample_code FROM process_event_outputs o JOIN process_events p USING (process_event_id) JOIN materials m USING (material_id) JOIN samples s ON s.sample_id = m.sample_id ORDER BY 1, 2",
        "SELECT p.process_code, s.sample_code FROM process_event_outputs o JOIN process_events p USING (process_event_id) JOIN samples s USING (sample_id) ORDER BY 1, 2",
    ),
    "quantity events": (
        "SELECT q.quantity_event_id, s.sample_code, q.quantity_change FROM material_quantity_events q JOIN materials m USING (material_id) JOIN samples s ON s.sample_id = m.sample_id ORDER BY 1",
        "SELECT q.quantity_event_id, s.sample_code, q.quantity_change FROM sample_quantity_events q JOIN samples s USING (sample_id) ORDER BY 1",
    ),
    "assays": (
        "SELECT a.assay_instance_code, s.sample_code FROM assays a JOIN materials m USING (material_id) JOIN samples s ON s.sample_id = m.sample_id ORDER BY 1",
        "SELECT a.assay_instance_code, s.sample_code FROM assays a JOIN samples s USING (sample_id) ORDER BY 1",
    ),
    "storage events": (
        "SELECT e.storage_event_id, s.sample_code, e.to_location_id FROM storage_events e JOIN materials m USING (material_id) JOIN samples s ON s.sample_id = m.sample_id ORDER BY 1",
        "SELECT e.storage_event_id, s.sample_code, e.to_location_id FROM storage_events e JOIN samples s USING (sample_id) ORDER BY 1",
    ),
    "data files": (
        "SELECT f.file_name, s.sample_code FROM data_files f JOIN materials m USING (material_id) JOIN samples s ON s.sample_id = m.sample_id ORDER BY 1",
        "SELECT f.file_name, s.sample_code FROM data_files f JOIN samples s USING (sample_id) ORDER BY 1",
    ),
}


def make_dgx_shaped(database_url: str) -> None:
    """Match the audited DGX database: 100 matched pairs plus one 'mosquito' root sample without a material,
    and a leftover legacy column that only the archived record keeps."""
    run_sql(
        database_url,
        "INSERT INTO samples (sample_code, sample_type, status, notes) VALUES ('MOSQ-001', 'mosquito', 'expected', 'Field caught')",
        "ALTER TABLE materials ADD COLUMN material_type VARCHAR(100)",
        "UPDATE materials SET material_type = 'legacy text type'",
    )


def test_dgx_shaped_data_migrates_without_loss(legacy_database_url):
    make_dgx_shaped(legacy_database_url)
    before_materials = query(legacy_database_url, MATERIAL_SNAPSHOT)
    before_links = {name: query(legacy_database_url, old) for name, (old, _) in LINK_SNAPSHOTS.items()}
    before_samples = query(legacy_database_url, "SELECT sample_code, notes FROM samples ORDER BY sample_code")

    alembic(legacy_database_url, "upgrade", "head")

    assert query(legacy_database_url, "SELECT version_num FROM alembic_version") == [(HEAD,)]
    assert query(legacy_database_url, "SELECT to_regclass('materials'), to_regclass('material_types')") == [(None, None)]
    assert query(legacy_database_url, "SELECT count(*) FROM samples") == [(101,)]

    after_materials = query(legacy_database_url, MIGRATED_SNAPSHOT)
    assert len(after_materials) == len(before_materials) == 100
    sample_notes_before = dict(before_samples)
    for before, after in zip(before_materials, after_materials):
        material_code, sample_code, *inventory, material_notes = before
        assert after[:2] == (material_code, sample_code), "each material maps to its corresponding sample"
        assert list(after[2:-1]) == inventory, f"inventory, type, label and status carried over for {material_code}"
        assert after[-1] == f"{sample_notes_before[sample_code]}\n\n[Legacy material {material_code}] {material_notes}"

    for name, (_, new) in LINK_SNAPSHOTS.items():
        assert query(legacy_database_url, new) == before_links[name], f"{name} still point at the same physical sample"

    assert query(legacy_database_url, "SELECT count(*) FROM samples WHERE parent_sample_id IS NOT NULL AND batch_id IS NOT NULL") == [(0,)]
    assert query(legacy_database_url, "SELECT count(*) FROM samples WHERE parent_sample_id IS NULL AND batch_id IS NOT NULL") == [(50,)]
    assert query(
        legacy_database_url,
        "SELECT t.type_name, s.status, s.notes FROM samples s JOIN sample_types t USING (sample_type_id) WHERE sample_code = 'MOSQ-001'",
    ) == [("mosquito", "expected", "Field caught")]
    assert query(legacy_database_url, "SELECT count(*) FROM legacy_material_records WHERE resolution = 'matched'") == [(100,)]
    assert query(
        legacy_database_url,
        "SELECT record->>'material_type', record->>'material_code' FROM legacy_material_records WHERE material_code = 'MAT-007-ROOT'",
    ) == [("legacy text type", "MAT-007-ROOT")]


def test_migrated_schema_matches_fresh_schema(legacy_database_url, make_database):
    alembic(legacy_database_url, "upgrade", "head")
    fresh_url = build_current_database(make_database())

    assert schema_shape(legacy_database_url) == schema_shape(fresh_url)


def test_material_derivatives_become_derived_samples(legacy_database_url):
    """A Material recorded under its parent's Sample (as the old aliquot endpoint did) gets its own Sample identity."""
    run_sql(legacy_database_url, """
        INSERT INTO process_types (type_code, type_name) VALUES ('aliquoting', 'Aliquoting');
        INSERT INTO process_events (process_code, process_type_id, status)
            SELECT 'ALIQ-1', process_type_id, 'completed' FROM process_types WHERE type_code = 'aliquoting';
        INSERT INTO materials (sample_id, material_type_id, parent_material_id, material_code, current_quantity, quantity_unit, status, notes)
            SELECT sample_id, material_type_id, material_id, 'MAT-001-ROOT-A' || n, 10, 'uL', 'available', 'aliquot ' || n
            FROM materials, generate_series(1, 2) n WHERE material_code = 'MAT-001-ROOT';
        INSERT INTO materials (sample_id, material_type_id, parent_material_id, material_code, status)
            SELECT sample_id, material_type_id, material_id, 'MAT-001-ROOT-A1-RNA', 'available'
            FROM materials WHERE material_code = 'MAT-001-ROOT-A1';
        INSERT INTO process_event_outputs (process_event_id, material_id, quantity_generated, quantity_unit)
            SELECT p.process_event_id, m.material_id, 10, 'uL' FROM process_events p, materials m
            WHERE p.process_code = 'ALIQ-1' AND m.material_code LIKE 'MAT-001-ROOT-A_';
    """)

    alembic(legacy_database_url, "upgrade", "head")

    assert query(legacy_database_url, """
        SELECT s.sample_code, parent.sample_code, s.current_quantity, s.status, s.notes, s.batch_id, r.resolution
        FROM samples s
        JOIN samples parent ON parent.sample_id = s.parent_sample_id
        JOIN legacy_material_records r ON r.sample_id = s.sample_id
        WHERE s.sample_code LIKE 'MAT-001-ROOT-A%'
        ORDER BY s.sample_code
    """) == [
        ("MAT-001-ROOT-A1", "SAMPLE-001-ROOT", 10, "available", "aliquot 1", None, "new_sample"),
        ("MAT-001-ROOT-A1-RNA", "MAT-001-ROOT-A1", None, "available", None, None, "new_sample"),
        ("MAT-001-ROOT-A2", "SAMPLE-001-ROOT", 10, "available", "aliquot 2", None, "new_sample"),
    ]
    assert query(legacy_database_url, """
        SELECT s.sample_code FROM process_event_outputs o JOIN process_events p USING (process_event_id) JOIN samples s USING (sample_id)
        WHERE p.process_code = 'ALIQ-1' ORDER BY 1
    """) == [("MAT-001-ROOT-A1",), ("MAT-001-ROOT-A2",)]


def test_ambiguous_identities_abort_and_leave_the_database_untouched(legacy_database_url):
    run_sql(legacy_database_url, """
        INSERT INTO materials (sample_id, material_type_id, material_code, status)
        SELECT sample_id, 1, 'MAT-002-PLASMA', 'available' FROM samples WHERE sample_code = 'SAMPLE-002-ROOT'
    """)

    with pytest.raises(Exception, match="do not resolve to a single sample identity"):
        alembic(legacy_database_url, "upgrade", "head")

    assert query(legacy_database_url, "SELECT version_num FROM alembic_version") == [("20260826_0003",)]
    assert query(legacy_database_url, "SELECT count(*) FROM materials") == [(101,)]
    assert query(legacy_database_url, "SELECT to_regclass('legacy_material_records')") == [(None,)]


def test_derived_sample_in_a_different_batch_aborts(legacy_database_url):
    run_sql(legacy_database_url, """
        UPDATE samples SET batch_id = (SELECT batch_id FROM batches WHERE batch_code = 'BATCH-002')
        WHERE sample_code = 'SAMPLE-001-CHILD'
    """)

    with pytest.raises(Exception, match="different shipping batch"):
        alembic(legacy_database_url, "upgrade", "head")

    assert query(legacy_database_url, "SELECT version_num FROM alembic_version") == [("20260826_0003",)]


def test_meaningful_free_text_types_are_kept_in_notes(legacy_database_url):
    """Only lineage-restating values are dropped; anything else the lookup type cannot hold goes to notes."""
    run_sql(
        legacy_database_url,
        "UPDATE samples SET sample_type = 'serum' WHERE sample_code = 'SAMPLE-003-ROOT'",
        "UPDATE samples SET sample_type = 'Incoming sample' WHERE sample_code = 'SAMPLE-004-CHILD'",
    )

    alembic(legacy_database_url, "upgrade", "head")

    notes = dict(query(legacy_database_url, "SELECT sample_code, notes FROM samples WHERE sample_code IN ('SAMPLE-003-ROOT', 'SAMPLE-004-CHILD', 'SAMPLE-005-ROOT')"))
    assert notes["SAMPLE-003-ROOT"].endswith("[Legacy sample type] serum")
    assert notes["SAMPLE-004-CHILD"].endswith("[Legacy sample type] Incoming sample")
    assert "Legacy sample type" not in notes["SAMPLE-005-ROOT"]
    assert query(legacy_database_url, "SELECT count(*) FROM sample_types WHERE type_name IN ('serum', 'Incoming sample', 'Derived sample')") == [(0,)]


def test_legacy_material_codes_find_their_sample_through_the_api(legacy_database_url):
    alembic(legacy_database_url, "upgrade", "head")

    with api_client(legacy_database_url) as client:
        found = client.get("/samples/lookup", params={"code": "MAT-010-CHILD"})
        assert found.status_code == 200
        assert found.json()["sample_code"] == "SAMPLE-010-CHILD"

        detail = client.get(f"/samples/{found.json()['sample_id']}").json()
        assert [item["material_code"] for item in detail["legacy_identifiers"]] == ["MAT-010-CHILD"]
        assert detail["legacy_codes"] == ["MAT-010-CHILD"]
        assert [assay["assay_code"] for assay in detail["assays"]] == ["ASSAY-010"]
        assert detail["parent"]["sample_code"] == "SAMPLE-010-ROOT"

        reused = client.post("/samples", json={"sample_code": "MAT-010-ROOT"})
        assert reused.status_code == 400
        assert "legacy material code" in reused.json()["detail"]


def schema_shape(database_url: str) -> dict:
    """Columns, keys and checks, ignoring constraint names and column order."""
    return {
        "columns": set(query(database_url, """
            SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable
            FROM information_schema.columns WHERE table_schema = 'public'
        """)),
        "foreign_keys": set(query(database_url, """
            SELECT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name, rc.delete_rule
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
            JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
        """)),
        "keys": set(query(database_url, """
            SELECT conrelid::regclass::text, contype, array_to_string(array(
                SELECT attname FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY(conkey) ORDER BY attname
            ), ',')
            FROM pg_constraint
            WHERE contype IN ('p', 'u') AND connamespace = 'public'::regnamespace
        """)),
        "checks": set(query(database_url, """
            SELECT conrelid::regclass::text, pg_get_constraintdef(oid) FROM pg_constraint
            WHERE contype = 'c' AND connamespace = 'public'::regnamespace
        """)),
        "triggers": set(query(database_url, """
            SELECT event_object_table, trigger_name FROM information_schema.triggers WHERE trigger_schema = 'public'
        """)),
    }


def test_fresh_database_starts_at_head(current_database_url):
    """docker compose loads schema.sql, then the backend runs `alembic upgrade head` on start; that must be a no-op."""
    alembic(current_database_url, "upgrade", "head")

    assert query(current_database_url, "SELECT version_num FROM alembic_version") == [(HEAD,)]
