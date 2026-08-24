/**
 * The arithmetic of a knockout's shape, kept clear of the request layer so it
 * can be tested on its own — `helpers.ts` uses syntax the type-stripping test
 * runner will not load.
 */

/** The shapes offered as presets. Any other whole shape is accepted too. */
export const TEAM_COUNTS = [8, 16, 32] as const;
/** What a group held before it could be told otherwise. */
export const GROUP_SIZE = 4;
/** Two from each group go through, which is what settles the bracket's size. */
export const ADVANCE_PER_GROUP = 2;

export const groupCountFor = (teamCount: number, groupSize: number = GROUP_SIZE) => teamCount / groupSize;

/** A bracket halves cleanly or not at all, so the group count must be a power of two. */
export const isPowerOfTwo = (value: number) => Number.isInteger(value) && value >= 1 && (value & (value - 1)) === 0;

/**
 * Rounds a knockout runs, biggest first, named by how many teams are left.
 *
 * The bracket is sized by how many teams come out of the groups rather than how
 * many went in: eight groups start a round of sixteen whether those groups held
 * four teams or six.
 */
export function roundsFor(groupCount: number): number[] {
  const rounds: number[] = [];
  for (let round = groupCount * ADVANCE_PER_GROUP; round >= 2; round /= 2) rounds.push(round);
  return rounds;
}

export function roundLabel(round: number): string {
  if (round === 2) return "Final";
  if (round === 4) return "Semi Finals";
  if (round === 8) return "Quarter Finals";
  return `Round of ${round}`;
}

export type Shape = { team_count: number | null; group_size: number | null };
export type ShapeResult = { ok: true; shape: Shape } | { ok: false; field: string; message: string };

/**
 * The shape a knockout is drawn in: how many teams, and how many to a group.
 *
 * Both are null together for a competition that is only a table. A shape holds
 * when it divides into whole groups of at least two, and when the teams coming
 * out of those groups fill a bracket exactly — which is to say when the group
 * count is a power of two. Ten teams advancing has no bracket without byes, so
 * that configuration is refused rather than drawn wrong.
 */
export function resolveShape(teamCount: unknown, rawGroupSize: unknown): ShapeResult {
  if (teamCount === null || teamCount === undefined) return { ok: true, shape: { team_count: null, group_size: null } };
  if (typeof teamCount !== "number" || !Number.isInteger(teamCount) || teamCount < 4) {
    return { ok: false, field: "team_count", message: "Must be a whole number of teams." };
  }
  const groupSize = rawGroupSize === null || rawGroupSize === undefined ? GROUP_SIZE : rawGroupSize;
  if (typeof groupSize !== "number" || !Number.isInteger(groupSize) || groupSize < 2) {
    return { ok: false, field: "group_size", message: "A group holds at least two teams." };
  }
  if (teamCount % groupSize !== 0) {
    return { ok: false, field: "team_count", message: `${teamCount} teams do not divide into groups of ${groupSize}.` };
  }
  const groupCount = teamCount / groupSize;
  if (groupCount < 2) return { ok: false, field: "team_count", message: "A knockout needs at least two groups." };
  if (!isPowerOfTwo(groupCount)) {
    return {
      ok: false,
      field: "team_count",
      message: `${groupCount} groups send ${groupCount * ADVANCE_PER_GROUP} teams through, which is not a bracket. Use a number of groups that halves cleanly.`,
    };
  }
  return { ok: true, shape: { team_count: teamCount, group_size: groupSize } };
}
