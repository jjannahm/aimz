import { canStart, placesOpenTo, toggleStarter, type SquadShape } from '@/src/lib/lineupSelection';

const positions: Record<string, string> = {
  gk1: 'GK', gk2: 'GK',
  d1: 'CB', d2: 'LB', m1: 'CM', f1: 'ST', f2: 'RW',
};
const shape = (over: Partial<SquadShape> = {}): SquadShape => ({
  format: 5,
  positionOf: (id) => positions[id],
  hasKeepers: true,
  ...over,
});
const set = (...ids: string[]) => new Set(ids);
const names = (chosen: Set<string>) => [...chosen].sort();

describe('toggleStarter', () => {
  it('puts a player in, and takes them out again', () => {
    expect(names(toggleStarter(set(), 'd1', shape()))).toEqual(['d1']);
    expect(names(toggleStarter(set('d1'), 'd1', shape()))).toEqual([]);
  });

  // A side plays one keeper, so the second takes the first's place rather than
  // being refused — nobody has to find the outgoing keeper and deselect them.
  it('swaps one keeper for another rather than seating both', () => {
    expect(names(toggleStarter(set('gk1', 'd1'), 'gk2', shape()))).toEqual(['d1', 'gk2']);
  });

  it('lets a keeper in even when the side is otherwise full', () => {
    const full = set('gk1', 'd1', 'd2', 'm1', 'f1');
    expect(names(toggleStarter(full, 'gk2', shape()))).toEqual(['d1', 'd2', 'f1', 'gk2', 'm1']);
  });

  it('refuses an outfielder once the side is full', () => {
    const full = set('gk1', 'd1', 'd2', 'm1', 'f1');
    expect(toggleStarter(full, 'f2', shape())).toBe(full);
  });

  // The whole reason the last place is held: fill up with outfielders and the
  // keeper has nowhere left to go.
  it('holds the last place for a keeper until there is one', () => {
    const four = set('d1', 'd2', 'm1', 'f1');
    expect(toggleStarter(four, 'f2', shape())).toBe(four);
    expect(names(toggleStarter(four, 'gk1', shape()))).toEqual(['d1', 'd2', 'f1', 'gk1', 'm1']);
  });

  it('opens that place again once a keeper is in', () => {
    const withKeeper = set('gk1', 'd1', 'd2', 'm1');
    expect(names(toggleStarter(withKeeper, 'f1', shape()))).toEqual(['d1', 'd2', 'f1', 'gk1', 'm1']);
  });

  // A squad that has nobody to put in goal is not held back for one.
  it('leaves every place open to a squad with no keeper on it', () => {
    const outfield = shape({ hasKeepers: false });
    const four = set('d1', 'd2', 'm1', 'f1');
    expect(names(toggleStarter(four, 'f2', outfield))).toEqual(['d1', 'd2', 'f1', 'f2', 'm1']);
  });

  it('takes anybody before a format settles how many start', () => {
    const any = shape({ format: null });
    expect(names(toggleStarter(set('d1', 'd2', 'm1', 'f1', 'f2'), 'gk1', any))).toHaveLength(6);
  });
});

describe('canStart', () => {
  it('says yes to somebody already starting, so they can be taken out', () => {
    expect(canStart(set('gk1', 'd1', 'd2', 'm1', 'f1'), 'd1', shape())).toBe(true);
  });

  it('says no to the outfielder who would take the keeper’s place', () => {
    expect(canStart(set('d1', 'd2', 'm1', 'f1'), 'f2', shape())).toBe(false);
    expect(canStart(set('d1', 'd2', 'm1', 'f1'), 'gk1', shape())).toBe(true);
  });

  it('says yes to a second keeper, which swaps rather than adds', () => {
    expect(canStart(set('gk1', 'd1', 'd2', 'm1', 'f1'), 'gk2', shape())).toBe(true);
  });
});

describe('placesOpenTo', () => {
  it('holds one back for a keeper, and gives it up once there is one', () => {
    expect(placesOpenTo(set('d1'), false, shape())).toBe(4);
    expect(placesOpenTo(set('gk1'), false, shape())).toBe(5);
    expect(placesOpenTo(set('d1'), true, shape())).toBe(5);
  });
});
