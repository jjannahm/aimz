"""The squad a statistic belongs to.

Ported from the stat-team half of the Worker migration 0021 (the positions half
was ported earlier as 0019). A statistic is attributed to the squad the player
turned out for, stamped from the lineup at scoring time, so leaders and awards
credit the squad a stat was earned with rather than whichever squad the player
is on now.

Nullable so the column can be added to a populated table, then filled: the
lineup answers first (the record of who turned out for whom), and a row with no
lineup entry falls back to the player's current squad — which preserves exactly
today's answer for old data without pretending to correct it. It stays nullable:
a row predating any lineup whose player was since deleted has no honest answer,
and a null there reads as "unknown" rather than a wrong squad.

Revision ID: 20260828_0023
Revises: 20260828_0022
Create Date: 2026-09-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0023"
down_revision: str | None = "20260828_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "player_match_stats",
        sa.Column("team_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_player_match_stats_team",
        "player_match_stats",
        "teams",
        ["team_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_player_match_stats_team", "player_match_stats", ["team_id"]
    )

    # The lineup is the record of who turned out for whom, so it answers first.
    op.execute(
        """
        UPDATE player_match_stats SET team_id = (
            SELECT l.team_id FROM match_lineup_entries l
            WHERE l.match_id = player_match_stats.match_id
              AND l.player_id = player_match_stats.player_id
        ) WHERE team_id IS NULL
        """
    )
    # Rows with no lineup entry fall back to the squad the player is on now.
    op.execute(
        """
        UPDATE player_match_stats SET team_id = (
            SELECT p.team_id FROM players p WHERE p.id = player_match_stats.player_id
        ) WHERE team_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_player_match_stats_team", table_name="player_match_stats")
    op.drop_constraint(
        "fk_player_match_stats_team", "player_match_stats", type_="foreignkey"
    )
    op.drop_column("player_match_stats", "team_id")
