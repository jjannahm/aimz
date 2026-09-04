"""Schedule squad training and collect going / not-going answers.

Ported from the Worker migrations 0014_training_sessions + 0016_availability,
already folded to the two-way availability of 0026_availability_two_way (no
"maybe"). Recurring sessions share a ``series_id``.

Revision ID: 20260828_0015
Revises: 20260828_0014
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0015"
down_revision: str | None = "20260828_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "training_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("team_id", sa.String(length=36), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "duration_minutes",
            sa.Integer(),
            nullable=False,
            server_default="90",
        ),
        sa.Column("venue", sa.String(length=200), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("series_id", sa.String(length=36), nullable=True),
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
            "duration_minutes BETWEEN 15 AND 300", name="ck_training_duration"
        ),
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_training_team_start", "training_sessions", ["team_id", "starts_at"]
    )
    op.create_index("ix_training_series", "training_sessions", ["series_id"])

    op.create_table(
        "training_availability",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("training_session_id", sa.String(length=36), nullable=False),
        sa.Column("player_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["training_session_id"], ["training_sessions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "training_session_id", "player_id", name="uq_availability_session_player"
        ),
    )
    op.create_index(
        "ix_availability_session", "training_availability", ["training_session_id"]
    )
    op.create_index(
        op.f("ix_training_availability_player_id"),
        "training_availability",
        ["player_id"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_training_availability_player_id"), table_name="training_availability"
    )
    op.drop_index("ix_availability_session", table_name="training_availability")
    op.drop_table("training_availability")
    op.drop_index("ix_training_series", table_name="training_sessions")
    op.drop_index("ix_training_team_start", table_name="training_sessions")
    op.drop_table("training_sessions")
