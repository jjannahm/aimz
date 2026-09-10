from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.db.models import (
    AvailabilityStatus,
    CompetitionStatus,
    CompetitionType,
    EventType,
    InviteKind,
    MatchPhase,
    MatchStatus,
    NewcomerOutcome,
    NewcomerSource,
    NewcomerStage,
    OnboardingStatus,
    PenaltyOutcome,
    SubstitutionReason,
    UserRole,
)
from app.services.positions import POSITION_CODES
from app.services.storage import create_signed_read_url


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class MessageResponse(BaseModel):
    message: str


class UserRead(ORMModel):
    id: str
    name: str
    email: EmailStr
    role: UserRole
    player_id: str | None
    onboarding_status: OnboardingStatus = OnboardingStatus.approved
    # Null when the account never expires; a date it stops working on otherwise.
    expires_at: datetime | None = None
    created_at: datetime


class NewcomerApplicationInput(BaseModel):
    branch: str = Field(min_length=2, max_length=120)
    full_name: str = Field(min_length=2, max_length=160)
    mobile: str = Field(min_length=5, max_length=60)
    email: EmailStr
    whatsapp_mobile: str = Field(min_length=5, max_length=60)
    date_of_birth: date
    nationality: str = Field(min_length=2, max_length=100)
    address: str = Field(min_length=2, max_length=500)
    previous_academy: str = Field(min_length=2, max_length=200)
    school_university: str = Field(min_length=2, max_length=200)
    father_name: str = Field(min_length=2, max_length=160)
    father_mobile: str = Field(min_length=5, max_length=60)
    mother_name: str = Field(min_length=2, max_length=160)
    mother_mobile: str = Field(min_length=5, max_length=60)
    medical_concerns: str = Field(min_length=2, max_length=4000)
    medications: str = Field(min_length=2, max_length=4000)
    consent: Literal[True]
    consent_version: str = Field(default="2026-09", min_length=1, max_length=40)

    @field_validator(
        "branch",
        "full_name",
        "mobile",
        "whatsapp_mobile",
        "nationality",
        "address",
        "previous_academy",
        "school_university",
        "father_name",
        "father_mobile",
        "mother_name",
        "mother_mobile",
        "medical_concerns",
        "medications",
    )
    @classmethod
    def _strip_required(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("This field is required. Enter None when it does not apply.")
        return value


class PublicNewcomerCreate(NewcomerApplicationInput):
    client_submission_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,64}$")
    turnstile_token: str = Field(min_length=1, max_length=2048)


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    invite_code: str = Field(min_length=4, max_length=128)
    application: NewcomerApplicationInput | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserRead


class RefreshRequest(BaseModel):
    refresh_token: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    new_password: str = Field(min_length=10, max_length=128)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=128)


class UserUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class AdminUserCreate(RegisterRequest):
    role: UserRole = UserRole.admin
    invite_code: str = "unused"
    # An optional deadline for the account. Validated future-dated in the route.
    expires_at: datetime | None = None


class InviteCreate(BaseModel):
    label: str = Field(min_length=2, max_length=120)
    code: str | None = Field(default=None, min_length=4, max_length=128)
    # Which of the two kinds of account this invitation redeems into. A player
    # invitation names one player and links the account to that roster record,
    # which is how a player sees their own stats; a parent invitation names one
    # or more children the account will follow.
    kind: InviteKind = InviteKind.player
    # The players named on the invitation. ``player_id`` is the single-player
    # form (a player invitation, or an older client); ``player_ids`` carries the
    # several a parent invitation needs. Either or both may be given.
    player_id: str | None = Field(default=None, max_length=36)
    player_ids: list[str] = Field(default_factory=list)
    team_id: str | None = Field(default=None, max_length=36)
    application_id: str | None = Field(default=None, max_length=36)
    expires_at: datetime | None = None
    max_uses: int | None = Field(default=None, ge=1)


