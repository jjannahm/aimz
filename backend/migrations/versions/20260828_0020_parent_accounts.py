"""Parent accounts.

Ported from the Worker migrations 0019_parent_accounts / 0023_parent_role. A
player account links to one roster player, which ``users.player_id`` already
carries as a unique column. A parent may have several children, so that
one-to-one cannot be widened in place: the children hang off ``user_children``
and ``users.player_id`` stays as it is for players.

An invitation now says which kind it creates and carries its players the same
way for both, in ``invite_players``, so one redemption path reads either. Rows
written before this migration named their player in a column of their own, so
those are carried across.

``users.role`` is a non-native enum stored as a string with no CHECK constraint
in this backend, so widening it to admit 'parent' needs no schema change — the
rebuild the Worker's 0023 had to do (SQLite cannot alter a CHECK) has no
counterpart here.

Revision ID: 20260828_0020
Revises: 20260828_0019
Create Date: 2026-09-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0020"
down_revision: str | None = "20260828_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "registration_invites",
        sa.Column(
            "kind",
            sa.String(length=20),
            nullable=False,
            server_default="player",
        ),
    )
    op.create_index(
        "ix_registration_invites_kind", "registration_invites", ["kind"]
    )

    op.create_table(
        "invite_players",
        sa.Column("invite_id", sa.String(length=36), primary_key=True),
        sa.Column("player_id", sa.String(length=36), primary_key=True),
        sa.ForeignKeyConstraint(
            ["invite_id"], ["registration_invites.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_invite_players_invite", "invite_players", ["invite_id"])

    op.create_table(
        "user_children",
        sa.Column("user_id", sa.String(length=36), primary_key=True),
        sa.Column("player_id", sa.String(length=36), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_user_children_user", "user_children", ["user_id"])

    # Invitations written before this migration named their player in a column
    # of their own. Carry those across so redemption only reads one place.
    op.execute(
        "INSERT INTO invite_players (invite_id, player_id) "
        "SELECT id, player_id FROM registration_invites WHERE player_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_user_children_user", table_name="user_children")
    op.drop_table("user_children")
    op.drop_index("ix_invite_players_invite", table_name="invite_players")
    op.drop_table("invite_players")
    op.drop_index(
        "ix_registration_invites_kind", table_name="registration_invites"
    )
    op.drop_column("registration_invites", "kind")
