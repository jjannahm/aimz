import type { EventRow, LineupRow } from "./types";

/**
 * The goalkeeper's position code.
 *
 * Spelled here rather than imported: this file is unit tested directly, and a
 * runtime relative import cannot be resolved by Node's type stripping. It is
 * `GOALKEEPER` in ./positions, which owns the vocabulary, and a test in
 * goalkeeping.test.ts holds the two together.
 */
const GOALKEEPER = "GK";

/**
 * What a goalkeeper is answerable for in one match.
 *
 * These belong to the keeper who was on the pitch when it happened, which is
 * not always the keeper who started: a side that changes keeper at half time
 * splits the match between them, and the one who was not on cannot be charged
 * with a goal or credited with a clean sheet.
 */
export interface GoalkeeperMatchStats {
  goals_conceded: number;
  penalties_saved: number;
  clean_sheet: number;
}

/**
 * Whether this is the goalkeeper's position.
 *
 * Positions used to be free text, so this had to recognise a keeper from
 * whatever prose had been typed, and agree with the app about it. They are a
 * fixed vocabulary now, so it is simply the one code.
 */
export function isGoalkeeper(position: string | null): boolean {
  return position === GOALKEEPER;
}

type Spell = { playerId: string; from: number; to: number | null };

/**
 * When each named player was on the pitch, in minutes.
 *
 * Starters are on from nought; a player brought on starts at the substitution's
 * minute and one taken off stops there. `to` is null for anyone still on.
 */
function spellsFor(lineup: LineupRow[], events: EventRow[]): Spell[] {
  const state = new Map<string, { from: number | null; to: number | null }>();
  for (const entry of lineup) state.set(entry.player_id, { from: entry.is_starter ? 0 : null, to: null });

  const subs = events.filter((event) => event.type === "substitution").sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));
  for (const sub of subs) {
    const minute = Math.max(0, sub.minute ?? 0);
    if (sub.player_id) {
      const arriving = state.get(sub.player_id) ?? { from: null, to: null };
      if (arriving.from === null) arriving.from = minute;
      state.set(sub.player_id, arriving);
    }
    if (sub.secondary_player_id) {
      const leaving = state.get(sub.secondary_player_id) ?? { from: 0, to: null };
      if (leaving.to === null) leaving.to = minute;
      state.set(sub.secondary_player_id, leaving);
    }
  }
  return [...state.entries()]
    .filter(([, value]) => value.from !== null)
    .map(([playerId, value]) => ({ playerId, from: value.from ?? 0, to: value.to }));
}

/**
 * The keeper on the pitch at a given minute.
 *
 * An event with no minute recorded is taken as having happened at the end,
 * which is where the last keeper of the match was standing.
 */
function keeperAt(keeperSpells: Spell[], minute: number | null): string | null {
  if (keeperSpells.length === 1) return keeperSpells[0]!.playerId;
  const at = minute ?? Number.MAX_SAFE_INTEGER;
  const on = keeperSpells.find((spell) => spell.from <= at && (spell.to === null || at < spell.to));
  // Falling back to whoever finished keeps a late goal off nobody's record.
  return on?.playerId ?? keeperSpells[keeperSpells.length - 1]?.playerId ?? null;
}

/**
 * Goals conceded, penalties saved and clean sheets, by goalkeeper.
 *
 * A goal is conceded by the team it counts against, which for an own goal is
 * the side that put it in — the same rule the scoreline is built on. A clean
 * sheet is only settled once the match is over, and belongs to a keeper who
 * conceded nothing while they were on.
 */
export function computeGoalkeeperStats(
  lineup: LineupRow[],
  events: EventRow[],
  finished: boolean,
): Map<string, GoalkeeperMatchStats> {
  const spells = spellsFor(lineup, events);
  const onPitch = new Set(spells.map((spell) => spell.playerId));
  const stats = new Map<string, GoalkeeperMatchStats>();

  // Each side is handled on its own, so a match with two named teams charges
  // each keeper only with what went past them.
  const teams = [...new Set(lineup.map((entry) => entry.team_id))];
  for (const teamId of teams) {
    const keepers = lineup.filter((entry) => entry.team_id === teamId && isGoalkeeper(entry.position) && onPitch.has(entry.player_id));
    if (!keepers.length) continue;
    const keeperSpells = spells.filter((spell) => keepers.some((keeper) => keeper.player_id === spell.playerId));
    for (const keeper of keepers) stats.set(keeper.player_id, { goals_conceded: 0, penalties_saved: 0, clean_sheet: 0 });

    for (const event of events) {
      const against = event.type === "goal" ? event.team_id !== teamId : event.type === "own_goal" ? event.team_id === teamId : false;
      if (against) {
        const keeper = keeperAt(keeperSpells, event.minute);
        if (keeper) stats.get(keeper)!.goals_conceded += 1;
        continue;
      }
      // A penalty the other side missed is only the keeper's to claim if they saved it.
      if (event.type === "penalty_missed" && event.penalty_outcome === "saved" && event.team_id !== teamId) {
        const keeper = keeperAt(keeperSpells, event.minute);
        if (keeper) stats.get(keeper)!.penalties_saved += 1;
      }
    }

    if (finished) {
      for (const keeper of keepers) {
        const row = stats.get(keeper.player_id)!;
        if (row.goals_conceded === 0) row.clean_sheet = 1;
      }
    }
  }
  return stats;
}
