import type { Context } from "hono";
import { ApiProblem, currentUser } from "./helpers";
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

export async function linkedTeamId(env: Env, user: UserRow): Promise<string> {
  const [teamId] = await linkedTeamIds(env, user);
  return teamId!;
}

/** The scope for an account: `null` for an administrator, their squads otherwise. */
export async function teamScope(env: Env, user: UserRow): Promise<TeamScope> {
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
  const user = await currentUser(c);
  return { scope: await quietTeamScope(c.env, user), user };
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

/* ------------------------------------------------------------------------ *
 *  Guarding a single resource
 *
 *  A list can be filtered; a resource asked for by id has to be refused. Each
 *  of these answers 404 rather than 403 for a resource outside the scope, so
 *  the reply cannot be used to confirm that some other squad's match exists.
 * ------------------------------------------------------------------------ */

export async function assertTeamVisible(env: Env, user: UserRow, teamId: string): Promise<void> {
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

export async function assertMatchVisible(env: Env, user: UserRow, matchId: string): Promise<void> {
  const scope = await teamScope(env, user);
  if (scope === null) return;
  const clause = matchScopeClause(scope)!;
  const visible = await env.DB.prepare(`SELECT 1 FROM matches m WHERE m.id = ? AND ${clause.sql} LIMIT 1`).bind(matchId, ...clause.values).first();
  if (!visible) throw new ApiProblem(404, "match_not_found", "Match not found.");
}

export async function assertPlayerVisible(env: Env, user: UserRow, playerId: string): Promise<void> {
  const scope = await teamScope(env, user);
  if (scope === null) return;
  const clause = scopeClause(scope, "team_id")!;
  const visible = await env.DB.prepare(`SELECT 1 FROM players WHERE id = ? AND ${clause.sql} LIMIT 1`).bind(playerId, ...clause.values).first();
  if (!visible) throw new ApiProblem(404, "player_not_found", "Player not found.");
}

export async function assertCompetitionVisible(env: Env, user: UserRow, competitionId: string): Promise<void> {
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
  const user = await currentUser(c);
  await assertPlayerVisible(c.env, user, playerId);
  return user;
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

/** The coach or administrator who may change this training session. */
export async function manageTrainingSession(c: Context<{ Bindings: Env }>, sessionId: string): Promise<UserRow> {
  const { user, scope } = await managingUser(c);
  if (scope === null) return user;
  const session = await c.env.DB.prepare("SELECT team_id FROM training_sessions WHERE id = ?").bind(sessionId).first<{ team_id: string }>();
  if (!session) throw new ApiProblem(404, "training_session_not_found", "Training session not found.");
  assertCanManageTeam(scope, session.team_id);
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

/**
 * A write boundary for an administrator, or for staff assigned to this squad.
 *
 * Kept as its own name because training, announcements, reports and
 * assignments all ask this one question, and it reads better at those call
 * sites than the scope machinery it is built from.
 */
export async function requireTeamOperator(c: Context<{ Bindings: Env }>, teamId: string): Promise<UserRow> {
  const { user, scope } = await managingUser(c);
  await requireAimzTeam(c.env, teamId);
  assertCanManageTeam(scope, teamId);
  return user;
}
