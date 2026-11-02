"""taste signals and garment tags

Revision ID: b7d29e41c6f0
Revises: a1f4c86e2d37
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b7d29e41c6f0"
down_revision = "a1f4c86e2d37"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "garments",
        sa.Column("tags", postgresql.JSONB(), server_default="[]", nullable=False),
    )
    # Finds "every garment with this tag" as closets grow.
    op.create_index("ix_garments_tags", "garments", ["tags"], postgresql_using="gin")
    op.create_table(
        "taste_signals",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("garment_id", sa.Uuid(), nullable=True),
        sa.Column("outfit_id", sa.Uuid(), nullable=True),
        sa.Column(
            "kind",
            sa.Enum(
                "felt",
                "worn",
                "skipped",
                "swapped_out",
                "swapped_in",
                "hand_picked",
                name="signalkind",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("value", sa.String(length=40), nullable=True),
        sa.Column(
            "occasion",
            sa.Enum(
                "casual",
                "work",
                "night_out",
                "formal",
                "sport",
                name="occasion",
                native_enum=False,
                length=20,
            ),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["garment_id"], ["garments.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["outfit_id"], ["outfits.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_taste_signals_user_kind", "taste_signals", ["user_id", "kind"])
    op.create_index("ix_taste_signals_garment_id", "taste_signals", ["garment_id"])
    op.create_index("ix_taste_signals_outfit_id", "taste_signals", ["outfit_id"])


def downgrade() -> None:
    op.drop_table("taste_signals")
    op.drop_index("ix_garments_tags", table_name="garments")
    op.drop_column("garments", "tags")
