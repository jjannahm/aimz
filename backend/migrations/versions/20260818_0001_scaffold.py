"""Create the initial AIMZ schema baseline.

Revision ID: 20260818_0001
Revises:
Create Date: 2026-08-18
"""

from collections.abc import Sequence

revision: str = "20260818_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """The scaffold baseline intentionally adds no domain tables."""


def downgrade() -> None:
    """The scaffold baseline intentionally adds no domain tables."""
