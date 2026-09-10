"""Drop the volunteer assignments table.

The panel that wrote it stood on the match and training screens and was never
used. 0016 is left where it is so the chain still reads straight; this drops
the table a deployed database still has.

Revision ID: 20260910_0028
Revises: 20260910_0027
Create Date: 2026-09-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260910_0028"
down_revision: str | None = "20260910_0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_table("event_assignments")


def downgrade() -> None:
    op.create_table(
        "event_assignments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "match_id",
            sa.String(36),
            sa.ForeignKey("matches.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "training_session_id",
            sa.String(36),
            sa.ForeignKey("training_sessions.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column(
            "assigned_player_id",
            sa.String(36),
            sa.ForeignKey("players.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(match_id IS NULL) <> (training_session_id IS NULL)",
            name="ck_assignment_one_parent",
        ),
    )
