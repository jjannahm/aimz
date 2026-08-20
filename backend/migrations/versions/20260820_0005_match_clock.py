"""add persistent live match clock

Revision ID: 20260820_0005
Revises: 20260820_0004
Create Date: 2026-08-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260820_0005"
down_revision: str | None = "20260820_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column(
            "phase",
            sa.Enum(
                "not_started",
                "first_half",
                "halftime",
                "second_half",
                "extra_time",
                "finished",
                name="matchphase",
                native_enum=False,
            ),
            server_default="not_started",
            nullable=False,
        ),
    )
    op.add_column(
        "matches",
        sa.Column("phase_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_matches_phase", "matches", ["phase"])
    op.execute(
        sa.text(
            """
            UPDATE matches
            SET phase = CASE
                    WHEN status = 'live' THEN 'first_half'
                    WHEN status = 'finished' THEN 'finished'
                    ELSE 'not_started'
                END,
                phase_started_at = CASE
                    WHEN status = 'live' THEN CURRENT_TIMESTAMP
                    ELSE NULL
                END
            """
        )
    )


def downgrade() -> None:
    op.drop_index("ix_matches_phase", table_name="matches")
    op.drop_column("matches", "phase_started_at")
    op.drop_column("matches", "phase")
