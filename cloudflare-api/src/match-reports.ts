import type { Hono } from "hono";
import { recordAudit } from "./audit";
import { getJoinedMatch } from "./domain";
import { ApiProblem, nowIso } from "./helpers";
import { minutesFromEvents, playedMinutes } from "./match-minutes";
import { newToken } from "./security";
import { guardMatch, manageMatch } from "./team-access";
import type { EventRow, LineupRow, MatchReportRow, StatRow } from "./types";

type App = Hono<{ Bindings: Env }>;

/**
 * What a match report says, as it stood when it was published.
 *
 * Every figure here is already recorded somewhere — the score on the match,
 * the scorers in the event thread, the minutes in the team sheet. Nothing new
 * is captured to write one, which is why a report can simply exist for a
 * finished match rather than having to be filled in.
 *
 * Deliberately neutral about the two sides. A match report names both teams'
 * scorers the way a real one does, and that also sidesteps the question of
 * whose report it is when both squads are ours.
 */
interface MatchReportSnapshot {
  /** Bumped when the shape changes, so an address already sent keeps rendering. */
  version: 1;
  match: {
    competition: string | null;
    kickoff: string;
    venue: string;
    home: string;
    away: string;
    home_score: number;
    away_score: number;
    formation: string | null;
    /** Null when the award went to the other side, or was never given. */
    man_of_the_match: string | null;
  };
  /** In the order they happened, with the assist where one is recorded. */
  goals: { minute: number | null; team: string; scorer: string | null; assist: string | null; penalty: boolean; own_goal: boolean }[];
  cards: { minute: number | null; team: string; player: string | null; colour: "yellow" | "red" }[];
  substitutions: { minute: number | null; team: string; on: string | null; off: string | null; reason: string | null }[];
  penalties_missed: { minute: number | null; team: string; player: string | null; outcome: string | null }[];
  /** One block per AIMZ squad that named a team sheet — usually one. */
  squads: {
    team: string;
    /** Who ran the squad that day. Either may be unnamed. */
    staff: { coach: string | null; assistant_coach: string | null };
    players: { name: string; jersey_number: number | null; position: string | null; started: boolean; captain: boolean; minutes: number; goals: number; assists: number; yellow_cards: number; red_cards: number }[];
  }[];
  generated_at: string;
}

/**
 * Who runs each squad, for the report's team heading.
 *
 * The coach account assigned to the squad is the first answer — it is a real
 * account, kept current by whoever manages the academy. The name typed on the
 * squad itself is the fallback, which is all an academy that never made coach
 * accounts has. Either may be missing, and the report says so rather than
 * inventing somebody.
 */
async function squadStaff(env: Env, teamIds: string[]): Promise<Map<string, { coach: string | null; assistant_coach: string | null }>> {
  const staff = new Map<string, { coach: string | null; assistant_coach: string | null }>();
  if (!teamIds.length) return staff;
  const placeholders = teamIds.map(() => "?").join(",");
  const [typed, accounts] = await Promise.all([
    env.DB.prepare(`SELECT id, coach, assistant_coach FROM teams WHERE id IN (${placeholders})`).bind(...teamIds).all<{ id: string; coach: string | null; assistant_coach: string | null }>(),
    env.DB.prepare(`SELECT ut.team_id, ut.staff_role, u.name FROM user_teams ut JOIN users u ON u.id = ut.user_id
      WHERE ut.team_id IN (${placeholders}) AND u.role = 'coach' ORDER BY u.name`).bind(...teamIds).all<{ team_id: string; staff_role: string; name: string }>(),
  ]);
  for (const row of typed.results) staff.set(row.id, { coach: row.coach, assistant_coach: row.assistant_coach });
  for (const row of accounts.results) {
    const held = staff.get(row.team_id) ?? { coach: null, assistant_coach: null };
    if (row.staff_role === "assistant_coach") held.assistant_coach = row.name;
    else held.coach = row.name;
    staff.set(row.team_id, held);
  }
  return staff;
}

/** Who the id belongs to, for every player named anywhere in this match. */
async function playerNames(env: Env, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await env.DB.prepare(`SELECT id, name FROM players WHERE id IN (${unique.map(() => "?").join(",")})`)
    .bind(...unique).all<{ id: string; name: string }>();
  return new Map(rows.results.map((row) => [row.id, row.name]));
}

/**
 * Everything the report says about the match, worked out now.
 *
 * The one place the figures are decided: the in-app summary reads this live
 * and publishing freezes exactly the same object, so what a parent opens and
 * what the coach saw before sending it cannot drift apart.
 */
