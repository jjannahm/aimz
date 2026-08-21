import type { Context, Hono } from "hono";
import {
  ApiProblem,
  adminUser,
  booleanField,
  enumField,
  jsonObject,
  nowIso,
  numberField,
  parsePagination,
  publicCompetition,
  publicMatch,
  publicPlayer,
  publicTeam,
  stringField,
} from "./helpers";
import type { CompetitionRow, MatchRow, MatchStatus, PlayerRow, TeamRow } from "./types";
import { MatchPhaseTransitionError, transitionLegacyStatus } from "./match-clock";

type App = Hono<{ Bindings: Env }>;

interface JoinedMatchRow extends MatchRow {
  home_name: string;
  home_squad_code: string | null;
  home_age_group: string | null;
  home_season: string | null;
  home_is_aimz: number;
  home_is_active: number;
  home_logo_key: string | null;
  home_coach: string | null;
  home_assistant_coach: string | null;
  home_created_at: string;
  home_updated_at: string;
  away_name: string;
  away_squad_code: string | null;
  away_age_group: string | null;
  away_season: string | null;
  away_is_aimz: number;
  away_is_active: number;
  away_logo_key: string | null;
  away_coach: string | null;
  away_assistant_coach: string | null;
  away_created_at: string;
  away_updated_at: string;
  competition_name: string;
  competition_season: string;
  competition_type: "league" | "tournament" | "friendly";
  competition_created_at: string;
  competition_updated_at: string;
}

const matchSelect = `
  SELECT m.*,
    h.name home_name, h.squad_code home_squad_code, h.age_group home_age_group,
    h.season home_season, h.is_aimz home_is_aimz, h.is_active home_is_active,
    h.logo_key home_logo_key, h.coach home_coach, h.assistant_coach home_assistant_coach,
    h.created_at home_created_at, h.updated_at home_updated_at,
    a.name away_name, a.squad_code away_squad_code, a.age_group away_age_group,
    a.season away_season, a.is_aimz away_is_aimz, a.is_active away_is_active,
    a.logo_key away_logo_key, a.coach away_coach, a.assistant_coach away_assistant_coach,
    a.created_at away_created_at, a.updated_at away_updated_at,
    c.name competition_name, c.season competition_season, c.type competition_type,
    c.created_at competition_created_at, c.updated_at competition_updated_at
  FROM matches m
  JOIN teams h ON h.id = m.home_team_id
  JOIN teams a ON a.id = m.away_team_id
  JOIN competitions c ON c.id = m.competition_id`;

export function joinedMatch(row: JoinedMatchRow): Record<string, unknown> {
  const home: TeamRow = {
    id: row.home_team_id, name: row.home_name, squad_code: row.home_squad_code,
    age_group: row.home_age_group, season: row.home_season, is_aimz: row.home_is_aimz,
    is_active: row.home_is_active, logo_key: row.home_logo_key,
    coach: row.home_coach, assistant_coach: row.home_assistant_coach, competition_id: null,
    created_at: row.home_created_at, updated_at: row.home_updated_at,
  };
  const away: TeamRow = {
    id: row.away_team_id, name: row.away_name, squad_code: row.away_squad_code,
    age_group: row.away_age_group, season: row.away_season, is_aimz: row.away_is_aimz,
    is_active: row.away_is_active, logo_key: row.away_logo_key,
    coach: row.away_coach, assistant_coach: row.away_assistant_coach, competition_id: null,
    created_at: row.away_created_at, updated_at: row.away_updated_at,
  };
  const competition: CompetitionRow = {
    id: row.competition_id, name: row.competition_name, season: row.competition_season,
    type: row.competition_type, created_at: row.competition_created_at,
    updated_at: row.competition_updated_at,
  };
  return publicMatch(row, home, away, competition);
}

export async function getJoinedMatch(env: Env, id: string): Promise<JoinedMatchRow> {
  const row = await env.DB.prepare(`${matchSelect} WHERE m.id = ?`).bind(id).first<JoinedMatchRow>();
  if (!row) throw new ApiProblem(404, "match_not_found", "Match not found.");
  return row;
}

