"""Keep a player's birth date and guardian contacts for the private roster.

Ported from the Cloudflare Worker migration 0018_player_contacts. Contacts are
admin-only data; the date of birth is a plain YYYY-MM-DD string to match the
roster contract byte-for-byte.

Revision ID: 20260828_0014
Revises: 20260828_0013
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0014"
down_revision: str | None = "20260828_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "players", sa.Column("date_of_birth", sa.String(length=10), nullable=True)
    )
    op.create_table(
        "player_contacts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("player_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("relationship", sa.String(length=80), nullable=True),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("phone", sa.String(length=60), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_contacts_player", "player_contacts", ["player_id"])


def downgrade() -> None:
    op.drop_index("ix_contacts_player", table_name="player_contacts")
    op.drop_table("player_contacts")
    op.drop_column("players", "date_of_birth")
