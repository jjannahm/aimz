from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def new_id() -> str:
    return str(uuid.uuid4())


class UserRole(StrEnum):
    player = "player"
    admin = "admin"


class CompetitionType(StrEnum):
    league = "league"
    tournament = "tournament"
    friendly = "friendly"


class MatchStatus(StrEnum):
    scheduled = "scheduled"
    live = "live"
    finished = "finished"


class MatchPhase(StrEnum):
    not_started = "not_started"
    first_half = "first_half"
    halftime = "halftime"
    second_half = "second_half"
    extra_time = "extra_time"
    finished = "finished"


class EventType(StrEnum):
    goal = "goal"
    assist = "assist"
    yellow_card = "yellow_card"
    red_card = "red_card"
    substitution = "substitution"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, native_enum=False), index=True)
    player_id: Mapped[str | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), unique=True, nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    sessions: Mapped[list[RefreshSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class RefreshSession(Base):
    __tablename__ = "refresh_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RegistrationInvite(Base):
    __tablename__ = "registration_invites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    label: Mapped[str] = mapped_column(String(120))
    code_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    max_uses: Mapped[int | None] = mapped_column(Integer)
    use_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Team(TimestampMixin, Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), index=True)
    squad_code: Mapped[str | None] = mapped_column(String(40), index=True)
    age_group: Mapped[str | None] = mapped_column(String(40))
    season: Mapped[str | None] = mapped_column(String(40), index=True)
    is_aimz: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false", index=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", index=True
    )
    logo_key: Mapped[str | None] = mapped_column(String(512))
    # Set once per squad rather than per match; coaches rarely change week to week.
    coach: Mapped[str | None] = mapped_column(String(160))
    assistant_coach: Mapped[str | None] = mapped_column(String(160))

    players: Mapped[list[Player]] = relationship(back_populates="team")


class Competition(TimestampMixin, Base):
    __tablename__ = "competitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), index=True)
    season: Mapped[str] = mapped_column(String(40), index=True)
    type: Mapped[CompetitionType] = mapped_column(
        Enum(CompetitionType, native_enum=False), index=True
    )

    __table_args__ = (UniqueConstraint("name", "season", name="uq_competition_name_season"),)


class Player(TimestampMixin, Base):
    __tablename__ = "players"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"), index=True)
    position: Mapped[str] = mapped_column(String(60))
    jersey_number: Mapped[int | None] = mapped_column(Integer)
    photo_key: Mapped[str | None] = mapped_column(String(512))
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true", index=True
    )

    team: Mapped[Team] = relationship(back_populates="players")

    __table_args__ = (
        CheckConstraint(
            "jersey_number IS NULL OR jersey_number BETWEEN 0 AND 99", name="ck_jersey"
        ),
        UniqueConstraint("team_id", "jersey_number", name="uq_team_jersey"),
    )