async function buildMatchReport(env: Env, matchId: string): Promise<MatchReportSnapshot> {
  const match = await getJoinedMatch(env, matchId);
  const [events, lineup, stats] = await Promise.all([
    env.DB.prepare("SELECT * FROM match_events WHERE match_id=? ORDER BY CASE WHEN minute IS NULL THEN 1 ELSE 0 END, minute, created_at").bind(matchId).all<EventRow>(),
    env.DB.prepare("SELECT * FROM match_lineup_entries WHERE match_id=? ORDER BY is_starter DESC, jersey_number").bind(matchId).all<LineupRow>(),
    env.DB.prepare("SELECT * FROM player_match_stats WHERE match_id=?").bind(matchId).all<StatRow>(),
  ]);

  const named = await playerNames(env, [
    ...events.results.flatMap((event) => [event.player_id, event.secondary_player_id]),
    ...lineup.results.map((entry) => entry.player_id),
    match.man_of_the_match_player_id,
  ].filter((id): id is string => Boolean(id)));

  const sideName = (teamId: string) => teamId === match.home_team_id ? match.home_name : match.away_name;
  const who = (id: string | null) => id ? named.get(id) ?? null : null;

  const goals = events.results
    .filter((event) => event.type === "goal" || event.type === "own_goal")
    .map((event) => ({
      minute: event.minute, team: sideName(event.team_id), scorer: who(event.player_id),
      // An own goal's assist would be nonsense, and none is recorded for one.
      assist: event.type === "goal" ? who(event.secondary_player_id) : null,
      penalty: Boolean(event.is_penalty), own_goal: event.type === "own_goal",
    }));

  const cards = events.results
    .filter((event) => event.type === "yellow_card" || event.type === "red_card")
    .map((event) => ({
      minute: event.minute, team: sideName(event.team_id), player: who(event.player_id),
      colour: event.type === "yellow_card" ? "yellow" as const : "red" as const,
    }));

  const substitutions = events.results
    .filter((event) => event.type === "substitution")
    .map((event) => ({
      // `player_id` is who came on and `secondary_player_id` who came off,
      // the same way the live scoring screen writes them.
      minute: event.minute, team: sideName(event.team_id),
      on: who(event.player_id), off: who(event.secondary_player_id),
      reason: event.substitution_reason,
    }));

  const penalties_missed = events.results
    .filter((event) => event.type === "penalty_missed")
    .map((event) => ({ minute: event.minute, team: sideName(event.team_id), player: who(event.player_id), outcome: event.penalty_outcome }));

  // A team sheet exists only for our own squads, so this block is about us
  // however many of the two sides that turns out to be.
  const byTeam = new Map<string, LineupRow[]>();
  for (const entry of lineup.results) {
    const bucket = byTeam.get(entry.team_id);
    if (bucket) bucket.push(entry); else byTeam.set(entry.team_id, [entry]);
  }
  const statFor = new Map(stats.results.map((row) => [row.player_id, row]));
  // Worked out from the sheet and the thread rather than typed in, and for the
  // match's own length: an academy game of two twenty-minute halves is not
  // ninety minutes, and neither is a test match whose events land at minute 1.
  const played = minutesFromEvents(lineup.results, events.results, playedMinutes(match));
  const staffOf = await squadStaff(env, [...byTeam.keys()]);
  const squads = [...byTeam.entries()].map(([teamId, entries]) => ({
    team: sideName(teamId),
    staff: staffOf.get(teamId) ?? { coach: null, assistant_coach: null },
    players: entries.map((entry) => {
      const stat = statFor.get(entry.player_id);
      return {
        name: who(entry.player_id) ?? "Player",
        jersey_number: entry.jersey_number,
        position: entry.position,
        started: Boolean(entry.is_starter),
        captain: Boolean(entry.is_captain),
        // The sheet is the better answer where there is one. A match scored
        // without a lineup has only what was typed in, and keeps it.
        minutes: played.get(entry.player_id) ?? stat?.minutes_played ?? 0,
        goals: stat?.goals ?? 0,
        assists: stat?.assists ?? 0,
        yellow_cards: stat?.yellow_cards ?? 0,
        red_cards: stat?.red_cards ?? 0,
      };
    }),
  }));

  return {
    version: 1,
    match: {
      competition: match.competition_name ?? null,
      kickoff: match.kickoff_datetime,
      venue: match.venue,
      home: match.home_name,
      away: match.away_name,
      home_score: match.home_score,
      away_score: match.away_score,
      formation: match.formation,
      // The award can go to the other side, who have no player record here.
      man_of_the_match: match.man_of_the_match_is_opponent ? null : who(match.man_of_the_match_player_id),
    },
    goals, cards, substitutions, penalties_missed, squads,
    generated_at: nowIso(),
  };
}

async function reportFor(env: Env, matchId: string): Promise<MatchReportRow | null> {
  return env.DB.prepare("SELECT * FROM match_reports WHERE match_id=?").bind(matchId).first<MatchReportRow>();
}

/** What the app shows an administrator: the report, and where it stands. */
function publicMatchReport(matchId: string, snapshot: MatchReportSnapshot, row: MatchReportRow | null): Record<string, unknown> {
  return {
    match_id: matchId,
    snapshot,
    share_token: row?.share_token ?? null,
    published_at: row?.published_at ?? null,
    published_by_name: row?.published_by_name ?? null,
    first_opened_at: row?.first_opened_at ?? null,
  };
}

/**
 * What the link hands to whoever opens it.
 *
 * No ids of any kind, the same rule the player report keeps: the address is
 * already the credential, and a report forwarded on should not also carry the
 * keys to look anything else up. The snapshot holds names only by design.
 */
