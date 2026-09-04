"""Post notices to a squad, or academy-wide when they carry no team.

Ported from the Cloudflare Worker migration 0015_announcements so the FastAPI
backend serves the same feature. Pinned notices sort to the top.

Revision ID: 20260828_0013
Revises: 20260827_0012
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0013"
down_revision: str | None = "20260827_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "announcements",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("team_id", sa.String(length=36), nullable=True),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_id", sa.String(length=36), nullable=True),
        sa.Column(
            "pinned",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
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
        sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index(
        "ix_announcements_team_created", "announcements", ["team_id", "created_at"]
    )
    op.create_index(
        op.f("ix_announcements_team_id"), "announcements", ["team_id"]
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_announcements_team_id"), table_name="announcements")
    op.drop_index("ix_announcements_team_created", table_name="announcements")
    op.drop_table("announcements")
