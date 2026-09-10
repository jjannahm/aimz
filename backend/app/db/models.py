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
    # A guardian who follows several children rather than a roster record of
    # their own; their squads fan out over ``user_children``.
    parent = "parent"
    coach = "coach"


class OnboardingStatus(StrEnum):
    approved = "approved"
    pending = "pending"
    declined = "declined"


class InviteKind(StrEnum):
    # Names one player and links the account it creates to that roster record.
    player = "player"
    # Names one or more children, attached to the account via ``user_children``.
    parent = "parent"
    coach = "coach"


class NewcomerSource(StrEnum):
    public_link = "public_link"
    account_registration = "account_registration"


class NewcomerStage(StrEnum):
    new = "new"
    contacted = "contacted"
    follow_up = "follow_up"
    trial_booked = "trial_booked"
    closed = "closed"


class NewcomerOutcome(StrEnum):
    joined = "joined"
    not_interested = "not_interested"
    declined = "declined"


class CompetitionType(StrEnum):
    league = "league"
    tournament = "tournament"
    friendly = "friendly"


class CompetitionStatus(StrEnum):
    # A season taking results; the only state a competition is scored in.
    active = "active"
    # A season that has ended. Nothing is deleted — the table, results and
    # bracket stay — but it stops accepting anything new until reopened.
    completed = "completed"


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
    own_goal = "own_goal"
    penalty_missed = "penalty_missed"
    yellow_card = "yellow_card"
    red_card = "red_card"
    substitution = "substitution"


class SubstitutionReason(StrEnum):
    tactical = "tactical"
    injury = "injury"
    concussion = "concussion"
    disciplinary = "disciplinary"
    other = "other"


class PenaltyOutcome(StrEnum):
    saved = "saved"
    off_target = "off_target"


class AvailabilityStatus(StrEnum):
    # Two-way by design: "maybe" told a coach nothing they could act on.
    going = "going"
    not_going = "not_going"


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
    onboarding_status: Mapped[OnboardingStatus] = mapped_column(
        Enum(OnboardingStatus, native_enum=False),
        default=OnboardingStatus.approved,
        server_default=OnboardingStatus.approved.value,
        index=True,
    )

    sessions: Mapped[list[RefreshSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    # A deadline lives in a table of its own rather than a column here: an
    # expiry is a fact about an arrangement, not part of who someone is, and an
    # account with no row never expires. Eager-loaded so the deadline rides
    # alongside the account everywhere it is picked up, the way the Worker's
    # USER_SELECT joins it in.
    expiry: Mapped[AccountExpiry | None] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="joined"
    )

    @property
    def expires_at(self) -> datetime | None:
        """The account's deadline, or None when it never expires.

        Reads the loaded relationship straight from the instance dict so it is
        safe on a freshly created account whose ``expiry`` was never loaded — a
        plain attribute access there would emit a lazy load in async code.
        """
        expiry = self.__dict__.get("expiry")
        return expiry.expires_at if expiry else None


class AccountExpiry(TimestampMixin, Base):
    """A date an account stops working on. Nothing is deleted when it passes —
    the account stops signing in and refreshing, and an administrator can lift
    the date or set another, so an expiry is a lock rather than a demolition."""

    __tablename__ = "account_expiry"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    user: Mapped[User] = relationship(back_populates="expiry")


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
    # Which of the two kinds of account this invitation redeems into. A player
    # invitation names one player and links the account to it; a parent
    # invitation names children who hang off ``user_children`` instead.
    kind: Mapped[InviteKind] = mapped_column(
        Enum(InviteKind, native_enum=False),
        default=InviteKind.player,
        server_default=InviteKind.player.value,
        index=True,
    )
    # The roster player this invitation is for; null for a parent or a shared
    # intake code. Kept for rows written before ``invite_players`` existed; the
    # redemption path reads that table and falls back to this column.
    player_id: Mapped[str | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True
    )
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True
    )
    application_id: Mapped[str | None] = mapped_column(
        ForeignKey("newcomer_applications.id", ondelete="SET NULL"), nullable=True, index=True
    )
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

    players: Mapped[list[InvitePlayer]] = relationship(
        back_populates="invite", cascade="all, delete-orphan"
    )


