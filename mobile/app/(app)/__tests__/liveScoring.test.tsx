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
  usePathname: () => '/',
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: 'match-1' }),
  Redirect: 'Redirect',
}));
jest.mock('@/src/lib/platformAlert', () => ({ confirmAction: jest.fn(), showMessage: jest.fn() }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
jest.mock('@/src/lib/api', () => ({
  api: { live: jest.fn(), players: jest.fn(), setMatchPhase: jest.fn(), createEvent: jest.fn(), setManOfTheMatch: jest.fn(), stats: jest.fn() },
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
  home_team: { id: 'home', name: 'AIMZ U18', squad_code: null, age_group: 'U18', season: '2026', is_aimz: true, is_active: true, logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, logo_url: null, created_at: '', updated_at: '' },
  away_team: { id: 'away', name: 'Giza Lions', squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true, logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, logo_url: null, created_at: '', updated_at: '' },
  competition: { id: 'c-1', name: 'Women Academy League', season: '2026', type: 'league', team_count: null, group_size: null, created_at: '', updated_at: '' },
  ...over,
});

const snapshot = (over: Partial<Match> = {}): LiveMatchSnapshot =>
  ({ match: match(over), events: [], lineup: [], revision: 1 }) as LiveMatchSnapshot;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
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

describe('LiveScoringScreen — opponent-only redirect', () => {
  afterEach(() => jest.clearAllMocks());

  it('runs its hooks, then redirects the admin to final-score entry', async () => {
    const base = match();
    jest.mocked(api.players).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 });
    jest.mocked(api.live).mockResolvedValue(snapshot({
      status: 'scheduled',
      phase: 'not_started',
      phase_started_at: null,
      home_team: { ...base.home_team!, is_aimz: false },
      away_team: { ...base.away_team!, is_aimz: false },
    }));
    const screen = await render(<LiveScoringScreen />, { wrapper });
    await waitFor(() => expect(screen.toJSON()).toMatchObject({ type: 'Redirect', props: { href: { pathname: '/result/[id]', params: { id: 'match-1' } } } }));
    expect(api.live).toHaveBeenCalledWith('match-1');
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

const scorer = {
  id: 'p-1', name: 'Nour Adel', team_id: 'home', position: 'Defender', jersey_number: 4,
  photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '',
};

describe('LiveScoringScreen — own goals and missed penalties', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({ items: [scorer], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.live).mockResolvedValue(snapshot({ phase: 'first_half', phase_started_at: '2026-08-20T18:40:00.000Z' }));
    jest.mocked(api.createEvent).mockResolvedValue({} as never);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-20T18:40:00.000Z'));
  });
  afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

  // Both are things that happen to a goal attempt, so they are logged from the
  // Goal tab rather than from tabs of their own.
  it('keeps own goal and a missed penalty inside the goal form', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    expect(await screen.findByLabelText('Own goal')).toBeTruthy();
    expect(screen.getByLabelText('Penalty missed')).toBeTruthy();
    expect(screen.queryByText('Pen miss')).toBeNull();
  });

  it('logs an own goal against the side that put it in, with no assist to credit', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Own goal'));

    expect(await screen.findByText('Add own goal')).toBeTruthy();
    // The admin picks who it counts for; the scorer comes from the other side.
    expect(screen.getByText('Counts for')).toBeTruthy();
    expect(screen.getByText(/Put through their own net/u)).toBeTruthy();
    expect(screen.queryByText('Assisted by (optional)')).toBeNull();

    fireEvent.press(screen.getByText('Add own goal'));
    await waitFor(() => expect(api.createEvent).toHaveBeenCalled());
    expect(jest.mocked(api.createEvent).mock.calls[0]![1]).toMatchObject({ type: 'own_goal', team_id: 'away' });
  });

  it('asks how a penalty was missed before it shows the form', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Penalty missed'));

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByText('Off target')).toBeTruthy();
    // The rest of the form waits on the outcome, the way a card does.
    expect(screen.queryByText('Team')).toBeNull();

    fireEvent.press(screen.getByText('Saved'));
    expect(await screen.findByText('Team')).toBeTruthy();
    fireEvent.press(screen.getByText('Add missed penalty'));
    await waitFor(() => expect(api.createEvent).toHaveBeenCalled());
    expect(jest.mocked(api.createEvent).mock.calls[0]![1]).toMatchObject({ type: 'penalty_missed', penalty_outcome: 'saved' });
  });

  it('leaves the scored-from-a-penalty box to a goal that went in', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    expect(await screen.findByLabelText('Scored from a penalty')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Penalty missed'));
    fireEvent.press(await screen.findByText('Saved'));
    expect(screen.queryByLabelText('Scored from a penalty')).toBeNull();
  });

  it('sends a substitution reason only when one is chosen', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByText('Sub'));
    expect(await screen.findByText('Reason (optional)')).toBeTruthy();

    fireEvent.press(screen.getByText('Add Sub'));
    await waitFor(() => expect(api.createEvent).toHaveBeenCalled());
    // Left alone, a tactical change carries no reason.
    expect(jest.mocked(api.createEvent).mock.calls[0]![1]).toMatchObject({ type: 'substitution', substitution_reason: null });
  });

  it('keeps the reason off every other event type', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    expect(await screen.findByText('Add Goal')).toBeTruthy();
    expect(screen.queryByText('Reason (optional)')).toBeNull();
  });
});

