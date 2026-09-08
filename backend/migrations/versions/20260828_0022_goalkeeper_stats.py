"""What a goalkeeper is answerable for, per match.

Ported from the Worker migration 0020_goalkeeper_stats (only the goalkeeper
columns; the man-of-the-match opponent flag it also carried is not part of this
backend's award model). Kept alongside the outfield tallies on
``player_match_stats``. Clean sheet is a flag rather than a count because a
keeper can only keep one per match, and it is only settled once the match is
over.

Revision ID: 20260828_0022
Revises: 20260828_0021
Create Date: 2026-09-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0022"
down_revision: str | None = "20260828_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for column in ("goals_conceded", "penalties_saved", "clean_sheet"):
        op.add_column(
            "player_match_stats",
            sa.Column(column, sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    for column in ("clean_sheet", "penalties_saved", "goals_conceded"):
        op.drop_column("player_match_stats", column)
