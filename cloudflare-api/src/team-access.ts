import type { Context } from "hono";
import { ApiProblem, assertNotExpired, bearerSubject, currentUser, liveSession, nowIso } from "./helpers";
import type { UserRow } from "./types";

const NO_LINK = "Ask an AIMZ administrator to link your account to a squad player.";
const NO_SQUAD = "Ask an AIMZ administrator to assign a squad to your account.";

/**
 * What an account may see, as a list of squad ids — or `null` for everything.
 *
 * `null` means unrestricted, and only an administrator gets it. Every other
 * role resolves to the squads it is actually attached to:
 *
 *     player   → users.player_id  → that player's squad
 *     parent   → user_children    → each child's squad
 *     coach  → user_teams       → each squad assigned to them
 *
 * Everything else in this file is built on that one answer, so a route that
 * scopes itself through here cannot be talked out of it by a query string.
 */
export type TeamScope = string[] | null;

/** The roster players an account speaks for: one for a player, several for a parent. */
export async function linkedPlayerIds(env: Env, user: UserRow): Promise<string[]> {
  if (user.role === "parent") {
    const result = await env.DB.prepare("SELECT player_id FROM user_children WHERE user_id=?").bind(user.id).all<{ player_id: string }>();
    const ids = result.results.map((row) => row.player_id);
    if (!ids.length) throw new ApiProblem(403, "player_link_required", NO_LINK);
    return ids;
  }
  if (!user.player_id) throw new ApiProblem(403, "player_link_required", NO_LINK);
  return [user.player_id];
}

/** The squads assigned to a coach. */
export async function managedTeamIds(env: Env, user: UserRow): Promise<string[]> {
  const result = await env.DB.prepare("SELECT team_id FROM user_teams WHERE user_id=?").bind(user.id).all<{ team_id: string }>();
  const ids = result.results.map((row) => row.team_id);
  if (!ids.length) throw new ApiProblem(403, "team_assignment_required", NO_SQUAD);
  return ids;
}

/**
 * The squads an account may open. A parent with children on two squads gets
 * both, which is why this is a list rather than the single id it started as.
 */
export async function linkedTeamIds(env: Env, user: UserRow): Promise<string[]> {
  if (user.role === "coach") return managedTeamIds(env, user);
  const playerIds = await linkedPlayerIds(env, user);
  const placeholders = playerIds.map(() => "?").join(",");
  const result = await env.DB.prepare(`SELECT DISTINCT team_id FROM players WHERE id IN (${placeholders})`).bind(...playerIds).all<{ team_id: string }>();
  const teamIds = result.results.map((row) => row.team_id);
  if (!teamIds.length) throw new ApiProblem(403, "player_link_required", "Your linked player is no longer on the roster. Ask an AIMZ administrator for help.");
  return teamIds;
}

async function linkedTeamId(env: Env, user: UserRow): Promise<string> {
  const [teamId] = await linkedTeamIds(env, user);
  return teamId!;
}

/** The scope for an account: `null` for an administrator, their squads otherwise. */
async function teamScope(env: Env, user: UserRow): Promise<TeamScope> {
  if (user.role === "admin") return null;
  return linkedTeamIds(env, user);
}

/**
 * The same scope, but empty rather than refused when an account is attached to
 * nothing yet.
 *
 * For places that describe an account rather than guard a resource — the
 * navigation the app draws from `/users/me`, which has to render something for
 * a coach whose squads have not been assigned yet.
 */
export async function quietTeamScope(env: Env, user: UserRow): Promise<TeamScope> {
  try {
    return await teamScope(env, user);
  } catch {
    return [];
  }
}

/**
 * The scope for the caller of a list, resolving the session on the way.
 *
 * Quiet rather than loud: an account waiting to be linked to a player, or a
 * coach waiting to be given a squad, gets empty lists and the app's own
 * empty states. A 403 on the opening screen reads as a broken app rather than
 * as an account that is not finished. The guards on individual resources stay
 * loud, because there the caller has named something specific.
 */
