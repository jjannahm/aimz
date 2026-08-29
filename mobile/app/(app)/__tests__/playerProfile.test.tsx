import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
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
  api: { playerStats: jest.fn(), playerHonours: jest.fn() },
  ApiError: class extends Error {},
}));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'player', player_id: 'p-1' } }) }));

const team = (id: string, name: string, age_group: string): Team => ({
  id, name, age_group, squad_code: null, season: '2026/27', is_aimz: true, is_active: true,
  logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '',
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

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('PlayerDetailScreen', () => {
  beforeEach(() => {
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
    const screen = await render(<PlayerDetailScreen />, { wrapper });
    // The panel's identity card carries the name, so the header bar does not
    // repeat it — hence findAllByText rather than a single match.
    expect((await screen.findAllByText('Nour Hassan')).length).toBeGreaterThan(0);
    expect(screen.getByText('Striker')).toBeTruthy();
  });

  it('shows what she is closest to next, and the run she is on', async () => {
    const screen = await render(<PlayerDetailScreen />, { wrapper });
    expect(await screen.findByText('1 more appearance to 50')).toBeTruthy();
    expect(screen.getByText('Scored in 3 consecutive matches')).toBeTruthy();
    expect(screen.getByText('10 goals')).toBeTruthy();
  });

  it('marks an honour from a finished season apart from one still in play', async () => {
    const screen = await render(<PlayerDetailScreen />, { wrapper });
    expect(await screen.findByText('Top scorer')).toBeTruthy();
    expect(screen.getByText('Most assists')).toBeTruthy();
    // The season still being played says so rather than claiming she has won it.
    expect(screen.getByText('In progress')).toBeTruthy();
  });

  // The reason the squad is on the statistic at all.
  it('names the squad she played for when it is not the one she is on now', async () => {
    const screen = await render(<PlayerDetailScreen />, { wrapper });
    expect(await screen.findByText('vs Cairo Stars')).toBeTruthy();
    expect(screen.getByText(/AIMZ U14 · 90 min/u)).toBeTruthy();
  });

  it('offers a season switcher once there is more than one season', async () => {
    const screen = await render(<PlayerDetailScreen />, { wrapper });
    expect(await screen.findByRole('tab', { name: 'Career' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: '2025/26' }));
    expect(api.playerStats).toHaveBeenCalledWith('p-1', '2025/26');
  });

  it('leaves the switcher out for a player with a single season', async () => {
    jest.mocked(api.playerStats).mockResolvedValue(summary({ seasons: ['2026/27'] }));
    const screen = await render(<PlayerDetailScreen />, { wrapper });
    expect((await screen.findAllByText('Nour Hassan')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: 'Career' })).toBeNull();
  });

  it('explains the empty profile of someone who has not played yet', async () => {
    jest.mocked(api.playerStats).mockResolvedValue(summary({
      seasons: [], matches: [], milestones: { reached: [], streaks: [], next: [] },
    }));
    jest.mocked(api.playerHonours).mockResolvedValue({ player, honours: [] });
    const screen = await render(<PlayerDetailScreen />, { wrapper });
    expect(await screen.findByText('Milestones and honours appear once she has played a match.')).toBeTruthy();
  });
});
