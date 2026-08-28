"""Record own goals, missed penalties, why a player came off, and who changed what.

Revision ID: 20260821_0010
Revises: 20260821_0009
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0010"
down_revision: str | None = "20260821_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "match_events", sa.Column("substitution_reason", sa.String(length=20), nullable=True)
    )
    op.add_column("match_events", sa.Column("penalty_outcome", sa.String(length=20), nullable=True))
    op.add_column(
        "player_match_stats",
        sa.Column("own_goals", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "matches", sa.Column("man_of_the_match_player_id", sa.String(length=36), nullable=True)
    )
    op.create_index(
        "ix_matches_man_of_the_match_player_id", "matches", ["man_of_the_match_player_id"]
    )
    op.create_table(
        "audit_log",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "actor_id", sa.String(length=36), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column("actor_name", sa.String(length=160), nullable=False),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("entity_type", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=36)),
        sa.Column(
            "match_id", sa.String(length=36), sa.ForeignKey("matches.id", ondelete="CASCADE")
        ),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_audit_log_actor_id", "audit_log", ["actor_id"])
    op.create_index("ix_audit_log_action", "audit_log", ["action"])
    op.create_index("ix_audit_log_match_id", "audit_log", ["match_id"])
    op.create_index("ix_audit_log_match_created", "audit_log", ["match_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_log_match_created", table_name="audit_log")
    op.drop_index("ix_audit_log_match_id", table_name="audit_log")
    op.drop_index("ix_audit_log_action", table_name="audit_log")
    op.drop_index("ix_audit_log_actor_id", table_name="audit_log")
    op.drop_table("audit_log")
    op.drop_index("ix_matches_man_of_the_match_player_id", table_name="matches")
    op.drop_column("matches", "man_of_the_match_player_id")
    op.drop_column("player_match_stats", "own_goals")
    op.drop_column("match_events", "penalty_outcome")
    op.drop_column("match_events", "substitution_reason")
