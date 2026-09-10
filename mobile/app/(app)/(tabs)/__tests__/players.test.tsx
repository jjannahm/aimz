import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import PlayersScreen from '@/app/(app)/(tabs)/players';
import { api } from '@/src/lib/api';
import type { AwardRank, Player, Team, TrainingAwardRank } from '@/src/types/api';

// Icon fonts pull in native asset loading that jest-expo does not resolve here.
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/players' }));

jest.mock('@/src/lib/api', () => ({
  api: { teams: jest.fn(), players: jest.fn(), awardRanking: jest.fn(), trainingAwards: jest.fn(), trainingAwardRanking: jest.fn(), competitions: jest.fn(), awards: jest.fn(), playerStats: jest.fn(), playerTrainingStats: jest.fn(), matches: jest.fn(), myChildren: jest.fn(), adminUsers: jest.fn() },
  ApiError: class extends Error {},
}));

// Who is signed in decides whether the My Stats tab is offered at all.
let mockUser: { role: string; player_id: string | null } | null = { role: 'player', player_id: 'p-1' };
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));

// Entered in a competition unless a test says otherwise: that is what decides
// whether the match half of a player's record exists at all.
const team = (id: string, name: string, age_group: string, competition_id: string | null = 'comp-1'): Team => ({
  id, name, age_group, squad_code: null, season: '2026/27', is_aimz: true, is_active: true,
  logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id, competition_group_id: null, created_at: '', updated_at: '',
});

const player = (id: string, name: string, team_id: string, jersey_number: number, position = 'ST'): Player => ({
  id, name, team_id, position, jersey_number, photo_key: null, photo_url: null,
  is_active: true, created_at: '', updated_at: '',
});

