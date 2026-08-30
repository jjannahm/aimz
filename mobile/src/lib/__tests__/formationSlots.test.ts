import { placeOnSlots, rowsOfSlots, slotsFor } from '@/src/lib/formationSlots';
import { FORMATIONS, LINEUP_FORMATS, formationRows, outfieldCount } from '@/src/types/api';

const codes = (formation: string) => slotsFor(formation).map((slot) => slot.code);

describe('slotsFor', () => {
  it('always opens with a place in goal', () => {
    expect(slotsFor('4-4-2')[0]).toMatchObject({ code: 'GK', line: 'GK', row: 0 });
  });

  // Every shape the app offers has to lay out, or a format could be chosen
  // whose formation the pitch cannot draw.
  it('lays out every shape the formats offer, one place per player', () => {
    for (const format of LINEUP_FORMATS) {
      for (const shape of FORMATIONS[format]) {
        expect(slotsFor(shape)).toHaveLength(outfieldCount(format) + 1);
      }
    }
  });

  it('sends one wide on each side and puts the rest through the middle', () => {
    expect(codes('4-4-2')).toEqual(['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST']);
  });

  // A pair stands together in the centre rather than on opposite touchlines:
  // two centre-backs, two strikers.
  it('keeps a pair central rather than splitting it wide', () => {
    expect(codes('2-2')).toEqual(['GK', 'CB', 'CB', 'ST', 'ST']);
  });

  it('reads the first row as the defence and the last as the attack', () => {
    expect(codes('1-2-1')).toEqual(['GK', 'CB', 'CM', 'CM', 'ST']);
    expect(codes('3-1')).toEqual(['GK', 'LB', 'CB', 'RB', 'ST']);
  });

  it('gives every row between the two to the midfield', () => {
    expect(codes('4-2-3-1')).toEqual(['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'CM', 'LM', 'CM', 'RM', 'ST']);
  });

  it('spreads a front three across the attack', () => {
    expect(codes('4-3-3')).toContain('LW');
    expect(codes('4-3-3')).toContain('RW');
  });

  it('asks for nothing at all before a formation is chosen', () => {
    expect(slotsFor(null)).toEqual([{ id: 'gk', code: 'GK', line: 'GK', row: 0 }]);
  });

  it('gives each place an id of its own', () => {
    const ids = slotsFor('4-4-2').map((slot) => slot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('rowsOfSlots', () => {
  it('groups the outfield into the rows the shape names', () => {
    const rows = rowsOfSlots(slotsFor('4-4-2'));
    expect(rows.map((row) => row.length)).toEqual(formationRows('4-4-2'));
  });

  it('leaves the keeper out of the outfield rows', () => {
    for (const row of rowsOfSlots(slotsFor('3-2-1'))) {
      expect(row.some((slot) => slot.code === 'GK')).toBe(false);
    }
  });
});

describe('placeOnSlots', () => {
  const slots = slotsFor('2-2');
  const entry = (player_id: string, position: string | null) => ({ player_id, position });

  it('stands each player where their recorded position asks for them', () => {
    const placed = placeOnSlots(slots, [
      entry('striker', 'ST'), entry('keeper', 'GK'), entry('back', 'CB'),
    ]);
    expect(placed[slots[0]!.id]).toBe('keeper');
    expect(placed[slots[1]!.id]).toBe('back');
    expect(placed.gk).toBe('keeper');
  });

  // A lineup saved before places existed, or under a shape since changed, is
  // still worth reopening rather than losing.
  it('finds a place for someone whose position no longer has one', () => {
    const placed = placeOnSlots(slots, [entry('winger', 'LW'), entry('keeper', 'GK')]);
    expect(Object.values(placed)).toContain('winger');
    expect(placed.gk).toBe('keeper');
  });

  it('never stands two players in one place', () => {
    const placed = placeOnSlots(slots, [entry('a', 'CB'), entry('b', 'CB'), entry('c', 'CB')]);
    const held = Object.values(placed);
    expect(new Set(held).size).toBe(held.length);
  });

  it('leaves places empty when there is nobody for them', () => {
    const placed = placeOnSlots(slots, [entry('keeper', 'GK')]);
    expect(Object.keys(placed)).toHaveLength(1);
  });

  it('takes only as many as there are places', () => {
    const many = Array.from({ length: 12 }, (unused, index) => entry(`p${index}`, null));
    expect(Object.keys(placeOnSlots(slots, many))).toHaveLength(slots.length);
  });
});
