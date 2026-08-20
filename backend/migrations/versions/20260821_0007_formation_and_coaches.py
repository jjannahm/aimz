"""Record the outfield shape per match and the coaching staff per squad.

Revision ID: 20260821_0007
Revises: 20260820_0006
Create Date: 2026-08-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260821_0007"
down_revision: str | None = "20260820_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("matches", sa.Column("formation", sa.String(length=20), nullable=True))
    op.add_column("teams", sa.Column("coach", sa.String(length=160), nullable=True))
    op.add_column("teams", sa.Column("assistant_coach", sa.String(length=160), nullable=True))


def downgrade() -> None:
    op.drop_column("teams", "assistant_coach")
    op.drop_column("teams", "coach")
    op.drop_column("matches", "formation")
