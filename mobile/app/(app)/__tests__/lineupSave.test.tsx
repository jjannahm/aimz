import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import LineupScreen from '@/app/(app)/lineup/[id]';
import { api } from '@/src/lib/api';
import { showMessage } from '@/src/lib/platformAlert';
import { router } from 'expo-router';
import type { LiveMatchSnapshot, Match } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'match-1' }),
  Redirect: 'Redirect',
}));
jest.mock('@/src/lib/platformAlert', () => ({ confirmAction: jest.fn(), showMessage: jest.fn() }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
jest.mock('@/src/lib/api', () => ({
  api: { live: jest.fn(), players: jest.fn(), lineup: jest.fn(), updateMatch: jest.fn() },
  ApiError: class extends Error {},
}));

const match: Match = {
  id: 'match-1', competition_id: 'c-1', home_team_id: 'home', away_team_id: 'away',
  kickoff_datetime: '2026-08-20T18:30:00.000Z', venue: 'AIMZ Arena',
  status: 'scheduled', phase: 'not_started', phase_started_at: null,
  home_score: 0, away_score: 0, revision: 1, lineup_format: 11, formation: '4-4-2',
  half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: false, extra_time_half_length_minutes: 15, created_at: '', updated_at: '',
  home_team: { id: 'home', name: 'AIMZ U18', squad_code: null, age_group: 'U18', season: '2026', is_aimz: true, is_active: true, logo_key: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '' },
  away_team: { id: 'away', name: 'Giza Lions', squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true, logo_key: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '' },
  competition: { id: 'c-1', name: 'Women Academy League', season: '2026', type: 'league', team_count: null, created_at: '', updated_at: '' },
} as Match;

// A lineup already stored, so the screen opens filled in and ready to save —
// the state an admin is in when they correct a lineup and press save again.
const lineup = Array.from({ length: 11 }, (unused, index) => ({
  id: `l${index + 1}`, match_id: 'match-1', player_id: `p${index + 1}`, team_id: 'home',
  is_starter: true, is_captain: false, position: 'Midfielder', jersey_number: index + 1,
}));
const snapshot: LiveMatchSnapshot = { match, events: [], lineup, revision: 1 } as LiveMatchSnapshot;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const squad = Array.from({ length: 11 }, (unused, index) => ({
  id: `p${index + 1}`, name: `Player ${index + 1}`, team_id: 'home', position: 'Midfielder',
  jersey_number: index + 1, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '',
}));

async function saveAValidLineup() {
  const screen = await render(<LineupScreen />, { wrapper });
  fireEvent.press(await screen.findByText('Save lineup'));
  return screen;
}

describe('LineupScreen — saving', () => {
  beforeEach(() => {
    jest.mocked(api.live).mockResolvedValue(snapshot);
    jest.mocked(api.players).mockResolvedValue({ items: squad, total: squad.length, limit: 100, offset: 0 } as never);
    jest.mocked(api.lineup).mockResolvedValue([] as never);
    jest.mocked(api.updateMatch).mockResolvedValue(match as never);
  });
  afterEach(() => jest.clearAllMocks());

  it('lands on the match, and says nothing went wrong, when the save succeeds', async () => {
    await saveAValidLineup();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/match/match-1'));
    expect(showMessage).not.toHaveBeenCalled();
  });

  it('reports a failure and stays put when the match update is the thing that fails', async () => {
    // The entries saved and the format patch did not. The old build ran that
    // patch from `onSuccess`, so this arrived as "Lineup not saved" — after the
    // lineup had in fact been saved — and the redirect was lost with it.
    jest.mocked(api.updateMatch).mockRejectedValue(Object.assign(new Error('Check the highlighted fields.'), { fields: [{ field: 'has_extra_time', message: 'Must be true or false.' }] }));
    await saveAValidLineup();
    await waitFor(() => expect(showMessage).toHaveBeenCalled());
    expect(jest.mocked(showMessage).mock.calls[0]?.[1]).toContain('has_extra_time');
    expect(router.replace).not.toHaveBeenCalled();
  });
});
