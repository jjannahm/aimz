import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { MatchCard } from '@/src/components/MatchCard';
import type { Match } from '@/src/types/api';

const match: Match = {
  id: 'match-1', competition_id: 'competition-1', home_team_id: 'home', away_team_id: 'away',
  kickoff_datetime: '2026-09-10T18:30:00+03:00', venue: 'AIMZ Training Ground', status: 'live',
  home_score: 2, away_score: 1, revision: 3,
  half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: false, extra_time_half_length_minutes: 15, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-10T00:00:00Z',
  home_team: { id: 'home', name: 'AIMZ Navy', squad_code: 'RTS S14', age_group: 'U14', season: '2026/27', is_aimz: true, is_active: true, logo_key: null, created_at: '', updated_at: '' },
  away_team: { id: 'away', name: 'Cairo Stars', squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true, logo_key: null, created_at: '', updated_at: '' },
  competition: { id: 'competition-1', name: 'Academy League', season: '2026/27', type: 'league', created_at: '', updated_at: '' },
};

describe('MatchCard', () => {
  it('announces the score and opens the match', async () => {
    const screen = await render(<MatchCard match={match} />);
    const card = screen.getByRole('button', { name: /AIMZ Navy 2, Cairo Stars 1. LIVE/i });
    fireEvent.press(card);
    expect(router.push).toHaveBeenCalledWith('/match/match-1');
    expect(screen.getByText('2–1')).toBeTruthy();
  });
});