class Match(TimestampMixin, Base):
    __tablename__ = "matches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    competition_id: Mapped[str] = mapped_column(
        ForeignKey("competitions.id", ondelete="RESTRICT"), index=True
    )
    home_team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), index=True
    )
    away_team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.id", ondelete="RESTRICT"), index=True
    )
    kickoff_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    venue: Mapped[str] = mapped_column(String(200))
    status: Mapped[MatchStatus] = mapped_column(
        Enum(MatchStatus, native_enum=False), default=MatchStatus.scheduled, index=True
    )
    phase: Mapped[MatchPhase] = mapped_column(
        Enum(MatchPhase, native_enum=False),
        default=MatchPhase.not_started,
        server_default=MatchPhase.not_started.value,
        index=True,
    )
    phase_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    home_score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    away_score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Kept as structure rather than one total so the live clock can tell which
    # period is running and pause the count during the break.
    half_length_minutes: Mapped[int] = mapped_column(Integer, default=45, server_default="45")
    num_halves: Mapped[int] = mapped_column(Integer, default=2, server_default="2")
    half_time_break_minutes: Mapped[int] = mapped_column(Integer, default=15, server_default="15")
    # Knockout ties can run two further periods; length is per period.
    has_extra_time: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="false"
    )
    extra_time_half_length_minutes: Mapped[int] = mapped_column(
        Integer, default=15, server_default="15"
    )
    # How many players start for AIMZ: squads play 5-, 6-, 7-, 9- and 11-a-side.
    # Null until a lineup is entered.
    lineup_format: Mapped[int | None] = mapped_column(Integer)
    # Outfield shape, e.g. "4-4-2"; the digits sum to lineup_format - 1.
    formation: Mapped[str | None] = mapped_column(String(20))

    competition: Mapped[Competition] = relationship()
    home_team: Mapped[Team] = relationship(foreign_keys=[home_team_id])
    away_team: Mapped[Team] = relationship(foreign_keys=[away_team_id])
    events: Mapped[list[MatchEvent]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )
    lineup: Mapped[list[MatchLineupEntry]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )
    player_stats: Mapped[list[PlayerMatchStat]] = relationship(
        back_populates="match", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("home_team_id <> away_team_id", name="ck_distinct_teams"),
        CheckConstraint("home_score >= 0 AND away_score >= 0", name="ck_nonnegative_score"),
        Index("ix_matches_status_kickoff", "status", "kickoff_datetime"),
    )


class MatchEvent(TimestampMixin, Base):
    __tablename__ = "match_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    type: Mapped[EventType] = mapped_column(Enum(EventType, native_enum=False), index=True)
    minute: Mapped[int | None] = mapped_column(Integer)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"), index=True)
    player_id: Mapped[str | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), index=True
    )
    secondary_player_id: Mapped[str | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL")
    )
    related_event_id: Mapped[str | None] = mapped_column(
        ForeignKey("match_events.id", ondelete="CASCADE")
    )
    notes: Mapped[str | None] = mapped_column(Text)
    # Goals only: whether the goal came from a penalty kick.
    is_penalty: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    client_operation_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    match: Mapped[Match] = relationship(back_populates="events")
    team: Mapped[Team] = relationship()
    player: Mapped[Player | None] = relationship(foreign_keys=[player_id])
    secondary_player: Mapped[Player | None] = relationship(foreign_keys=[secondary_player_id])

    __table_args__ = (
        CheckConstraint("minute IS NULL OR minute BETWEEN 0 AND 150", name="ck_event_minute"),
        Index("ix_match_events_match_minute", "match_id", "minute"),
    )


class MatchLineupEntry(Base):
    __tablename__ = "match_lineup_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[str] = mapped_column(
        ForeignKey("players.id", ondelete="RESTRICT"), index=True
    )
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="RESTRICT"), index=True)
    is_starter: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_captain: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    position: Mapped[str | None] = mapped_column(String(60))
    jersey_number: Mapped[int | None] = mapped_column(Integer)

    match: Mapped[Match] = relationship(back_populates="lineup")
    player: Mapped[Player] = relationship()
    team: Mapped[Team] = relationship()

    __table_args__ = (UniqueConstraint("match_id", "player_id", name="uq_lineup_match_player"),)


class PlayerMatchStat(TimestampMixin, Base):
    __tablename__ = "player_match_stats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    match_id: Mapped[str] = mapped_column(ForeignKey("matches.id", ondelete="CASCADE"), index=True)
    player_id: Mapped[str] = mapped_column(
        ForeignKey("players.id", ondelete="RESTRICT"), index=True
    )
    appeared: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    minutes_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    goals: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    assists: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    yellow_cards: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    red_cards: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    match: Mapped[Match] = relationship(back_populates="player_stats")
    player: Mapped[Player] = relationship()

    __table_args__ = (
        UniqueConstraint("match_id", "player_id", name="uq_stat_match_player"),
        CheckConstraint("minutes_played BETWEEN 0 AND 150", name="ck_minutes_played"),
    )
