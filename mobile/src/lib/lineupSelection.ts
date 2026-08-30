import { isGoalkeeper } from '@/src/lib/positions';

export interface SquadShape {
  /** How many start, or null before a format is chosen. */
  format: number | null;
  /** The position code a player is listed at. */
  positionOf: (playerId: string) => string | null | undefined;
  /** Whether the squad has anybody who can go in goal at all. */
  hasKeepers: boolean;
}

const keeperAmong = (chosen: Iterable<string>, shape: SquadShape): string | null => {
  for (const id of chosen) if (isGoalkeeper(shape.positionOf(id))) return id;
  return null;
};

/**
 * How many places this pick may take.
 *
 * The last one is held for a keeper until there is one. Without that a side
 * fills with outfielders and then has nowhere to put the keeper it is being
 * asked for — a dead end with nothing on the screen to explain it.
 */
export function placesOpenTo(chosen: Set<string>, keeper: boolean, shape: SquadShape): number {
  if (shape.format === null) return Number.MAX_SAFE_INTEGER;
  const holdOne = shape.hasKeepers && !keeper && keeperAmong(chosen, shape) === null;
  return holdOne ? shape.format - 1 : shape.format;
}

/** Whether a player who is not starting can still be added. */
export function canStart(chosen: Set<string>, playerId: string, shape: SquadShape): boolean {
  if (chosen.has(playerId)) return true;
  const keeper = isGoalkeeper(shape.positionOf(playerId));
  // A second keeper is always within reach: it takes the standing keeper's
  // place rather than needing one of its own.
  if (keeper && keeperAmong(chosen, shape) !== null) return true;
  return chosen.size < placesOpenTo(chosen, keeper, shape);
}

/**
 * Put a player in or out of the starting side.
 *
 * A side plays one keeper, so choosing a second puts the first back on the
 * bench rather than being refused: the alternative is a dead end where the
 * outgoing keeper has to be found and deselected first.
 */
export function toggleStarter(chosen: Set<string>, playerId: string, shape: SquadShape): Set<string> {
  const next = new Set(chosen);
  if (next.has(playerId)) { next.delete(playerId); return next; }
  const keeper = isGoalkeeper(shape.positionOf(playerId));
  if (keeper) {
    const standing = keeperAmong(next, shape);
    if (standing) next.delete(standing);
  }
  if (next.size >= placesOpenTo(next, keeper, shape)) return chosen;
  next.add(playerId);
  return next;
}
