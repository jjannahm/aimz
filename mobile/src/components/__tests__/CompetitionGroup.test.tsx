import { render } from '@testing-library/react-native';

import { CompetitionGroup } from '@/src/components/CompetitionGroup';
import type { Match } from '@/src/types/api';

const match: Match = {
  id: 'match', competition_id: 'competition', home_team_id: 'home', away_team_id: 'away',
  kickoff_datetime: '2026-08-20T18:30:00.000Z', venue: 'AIMZ Arena', status: 'scheduled', phase: 'not_started', phase_started_at: null,
  home_score: 0, away_score: 0, revision: 0, lineup_format: null, formation: null, man_of_the_match_player_id: null, half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: false, extra_time_half_length_minutes: 15, created_at: '', updated_at: '', home_team: null, away_team: null,
  competition: { id: 'competition', name: 'Women Academy League', season: '2026/27', type: 'league', created_at: '', updated_at: '' },
};

describe('CompetitionGroup', () => {
  it('shows the competition initials fallback and its matches', async () => {
    const screen = await render(<CompetitionGroup group={{ competitionId: 'competition', competitionName: 'Women Academy League', matches: [match] }} />);
    expect(JSON.stringify(screen.toJSON())).toContain('WA');
    expect(screen.getByText('Women Academy League')).toBeTruthy();
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Away')).toBeTruthy();
  });
});
