"""Hold a team's badge apart from whether the team is ours.

A league of peer clubs has no "our club", so is_aimz can no longer be what
decides which crest is drawn. NULL keeps the old behaviour.

Revision ID: 20260827_0012
Revises: 20260825_0011
Create Date: 2026-08-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260827_0012"
down_revision: str | None = "20260825_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("teams", sa.Column("badge_style", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("teams", "badge_style")
