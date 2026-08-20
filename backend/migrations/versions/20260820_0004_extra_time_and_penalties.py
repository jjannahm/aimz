"""Add optional extra time to matches and a penalty flag to goals.

Revision ID: 20260820_0004
Revises: 20260820_0003
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260820_0004"
down_revision: str | None = "20260820_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column("has_extra_time", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "matches",
        sa.Column(
            "extra_time_half_length_minutes",
            sa.Integer(),
            server_default="15",
            nullable=False,
        ),
    )
    op.add_column(
        "match_events",
        sa.Column("is_penalty", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("match_events", "is_penalty")
    op.drop_column("matches", "extra_time_half_length_minutes")
    op.drop_column("matches", "has_extra_time")
