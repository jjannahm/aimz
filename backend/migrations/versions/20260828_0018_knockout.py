"""A group stage of teams feeding a single-elimination bracket.

Ported from the Worker migrations 0011_knockout_format + 0012_custom_group_size.
A null team_count means the competition is only a league table, as before.

Revision ID: 20260828_0018
Revises: 20260828_0017
Create Date: 2026-08-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828_0018"
down_revision: str | None = "20260828_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("competitions", sa.Column("team_count", sa.Integer(), nullable=True))
    op.add_column("competitions", sa.Column("group_size", sa.Integer(), nullable=True))

    op.create_table(
        "competition_groups",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("competition_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["competition_id"], ["competitions.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "competition_id", "position", name="uq_group_competition_pos"
        ),
    )
    op.create_index(
        "ix_competition_groups_competition_id",
        "competition_groups",
        ["competition_id"],
    )

    op.add_column(
        "teams",
        sa.Column("competition_group_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_teams_competition_group",
        "teams",
        "competition_groups",
        ["competition_group_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_teams_competition_group_id", "teams", ["competition_group_id"]
    )

    op.create_table(
        "bracket_slots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("competition_id", sa.String(length=36), nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("home_team_id", sa.String(length=36), nullable=True),
        sa.Column("away_team_id", sa.String(length=36), nullable=True),
        sa.Column("winner_team_id", sa.String(length=36), nullable=True),
        sa.Column("match_id", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(
            ["competition_id"], ["competitions.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["home_team_id"], ["teams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["away_team_id"], ["teams.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["winner_team_id"], ["teams.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "competition_id", "round", "position", name="uq_slot_competition_round_pos"
        ),
    )
    op.create_index(
        "ix_bracket_slots_competition_id",
        "bracket_slots",
        ["competition_id", "round", "position"],
    )


def downgrade() -> None:
    op.drop_index("ix_bracket_slots_competition_id", table_name="bracket_slots")
    op.drop_table("bracket_slots")
    op.drop_index("ix_teams_competition_group_id", table_name="teams")
    op.drop_constraint("fk_teams_competition_group", "teams", type_="foreignkey")
    op.drop_column("teams", "competition_group_id")
    op.drop_index(
        "ix_competition_groups_competition_id", table_name="competition_groups"
    )
    op.drop_table("competition_groups")
    op.drop_column("competitions", "group_size")
    op.drop_column("competitions", "team_count")
