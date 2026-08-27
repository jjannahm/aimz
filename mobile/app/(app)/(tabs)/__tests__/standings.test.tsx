import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useLocalSearchParams } from 'expo-router';

import StandingsScreen from '@/app/(app)/(tabs)/standings';
import { api } from '@/src/lib/api';
import type { Competition, StandingRow, Team } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'player' } }) }));
// Reached from the tab bar here, so no competition is named in the route.
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})) }));

jest.mock('@/src/lib/api', () => ({
  api: { competitions: jest.fn(), standings: jest.fn(), headToHead: jest.fn() },
  ApiError: class extends Error {},
}));

const competition = (id: string, name: string, season: string): Competition => ({
  id, name, season, type: 'league', team_count: null, group_size: null, created_at: '', updated_at: '',
});

const team = (id: string, name: string, is_aimz = false): Team => ({
  id, name, is_aimz, squad_code: null, age_group: null, season: '2026', is_active: true,
  logo_key: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '',
});

const row = (rank: number, t: Team, points: number): StandingRow => ({
  rank, team: t, played: 4, won: 1, drawn: 1, lost: 2, goals_for: 5, goals_against: 4,
  goal_difference: 1, points, form: ['W', 'D', 'L', 'L'],
});

const league = competition('c-1', 'Women Academy League', '2026');
const cup = competition('c-2', 'Delta Cup', '2026');
const table = [
  row(1, team('t-1', 'Giza Lions'), 9),
  row(2, team('t-2', 'AIMZ U18 Women', true), 6),
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

jest.setTimeout(30_000);

describe('StandingsScreen', () => {
  beforeEach(() => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.standings).mockResolvedValue(table);
  });
  afterEach(() => jest.clearAllMocks());

  it('heads the screen with the competition name and season on separate lines', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    expect(await screen.findByLabelText('Women Academy League, season 2026')).toBeTruthy();
    expect(screen.getByText('Women Academy League')).toBeTruthy();
    expect(screen.getByText('2026')).toBeTruthy();
    expect(screen.queryByText('WA')).toBeNull();
    // The old header ran the two together inside one pill.
    expect(screen.queryByText('Women Academy League · 2026')).toBeNull();
  });

  it('hides the switcher when only one competition is running', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Women Academy League');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('offers a switcher and changes table when several competitions run', async () => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league, cup], total: 2, limit: 100, offset: 0 });
    const screen = await render(<StandingsScreen />, { wrapper });

    expect(await screen.findByRole('tab', { name: 'Women Academy League' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    // Defaults to the first competition.
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-1'));

    fireEvent.press(screen.getByRole('tab', { name: 'Delta Cup' }));
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-2'));
    expect(await screen.findByLabelText('Delta Cup, season 2026')).toBeTruthy();
  });

  it('badges each team by whether it is ours', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Giza Lions');
    // One AIMZ squad and one opponent are in the fixture table.
    expect(screen.getByTestId('badge-aimz', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('badge-opponent', { includeHiddenElements: true })).toBeTruthy();
  });

  it('marks first place with a trophy that nobody else gets', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Giza Lions');
    // Rank 1 only — a second trophy would make the highlight meaningless.
    expect(screen.getAllByLabelText('First place')).toHaveLength(1);
  });
});

describe('StandingsScreen — form guide', () => {
  beforeEach(() => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.standings).mockResolvedValue(table);
  });
  afterEach(() => jest.clearAllMocks());

  it('reads the last five results newest first', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    // Both fixture rows carry W, D, L, L, so both teams get a strip.
    expect(await screen.findAllByLabelText('Recent form: won, drew, lost, lost')).toHaveLength(table.length);
  });

  it('leaves out the strip for a team that has not played', async () => {
    jest.mocked(api.standings).mockResolvedValue([
      { ...row(1, team('t-3', 'Newly Entered'), 0), played: 0, won: 0, drawn: 0, lost: 0, form: [] },
    ]);
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Newly Entered');
    expect(screen.queryByLabelText(/^Recent form/)).toBeNull();
  });
});

// Arriving from Manage after setting a competition up: the admin should land on
// that table, not on whichever competition happens to sort first.
describe('StandingsScreen — arriving from Manage', () => {
  beforeEach(() => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league, cup], total: 2, limit: 100, offset: 0 });
    jest.mocked(api.standings).mockResolvedValue(table);
  });
  afterEach(() => jest.clearAllMocks());

  it('opens the competition the route names', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ competition: 'c-2' });
    const screen = await render(<StandingsScreen />, { wrapper });
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-2'));
    expect(screen.getByLabelText('Delta Cup, season 2026')).toBeTruthy();
  });

  it('falls back to the first competition when the route names none', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({});
    await render(<StandingsScreen />, { wrapper });
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-1'));
  });
});
