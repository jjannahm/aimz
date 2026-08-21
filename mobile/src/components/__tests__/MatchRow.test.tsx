import { render } from '@testing-library/react-native';

import { MatchRow } from '@/src/components/MatchRow';
import type { Match } from '@/src/types/api';

const base: Match = {
  id: 'match-row', competition_id: 'competition', home_team_id: 'home', away_team_id: 'away',
  kickoff_datetime: '2026-08-20T18:30:00.000Z', venue: 'AIMZ Arena', status: 'scheduled', phase: 'not_started', phase_started_at: null,
  home_score: 0, away_score: 0, revision: 0, lineup_format: null, formation: null, half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: true, extra_time_half_length_minutes: 15, created_at: '', updated_at: '',
  home_team: { id: 'home', name: 'AIMZ Women', squad_code: null, age_group: null, season: null, is_aimz: true, is_active: true, logo_key: null, coach: null, assistant_coach: null, competition_id: null, logo_url: null, created_at: '', updated_at: '' },
  away_team: { id: 'away', name: 'Cairo Stars', squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true, logo_key: null, coach: null, assistant_coach: null, competition_id: null, logo_url: null, created_at: '', updated_at: '' },
  competition: { id: 'competition', name: 'Academy League', season: '2026/27', type: 'league', created_at: '', updated_at: '' },
};

describe('MatchRow', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-20T19:04:00.000Z')));
  afterEach(() => jest.restoreAllMocks());

  it('shows a localized kickoff for an upcoming match', async () => {
    const screen = await render(<MatchRow match={base} />);
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('AIMZ Women')).toBeTruthy();
    expect(screen.getByText('Cairo Stars')).toBeTruthy();
  });

  it.each([
    ['first_half', '2026-08-20T18:30:00.000Z', "34'"],
    ['halftime', null, 'HT'],
    ['second_half', '2026-08-20T18:49:00.000Z', "60'"],
    ['extra_time', '2026-08-20T18:49:00.000Z', "ET 105'"],
  ] as const)('shows the %s live state', async (phase, startedAt, label) => {
    const screen = await render(<MatchRow match={{ ...base, status: 'live', phase, phase_started_at: startedAt, home_score: 2, away_score: 1 }} />);
    expect(screen.getByText('2 - 1')).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('shows full time for a result', async () => {
    const screen = await render(<MatchRow match={{ ...base, status: 'finished', phase: 'finished', home_score: 3, away_score: 2 }} />);
    expect(screen.getByText('3 - 2')).toBeTruthy();
    expect(screen.getByText('FT')).toBeTruthy();
  });
});
