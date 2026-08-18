"""Add authentication and sports domain tables.

Revision ID: 20260818_0002
Revises: 20260818_0001
Create Date: 2026-08-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260818_0002"
down_revision: str | None = "20260818_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def timestamp_columns() -> tuple[sa.Column, sa.Column]:
    return (
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def upgrade() -> None:
    op.create_table(
        "teams",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("squad_code", sa.String(40)),
        sa.Column("age_group", sa.String(40)),
        sa.Column("season", sa.String(40)),
        sa.Column("is_aimz", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("logo_key", sa.String(512)),
        *timestamp_columns(),
    )
    op.create_index("ix_teams_name", "teams", ["name"])
    op.create_index("ix_teams_squad_code", "teams", ["squad_code"])
    op.create_index("ix_teams_season", "teams", ["season"])
    op.create_index("ix_teams_is_aimz", "teams", ["is_aimz"])
    op.create_index("ix_teams_is_active", "teams", ["is_active"])

    op.create_table(
        "competitions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("season", sa.String(40), nullable=False),
        sa.Column(
            "type",
            sa.Enum("league", "tournament", "friendly", name="competitiontype", native_enum=False),
            nullable=False,
        ),
        *timestamp_columns(),
        sa.UniqueConstraint("name", "season", name="uq_competition_name_season"),
    )
    op.create_index("ix_competitions_name", "competitions", ["name"])
    op.create_index("ix_competitions_season", "competitions", ["season"])
    op.create_index("ix_competitions_type", "competitions", ["type"])

    op.create_table(
        "players",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column(
            "team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("position", sa.String(60), nullable=False),
        sa.Column("jersey_number", sa.Integer()),
        sa.Column("photo_key", sa.String(512)),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *timestamp_columns(),
        sa.CheckConstraint(
            "jersey_number IS NULL OR jersey_number BETWEEN 0 AND 99", name="ck_jersey"
        ),
        sa.UniqueConstraint("team_id", "jersey_number", name="uq_team_jersey"),
    )
    op.create_index("ix_players_name", "players", ["name"])
    op.create_index("ix_players_team_id", "players", ["team_id"])
    op.create_index("ix_players_is_active", "players", ["is_active"])

    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column(
            "role", sa.Enum("player", "admin", name="userrole", native_enum=False), nullable=False
        ),
        sa.Column(
            "player_id",
            sa.String(36),
            sa.ForeignKey("players.id", ondelete="SET NULL"),
            unique=True,
        ),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        *timestamp_columns(),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_role", "users", ["role"])

    op.create_table(
        "refresh_sessions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_refresh_sessions_user_id", "refresh_sessions", ["user_id"])
    op.create_index(
        "ix_refresh_sessions_token_hash", "refresh_sessions", ["token_hash"], unique=True
    )
    op.create_index("ix_refresh_sessions_expires_at", "refresh_sessions", ["expires_at"])

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])
    op.create_index("ix_password_reset_tokens_code_hash", "password_reset_tokens", ["code_hash"])
    op.create_index("ix_password_reset_tokens_expires_at", "password_reset_tokens", ["expires_at"])

    op.create_table(
        "registration_invites",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column("max_uses", sa.Integer()),
        sa.Column("use_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_by_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_registration_invites_code_hash", "registration_invites", ["code_hash"], unique=True
    )
    op.create_index("ix_registration_invites_expires_at", "registration_invites", ["expires_at"])

    op.create_table(
        "matches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "competition_id",
            sa.String(36),
            sa.ForeignKey("competitions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "home_team_id",
            sa.String(36),
            sa.ForeignKey("teams.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "away_team_id",
            sa.String(36),
            sa.ForeignKey("teams.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("kickoff_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("venue", sa.String(200), nullable=False),
        sa.Column(
            "status",
            sa.Enum("scheduled", "live", "finished", name="matchstatus", native_enum=False),
            server_default="scheduled",
            nullable=False,
        ),
        sa.Column("home_score", sa.Integer(), server_default="0", nullable=False),
        sa.Column("away_score", sa.Integer(), server_default="0", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        *timestamp_columns(),
        sa.CheckConstraint("home_team_id <> away_team_id", name="ck_distinct_teams"),
        sa.CheckConstraint("home_score >= 0 AND away_score >= 0", name="ck_nonnegative_score"),
    )
    for column in ["competition_id", "home_team_id", "away_team_id", "kickoff_datetime", "status"]:
        op.create_index(f"ix_matches_{column}", "matches", [column])
    op.create_index("ix_matches_status_kickoff", "matches", ["status", "kickoff_datetime"])

    op.create_table(
        "match_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "match_id",
            sa.String(36),
            sa.ForeignKey("matches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "type",
            sa.Enum(
                "goal",
                "assist",
                "yellow_card",
                "red_card",
                "substitution",
                name="eventtype",
                native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("minute", sa.Integer()),
        sa.Column(
            "team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("player_id", sa.String(36), sa.ForeignKey("players.id", ondelete="SET NULL")),
        sa.Column(
            "secondary_player_id", sa.String(36), sa.ForeignKey("players.id", ondelete="SET NULL")
        ),
        sa.Column(
            "related_event_id", sa.String(36), sa.ForeignKey("match_events.id", ondelete="CASCADE")
        ),
        sa.Column("notes", sa.Text()),
        sa.Column("client_operation_id", sa.String(64), nullable=False, unique=True),
        *timestamp_columns(),
        sa.CheckConstraint("minute IS NULL OR minute BETWEEN 0 AND 150", name="ck_event_minute"),
    )
    for column in ["match_id", "type", "team_id", "player_id"]:
        op.create_index(f"ix_match_events_{column}", "match_events", [column])
    op.create_index(
        "ix_match_events_client_operation_id", "match_events", ["client_operation_id"], unique=True
    )
    op.create_index("ix_match_events_match_minute", "match_events", ["match_id", "minute"])

    op.create_table(
        "match_lineup_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "match_id",
            sa.String(36),
            sa.ForeignKey("matches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "player_id",
            sa.String(36),
            sa.ForeignKey("players.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "team_id", sa.String(36), sa.ForeignKey("teams.id", ondelete="RESTRICT"), nullable=False
        ),
        sa.Column("is_starter", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("position", sa.String(60)),
        sa.Column("jersey_number", sa.Integer()),
        sa.UniqueConstraint("match_id", "player_id", name="uq_lineup_match_player"),
    )
    for column in ["match_id", "player_id", "team_id"]:
        op.create_index(f"ix_match_lineup_entries_{column}", "match_lineup_entries", [column])

    op.create_table(
        "player_match_stats",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "match_id",
            sa.String(36),
            sa.ForeignKey("matches.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "player_id",
            sa.String(36),
            sa.ForeignKey("players.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("appeared", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("minutes_played", sa.Integer(), server_default="0", nullable=False),
        sa.Column("goals", sa.Integer(), server_default="0", nullable=False),
        sa.Column("assists", sa.Integer(), server_default="0", nullable=False),
        sa.Column("yellow_cards", sa.Integer(), server_default="0", nullable=False),
        sa.Column("red_cards", sa.Integer(), server_default="0", nullable=False),
        *timestamp_columns(),
        sa.UniqueConstraint("match_id", "player_id", name="uq_stat_match_player"),
        sa.CheckConstraint("minutes_played BETWEEN 0 AND 150", name="ck_minutes_played"),
    )
    op.create_index("ix_player_match_stats_match_id", "player_match_stats", ["match_id"])
    op.create_index("ix_player_match_stats_player_id", "player_match_stats", ["player_id"])


def downgrade() -> None:
    for table in [
        "player_match_stats",
        "match_lineup_entries",
        "match_events",
        "matches",
        "registration_invites",
        "password_reset_tokens",
        "refresh_sessions",
        "users",
        "players",
        "competitions",
        "teams",
    ]:
        op.drop_table(table)
