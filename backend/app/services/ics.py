"""iCalendar (RFC 5545) feed rendering, ported from the Worker's calendar.ts.

A feed is a full-state document: whatever it returns is the whole truth, and a
client reconciles to it. A deleted fixture simply stops being published.
"""

from datetime import UTC, datetime

from app.db.models import Match, TrainingSession


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def escape_text(value: str) -> str:
    """RFC 5545 §3.3.11: backslash, semicolon, comma and newline carry meaning."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def fold(line: str) -> str:
    """RFC 5545 §3.1: no line exceeds 75 octets; continuations begin with a
    space. Counted in octets, and never split inside a UTF-8 sequence."""
    data = line.encode("utf-8")
    if len(data) <= 75:
        return line
    parts: list[bytes] = []
    start = 0
    while start < len(data):
        end = min(start + (74 if parts else 75), len(data))
        # Continuation bytes are 10xxxxxx; back off so we cut on a char boundary.
        while end > start and end < len(data) and (data[end] & 0b1100_0000) == 0b1000_0000:
            end -= 1
        parts.append(data[start:end])
        start = end
    return "\r\n ".join(part.decode("utf-8") for part in parts)


def ics_instant(value: datetime) -> str:
    """A datetime as iCalendar UTC, e.g. 2026-08-25T14:30:00Z -> 20260825T143000Z."""
    return _as_utc(value).strftime("%Y%m%dT%H%M%SZ")


def _sequence(updated_at: datetime) -> int:
    """A monotonically climbing revision; seconds since the epoch works for both
    matches and training, neither of which shares a revision counter."""
    return int(_as_utc(updated_at).timestamp())


def _event(uid: str, lines: list[tuple[str, str]]) -> str:
    body = [fold(f"{name}:{value}") for name, value in lines]
    return "\r\n".join(["BEGIN:VEVENT", *body, f"UID:{uid}", "END:VEVENT"])


def build_calendar(
    name: str, matches: list[Match], sessions: list[TrainingSession]
) -> str:
    stamp = ics_instant(datetime.now(UTC))
    events: list[str] = []

    for match in matches:
        # The whole afternoon: both halves plus the interval, and extra time if
        # the tie is configured for it.
        regulation = match.half_length_minutes * match.num_halves + (
            match.half_time_break_minutes * max(0, match.num_halves - 1)
        )
        minutes = regulation + (
            match.extra_time_half_length_minutes * 2 if match.has_extra_time else 0
        )
        kickoff = _as_utc(match.kickoff_datetime)
        ends = datetime.fromtimestamp(kickoff.timestamp() + minutes * 60, tz=UTC)
        home_is_aimz = match.home_team.is_aimz
        squad = match.home_team.name if home_is_aimz else match.away_team.name
        opponent = match.away_team.name if home_is_aimz else match.home_team.name
        events.append(
            _event(
                f"match-{match.id}@aimz-egypt",
                [
                    ("DTSTAMP", stamp),
                    ("DTSTART", ics_instant(match.kickoff_datetime)),
                    ("DTEND", ics_instant(ends)),
                    ("SUMMARY", escape_text(f"{squad} vs {opponent}")),
                    ("LOCATION", escape_text(match.venue)),
                    (
                        "DESCRIPTION",
                        escape_text(
                            f"{match.competition.name} · "
                            f"{match.home_team.name} v {match.away_team.name}"
                        ),
                    ),
                    ("LAST-MODIFIED", ics_instant(match.updated_at)),
                    ("SEQUENCE", str(_sequence(match.updated_at))),
                ],
            )
        )

    for session in sessions:
        starts = _as_utc(session.starts_at)
        ends = datetime.fromtimestamp(
            starts.timestamp() + session.duration_minutes * 60, tz=UTC
        )
        lines: list[tuple[str, str]] = [
            ("DTSTAMP", stamp),
            ("DTSTART", ics_instant(session.starts_at)),
            ("DTEND", ics_instant(ends)),
            ("SUMMARY", escape_text(f"{session.team.name} training")),
            ("LOCATION", escape_text(session.venue)),
        ]
        if session.notes:
            lines.append(("DESCRIPTION", escape_text(session.notes)))
        lines.append(("LAST-MODIFIED", ics_instant(session.updated_at)))
        lines.append(("SEQUENCE", str(_sequence(session.updated_at))))
        events.append(_event(f"training-{session.id}@aimz-egypt", lines))

    return "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//AIMZ Egypt//Fixtures//EN",
            "CALSCALE:GREGORIAN",
            "METHOD:PUBLISH",
            fold(f"X-WR-CALNAME:{escape_text(name)}"),
            "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
            "X-PUBLISHED-TTL:PT1H",
            *events,
            "END:VCALENDAR",
            "",
        ]
    )
