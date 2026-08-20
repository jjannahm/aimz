"""Store each match's period structure.

Revision ID: 20260820_0003
Revises: 20260818_0002
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260820_0003"
down_revision: str | None = "20260818_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = (
    ("half_length_minutes", "45"),
    ("num_halves", "2"),
    ("half_time_break_minutes", "15"),
)


def upgrade() -> None:
    for name, default in COLUMNS:
        op.add_column(
            "matches",
            sa.Column(name, sa.Integer(), server_default=default, nullable=False),
        )


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column("matches", name)
