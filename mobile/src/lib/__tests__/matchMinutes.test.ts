import { computeMinutesPlayed, describeSpell } from '@/src/lib/matchMinutes';

const starter = (player_id: string) => ({ player_id, is_starter: true });
const bench = (player_id: string) => ({ player_id, is_starter: false });
const sub = (minute: number, on: string, off: string) =>
  ({ type: 'substitution' as const, minute, player_id: on, secondary_player_id: off });

const minutesFor = (result: ReturnType<typeof computeMinutesPlayed>, id: string) =>
  result.find((row) => row.playerId === id)?.minutes;

describe('computeMinutesPlayed', () => {
  const lineup = [starter('a'), starter('b'), bench('c'), bench('d')];

  it('credits a starter the whole match so far', () => {
    const result = computeMinutesPlayed(lineup, [], 60);
    expect(minutesFor(result, 'a')).toBe(60);
  });

  it('stops the clock for a player taken off — the case from the report', () => {
    // Started, came off on 60, match has run to 90.
    const result = computeMinutesPlayed(lineup, [sub(60, 'c', 'a')], 90);
    expect(minutesFor(result, 'a')).toBe(60);
  });

  it('starts the clock when a substitute comes on', () => {
    const result = computeMinutesPlayed(lineup, [sub(60, 'c', 'a')], 90);
    expect(minutesFor(result, 'c')).toBe(30);
  });

  it('leaves an unused substitute out entirely rather than crediting zero', () => {
    const result = computeMinutesPlayed(lineup, [], 90);
    expect(minutesFor(result, 'd')).toBeUndefined();
  });

  it('keeps up with a running match rather than waiting for full time', () => {
    expect(minutesFor(computeMinutesPlayed(lineup, [], 12), 'a')).toBe(12);
    expect(minutesFor(computeMinutesPlayed(lineup, [], 47), 'a')).toBe(47);
  });

  it('handles a substitute who is themselves later replaced', () => {
    const result = computeMinutesPlayed(lineup, [sub(30, 'c', 'a'), sub(70, 'd', 'c')], 90);
    expect(minutesFor(result, 'a')).toBe(30);
    expect(minutesFor(result, 'c')).toBe(40);
    expect(minutesFor(result, 'd')).toBe(20);
  });

  it('never returns a negative spell when a minute is out of order', () => {
    const result = computeMinutesPlayed(lineup, [sub(80, 'c', 'a')], 40);
    // The clock has only reached 40, so the sub cannot be credited past it.
    expect(minutesFor(result, 'a')).toBeGreaterThanOrEqual(0);
    expect(minutesFor(result, 'c')).toBeGreaterThanOrEqual(0);
  });

  it('ignores a second arrival for the same player', () => {
    const result = computeMinutesPlayed(lineup, [sub(20, 'c', 'a'), sub(50, 'c', 'b')], 90);
    expect(minutesFor(result, 'c')).toBe(70);
  });

  it('falls back to the current minute when a substitution has none recorded', () => {
    const result = computeMinutesPlayed(lineup, [
      { type: 'substitution', minute: null, player_id: 'c', secondary_player_id: 'a' },
    ], 55);
    expect(minutesFor(result, 'a')).toBe(55);
    expect(minutesFor(result, 'c')).toBe(0);
  });
});

describe('describeSpell', () => {
  it('shows a plain figure for a player still on', () => {
    expect(describeSpell({ playerId: 'a', minutes: 60, onAt: 0, offAt: null, started: true })).toBe("60'");
  });

  it('shows the window for a player who came off', () => {
    expect(describeSpell({ playerId: 'a', minutes: 60, onAt: 0, offAt: 60, started: true })).toBe("60' (0–60')");
  });
});
