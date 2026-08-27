"""reset identity sequences after seeded ids

Revision ID: 20260826_0003
Revises: 20260826_0002
Create Date: 2026-08-26
"""

from alembic import op


revision = "20260826_0003"
down_revision = "20260826_0002"
branch_labels = None
depends_on = None


IDENTITY_COLUMNS = [
    ("batches", "batch_id"),
    ("samples", "sample_id"),
    ("storage_locations", "storage_location_id"),
    ("material_types", "material_type_id"),
    ("materials", "material_id"),
    ("process_types", "process_type_id"),
    ("protocols", "protocol_id"),
    ("process_events", "process_event_id"),
    ("material_quantity_events", "quantity_event_id"),
    ("assay_definitions", "assay_definition_id"),
    ("assay_runs", "assay_run_id"),
    ("assays", "assay_id"),
    ("assay_results", "assay_result_id"),
    ("storage_events", "storage_event_id"),
    ("data_files", "data_file_id"),
]


def upgrade():
    for table_name, column_name in IDENTITY_COLUMNS:
        op.execute(f"""
            SELECT setval(
                pg_get_serial_sequence('{table_name}', '{column_name}'),
                GREATEST((SELECT COALESCE(MAX({column_name}), 0) + 1 FROM {table_name}), 1),
                false
            )
            WHERE pg_get_serial_sequence('{table_name}', '{column_name}') IS NOT NULL;
        """)


def downgrade():
    pass