function sharedMatchReport(row: MatchReportRow): Record<string, unknown> {
  return {
    published_at: row.published_at,
    published_by_name: row.published_by_name,
    snapshot: JSON.parse(row.snapshot) as MatchReportSnapshot,
  };
}

export function registerMatchReportRoutes(app: App): void {
  /**
   * The link. Deliberately open, like the player report and the calendar
   * feed: the random token in the address is the whole of the credential.
   */
  app.get("/api/v1/match-reports/:token", async (c) => {
    const row = await c.env.DB.prepare("SELECT * FROM match_reports WHERE share_token = ?").bind(c.req.param("token")).first<MatchReportRow>();
    // One answer for a wrong address, a replaced one and a withdrawn report,
    // so the link cannot be used to find out which matches exist.
    if (!row) throw new ApiProblem(404, "match_report_not_found", "No match report matches this address.");
    if (!row.first_opened_at) {
      await c.env.DB.prepare("UPDATE match_reports SET first_opened_at=? WHERE id=? AND first_opened_at IS NULL").bind(nowIso(), row.id).run();
    }
    c.header("X-Robots-Tag", "noindex, nofollow");
    c.header("Cache-Control", "private, max-age=300");
    return c.json(sharedMatchReport(row));
  });

  /** The summary in the app, worked out fresh for whoever can see the match. */
  app.get("/api/v1/matches/:id/report", async (c) => {
    const id = c.req.param("id");
    await guardMatch(c, id);
    const snapshot = await buildMatchReport(c.env, id);
    return c.json(publicMatchReport(id, snapshot, await reportFor(c.env, id)));
  });

  /** Freezes the figures and mints the address the group will be given. */
  app.post("/api/v1/matches/:id/report/publish", async (c) => {
    const id = c.req.param("id");
    const actor = await manageMatch(c, id);
    const match = await getJoinedMatch(c.env, id);
    if (match.status !== "finished") throw new ApiProblem(409, "match_not_finished", "A match report can only be shared once the match has finished.");
    const snapshot = JSON.stringify(await buildMatchReport(c.env, id));
    const now = nowIso();
    const existing = await reportFor(c.env, id);
    const token = existing?.share_token ?? newToken();
    const summary = `${match.home_name} ${match.home_score}-${match.away_score} ${match.away_name}`;
    await c.env.DB.batch([
      existing
        // Publishing again re-freezes the figures on the address already sent,
        // which is how a corrected score reaches a link that is out there.
        ? c.env.DB.prepare("UPDATE match_reports SET snapshot=?, share_token=?, published_at=?, published_by_name=?, updated_at=? WHERE id=?")
          .bind(snapshot, token, now, actor.name, now, existing.id)
        : c.env.DB.prepare("INSERT INTO match_reports (id, match_id, snapshot, share_token, published_at, published_by_name, first_opened_at, created_at, updated_at) VALUES (?,?,?,?,?,?,NULL,?,?)")
          .bind(crypto.randomUUID(), id, snapshot, token, now, actor.name, now, now),
      recordAudit(c.env, actor, { action: "match_report_published", entityType: "match_report", entityId: id, matchId: id, summary }),
    ]);
    return c.json(publicMatchReport(id, JSON.parse(snapshot) as MatchReportSnapshot, await reportFor(c.env, id)));
  });

  /** A new address for the same report, which is how the old one is revoked. */
  app.post("/api/v1/matches/:id/report/new-link", async (c) => {
    const id = c.req.param("id");
    const actor = await manageMatch(c, id);
    const existing = await reportFor(c.env, id);
    if (!existing?.share_token) throw new ApiProblem(409, "match_report_not_published", "Share this match report before replacing its link.");
    const match = await getJoinedMatch(c.env, id);
    const summary = `${match.home_name} ${match.home_score}-${match.away_score} ${match.away_name}`;
    const token = newToken();
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE match_reports SET share_token=?, first_opened_at=NULL, updated_at=? WHERE id=?").bind(token, now, existing.id),
      recordAudit(c.env, actor, { action: "match_report_link_replaced", entityType: "match_report", entityId: id, matchId: id, summary }),
    ]);
    return c.json(publicMatchReport(id, JSON.parse(existing.snapshot) as MatchReportSnapshot, { ...existing, share_token: token, first_opened_at: null }));
  });

  /** Takes the link away. The report itself is rebuilt whenever it is asked for. */
  app.post("/api/v1/matches/:id/report/withdraw", async (c) => {
    const id = c.req.param("id");
    const actor = await manageMatch(c, id);
    const existing = await reportFor(c.env, id);
    if (!existing) throw new ApiProblem(404, "match_report_not_found", "This match has not been shared.");
    const match = await getJoinedMatch(c.env, id);
    const summary = `${match.home_name} ${match.home_score}-${match.away_score} ${match.away_name}`;
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM match_reports WHERE id=?").bind(existing.id),
      recordAudit(c.env, actor, { action: "match_report_withdrawn", entityType: "match_report", entityId: id, matchId: id, summary }),
    ]);
    return c.json(publicMatchReport(id, await buildMatchReport(c.env, id), null));
  });
}
