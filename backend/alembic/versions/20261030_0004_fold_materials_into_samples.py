"""fold materials into samples

Sample becomes the single physical identity and lineage tree. Each legacy
Material resolves to exactly one Sample (see app/legacy_identity.py):

- matched: the Material was the inventory record of an existing Sample. Its
  inventory fields, type, label and status move onto that Sample; notes from
  both are kept, the Material's labelled with its code.
- new_sample: the Material was a real derivative with no Sample. It becomes a
  derived Sample that keeps the Material code as its sample code.

Anything ambiguous aborts the migration; run scripts/legacy_identity_audit.py
to see why. Every original materials row is kept in legacy_material_records,
which also keeps legacy Material codes searchable. Process inputs/outputs,
quantity events, assays, storage events and data files are retargeted from
material_id to sample_id.

Revision ID: 20261030_0004
Revises: 20260826_0003
Create Date: 2026-10-30
"""
import re

import sqlalchemy as sa
from alembic import op

from app.legacy_identity import AMBIGUOUS, MATCHED, NEW_SAMPLE, classify_materials

revision = "20261030_0004"
down_revision = "20260826_0003"
branch_labels = None
depends_on = None

# Free-text sample types that only restate lineage (root vs derived).
LINEAGE_TYPE_LABELS = {"incoming sample": "root", "derived sample": "derived"}

# (table, nullable, primary key columns or None)
RETARGETED_TABLES = [
    ("process_event_inputs", False, ("process_event_id", "sample_id")),
    ("process_event_outputs", False, ("process_event_id", "sample_id")),
    ("material_quantity_events", False, None),
    ("assays", False, None),
    ("storage_events", False, None),
    ("data_files", True, None),
]

FK_NAMES = {
    "process_event_inputs": ("fk_process_input_sample", "idx_process_input_sample", "RESTRICT"),
    "process_event_outputs": ("fk_process_output_sample", "idx_process_output_sample", "RESTRICT"),
    "sample_quantity_events": ("fk_quantity_sample", "idx_quantity_sample", "RESTRICT"),
    "assays": ("fk_assay_sample", "idx_assay_sample", "RESTRICT"),
    "storage_events": ("fk_storage_event_sample", "idx_storage_event_sample", "RESTRICT"),
    "data_files": ("fk_data_file_sample", "idx_data_file_sample", "SET NULL"),
}


def upgrade() -> None:
    bind = op.get_bind()
    samples = _rows(bind, "SELECT sample_id, sample_code, parent_sample_id, batch_id FROM samples ORDER BY sample_id")
    materials = _rows(bind, "SELECT material_id, material_code, sample_id, parent_material_id FROM materials ORDER BY material_id")
    resolutions = classify_materials(samples, materials)
    _refuse_unknown_material_references(bind)
    _refuse_ambiguous_identities(resolutions, {m["material_id"]: m for m in materials})
    _refuse_derived_batch_conflicts(samples)

    _rename_material_types()
    _add_sample_columns()
    _create_provenance_tables()
    _record_identities(bind, resolutions, materials)
    _copy_material_fields_onto_samples()
    _convert_free_text_sample_types(bind)
    _retarget_material_references()
    op.execute("DROP TABLE materials")
    _finish_samples_table()


def downgrade() -> None:
    raise NotImplementedError("Folding materials into samples is not reversible; restore the pre-migration database backup.")


def _rows(bind, sql: str) -> list[dict]:
    return [dict(row) for row in bind.execute(sa.text(sql)).mappings()]


def _refuse_unknown_material_references(bind) -> None:
    """Only the known tables may point at materials; anything else would be silently orphaned."""
    referencing = set(bind.execute(sa.text(
        """
        SELECT conrelid::regclass::text FROM pg_constraint
        WHERE contype = 'f' AND confrelid = 'materials'::regclass AND conrelid <> 'materials'::regclass
        """
    )).scalars())
    unexpected = sorted(referencing - {table for table, _, _ in RETARGETED_TABLES})
    if unexpected:
        raise RuntimeError("Unexpected tables reference materials; nothing was migrated: " + ", ".join(unexpected))


