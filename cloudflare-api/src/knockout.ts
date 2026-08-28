import type { Hono } from "hono";
import { adminUser, ApiProblem, jsonArray, jsonObject, nowIso, publicTeam, stringField } from "./helpers";
import { outcome } from "./scoring-rules";
import { ADVANCE_PER_GROUP, GROUP_SIZE, groupCountFor, resolveShape, roundLabel, roundsFor, TEAM_COUNTS } from "./knockout-shape";
import type { Shape } from "./knockout-shape";
import type { BracketSlotRow, CompetitionGroupRow, CompetitionRow, MatchRow, TeamRow } from "./types";

export { ADVANCE_PER_GROUP, GROUP_SIZE, groupCountFor, roundLabel, roundsFor, TEAM_COUNTS };

/** "Group A", "Group B"… */
const groupName = (position: number) => `Group ${String.fromCodePoint(65 + position)}`;

/** A competition drawn before custom shapes existed was drawn in fours. */
export const groupSizeOf = (competition: Pick<CompetitionRow, "group_size">) => competition.group_size ?? GROUP_SIZE;

/** Every group and bracket row a new knockout starts life with. */
export function generationStatements(env: Env, competitionId: string, teamCount: number, groupSize: number = GROUP_SIZE): D1PreparedStatement[] {
  const groupCount = groupCountFor(teamCount, groupSize);
  const statements: D1PreparedStatement[] = [];
  for (let position = 0; position < groupCount; position += 1) {
    statements.push(env.DB.prepare("INSERT INTO competition_groups (id, competition_id, name, position) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), competitionId, groupName(position), position));
  }
  for (const round of roundsFor(groupCount)) {
    for (let position = 0; position < round / 2; position += 1) {
      statements.push(env.DB.prepare("INSERT INTO bracket_slots (id, competition_id, round, position) VALUES (?, ?, ?, ?)")
        .bind(crypto.randomUUID(), competitionId, round, position));
    }
  }
  return statements;
}

/** Refuses a shape in the form the API answers with. */
export function knockoutShape(body: Record<string, unknown>, fallback: Shape): Shape {
  const teamCount = body.team_count === undefined ? fallback.team_count : body.team_count;
  const groupSize = body.group_size === undefined ? fallback.group_size : body.group_size;
  const result = resolveShape(teamCount, groupSize);
  if (result.ok) return result.shape;
  throw new ApiProblem(422, "validation_error", "Check the highlighted fields.", [{ field: result.field, message: result.message }]);
}

async function competitionOr404(env: Env, id: string): Promise<CompetitionRow> {
  const competition = await env.DB.prepare("SELECT * FROM competitions WHERE id = ?").bind(id).first<CompetitionRow>();
  if (!competition) throw new ApiProblem(404, "competition_not_found", "Competition not found.");
  return competition;
}

const publicSlot = (slot: BracketSlotRow, teams: Map<string, TeamRow>) => ({
  id: slot.id, round: slot.round, position: slot.position,
  home_team: publicTeam(slot.home_team_id ? teams.get(slot.home_team_id) ?? null : null),
  away_team: publicTeam(slot.away_team_id ? teams.get(slot.away_team_id) ?? null : null),
  winner_team_id: slot.winner_team_id, match_id: slot.match_id,
});

async function readBracket(env: Env, competition: CompetitionRow): Promise<Record<string, unknown>> {
  if (competition.team_count === null) return { competition_id: competition.id, team_count: null, rounds: [] };
  const slots = await env.DB.prepare("SELECT * FROM bracket_slots WHERE competition_id = ? ORDER BY round DESC, position ASC").bind(competition.id).all<BracketSlotRow>();
  const teamIds = [...new Set(slots.results.flatMap((slot) => [slot.home_team_id, slot.away_team_id]).filter((id): id is string => Boolean(id)))];
  const teams = teamIds.length
    ? await env.DB.prepare(`SELECT * FROM teams WHERE id IN (${teamIds.map(() => "?").join(",")})`).bind(...teamIds).all<TeamRow>()
    : { results: [] as TeamRow[] };
  const teamMap = new Map(teams.results.map((team) => [team.id, team]));
  const rounds = roundsFor(groupCountFor(competition.team_count, groupSizeOf(competition))).map((round) => ({
    round, label: roundLabel(round),
    slots: slots.results.filter((slot) => slot.round === round).map((slot) => publicSlot(slot, teamMap)),
  }));
  return { competition_id: competition.id, team_count: competition.team_count, rounds };
}

/**
 * Group tables, computed the same way the league table is.
 *
 * Only matches between two teams of the same group count, so a knockout tie
 * played in the same competition never lands in a group table.
 */
export interface GroupStandingRow {
  team: TeamRow;
  played: number; won: number; drawn: number; lost: number;
  goals_for: number; goals_against: number; points: number;
  /** Oldest first, as the league table builds it. */
  form: ("W" | "D" | "L")[];
}

export async function groupStandings(env: Env, competitionId: string): Promise<Map<string, GroupStandingRow[]>> {
  const teams = await env.DB.prepare("SELECT * FROM teams WHERE competition_id = ?").bind(competitionId).all<TeamRow>();
  // Oldest first, so the form strip accumulates in the order they were played.
  const matches = await env.DB.prepare("SELECT * FROM matches WHERE competition_id = ? AND status = 'finished' ORDER BY kickoff_datetime").bind(competitionId).all<MatchRow>();
  const groupOf = new Map(teams.results.map((team) => [team.id, team.competition_group_id]));
  const rows = new Map<string, GroupStandingRow>(teams.results.map((team) => [team.id, { team, played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0, form: [] }]));
  for (const match of matches.results) {
    const home = groupOf.get(match.home_team_id) ?? null;
    if (!home || home !== (groupOf.get(match.away_team_id) ?? null)) continue;
    for (const [id, scored, conceded] of [[match.home_team_id, match.home_score, match.away_score], [match.away_team_id, match.away_score, match.home_score]] as const) {
      const row = rows.get(id);
      if (!row) continue;
      row.played += 1; row.goals_for += scored; row.goals_against += conceded;
      row.form.push(outcome(scored, conceded));
      if (scored > conceded) { row.won += 1; row.points += 3; } else if (scored === conceded) { row.drawn += 1; row.points += 1; } else row.lost += 1;
    }
  }
  const byGroup = new Map<string, GroupStandingRow[]>();
  for (const row of rows.values()) {
    const key = row.team.competition_group_id ?? "";
    byGroup.set(key, [...(byGroup.get(key) ?? []), row]);
  }
  for (const [key, list] of byGroup) {
    byGroup.set(key, list.sort((a, b) => b.points - a.points
      || (b.goals_for - b.goals_against) - (a.goals_for - a.goals_against)
      || b.goals_for - a.goals_for
      || a.team.name.localeCompare(b.team.name)));
  }
  return byGroup;
}

export function registerKnockoutRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get("/api/v1/competitions/:id/groups", async (c) => {
    const competition = await competitionOr404(c.env, c.req.param("id"));
    if (competition.team_count === null) return c.json([]);
    const [groups, teams] = await Promise.all([
      c.env.DB.prepare("SELECT * FROM competition_groups WHERE competition_id = ? ORDER BY position").bind(competition.id).all<CompetitionGroupRow>(),
      c.env.DB.prepare("SELECT * FROM teams WHERE competition_id = ?").bind(competition.id).all<TeamRow>(),
    ]);
    return c.json(groups.results.map((group) => ({
      ...group,
      teams: teams.results.filter((team) => team.competition_group_id === group.id).map(publicTeam),
    })));
  });

  app.put("/api/v1/competitions/:id/groups/:groupId/teams", async (c) => {
    await adminUser(c);
    const competition = await competitionOr404(c.env, c.req.param("id"));
    const group = await c.env.DB.prepare("SELECT * FROM competition_groups WHERE id = ? AND competition_id = ?").bind(c.req.param("groupId"), competition.id).first<CompetitionGroupRow>();
    if (!group) throw new ApiProblem(404, "group_not_found", "Group not found.");
    const body = await jsonArray(c);
    const teamIds = body.map((item) => stringField(item, "team_id", { min: 1, max: 36 })!);
    const capacity = groupSizeOf(competition);
    if (teamIds.length > capacity) throw new ApiProblem(422, "validation_error", "Check the highlighted fields.", [{ field: "teams", message: `A group holds at most ${capacity} teams.` }]);
    const now = nowIso();
    const statements: D1PreparedStatement[] = [
      // Everyone drawn out of this group loses their place in it.
      c.env.DB.prepare("UPDATE teams SET competition_group_id = NULL, updated_at = ? WHERE competition_group_id = ?").bind(now, group.id),
    ];
    for (const teamId of teamIds) {
      statements.push(c.env.DB.prepare("UPDATE teams SET competition_id = ?, competition_group_id = ?, updated_at = ? WHERE id = ?").bind(competition.id, group.id, now, teamId));
    }
    await c.env.DB.batch(statements);
    const teams = await c.env.DB.prepare("SELECT * FROM teams WHERE competition_group_id = ?").bind(group.id).all<TeamRow>();
    return c.json({ ...group, teams: teams.results.map(publicTeam) });
  });

  app.get("/api/v1/competitions/:id/bracket", async (c) => {
    const competition = await competitionOr404(c.env, c.req.param("id"));
    return c.json(await readBracket(c.env, competition));
  });

  app.post("/api/v1/competitions/:id/advance", async (c) => {
    await adminUser(c);
    const competition = await competitionOr404(c.env, c.req.param("id"));
    if (competition.team_count === null) throw new ApiProblem(409, "not_a_knockout", "This competition has no knockout stage.");
    const body = await jsonObject(c);
    const round = typeof body.round === "number" ? body.round : null;
    const groupCount = groupCountFor(competition.team_count, groupSizeOf(competition));
    if (round === null || !roundsFor(groupCount).includes(round)) {
      throw new ApiProblem(422, "validation_error", "Check the highlighted fields.", [{ field: "round", message: "Choose a round of this competition." }]);
    }
    const target = await c.env.DB.prepare("SELECT * FROM bracket_slots WHERE competition_id = ? AND round = ? ORDER BY position").bind(competition.id, round).all<BracketSlotRow>();
    if (target.results.some((slot) => slot.winner_team_id)) throw new ApiProblem(409, "round_locked", "This round already has a result. Clear it before drawing it again.");

    const pairs: [string | null, string | null][] = [];
    if (round === groupCount * ADVANCE_PER_GROUP) {
      const groups = await c.env.DB.prepare("SELECT * FROM competition_groups WHERE competition_id = ? ORDER BY position").bind(competition.id).all<CompetitionGroupRow>();
      const tables = await groupStandings(c.env, competition.id);
      const winners: (string | null)[] = []; const runnersUp: (string | null)[] = [];
      for (const group of groups.results) {
        const table = tables.get(group.id) ?? [];
        if (table.filter((row) => row.played > 0).length < 2) {
          throw new ApiProblem(409, "groups_incomplete", "Every group needs results before its top two can advance.");
        }
        winners.push(table[0]?.team.id ?? null);
        runnersUp.push(table[1]?.team.id ?? null);
      }
      // A group winner meets the runner-up from the next group along, never
      // the one they have just played twice.
      for (let position = 0; position < winners.length; position += 1) {
        pairs.push([winners[position] ?? null, runnersUp[(position + 1) % runnersUp.length] ?? null]);
      }
    } else {
      const source = await c.env.DB.prepare("SELECT * FROM bracket_slots WHERE competition_id = ? AND round = ? ORDER BY position").bind(competition.id, round * 2).all<BracketSlotRow>();
      if (source.results.some((slot) => !slot.winner_team_id)) throw new ApiProblem(409, "round_incomplete", "Every tie in the previous round needs a winner first.");
      for (let position = 0; position < source.results.length; position += 2) {
        pairs.push([source.results[position]?.winner_team_id ?? null, source.results[position + 1]?.winner_team_id ?? null]);
      }
    }

    await c.env.DB.batch(target.results.map((slot, index) => c.env.DB
      .prepare("UPDATE bracket_slots SET home_team_id = ?, away_team_id = ? WHERE id = ?")
      .bind(pairs[index]?.[0] ?? null, pairs[index]?.[1] ?? null, slot.id)));
    return c.json(await readBracket(c.env, competition));
  });

  app.patch("/api/v1/bracket-slots/:id", async (c) => {
    await adminUser(c);
    const slot = await c.env.DB.prepare("SELECT * FROM bracket_slots WHERE id = ?").bind(c.req.param("id")).first<BracketSlotRow>();
    if (!slot) throw new ApiProblem(404, "slot_not_found", "Bracket tie not found.");
    const body = await jsonObject(c);
    const winner = body.winner_team_id === undefined ? slot.winner_team_id : stringField(body, "winner_team_id", { nullable: true, max: 36 }) ?? null;
    const matchId = body.match_id === undefined ? slot.match_id : stringField(body, "match_id", { nullable: true, max: 36 }) ?? null;
    if (winner && winner !== slot.home_team_id && winner !== slot.away_team_id) {
      throw new ApiProblem(422, "validation_error", "Check the highlighted fields.", [{ field: "winner_team_id", message: "The winner must be one of the two teams in this tie." }]);
    }
    await c.env.DB.prepare("UPDATE bracket_slots SET winner_team_id = ?, match_id = ? WHERE id = ?").bind(winner, matchId, slot.id).run();
    const competition = await competitionOr404(c.env, slot.competition_id);
    return c.json(await readBracket(c.env, competition));
  });
}
