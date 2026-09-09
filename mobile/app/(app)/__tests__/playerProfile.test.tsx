import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import PlayerDetailScreen from '@/app/(app)/player/[id]';
import { api } from '@/src/lib/api';
import type { Competition, Player, PlayerSeasonSummary, Team } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'p-1' }),
  usePathname: () => '/player/p-1',
}));
jest.mock('@/src/lib/api', () => ({
  api: { playerStats: jest.fn(), playerHonours: jest.fn(), teams: jest.fn(), playerTrainingStats: jest.fn() },
  ApiError: class extends Error {},
}));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'player', player_id: 'p-1' } }) }));

const team = (id: string, name: string, age_group: string, competition_id: string | null = 'comp-1'): Team => ({
  id, name, age_group, squad_code: null, season: '2026/27', is_aimz: true, is_active: true,
  logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id, competition_group_id: null, created_at: '', updated_at: '',
});

const under14 = team('t-u14', 'AIMZ U14', 'U14');
const under16 = team('t-u16', 'AIMZ U16', 'U16');
const opponent = team('t-opp', 'Cairo Stars', '');

// She has been promoted: she is on the U16s now, but last season she was U14.
const player: Player = {
  id: 'p-1', name: 'Nour Hassan', team_id: 't-u16', position: 'ST', jersey_number: 9,
  photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '',
};

const competition: Competition = { id: 'c-1', name: 'Youth League', season: '2025/26', type: 'league', team_count: null, group_size: null, created_at: '', updated_at: '' };

const summary = (over: Partial<PlayerSeasonSummary> = {}): PlayerSeasonSummary => ({
  player, season: null, seasons: ['2026/27', '2025/26'],
  appearances: 49, minutes_played: 3800, goals: 12, assists: 4, own_goals: 0, yellow_cards: 1, red_cards: 0,
  goals_conceded: 0, penalties_saved: 0, clean_sheets: 0,
  milestones: {
    reached: [{ id: 'goals-10', label: '10 goals', kickoff_datetime: '2026-03-14T15:00:00.000Z', match_id: 'm-1' }],
    streaks: [{ id: 'scoring-streak', label: 'Scored in 3 consecutive matches', count: 3 }],
    next: [{ id: 'next-appearances', label: '1 more appearance to 50', current: 49, target: 50, remaining: 1 }],
  },
  matches: [{
    id: 's-1', match_id: 'm-1', player_id: 'p-1', appeared: true, minutes_played: 90,
    goals: 2, assists: 0, own_goals: 0, yellow_cards: 0, red_cards: 0,
    kickoff_datetime: '2026-03-14T15:00:00.000Z',
    competition: { id: 'c-1', name: 'Youth League', season: '2025/26' },
    team: under14, opponent, man_of_the_match: false,
  }],
  ...over,
} as PlayerSeasonSummary);

/**
 * The page opens on the training half now, so anything about the match half has
 * to ask for it first. Kept here rather than repeated: a squad entered in no
 * competition has no match half at all, and those tests render directly.
 */