export async function callerScope(c: Context<{ Bindings: Env }>): Promise<{ scope: TeamScope; user: UserRow }> {
  // One statement rather than two. Every list endpoint that scopes itself
  // through here got half its authorisation round trips back for free.
  const caller = await scopedCaller(c);
  return { scope: quietScopeOf(caller), user: caller.user };
}

/** True when the account may open this squad, which an administrator always may. */
export async function canOpenTeam(env: Env, user: UserRow, teamId: string): Promise<boolean> {
  const scope = await teamScope(env, user);
  return scope === null || scope.includes(teamId);
}

/**
 * Resolves a team filter to the squads the caller may actually see. An
 * administrator gets what they asked for; anyone else is held to their own.
 */
export async function scopedTeams(c: Context<{ Bindings: Env }>, requested: string | null): Promise<{ teamIds: string[] | null; user: UserRow }> {
  const { scope, user } = await callerScope(c);
  if (scope === null) return { teamIds: requested ? [requested] : null, user };
  if (requested) {
    if (!scope.includes(requested)) throw new ApiProblem(403, "team_access_denied", "You can only open your own squad's team hub.");
    return { teamIds: [requested], user };
  }
  return { teamIds: scope, user };
}

export async function requireAimzTeam(env: Env, teamId: string): Promise<void> {
  const team = await env.DB.prepare("SELECT id FROM teams WHERE id=? AND is_aimz=1").bind(teamId).first();
  if (!team) throw new ApiProblem(422, "team_not_found", "Choose an AIMZ squad.");
}

/* ------------------------------------------------------------------------ *
 *  Turning a scope into SQL
 *
 *  Every scoped list route builds its WHERE clause through these two, so the
 *  rule lives in one place and reads the same at each call site. A scope of
 *  `null` contributes nothing, which is how an administrator's query stays
 *  exactly the query it was.
 * ------------------------------------------------------------------------ */

/**
 * `column IN (?, ?)` and its values, or null when the scope is unrestricted.
 *
 * An empty scope is a real answer, not a missing one — an account attached to
 * nothing yet — and `IN ()` is not SQL, so it becomes a condition that matches
 * nothing instead.
 */
export function scopeClause(scope: TeamScope, column: string): { sql: string; values: string[] } | null {
  if (scope === null) return null;
  if (!scope.length) return { sql: "0", values: [] };
  return { sql: `${column} IN (${scope.map(() => "?").join(",")})`, values: scope };
}

/**
 * The clause that decides whether a match is visible.
 *
 * One rule for every kind of fixture — league, cup, friendly, non-league —
 * because the question is only ever whether the authorised squad is one of the
 * two playing. Centralised here so a new competition format cannot arrive with
 * a visibility rule of its own.
 */
export function matchScopeClause(scope: TeamScope, alias = "m"): { sql: string; values: string[] } | null {
  if (scope === null) return null;
  if (!scope.length) return { sql: "0", values: [] };
  const placeholders = scope.map(() => "?").join(",");
  return {
    sql: `(${alias}.home_team_id IN (${placeholders}) OR ${alias}.away_team_id IN (${placeholders}))`,
    values: [...scope, ...scope],
  };
}

/**
 * One statement that answers everything the live-match poll needs to ask.
 *
 * The poll is the request the whole academy makes at once, and it used to
 * spend five sequential round trips — the account, the children, their
 * squads, the visibility check, then the match itself — before it could so
 * much as compare an ETag. Four fifths of those polls then answered "nothing
 * has changed". The questions have not changed; they are asked together.
 *
 * Every rule below is the one the general helpers apply, in the same order, so
 * the answers are identical:
 *
 *   - no row at all      → the account is missing or deactivated       (401)
 *   - past its expiry    → the account is out of time                  (401)
 *   - a coach with no squads, a parent with no children, a player with
 *     nobody linked, or a linked player no longer on a roster
 *                        → the same three 403s, with the same messages
 *   - the match is outside the scope, or does not exist
 *                        → not found, never "forbidden"                (404)
 *
 * The revision comes back with the verdict, so the caller can compare an ETag
 * *after* visibility is settled and never before. Returning a 304 to someone
 * who may not see the match would tell them when it was last scored, which is
 * exactly the thing the guard exists to withhold.
 *
 * Deliberately narrow: this serves one endpoint. The general helpers are
 * untouched and still guard everything else.
 */
