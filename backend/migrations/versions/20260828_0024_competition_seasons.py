"""A way to say a season is over.

Ported from the Worker migration 0024_competition_seasons. A season of a
competition is already its own row, kept apart by UNIQUE(name, season); what was
missing is a status. Existing rows default to active, so every competition
already in the database keeps behaving exactly as it did — the knockout and
match-scoring guards only turn anything away once a season is deliberately
completed.

Revision ID: 20260828_0024
Revises: 20260828_0023
Create Date: 2026-09-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0024"
down_revision: str | None = "20260828_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "competitions",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
    )
    op.add_column(
        "competitions",
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_competitions_status", "competitions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_competitions_status", table_name="competitions")
    op.drop_column("competitions", "completed_at")
    op.drop_column("competitions", "status")
