"""outfit feelings

Revision ID: e8c2a75b1d09
Revises: d4e7a19c3b52
"""

import sqlalchemy as sa
from alembic import op

revision = "e8c2a75b1d09"
down_revision = "d4e7a19c3b52"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "outfits",
        sa.Column(
            "feeling",
            sa.Enum("good", "bad", name="feeling", native_enum=False, length=20),
            nullable=True,
        ),
    )
    op.add_column(
        "outfits", sa.Column("feeling_reasons", sa.JSON(), server_default="[]", nullable=False)
    )
    op.add_column("outfits", sa.Column("felt_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("outfits", "felt_at")
    op.drop_column("outfits", "feeling_reasons")
    op.drop_column("outfits", "feeling")