export async function visibleMatchRevision(c: Context<{ Bindings: Env }>, matchId: string): Promise<number> {
  const { userId, familyId } = await bearerSubject(c);
  const row = await c.env.DB.prepare(`
    WITH me AS (
      SELECT u.id, u.role, u.player_id, ae.expires_at
      FROM users u LEFT JOIN account_expiry ae ON ae.user_id = u.id
      WHERE u.id = ?1 AND u.is_active = 1 AND ${liveSession("?3", "?4")}
    ),
    scope AS (
      -- A player answers for herself, a parent for each child, a coach for the
      -- squads assigned to her. An administrator is not scoped at all.
      SELECT p.team_id FROM me JOIN players p ON p.id = me.player_id WHERE me.role = 'player'
      UNION
      SELECT p.team_id FROM me
        JOIN user_children uc ON uc.user_id = me.id
        JOIN players p ON p.id = uc.player_id
        WHERE me.role = 'parent'
      UNION
      SELECT ut.team_id FROM me JOIN user_teams ut ON ut.user_id = me.id WHERE me.role = 'coach'
    )
    SELECT
      me.role, me.player_id, me.expires_at,
      (SELECT COUNT(*) FROM me JOIN user_children uc ON uc.user_id = me.id) AS children,
      (SELECT COUNT(*) FROM me JOIN user_teams ut ON ut.user_id = me.id)    AS squads,
      (SELECT COUNT(*) FROM scope)                                          AS scoped,
      m.revision AS revision,
      CASE
        WHEN m.id IS NULL THEN 0
        WHEN me.role = 'admin' THEN 1
        WHEN m.home_team_id IN (SELECT team_id FROM scope) THEN 1
        WHEN m.away_team_id IN (SELECT team_id FROM scope) THEN 1
        ELSE 0
      END AS visible
    FROM me LEFT JOIN matches m ON m.id = ?2
  `).bind(userId, matchId, familyId, nowIso()).first<{
    role: string; player_id: string | null; expires_at: string | null;
    children: number; squads: number; scoped: number;
    revision: number | null; visible: number;
  }>();

  // Missing, deactivated or signed out, exactly as `currentUser` answers it.
  if (!row) throw new ApiProblem(401, "invalid_token", "Your session has expired. Sign in again.");
  if (row.expires_at && row.expires_at <= nowIso()) {
    throw new ApiProblem(401, "account_expired", "This account has expired. Ask an AIMZ administrator to renew it.");
  }

  // Then the link, in the order the general helpers refuse it.
  if (row.role === "coach" && !row.squads) throw new ApiProblem(403, "team_assignment_required", NO_SQUAD);
  if (row.role === "parent" && !row.children) throw new ApiProblem(403, "player_link_required", NO_LINK);
  if (row.role === "player" && !row.player_id) throw new ApiProblem(403, "player_link_required", NO_LINK);
  if (row.role !== "admin" && row.role !== "coach" && !row.scoped) {
    throw new ApiProblem(403, "player_link_required", "Your linked player is no longer on the roster. Ask an AIMZ administrator for help.");
  }

  // And only then the match. Not found either way: a match outside the scope
  // must be indistinguishable from one that was never there.
  if (!row.visible || row.revision === null) throw new ApiProblem(404, "match_not_found", "Match not found.");
  return row.revision;
}

