import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import PlayersScreen from '@/app/(app)/(tabs)/players';
import { api } from '@/src/lib/api';
import type { AwardRank, Player, Team } from '@/src/types/api';

// Icon fonts pull in native asset loading that jest-expo does not resolve here.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('@/src/lib/api', () => ({
  api: { teams: jest.fn(), players: jest.fn(), awardRanking: jest.fn(), competitions: jest.fn(), awards: jest.fn(), playerStats: jest.fn(), matches: jest.fn() },
  ApiError: class extends Error {},
}));

// Who is signed in decides whether the My Stats tab is offered at all.
let mockUser: { role: string; player_id: string | null } | null = { role: 'player', player_id: 'p-1' };
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));

const team = (id: string, name: string, age_group: string): Team => ({
  id, name, age_group, squad_code: null, season: '2026/27', is_aimz: true, is_active: true,
  logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '',
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
const scorers: AwardRank[] = [
  { rank: 1, player: players[1]!, team: teams[1]!, value: 5, unit: 'goals', appearances: 4 },
];
const ever_present: AwardRank[] = [
  { rank: 1, player: players[1]!, team: teams[1]!, value: 3, unit: 'appearances', appearances: 3 },
  { rank: 2, player: players[0]!, team: teams[0]!, value: 1, unit: 'appearances', appearances: 1 },
];

const competition = { id: 'c-1', name: 'Women U11', season: '2026/27', type: 'league' as const, team_count: null, group_size: null, created_at: '', updated_at: '' };
const awards = {
  competition,
  player_awards: [
    { metric: 'motm' as const, label: 'Most man of the match', player: players[1]!, team: teams[1]!, value: 2, unit: 'awards' },
    { metric: 'goals' as const, label: 'Top scorer', player: players[1]!, team: teams[1]!, value: 5, unit: 'goals' },
    { metric: 'appearances' as const, label: 'Most appearances', player: players[1]!, team: teams[1]!, value: 3, unit: 'appearances' },
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
    jest.mocked(api.awardRanking).mockResolvedValue(scorers);
    jest.mocked(api.competitions).mockResolvedValue({ items: [competition], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.awards).mockResolvedValue(awards);
  });
  afterEach(() => { jest.clearAllMocks(); mockUser = { role: 'player', player_id: 'p-1' }; });

  it('shows the signed-in player their own stats under My Stats', async () => {
    mockUser = { role: 'player', player_id: 'p-1' };
    jest.mocked(api.playerStats).mockResolvedValue({
      player: players[0]!, season: '2026/27', appearances: 4, minutes_played: 300,
      goals: 3, assists: 2, own_goals: 0, yellow_cards: 1, red_cards: 0, matches: [],
    });
    jest.mocked(api.matches).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const screen = await render(<PlayersScreen />, { wrapper });
    fireEvent.press(await screen.findByRole('tab', { name: 'My Stats' }));
    expect(await screen.findByText('Salma Nabil')).toBeTruthy();
    expect(screen.getByText('Appearances')).toBeTruthy();
    expect(screen.getByText('Match breakdown')).toBeTruthy();
    expect(api.playerStats).toHaveBeenCalledWith('p-1');
  });

  // An administrator has no roster record behind their login, so there are no
  // stats of their own to offer.
  it('leaves My Stats out for an account with no player behind it', async () => {
    mockUser = { role: 'admin', player_id: null };
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByRole('tab', { name: 'Teams' });
    expect(screen.queryByRole('tab', { name: 'My Stats' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('offers the academy tabs, plus the stats of whoever is signed in', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByRole('tab', { name: 'Teams' });
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Leaderboards' })).toBeTruthy();
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
    fireEvent.press(screen.getByRole('tab', { name: 'Leaderboards' }));
    expect(await screen.findByText('Top scorer')).toBeTruthy();
    // Collapsed, the award shows only its winner; the ranking is not fetched.
    expect(api.awardRanking).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Show the full top scorer ranking'));
    await waitFor(() => expect(api.awardRanking).toHaveBeenCalledWith('c-1', 'goals'));
    // The ranked row carries its own subtitle, which the award header does not.
    expect(await screen.findByText('AIMZ U13, 5 goals in 4 appearances')).toBeTruthy();
  });

  it('opens every award, not just the two with a leaderboard behind them', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByLabelText('AIMZ U9, 1 player');
    fireEvent.press(screen.getByRole('tab', { name: 'Leaderboards' }));
    await screen.findByText('Top scorer');
    for (const label of ['most man of the match', 'top scorer', 'most appearances']) {
      expect(screen.getByLabelText(`Show the full ${label} ranking`)).toBeTruthy();
    }
  });

  it('asks for the ranking of whichever award was opened', async () => {
    jest.mocked(api.awardRanking).mockResolvedValue(ever_present);
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByLabelText('AIMZ U9, 1 player');
    fireEvent.press(screen.getByRole('tab', { name: 'Leaderboards' }));
    fireEvent.press(await screen.findByLabelText('Show the full most appearances ranking'));
    await waitFor(() => expect(api.awardRanking).toHaveBeenCalledWith('c-1', 'appearances'));
    // Counting appearances in appearances would read twice; and one is singular.
    expect(await screen.findByText('AIMZ U13, 3 appearances')).toBeTruthy();
    expect(screen.getByText('AIMZ U9, 1 appearance')).toBeTruthy();
  });

  it('closes an opened award again', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByLabelText('AIMZ U9, 1 player');
    fireEvent.press(screen.getByRole('tab', { name: 'Leaderboards' }));
    fireEvent.press(await screen.findByLabelText('Show the full top scorer ranking'));
    expect(await screen.findByText('AIMZ U13, 5 goals in 4 appearances')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Hide the full top scorer ranking'));
    await waitFor(() => expect(screen.queryByText('AIMZ U13, 5 goals in 4 appearances')).toBeNull());
  });
});
