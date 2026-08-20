import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import MatchDetailScreen from '@/app/(app)/match/[id]';
import { api } from '@/src/lib/api';
import { confirmAction } from '@/src/lib/platformAlert';
import type { LiveMatchSnapshot, Match } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'match-1' }),
  Redirect: 'Redirect',
}));
jest.mock('@/src/lib/platformAlert', () => ({ confirmAction: jest.fn(), showMessage: jest.fn() }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
jest.mock('@/src/lib/api', () => ({
  api: { live: jest.fn(), players: jest.fn(), setMatchPhase: jest.fn() },
  ApiError: class extends Error {},
}));

const match = (over: Partial<Match> = {}): Match => ({
  id: 'match-1', competition_id: 'c-1', home_team_id: 'home', away_team_id: 'away',
  kickoff_datetime: '2026-08-20T18:30:00.000Z', venue: 'AIMZ Arena',
  status: 'live', phase: 'first_half', phase_started_at: '2026-08-20T18:30:00.000Z',
  home_score: 1, away_score: 0, revision: 1, lineup_format: null,
  half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: false, extra_time_half_length_minutes: 15,
  created_at: '', updated_at: '',
  home_team: { id: 'home', name: 'AIMZ U18', squad_code: null, age_group: 'U18', season: '2026', is_aimz: true, is_active: true, logo_key: null, created_at: '', updated_at: '' },
  away_team: { id: 'away', name: 'Giza Lions', squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true, logo_key: null, created_at: '', updated_at: '' },
  competition: { id: 'c-1', name: 'Women Academy League', season: '2026', type: 'league', created_at: '', updated_at: '' },
  ...over,
});

const snapshot = (over: Partial<Match> = {}): LiveMatchSnapshot =>
  ({ match: match(over), events: [], lineup: [], revision: 1 }) as LiveMatchSnapshot;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

jest.setTimeout(30_000);

describe('MatchDetailScreen — End match', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    jest.mocked(api.setMatchPhase).mockResolvedValue(match({ status: 'finished' }));
  });
  afterEach(() => jest.clearAllMocks());

  it('offers End match while the match is live', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot());
    const screen = await render(<MatchDetailScreen />, { wrapper });
    expect(await screen.findByText('End match')).toBeTruthy();
  });

  it('hides End match once the match is finished', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot({ status: 'finished', phase: 'finished' }));
    const screen = await render(<MatchDetailScreen />, { wrapper });
    await screen.findByText('Open live scoring');
    expect(screen.queryByText('End match')).toBeNull();
  });

  it('hides End match before kickoff', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot({ status: 'scheduled', phase: 'not_started' }));
    const screen = await render(<MatchDetailScreen />, { wrapper });
    await screen.findByText('Open match management');
    expect(screen.queryByText('End match')).toBeNull();
  });

  it('asks for confirmation and only then finishes the match', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot());
    const screen = await render(<MatchDetailScreen />, { wrapper });
    fireEvent.press(await screen.findByText('End match'));

    // Nothing is sent until the confirmation is accepted.
    expect(api.setMatchPhase).not.toHaveBeenCalled();
    expect(confirmAction).toHaveBeenCalledWith(
      'End this match now?', 'Final score will be locked in.', 'End match', expect.any(Function),
    );

    const confirm = jest.mocked(confirmAction).mock.calls[0]![3];
    confirm();
    await waitFor(() => expect(api.setMatchPhase).toHaveBeenCalledWith('match-1', 'finish_match'));
  });
});