/**
 * Who is asking, what they may see, and — when a player is named — whether
 * they may see that player. One statement.
 *
 * The same five questions the helpers above answer one round trip at a time.
 * D1 executes each of them in a fraction of a millisecond and sits in another
 * continent, so the cost was never the work; it was asking four times and
 * waiting four times. Under a thousand concurrent readers those waits queued
 * until the database refused them outright — `D1 DB is overloaded. Requests
 * queued for too long.` — which is what this exists to stop.
 *
 * Nothing is cached and nothing is carried in a token: every request still
 * reads the live rows, so a deactivation, an expiry, a squad move or an
 * unassignment takes effect on the very next request, exactly as before.
 *
 * The raw counts come back alongside the resolved lists so the callers below
 * can raise the *same* refusals as `linkedPlayerIds`, `managedTeamIds` and
 * `linkedTeamIds` — a parent with no children and a parent whose children have
 * been taken off the roster are different failures, and both are preserved.
 */
export interface Caller {
  user: UserRow;
  /** The roster players this account speaks for. */
  playerIds: string[];
  /** The squads it may open. Empty for an administrator, who is not scoped. */
  teamIds: string[];
  /** Rows behind the links, so an empty list can be told from a missing one. */
  children: number;
  squads: number;
  /** Whether the player named in the call is visible. Null when none was. */
  playerVisible: boolean | null;
}

const split = (value: string | null): string[] => (value ? value.split(",").filter(Boolean) : []);

export async function scopedCaller(c: Context<{ Bindings: Env }>, playerId?: string): Promise<Caller> {
  const { userId, familyId } = await bearerSubject(c);
  const row = await c.env.DB.prepare(`
    WITH me AS (
      SELECT u.*, ae.expires_at AS account_expires_at
      FROM users u LEFT JOIN account_expiry ae ON ae.user_id = u.id
      WHERE u.id = ?1 AND u.is_active = 1 AND ${liveSession("?3", "?4")}
    ),
    scope AS (
      SELECT p.team_id AS team_id FROM me JOIN players p ON p.id = me.player_id WHERE me.role = 'player'
      UNION
      SELECT p.team_id FROM me
        JOIN user_children uc ON uc.user_id = me.id
        JOIN players p ON p.id = uc.player_id
        WHERE me.role = 'parent'
      UNION
      SELECT ut.team_id FROM me JOIN user_teams ut ON ut.user_id = me.id WHERE me.role = 'coach'
    )
    SELECT
      me.*,
      (SELECT group_concat(pid) FROM (
        SELECT me.player_id AS pid FROM me WHERE me.role <> 'parent' AND me.player_id IS NOT NULL
        UNION
        SELECT uc.player_id FROM me JOIN user_children uc ON uc.user_id = me.id WHERE me.role = 'parent'
      )) AS player_csv,
      (SELECT group_concat(team_id) FROM scope) AS team_csv,
      (SELECT COUNT(*) FROM me JOIN user_children uc ON uc.user_id = me.id) AS children,
      (SELECT COUNT(*) FROM me JOIN user_teams ut ON ut.user_id = me.id) AS squads,
      CASE
        WHEN ?2 IS NULL THEN NULL
        WHEN me.role = 'admin' THEN 1
        WHEN (SELECT p.team_id FROM players p WHERE p.id = ?2) IN (SELECT team_id FROM scope) THEN 1
        ELSE 0
      END AS player_visible
    FROM me
  `).bind(userId, playerId ?? null, familyId, nowIso()).first<Record<string, unknown>>();

  if (!row) throw new ApiProblem(401, "invalid_token", "Your session has expired. Sign in again.");
  const user = { ...row, expires_at: (row.account_expires_at as string | null) ?? null } as unknown as UserRow;
  assertNotExpired(user);
  return {
    user,
    playerIds: split(row.player_csv as string | null),
    teamIds: split(row.team_csv as string | null),
    children: Number(row.children ?? 0),
    squads: Number(row.squads ?? 0),
    playerVisible: row.player_visible === null || row.player_visible === undefined ? null : Boolean(row.player_visible),
  };
}