const teams = [team('t-u9', 'AIMZ U9', 'U9'), team('t-u13', 'AIMZ U13', 'U13')];
const players = [
  player('p-1', 'Salma Nabil', 't-u9', 7),
  player('p-2', 'Mariam Adel', 't-u13', 9, 'GK'),
];
const scorers: AwardRank[] = [
  { rank: 1, player: players[1]!, team: teams[1]!, value: 5, unit: 'goals', appearances: 4 },
];
const ever_present: AwardRank[] = [
  { rank: 1, player: players[1]!, team: teams[1]!, value: 3, unit: 'appearances', appearances: 3 },
  { rank: 2, player: players[0]!, team: teams[0]!, value: 1, unit: 'appearances', appearances: 1 },
];
const trainingLeader: TrainingAwardRank = {
  rank: 1,
  metric: { key: 'dribbling', label: 'Dribbling', kind: 'rating', min_value: 1, max_value: 10, unit: null, player_kind: 'outfield' },
  label: 'Best Dribbler', player: players[0]!, team: teams[0]!, value: 8.5, unit: '/10', sessions: 4,
};

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
    jest.mocked(api.trainingAwards).mockResolvedValue({ team: teams[0]!, player_awards: [trainingLeader] });
    jest.mocked(api.trainingAwardRanking).mockResolvedValue([trainingLeader]);
    jest.mocked(api.competitions).mockResolvedValue({ items: [competition], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.awards).mockResolvedValue(awards);
  });
  afterEach(() => { jest.clearAllMocks(); mockUser = { role: 'player', player_id: 'p-1' }; });

  // Scrolling every squad to find one player is what this replaces.
  it('finds a player across every squad at once', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    expect(await screen.findByText('AIMZ U9')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('search-input'), 'mariam');
    // Found without opening the squad she is in.
    expect(await screen.findByText('Mariam Adel')).toBeTruthy();
    expect(screen.queryByText('Salma Nabil')).toBeNull();
    // The squad is named on the row, because results cross squads.
    expect(screen.getByText('AIMZ U13 · Goalkeeper')).toBeTruthy();
  });

  it('searches a squad name and a position as well as a player name', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByText('AIMZ U9');

    await fireEvent.changeText(screen.getByTestId('search-input'), 'U13');
    expect(await screen.findByText('Mariam Adel')).toBeTruthy();

    // The position's name, not the code that is stored.
    await fireEvent.changeText(screen.getByTestId('search-input'), 'keeper');
    expect(await screen.findByText('Mariam Adel')).toBeTruthy();
    expect(screen.queryByText('Salma Nabil')).toBeNull();
  });

  it('says so when nothing matches, and gives the squads back when cleared', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByText('AIMZ U9');

    await fireEvent.changeText(screen.getByTestId('search-input'), 'zzzz');
    expect(await screen.findByText('Nothing matches that')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('search-clear'));
    expect(await screen.findByText('AIMZ U9')).toBeTruthy();
    expect(screen.getByText('AIMZ U13')).toBeTruthy();
  });

  it('shows the signed-in player their own stats under My Stats', async () => {
    mockUser = { role: 'player', player_id: 'p-1' };
    jest.mocked(api.playerStats).mockResolvedValue({
      player: players[0]!, season: '2026/27', appearances: 4, minutes_played: 300,
      goals: 3, assists: 2, own_goals: 0, yellow_cards: 1, red_cards: 0, goals_conceded: 0, penalties_saved: 0, clean_sheets: 0,
      seasons: ['2026/27'], trainings_attended: 0, trainings_expected: 0, training_attendance_pct: null, milestones: { reached: [], streaks: [], next: [] }, matches: [],
    });
    jest.mocked(api.matches).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const screen = await render(<PlayersScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'My Stats' }));
    // My Stats opens on the training half now, so the match half is a press away.
    await fireEvent.press(await screen.findByRole('tab', { name: 'Match Stats' }));
    expect(await screen.findByText('Salma Nabil')).toBeTruthy();
    expect(screen.getByText('Appearances')).toBeTruthy();
    expect(screen.getByText('Match breakdown')).toBeTruthy();
    expect(api.playerStats).toHaveBeenCalledWith('p-1', undefined);
  });

  // The stats are read for every season until a season is chosen.
  it('reads My Stats across all seasons until one is picked', async () => {
    mockUser = { role: 'player', player_id: 'p-1' };
    jest.mocked(api.playerStats).mockResolvedValue({
      player: players[0]!, season: null, appearances: 9, minutes_played: 700,
      goals: 5, assists: 3, own_goals: 0, yellow_cards: 1, red_cards: 0, goals_conceded: 0, penalties_saved: 0, clean_sheets: 0,
      seasons: ['2026/27', '2025/26'], trainings_attended: 0, trainings_expected: 0, training_attendance_pct: null, milestones: { reached: [], streaks: [], next: [] }, matches: [],
    });
    jest.mocked(api.matches).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const screen = await render(<PlayersScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'My Stats' }));
    // My Stats opens on the training half now, so the match half is a press away.
    await fireEvent.press(await screen.findByRole('tab', { name: 'Match Stats' }));

    expect(await screen.findByLabelText('Season All stats')).toBeTruthy();
    expect(api.playerStats).toHaveBeenCalledWith('p-1', undefined);

    fireEvent.press(screen.getByTestId('season-picker'));
    fireEvent.press(await screen.findByTestId('season-option-2025/26'));

    await waitFor(() => expect(api.playerStats).toHaveBeenCalledWith('p-1', '2025/26'));
  });

  it('leaves the season control out for a player with no season on record', async () => {
    mockUser = { role: 'player', player_id: 'p-1' };
    jest.mocked(api.playerStats).mockResolvedValue({
      player: players[0]!, season: null, appearances: 0, minutes_played: 0,
      goals: 0, assists: 0, own_goals: 0, yellow_cards: 0, red_cards: 0, goals_conceded: 0, penalties_saved: 0, clean_sheets: 0,
      seasons: [], trainings_attended: 0, trainings_expected: 0, training_attendance_pct: null, milestones: { reached: [], streaks: [], next: [] }, matches: [],
    });
    jest.mocked(api.matches).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const screen = await render(<PlayersScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'My Stats' }));
    // My Stats opens on the training half now, so the match half is a press away.
    await fireEvent.press(await screen.findByRole('tab', { name: 'Match Stats' }));
    await screen.findByText('Salma Nabil');

    expect(screen.queryByTestId('season-picker')).toBeNull();
  });

  // A parent reads each child on their own, rather than one merged view.
  it('lets a parent pick which child to read', async () => {
    mockUser = { role: 'parent', player_id: null };
    jest.mocked(api.myChildren).mockResolvedValue({ items: [
      { id: 'p-1', name: 'Salma Nabil', team_id: 't-u9', team_name: 'AIMZ U9' },
      { id: 'p-2', name: 'Mariam Adel', team_id: 't-u13', team_name: 'AIMZ U13' },
    ] });
    jest.mocked(api.playerStats).mockResolvedValue({
      player: players[1]!, season: '2026/27', appearances: 4, minutes_played: 300,
      goals: 3, assists: 2, own_goals: 0, yellow_cards: 1, red_cards: 0, goals_conceded: 0, penalties_saved: 0, clean_sheets: 0,
      seasons: ['2026/27'], trainings_attended: 0, trainings_expected: 0, training_attendance_pct: null, milestones: { reached: [], streaks: [], next: [] }, matches: [],
    });
    jest.mocked(api.matches).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    const screen = await render(<PlayersScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'My Stats' }));
    // My Stats opens on the training half now, so the match half is a press away.
    await fireEvent.press(await screen.findByRole('tab', { name: 'Match Stats' }));
    // The first child is read without choosing, and the other is offered.
    await waitFor(() => expect(api.playerStats).toHaveBeenCalledWith('p-1', undefined));
    fireEvent.press(await screen.findByRole('tab', { name: 'Mariam Adel' }));
    await waitFor(() => expect(api.playerStats).toHaveBeenCalledWith('p-2', undefined));
  });

  // An administrator manages the academy rather than playing in it. The staging
  // admin's own login is linked to a player, which is what had been letting the
  // tab through.
  it('leaves My Stats out for an administrator linked to a player', async () => {
    mockUser = { role: 'admin', player_id: 'p-1' };
    const screen = await render(<PlayersScreen />, { wrapper });
    await screen.findByRole('tab', { name: 'Teams' });
    expect(screen.queryByRole('tab', { name: 'My Stats' })).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
  });

  it('leaves My Stats out for an administrator with no player behind them', async () => {
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

  // The league's clubs carry `is_aimz` too, so that players, lineups and live
  // scoring work for them. They have no age group and no roster to browse, so
  // they do not belong on a list of the academy's own squads.
  it('lists the academy squads only, not the league clubs', async () => {
    const club = { ...team('t-ahly', 'Al Ahly', 'U9'), age_group: null };
    const withClubs = [...teams, club];
    jest.mocked(api.teams).mockResolvedValue({ items: withClubs, total: withClubs.length, limit: 100, offset: 0 });
    const screen = await render(<PlayersScreen />, { wrapper });
    expect(await screen.findByLabelText('AIMZ U9, 1 player')).toBeTruthy();
    expect(screen.queryByText('Al Ahly')).toBeNull();
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
    fireEvent.press(await screen.findByRole('tab', { name: 'Match' }));
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
    fireEvent.press(await screen.findByRole('tab', { name: 'Match' }));
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
    fireEvent.press(await screen.findByRole('tab', { name: 'Match' }));
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
    fireEvent.press(await screen.findByRole('tab', { name: 'Match' }));
    fireEvent.press(await screen.findByLabelText('Show the full top scorer ranking'));
    expect(await screen.findByText('AIMZ U13, 5 goals in 4 appearances')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Hide the full top scorer ranking'));
    await waitFor(() => expect(screen.queryByText('AIMZ U13, 5 goals in 4 appearances')).toBeNull());
  });

  it('opens leaderboards on training and expands a squad metric lazily', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    fireEvent.press(await screen.findByRole('tab', { name: 'Leaderboards' }));
    expect((await screen.findByRole('tab', { name: 'Training' })).props.accessibilityState.selected).toBe(true);
    expect(await screen.findByText('Best Dribbler')).toBeTruthy();
    expect(api.trainingAwardRanking).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('Show the full best dribbler ranking'));
    await waitFor(() => expect(api.trainingAwardRanking).toHaveBeenCalledWith('t-u9', 'dribbling'));
    expect(await screen.findByText('AIMZ U9, 8.5/10 from 4 sessions')).toBeTruthy();
  });

  it('uses squad pills for training and competition pills only for match', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });
    fireEvent.press(await screen.findByRole('tab', { name: 'Leaderboards' }));
    const squad = await screen.findByTestId('training-award-team-t-u9');
    const training = screen.getByRole('tab', { name: 'Training' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.indexOf(squad)).toBeLessThan(tabs.indexOf(training));
    expect(screen.queryByTestId('award-competition-c-1')).toBeNull();
    fireEvent.press(screen.getByRole('tab', { name: 'Match' }));
    expect(await screen.findByText('Top scorer')).toBeTruthy();
    expect(screen.queryByTestId('training-award-team-t-u9')).toBeNull();
  });

  it('opens My Stats on the training half, with the match half beside it', async () => {
    jest.mocked(api.playerTrainingStats).mockResolvedValue({
      player: { id: 'p-1', name: 'Salma Nabil' },
      metrics: [],
      attendance: { attended: 4, expected: 5, pct: 80 },
      totals: [],
      sessions: [],
    } as never);
    const screen = await render(<PlayersScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'My Stats' }));

    expect(await screen.findByRole('tab', { name: 'Training Stats' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Training Stats' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByRole('tab', { name: 'Match Stats' })).toBeTruthy();
    // Training leads the row as well as opening it: a selected tab sitting
    // second, with an empty one to its left, reads as a step skipped.
    const tabs = screen.getAllByRole('tab');
    expect(tabs.indexOf(screen.getByRole('tab', { name: 'Training Stats' })))
      .toBeLessThan(tabs.indexOf(screen.getByRole('tab', { name: 'Match Stats' })));
    // She trains every week and plays some weeks, so this is the fuller half.
    expect(await screen.findByText('4 of 5')).toBeTruthy();
  });

  it('offers the training half of My Stats beside the match half', async () => {
    jest.mocked(api.playerTrainingStats).mockResolvedValue({
      player: { id: 'p-1', name: 'Salma Nabil' },
      metrics: [],
      attendance: { attended: 4, expected: 5, pct: 80 },
      totals: [],
      sessions: [],
    } as never);
    const screen = await render(<PlayersScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'My Stats' }));
    await fireEvent.press(await screen.findByRole('tab', { name: 'Training Stats' }));
    expect(await screen.findByText('4 of 5')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
  });

  // A squad in no competition has no fixtures to have played.
  it('gives a player on a squad outside any competition training only', async () => {
    jest.mocked(api.teams).mockResolvedValue({
      items: [team('t-u9', 'AIMZ U9', 'U9', null)], total: 1, limit: 100, offset: 0,
    } as never);
    jest.mocked(api.playerTrainingStats).mockResolvedValue({
      player: { id: 'p-1', name: 'Salma Nabil' }, metrics: [],
      attendance: { attended: 0, expected: 0, pct: null }, totals: [], sessions: [],
    } as never);
    const screen = await render(<PlayersScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'My Stats' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Match Stats' })).toBeNull());
  });
  /**
   * The same answer Manage · Players gives, under the name in the squad too.
   *
   * "On the app" is not an install — nothing records one. It is whether
   * anybody has registered against the player: her own login, or a parent
   * holding her as a child. Salma has neither; Mariam's mother has an account
   * with Mariam as her child, so Mariam counts.
   */
  it('says which players in a squad are on the app', async () => {
    mockUser = { role: 'admin', player_id: null };
    jest.mocked(api.adminUsers).mockResolvedValue({ items: [
      { id: 'u-1', name: 'Hala Adel', email: 'hala@a.test', role: 'parent', player: null, team: null, children: [{ id: 'p-2', name: 'Mariam Adel' }] },
    ], total: 1, limit: 100, offset: 0 } as never);
    const screen = await render(<PlayersScreen />, { wrapper });

    await fireEvent.press(await screen.findByRole('button', { name: 'AIMZ U13, 1 player' }));
    expect(await screen.findByText('On the app')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Back to all teams' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'AIMZ U9, 1 player' }));
    expect(await screen.findByText('No app')).toBeTruthy();
  });

  // Colour is never the only indicator, so the row says it out loud as well.
  it('speaks the app status as part of the row', async () => {
    mockUser = { role: 'admin', player_id: null };
    jest.mocked(api.adminUsers).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 } as never);
    const screen = await render(<PlayersScreen />, { wrapper });

    await fireEvent.press(await screen.findByRole('button', { name: 'AIMZ U9, 1 player' }));
    expect(await screen.findByRole('button', { name: 'Salma Nabil, Striker, number 7, no app' })).toBeTruthy();
  });

  /**
   * A family opens this same screen as My Team. Who else has an account is an
   * administrator's business, and the route that answers it is theirs alone,
   * so the row is asked for nothing and shows nothing.
   */
  it('keeps the app status away from a family reading the same screen', async () => {
    const screen = await render(<PlayersScreen />, { wrapper });

    await fireEvent.press(await screen.findByRole('button', { name: 'AIMZ U9, 1 player' }));
    expect(await screen.findByText('Salma Nabil')).toBeTruthy();
    expect(screen.queryByText('On the app')).toBeNull();
    expect(screen.queryByText('No app')).toBeNull();
    expect(api.adminUsers).not.toHaveBeenCalled();
  });
});
