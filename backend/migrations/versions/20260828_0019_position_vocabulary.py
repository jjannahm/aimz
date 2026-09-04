"""Map free-text positions onto the fixed sixteen-code vocabulary.

Ported from the Worker migration 0021 (positions half). Positions were free
text, so "GK", "Goalkeeper" and "Keeper" were three different positions; the API
now accepts only the codes, and this maps the prose already stored. The
per-match lineup position is nullable and stays nullable — no entry means no
position was set.

Revision ID: 20260828_0019
Revises: 20260828_0018
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.services.positions import POSITION_CODES, code_for_free_text

revision: str = "20260828_0019"
down_revision: str | None = "20260828_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _remap(table: str, keep_null: bool) -> None:
    """Rewrite any non-code position in a table to its closest code."""
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(f"SELECT id, position FROM {table}")
    ).fetchall()
    for row_id, position in rows:
        if position is None:
            continue  # nullable lineup rows keep "no position set"
        if position in POSITION_CODES:
            continue
        connection.execute(
            sa.text(f"UPDATE {table} SET position = :pos WHERE id = :id"),
            {"pos": code_for_free_text(position), "id": row_id},
        )
    del keep_null  # documented for intent; nulls are simply skipped above


def upgrade() -> None:
    _remap("players", keep_null=False)
    _remap("match_lineup_entries", keep_null=True)


def downgrade() -> None:
    # Irreversible: the original free text is not retained. Codes are already a
    # subset of what the column accepted, so leaving them in place is safe.
    pass