/** The roster players an account speaks for, refusing as `linkedPlayerIds` does. */
export function callerPlayerIds(caller: Caller): string[] {
  if (caller.user.role === "parent" && !caller.children) throw new ApiProblem(403, "player_link_required", NO_LINK);
  if (caller.user.role !== "parent" && !caller.user.player_id) throw new ApiProblem(403, "player_link_required", NO_LINK);
  return caller.playerIds;
}

/** The squads a coach runs, refusing as `managedTeamIds` does. */
export function callerSquadIds(caller: Caller): string[] {
  if (!caller.squads) throw new ApiProblem(403, "team_assignment_required", NO_SQUAD);
  return caller.teamIds;
}

/** The scope, refusing as `teamScope` does. Null for an administrator. */
export function callerScopeOf(caller: Caller): TeamScope {
  if (caller.user.role === "admin") return null;
  if (caller.user.role === "coach") return callerSquadIds(caller);
  callerPlayerIds(caller);
  if (!caller.teamIds.length) {
    throw new ApiProblem(403, "player_link_required", "Your linked player is no longer on the roster. Ask an AIMZ administrator for help.");
  }
  return caller.teamIds;
}

/** The scope as the navigation asks for it: empty rather than refused. */
export function quietScopeOf(caller: Caller): TeamScope {
  try { return callerScopeOf(caller); } catch { return []; }
}

/* ------------------------------------------------------------------------ *
 *  Guarding a single resource
 *
 *  A list can be filtered; a resource asked for by id has to be refused. Each
 *  of these answers 404 rather than 403 for a resource outside the scope, so
 *  the reply cannot be used to confirm that some other squad's match exists.
 * ------------------------------------------------------------------------ */

async function assertTeamVisible(env: Env, user: UserRow, teamId: string): Promise<void> {
  const scope = await teamScope(env, user);
  if (scope === null || scope.includes(teamId)) return;
  // An opponent club is visible to anyone whose squad has played or is due to
  // play them: their crest and name appear on the fixture either way, and a
  // match page cannot render without them.
  const clause = matchScopeClause(scope)!;
  const met = await env.DB.prepare(
    `SELECT 1 FROM matches m WHERE ${clause.sql} AND (m.home_team_id = ? OR m.away_team_id = ?) LIMIT 1`,
  ).bind(...clause.values, teamId, teamId).first();
  if (!met) throw new ApiProblem(404, "team_not_found", "Team not found.");
}

async function assertMatchVisible(env: Env, user: UserRow, matchId: string): Promise<void> {
  const scope = await teamScope(env, user);
  if (scope === null) return;
  const clause = matchScopeClause(scope)!;
  const visible = await env.DB.prepare(`SELECT 1 FROM matches m WHERE m.id = ? AND ${clause.sql} LIMIT 1`).bind(matchId, ...clause.values).first();
  if (!visible) throw new ApiProblem(404, "match_not_found", "Match not found.");
}

async function assertPlayerVisible(env: Env, user: UserRow, playerId: string): Promise<void> {
  const scope = await teamScope(env, user);
  if (scope === null) return;
  const clause = scopeClause(scope, "team_id")!;
  const visible = await env.DB.prepare(`SELECT 1 FROM players WHERE id = ? AND ${clause.sql} LIMIT 1`).bind(playerId, ...clause.values).first();
  if (!visible) throw new ApiProblem(404, "player_not_found", "Player not found.");
}

async function assertCompetitionVisible(env: Env, user: UserRow, competitionId: string): Promise<void> {
  const scope = await teamScope(env, user);
  if (scope === null) return;
  const ids = await visibleCompetitionIds(env, scope);
  if (!ids.includes(competitionId)) throw new ApiProblem(404, "competition_not_found", "Competition not found.");
}

/**
 * The competitions a scope may see: the ones its squads are entered in, plus
 * any their fixtures belong to.
 *
 * Both halves are needed. A squad is entered in a league through
 * `teams.competition_id`, but a friendly is a competition too and nobody is
 * entered in it — it exists only as the fixture's own competition row.
 */
