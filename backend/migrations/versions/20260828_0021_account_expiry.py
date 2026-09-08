"""An account that stops working on a date.

Ported from the Worker migration 0027_account_expiry. Wanted for accounts handed
to someone who only needs to look for a while — a reviewer, a trial coach, a
parent visiting for a tournament. An account with no row here never expires,
which is every account that already exists.

A table of its own rather than a column on ``users``: an expiry is a fact about
an arrangement rather than part of who someone is, and the row goes when the
account does. Nothing is deleted when the moment passes — the account stops
signing in and refreshing until an administrator lifts or resets the date.

Revision ID: 20260828_0021
Revises: 20260828_0020
Create Date: 2026-09-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0021"
down_revision: str | None = "20260828_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_expiry",
        sa.Column("user_id", sa.String(length=36), primary_key=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )


def downgrade() -> None:
    op.drop_table("account_expiry")
