"""Add a branch to academy squads.

Revision ID: 20260910_0027
Revises: 20260910_0026
Create Date: 2026-09-10
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260910_0027"
down_revision: str | None = "20260910_0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("teams", sa.Column("branch", sa.String(160), nullable=True))
    op.create_index("ix_teams_branch", "teams", ["branch"])


def downgrade() -> None:
    op.drop_index("ix_teams_branch", table_name="teams")
    op.drop_column("teams", "branch")