class InvitePlayer(Base):
    """A roster player named on an invitation. A player invitation carries one;
    a parent invitation carries a row per child. Held apart from
    ``registration_invites.player_id`` so one redemption path reads either kind."""

    __tablename__ = "invite_players"

    invite_id: Mapped[str] = mapped_column(
        ForeignKey("registration_invites.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    player_id: Mapped[str] = mapped_column(
        ForeignKey("players.id", ondelete="CASCADE"), primary_key=True
    )

    invite: Mapped[RegistrationInvite] = relationship(back_populates="players")
    player: Mapped[Player] = relationship()


class UserChild(Base):
    """A child a parent account speaks for. A player links to one roster record
    on ``users.player_id``; a parent may have several, which cannot be widened
    in place, so their children hang off this join table instead."""

    __tablename__ = "user_children"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    player_id: Mapped[str] = mapped_column(
        ForeignKey("players.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    player: Mapped[Player] = relationship()


class Team(TimestampMixin, Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), index=True)
    branch: Mapped[str | None] = mapped_column(String(160), index=True)
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
    # Which badge to draw when no logo is uploaded. Held apart from is_aimz so a
    # league of peer clubs can each keep their own; null derives it from is_aimz.
    badge_style: Mapped[str | None] = mapped_column(String(16))
    # Set once per squad rather than per match; coaches rarely change week to week.
    coach: Mapped[str | None] = mapped_column(String(160))
    assistant_coach: Mapped[str | None] = mapped_column(String(160))
    # Which league the team is entered in, so it appears in that table before
    # it has played anything.
    competition_id: Mapped[str | None] = mapped_column(
        ForeignKey("competitions.id", ondelete="SET NULL"), index=True
    )
    # Which knockout group the team is drawn into, if any.
    competition_group_id: Mapped[str | None] = mapped_column(
        ForeignKey("competition_groups.id", ondelete="SET NULL"), index=True
    )

    players: Mapped[list[Player]] = relationship(back_populates="team")


class TeamStaff(Base):
    """A coach's squad boundary; the join also supports multi-squad staff."""

    __tablename__ = "team_staff"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    team_id: Mapped[str] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Competition(TimestampMixin, Base):
    __tablename__ = "competitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(160), index=True)
    season: Mapped[str] = mapped_column(String(40), index=True)
    type: Mapped[CompetitionType] = mapped_column(
        Enum(CompetitionType, native_enum=False), index=True
    )
    # A knockout's shape: how many teams, and how many to a group. Both null for
    # a competition that is only a league table.
    team_count: Mapped[int | None] = mapped_column(Integer)
    group_size: Mapped[int | None] = mapped_column(Integer)
    # Whether the season is still taking results. A completed season keeps every
    # row it had and simply stops accepting anything new until it is reopened.
    status: Mapped[CompetitionStatus] = mapped_column(
        Enum(CompetitionStatus, native_enum=False),
        default=CompetitionStatus.active,
        server_default=CompetitionStatus.active.value,
        index=True,
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

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
    # Held as a plain YYYY-MM-DD string to match the roster contract exactly.
    date_of_birth: Mapped[str | None] = mapped_column(String(10))

    team: Mapped[Team] = relationship(back_populates="players")
    contacts: Mapped[list[PlayerContact]] = relationship(
        back_populates="player", cascade="all, delete-orphan"
    )

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
    has_extra_time: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    extra_time_half_length_minutes: Mapped[int] = mapped_column(
        Integer, default=15, server_default="15"
    )
    # How many players start for AIMZ: squads play 5-, 6-, 7-, 9- and 11-a-side.
    # Null until a lineup is entered.
    lineup_format: Mapped[int | None] = mapped_column(Integer)
    # Outfield shape, e.g. "4-4-2"; the digits sum to lineup_format - 1.
    formation: Mapped[str | None] = mapped_column(String(20))
    # Picked by an admin once the match is finished, not voted for.
    man_of_the_match_player_id: Mapped[str | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), index=True
    )

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
    # Substitutions only: why the player came off, so a forced change reads
    # differently from a tactical one.
    substitution_reason: Mapped[SubstitutionReason | None] = mapped_column(
        Enum(SubstitutionReason, native_enum=False)
    )
    # Missed penalties only: whether the keeper saved it or it missed the goal.
    penalty_outcome: Mapped[PenaltyOutcome | None] = mapped_column(
        Enum(PenaltyOutcome, native_enum=False)
    )
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
    # The squad the player turned out for in this match, stamped from the lineup
    # at scoring time so a promotion to an older age group never carries an old
    # match's record with them. Nullable: a row predating any lineup whose player
    # was since deleted has no honest answer, and null reads as "unknown" rather
    # than a wrong squad. Leaders and awards attribute a stat here, not to the
    # squad the player happens to be on now.
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True
    )
    appeared: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    minutes_played: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    goals: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    assists: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Kept apart from goals so an own goal never inflates a scoring record.
    own_goals: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    yellow_cards: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    red_cards: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # What a goalkeeper is answerable for, worked out from the lineup and the
    # timeline rather than counted in place: which keeper conceded a goal depends
    # on who was on the pitch at the minute. Clean sheet is a flag, not a count —
    # a keeper can only keep one per match — and is only settled once finished.
    goals_conceded: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    penalties_saved: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    clean_sheet: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    match: Mapped[Match] = relationship(back_populates="player_stats")
    player: Mapped[Player] = relationship()

    __table_args__ = (
        UniqueConstraint("match_id", "player_id", name="uq_stat_match_player"),
        CheckConstraint("minutes_played BETWEEN 0 AND 150", name="ck_minutes_played"),
    )


class PlayerContact(TimestampMixin, Base):
    """A guardian/emergency contact for a roster player. Admin-only data."""

    __tablename__ = "player_contacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    # Defined before the ``relationship`` column below, whose name would
    # otherwise shadow the ``relationship()`` function inside this class body.
    player: Mapped[Player] = relationship(back_populates="contacts")

    name: Mapped[str] = mapped_column(String(160))
    relationship: Mapped[str | None] = mapped_column(String(80))
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(60))


