from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.db.models import CompetitionType, EventType, MatchPhase, MatchStatus, UserRole
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
    created_at: datetime


class RegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)
    invite_code: str = Field(min_length=4, max_length=128)


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


class InviteCreate(BaseModel):
    label: str = Field(min_length=2, max_length=120)
    code: str = Field(min_length=4, max_length=128)
    expires_at: datetime | None = None
    max_uses: int | None = Field(default=None, ge=1)


class InviteRead(ORMModel):
    id: str
    label: str
    expires_at: datetime | None
    max_uses: int | None
    use_count: int
    is_active: bool
    created_at: datetime


class TeamInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    squad_code: str | None = Field(default=None, max_length=40)
    age_group: str | None = Field(default=None, max_length=40)
    season: str | None = Field(default=None, max_length=40)
    is_aimz: bool = False
    is_active: bool = True
    logo_key: str | None = Field(default=None, max_length=512)
    coach: str | None = Field(default=None, max_length=160)
    assistant_coach: str | None = Field(default=None, max_length=160)


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


class CompetitionRead(CompetitionInput, ORMModel):
    id: str
    created_at: datetime
    updated_at: datetime


class PlayerInput(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    team_id: str
    position: str = Field(min_length=1, max_length=60)
    jersey_number: int | None = Field(default=None, ge=0, le=99)
    photo_key: str | None = Field(default=None, max_length=512)
    is_active: bool = True


class PlayerRead(PlayerInput, ORMModel):
    id: str
    created_at: datetime
    updated_at: datetime
    photo_url: str | None = None

    @model_validator(mode="after")
    def resolve_photo(self) -> PlayerRead:
        self.photo_url = create_signed_read_url(self.photo_key)
        return self


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


class MatchEventInput(BaseModel):
    type: EventType
    minute: int | None = Field(default=None, ge=0, le=150)
    team_id: str
    player_id: str | None = None
    secondary_player_id: str | None = None
    related_event_id: str | None = None
    notes: str | None = Field(default=None, max_length=1000)
    is_penalty: bool = False
    client_operation_id: str = Field(min_length=8, max_length=64)


class MatchEventUpdate(BaseModel):
    type: EventType | None = None
    minute: int | None = Field(default=None, ge=0, le=150)
    team_id: str | None = None
    player_id: str | None = None
    secondary_player_id: str | None = None
    notes: str | None = Field(default=None, max_length=1000)
    is_penalty: bool | None = None


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
    goals: int
    assists: int
    yellow_cards: int
    red_cards: int


class LiveMatchSnapshot(BaseModel):
    match: MatchRead
    events: list[MatchEventRead]
    lineup: list[LineupEntryRead]
    revision: int


class StandingRow(BaseModel):
    rank: int
    team: TeamRead
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
    appearances: int


class PlayerSeasonSummary(BaseModel):
    player: PlayerRead
    season: str | None
    appearances: int
    minutes_played: int
    goals: int
    assists: int
    yellow_cards: int
    red_cards: int
    matches: list[PlayerMatchStatRead]


class PresignRequest(BaseModel):
    entity: Literal["team", "player"]
    entity_id: str
    content_type: Literal["image/jpeg", "image/png", "image/webp"]


class PresignResponse(BaseModel):
    upload_url: str
    fields: dict[str, str]
    object_key: str
    expires_in: int
