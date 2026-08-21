"""Enter a team in a competition so it appears in that table.

Revision ID: 20260821_0009
Revises: 20260821_0008
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0009"
down_revision: str | None = "20260821_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("teams", sa.Column("competition_id", sa.String(length=36), nullable=True))
    op.create_index("ix_teams_competition_id", "teams", ["competition_id"])


def downgrade() -> None:
    op.drop_index("ix_teams_competition_id", table_name="teams")
    op.drop_column("teams", "competition_id")
