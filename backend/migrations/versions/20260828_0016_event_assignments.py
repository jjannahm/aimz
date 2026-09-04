"""Attach claimable jobs to a match or a training session.

Ported from the Worker migration 0017_assignments. Exactly one of match_id /
training_session_id is set; a job may be claimed by one roster player.

Revision ID: 20260828_0016
Revises: 20260828_0015
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0016"
down_revision: str | None = "20260828_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "event_assignments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("match_id", sa.String(length=36), nullable=True),
        sa.Column("training_session_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("assigned_player_id", sa.String(length=36), nullable=True),
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
        sa.CheckConstraint(
            "(match_id IS NULL) <> (training_session_id IS NULL)",
            name="ck_assignment_one_parent",
        ),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["training_session_id"], ["training_sessions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["assigned_player_id"], ["players.id"], ondelete="SET NULL"
        ),
    )
    op.create_index("ix_assignments_match", "event_assignments", ["match_id"])
    op.create_index(
        "ix_assignments_training", "event_assignments", ["training_session_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_assignments_training", table_name="event_assignments")
    op.drop_index("ix_assignments_match", table_name="event_assignments")
    op.drop_table("event_assignments")