class NewcomerApplication(TimestampMixin, Base):
    """One durable intake record, whether submitted publicly or at signup."""

    __tablename__ = "newcomer_applications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source: Mapped[NewcomerSource] = mapped_column(
        Enum(NewcomerSource, native_enum=False), index=True
    )
    stage: Mapped[NewcomerStage] = mapped_column(
        Enum(NewcomerStage, native_enum=False),
        default=NewcomerStage.new,
        server_default=NewcomerStage.new.value,
        index=True,
    )
    outcome: Mapped[NewcomerOutcome | None] = mapped_column(
        Enum(NewcomerOutcome, native_enum=False), nullable=True, index=True
    )
    client_submission_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, nullable=True, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    player_id: Mapped[str | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True
    )
    invite_id: Mapped[str | None] = mapped_column(
        ForeignKey("registration_invites.id", ondelete="SET NULL"), nullable=True, index=True
    )
    suggested_team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True
    )
    branch: Mapped[str] = mapped_column(String(120))
    full_name: Mapped[str] = mapped_column(String(160), index=True)
    mobile: Mapped[str] = mapped_column(String(60), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    whatsapp_mobile: Mapped[str] = mapped_column(String(60), index=True)
    date_of_birth: Mapped[str] = mapped_column(String(10))
    nationality: Mapped[str] = mapped_column(String(100))
    address: Mapped[str] = mapped_column(String(500))
    previous_academy: Mapped[str] = mapped_column(String(200))
    school_university: Mapped[str] = mapped_column(String(200))
    father_name: Mapped[str] = mapped_column(String(160))
    father_mobile: Mapped[str] = mapped_column(String(60))
    mother_name: Mapped[str] = mapped_column(String(160))
    mother_mobile: Mapped[str] = mapped_column(String(60))
    medical_concerns: Mapped[str] = mapped_column(Text)
    medications: Mapped[str] = mapped_column(Text)
    consent_version: Mapped[str] = mapped_column(String(40))
    consented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    reviewed_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    redacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_newcomers_queue", "stage", "next_follow_up_at", "created_at"),)


class NewcomerNote(Base):
    __tablename__ = "newcomer_notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    application_id: Mapped[str] = mapped_column(
        ForeignKey("newcomer_applications.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class NewcomerRateLimit(Base):
    __tablename__ = "newcomer_rate_limits"

    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Announcement(TimestampMixin, Base):
    """A notice pinned to a squad, or academy-wide when it carries no team."""

    __tablename__ = "announcements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    # Null reaches everyone; a team ties the notice to one squad.
    team_id: Mapped[str | None] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text)
    # Kept even after the author leaves, so the notice still renders.
    author_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    team: Mapped[Team | None] = relationship()
    author: Mapped[User | None] = relationship()

    __table_args__ = (Index("ix_announcements_team_created", "team_id", "created_at"),)


class TrainingSession(TimestampMixin, Base):
    """A scheduled squad training. Repeats share a ``series_id`` so a whole
    recurring block can be dropped in one go."""

    __tablename__ = "training_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id", ondelete="CASCADE"), index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=90, server_default="90")
    venue: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    # Null for a one-off; shared across every occurrence of a recurring block.
    series_id: Mapped[str | None] = mapped_column(String(36), index=True)

    team: Mapped[Team] = relationship()
    availability: Mapped[list[TrainingAvailability]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("duration_minutes BETWEEN 15 AND 300", name="ck_training_duration"),
        Index("ix_training_team_start", "team_id", "starts_at"),
    )


