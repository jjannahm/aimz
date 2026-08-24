import { isOpponentOnly } from '@/src/lib/matchKind';
import type { Match, Team } from '@/src/types/api';

const team = (id: string, is_aimz: boolean) => ({ id, is_aimz } as Team);
const match = (home: Team | null, away: Team | null) => ({ home_team: home, away_team: away } as Match);

describe('isOpponentOnly', () => {
  it('is true only when both joined teams are opponents', () => {
    expect(isOpponentOnly(match(team('home', false), team('away', false)))).toBe(true);
    expect(isOpponentOnly(match(team('home', true), team('away', false)))).toBe(false);
    expect(isOpponentOnly(match(team('home', false), team('away', true)))).toBe(false);
  });

  it('stays false while either joined team is unavailable', () => {
    expect(isOpponentOnly(match(null, team('away', false)))).toBe(false);
    expect(isOpponentOnly(undefined)).toBe(false);
  });
});
