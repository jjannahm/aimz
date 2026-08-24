import type { Context } from "hono";
import { ApiProblem, currentUser } from "./helpers";
import type { UserRow } from "./types";

export async function linkedTeamId(env: Env, user: UserRow): Promise<string> {
  if (!user.player_id) throw new ApiProblem(403, "player_link_required", "Ask an AIMZ administrator to link your account to a squad player.");
  const player = await env.DB.prepare("SELECT team_id FROM players WHERE id=?").bind(user.player_id).first<{ team_id: string }>();
  if (!player) throw new ApiProblem(403, "player_link_required", "Your linked player is no longer on the roster. Ask an AIMZ administrator for help.");
  return player.team_id;
}

export async function scopedTeam(c: Context<{ Bindings: Env }>, requested: string | null): Promise<{ teamId: string | null; user: UserRow }> {
  const user = await currentUser(c);
  if (user.role === "admin") return { teamId: requested, user };
  const teamId = await linkedTeamId(c.env, user);
  if (requested && requested !== teamId) throw new ApiProblem(403, "team_access_denied", "You can only open your own squad's team hub.");
  return { teamId, user };
}

export async function requireAimzTeam(env: Env, teamId: string): Promise<void> {
  const team = await env.DB.prepare("SELECT id FROM teams WHERE id=? AND is_aimz=1").bind(teamId).first();
  if (!team) throw new ApiProblem(422, "team_not_found", "Choose an AIMZ squad.");
}
