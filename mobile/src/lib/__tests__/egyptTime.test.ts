import { formatEgyptDateTime, fromEgyptInputValue, fromEgyptWallClock, toEgyptInputValue, toEgyptWallClock } from '@/src/lib/egyptTime';

describe('egyptTime', () => {
  it('stores an Egypt wall clock as the UTC instant it names', () => {
    // Egypt runs three hours ahead of UTC, so a 6:30pm kickoff is 15:30Z.
    expect(fromEgyptWallClock({ year: 2026, month: 9, day: 5, hour: 18, minute: 30 }).toISOString())
      .toBe('2026-09-05T15:30:00.000Z');
  });

  it('reads an instant back as the Egypt wall clock', () => {
    expect(toEgyptWallClock(new Date('2026-09-05T15:30:00.000Z')))
      .toEqual({ year: 2026, month: 9, day: 5, hour: 18, minute: 30 });
  });

  it('round-trips a reading through the picker value', () => {
    const iso = fromEgyptInputValue('2026-09-05T18:30');
    expect(iso).toBe('2026-09-05T15:30:00.000Z');
    expect(toEgyptInputValue(iso!)).toBe('2026-09-05T18:30');
  });

  it('shows the admin a human reading, never an ISO string', () => {
    const shown = formatEgyptDateTime('2026-08-21T13:39:00.000Z');
    expect(shown).toBe('Aug 21, 2026 · 4:39 PM');
    expect(shown).not.toMatch(/Z|\+0/u);
  });

  it('refuses a value that is not a date and time', () => {
    expect(fromEgyptInputValue('')).toBeNull();
    expect(formatEgyptDateTime('nonsense')).toBe('Not set');
  });
});
