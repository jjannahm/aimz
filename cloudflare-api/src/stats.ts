import { groupStandings } from "./knockout";
import type { Hono } from "hono";
import { ApiProblem, publicCompetition, publicPlayer, publicStat, publicTeam } from "./helpers";
import { applyStanding, AWARDS, FORM_LENGTH, outcome, type AwardDefinition } from "./scoring-rules";
import type { AwardTotals, CompetitionGroupRow, CompetitionRow, MatchRow, PlayerRow, StandingAccumulator, StatRow, TeamRow } from "./types";

type App = Hono<{ Bindings: Env }>;

type LeaderMetric = "goals" | "assists" | "cards";

interface LeaderTotals {
  player_id: string;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  appearances: number;
}

async function teamsByIds(env: Env, ids: string[]): Promise<Map<string, TeamRow>> {
  if (!ids.length) return new Map();
  const rows = await env.DB.prepare(`SELECT * FROM teams WHERE id IN (${ids.map(() => "?").join(",")})`)
    .bind(...ids)
    .all<TeamRow>();
  return new Map(rows.results.map((team) => [team.id, team]));
}

export function registerStatsRoutes(app: App): void {
  app.get("/api/v1/competitions/:id/standings", async (c) => {
    const competition = await c.env.DB.prepare("SELECT * FROM competitions WHERE id=?").bind(c.req.param("id")).first<CompetitionRow>();
    if (!competition) throw new ApiProblem(404, "competition_not_found", "Competition not found.");
    if (competition.type === "friendly") return c.json([]);
    // A knockout ranks each group on its own, so its rows carry the group they
    // belong to and start again at one inside it.
    if (competition.team_count !== null) {
      const [groups, tables] = await Promise.all([
        c.env.DB.prepare("SELECT * FROM competition_groups WHERE competition_id = ? ORDER BY position").bind(competition.id).all<CompetitionGroupRow>(),
        groupStandings(c.env, competition.id),
      ]);
      const ordered = [
        ...groups.results.map((group) => ({ group, rows: tables.get(group.id) ?? [] })),
        // Teams entered but not yet drawn are still shown, under no group.
        { group: null as CompetitionGroupRow | null, rows: tables.get("") ?? [] },
      ];
      return c.json(ordered.flatMap(({ group, rows }) => rows.map((row, index) => ({
        rank: index + 1,
        team: publicTeam(row.team),
        group: group ? { id: group.id, name: group.name, position: group.position } : null,
        form: [...row.form].reverse().slice(0, FORM_LENGTH),
        played: row.played, won: row.won, drawn: row.drawn, lost: row.lost,
        goals_for: row.goals_for, goals_against: row.goals_against,
        goal_difference: row.goals_for - row.goals_against, points: row.points,
      }))));
    }
    // Oldest first, so the form strip accumulates in the order they were played.
    const result = await c.env.DB.prepare("SELECT * FROM matches WHERE competition_id=? AND status='finished' ORDER BY kickoff_datetime").bind(competition.id).all<MatchRow>();
    const teamIds = [...new Set(result.results.flatMap((match) => [match.home_team_id, match.away_team_id]))];
    const teamMap = await teamsByIds(c.env, teamIds);
    const rows = new Map<string, StandingAccumulator>();
    const form = new Map<string, ("W" | "D" | "L")[]>();
    const blank = (): StandingAccumulator => ({ played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0, points: 0 });
    for (const id of teamIds) rows.set(id, blank());
    // Teams entered in the competition appear on nil rather than waiting for a
    // first result, so the table reads as a league from the day it is drawn up.
    const entered = await c.env.DB.prepare("SELECT * FROM teams WHERE competition_id = ?").bind(competition.id).all<TeamRow>();
    for (const team of entered.results) {
      teamMap.set(team.id, team);
      if (!rows.has(team.id)) rows.set(team.id, blank());
    }
    for (const match of result.results) {
      applyStanding(rows.get(match.home_team_id)!, match.home_score, match.away_score);
      applyStanding(rows.get(match.away_team_id)!, match.away_score, match.home_score);
      for (const [id, scored, conceded] of [[match.home_team_id, match.home_score, match.away_score], [match.away_team_id, match.away_score, match.home_score]] as const) {
        form.set(id, [...(form.get(id) ?? []), outcome(scored, conceded)]);
      }
    }
    const sorted = [...rows.entries()].sort(([aId, a], [bId, b]) => b.points-a.points || (b.goals_for-b.goals_against)-(a.goals_for-a.goals_against) || b.goals_for-a.goals_for || (teamMap.get(aId)?.name ?? "").localeCompare(teamMap.get(bId)?.name ?? ""));
    // Reversed so the strip reads newest first.
    return c.json(sorted.map(([id, row], index) => ({ rank: index+1, team: publicTeam(teamMap.get(id) ?? null), form: [...(form.get(id) ?? [])].reverse().slice(0, FORM_LENGTH), ...row, goal_difference: row.goals_for-row.goals_against })));
  });

  app.get("/api/v1/teams/:teamId/head-to-head/:opponentId", async (c) => {
    const teamId = c.req.param("teamId");
    const opponentId = c.req.param("opponentId");
    if (teamId === opponentId) throw new ApiProblem(422, "same_team", "Pick two different teams.");
    const teamMap = await teamsByIds(c.env, [teamId, opponentId]);
    const team = teamMap.get(teamId);
    const opponent = teamMap.get(opponentId);
    if (!team || !opponent) throw new ApiProblem(404, "team_not_found", "Team not found.");
    const meetings = await c.env.DB.prepare("SELECT * FROM matches WHERE status='finished' AND ((home_team_id=? AND away_team_id=?) OR (home_team_id=? AND away_team_id=?)) ORDER BY kickoff_datetime DESC").bind(teamId, opponentId, opponentId, teamId).all<MatchRow>();
    const competitionIds = [...new Set(meetings.results.map((match) => match.competition_id))];
    const competitions = competitionIds.length
      ? await c.env.DB.prepare(`SELECT * FROM competitions WHERE id IN (${competitionIds.map(() => "?").join(",")})`).bind(...competitionIds).all<CompetitionRow>()
      : { results: [] as CompetitionRow[] };
    const competitionMap = new Map(competitions.results.map((row) => [row.id, row]));
    const tally = { won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0 };
    const rows = meetings.results.map((match) => {
      const atHome = match.home_team_id === teamId;
      const scored = atHome ? match.home_score : match.away_score;
      const conceded = atHome ? match.away_score : match.home_score;
      tally.goals_for += scored;
      tally.goals_against += conceded;
      const result = outcome(scored, conceded);
      tally[({ W: "won", D: "drawn", L: "lost" } as const)[result]] += 1;
      return {
        match_id: match.id,
        kickoff_datetime: match.kickoff_datetime,
        competition: publicCompetition(competitionMap.get(match.competition_id) ?? null),
        home_team: publicTeam(teamMap.get(match.home_team_id) ?? null),
        away_team: publicTeam(teamMap.get(match.away_team_id) ?? null),
        home_score: match.home_score,
        away_score: match.away_score,
        result,
      };
    });
    return c.json({ team: publicTeam(team), opponent: publicTeam(opponent), played: meetings.results.length, ...tally, meetings: rows });
  });

  app.get("/api/v1/stats/leaders", async (c) => {
    const params = new URL(c.req.url).searchParams;
    const requested = params.get("metric");
    const metric: LeaderMetric = requested === "assists" || requested === "cards" ? requested : "goals";
    const ageGroup = params.get("age_group"); const season = params.get("season"); const competitionId = params.get("competition_id");
    const limit = Math.min(Math.max(Number.parseInt(params.get("limit") ?? "20", 10) || 20, 1), 100);
    const values: unknown[] = []; const filters: string[] = [];
    const seasonJoin = season ? " JOIN competitions cp ON cp.id=m.competition_id" : "";
    if (ageGroup) { filters.push("t.age_group=?"); values.push(ageGroup); }
    if (competitionId) { filters.push("m.competition_id=?"); values.push(competitionId); }
    if (season) { filters.push("cp.season=?"); values.push(season); }
    const where = filters.length ? ` AND ${filters.join(" AND ")}` : "";
    const totals = await c.env.DB.prepare(`SELECT s.player_id AS player_id, SUM(s.goals) AS goals, SUM(s.assists) AS assists, SUM(s.yellow_cards) AS yellow_cards, SUM(s.red_cards) AS red_cards, SUM(CASE WHEN s.appeared THEN 1 ELSE 0 END) AS appearances FROM player_match_stats s JOIN matches m ON m.id=s.match_id JOIN players p ON p.id=s.player_id JOIN teams t ON t.id=p.team_id${seasonJoin} WHERE m.status='finished'${where} GROUP BY s.player_id`).bind(...values).all<LeaderTotals>();
    // A sending-off weighs more than a caution.
    const scored = (row: LeaderTotals) => metric === "goals" ? row.goals : metric === "assists" ? row.assists : row.yellow_cards + row.red_cards * 3;
    const tiebreak = (row: LeaderTotals) => metric === "goals" ? row.assists : metric === "assists" ? row.goals : row.red_cards;
    const counted = totals.results.filter((row) => scored(row) > 0);
    if (!counted.length) return c.json([]);
    const playerIds = counted.map((row) => row.player_id);
    const players = await c.env.DB.prepare(`SELECT * FROM players WHERE id IN (${playerIds.map(() => "?").join(",")})`).bind(...playerIds).all<PlayerRow>();
    const playerMap = new Map(players.results.map((player) => [player.id, player]));
    const teamMap = await teamsByIds(c.env, [...new Set(players.results.map((player) => player.team_id))]);
    const ranked = counted.sort((a, b) => scored(b) - scored(a)
      || tiebreak(b) - tiebreak(a)
      || a.appearances - b.appearances
      || (playerMap.get(a.player_id)?.name ?? "").localeCompare(playerMap.get(b.player_id)?.name ?? "")).slice(0, limit);
    return c.json(ranked.map((row, index) => ({ rank: index + 1, player: publicPlayer(playerMap.get(row.player_id) ?? null), team: publicTeam(teamMap.get(playerMap.get(row.player_id)?.team_id ?? "") ?? null), goals: row.goals, assists: row.assists, yellow_cards: row.yellow_cards, red_cards: row.red_cards, appearances: row.appearances })));
  });

  app.get("/api/v1/players/:id/stats", async (c) => {
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(c.req.param("id")).first<PlayerRow>(); if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
    const season = new URL(c.req.url).searchParams.get("season"); const values: unknown[] = [player.id]; const where = season ? " AND cp.season=?" : ""; if (season) values.push(season);
    const result = await c.env.DB.prepare(`SELECT s.* FROM player_match_stats s JOIN matches m ON m.id=s.match_id JOIN competitions cp ON cp.id=m.competition_id WHERE s.player_id=?${where} ORDER BY m.kickoff_datetime DESC`).bind(...values).all<StatRow>();
    const totals = result.results.reduce((sum, stat) => ({ appearances: sum.appearances + (stat.appeared ? 1 : 0), minutes_played: sum.minutes_played+stat.minutes_played, goals: sum.goals+stat.goals, assists: sum.assists+stat.assists, own_goals: sum.own_goals+stat.own_goals, yellow_cards: sum.yellow_cards+stat.yellow_cards, red_cards: sum.red_cards+stat.red_cards }), { appearances:0, minutes_played:0, goals:0, assists:0, own_goals:0, yellow_cards:0, red_cards:0 });
    return c.json({ player: publicPlayer(player), season, ...totals, matches: result.results.map(publicStat) });
  });

  app.get("/api/v1/competitions/:id/awards", async (c) => {
    const competition = await c.env.DB.prepare("SELECT * FROM competitions WHERE id=?").bind(c.req.param("id")).first<CompetitionRow>();
    if (!competition) throw new ApiProblem(404, "competition_not_found", "Competition not found.");
    const rank = await awardRankings(c.env, competition.id);
    // An award only exists if somebody won it, so an empty ranking drops out.
    const playerAwards = AWARDS.flatMap((definition) => {
      const [winner] = rank(definition);
      return winner ? [{ metric: definition.metric, label: definition.label, player: winner.player, team: winner.team, value: winner.value, unit: winner.unit }] : [];
    });
    // Every award is now a player award; team_awards stays on the response, and
    // empty, so the shape does not change for older clients.
    return c.json({ competition: publicCompetition(competition), player_awards: playerAwards, team_awards: [] });
  });

  /** The full ranking behind one award, fetched only once a client opens it. */
  app.get("/api/v1/competitions/:id/awards/:metric", async (c) => {
    const definition = AWARDS.find((award) => award.metric === c.req.param("metric"));
    if (!definition) throw new ApiProblem(404, "award_not_found", "Unknown award.");
    const competition = await c.env.DB.prepare("SELECT * FROM competitions WHERE id=?").bind(c.req.param("id")).first<CompetitionRow>();
    if (!competition) throw new ApiProblem(404, "competition_not_found", "Competition not found.");
    const limit = Math.min(Math.max(Number.parseInt(new URL(c.req.url).searchParams.get("limit") ?? "25", 10) || 25, 1), 100);
    const rank = await awardRankings(c.env, competition.id);
    return c.json(rank(definition).slice(0, limit));
  });
}

