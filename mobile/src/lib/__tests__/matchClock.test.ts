import { formatMatchClock, getMatchClockState, minutesPlayedSoFar } from '@/src/lib/matchClock';

const at = Date.parse('2026-08-20T12:00:00.000Z');

describe('match clock', () => {
  it('formats football minutes and seconds', () => {
    expect(formatMatchClock(0)).toBe('00:00');
    expect(formatMatchClock(45 * 60 + 9)).toBe('45:09');
    expect(formatMatchClock(121 * 60 + 3)).toBe('121:03');
  });

  it('runs the first and second halves from their standard bases', () => {
    const first = getMatchClockState({ status: 'live', phase: 'first_half', phase_started_at: '2026-08-20T11:30:00.000Z' }, at);
    expect(first.clockText).toBe('30:00');
    expect(first.regulationProgress).toBeCloseTo(1 / 3);
    const second = getMatchClockState({ status: 'live', phase: 'second_half', phase_started_at: '2026-08-20T11:50:00.000Z' }, at);
    expect(second.clockText).toBe('55:00');
    expect(second.regulationProgress).toBeCloseTo(11 / 18);
  });

  it('freezes the halftime presentation at half progress', () => {
    expect(getMatchClockState({ status: 'live', phase: 'halftime', phase_started_at: null }, at)).toMatchObject({ label: 'HALFTIME', clockText: null, isRunning: false, regulationProgress: 0.5 });
  });

  it('starts extra time at 90 and caps only its progress', () => {
    const extra = getMatchClockState({ status: 'live', phase: 'extra_time', phase_started_at: '2026-08-20T11:40:00.000Z' }, at);
    expect(extra.clockText).toBe('110:00');
    expect(extra.extraTimeProgress).toBeCloseTo(2 / 3);
    const stoppage = getMatchClockState({ status: 'live', phase: 'extra_time', phase_started_at: '2026-08-20T11:20:00.000Z' }, at);
    expect(stoppage.clockText).toBe('130:00');
    expect(stoppage.extraTimeProgress).toBe(1);
  });

  it('uses the configured regulation and extra-time lengths', () => {
    const custom = getMatchClockState({
      status: 'live',
      phase: 'extra_time',
      phase_started_at: '2026-08-20T11:45:00.000Z',
      half_length_minutes: 30,
      num_halves: 2,
      extra_time_half_length_minutes: 10,
    }, at);
    expect(custom.clockText).toBe('75:00');
    expect(custom.extraTimeProgress).toBe(0.75);
  });

  it('shows full time without a running clock', () => {
    expect(getMatchClockState({ status: 'finished', phase: 'finished', phase_started_at: null }, at)).toMatchObject({ label: 'FULL TIME', clockText: null, isRunning: false });
  });
});

describe('minutesPlayedSoFar', () => {
  const match = { status: 'live' as const, phase: 'first_half' as const, phase_started_at: '2026-08-20T18:30:00.000Z', half_length_minutes: 45, num_halves: 2 };

  it('follows the running clock', () => {
    expect(minutesPlayedSoFar(match, { phase: 'first_half', currentMinute: 23 })).toBe(23);
  });

  // The displayed minute is null whenever the clock stops, which used to drop
  // every player on the pitch to nil — and saving minutes then wrote the nils.
  it('holds the half at halftime rather than dropping to nothing', () => {
    expect(minutesPlayedSoFar(match, { phase: 'halftime', currentMinute: null })).toBe(45);
  });

  it('credits the full match once it has finished', () => {
    expect(minutesPlayedSoFar(match, { phase: 'finished', currentMinute: null })).toBe(90);
  });

  it('counts nothing before kickoff', () => {
    expect(minutesPlayedSoFar(match, { phase: 'not_started', currentMinute: null })).toBe(0);
  });

  it('measures the halves the match actually plays', () => {
    const short = { ...match, half_length_minutes: 30 };
    expect(minutesPlayedSoFar(short, { phase: 'halftime', currentMinute: null })).toBe(30);
    expect(minutesPlayedSoFar(short, { phase: 'finished', currentMinute: null })).toBe(60);
  });
});
