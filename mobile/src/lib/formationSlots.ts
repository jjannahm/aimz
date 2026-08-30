import type { PositionLine } from '@/src/lib/positions';
import { formationRows } from '@/src/types/api';

/** One place on the pitch a formation asks to be filled. */
export interface FormationSlot {
  /** Stable within a formation, so an assignment survives a re-render. */
  id: string;
  /** The position a player standing here is listed at: GK, LB, CM, ST… */
  code: string;
  line: PositionLine;
  /** Back to front: 0 is the keeper's row. */
  row: number;
}

/** The codes a line uses for its left, its middle and its right. */
const CODES: Record<Exclude<PositionLine, 'GK'>, { left: string; centre: string; right: string }> = {
  DEF: { left: 'LB', centre: 'CB', right: 'RB' },
  MID: { left: 'LM', centre: 'CM', right: 'RM' },
  FWD: { left: 'LW', centre: 'ST', right: 'RW' },
};

/**
 * Which line a row of the shape belongs to.
 *
 * The first row out from the keeper is the defence and the last is the attack;
 * everything between is midfield. A two-row shape is therefore a defence and an
 * attack, with nobody in between, which is how 2-2 is played.
 */
function lineOfRow(index: number, rows: number): Exclude<PositionLine, 'GK'> {
  if (index === 0) return 'DEF';
  return index === rows - 1 ? 'FWD' : 'MID';
}

/**
 * A row across the pitch: one out wide on each side, the rest through the
 * middle. Two stand as a pair in the centre — two centre-backs, two strikers —
 * rather than being split onto opposite touchlines.
 */
function codesAcross(count: number, line: Exclude<PositionLine, 'GK'>): string[] {
  const codes = CODES[line];
  if (count <= 0) return [];
  if (count === 1) return [codes.centre];
  if (count === 2) return [codes.centre, codes.centre];
  return [codes.left, ...Array.from({ length: count - 2 }, () => codes.centre), codes.right];
}

/**
 * Every place a formation asks to be filled, keeper first.
 *
 * Built from the same `FORMATIONS` catalogue the rest of the app reads, so a
 * shape offered by the format is the shape laid out here — there is no second
 * list of formations to keep in step.
 */
export function slotsFor(formation: string | null): FormationSlot[] {
  const rows = formation ? formationRows(formation) : [];
  const slots: FormationSlot[] = [{ id: 'gk', code: 'GK', line: 'GK', row: 0 }];
  rows.forEach((count, index) => {
    const line = lineOfRow(index, rows.length);
    codesAcross(count, line).forEach((code, place) => {
      slots.push({ id: `${index}-${place}`, code, line, row: index + 1 });
    });
  });
  return slots;
}

/** The slots of one row, in the order they stand across the pitch. */
export function rowsOfSlots(slots: FormationSlot[]): FormationSlot[][] {
  const rows: FormationSlot[][] = [];
  for (const slot of slots) {
    if (slot.row === 0) continue;
    (rows[slot.row - 1] ??= []).push(slot);
  }
  return rows.filter(Boolean);
}

/**
 * Put a saved lineup back onto the places a formation asks for.
 *
 * A player recorded at a position takes the place asking for that position, so
 * a lineup reopens standing where it was left. Anyone whose position no longer
 * has a place — the shape has changed since, or they were stored before places
 * existed — fills whatever is still empty rather than being dropped.
 */
export function placeOnSlots(
  slots: FormationSlot[],
  entries: readonly { player_id: string; position?: string | null }[],
): Record<string, string> {
  const placed: Record<string, string> = {};
  const waiting = [...entries];
  for (const slot of slots) {
    const match = waiting.findIndex((entry) => entry.position === slot.code);
    if (match >= 0) placed[slot.id] = waiting.splice(match, 1)[0]!.player_id;
  }
  for (const slot of slots) {
    if (placed[slot.id] || !waiting.length) continue;
    placed[slot.id] = waiting.shift()!.player_id;
  }
  return placed;
}
