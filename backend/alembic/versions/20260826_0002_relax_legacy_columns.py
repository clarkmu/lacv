"""relax legacy columns after lookup migration

Revision ID: 20260826_0002
Revises: 20260826_0001
Create Date: 2026-08-26
"""
from typing import Sequence, Union

from alembic import op

revision: str = "20260826_0002"
down_revision: Union[str, Sequence[str], None] = "20260826_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    _drop_not_null_if_column_exists("materials", "material_type")
    _drop_not_null_if_column_exists("process_events", "process_type")
    _drop_not_null_if_column_exists("assays", "assay_code")
    _drop_not_null_if_column_exists("assays", "assay_type")


def downgrade() -> None:
    pass


def _drop_not_null_if_column_exists(table_name: str, column_name: str) -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = '{table_name}'
                  AND column_name = '{column_name}'
            ) THEN
                ALTER TABLE {table_name} ALTER COLUMN {column_name} DROP NOT NULL;
            END IF;
        END $$;
        """
    )