class AdminUserUpdate(BaseModel):
    # Null unlinks. Anything else must be a roster player nobody else holds.
    player_id: str | None = Field(default=None, max_length=36)
    # Set on its own, so an account created from an invitation — a parent's,
    # which the create endpoint cannot make — can still be given a deadline.
    # Null lifts it. A field left out of the body is left untouched; the route
    # tells the two apart with ``model_fields_set``.
    expires_at: datetime | None = None


class InvitePlayerRead(BaseModel):
    id: str
    name: str


class InviteRead(ORMModel):
    id: str
    label: str
    kind: InviteKind
    player_id: str | None
    team_id: str | None = None
    application_id: str | None = None
    players: list[InvitePlayerRead] = Field(default_factory=list)
    expires_at: datetime | None
    max_uses: int | None
    use_count: int
    is_active: bool
    created_at: datetime


class GeneratedInviteRead(InviteRead):
    code: str
    share_url: str


class InviteResolveRequest(BaseModel):
    code: str = Field(min_length=4, max_length=128)


class InviteContext(BaseModel):
    kind: InviteKind
    label: str
    team_id: str | None = None
    team_name: str | None = None
    players: list[InvitePlayerRead] = Field(default_factory=list)
    requires_application: bool = False


class NewcomerNoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class NewcomerNoteRead(ORMModel):
    id: str
    author_id: str | None
    body: str
    created_at: datetime


class NewcomerRead(ORMModel):
    id: str
    source: NewcomerSource
    stage: NewcomerStage
    outcome: NewcomerOutcome | None
    user_id: str | None
    player_id: str | None
    invite_id: str | None
    suggested_team_id: str | None
    branch: str
    full_name: str
    mobile: str
    email: EmailStr
    whatsapp_mobile: str
    date_of_birth: str
    nationality: str
    address: str
    previous_academy: str
    school_university: str
    father_name: str
    father_mobile: str
    mother_name: str
    mother_mobile: str
    medical_concerns: str
    medications: str
    consent_version: str
    consented_at: datetime
    last_contacted_at: datetime | None
    next_follow_up_at: datetime | None
    closed_at: datetime | None
    redacted_at: datetime | None
    created_at: datetime
    updated_at: datetime
    duplicate_likely: bool = False
    notes: list[NewcomerNoteRead] = Field(default_factory=list)


class NewcomerCreated(BaseModel):
    id: str
    stage: NewcomerStage
    duplicate_likely: bool = False


class NewcomerUpdate(BaseModel):
    stage: NewcomerStage | None = None
    outcome: NewcomerOutcome | None = None
    last_contacted_at: datetime | None = None
    next_follow_up_at: datetime | None = None

    @model_validator(mode="after")
    def _closed_has_outcome(self) -> NewcomerUpdate:
        if self.stage == NewcomerStage.closed and self.outcome is None:
            raise ValueError("A closed application needs an outcome.")
        if self.outcome is not None and self.stage not in {None, NewcomerStage.closed}:
            raise ValueError("An outcome can only be set when closing an application.")
        return self


class NewcomerAssignment(BaseModel):
    team_id: str = Field(min_length=1, max_length=36)
    position: str = Field(min_length=1, max_length=60)
    jersey_number: int | None = Field(default=None, ge=0, le=99)

    @field_validator("position")
    @classmethod
    def _assignment_position(cls, value: str) -> str:
        if value not in POSITION_CODES:
            raise ValueError("Choose a position from the list.")
        return value


class NewcomerAssignmentResult(BaseModel):
    application: NewcomerRead
    player_id: str
    invitation: GeneratedInviteRead | None = None


class TeamInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    squad_code: str | None = Field(default=None, max_length=40)
    age_group: str | None = Field(default=None, max_length=40)
    season: str | None = Field(default=None, max_length=40)
    is_aimz: bool = False
    is_active: bool = True
    logo_key: str | None = Field(default=None, max_length=512)
    badge_style: Literal["aimz", "generated"] | None = None
    coach: str | None = Field(default=None, max_length=160)
    assistant_coach: str | None = Field(default=None, max_length=160)
    competition_id: str | None = None