class TrainingAvailability(TimestampMixin, Base):
    """A player's going / not-going answer for one training session."""

    __tablename__ = "training_availability"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    training_session_id: Mapped[str] = mapped_column(
        ForeignKey("training_sessions.id", ondelete="CASCADE"), index=True
    )
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    status: Mapped[AvailabilityStatus] = mapped_column(Enum(AvailabilityStatus, native_enum=False))
    note: Mapped[str | None] = mapped_column(Text)

    session: Mapped[TrainingSession] = relationship(back_populates="availability")
    player: Mapped[Player] = relationship()

    __table_args__ = (
        UniqueConstraint("training_session_id", "player_id", name="uq_availability_session_player"),
    )


class EventAssignment(TimestampMixin, Base):
    """A job attached to a match or a training session (e.g. "bring the bibs"),
    optionally claimed by one roster player. Exactly one of match / training is
    set."""

    __tablename__ = "event_assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    match_id: Mapped[str | None] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), nullable=True, index=True
    )
    training_session_id: Mapped[str | None] = mapped_column(
        ForeignKey("training_sessions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(160))
    assigned_player_id: Mapped[str | None] = mapped_column(
        ForeignKey("players.id", ondelete="SET NULL"), nullable=True
    )

    assigned_player: Mapped[Player | None] = relationship()

    __table_args__ = (
        CheckConstraint(
            "(match_id IS NULL) <> (training_session_id IS NULL)",
            name="ck_assignment_one_parent",
        ),
    )


class CompetitionGroup(Base):
    """One group in a knockout's group stage (Group A, Group B…)."""

    __tablename__ = "competition_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    competition_id: Mapped[str] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    position: Mapped[int] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("competition_id", "position", name="uq_group_competition_pos"),
    )


class BracketSlot(Base):
    """A knockout tie that may not have its teams yet — which a match row cannot
    be. ``round`` is the number of teams still in it (16, 8, 4, 2), so rounds
    sort themselves and slot p in round r feeds slot p/2 in round r/2."""

    __tablename__ = "bracket_slots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    competition_id: Mapped[str] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True
    )
    round: Mapped[int] = mapped_column(Integer)
    position: Mapped[int] = mapped_column(Integer)
    home_team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"))
    away_team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"))
    winner_team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"))
    match_id: Mapped[str | None] = mapped_column(ForeignKey("matches.id", ondelete="SET NULL"))

    __table_args__ = (
        UniqueConstraint(
            "competition_id", "round", "position", name="uq_slot_competition_round_pos"
        ),
    )


class CalendarToken(Base):
    """A capability URL for one account's fixtures calendar. The token is stored
    as itself (not hashed) because a subscription URL must stay readable;
    regenerating it is the revocation."""

    __tablename__ = "calendar_tokens"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Stamped once, when a calendar client first fetches the feed — that is what
    # subscribing actually means. Cleared when the token is regenerated.
    first_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(Base):
    """Who changed what during a match, so two admins scoring at once leave a trail."""

    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # Kept alongside the id so a removed admin's actions still read.
    actor_name: Mapped[str] = mapped_column(String(160))
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(36))
    match_id: Mapped[str | None] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), index=True
    )
    summary: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    actor: Mapped[User | None] = relationship()

    __table_args__ = (Index("ix_audit_log_match_created", "match_id", "created_at"),)
