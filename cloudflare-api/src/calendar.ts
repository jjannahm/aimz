import type { Hono } from "hono";

import { ApiProblem, currentUser, nowIso } from "./helpers";
import { newToken } from "./security";
import { linkedPlayerIds, linkedTeamIds } from "./team-access";
import type { CalendarTokenRow, UserRow } from "./types";

/**
 * A parent's fixtures, as a calendar they subscribe to once and never think
 * about again.
 *
 * The feed is a full-state document rather than a stream of changes: whatever it
 * returns is the whole truth, and a client reconciles to it. That is what makes
 * a deleted fixture disappear without this API having any notion of a
 * cancellation — the row goes, the VEVENT stops being published, and the entry
 * leaves the parent's calendar at the next poll.
 */

/** Far enough ahead to cover a season, near enough to keep the feed small. */
const WINDOW_DAYS_AHEAD = 365;
/**
 * A match already under way is still worth showing: a parent looking at their
 * phone at kick-off should not find the fixture has vanished from the calendar
 * they came to check.
 */
const WINDOW_DAYS_BEHIND = 1;

/** RFC 5545 §3.3.11: these four characters carry meaning inside a value. */
function escapeText(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/;/gu, "\\;").replace(/,/gu, "\\,").replace(/\r?\n/gu, "\\n");
}

/**
 * RFC 5545 §3.1: no line may exceed 75 octets, and a continuation begins with
 * one space. Counted in octets rather than characters, because an Arabic squad
 * name or a venue with an accent spends more than one byte per letter and a
 * naive split by length would sail past the limit.
 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // 75 for the first line, 74 for the rest, which each carry a leading space.
    let end = Math.min(start + (parts.length ? 74 : 75), bytes.length);
    // Never split inside a UTF-8 sequence: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end]! & 0b1100_0000) === 0b1000_0000) end -= 1;
    parts.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
  }
  return parts.join("\r\n ");
}

/** An ISO instant as iCalendar UTC: 2026-08-25T14:30:00.000Z → 20260825T143000Z. */
function icsInstant(iso: string): string {
  return `${new Date(iso).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "")}`;
}

/**
 * A revision number that only ever climbs, so a client can tell an edit from a
 * repeat. Seconds since the epoch rather than a stored counter: training has no
 * revision column, and this keeps both kinds of event on one rule.
 */
function sequence(updatedAt: string): number {
  return Math.floor(new Date(updatedAt).getTime() / 1000);
}

type Line = [string, string];

function event(uid: string, lines: Line[]): string {
  return ["BEGIN:VEVENT", ...lines.map(([name, value]) => fold(`${name}:${value}`)), `UID:${uid}`, "END:VEVENT"].join("\r\n");
}

interface FeedMatch {
  id: string; kickoff_datetime: string; venue: string; updated_at: string;
  half_length_minutes: number; num_halves: number; half_time_break_minutes: number;
  has_extra_time: number; extra_time_half_length_minutes: number;
  home_name: string; away_name: string; home_is_aimz: number; competition_name: string;
}

interface FeedTraining {
  id: string; starts_at: string; venue: string; notes: string | null;
  duration_minutes: number; updated_at: string; team_name: string;
}