function countValue(row: { total: number } | null): number {
  return row?.total ?? 0;
}

export function registerDomainRoutes(app: App): void {
  app.get("/api/v1/teams", async (c) => {
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const conditions: string[] = [];
    const values: unknown[] = [];
    const active = url.searchParams.get("active");
    if (active === "true" || active === "false") { conditions.push("is_active = ?"); values.push(active === "true" ? 1 : 0); }
    const isAimz = url.searchParams.get("is_aimz");
    if (isAimz === "true" || isAimz === "false") { conditions.push("is_aimz = ?"); values.push(isAimz === "true" ? 1 : 0); }
    const season = url.searchParams.get("season");
    if (season) { conditions.push("season = ?"); values.push(season); }
    const search = url.searchParams.get("search");
    if (search) { conditions.push("name LIKE ?"); values.push(`%${search}%`); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM teams${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT * FROM teams${where} ORDER BY is_aimz DESC, name ASC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<TeamRow>(),
    ]);
    return c.json({ items: rows.results.map(publicTeam), total: countValue(count), limit, offset });
  });

  app.post("/api/v1/teams", async (c) => {
    await adminUser(c);
    const body = await jsonObject(c);
    const now = nowIso();
    const team: TeamRow = {
      id: crypto.randomUUID(), name: stringField(body, "name", { min: 2, max: 160 })!,
      squad_code: stringField(body, "squad_code", { optional: true, nullable: true, max: 40 }) ?? null,
      age_group: stringField(body, "age_group", { optional: true, nullable: true, max: 40 }) ?? null,
      season: stringField(body, "season", { optional: true, nullable: true, max: 40 }) ?? null,
      is_aimz: booleanField(body, "is_aimz", false) ? 1 : 0,
      is_active: booleanField(body, "is_active", true) ? 1 : 0,
      logo_key: stringField(body, "logo_key", { optional: true, nullable: true, max: 512 }) ?? null,
      coach: stringField(body, "coach", { optional: true, nullable: true, max: 160 }) ?? null,
      assistant_coach: stringField(body, "assistant_coach", { optional: true, nullable: true, max: 160 }) ?? null,
      competition_id: stringField(body, "competition_id", { optional: true, nullable: true, max: 36 }) ?? null,
      created_at: now, updated_at: now,
    };
    await c.env.DB.prepare("INSERT INTO teams (id, name, squad_code, age_group, season, is_aimz, is_active, logo_key, coach, assistant_coach, competition_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(team.id, team.name, team.squad_code, team.age_group, team.season, team.is_aimz, team.is_active, team.logo_key, team.coach, team.assistant_coach, team.competition_id, now, now).run();
    return c.json(publicTeam(team), 201);
  });

  app.patch("/api/v1/teams/:id", async (c) => {
    await adminUser(c);
    const body = await jsonObject(c);
    const current = await c.env.DB.prepare("SELECT * FROM teams WHERE id = ?").bind(c.req.param("id")).first<TeamRow>();
    if (!current) throw new ApiProblem(404, "team_not_found", "Team not found.");
    const team: TeamRow = {
      ...current,
      name: stringField(body, "name", { optional: true, min: 2, max: 160 }) ?? current.name,
      squad_code: optionalNullableText(body, "squad_code", current.squad_code, 40),
      age_group: optionalNullableText(body, "age_group", current.age_group, 40),
      season: optionalNullableText(body, "season", current.season, 40),
      logo_key: optionalNullableText(body, "logo_key", current.logo_key, 512),
      coach: optionalNullableText(body, "coach", current.coach, 160),
      assistant_coach: optionalNullableText(body, "assistant_coach", current.assistant_coach, 160),
      competition_id: optionalNullableText(body, "competition_id", current.competition_id, 36),
      is_aimz: typeof body.is_aimz === "boolean" ? (body.is_aimz ? 1 : 0) : current.is_aimz,
      is_active: typeof body.is_active === "boolean" ? (body.is_active ? 1 : 0) : current.is_active,
      updated_at: nowIso(),
    };
    await c.env.DB.prepare("UPDATE teams SET name=?, squad_code=?, age_group=?, season=?, is_aimz=?, is_active=?, logo_key=?, coach=?, assistant_coach=?, competition_id=?, updated_at=? WHERE id=?").bind(team.name, team.squad_code, team.age_group, team.season, team.is_aimz, team.is_active, team.logo_key, team.coach, team.assistant_coach, team.competition_id, team.updated_at, team.id).run();
    return c.json(publicTeam(team));
  });
  app.delete("/api/v1/teams/:id", async (c) => deleteRestricted(c, "teams", "team", c.req.param("id")));

  app.get("/api/v1/competitions", async (c) => {
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const conditions: string[] = [];
    const values: unknown[] = [];
    for (const field of ["season", "type"] as const) {
      const value = url.searchParams.get(field); if (value) { conditions.push(`${field} = ?`); values.push(value); }
    }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM competitions${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT * FROM competitions${where} ORDER BY season DESC, name ASC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<CompetitionRow>(),
    ]);
    return c.json({ items: rows.results.map(publicCompetition), total: countValue(count), limit, offset });
  });
  app.post("/api/v1/competitions", async (c) => {
    await adminUser(c); const body = await jsonObject(c); const now = nowIso();
    const competition: CompetitionRow = { id: crypto.randomUUID(), name: stringField(body, "name", { min: 2, max: 160 })!, season: stringField(body, "season", { min: 2, max: 40 })!, type: enumField(body, "type", ["league", "tournament", "friendly"] as const), created_at: now, updated_at: now };
    try { await c.env.DB.prepare("INSERT INTO competitions (id, name, season, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(competition.id, competition.name, competition.season, competition.type, now, now).run(); }
    catch { throw new ApiProblem(409, "competition_exists", "A competition with that name and season already exists."); }
    return c.json(publicCompetition(competition), 201);
  });
  app.patch("/api/v1/competitions/:id", async (c) => {
    await adminUser(c); const body = await jsonObject(c);
    const current = await c.env.DB.prepare("SELECT * FROM competitions WHERE id = ?").bind(c.req.param("id")).first<CompetitionRow>();
    if (!current) throw new ApiProblem(404, "competition_not_found", "Competition not found.");
    const item: CompetitionRow = { ...current, name: stringField(body, "name", { optional: true, min: 2, max: 160 }) ?? current.name, season: stringField(body, "season", { optional: true, min: 2, max: 40 }) ?? current.season, type: body.type === undefined ? current.type : enumField(body, "type", ["league", "tournament", "friendly"] as const), updated_at: nowIso() };
    try { await c.env.DB.prepare("UPDATE competitions SET name=?, season=?, type=?, updated_at=? WHERE id=?").bind(item.name, item.season, item.type, item.updated_at, item.id).run(); }
    catch { throw new ApiProblem(409, "competition_exists", "A competition with that name and season already exists."); }
    return c.json(publicCompetition(item));
  });
  app.delete("/api/v1/competitions/:id", async (c) => deleteRestricted(c, "competitions", "competition", c.req.param("id")));

  app.get("/api/v1/players", async (c) => {
    const url = new URL(c.req.url); const { limit, offset } = parsePagination(url);
    const conditions: string[] = []; const values: unknown[] = [];
    const teamId = url.searchParams.get("team_id"); if (teamId) { conditions.push("team_id = ?"); values.push(teamId); }
    const active = url.searchParams.get("active"); if (active === "true" || active === "false") { conditions.push("is_active = ?"); values.push(active === "true" ? 1 : 0); }
    const search = url.searchParams.get("search"); if (search) { conditions.push("name LIKE ?"); values.push(`%${search}%`); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM players${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT * FROM players${where} ORDER BY name ASC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<PlayerRow>(),
    ]);
    return c.json({ items: rows.results.map(publicPlayer), total: countValue(count), limit, offset });
  });
  app.post("/api/v1/players", async (c) => {
    await adminUser(c); const body = await jsonObject(c); const now = nowIso();
    const player: PlayerRow = { id: crypto.randomUUID(), name: stringField(body, "name", { min: 2, max: 160 })!, team_id: stringField(body, "team_id", { min: 1, max: 36 })!, position: stringField(body, "position", { min: 1, max: 60 })!, jersey_number: numberField(body, "jersey_number", { optional: true, nullable: true, min: 0, max: 99 }) ?? null, photo_key: stringField(body, "photo_key", { optional: true, nullable: true, max: 512 }) ?? null, is_active: booleanField(body, "is_active", true) ? 1 : 0, created_at: now, updated_at: now };
    await requireTeam(c.env, player.team_id);
    try { await c.env.DB.prepare("INSERT INTO players (id, name, team_id, position, jersey_number, photo_key, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(player.id, player.name, player.team_id, player.position, player.jersey_number, player.photo_key, player.is_active, now, now).run(); }
    catch { throw new ApiProblem(409, "jersey_conflict", "That jersey number is already used by this team."); }
    return c.json(publicPlayer(player), 201);
  });
  app.patch("/api/v1/players/:id", async (c) => {
    await adminUser(c); const body = await jsonObject(c);
    const current = await c.env.DB.prepare("SELECT * FROM players WHERE id = ?").bind(c.req.param("id")).first<PlayerRow>(); if (!current) throw new ApiProblem(404, "player_not_found", "Player not found.");
    const teamId = stringField(body, "team_id", { optional: true, min: 1, max: 36 }) ?? current.team_id; await requireTeam(c.env, teamId);
    const player: PlayerRow = { ...current, name: stringField(body, "name", { optional: true, min: 2, max: 160 }) ?? current.name, team_id: teamId, position: stringField(body, "position", { optional: true, min: 1, max: 60 }) ?? current.position, jersey_number: body.jersey_number === undefined ? current.jersey_number : numberField(body, "jersey_number", { nullable: true, min: 0, max: 99 }) ?? null, photo_key: optionalNullableText(body, "photo_key", current.photo_key, 512), is_active: typeof body.is_active === "boolean" ? (body.is_active ? 1 : 0) : current.is_active, updated_at: nowIso() };
    try { await c.env.DB.prepare("UPDATE players SET name=?, team_id=?, position=?, jersey_number=?, photo_key=?, is_active=?, updated_at=? WHERE id=?").bind(player.name, player.team_id, player.position, player.jersey_number, player.photo_key, player.is_active, player.updated_at, player.id).run(); }
    catch { throw new ApiProblem(409, "jersey_conflict", "That jersey number is already used by this team."); }
    return c.json(publicPlayer(player));
  });
  app.delete("/api/v1/players/:id", async (c) => deleteRestricted(c, "players", "player", c.req.param("id")));

  app.get("/api/v1/matches", async (c) => {
    const url = new URL(c.req.url); const { limit, offset } = parsePagination(url); const conditions: string[] = []; const values: unknown[] = [];
    const status = url.searchParams.get("match_status") ?? url.searchParams.get("status"); if (status) { conditions.push("m.status = ?"); values.push(status); }
    const competition = url.searchParams.get("competition_id"); if (competition) { conditions.push("m.competition_id = ?"); values.push(competition); }
    const team = url.searchParams.get("team_id"); if (team) { conditions.push("(m.home_team_id = ? OR m.away_team_id = ?)"); values.push(team, team); }
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM matches m${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`${matchSelect}${where} ORDER BY m.kickoff_datetime DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<JoinedMatchRow>(),
    ]);
    return c.json({ items: rows.results.map(joinedMatch), total: countValue(count), limit, offset });
  });
  app.post("/api/v1/matches", async (c) => {
    await adminUser(c); const body = await jsonObject(c); const match = await matchInput(c.env, body);
    const now = nowIso();
    const clock = match.status === "live"
      ? { status: "live" as const, phase: "first_half" as const, phase_started_at: now }
      : match.status === "finished"
        ? { status: "finished" as const, phase: "finished" as const, phase_started_at: null }
        : { status: "scheduled" as const, phase: "not_started" as const, phase_started_at: null };
    // Man of the match is set through its own endpoint once the match finishes,
    // so it is never written here or by the generic PATCH below.
    const row: MatchRow = { id: crypto.randomUUID(), ...match, ...clock, home_score: 0, away_score: 0, revision: 0, man_of_the_match_player_id: null, created_at: now, updated_at: now };
    await c.env.DB.prepare("INSERT INTO matches (id, competition_id, home_team_id, away_team_id, kickoff_datetime, venue, status, phase, phase_started_at, home_score, away_score, revision, half_length_minutes, num_halves, half_time_break_minutes, has_extra_time, extra_time_half_length_minutes, lineup_format, formation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.competition_id, row.home_team_id, row.away_team_id, row.kickoff_datetime, row.venue, row.status, row.phase, row.phase_started_at, row.half_length_minutes, row.num_halves, row.half_time_break_minutes, row.has_extra_time, row.extra_time_half_length_minutes, row.lineup_format, row.formation, now, now).run();
    return c.json(joinedMatch(await getJoinedMatch(c.env, row.id)), 201);
  });
  app.patch("/api/v1/matches/:id", async (c) => {
    await adminUser(c); const body = await jsonObject(c); const current = await getJoinedMatch(c.env, c.req.param("id"));
    // SQLite stores a flag as 0 or 1, but the input rules demand a real boolean.
    // Merging the stored row in raw therefore failed validation on any patch
    // that left the flag alone — a lineup save, which patches only the format,
    // came back "Check the highlighted fields" after saving perfectly well.
    const merged = { ...current, has_extra_time: current.has_extra_time === 1, ...body };
    const input = await matchInput(c.env, merged); const updated = nowIso();
    let clock;
    try { clock = transitionLegacyStatus(current, input.status, updated); }
    catch (error) {
      if (error instanceof MatchPhaseTransitionError) throw new ApiProblem(409, error.code, error.message);
      throw error;
    }
    await c.env.DB.prepare("UPDATE matches SET competition_id=?, home_team_id=?, away_team_id=?, kickoff_datetime=?, venue=?, status=?, phase=?, phase_started_at=?, half_length_minutes=?, num_halves=?, half_time_break_minutes=?, has_extra_time=?, extra_time_half_length_minutes=?, lineup_format=?, formation=?, revision=revision+1, updated_at=? WHERE id=?").bind(input.competition_id, input.home_team_id, input.away_team_id, input.kickoff_datetime, input.venue, clock.status, clock.phase, clock.phase_started_at, input.half_length_minutes, input.num_halves, input.half_time_break_minutes, input.has_extra_time, input.extra_time_half_length_minutes, input.lineup_format, input.formation, updated, current.id).run();
    return c.json(joinedMatch(await getJoinedMatch(c.env, current.id)));
  });
  app.delete("/api/v1/matches/:id", async (c) => {
    await adminUser(c); const result = await c.env.DB.prepare("DELETE FROM matches WHERE id = ?").bind(c.req.param("id")).run(); if (!result.meta.changes) throw new ApiProblem(404, "match_not_found", "Match not found."); return c.body(null, 204);
  });
}

const LINEUP_FORMATS = new Set([5, 6, 7, 9, 11]);

function lineupFormat(body: Record<string, unknown>): number | null {
  const value = numberField(body, "lineup_format", { optional: true, nullable: true });
  if (value === undefined || value === null) return null;
  if (!LINEUP_FORMATS.has(value)) throw new ApiProblem(422, "validation_error", "Format must be one of 5, 6, 7, 9, 11.");
  return value;
}

function formationFor(body: Record<string, unknown>, format: number | null): string | null {
  const value = stringField(body, "formation", { optional: true, nullable: true, max: 20 }) ?? null;
  if (value === null) return null;
  const parts = value.split("-");
  if (parts.length < 2 || !parts.every((part) => /^\d+$/u.test(part) && Number(part) > 0)) {
    throw new ApiProblem(422, "validation_error", "Formation must be digits separated by dashes, e.g. 4-4-2.");
  }
  // A 7-a-side shape cannot be played by an 11-a-side lineup.
  const outfield = parts.reduce((sum, part) => sum + Number(part), 0);
  if (format !== null && outfield !== format - 1) {
    throw new ApiProblem(422, "validation_error", `Formation ${value} covers ${outfield} outfield players, but ${format}-a-side needs ${format - 1}.`);
  }
  return value;
}

async function matchInput(env: Env, body: Record<string, unknown>): Promise<Pick<MatchRow, "competition_id" | "home_team_id" | "away_team_id" | "kickoff_datetime" | "venue" | "status" | "half_length_minutes" | "num_halves" | "half_time_break_minutes" | "has_extra_time" | "extra_time_half_length_minutes" | "lineup_format" | "formation">> {
  const competitionId = stringField(body, "competition_id", { min: 1, max: 36 })!;
  const homeTeamId = stringField(body, "home_team_id", { min: 1, max: 36 })!;
  const awayTeamId = stringField(body, "away_team_id", { min: 1, max: 36 })!;
  if (homeTeamId === awayTeamId) throw new ApiProblem(422, "validation_error", "Home and away teams must be different.");
  const kickoff = stringField(body, "kickoff_datetime", { min: 10, max: 64 })!;
  if (Number.isNaN(Date.parse(kickoff))) throw new ApiProblem(422, "validation_error", "Kickoff must be a valid date and time.");
  const status = enumField(body, "status", ["scheduled", "live", "finished"] as const, "scheduled") as MatchStatus;
  const format = lineupFormat(body);
  const [competition, home, away] = await env.DB.batch([
    env.DB.prepare("SELECT id FROM competitions WHERE id = ?").bind(competitionId),
    env.DB.prepare("SELECT id FROM teams WHERE id = ?").bind(homeTeamId),
    env.DB.prepare("SELECT id FROM teams WHERE id = ?").bind(awayTeamId),
  ]);
  if (!competition.results.length || !home.results.length || !away.results.length) throw new ApiProblem(422, "invalid_reference", "Choose valid teams and a competition.");
  return {
    competition_id: competitionId, home_team_id: homeTeamId, away_team_id: awayTeamId,
    kickoff_datetime: new Date(kickoff).toISOString(),
    venue: stringField(body, "venue", { min: 2, max: 200 })!, status,
    half_length_minutes: numberField(body, "half_length_minutes", { optional: true, min: 1, max: 90 }) ?? 45,
    num_halves: numberField(body, "num_halves", { optional: true, min: 1, max: 4 }) ?? 2,
    half_time_break_minutes: numberField(body, "half_time_break_minutes", { optional: true, min: 0, max: 30 }) ?? 15,
    has_extra_time: booleanField(body, "has_extra_time", false) ? 1 : 0,
    extra_time_half_length_minutes: numberField(body, "extra_time_half_length_minutes", { optional: true, min: 1, max: 30 }) ?? 15,
    lineup_format: format,
    formation: formationFor(body, format),
  };
}

async function requireTeam(env: Env, id: string): Promise<void> {
  if (!(await env.DB.prepare("SELECT id FROM teams WHERE id = ?").bind(id).first())) throw new ApiProblem(422, "invalid_team", "Choose a valid team.");
}

function optionalNullableText(body: Record<string, unknown>, field: string, current: string | null, max: number): string | null {
  if (!(field in body)) return current;
  return stringField(body, field, { nullable: true, max }) ?? null;
}

async function deleteRestricted(c: Context<{ Bindings: Env }>, table: "teams" | "competitions" | "players", label: string, id: string): Promise<Response> {
  await adminUser(c);
  try {
    const result = await c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    if (!result.meta.changes) throw new ApiProblem(404, `${label}_not_found`, `${label[0].toUpperCase()}${label.slice(1)} not found.`);
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    throw new ApiProblem(409, `${label}_in_use`, `This ${label} is referenced by other records. Archive it instead.`);
  }
  return c.body(null, 204);
}