export async function visibleCompetitionIds(env: Env, scope: TeamScope): Promise<string[]> {
  if (scope === null) throw new Error("visibleCompetitionIds is for a restricted scope");
  if (!scope.length) return [];
  const teams = scopeClause(scope, "id")!;
  const matches = matchScopeClause(scope)!;
  const [entered, played] = await Promise.all([
    env.DB.prepare(`SELECT DISTINCT competition_id id FROM teams WHERE ${teams.sql} AND competition_id IS NOT NULL`).bind(...teams.values).all<{ id: string }>(),
    env.DB.prepare(`SELECT DISTINCT m.competition_id id FROM matches m WHERE ${matches.sql}`).bind(...matches.values).all<{ id: string }>(),
  ]);
  return [...new Set([...entered.results, ...played.results].map((row) => row.id).filter((id): id is string => Boolean(id)))];
}

/* ------------------------------------------------------------------------ *
 *  Managing, as against looking
 * ------------------------------------------------------------------------ */

/**
 * An account that may change things: an administrator anywhere, a coach
 * within their own squads.
 *
 * Returns the scope alongside the user so a handler can say which squads the
 * change is allowed to touch without asking twice.
 */
export async function managingUser(c: Context<{ Bindings: Env }>): Promise<{ user: UserRow; scope: TeamScope }> {
  const user = await currentUser(c);
  if (user.role === "admin") return { user, scope: null };
  if (user.role === "coach") return { user, scope: await managedTeamIds(c.env, user) };
  throw new ApiProblem(403, "admin_required", "Administrator access is required.");
}

/** Refuses a write aimed at a squad the caller does not run. */
export function assertCanManageTeam(scope: TeamScope, teamId: string): void {
  if (scope === null || scope.includes(teamId)) return;
  throw new ApiProblem(403, "team_access_denied", "You can only manage your own squad.");
}

/** Refuses a coach an action that belongs to the academy rather than a squad. */
export function assertAdminOnly(user: UserRow, what: string): void {
  if (user.role === "admin") return;
  throw new ApiProblem(403, "admin_required", `${what} is managed by an AIMZ administrator.`);
}

/* ------------------------------------------------------------------------ *
 *  The guards as a route reaches them
 *
 *  One line at the top of a handler, resolving the session and refusing the
 *  request in the same step. Everything under an id goes through one of these
 *  so a hand-edited URL is answered the same way whichever route it names.
 * ------------------------------------------------------------------------ */

export async function guardTeam(c: Context<{ Bindings: Env }>, teamId: string): Promise<UserRow> {
  const user = await currentUser(c);
  await assertTeamVisible(c.env, user, teamId);
  return user;
}

export async function guardMatch(c: Context<{ Bindings: Env }>, matchId: string): Promise<UserRow> {
  const user = await currentUser(c);
  await assertMatchVisible(c.env, user, matchId);
  return user;
}

export async function guardPlayer(c: Context<{ Bindings: Env }>, playerId: string): Promise<UserRow> {
  // The account, its scope and whether this player is inside it, together.
  // Refuses exactly as the three separate reads did: 401 for an account that
  // is gone or out of time, the three 403s for one that is linked to nothing,
  // and 404 — never 403 — for a player outside the scope.
  const caller = await scopedCaller(c, playerId);
  const scope = callerScopeOf(caller);
  if (scope === null) return caller.user;
  if (!caller.playerVisible) throw new ApiProblem(404, "player_not_found", "Player not found.");
  return caller.user;
}

export async function guardCompetition(c: Context<{ Bindings: Env }>, competitionId: string): Promise<UserRow> {
  const user = await currentUser(c);
  await assertCompetitionVisible(c.env, user, competitionId);
  return user;
}

/**
 * The coach or administrator who may change this fixture.
 *
 * The same rule as seeing it — one of the two teams is theirs — so the clock,
 * the events, the lineup and the player statistics all answer alike, and a
 * coach cannot run somebody else's match by naming its id.
 */
