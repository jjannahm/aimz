// Kept free of runtime imports so it can be unit tested the way scoring-rules
// and match-clock are: Node's type stripping cannot resolve extensionless
// relative imports, and `import type` is erased before it tries.

/** The four lines of a football team, and the rows a pitch is drawn in. */
export type PositionLine = "GK" | "DEF" | "MID" | "FWD";

export interface PositionDefinition {
  /** What is stored, and what an admin types to find it. */
  code: string;
  /** What is shown. */
  name: string;
  line: PositionLine;
}

/**
 * Every position a player may be given.
 *
 * Stored as the code, displayed as the name. Squads play 5-, 6-, 7-, 9- and
 * 11-a-side, and the list is deliberately the full eleven-a-side vocabulary
 * rather than one set per format: a small-sided squad simply uses the part of
 * it that describes where someone actually plays.
 */
export const POSITIONS: readonly PositionDefinition[] = [
  { code: "GK", name: "Goalkeeper", line: "GK" },
  { code: "CB", name: "Centre-back", line: "DEF" },
  { code: "LB", name: "Left-back", line: "DEF" },
  { code: "RB", name: "Right-back", line: "DEF" },
  { code: "LWB", name: "Left wing-back", line: "DEF" },
  { code: "RWB", name: "Right wing-back", line: "DEF" },
  { code: "DM", name: "Defensive midfield", line: "MID" },
  { code: "CM", name: "Centre midfield", line: "MID" },
  { code: "AM", name: "Attacking midfield", line: "MID" },
  { code: "LM", name: "Left midfield", line: "MID" },
  { code: "RM", name: "Right midfield", line: "MID" },
  { code: "LW", name: "Left wing", line: "FWD" },
  { code: "RW", name: "Right wing", line: "FWD" },
  { code: "SS", name: "Second striker", line: "FWD" },
  { code: "CF", name: "Centre-forward", line: "FWD" },
  { code: "ST", name: "Striker", line: "FWD" },
] as const;

/** The codes alone, for `enumField` at the API boundary. */
export const POSITION_CODES = POSITIONS.map((position) => position.code) as [string, ...string[]];

/** The one position that is not an outfield one, named so nothing spells it twice. */
export const GOALKEEPER = "GK";

const BY_CODE = new Map(POSITIONS.map((position) => [position.code, position]));

export function positionDefinition(code: string): PositionDefinition | null {
  return BY_CODE.get(code) ?? null;
}

/** The full name, falling back to whatever was stored so nothing renders blank. */
export function positionName(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}

/**
 * Which row of the pitch a position stands in.
 *
 * This replaced a heuristic that read the free text a position used to be. It
 * is a lookup now, so "left wing-back" is a defender because the vocabulary
 * says so, not because "back" happened to be tested before "wing".
 */
export function lineFor(code: string): PositionLine {
  return BY_CODE.get(code)?.line ?? "MID";
}

/**
 * The closest code to a position written as free text.
 *
 * Positions were free text until this vocabulary existed, so both the data
 * migration and any client still sending prose need a way across. Where the
 * text only identifies a line, the most central position on that line is taken:
 * "Defender" becomes a centre-back rather than guessing a flank.
 */
export function codeForFreeText(value: string): string {
  const text = value.trim().toLowerCase();
  if (!text) return "CM";
  const exact = BY_CODE.get(value.trim().toUpperCase());
  if (exact) return exact.code;
  // Hyphen, space or neither: "centre forward" and "Centre-forward" are the
  // same position written by two people.
  const loose = (name: string) => name.toLowerCase().replace(/[\s-]+/gu, "");
  const named = POSITIONS.find((position) => loose(position.name) === loose(text));
  if (named) return named.code;
  if (text.startsWith("goal") || text.includes("keeper")) return "GK";
  // Wing-back before wing: the flank word is in both, and only one is a defender.
  if (text.includes("wing-back") || text.includes("wing back")) return text.startsWith("l") ? "LWB" : "RWB";
  // Midfield before both of the lines either side of it, because the prose for
  // one is usually the prose for the other with "midfield" appended:
  // "defensive midfielder" is a midfielder, not a defender.
  if (text.includes("mid")) return "CM";
  if (text.startsWith("def") || text.includes("back")) return "CB";
  if (text.includes("forward") || text.includes("strik") || text.includes("wing") || text.includes("attack")) return "ST";
  return "CM";
}
