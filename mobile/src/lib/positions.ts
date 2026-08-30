/**
 * The positions a player can be given.
 *
 * Mirrors `cloudflare-api/src/positions.ts`, which the API validates against,
 * the way FORMATIONS and LINEUP_FORMATS are kept in step by hand. Codes are
 * what is stored and sent; names are what is shown.
 */

export type PositionLine = 'GK' | 'DEF' | 'MID' | 'FWD';

/** Which side of its line a position stands on, looking up the pitch. */
export type PositionFlank = 'left' | 'centre' | 'right';

export interface PositionDefinition {
  code: string;
  name: string;
  line: PositionLine;
  flank: PositionFlank;
}

export const POSITIONS: readonly PositionDefinition[] = [
  { code: 'GK', name: 'Goalkeeper', line: 'GK', flank: 'centre' },
  { code: 'CB', name: 'Centre-back', line: 'DEF', flank: 'centre' },
  { code: 'LB', name: 'Left-back', line: 'DEF', flank: 'left' },
  { code: 'RB', name: 'Right-back', line: 'DEF', flank: 'right' },
  { code: 'LWB', name: 'Left wing-back', line: 'DEF', flank: 'left' },
  { code: 'RWB', name: 'Right wing-back', line: 'DEF', flank: 'right' },
  { code: 'DM', name: 'Defensive midfield', line: 'MID', flank: 'centre' },
  { code: 'CM', name: 'Centre midfield', line: 'MID', flank: 'centre' },
  { code: 'AM', name: 'Attacking midfield', line: 'MID', flank: 'centre' },
  { code: 'LM', name: 'Left midfield', line: 'MID', flank: 'left' },
  { code: 'RM', name: 'Right midfield', line: 'MID', flank: 'right' },
  { code: 'LW', name: 'Left wing', line: 'FWD', flank: 'left' },
  { code: 'RW', name: 'Right wing', line: 'FWD', flank: 'right' },
  { code: 'SS', name: 'Second striker', line: 'FWD', flank: 'centre' },
  { code: 'CF', name: 'Centre-forward', line: 'FWD', flank: 'centre' },
  { code: 'ST', name: 'Striker', line: 'FWD', flank: 'centre' },
];

/** The goalkeeper's code, named so nothing spells it twice. */
export const GOALKEEPER = 'GK';

const BY_CODE = new Map(POSITIONS.map((position) => [position.code, position]));

/** The full name, falling back to whatever was stored so nothing renders blank. */
export function positionName(code: string | null | undefined): string {
  if (!code) return '';
  return BY_CODE.get(code)?.name ?? code;
}

/** "Left-back (LB)", for somewhere with room to name it and its code. */
export function positionLabel(code: string | null | undefined): string {
  if (!code) return '';
  const position = BY_CODE.get(code);
  return position ? `${position.name} (${position.code})` : code;
}

/**
 * Which row of the pitch a position stands in.
 *
 * A lookup, not a guess: a left wing-back is a defender because the vocabulary
 * says so, not because "back" happened to be tested before "wing".
 */
export function lineFor(code: string | null | undefined): PositionLine {
  return (code ? BY_CODE.get(code)?.line : undefined) ?? 'MID';
}

/**
 * Whether this is the goalkeeper's position.
 *
 * Positions used to be free text, so this had to recognise a keeper from
 * whatever prose had been typed, and agree with the worker about it. Both sides
 * read the one code now.
 */
export function isGoalkeeper(position: string | null | undefined): boolean {
  return position === GOALKEEPER;
}

/**
 * The positions matching what has been typed so far, best first.
 *
 * A code that starts with the query comes first — typing "l" is usually
 * reaching for LB or LW — then a name whose own words start with it, so "wing"
 * still finds both wings without "Left-back" arriving because it contains an
 * "in" somewhere. An empty query offers the lot, in football order.
 */
export function matchPositions(query: string): readonly PositionDefinition[] {
  const text = query.trim().toLowerCase();
  if (!text) return POSITIONS;
  const byCode: PositionDefinition[] = [];
  const byName: PositionDefinition[] = [];
  for (const position of POSITIONS) {
    if (position.code.toLowerCase().startsWith(text)) byCode.push(position);
    else if (position.name.toLowerCase().split(/[\s-]+/u).some((word) => word.startsWith(text))) byName.push(position);
  }
  return [...byCode, ...byName];
}

/** Back to front, which is the order a team sheet is read in. */
const LINE_ORDER: Record<PositionLine, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };

/**
 * A squad in team-sheet order: keepers, defenders, midfield, then attack, and
 * alphabetical within each line.
 *
 * Sorts a copy, so a list held elsewhere is not rearranged underneath whoever
 * is holding it.
 */
export function byPosition<T extends { name: string; position: string | null }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) =>
    LINE_ORDER[lineFor(a.position)] - LINE_ORDER[lineFor(b.position)]
    || a.name.localeCompare(b.name));
}

/** Left to right, looking up the pitch. */
const FLANK_ORDER: Record<PositionFlank, number> = { left: 0, centre: 1, right: 2 };

/** Which side of its line a position stands on; centre for anything unknown. */
export function flankFor(code: string | null | undefined): PositionFlank {
  return (code ? BY_CODE.get(code)?.flank : undefined) ?? 'centre';
}

/**
 * One row of the pitch, in the order it is stood in: left, centre, then right.
 *
 * A right-back belongs on the right of the defence, not wherever the squad list
 * happened to put them. Names break a tie, so two centre-backs keep a stable
 * order between renders rather than swapping about.
 */
export function acrossThePitch<T extends { name: string; position: string }>(players: readonly T[]): T[] {
  return [...players].sort((a, b) =>
    FLANK_ORDER[flankFor(a.position)] - FLANK_ORDER[flankFor(b.position)]
    || a.name.localeCompare(b.name));
}
