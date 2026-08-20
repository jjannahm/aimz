"""Record how many players start for AIMZ in a match.

Revision ID: 20260820_0006
Revises: 20260820_0005
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260820_0006"
down_revision: str | None = "20260820_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Null until a lineup is entered; squads play 5-, 6-, 7-, 9- and 11-a-side.
    op.add_column("matches", sa.Column("lineup_format", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("matches", "lineup_format")
