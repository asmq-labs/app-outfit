"""remove outfits broken by deleted garments

Revision ID: d4e7a19c3b52
Revises: 99b65011790b
"""

from alembic import op

revision = "d4e7a19c3b52"
down_revision = "99b65011790b"
branch_labels = None
depends_on = None

WHOLE = (
    "(one_piece_id IS NOT NULL OR (top_id IS NOT NULL AND bottom_id IS NOT NULL))"
    " AND shoes_id IS NOT NULL"
)
EMPTY = (
    "top_id IS NULL AND bottom_id IS NULL AND one_piece_id IS NULL"
    " AND outerwear_id IS NULL AND shoes_id IS NULL AND accessory_id IS NULL"
)


def upgrade() -> None:
    op.execute(f"DELETE FROM saved_outfits WHERE NOT ({WHOLE})")
    op.execute(f"DELETE FROM outfits WHERE worn_at IS NULL AND NOT ({WHOLE})")
    op.execute(f"DELETE FROM outfits WHERE worn_at IS NOT NULL AND {EMPTY}")


def downgrade() -> None:
    pass