/**
 * Ranks every award off one set of totals, so an award's headline winner is
 * always rank 1 of the ranking a client opens behind it.
 */
async function awardRankings(env: Env, competitionId: string): Promise<(definition: AwardDefinition) => AwardRank[]> {
  const totals = await env.DB.prepare(`SELECT s.player_id AS player_id, SUM(s.goals) AS goals, SUM(s.assists) AS assists, SUM(s.minutes_played) AS minutes, SUM(s.yellow_cards + s.red_cards) AS cards, SUM(CASE WHEN s.appeared THEN 1 ELSE 0 END) AS appearances, (SELECT COUNT(*) FROM matches mm WHERE mm.competition_id=m.competition_id AND mm.status='finished' AND mm.man_of_the_match_player_id=s.player_id) AS motm FROM player_match_stats s JOIN matches m ON m.id=s.match_id WHERE m.status='finished' AND m.competition_id=? GROUP BY s.player_id`).bind(competitionId).all<AwardTotals>();
  const playerIds = totals.results.map((row) => row.player_id);
  const players = playerIds.length
    ? await env.DB.prepare(`SELECT * FROM players WHERE id IN (${playerIds.map(() => "?").join(",")})`).bind(...playerIds).all<PlayerRow>()
    : { results: [] as PlayerRow[] };
  const playerMap = new Map(players.results.map((player) => [player.id, player]));
  const awardTeams = await teamsByIds(env, [...new Set(players.results.map((player) => player.team_id))]);
  const nameOf = (row: AwardTotals) => playerMap.get(row.player_id)?.name ?? "";
  return (definition) => totals.results
    .filter(definition.eligible)
    // Name breaks the last tie, so two identical records still rank in a fixed
    // order rather than however the database happened to return them.
    .sort((a, b) => definition.compare(a, b) || nameOf(a).localeCompare(nameOf(b)))
    .map((row, index) => {
      const player = playerMap.get(row.player_id) ?? null;
      return {
        rank: index + 1,
        player: publicPlayer(player),
        team: publicTeam(awardTeams.get(player?.team_id ?? "") ?? null),
        value: definition.value(row),
        unit: definition.unit,
        appearances: row.appearances,
      };
    });
}

interface AwardRank {
  rank: number;
  player: Record<string, unknown> | null;
  team: Record<string, unknown> | null;
  value: number;
  unit: string;
  appearances: number;
}
