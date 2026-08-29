/**
 * The positions a player can be given.
 *
 * Mirrors `cloudflare-api/src/positions.ts`, which the API validates against,
 * the way FORMATIONS and LINEUP_FORMATS are kept in step by hand. Codes are
 * what is stored and sent; names are what is shown.
 */

export type PositionLine = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface PositionDefinition {
  code: string;
  name: string;
  line: PositionLine;
}

export const POSITIONS: readonly PositionDefinition[] = [
  { code: 'GK', name: 'Goalkeeper', line: 'GK' },
  { code: 'CB', name: 'Centre-back', line: 'DEF' },
  { code: 'LB', name: 'Left-back', line: 'DEF' },
  { code: 'RB', name: 'Right-back', line: 'DEF' },
  { code: 'LWB', name: 'Left wing-back', line: 'DEF' },
  { code: 'RWB', name: 'Right wing-back', line: 'DEF' },
  { code: 'DM', name: 'Defensive midfield', line: 'MID' },
  { code: 'CM', name: 'Centre midfield', line: 'MID' },
  { code: 'AM', name: 'Attacking midfield', line: 'MID' },
  { code: 'LM', name: 'Left midfield', line: 'MID' },
  { code: 'RM', name: 'Right midfield', line: 'MID' },
  { code: 'LW', name: 'Left wing', line: 'FWD' },
  { code: 'RW', name: 'Right wing', line: 'FWD' },
  { code: 'SS', name: 'Second striker', line: 'FWD' },
  { code: 'CF', name: 'Centre-forward', line: 'FWD' },
  { code: 'ST', name: 'Striker', line: 'FWD' },
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
