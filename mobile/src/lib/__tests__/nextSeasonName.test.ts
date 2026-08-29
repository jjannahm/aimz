import { nextSeasonName } from '@/src/components/manage/SeasonControls';

describe('nextSeasonName', () => {
  it('rolls a split season on by one at both ends', () => {
    expect(nextSeasonName('2025/26')).toBe('2026/27');
    expect(nextSeasonName('2026/27')).toBe('2027/28');
  });

  // The century, not the year, is what a two-digit tail rolls over.
  it('wraps a two-digit tail at the century', () => {
    expect(nextSeasonName('2098/99')).toBe('2099/00');
  });

  it('handles a four-digit tail and stray spaces', () => {
    expect(nextSeasonName('2025/2026')).toBe('2026/2027');
    expect(nextSeasonName(' 2025 / 26 ')).toBe('2026/27');
  });

  it('rolls a single year on', () => {
    expect(nextSeasonName('2026')).toBe('2027');
  });

  // A season named some other way is left to the admin rather than guessed at.
  it('offers nothing when it cannot tell', () => {
    expect(nextSeasonName('Spring')).toBe('');
    expect(nextSeasonName('')).toBe('');
  });
});