class TeamRead(TeamInput, ORMModel):
    id: str
    created_at: datetime
    updated_at: datetime
    logo_url: str | None = None

    @model_validator(mode="after")
    def resolve_logo(self) -> TeamRead:
        self.logo_url = create_signed_read_url(self.logo_key)
        return self


class CompetitionInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    season: str = Field(min_length=2, max_length=40)
    type: CompetitionType
    # A knockout's shape; both null for a plain league table. Validated and
    # normalised in the route via resolve_shape.
    team_count: int | None = None
    group_size: int | None = None


class CompetitionRead(CompetitionInput, ORMModel):
    id: str
    status: CompetitionStatus
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class NextSeasonInput(BaseModel):
    season: str = Field(min_length=2, max_length=40)
    # Copy the club list across as new rows for the new season. Players are not
    # copied — a squad is not the same people a year later.
    carry_teams: bool = False


class PlayerInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    team_id: str
    position: str = Field(min_length=1, max_length=60)
    jersey_number: int | None = Field(default=None, ge=0, le=99)
    photo_key: str | None = Field(default=None, max_length=512)
    is_active: bool = True

    @field_validator("position")
    @classmethod
    def _valid_position(cls, value: str) -> str:
        if value not in POSITION_CODES:
            raise ValueError("Choose a position from the list.")
        return value


class PlayerRead(PlayerInput, ORMModel):
    id: str
    created_at: datetime
    updated_at: datetime
    photo_url: str | None = None

    @model_validator(mode="after")
    def resolve_photo(self) -> PlayerRead:
        self.photo_url = create_signed_read_url(self.photo_key)
        return self


class ChildRead(BaseModel):
    """A roster player a parent account speaks for, as the account hub reads it.

    A player account answers ``/users/me/children`` with the one player it is,
    so a caller has a single shape either way."""

    id: str
    name: str
    team_id: str
    team_name: str | None = None


class ChildrenResponse(BaseModel):
    items: list[ChildRead]


class AdminAccountRead(UserRead):
    player: PlayerRead | None = None
    team: TeamRead | None = None
    # A parent's roster links live in ``user_children``, never on
    # ``users.player_id``, so ``player``/``team`` above are null for them and
    # their children are grouped here instead.
    children: list[ChildRead] = Field(default_factory=list)


EXTRA_TIME_PERIODS = 2
LINEUP_FORMATS = frozenset({5, 6, 7, 9, 11})


class MatchInput(BaseModel):
    competition_id: str
    home_team_id: str
    away_team_id: str
    kickoff_datetime: datetime
    venue: str = Field(min_length=2, max_length=200)
    status: MatchStatus = MatchStatus.scheduled
    half_length_minutes: int = Field(default=45, ge=1, le=90)
    num_halves: int = Field(default=2, ge=1, le=4)
    half_time_break_minutes: int = Field(default=15, ge=0, le=30)
    has_extra_time: bool = False
    extra_time_half_length_minutes: int = Field(default=15, ge=1, le=30)
    lineup_format: int | None = Field(default=None)
    formation: str | None = Field(default=None, max_length=20)

    @field_validator("formation")
    @classmethod
    def shaped_like_a_formation(cls, value: str | None) -> str | None:
        if value is None:
            return None
        parts = value.split("-")
        if len(parts) < 2 or not all(part.isdigit() and int(part) > 0 for part in parts):
            raise ValueError("Formation must be digits separated by dashes, e.g. 4-4-2.")
        return value

    @field_validator("lineup_format")
    @classmethod
    def known_format(cls, value: int | None) -> int | None:
        if value is not None and value not in LINEUP_FORMATS:
            raise ValueError(f"Format must be one of {sorted(LINEUP_FORMATS)}.")
        return value

    @property
    def total_length_minutes(self) -> int:
        regulation = (self.half_length_minutes * self.num_halves) + (
            self.half_time_break_minutes * (self.num_halves - 1)
        )
        return regulation + (
            EXTRA_TIME_PERIODS * self.extra_time_half_length_minutes if self.has_extra_time else 0
        )

    @model_validator(mode="after")
    def distinct_teams(self) -> MatchInput:
        if self.home_team_id == self.away_team_id:
            raise ValueError("Home and away teams must be different.")
        return self

    @model_validator(mode="after")
    def formation_fits_the_format(self) -> MatchInput:
        # A 7-a-side formation cannot be played by an 11-a-side lineup: the
        # outfield count is the format minus the keeper.
        if self.formation is None or self.lineup_format is None:
            return self
        outfield = sum(int(part) for part in self.formation.split("-"))
        if outfield != self.lineup_format - 1:
            raise ValueError(
                f"Formation {self.formation} covers {outfield} outfield players, "
                f"but {self.lineup_format}-a-side needs {self.lineup_format - 1}."
            )
        return self