def _refuse_ambiguous_identities(resolutions, materials_by_id) -> None:
    ambiguous = [(materials_by_id[mid]["material_code"], r.reason) for mid, r in resolutions.items() if r.kind == AMBIGUOUS]
    if ambiguous:
        details = "\n".join(f"  {code}: {reason}" for code, reason in ambiguous[:20])
        raise RuntimeError(
            f"{len(ambiguous)} legacy materials do not resolve to a single sample identity; nothing was migrated.\n"
            f"{details}\nRun backend/scripts/legacy_identity_audit.py for the full report."
        )


def _refuse_derived_batch_conflicts(samples) -> None:
    """Shipping batches hold root samples only; never drop a batch that differs from the root's."""
    samples_by_id = {s["sample_id"]: s for s in samples}
    conflicts = []
    for sample in samples:
        if sample["parent_sample_id"] is None or sample["batch_id"] is None:
            continue
        root, seen = sample, set()
        while root["parent_sample_id"] in samples_by_id and root["sample_id"] not in seen:
            seen.add(root["sample_id"])
            root = samples_by_id[root["parent_sample_id"]]
        if root["batch_id"] != sample["batch_id"]:
            conflicts.append(sample["sample_code"])
    if conflicts:
        raise RuntimeError(
            "Derived samples belong to a different shipping batch than their root sample; nothing was migrated: "
            + ", ".join(conflicts[:20])
        )


def _rename_material_types() -> None:
    op.execute("ALTER TABLE material_types RENAME TO sample_types")
    op.execute("ALTER TABLE sample_types RENAME COLUMN material_type_id TO sample_type_id")
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_material_types_updated_at') THEN
                ALTER TRIGGER trg_material_types_updated_at ON sample_types RENAME TO trg_sample_types_updated_at;
            END IF;
        END $$;
        """
    )


def _add_sample_columns() -> None:
    op.execute(
        """
        ALTER TABLE samples
            ADD COLUMN sample_type_id BIGINT NULL,
            ADD COLUMN label VARCHAR(255) NULL,
            ADD COLUMN subtype VARCHAR(100) NULL,
            ADD COLUMN current_quantity NUMERIC(16,6) NULL,
            ADD COLUMN quantity_unit VARCHAR(50) NULL,
            ADD COLUMN concentration NUMERIC(16,6) NULL,
            ADD COLUMN concentration_unit VARCHAR(50) NULL,
            ADD COLUMN storage_location_id BIGINT NULL,
            ADD COLUMN is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN is_disposed BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN expiration_date TIMESTAMP NULL
        """
    )


def _create_provenance_tables() -> None:
    op.execute(
        """
        CREATE TABLE legacy_material_records (
            legacy_material_id BIGINT PRIMARY KEY,
            sample_id BIGINT NOT NULL,
            material_code VARCHAR(120) NOT NULL UNIQUE,
            resolution VARCHAR(20) NOT NULL,
            record JSONB NOT NULL,
            migrated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_legacy_material_sample FOREIGN KEY (sample_id) REFERENCES samples(sample_id) ON DELETE RESTRICT,
            CONSTRAINT ck_legacy_material_resolution CHECK (resolution IN ('matched', 'new_sample'))
        );
        CREATE INDEX idx_legacy_material_sample ON legacy_material_records(sample_id);

        CREATE TABLE assay_outputs (
            assay_id BIGINT NOT NULL,
            sample_id BIGINT NOT NULL,
            notes TEXT NULL,
            PRIMARY KEY (assay_id, sample_id),
            CONSTRAINT fk_assay_output_assay FOREIGN KEY (assay_id) REFERENCES assays(assay_id) ON DELETE CASCADE,
            CONSTRAINT fk_assay_output_sample FOREIGN KEY (sample_id) REFERENCES samples(sample_id) ON DELETE RESTRICT
        );
        CREATE INDEX idx_assay_output_sample ON assay_outputs(sample_id);
        """
    )


def _record_identities(bind, resolutions, materials) -> None:
    """Create Samples for derivative Materials, then store every Material's resolved Sample."""
    sample_id_by_material: dict[int, int] = {
        mid: r.sample_id for mid, r in resolutions.items() if r.kind == MATCHED
    }
    pending = [m for m in materials if resolutions[m["material_id"]].kind == NEW_SAMPLE]
    while pending:
        remaining = []
        for material in pending:
            parent_ref = resolutions[material["material_id"]].parent_ref
            if parent_ref and parent_ref[0] == "material" and parent_ref[1] not in sample_id_by_material:
                remaining.append(material)
                continue
            parent_sample_id = None
            if parent_ref:
                parent_sample_id = parent_ref[1] if parent_ref[0] == "sample" else sample_id_by_material[parent_ref[1]]
            sample_id_by_material[material["material_id"]] = bind.execute(
                sa.text("INSERT INTO samples (parent_sample_id, sample_code) VALUES (:parent, :code) RETURNING sample_id"),
                {"parent": parent_sample_id, "code": resolutions[material["material_id"]].new_sample_code},
            ).scalar_one()
        if len(remaining) == len(pending):
            raise RuntimeError("Could not order derived materials by parent; nothing was migrated.")
        pending = remaining

    op.execute("CREATE TEMP TABLE material_identity (material_id BIGINT PRIMARY KEY, sample_id BIGINT NOT NULL, resolution VARCHAR(20) NOT NULL) ON COMMIT DROP")
    if sample_id_by_material:
        bind.execute(
            sa.text("INSERT INTO material_identity (material_id, sample_id, resolution) VALUES (:material_id, :sample_id, :resolution)"),
            [
                {"material_id": mid, "sample_id": sid, "resolution": resolutions[mid].kind}
                for mid, sid in sample_id_by_material.items()
            ],
        )
    op.execute(
        """
        INSERT INTO legacy_material_records (legacy_material_id, sample_id, material_code, resolution, record)
        SELECT m.material_id, identity.sample_id, m.material_code, identity.resolution, to_jsonb(m)
        FROM materials m
        JOIN material_identity identity ON identity.material_id = m.material_id
        """
    )


