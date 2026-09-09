import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import MatchesScreen from '@/app/(app)/(tabs)/index';
import { api } from '@/src/lib/api';
import type { Competition, StandingRow, Team } from '@/src/types/api';

/** What Manage names on the way here, when it names anything. */
let mockParams: { competition?: string } = {};

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/(app)/(tabs)',
}));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'player' } }) }));
jest.mock('@/src/lib/api', () => ({
  api: { matches: jest.fn(), competitions: jest.fn(), standings: jest.fn(), bracket: jest.fn() },
  ApiError: class extends Error {},
}));

const league: Competition = {
  id: 'c-1', name: 'Women Academy League', season: '2026', type: 'league',
  team_count: null, group_size: null, created_at: '', updated_at: '',
};

const team: Team = {
  id: 't-1', name: 'Giza Lions', is_aimz: false, squad_code: null, age_group: null, season: '2026',
  is_active: true, logo_key: null, badge_style: null, coach: null, assistant_coach: null,
  competition_id: null, competition_group_id: null, created_at: '', updated_at: '',
};

const table: StandingRow[] = [{
  rank: 1, team, played: 4, won: 1, drawn: 1, lost: 2, goals_for: 5, goals_against: 4,
  goal_difference: 1, points: 9, form: ['W'],
}];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('MatchesScreen navigation', () => {
  beforeEach(() => {
    mockParams = {};
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.mocked(api.matches).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    jest.mocked(api.competitions).mockResolvedValue({ items: [league], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.standings).mockResolvedValue(table);
  });
  afterEach(() => jest.restoreAllMocks());

  it('switches the match query through the fixed status segments', async () => {
    const screen = await render(<MatchesScreen />, { wrapper });

    await waitFor(() => expect(api.matches).toHaveBeenCalledWith('?match_status=live&limit=50'));
    await fireEvent.press(screen.getByRole('tab', { name: 'Results' }));
    await waitFor(() => expect(api.matches).toHaveBeenCalledWith('?match_status=finished&limit=50'));
    expect(screen.getByRole('tab', { name: 'Results' }).props.accessibilityState.selected).toBe(true);
  });

  // The table is the segment past Results rather than a tab of its own.
  it('reads the table from the last segment, and stops asking for matches', async () => {
    const screen = await render(<MatchesScreen />, { wrapper });
    await waitFor(() => expect(api.matches).toHaveBeenCalledWith('?match_status=live&limit=50'));
    jest.mocked(api.matches).mockClear();

    await fireEvent.press(screen.getByRole('tab', { name: 'Standings' }));

    expect(await screen.findByTestId('standings-content')).toBeTruthy();
    expect(await screen.findByText('Giza Lions')).toBeTruthy();
    // Nothing to ask for while the table is up, so the poll stops with it.
    expect(api.matches).not.toHaveBeenCalled();
  });

  /**
   * Saving a drawn-up competition in Manage pushes here naming it. Standings
   * had a route of its own to be sent to before; now the page it lives on has
   * to open on the right segment itself.
   */
  it('opens on the table when the route names a competition', async () => {
    mockParams = { competition: 'c-1' };
    const screen = await render(<MatchesScreen />, { wrapper });

    expect(await screen.findByTestId('standings-content')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Standings' }).props.accessibilityState.selected).toBe(true);
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-1'));
  });
});
