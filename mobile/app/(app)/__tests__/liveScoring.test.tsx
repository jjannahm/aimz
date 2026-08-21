import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import LiveScoringScreen from '@/app/(app)/live/[id]';
import { api } from '@/src/lib/api';
import { confirmAction } from '@/src/lib/platformAlert';
import type { LiveMatchSnapshot, Match, MatchPhase } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'match-1' }),
  Redirect: 'Redirect',
}));
jest.mock('@/src/lib/platformAlert', () => ({ confirmAction: jest.fn(), showMessage: jest.fn() }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
jest.mock('@/src/lib/api', () => ({
  api: { live: jest.fn(), players: jest.fn(), setMatchPhase: jest.fn(), createEvent: jest.fn() },
  ApiError: class extends Error {},
}));

const match = (over: Partial<Match> = {}): Match => ({
  id: 'match-1', competition_id: 'c-1', home_team_id: 'home', away_team_id: 'away',
  kickoff_datetime: '2026-08-20T18:30:00.000Z', venue: 'AIMZ Arena',
  status: 'live', phase: 'first_half', phase_started_at: '2026-08-20T18:30:00.000Z',
  home_score: 1, away_score: 0, revision: 1, lineup_format: null, formation: null,
  half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: false, extra_time_half_length_minutes: 15,
  created_at: '', updated_at: '',
  home_team: { id: 'home', name: 'AIMZ U18', squad_code: null, age_group: 'U18', season: '2026', is_aimz: true, is_active: true, logo_key: null, coach: null, assistant_coach: null, competition_id: null, logo_url: null, created_at: '', updated_at: '' },
  away_team: { id: 'away', name: 'Giza Lions', squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true, logo_key: null, coach: null, assistant_coach: null, competition_id: null, logo_url: null, created_at: '', updated_at: '' },
  competition: { id: 'c-1', name: 'Women Academy League', season: '2026', type: 'league', created_at: '', updated_at: '' },
  ...over,
});

const snapshot = (over: Partial<Match> = {}): LiveMatchSnapshot =>
  ({ match: match(over), events: [], lineup: [], revision: 1 }) as LiveMatchSnapshot;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

jest.setTimeout(30_000);

describe('LiveScoringScreen — End match', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    jest.mocked(api.setMatchPhase).mockResolvedValue(match({ status: 'finished' }));
    // The clock derives the phase from elapsed time, so pin "now" to kickoff.
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-20T18:40:00.000Z'));
  });
  afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

  // Ending a match used to live on the Game centre, which offered it in any
  // live phase. Halftime especially must keep a way out.
  it.each([
    ['first_half', 'Halftime'],
    ['halftime', 'Start second half'],
  ] as const)('offers End match alongside the %s control', async (phase, alongside) => {
    jest.mocked(api.live).mockResolvedValue(snapshot({ phase: phase as MatchPhase, phase_started_at: '2026-08-20T18:40:00.000Z' }));
    const screen = await render(<LiveScoringScreen />, { wrapper });

    expect(await screen.findByText('End match')).toBeTruthy();
    expect(screen.getByText(alongside)).toBeTruthy();
  });

  it('hides End match before kickoff', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot({ status: 'scheduled', phase: 'not_started', phase_started_at: null }));
    const screen = await render(<LiveScoringScreen />, { wrapper });
    await screen.findByText('Start match');
    expect(screen.queryByText('End match')).toBeNull();
  });

  it('hides End match once the match is finished', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot({ status: 'finished', phase: 'finished' }));
    const screen = await render(<LiveScoringScreen />, { wrapper });
    await screen.findByText(/Finished matches remain open/);
    expect(screen.queryByText('End match')).toBeNull();
  });

  it('drops Finish match, which it replaces', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot({ phase: 'second_half', phase_started_at: '2026-08-20T18:40:00.000Z' }));
    const screen = await render(<LiveScoringScreen />, { wrapper });
    await screen.findByText('End match');
    expect(screen.queryByText('Finish match')).toBeNull();
  });

  it('confirms destructively, and only then finishes the match', async () => {
    jest.mocked(api.live).mockResolvedValue(snapshot({ phase: 'halftime', phase_started_at: '2026-08-20T18:40:00.000Z' }));
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByText('End match'));

    expect(api.setMatchPhase).not.toHaveBeenCalled();
    expect(confirmAction).toHaveBeenCalledWith(
      'End this match now?', 'Standings will update from this final score.', 'End match',
      expect.any(Function), { destructive: true },
    );

    jest.mocked(confirmAction).mock.calls[0]![3]!();
    await waitFor(() => expect(api.setMatchPhase).toHaveBeenCalledWith('match-1', 'finish_match'));
  });
});

describe('LiveScoringScreen — Cards', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    jest.mocked(api.live).mockResolvedValue(snapshot({ phase: 'first_half', phase_started_at: '2026-08-20T18:40:00.000Z' }));
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-20T18:40:00.000Z'));
  });
  afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

  it('replaces the Yellow and Red buttons with one Cards button', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    expect(await screen.findByText('Cards')).toBeTruthy();
    expect(screen.queryByText('Yellow')).toBeNull();
    expect(screen.queryByText('Red')).toBeNull();
  });

  it('asks which card before it shows the form', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByText('Cards'));

    expect(await screen.findByText('Yellow')).toBeTruthy();
    expect(screen.getByText('Red')).toBeTruthy();
    // The team, player and minute fields stay behind the card choice.
    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.queryByText('Minute (optional)')).toBeNull();
  });

  it.each([
    ['Yellow', 'Add Yellow'],
    ['Red', 'Add Red'],
  ])('opens the form on %s and names its own action', async (card, action) => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByText('Cards'));
    fireEvent.press(await screen.findByText(card));

    expect(await screen.findByText(action)).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByText('Minute (optional)')).toBeTruthy();
  });

  it('swaps the action when the other card is picked', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByText('Cards'));
    fireEvent.press(await screen.findByText('Yellow'));
    fireEvent.press(await screen.findByText('Red'));

    expect(await screen.findByText('Add Red')).toBeTruthy();
    expect(screen.queryByText('Add Yellow')).toBeNull();
  });

  it('leaves the other event types on their own single step', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    expect(await screen.findByText('Add Goal')).toBeTruthy();

    fireEvent.press(screen.getByText('Sub'));
    expect(await screen.findByText('Add Sub')).toBeTruthy();
    expect(screen.getByText('Coming on')).toBeTruthy();
  });
});
