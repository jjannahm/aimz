"""Cut an invitation for one player so their account knows whose stats are its own.

Revision ID: 20260825_0011
Revises: 20260821_0010
Create Date: 2026-08-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0011"
down_revision: str | None = "20260821_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registration_invites", sa.Column("player_id", sa.String(length=36), nullable=True)
    )
    op.create_index(
        "ix_registration_invites_player_id",
        "registration_invites",
        ["player_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_registration_invites_player_id",
        "registration_invites",
        "players",
        ["player_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_registration_invites_player_id", "registration_invites", type_="foreignkey"
    )
    op.drop_index("ix_registration_invites_player_id", table_name="registration_invites")
    op.drop_column("registration_invites", "player_id")
