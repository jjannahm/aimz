"""A subscribable fixtures calendar per account, keyed by a secret token.

Ported from the Worker migration 0025_calendar_tokens. The token is stored as
itself (a capability URL must stay readable); regenerating it revokes the feed.

Revision ID: 20260828_0017
Revises: 20260828_0016
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0017"
down_revision: str | None = "20260828_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "calendar_tokens",
        sa.Column("user_id", sa.String(length=36), primary_key=True),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("first_fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token", name="uq_calendar_tokens_token"),
    )
    op.create_index("ix_calendar_tokens_token", "calendar_tokens", ["token"])


def downgrade() -> None:
    op.drop_index("ix_calendar_tokens_token", table_name="calendar_tokens")
    op.drop_table("calendar_tokens")
