"""sample geolocation: optional latitude and longitude on samples

Where a Sample was collected, in decimal degrees (WGS 84), for the sample map.
Both are nullable and independent of every other field: nothing is inferred
from subject, source or batch. The checks keep values on the globe. They are
not required in pairs, because the Sample page saves one field at a time; the
sample map plots only Samples that have both. Additive: existing rows are
unchanged.

Revision ID: 20261119_0009
Revises: 20261104_0008
Create Date: 2026-11-19
"""
from alembic import op

revision = "20261119_0009"
down_revision = "20261104_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE samples ADD COLUMN latitude NUMERIC(9,6) NULL")
    op.execute("ALTER TABLE samples ADD COLUMN longitude NUMERIC(9,6) NULL")
    op.execute("ALTER TABLE samples ADD CONSTRAINT ck_sample_latitude CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90))")
    op.execute("ALTER TABLE samples ADD CONSTRAINT ck_sample_longitude CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))")


def downgrade() -> None:
    op.execute("ALTER TABLE samples DROP CONSTRAINT ck_sample_longitude")
    op.execute("ALTER TABLE samples DROP CONSTRAINT ck_sample_latitude")
    op.execute("ALTER TABLE samples DROP COLUMN longitude")
    op.execute("ALTER TABLE samples DROP COLUMN latitude")
