import { displayMinute, getMatchClockState } from '@/src/lib/matchClock';

describe('displayMinute', () => {
  it('reads the first minute from kickoff, not a minute later', () => {
    // The old flooring count sat on 0' for a full minute and looked stopped.
    expect(displayMinute(0)).toBe(1);
    expect(displayMinute(1)).toBe(1);
    expect(displayMinute(59)).toBe(1);
  });

  it('turns over on the minute', () => {
    expect(displayMinute(60)).toBe(2);
    expect(displayMinute(119)).toBe(2);
    expect(displayMinute(120)).toBe(3);
  });

  it('holds at the end of the period instead of running into stoppage', () => {
    const half = 45 * 60;
    expect(displayMinute(half - 1, half)).toBe(45);
    expect(displayMinute(half, half)).toBe(45);
    expect(displayMinute(half + 200, half)).toBe(45);
  });
});

describe('getMatchClockState', () => {
  const startedAt = '2026-08-21T18:00:00.000Z';
  const live = {
    status: 'live' as const,
    phase: 'first_half' as const,
    phase_started_at: startedAt,
    half_length_minutes: 45,
    num_halves: 2,
    extra_time_half_length_minutes: 15,
  };

  it('is already running the moment the match starts', () => {
    const state = getMatchClockState(live, Date.parse(startedAt));
    expect(state.isRunning).toBe(true);
    expect(state.minuteLabel).toBe("1'");
    expect(state.currentMinute).toBe(1);
    expect(state.clockText).toBe('00:00');
  });

  it('ticks within the first minute rather than appearing frozen', () => {
    const state = getMatchClockState(live, Date.parse(startedAt) + 5_000);
    expect(state.clockText).toBe('00:05');
    expect(state.minuteLabel).toBe("1'");
  });

  it('carries the second half on from the first', () => {
    const secondHalf = { ...live, phase: 'second_half' as const };
    const state = getMatchClockState(secondHalf, Date.parse(startedAt));
    expect(state.currentMinute).toBe(46);
  });

  it('offers no minute to fall back on when the match is not running', () => {
    expect(getMatchClockState({ ...live, phase: 'halftime' }).currentMinute).toBeNull();
    expect(getMatchClockState({ ...live, status: 'finished', phase: 'finished' }).currentMinute).toBeNull();
    expect(getMatchClockState({ ...live, status: 'scheduled', phase: 'not_started' }).currentMinute).toBeNull();
  });
});
