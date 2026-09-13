"""Count attempts against sign-in, invitations and password reset.

One row per rule and subject per window, keyed by an HMAC so the table never
holds the address or email that was trying. The Worker keeps the same table as
``rate_limits`` (D1 migration 0045).

Revision ID: 20260913_0029
Revises: 20260910_0028
Create Date: 2026-09-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260913_0029"
down_revision: str | None = "20260910_0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "auth_rate_limits",
        sa.Column("key_hash", sa.String(64), primary_key=True),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index(
        "ix_auth_rate_limits_window_started_at", "auth_rate_limits", ["window_started_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_auth_rate_limits_window_started_at", table_name="auth_rate_limits")
    op.drop_table("auth_rate_limits")
