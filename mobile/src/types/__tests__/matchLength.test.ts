import { totalMatchMinutes } from '@/src/types/api';

describe('totalMatchMinutes', () => {
  it('adds one break between two standard halves', () => {
    expect(totalMatchMinutes({ half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15 })).toBe(105);
  });

  it('counts a break between every period, not one flat break', () => {
    // Quarters: 4 × 20 playing, 3 breaks of 5.
    expect(totalMatchMinutes({ half_length_minutes: 20, num_halves: 4, half_time_break_minutes: 5 })).toBe(95);
  });

  it('charges no break for a single period', () => {
    expect(totalMatchMinutes({ half_length_minutes: 30, num_halves: 1, half_time_break_minutes: 15 })).toBe(30);
  });

  it('handles a zero-length break', () => {
    expect(totalMatchMinutes({ half_length_minutes: 25, num_halves: 2, half_time_break_minutes: 0 })).toBe(50);
  });
});