class MatchRead(MatchInput, ORMModel):
    id: str
    phase: MatchPhase
    # Read-only here: set through POST /matches/{id}/man-of-the-match, which can
    # check the match is finished and the player actually played.
    man_of_the_match_player_id: str | None = None
    phase_started_at: datetime | None
    home_score: int
    away_score: int
    revision: int
    created_at: datetime
    updated_at: datetime
    home_team: TeamRead | None = None
    away_team: TeamRead | None = None
    competition: CompetitionRead | None = None


class MatchPhaseUpdate(BaseModel):
    action: Literal[
        "start_match",
        "halftime",
        "start_second_half",
        "start_extra_time",
        "finish_match",
    ]


LOGGABLE_EVENTS = frozenset(
    {
        EventType.goal,
        EventType.own_goal,
        EventType.penalty_missed,
        EventType.yellow_card,
        EventType.red_card,
        EventType.substitution,
    }
)


def _loggable(value: EventType) -> EventType:
    # An assist is recorded on the goal it came from, not as an event of its own.
    if value not in LOGGABLE_EVENTS:
        raise ValueError(f"{value.value} cannot be logged as its own event.")
    return value


class MatchEventInput(BaseModel):
    type: EventType
    minute: int | None = Field(default=None, ge=0, le=150)
    team_id: str
    player_id: str | None = None
    secondary_player_id: str | None = None
    related_event_id: str | None = None
    notes: str | None = Field(default=None, max_length=1000)
    is_penalty: bool = False
    substitution_reason: SubstitutionReason | None = None
    penalty_outcome: PenaltyOutcome | None = None
    client_operation_id: str = Field(min_length=8, max_length=64)

    @field_validator("type")
    @classmethod
    def loggable(cls, value: EventType) -> EventType:
        return _loggable(value)


class MatchEventUpdate(BaseModel):
    type: EventType | None = None
    minute: int | None = Field(default=None, ge=0, le=150)
    team_id: str | None = None
    player_id: str | None = None
    secondary_player_id: str | None = None
    notes: str | None = Field(default=None, max_length=1000)
    is_penalty: bool | None = None
    substitution_reason: SubstitutionReason | None = None
    penalty_outcome: PenaltyOutcome | None = None

    @field_validator("type")
    @classmethod
    def loggable(cls, value: EventType | None) -> EventType | None:
        # POST refuses an assist; PATCH used to let one in through the back door.
        return None if value is None else _loggable(value)


class MatchEventRead(MatchEventInput, ORMModel):
    id: str
    match_id: str
    created_at: datetime
    updated_at: datetime


class LineupEntryInput(BaseModel):
    player_id: str
    team_id: str
    is_starter: bool = False
    is_captain: bool = False
    position: str | None = Field(default=None, max_length=60)
    jersey_number: int | None = Field(default=None, ge=0, le=99)

    @field_validator("position")
    @classmethod
    def _valid_position(cls, value: str | None) -> str | None:
        if value is not None and value not in POSITION_CODES:
            raise ValueError("Choose a position from the list.")
        return value


class LineupEntryRead(LineupEntryInput, ORMModel):
    id: str
    match_id: str


class PlayerStatInput(BaseModel):
    player_id: str
    appeared: bool
    minutes_played: int = Field(ge=0, le=150)


class PlayerMatchStatRead(PlayerStatInput, ORMModel):
    id: str
    match_id: str
    team_id: str | None = None
    goals: int
    assists: int
    own_goals: int
    yellow_cards: int
    red_cards: int
    goals_conceded: int
    penalties_saved: int
    clean_sheet: int


