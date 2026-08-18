import type { Context } from "hono";
import type { CompetitionRow, JsonObject, MatchRow, PlayerRow, TeamRow, UserRow } from "./types";
import { verifyAccessToken } from "./security";

export class ApiProblem extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 503,
    readonly code: string,
    message: string,
    readonly fieldErrors?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

export function errorResponse(c: Context, problem: ApiProblem): Response {
  return c.json(
    {
      detail: {
        code: problem.code,
        message: problem.message,
        ...(problem.fieldErrors ? { field_errors: problem.fieldErrors } : {}),
      },
    },
    problem.status,
  );
}

export async function jsonObject(c: Context): Promise<JsonObject> {
  try {
    const value: unknown = await c.req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value as JsonObject;
  } catch {
    throw new ApiProblem(422, "validation_error", "Request body must be a JSON object.");
  }
}

export async function jsonArray(c: Context): Promise<JsonObject[]> {
  try {
    const value: unknown = await c.req.json();
    if (!Array.isArray(value) || !value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      throw new Error("array required");
    }
    return value as JsonObject[];
  } catch {
    throw new ApiProblem(422, "validation_error", "Request body must be a JSON array.");
  }
}

export function stringField(
  body: JsonObject,
  field: string,
  options: { min?: number; max?: number; optional?: boolean; nullable?: boolean } = {},
): string | null | undefined {
  const value = body[field];
  if (value === undefined && options.optional) return undefined;
  if (value === null && options.nullable) return null;
  if (typeof value !== "string") throw validation(field, "Must be text.");
  const trimmed = value.trim();
  if (options.min !== undefined && trimmed.length < options.min) throw validation(field, `Must be at least ${options.min} characters.`);
  if (options.max !== undefined && trimmed.length > options.max) throw validation(field, `Must be at most ${options.max} characters.`);
  return trimmed;
}

export function numberField(
  body: JsonObject,
  field: string,
  options: { min?: number; max?: number; optional?: boolean; nullable?: boolean } = {},
): number | null | undefined {
  const value = body[field];
  if (value === undefined && options.optional) return undefined;
  if (value === null && options.nullable) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw validation(field, "Must be a number.");
  if (options.min !== undefined && value < options.min) throw validation(field, `Must be at least ${options.min}.`);
  if (options.max !== undefined && value > options.max) throw validation(field, `Must be at most ${options.max}.`);
  return value;
}

export function booleanField(body: JsonObject, field: string, fallback?: boolean): boolean {
  const value = body[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "boolean") throw validation(field, "Must be true or false.");
  return value;
}

export function enumField<T extends string>(body: JsonObject, field: string, values: readonly T[], fallback?: T): T {
  const value = body[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || !values.includes(value as T)) throw validation(field, `Must be one of: ${values.join(", ")}.`);
  return value as T;
}

function validation(field: string, message: string): ApiProblem {
  return new ApiProblem(422, "validation_error", "Check the highlighted fields.", [{ field, message }]);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parsePagination(url: URL): { limit: number; offset: number } {
  const rawLimit = Number(url.searchParams.get("limit") ?? 25);
  const rawOffset = Number(url.searchParams.get("offset") ?? 0);
  return {
    limit: Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 25,
    offset: Number.isInteger(rawOffset) ? Math.max(0, rawOffset) : 0,
  };
}

export function publicTeam(team: TeamRow | null): Record<string, unknown> | null {
  if (!team) return null;
  return {
    ...team,
    is_aimz: Boolean(team.is_aimz),
    is_active: Boolean(team.is_active),
    logo_url: null,
  };
}

export function publicCompetition(competition: CompetitionRow | null): Record<string, unknown> | null {
  return competition ? { ...competition } : null;
}

export function publicPlayer(player: PlayerRow | null): Record<string, unknown> | null {
  if (!player) return null;
  return { ...player, is_active: Boolean(player.is_active), photo_url: null };
}

export function publicMatch(
  match: MatchRow,
  homeTeam: TeamRow | null = null,
  awayTeam: TeamRow | null = null,
  competition: CompetitionRow | null = null,
): Record<string, unknown> {
  return {
    ...match,
    home_team: publicTeam(homeTeam),
    away_team: publicTeam(awayTeam),
    competition: publicCompetition(competition),
  };
}

export async function currentUser(c: Context<{ Bindings: Env }>): Promise<UserRow> {
  const authorization = c.req.header("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new ApiProblem(401, "authentication_required", "Sign in to continue.");
  const payload = await verifyAccessToken(authorization.slice(7), c.env.JWT_SECRET);
  if (!payload) throw new ApiProblem(401, "invalid_token", "Your session has expired. Sign in again.");
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").bind(payload.sub).first<UserRow>();
  if (!user) throw new ApiProblem(401, "invalid_token", "Your account is unavailable.");
  return user;
}

export async function adminUser(c: Context<{ Bindings: Env }>): Promise<UserRow> {
  const user = await currentUser(c);
  if (user.role !== "admin") throw new ApiProblem(403, "admin_required", "Administrator access is required.");
  return user;
}
