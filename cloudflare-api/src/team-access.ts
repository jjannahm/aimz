import type { Context } from "hono";
import { ApiProblem, currentUser } from "./helpers";
import type { UserRow } from "./types";

const NO_LINK = "Ask an AIMZ administrator to link your account to a squad player.";

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

/**
 * The squads an account may open. A parent with children on two squads gets
 * both, which is why this is a list rather than the single id it started as.
 */
export async function linkedTeamIds(env: Env, user: UserRow): Promise<string[]> {
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

/** True when the account may open this squad, which an administrator always may. */
export async function canOpenTeam(env: Env, user: UserRow, teamId: string): Promise<boolean> {
  if (user.role === "admin") return true;
  return (await linkedTeamIds(env, user)).includes(teamId);
}

/**
 * Resolves a team filter to the squads the caller may actually see. An
 * administrator gets what they asked for; anyone else is held to their own.
 */
export async function scopedTeams(c: Context<{ Bindings: Env }>, requested: string | null): Promise<{ teamIds: string[] | null; user: UserRow }> {
  const user = await currentUser(c);
  if (user.role === "admin") return { teamIds: requested ? [requested] : null, user };
  const teamIds = await linkedTeamIds(c.env, user);
  if (requested) {
    if (!teamIds.includes(requested)) throw new ApiProblem(403, "team_access_denied", "You can only open your own squad's team hub.");
    return { teamIds: [requested], user };
  }
  return { teamIds, user };
}

export async function requireAimzTeam(env: Env, teamId: string): Promise<void> {
  const team = await env.DB.prepare("SELECT id FROM teams WHERE id=? AND is_aimz=1").bind(teamId).first();
  if (!team) throw new ApiProblem(422, "team_not_found", "Choose an AIMZ squad.");
}