class LiveMatchSnapshot(BaseModel):
    match: MatchRead
    events: list[MatchEventRead]
    lineup: list[LineupEntryRead]
    revision: int


class StandingRow(BaseModel):
    rank: int
    team: TeamRead
    # Most recent five results, newest first: "W", "D" or "L".
    form: list[str] = Field(default_factory=list)
    played: int
    won: int
    drawn: int
    lost: int
    goals_for: int
    goals_against: int
    goal_difference: int
    points: int


class PlayerLeaderRow(BaseModel):
    rank: int
    player: PlayerRead
    team: TeamRead
    goals: int
    assists: int
    yellow_cards: int
    red_cards: int
    appearances: int


class PlayerSeasonSummary(BaseModel):
    player: PlayerRead
    season: str | None
    appearances: int
    minutes_played: int
    goals: int
    assists: int
    own_goals: int
    yellow_cards: int
    red_cards: int
    matches: list[PlayerMatchStatRead]


class MatchResultInput(BaseModel):
    """The final score of a match nobody from AIMZ was at to score live."""

    home_score: int = Field(ge=0, le=99)
    away_score: int = Field(ge=0, le=99)


class ManOfTheMatchInput(BaseModel):
    # Null clears the award, so a mistaken pick can be undone.
    player_id: str | None = None


class HeadToHeadMeeting(BaseModel):
    match_id: str
    kickoff_datetime: datetime
    competition: CompetitionRead | None = None
    home_team: TeamRead | None = None
    away_team: TeamRead | None = None
    home_score: int
    away_score: int
    # From the requested team's point of view: "W", "D" or "L".
    result: str


class HeadToHead(BaseModel):
    team: TeamRead
    opponent: TeamRead
    played: int
    won: int
    drawn: int
    lost: int
    goals_for: int
    goals_against: int
    meetings: list[HeadToHeadMeeting]


class PlayerAward(BaseModel):
    label: str
    player: PlayerRead
    team: TeamRead
    value: int
    # Rendered after the number, e.g. "goals".
    unit: str


class TeamAward(BaseModel):
    label: str
    team: TeamRead
    value: int
    unit: str


class SeasonAwards(BaseModel):
    competition: CompetitionRead
    # Empty until the competition has a finished match to draw on.
    player_awards: list[PlayerAward] = Field(default_factory=list)
    team_awards: list[TeamAward] = Field(default_factory=list)


class AuditLogRead(ORMModel):
    id: str
    actor_id: str | None
    actor_name: str
    action: str
    entity_type: str
    entity_id: str | None
    match_id: str | None
    summary: str
    created_at: datetime


class AnnouncementInput(BaseModel):
    team_id: str | None = Field(default=None, max_length=36)
    title: str = Field(min_length=2, max_length=160)
    body: str = Field(min_length=2, max_length=5000)
    pinned: bool = False


class AnnouncementUpdate(BaseModel):
    # Every field optional; the route uses ``model_fields_set`` to tell an
    # omitted field from an explicit null (which clears the team).
    team_id: str | None = Field(default=None, max_length=36)
    title: str | None = Field(default=None, min_length=2, max_length=160)
    body: str | None = Field(default=None, min_length=2, max_length=5000)
    pinned: bool | None = None


class AnnouncementRead(ORMModel):
    id: str
    team_id: str | None
    title: str
    body: str
    author_id: str | None
    pinned: bool
    created_at: datetime
    updated_at: datetime
    author_name: str | None = None
    team: TeamRead | None = None


class PlayerContactInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    relationship: str | None = Field(default=None, max_length=80)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=60)


class PlayerContactRead(ORMModel):
    id: str
    player_id: str
    name: str
    relationship: str | None
    email: str | None
    phone: str | None
    created_at: datetime
    updated_at: datetime