function buildCalendar(name: string, matches: FeedMatch[], sessions: FeedTraining[]): string {
  const stamp = icsInstant(nowIso());
  const events = [
    ...matches.map((match) => {
      // The whole afternoon, not just the first whistle: both halves plus the
      // interval, which is what the match itself is configured with.
      const regulation = match.half_length_minutes * match.num_halves
        + match.half_time_break_minutes * Math.max(0, match.num_halves - 1);
      const minutes = regulation + (match.has_extra_time ? match.extra_time_half_length_minutes * 2 : 0);
      const ends = new Date(new Date(match.kickoff_datetime).getTime() + minutes * 60_000).toISOString();
      const squad = match.home_is_aimz ? match.home_name : match.away_name;
      const opponent = match.home_is_aimz ? match.away_name : match.home_name;
      return event(`match-${match.id}@aimz-egypt`, [
        ["DTSTAMP", stamp],
        ["DTSTART", icsInstant(match.kickoff_datetime)],
        ["DTEND", icsInstant(ends)],
        ["SUMMARY", escapeText(`${squad} vs ${opponent}`)],
        ["LOCATION", escapeText(match.venue)],
        ["DESCRIPTION", escapeText(`${match.competition_name} · ${match.home_name} v ${match.away_name}`)],
        ["LAST-MODIFIED", icsInstant(match.updated_at)],
        ["SEQUENCE", String(sequence(match.updated_at))],
      ]);
    }),
    ...sessions.map((session) => {
      const ends = new Date(new Date(session.starts_at).getTime() + session.duration_minutes * 60_000).toISOString();
      return event(`training-${session.id}@aimz-egypt`, [
        ["DTSTAMP", stamp],
        ["DTSTART", icsInstant(session.starts_at)],
        ["DTEND", icsInstant(ends)],
        ["SUMMARY", escapeText(`${session.team_name} training`)],
        ["LOCATION", escapeText(session.venue)],
        ...(session.notes ? ([["DESCRIPTION", escapeText(session.notes)]] as Line[]) : []),
        ["LAST-MODIFIED", icsInstant(session.updated_at)],
        ["SEQUENCE", String(sequence(session.updated_at))],
      ]);
    }),
  ];
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AIMZ Egypt//Fixtures//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${escapeText(name)}`),
    // Both spellings: the standard one, and the older Apple property that is
    // still what actually sets the poll interval in a lot of clients.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** The feed URL for a token, taken from the request so no base URL is configured. */
function feedUrl(requestUrl: string, token: string): string {
  return `${new URL(requestUrl).origin}/api/v1/calendar/${token}/aimz.ics`;
}

/** Mints a feed token, replacing any current one — which is how revoking works. */
async function issueToken(env: Env, user: UserRow): Promise<string> {
  const token = newToken();
  await env.DB.prepare("INSERT INTO calendar_tokens (user_id, token, created_at, first_fetched_at) VALUES (?, ?, ?, NULL) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token, created_at=excluded.created_at, first_fetched_at=NULL")
    .bind(user.id, token, nowIso()).run();
  return token;
}

/** An admin has no linked players, so there are no fixtures that are theirs. */
function refuseAdmin(user: UserRow): void {
  if (user.role === "admin") throw new ApiProblem(403, "player_link_required", "A calendar feed follows your own squad's fixtures. An admin account is not on a roster.");
}

export function registerCalendarRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/api/v1/calendar/:token/aimz.ics", async (c) => {
    // Deliberately unauthenticated: a calendar client cannot send a bearer
    // token, so the secret in the path is the whole of the credential.
    const row = await c.env.DB.prepare("SELECT * FROM calendar_tokens WHERE token = ?")
      .bind(c.req.param("token")).first<CalendarTokenRow>();
    // One answer for a wrong token, a revoked one and a deleted account, so the
    // feed cannot be used to find out which accounts exist.
    if (!row) throw new ApiProblem(404, "not_found", "No calendar feed matches this address.");
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").bind(row.user_id).first<UserRow>();
    if (!user) throw new ApiProblem(404, "not_found", "No calendar feed matches this address.");

    const teamIds = await linkedTeamIds(c.env, user);
    const holders = teamIds.map(() => "?").join(",");
    const from = new Date(Date.now() - WINDOW_DAYS_BEHIND * 86_400_000).toISOString();
    const to = new Date(Date.now() + WINDOW_DAYS_AHEAD * 86_400_000).toISOString();
    const playerIds = await linkedPlayerIds(c.env, user);
    const playerHolders = playerIds.map(() => "?").join(",");
    const [matches, sessions, children] = await Promise.all([
      c.env.DB.prepare(`SELECT m.id, m.kickoff_datetime, m.venue, m.updated_at, m.half_length_minutes, m.num_halves, m.half_time_break_minutes,
          m.has_extra_time, m.extra_time_half_length_minutes,
          h.name home_name, h.is_aimz home_is_aimz, a.name away_name, comp.name competition_name
        FROM matches m JOIN teams h ON h.id=m.home_team_id JOIN teams a ON a.id=m.away_team_id JOIN competitions comp ON comp.id=m.competition_id
        WHERE (m.home_team_id IN (${holders}) OR m.away_team_id IN (${holders})) AND m.kickoff_datetime BETWEEN ? AND ?
        ORDER BY m.kickoff_datetime`).bind(...teamIds, ...teamIds, from, to).all<FeedMatch>(),
      c.env.DB.prepare(`SELECT t.id, t.starts_at, t.venue, t.notes, t.duration_minutes, t.updated_at, teams.name team_name
        FROM training_sessions t JOIN teams ON teams.id=t.team_id
        WHERE t.team_id IN (${holders}) AND t.starts_at BETWEEN ? AND ?
        ORDER BY t.starts_at`).bind(...teamIds, from, to).all<FeedTraining>(),
      c.env.DB.prepare(`SELECT name FROM players WHERE id IN (${playerHolders}) ORDER BY name`)
        .bind(...playerIds).all<{ name: string }>(),
    ]);

    // Written once rather than on every poll: a subscribed client comes back
    // hourly, and this only has to answer "did anyone ever add it".
    if (!row.first_fetched_at) await c.env.DB.prepare("UPDATE calendar_tokens SET first_fetched_at=? WHERE user_id=? AND first_fetched_at IS NULL").bind(nowIso(), row.user_id).run();

    const names = children.results.map((child) => child.name);
    const body = buildCalendar(names.length ? `AIMZ · ${names.join(", ")}` : "AIMZ Egypt", matches.results, sessions.results);
    return new Response(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="aimz.ics"',
        // Personal to one family, so no shared cache should hold a copy.
        "Cache-Control": "private, no-cache",
      },
    });
  });

  app.get("/api/v1/users/me/calendar", async (c) => {
    const user = await currentUser(c);
    refuseAdmin(user);
    const existing = await c.env.DB.prepare("SELECT * FROM calendar_tokens WHERE user_id = ?").bind(user.id).first<CalendarTokenRow>();
    // Minted on first ask rather than at registration, so an account that never
    // opens this never has a live feed URL at all.
    const token = existing?.token ?? await issueToken(c.env, user);
    return c.json({ url: feedUrl(c.req.url, token), subscribed_at: existing?.first_fetched_at ?? null });
  });

  app.post("/api/v1/users/me/calendar/regenerate", async (c) => {
    const user = await currentUser(c);
    refuseAdmin(user);
    return c.json({ url: feedUrl(c.req.url, await issueToken(c.env, user)), subscribed_at: null });
  });
}
