import { totalMatchMinutes, type MatchTimeStructure } from '@/src/types/api';

const structure = (over: Partial<MatchTimeStructure> = {}): MatchTimeStructure => ({
  half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: false, extra_time_half_length_minutes: 15, ...over,
});

describe('totalMatchMinutes', () => {
  it('adds one break between two standard halves', () => {
    expect(totalMatchMinutes(structure())).toBe(105);
  });

  it('counts a break between every period, not one flat break', () => {
    // Quarters: 4 × 20 playing, 3 breaks of 5.
    expect(totalMatchMinutes(structure({ half_length_minutes: 20, num_halves: 4, half_time_break_minutes: 5 }))).toBe(95);
  });

  it('charges no break for a single period', () => {
    expect(totalMatchMinutes(structure({ half_length_minutes: 30, num_halves: 1 }))).toBe(30);
  });

  it('handles a zero-length break', () => {
    expect(totalMatchMinutes(structure({ half_length_minutes: 25, half_time_break_minutes: 0 }))).toBe(50);
  });

  it('adds two extra-time periods when extra time is on', () => {
    expect(totalMatchMinutes(structure({ has_extra_time: true }))).toBe(135);
    expect(totalMatchMinutes(structure({ has_extra_time: true, extra_time_half_length_minutes: 10 }))).toBe(125);
  });

  it('ignores the extra-time length while extra time is off', () => {
    expect(totalMatchMinutes(structure({ has_extra_time: false, extra_time_half_length_minutes: 30 }))).toBe(105);
  });
});
