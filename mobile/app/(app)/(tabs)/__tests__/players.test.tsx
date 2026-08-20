import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import PlayersScreen from '@/app/(app)/(tabs)/players';
import { api } from '@/src/lib/api';
import type { Player, PlayerLeaderRow, Team } from '@/src/types/api';

// Icon fonts pull in native asset loading that jest-expo does not resolve here.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('@/src/lib/api', () => ({
  api: { teams: jest.fn(), players: jest.fn(), leaders: jest.fn() },
  ApiError: class extends Error {},
}));

const team = (id: string, name: string, age_group: string): Team => ({
  id, name, age_group, squad_code: null, season: '2026/27', is_aimz: true, is_active: true,
  logo_key: null, created_at: '', updated_at: '',
});

const player = (id: string, name: string, team_id: string, jersey_number: number): Player => ({
  id, name, team_id, position: 'Forward', jersey_number, photo_key: null, photo_url: null,
  is_active: true, created_at: '', updated_at: '',
});

const teams = [team('t-u9', 'AIMZ U9', 'U9'), team('t-u13', 'AIMZ U13', 'U13')];
const players = [
  player('p-1', 'Salma Nabil', 't-u9', 7),
  player('p-2', 'Mariam Adel', 't-u13', 9),
];
const scorers: PlayerLeaderRow[] = [
  { rank: 1, player: players[1]!, team: teams[1]!, goals: 5, assists: 2, appearances: 4 },
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// The first render in this suite compiles the screen tree and can exceed the 5s default.
jest.setTimeout(30_000);

describe('PlayersScreen', () => {
  beforeEach(() => {
    jest.mocked(api.teams).mockResolvedValue({ items: teams, total: teams.length, limit: 100, offset: 0 });
    jest.mocked(api.players).mockResolvedValue({ items: players, total: players.length, limit: 100, offset: 0 });
    jest.mocked(api.leaders).mockResolvedValue(scorers);
  });
  afterEach(() => jest.clearAllMocks());

  it('offers exactly three top-level tabs', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByRole('tab', { name: 'Teams' });
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Top Scorers' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Top Assisters' })).toBeTruthy();
  });

  it('opens on the team list rather than any single squad', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    expect(await screen.findByLabelText('U9, 1 player')).toBeTruthy();
    expect(screen.getByLabelText('U13, 1 player')).toBeTruthy();
    for (const ageGroup of ['U11', 'U15', 'U18']) {
      expect(screen.getByLabelText(`${ageGroup}, 0 players`)).toBeTruthy();
    }
    expect(screen.queryByText('Salma Nabil')).toBeNull();
  });

  it('drills into a team to reveal its players, then back out', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('U13, 1 player'));
    expect(await screen.findByText('Mariam Adel')).toBeTruthy();
    expect(screen.queryByText('Salma Nabil')).toBeNull();

    fireEvent.press(screen.getByLabelText('Back to all teams'));
    expect(await screen.findByLabelText('U9, 1 player')).toBeTruthy();
    expect(screen.queryByText('Mariam Adel')).toBeNull();
  });

  it('shows an empty state for a team with no players', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('U18, 0 players'));
    expect(await screen.findByText('No U18 players yet')).toBeTruthy();
  });

  it('loads the goals leaderboard from the Top Scorers tab', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByLabelText('U9, 1 player');
    fireEvent.press(screen.getByRole('tab', { name: 'Top Scorers' }));
    await waitFor(() => expect(api.leaders).toHaveBeenCalledWith('goals', { limit: 25 }));
    expect(await screen.findByText('Mariam Adel')).toBeTruthy();
  });
});
