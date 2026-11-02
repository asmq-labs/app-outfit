"""feeling garments

Revision ID: a1f4c86e2d37
Revises: e8c2a75b1d09
"""

import sqlalchemy as sa
from alembic import op

revision = "a1f4c86e2d37"
down_revision = "e8c2a75b1d09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "outfits", sa.Column("feeling_garment_ids", sa.JSON(), server_default="[]", nullable=False)
    )


def downgrade() -> None:
    op.drop_column("outfits", "feeling_garment_ids")