def _copy_material_fields_onto_samples() -> None:
    op.execute(
        """
        UPDATE samples s SET
            sample_type_id = m.material_type_id,
            label = m.material_label,
            subtype = m.material_subtype,
            current_quantity = m.current_quantity,
            quantity_unit = m.quantity_unit,
            concentration = m.concentration,
            concentration_unit = m.concentration_unit,
            storage_location_id = m.storage_location_id,
            is_consumed = m.is_consumed,
            is_disposed = m.is_disposed,
            expiration_date = m.expiration_date,
            status = m.status,
            notes = CASE
                WHEN identity.resolution = 'new_sample' THEN m.notes
                WHEN m.notes IS NULL OR btrim(m.notes) = '' THEN s.notes
                WHEN s.notes IS NULL OR btrim(s.notes) = '' THEN '[Legacy material ' || m.material_code || '] ' || m.notes
                WHEN btrim(s.notes) = btrim(m.notes) THEN s.notes
                ELSE s.notes || E'\\n\\n[Legacy material ' || m.material_code || '] ' || m.notes
            END
        FROM materials m
        JOIN material_identity identity ON identity.material_id = m.material_id
        WHERE s.sample_id = identity.sample_id
        """
    )


def _convert_free_text_sample_types(bind) -> None:
    """Move samples.sample_type into the sample_types lookup without losing meaningful values.

    "Incoming sample" on a root and "Derived sample" on a child only restate
    lineage and are dropped. Other values become the Sample's type when it has
    none (for example "mosquito"); otherwise they are appended to its notes.
    """
    rows = _rows(
        bind,
        """
        SELECT s.sample_id, btrim(s.sample_type) AS legacy_type, s.parent_sample_id, s.sample_type_id, t.type_name
        FROM samples s
        LEFT JOIN sample_types t ON t.sample_type_id = s.sample_type_id
        WHERE s.sample_type IS NOT NULL AND btrim(s.sample_type) <> ''
        """,
    )
    type_ids: dict[str, int] = {}
    for row in rows:
        legacy_type = row["legacy_type"]
        lineage_label = LINEAGE_TYPE_LABELS.get(legacy_type.lower())
        position = "root" if row["parent_sample_id"] is None else "derived"
        if lineage_label == position:
            continue
        if row["type_name"] and row["type_name"].strip().lower() == legacy_type.lower():
            continue
        if row["sample_type_id"] is None and lineage_label is None:
            if legacy_type.lower() not in type_ids:
                type_ids[legacy_type.lower()] = _get_or_create_sample_type(bind, legacy_type)
            bind.execute(
                sa.text("UPDATE samples SET sample_type_id = :type_id WHERE sample_id = :sample_id"),
                {"type_id": type_ids[legacy_type.lower()], "sample_id": row["sample_id"]},
            )
            continue
        bind.execute(
            sa.text(
                """
                UPDATE samples
                SET notes = CASE WHEN notes IS NULL OR btrim(notes) = '' THEN :line ELSE notes || E'\\n\\n' || :line END
                WHERE sample_id = :sample_id
                """
            ),
            {"line": f"[Legacy sample type] {legacy_type}", "sample_id": row["sample_id"]},
        )
    op.execute("ALTER TABLE samples DROP COLUMN sample_type")