async function matchHalf() {
  const screen = await render(<PlayerDetailScreen />, { wrapper });
  await fireEvent.press(await screen.findByRole('tab', { name: 'Match Stats' }));
  return screen;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('PlayerDetailScreen', () => {
  beforeEach(() => {
    // The screen reads the squad to know whether it plays matches at all.
    jest.mocked(api.teams).mockResolvedValue({ items: [under14, under16], total: 2, limit: 100, offset: 0 } as never);
    jest.mocked(api.playerTrainingStats).mockResolvedValue({
      player, metrics: [], attendance: { attended: 0, expected: 0, pct: null }, totals: [], sessions: [],
    } as never);
    jest.mocked(api.playerStats).mockResolvedValue(summary());
    jest.mocked(api.playerHonours).mockResolvedValue({
      player,
      honours: [
        { competition, metric: 'goals', label: 'Top scorer', value: 12, unit: 'goals', team: under14, is_final: true },
        { competition: { ...competition, id: 'c-2', season: '2026/27' }, metric: 'assists', label: 'Most assists', value: 4, unit: 'assists', team: under16, is_final: false },
      ],
    });
  });
  afterEach(() => jest.clearAllMocks());

  it('names the player and her position in full, not the stored code', async () => {
    const screen = await matchHalf();
    // The panel's identity card carries the name, so the header bar does not
    // repeat it — hence findAllByText rather than a single match.
    expect((await screen.findAllByText('Nour Hassan')).length).toBeGreaterThan(0);
    expect(screen.getByText('Striker')).toBeTruthy();
  });

  it('shows what she is closest to next, and the run she is on', async () => {
    const screen = await matchHalf();
    expect(await screen.findByText('1 more appearance to 50')).toBeTruthy();
    expect(screen.getByText('Scored in 3 consecutive matches')).toBeTruthy();
    expect(screen.getByText('10 goals')).toBeTruthy();
  });

  it('marks an honour from a finished season apart from one still in play', async () => {
    const screen = await matchHalf();
    expect(await screen.findByText('Top scorer')).toBeTruthy();
    expect(screen.getByText('Most assists')).toBeTruthy();
    // The season still being played says so rather than claiming she has won it.
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  // The reason the squad is on the statistic at all.
  it('names the squad she played for when it is not the one she is on now', async () => {
    const screen = await matchHalf();
    expect(await screen.findByText('vs Cairo Stars')).toBeTruthy();
    expect(screen.getByText(/AIMZ U14 · 90 min/u)).toBeTruthy();
  });

  // The same control a player gets over their own stats, so both read the
  // same way and say the same words.
  it('reads every season until one is chosen', async () => {
    const screen = await matchHalf();
    expect(await screen.findByLabelText('Season All stats')).toBeTruthy();
    expect(api.playerStats).toHaveBeenCalledWith('p-1', undefined);

    fireEvent.press(screen.getByTestId('season-picker'));
    fireEvent.press(await screen.findByTestId('season-option-2025/26'));

    await waitFor(() => expect(api.playerStats).toHaveBeenCalledWith('p-1', '2025/26'));
  });

  it('offers the filter to a player with a single season on record', async () => {
    jest.mocked(api.playerStats).mockResolvedValue(summary({ seasons: ['2026/27'] }));
    const screen = await matchHalf();
    expect((await screen.findAllByText('Nour Hassan')).length).toBeGreaterThan(0);
    expect(screen.getByTestId('season-picker')).toBeTruthy();
  });

  // Nothing to filter, so nothing is drawn.
  it('leaves the filter out for a player with no season on record', async () => {
    jest.mocked(api.playerStats).mockResolvedValue(summary({ seasons: [] }));
    const screen = await matchHalf();
    expect((await screen.findAllByText('Nour Hassan')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('season-picker')).toBeNull();
  });

  it('explains the empty profile of someone who has not played yet', async () => {
    jest.mocked(api.playerStats).mockResolvedValue(summary({
      seasons: [], matches: [], trainings_attended: 0, trainings_expected: 0, training_attendance_pct: null, milestones: { reached: [], streaks: [], next: [] },
    }));
    jest.mocked(api.playerHonours).mockResolvedValue({ player, honours: [] });
    const screen = await matchHalf();
    expect(await screen.findByText('Milestones and honours appear once she has played a match.')).toBeTruthy();
  });

  // A percentage is only worth showing once a register has named her. A zero
  // before that reads as never turning up, when it means nobody has taken one.
  // Training belongs to the other half of the record and is read there, so it
  // does not appear a second time beside the match figures.
  it('keeps training out of the match half', async () => {
    jest.mocked(api.playerStats).mockResolvedValue(summary({
      trainings_attended: 7, trainings_expected: 10, training_attendance_pct: 70,
    }));
    const screen = await matchHalf();
    expect(await screen.findByText('Appearances')).toBeTruthy();
    expect(screen.queryByText('70%')).toBeNull();
    expect(screen.queryByText('Training · 7/10')).toBeNull();
  });

  it('leaves training attendance out until a register names her', async () => {
    jest.mocked(api.playerStats).mockResolvedValue(summary({
      trainings_attended: 0, trainings_expected: 0, training_attendance_pct: null,
    }));
    const screen = await matchHalf();
    expect((await screen.findAllByText('Nour Hassan')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Training · 0/0')).toBeNull();
  });

  describe('the two halves of a training record', () => {
    it('opens on the training half, with the match half alongside it', async () => {
      const screen = await render(<PlayerDetailScreen />, { wrapper });
      expect(await screen.findByRole('tab', { name: 'Training Stats' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Training Stats' }).props.accessibilityState.selected).toBe(true);
      expect(screen.getByRole('tab', { name: 'Match Stats' })).toBeTruthy();
      // Whichever half is up, the header says whose record this is.
      expect(screen.getAllByText('Nour Hassan').length).toBeGreaterThan(0);
    });

    it('reads the training record when that half is chosen', async () => {
      jest.mocked(api.playerTrainingStats).mockResolvedValue({
        player,
        metrics: [{ id: 'm-dri', key: 'dribbling', label: 'Dribbling', kind: 'rating', min_value: 1, max_value: 10, unit: null, sort_order: 20, is_active: true }],
        attendance: { attended: 9, expected: 12, pct: 75 },
        totals: [{ metric: { id: 'm-dri', key: 'dribbling', label: 'Dribbling', kind: 'rating', min_value: 1, max_value: 10, unit: null, sort_order: 20, is_active: true }, value: 7.5, sessions: 4 }],
        sessions: [{ id: 's-1', starts_at: '2026-09-08T15:00:00.000Z', venue: 'Palm', status: 'present', values: { 'm-dri': 8 } }],
      } as never);
      const screen = await render(<PlayerDetailScreen />, { wrapper });
      await fireEvent.press(await screen.findByRole('tab', { name: 'Training Stats' }));

      expect(await screen.findByText('9 of 12')).toBeTruthy();
      expect(screen.getByText('75%')).toBeTruthy();
      // A mark reads against its own scale, and an average says so.
      expect(screen.getByText('7.5/10')).toBeTruthy();
      expect(screen.getByText('Dribbling avg')).toBeTruthy();
      expect(screen.getByText('Present')).toBeTruthy();
      expect(screen.getByText('Dribbling 8/10')).toBeTruthy();
    });

    // A squad entered in nothing has no fixtures to have played, so an empty
    // Match Stats tab would be a question the app cannot answer.
    it('offers no match half at all for a squad in no competition', async () => {
      jest.mocked(api.teams).mockResolvedValue({
        items: [team('t-u16', 'AIMZ U16', 'U16', null)], total: 1, limit: 100, offset: 0,
      } as never);
      const screen = await render(<PlayerDetailScreen />, { wrapper });
      await waitFor(() => expect(screen.getByText('This squad is not entered in a competition, so there are no match statistics to show.')).toBeTruthy());
      expect(screen.queryByRole('tab', { name: 'Match Stats' })).toBeNull();
      expect(screen.queryByText('Match breakdown')).toBeNull();
    });
  });
});
