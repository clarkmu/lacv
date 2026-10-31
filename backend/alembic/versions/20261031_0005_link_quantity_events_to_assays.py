"""link quantity events to the assay that used the volume

An assay can now record the volume it used from its Sample. That removal is a
normal sample_quantity_events row (event_type "consumed"), the same ledger the
Sample availability calculation reads, and related_assay_id says which assay
it was for, just as related_process_event_id does for processes. Additive and
nullable: existing rows are unchanged.

Revision ID: 20261031_0005
Revises: 20261030_0004
Create Date: 2026-10-31
"""
from alembic import op

revision = "20261031_0005"
down_revision = "20261030_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE sample_quantity_events ADD COLUMN related_assay_id BIGINT NULL")
    op.execute("""
        ALTER TABLE sample_quantity_events ADD CONSTRAINT fk_quantity_assay
        FOREIGN KEY (related_assay_id) REFERENCES assays(assay_id) ON DELETE RESTRICT
    """)
    op.execute("CREATE INDEX idx_quantity_assay ON sample_quantity_events(related_assay_id)")


def downgrade() -> None:
    op.execute("DROP INDEX idx_quantity_assay")
    op.execute("ALTER TABLE sample_quantity_events DROP CONSTRAINT fk_quantity_assay")
    op.execute("ALTER TABLE sample_quantity_events DROP COLUMN related_assay_id")
