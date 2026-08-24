import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import MatchDetailScreen from '@/app/(app)/match/[id]';
import { api } from '@/src/lib/api';
import type { LineupEntry, LiveMatchSnapshot, Match, MatchEvent } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'match-1' }),
  Redirect: 'Redirect',
}));
jest.mock('@/src/lib/platformAlert', () => ({ confirmAction: jest.fn(), showMessage: jest.fn() }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
jest.mock('@/src/lib/api', () => ({
  api: { live: jest.fn(), players: jest.fn() },
  ApiError: class extends Error {},
}));

const match = (over: Partial<Match> = {}): Match => ({
  id: 'match-1', competition_id: 'c-1', home_team_id: 'home', away_team_id: 'away',
  kickoff_datetime: '2026-08-20T18:30:00.000Z', venue: 'AIMZ Arena',
  status: 'live', phase: 'first_half', phase_started_at: '2026-08-20T18:30:00.000Z',
  home_score: 1, away_score: 0, revision: 1, lineup_format: null, formation: null, man_of_the_match_player_id: null,
  half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: false, extra_time_half_length_minutes: 15,
  created_at: '', updated_at: '',
  home_team: { id: 'home', name: 'AIMZ U18', squad_code: null, age_group: 'U18', season: '2026', is_aimz: true, is_active: true, logo_key: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '' },
  away_team: { id: 'away', name: 'Giza Lions', squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true, logo_key: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '' },
  competition: { id: 'c-1', name: 'Women Academy League', season: '2026', type: 'league', team_count: null, group_size: null, created_at: '', updated_at: '' },
  ...over,
});

const entry = (id: string, is_starter: boolean): LineupEntry => ({
  id, match_id: 'match-1', player_id: id, team_id: 'home', is_starter, is_captain: false,
  position: 'Midfielder', jersey_number: 8,
});

const snapshot = (over: Partial<Match> = {}, lineup: LineupEntry[] = []): LiveMatchSnapshot =>
  ({ match: match(over), events: [], lineup, revision: 1 }) as LiveMatchSnapshot;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

jest.setTimeout(30_000);

describe('MatchDetailScreen — End match moved to live scoring', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  });
  afterEach(() => jest.clearAllMocks());

  it('no longer offers End match while the match is live', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot());
    const screen = await render(<MatchDetailScreen />, { wrapper });
    await screen.findByText('Open live scoring');
    expect(screen.queryByText('End match')).toBeNull();
  });
});

describe('MatchDetailScreen — lineups', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({
      items: [
        { id: 'starter-1', name: 'Nour Hassan', team_id: 'home', position: 'Forward', jersey_number: 9, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '' },
        { id: 'sub-1', name: 'Malak Sherif', team_id: 'home', position: 'Goalkeeper', jersey_number: 2, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '' },
      ],
      total: 2, limit: 100, offset: 0,
    });
  });
  afterEach(() => jest.clearAllMocks());

  it('keeps substitutes collapsed until the header is pressed', async () => {
    jest.mocked(api.live).mockResolvedValue(
      snapshot({}, [entry('starter-1', true), entry('sub-1', false)]),
    );
    const screen = await render(<MatchDetailScreen />, { wrapper });

    // Starters are the point of the screen, so they stay open.
    expect(await screen.findByText('Nour Hassan')).toBeTruthy();
    expect(screen.queryByText('Malak Sherif')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Show substitutes' }));
    expect(await screen.findByText('Malak Sherif')).toBeTruthy();
  });
});

const goal = (id: string, minute: number, scorer: string, assister: string | null) => ({
  id, match_id: 'match-1', type: 'goal' as const, minute, team_id: 'home',
  player_id: scorer, secondary_player_id: assister, related_event_id: null, notes: null,
  is_penalty: false, client_operation_id: id, created_at: '', updated_at: '',
});

describe('MatchDetailScreen — timeline', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({
      items: [
        { id: 'p1', name: 'Amina Adel', team_id: 'home', position: 'Forward', jersey_number: 9, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '' },
        { id: 'p2', name: 'Aya Nabil', team_id: 'home', position: 'Midfielder', jersey_number: 6, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '' },
      ],
      total: 2, limit: 100, offset: 0,
    });
  });
  afterEach(() => jest.clearAllMocks());

  it('shows one row per goal, with the assister under the scorer', async () => {
    jest.mocked(api.live).mockResolvedValue({ ...snapshot(), events: [goal('e1', 23, 'p1', 'p2')] } as never);
    const screen = await render(<MatchDetailScreen />, { wrapper });
    expect(await screen.findByText('Amina Adel')).toBeTruthy();
    expect(screen.getByText('Assist: Aya Nabil')).toBeTruthy();
    expect(screen.getByText("23'")).toBeTruthy();
    // The old build listed the assist as an event in its own right.
    expect(screen.queryByText('Assist')).toBeNull();
  });

  it('shows only the scorer when nobody is credited', async () => {
    jest.mocked(api.live).mockResolvedValue({ ...snapshot(), events: [goal('e2', 41, 'p1', null)] } as never);
    const screen = await render(<MatchDetailScreen />, { wrapper });
    expect(await screen.findByText('Amina Adel')).toBeTruthy();
    expect(screen.queryByText(/^Assist:/u)).toBeNull();
  });
});

const event = (over: Partial<MatchEvent> = {}): MatchEvent => ({
  id: 'e-1', match_id: 'match-1', type: 'goal', minute: 10, team_id: 'home',
  player_id: null, secondary_player_id: null, related_event_id: null, notes: null,
  is_penalty: false, substitution_reason: null, penalty_outcome: null,
  client_operation_id: 'op-1', created_at: '', updated_at: '',
  ...over,
}) as MatchEvent;

describe('MatchDetailScreen — richer timeline', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
  });
  afterEach(() => jest.clearAllMocks());

  it('says which side an own goal counted for', async () => {
    jest.mocked(api.live).mockResolvedValue({
      ...snapshot(), events: [event({ type: 'own_goal', team_id: 'home' })],
    } as LiveMatchSnapshot);
    const screen = await render(<MatchDetailScreen />, { wrapper });
    // Filed against the home side, so it counted for the away side.
    expect(await screen.findByText('Own goal for Giza Lions')).toBeTruthy();
  });

  it('shows why a player came off', async () => {
    jest.mocked(api.live).mockResolvedValue({
      ...snapshot(), events: [event({ id: 'e-2', type: 'substitution', substitution_reason: 'injury' })],
    } as LiveMatchSnapshot);
    const screen = await render(<MatchDetailScreen />, { wrapper });
    expect(await screen.findByText('Reason: Injury')).toBeTruthy();
  });

  it('shows how a penalty was missed', async () => {
    jest.mocked(api.live).mockResolvedValue({
      ...snapshot(), events: [event({ id: 'e-3', type: 'penalty_missed', penalty_outcome: 'saved' })],
    } as LiveMatchSnapshot);
    const screen = await render(<MatchDetailScreen />, { wrapper });
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByText('Penalty missed')).toBeTruthy();
  });

  it('leaves a plain substitution without a reason line', async () => {
    jest.mocked(api.live).mockResolvedValue({
      ...snapshot(), events: [event({ id: 'e-4', type: 'substitution' })],
    } as LiveMatchSnapshot);
    const screen = await render(<MatchDetailScreen />, { wrapper });
    expect(await screen.findByText('Substitution')).toBeTruthy();
    expect(screen.queryByText(/^Reason:/)).toBeNull();
  });
});