describe('LiveScoringScreen — who can be substituted', () => {
  const bench = { id: 'bench-1', name: 'Malak Sherif', team_id: 'home', position: 'Forward', jersey_number: 12, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '' };
  const lineup = [
    { id: 'l1', match_id: 'match-1', player_id: 'p-1', team_id: 'home', is_starter: true, is_captain: false, position: 'Forward', jersey_number: 9 },
    { id: 'l2', match_id: 'match-1', player_id: 'bench-1', team_id: 'home', is_starter: false, is_captain: false, position: 'Forward', jersey_number: 12 },
  ];

  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({ items: [scorer, bench], total: 2, limit: 100, offset: 0 });
    jest.mocked(api.createEvent).mockResolvedValue({} as never);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-20T18:40:00.000Z'));
  });
  afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

  const openSub = async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByText('Sub'));
    return screen;
  };

  it('offers the bench to come on and the pitch to come off', async () => {
    jest.mocked(api.live).mockResolvedValue({ ...snapshot({ phase: 'first_half', phase_started_at: '2026-08-20T18:30:00.000Z' }), lineup } as never);
    const screen = await openSub();
    fireEvent.press(await screen.findByLabelText('Coming on'));
    expect(await screen.findByText('#12 Malak Sherif')).toBeTruthy();
    // A starter cannot come on; they are already on.
    expect(screen.queryByText('#9 Nour Hassan')).toBeNull();
  });

  // The list has to follow the match, not just its kickoff: after one change the
  // arriving player can be taken off and the departing one is out of both lists.
  it('follows the pitch once a substitution has been made', async () => {
    const sub = { id: 'e-sub', match_id: 'match-1', type: 'substitution' as const, minute: 5, team_id: 'home', player_id: 'bench-1', secondary_player_id: 'p-1', related_event_id: null, notes: null, is_penalty: false, substitution_reason: null, penalty_outcome: null, client_operation_id: 'sub', created_at: '', updated_at: '' };
    jest.mocked(api.live).mockResolvedValue({ ...snapshot({ phase: 'first_half', phase_started_at: '2026-08-20T18:30:00.000Z' }), lineup, events: [sub] } as never);
    const screen = await openSub();

    fireEvent.press(await screen.findByLabelText('Coming off'));
    expect(await screen.findByText('#12 Malak Sherif')).toBeTruthy();
    expect(screen.queryByText('#9 Nour Hassan')).toBeNull();
  });
});


const onPitch = { id: 'p-on', name: 'Aya Nabil', team_id: 'home', position: 'Defender', jersey_number: 6, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '' };
const benched = { id: 'p-off', name: 'Hana Saleh', team_id: 'home', position: 'Forward', jersey_number: 18, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '' };
const named = (playerId: string, isStarter: boolean) => ({ player_id: playerId, team_id: 'home', is_starter: isStarter, is_captain: false, position: null, jersey_number: null });

describe('LiveScoringScreen — who can be credited with an assist', () => {
  beforeEach(() => {
    jest.mocked(api.players).mockResolvedValue({ items: [onPitch, benched], total: 2, limit: 100, offset: 0 });
    jest.mocked(api.live).mockResolvedValue({
      ...snapshot({ phase: 'first_half', phase_started_at: '2026-08-20T18:40:00.000Z' }),
      lineup: [named(onPitch.id, true), named(benched.id, false)],
    } as LiveMatchSnapshot);
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-20T18:40:00.000Z'));
  });
  afterEach(() => { jest.clearAllMocks(); jest.restoreAllMocks(); });

  // An assist can only come from someone who was actually playing, so the
  // dropdown offers the pitch rather than the whole squad.
  it('offers only the players on the pitch, not the rest of the squad', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Assisted by (optional)'));

    expect(await screen.findByText(`#${onPitch.jersey_number} ${onPitch.name}`)).toBeTruthy();
    expect(screen.queryByText(`#${benched.jersey_number} ${benched.name}`)).toBeNull();
  });

  // A goal cannot be scored by someone sitting on the bench either.
  it('offers only the players on the pitch as the scorer', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Scorer'));

    expect(await screen.findByText(`#${onPitch.jersey_number} ${onPitch.name}`)).toBeTruthy();
    expect(screen.queryByText(`#${benched.jersey_number} ${benched.name}`)).toBeNull();
  });

  it('keeps a way to record a goal with no assist at all', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Assisted by (optional)'));

    expect(await screen.findByText('No assist')).toBeTruthy();
  });

  // The empty rows used to read as if they were people; the muted placeholder
  // says the same thing without sitting in the list of names.
  it('drops the placeholder rows from the substitution pickers', async () => {
    const screen = await render(<LiveScoringScreen />, { wrapper });
    fireEvent.press(await screen.findByText('Sub'));
    await screen.findByText('Coming on');

    expect(screen.queryByText('Nobody on the bench')).toBeNull();
    expect(screen.queryByText('Nobody on the pitch')).toBeNull();
  });
});