export async function manageMatch(c: Context<{ Bindings: Env }>, matchId: string): Promise<UserRow> {
  const { user, scope } = await managingUser(c);
  if (scope === null) return user;
  const match = await c.env.DB.prepare("SELECT home_team_id, away_team_id FROM matches WHERE id = ?").bind(matchId).first<{ home_team_id: string; away_team_id: string }>();
  if (!match) throw new ApiProblem(404, "match_not_found", "Match not found.");
  if (!scope.includes(match.home_team_id) && !scope.includes(match.away_team_id)) {
    throw new ApiProblem(403, "team_access_denied", "You can only manage fixtures your own squad is playing in.");
  }
  return user;
}

/** The coach or administrator who may change this player's records. */
export async function managePlayer(c: Context<{ Bindings: Env }>, playerId: string): Promise<UserRow> {
  const { user, scope } = await managingUser(c);
  if (scope === null) return user;
  const player = await c.env.DB.prepare("SELECT team_id FROM players WHERE id = ?").bind(playerId).first<{ team_id: string }>();
  if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
  assertCanManageTeam(scope, player.team_id);
  return user;
}


/**
 * Who answers a request to correct a register.
 *
 * An administrator anywhere, or the coach of that player's squad — the same
 * pair who may mark the register in the first place, which is the point: a
 * correction is a change to the register, so it is decided by whoever could
 * have made that change directly.
 *
 * A player or parent reaches a 403 here. They raise requests; they do not
 * answer them, including their own.
 */
export async function decidesForPlayer(c: Context<{ Bindings: Env }>, playerId: string): Promise<UserRow> {
  const { user, scope } = await managingUser(c);
  if (scope === null) return user;
  const player = await c.env.DB.prepare("SELECT team_id FROM players WHERE id = ?").bind(playerId).first<{ team_id: string }>();
  if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
  assertCanManageTeam(scope, player.team_id);
  return user;
}

/**
 * Who may raise one: the family whose record it is.
 *
 * The other way round from `decidesForPlayer`, and deliberately closed to an
 * administrator and a coach — they change the register directly, and a
 * request from the person who would approve it is a round trip with nobody
 * else in it.
 */
export async function requestsForPlayer(c: Context<{ Bindings: Env }>, playerId: string): Promise<UserRow> {
  const user = await currentUser(c);
  if (user.role === "admin" || user.role === "coach") {
    throw new ApiProblem(403, "mark_directly", "You can change this register yourself rather than requesting a change.");
  }
  if (!(await linkedPlayerIds(c.env, user)).includes(playerId)) {
    throw new ApiProblem(403, "player_access_denied", "You can only ask about your own family's attendance.");
  }
  return user;
}

/**
 * Who may read a player's personal details and their money.
 *
 * A different question from every other guard in this file, and deliberately
 * not built on `teamScope`: squad scope is about who may look at a squad's
 * football, and a child's birth date, her emergency contacts and what her
 * family owes are not that.
 *
 *     admin   → any player in the academy
 *     player  → herself, and nobody else
 *     parent  → her own children
 *     coach → nobody, including on her own squad
 *
 * A coach runs a squad's football. She picks the team, takes the register
 * and marks training; none of that needs a family's phone number or what they
 * have paid, and holding them is a liability rather than a convenience.
 */
export async function guardPersonalData(c: Context<{ Bindings: Env }>, playerId: string): Promise<UserRow> {
  const user = await currentUser(c);
  if (user.role === "admin") return user;
  if (user.role === "coach") {
    throw new ApiProblem(403, "personal_data_denied", "Personal details and fees are not part of squad management.");
  }
  // A player and a parent arrive the same way: through the roster records their
  // account speaks for.
  if (!(await linkedPlayerIds(c.env, user)).includes(playerId)) {
    throw new ApiProblem(403, "player_access_denied", "You can only open your own family's details.");
  }
  return user;
}