def _get_or_create_sample_type(bind, type_name: str) -> int:
    existing = bind.execute(
        sa.text("SELECT sample_type_id FROM sample_types WHERE lower(btrim(type_name)) = lower(:name) ORDER BY sample_type_id LIMIT 1"),
        {"name": type_name},
    ).scalar()
    if existing is not None:
        return existing
    base_code = re.sub(r"[^a-z0-9]+", "_", type_name.lower()).strip("_")[:90] or "sample_type"
    code, suffix = base_code, 2
    while bind.execute(sa.text("SELECT 1 FROM sample_types WHERE type_code = :code"), {"code": code}).scalar():
        code, suffix = f"{base_code}_{suffix}", suffix + 1
    return bind.execute(
        sa.text(
            """
            INSERT INTO sample_types (type_code, type_name, description, sort_order)
            VALUES (:code, :name, 'Created from a legacy free-text sample type', 0)
            RETURNING sample_type_id
            """
        ),
        {"code": code, "name": type_name},
    ).scalar_one()


def _retarget_material_references() -> None:
    for table, nullable, primary_key in RETARGETED_TABLES:
        op.execute(f"ALTER TABLE {table} ADD COLUMN sample_id BIGINT NULL")
        op.execute(
            f"""
            UPDATE {table} t SET sample_id = identity.sample_id
            FROM material_identity identity
            WHERE identity.material_id = t.material_id
            """
        )
        op.execute(f"ALTER TABLE {table} DROP COLUMN material_id")
        if not nullable:
            op.execute(f"ALTER TABLE {table} ALTER COLUMN sample_id SET NOT NULL")
        if primary_key:
            op.execute(f"ALTER TABLE {table} ADD PRIMARY KEY ({', '.join(primary_key)})")

    op.execute("ALTER TABLE material_quantity_events RENAME TO sample_quantity_events")
    for table, (fk_name, index_name, on_delete) in FK_NAMES.items():
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {fk_name} FOREIGN KEY (sample_id) REFERENCES samples(sample_id) ON DELETE {on_delete}"
        )
        op.execute(f"CREATE INDEX {index_name} ON {table}(sample_id)")


def _finish_samples_table() -> None:
    op.execute("UPDATE samples SET batch_id = NULL WHERE parent_sample_id IS NOT NULL AND batch_id IS NOT NULL")
    op.execute(
        """
        ALTER TABLE samples
            ADD CONSTRAINT fk_sample_type FOREIGN KEY (sample_type_id) REFERENCES sample_types(sample_type_id) ON DELETE RESTRICT,
            ADD CONSTRAINT fk_sample_storage FOREIGN KEY (storage_location_id) REFERENCES storage_locations(storage_location_id) ON DELETE SET NULL,
            ADD CONSTRAINT ck_sample_batch_root CHECK (parent_sample_id IS NULL OR batch_id IS NULL),
            ADD CONSTRAINT ck_sample_not_own_parent CHECK (parent_sample_id IS NULL OR parent_sample_id <> sample_id);
        CREATE INDEX idx_sample_type ON samples(sample_type_id);
        CREATE INDEX idx_sample_storage ON samples(storage_location_id);
        """
    )