class RosterInput(BaseModel):
    date_of_birth: str | None = Field(default=None, max_length=10)
    contacts: list[PlayerContactInput] = Field(default_factory=list, max_length=20)

    @field_validator("date_of_birth")
    @classmethod
    def _valid_date(cls, value: str | None) -> str | None:
        if value is None:
            return value
        from datetime import date

        try:
            if date.fromisoformat(value).isoformat() != value:
                raise ValueError
        except ValueError as exc:
            raise ValueError("Use a valid YYYY-MM-DD date.") from exc
        return value


class RosterRead(BaseModel):
    player_id: str
    date_of_birth: str | None
    contacts: list[PlayerContactRead]


class TrainingSessionRead(ORMModel):
    id: str
    team_id: str
    starts_at: datetime
    duration_minutes: int
    venue: str
    notes: str | None
    series_id: str | None
    created_at: datetime
    updated_at: datetime
    team: TeamRead | None = None


class TrainingCreate(BaseModel):
    team_id: str = Field(min_length=1, max_length=36)
    venue: str = Field(min_length=2, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)
    duration_minutes: int = Field(ge=15, le=300)
    occurrences: list[datetime] = Field(min_length=1, max_length=200)


class TrainingUpdate(BaseModel):
    starts_at: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=15, le=300)
    venue: str | None = Field(default=None, min_length=2, max_length=200)
    notes: str | None = Field(default=None, max_length=2000)


class AvailabilityInput(BaseModel):
    # Admins may answer for any player on the squad; a player answers for itself.
    player_id: str | None = Field(default=None, max_length=36)
    status: AvailabilityStatus
    note: str | None = Field(default=None, max_length=500)


class AvailabilityRead(ORMModel):
    id: str
    training_session_id: str
    player_id: str
    status: AvailabilityStatus
    note: str | None
    created_at: datetime
    updated_at: datetime
    player: PlayerRead | None = None


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    assigned_player_id: str | None = Field(default=None, max_length=36)


class AssignmentUpdate(BaseModel):
    # Absent or null both mean "release"; a string claims for that player.
    assigned_player_id: str | None = Field(default=None, max_length=36)


class AssignmentRead(ORMModel):
    id: str
    match_id: str | None
    training_session_id: str | None
    title: str
    assigned_player_id: str | None
    created_at: datetime
    updated_at: datetime
    assigned_player: PlayerRead | None = None


class CalendarFeedRead(BaseModel):
    url: str | None
    subscribed_at: datetime | None


class AwardRankRow(BaseModel):
    rank: int
    player: PlayerRead | None
    team: TeamRead | None
    value: int
    unit: str
    appearances: int


class PlayerHonour(BaseModel):
    competition: CompetitionRead
    metric: str
    label: str
    value: int
    unit: str
    team: TeamRead | None
    is_final: bool


class PlayerHonours(BaseModel):
    player: PlayerRead
    honours: list[PlayerHonour]


class SquadStatRow(BaseModel):
    player_id: str
    appearances: int
    minutes_played: int
    goals: int
    assists: int
    clean_sheets: int
    goals_conceded: int


class GroupRead(BaseModel):
    id: str
    competition_id: str
    name: str
    position: int
    teams: list[TeamRead]


class GroupTeamRef(BaseModel):
    team_id: str = Field(min_length=1, max_length=36)


class BracketSlotRead(BaseModel):
    id: str
    round: int
    position: int
    home_team: TeamRead | None
    away_team: TeamRead | None
    winner_team_id: str | None
    match_id: str | None


class BracketRound(BaseModel):
    round: int
    label: str
    slots: list[BracketSlotRead]


class BracketRead(BaseModel):
    competition_id: str
    team_count: int | None
    rounds: list[BracketRound]


class AdvanceInput(BaseModel):
    round: int


class BracketSlotUpdate(BaseModel):
    winner_team_id: str | None = Field(default=None, max_length=36)
    match_id: str | None = Field(default=None, max_length=36)


class PresignRequest(BaseModel):
    entity: Literal["team", "player"]
    entity_id: str
    content_type: Literal["image/jpeg", "image/png", "image/webp"]


class PresignResponse(BaseModel):
    upload_url: str
    fields: dict[str, str]
    object_key: str
    expires_in: int
