import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import LineupScreen from '@/app/(app)/lineup/[id]';
import { api } from '@/src/lib/api';
import { showMessage } from '@/src/lib/platformAlert';
import { router } from 'expo-router';
import type { LiveMatchSnapshot, Match } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  usePathname: () => '/',
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'match-1' }),
  Redirect: 'Redirect',
}));
jest.mock('@/src/lib/platformAlert', () => ({ confirmAction: jest.fn(), showMessage: jest.fn() }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
jest.mock('@/src/lib/api', () => ({
  api: { live: jest.fn(), players: jest.fn(), lineup: jest.fn(), updateMatch: jest.fn() },
  ApiError: class extends Error {},
}));

const match: Match = {
  id: 'match-1', competition_id: 'c-1', home_team_id: 'home', away_team_id: 'away',
  kickoff_datetime: '2026-08-20T18:30:00.000Z', venue: 'AIMZ Arena',
  status: 'scheduled', phase: 'not_started', phase_started_at: null,
  home_score: 0, away_score: 0, revision: 1, lineup_format: 11, formation: '4-4-2',
  half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15,
  has_extra_time: false, extra_time_half_length_minutes: 15, created_at: '', updated_at: '',
  home_team: { id: 'home', name: 'AIMZ U18', squad_code: null, age_group: 'U18', season: '2026', is_aimz: true, is_active: true, logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '' },
  away_team: { id: 'away', name: 'Giza Lions', squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true, logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '' },
  competition: { id: 'c-1', name: 'Women Academy League', season: '2026', type: 'league', team_count: null, group_size: null, created_at: '', updated_at: '' },
} as Match;

// A lineup already stored, so the screen opens filled in and ready to save —
// the state an admin is in when they correct a lineup and press save again.
const lineup = Array.from({ length: 11 }, (unused, index) => ({
  id: `l${index + 1}`, match_id: 'match-1', player_id: `p${index + 1}`, team_id: 'home',
  is_starter: true, is_captain: false, position: 'Midfielder', jersey_number: index + 1,
}));
const snapshot: LiveMatchSnapshot = { match, events: [], lineup, revision: 1 } as LiveMatchSnapshot;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const squad = Array.from({ length: 11 }, (unused, index) => ({
  id: `p${index + 1}`, name: `Player ${index + 1}`, team_id: 'home', position: 'Midfielder',
  jersey_number: index + 1, photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '',
}));

async function saveAValidLineup() {
  const screen = await render(<LineupScreen />, { wrapper });
  fireEvent.press(await screen.findByText('Save lineup'));
  return screen;
}

describe('LineupScreen — saving', () => {
  beforeEach(() => {
    jest.mocked(api.live).mockResolvedValue(snapshot);
    jest.mocked(api.players).mockResolvedValue({ items: squad, total: squad.length, limit: 100, offset: 0 } as never);
    jest.mocked(api.lineup).mockResolvedValue([] as never);
    jest.mocked(api.updateMatch).mockResolvedValue(match as never);
  });
  afterEach(() => jest.clearAllMocks());

  it('lands on the match, and says nothing went wrong, when the save succeeds', async () => {
    await saveAValidLineup();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/match/match-1'));
    expect(showMessage).not.toHaveBeenCalled();
  });

  it('reports a failure and stays put when the match update is the thing that fails', async () => {
    // The entries saved and the format patch did not. The old build ran that
    // patch from `onSuccess`, so this arrived as "Lineup not saved" — after the
    // lineup had in fact been saved — and the redirect was lost with it.
    jest.mocked(api.updateMatch).mockRejectedValue(Object.assign(new Error('Check the highlighted fields.'), { fields: [{ field: 'has_extra_time', message: 'Must be true or false.' }] }));
    await saveAValidLineup();
    await waitFor(() => expect(showMessage).toHaveBeenCalled());
    expect(jest.mocked(showMessage).mock.calls[0]?.[1]).toContain('has_extra_time');
    expect(router.replace).not.toHaveBeenCalled();
  });
});


// A squad written in position codes, with two keepers in it.
const fiveASide = { ...match, lineup_format: 5, formation: '2-2' } as Match;
const keepersSquad = [
  { id: 'gk1', name: 'Amal Keeper', position: 'GK' },
  { id: 'gk2', name: 'Basma Keeper', position: 'GK' },
  { id: 'd1', name: 'Cara Back', position: 'CB' },
  { id: 'd2', name: 'Dina Back', position: 'LB' },
  { id: 'm1', name: 'Eman Mid', position: 'CM' },
  { id: 'f1', name: 'Farah Front', position: 'ST' },
].map((entry, index) => ({
  ...entry, team_id: 'home', jersey_number: index + 1,
  photo_key: null, photo_url: null, is_active: true, created_at: '', updated_at: '',
}));

describe('LineupScreen — filling the pitch', () => {
  beforeEach(() => {
    jest.mocked(api.live).mockResolvedValue({ match: fiveASide, events: [], lineup: [], revision: 1 } as LiveMatchSnapshot);
    jest.mocked(api.players).mockResolvedValue({ items: keepersSquad, total: keepersSquad.length, limit: 100, offset: 0 } as never);
    jest.mocked(api.lineup).mockResolvedValue([] as never);
    jest.mocked(api.updateMatch).mockResolvedValue(fiveASide as never);
  });
  afterEach(() => jest.clearAllMocks());

  const open = async () => {
    const screen = await render(<LineupScreen />, { wrapper });
    await screen.findByTestId('slot-gk');
    return screen;
  };

  // A place asks for a line, so that line is offered first.
  it('offers the keepers for the place in goal', async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId('slot-gk'));

    expect(await screen.findByText('Goalkeepers')).toBeTruthy();
    expect(screen.getByTestId('pick-gk1')).toBeTruthy();
    expect(screen.getByTestId('pick-gk2')).toBeTruthy();
    // Everyone else is still reachable, so a squad can always field a side.
    expect(screen.getByText('Other positions')).toBeTruthy();
  });

  it('stands the player picked in the place that was tapped', async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId('slot-gk'));
    fireEvent.press(await screen.findByTestId('pick-gk1'));

    expect(await screen.findByLabelText('GK: Amal Keeper')).toBeTruthy();
    expect(screen.getByText('1 of 5 selected')).toBeTruthy();
  });

  // Nobody stands in two places at once, so somebody already on the pitch is
  // not offered for a second one.
  it('keeps a player who is already on the pitch out of the other lists', async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId('slot-gk'));
    fireEvent.press(await screen.findByTestId('pick-gk1'));
    expect(await screen.findByLabelText('GK: Amal Keeper')).toBeTruthy();

    fireEvent.press(screen.getByTestId('slot-0-0'));
    await screen.findByText('Defenders');
    expect(screen.queryByTestId('pick-gk1')).toBeNull();
    expect(screen.getByTestId('pick-gk2')).toBeTruthy();
  });

  it('lets a place be emptied again', async () => {
    const screen = await open();
    fireEvent.press(screen.getByTestId('slot-gk'));
    fireEvent.press(await screen.findByTestId('pick-gk1'));
    fireEvent.press(await screen.findByLabelText('GK: Amal Keeper'));
    fireEvent.press(await screen.findByText('Take Amal out'));

    expect(await screen.findByLabelText('GK, empty')).toBeTruthy();
    expect(screen.getByText('0 of 5 selected')).toBeTruthy();
  });

  // Changing the shape is what moves the places about.
  it('lays out new places when the formation changes', async () => {
    const screen = await open();
    // 2-2 is two centre-backs and two strikers, and no midfield at all.
    expect(screen.getAllByLabelText('CB, empty')).toHaveLength(2);
    expect(screen.queryByLabelText('CM, empty')).toBeNull();

    fireEvent.press(screen.getByTestId('formation-picker'));
    fireEvent.press(await screen.findByTestId('formation-option-1-2-1'));

    // 1-2-1 is one back, two in midfield and one up front.
    await screen.findAllByLabelText('CM, empty');
    expect(screen.getAllByLabelText('CM, empty')).toHaveLength(2);
    expect(screen.getAllByLabelText('CB, empty')).toHaveLength(1);
  });
});
