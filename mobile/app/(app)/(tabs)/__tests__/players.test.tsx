import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import PlayersScreen from '@/app/(app)/(tabs)/players';
import { api } from '@/src/lib/api';
import type { Player, PlayerLeaderRow, Team } from '@/src/types/api';

// Icon fonts pull in native asset loading that jest-expo does not resolve here.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('@/src/lib/api', () => ({
  api: { teams: jest.fn(), players: jest.fn(), leaders: jest.fn(), competitions: jest.fn(), awards: jest.fn() },
  ApiError: class extends Error {},
}));

const team = (id: string, name: string, age_group: string): Team => ({
  id, name, age_group, squad_code: null, season: '2026/27', is_aimz: true, is_active: true,
  logo_key: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '',
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
  { rank: 1, player: players[1]!, team: teams[1]!, goals: 5, assists: 2, yellow_cards: 1, red_cards: 0, appearances: 4 },
];

const competition = { id: 'c-1', name: 'Women U11', season: '2026/27', type: 'league' as const, team_count: null, created_at: '', updated_at: '' };
const awards = {
  competition,
  player_awards: [
    { label: 'Most man of the match', player: players[1]!, team: teams[1]!, value: 2, unit: 'awards' },
    { label: 'Top scorer', player: players[1]!, team: teams[1]!, value: 5, unit: 'goals' },
  ],
  team_awards: [],
};

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
    jest.mocked(api.competitions).mockResolvedValue({ items: [competition], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.awards).mockResolvedValue(awards);
  });
  afterEach(() => jest.clearAllMocks());

  it('offers two top-level tabs, with the rankings folded into Player stats', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByRole('tab', { name: 'Teams' });
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Player stats' })).toBeTruthy();
    // These three were their own tabs and are now award rows.
    expect(screen.queryByRole('tab', { name: 'Top Scorers' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Top Assisters' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Discipline' })).toBeNull();
  });

  it('lists the squads that exist, not a fixed set of age groups', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    expect(await screen.findByLabelText('AIMZ U9, 1 player')).toBeTruthy();
    expect(screen.getByLabelText('AIMZ U13, 1 player')).toBeTruthy();
    // The old screen hardcoded U9/U11/U13/U15/U18 regardless of the data.
    expect(screen.queryByLabelText(/^U11/)).toBeNull();
    expect(screen.queryByText('Salma Nabil')).toBeNull();
  });

  it('shows a squad added later without any code change', async () => {
    const added = [...teams, team('t-u15', 'AIMZ U15', 'U15')];
    jest.mocked(api.teams).mockResolvedValue({ items: added, total: added.length, limit: 100, offset: 0 });
    const screen = await render(<PlayersScreen />, { wrapper });
    expect(await screen.findByLabelText('AIMZ U15, 0 players')).toBeTruthy();
  });

  it('leaves out squads that are not AIMZ', async () => {
    const withOpponent = [...teams, { ...team('t-opp', 'Giza Lions', 'U13'), is_aimz: false }];
    jest.mocked(api.teams).mockResolvedValue({ items: withOpponent, total: withOpponent.length, limit: 100, offset: 0 });
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByLabelText('AIMZ U9, 1 player');
    expect(screen.queryByLabelText(/Giza Lions/)).toBeNull();
  });

  it('drills into a squad to reveal its players, then back out', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('AIMZ U13, 1 player'));
    expect(await screen.findByText('Mariam Adel')).toBeTruthy();
    expect(screen.queryByText('Salma Nabil')).toBeNull();

    fireEvent.press(screen.getByLabelText('Back to all teams'));
    expect(await screen.findByLabelText('AIMZ U9, 1 player')).toBeTruthy();
    expect(screen.queryByText('Mariam Adel')).toBeNull();
  });

  it('opens the top scorer award to reveal the ranking behind it', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByLabelText('AIMZ U9, 1 player');
    fireEvent.press(screen.getByRole('tab', { name: 'Player stats' }));
    expect(await screen.findByText('Top scorer')).toBeTruthy();
    // Collapsed, the award shows only its winner; the ranking is not fetched.
    expect(api.leaders).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Show the full top scorer ranking'));
    await waitFor(() => expect(api.leaders).toHaveBeenCalledWith('goals', { competitionId: 'c-1', limit: 25 }));
    // The ranked row carries its own subtitle, which the award header does not.
    expect(await screen.findByText('AIMZ U13, 5 goals in 4 appearances')).toBeTruthy();
  });

  it('leaves an award with no ranking behind it as a plain row', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByLabelText('AIMZ U9, 1 player');
    fireEvent.press(screen.getByRole('tab', { name: 'Player stats' }));
    expect(await screen.findByText('Most man of the match')).toBeTruthy();
    expect(screen.queryByLabelText(/Show the full most man of the match/)).toBeNull();
  });
});
