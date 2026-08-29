import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, type ViewStyle } from 'react-native';

import { useLocalSearchParams } from 'expo-router';

import StandingsScreen from '@/app/(app)/(tabs)/standings';
import { api } from '@/src/lib/api';
import type { Competition, StandingRow, Team } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'player' } }) }));
// Reached from the tab bar here, so no competition is named in the route.
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: jest.fn(() => ({})), usePathname: () => '/' }));

jest.mock('@/src/lib/api', () => ({
  api: { bracket: jest.fn(), competitions: jest.fn(), standings: jest.fn(), headToHead: jest.fn() },
  ApiError: class extends Error {},
}));

const competition = (id: string, name: string, season: string): Competition => ({
  id, name, season, type: 'league', team_count: null, group_size: null, created_at: '', updated_at: '',
});

const team = (id: string, name: string, is_aimz = false): Team => ({
  id, name, is_aimz, squad_code: null, age_group: null, season: '2026', is_active: true,
  logo_key: null, badge_style: null, coach: null, assistant_coach: null, competition_id: null, competition_group_id: null, created_at: '', updated_at: '',
});

const row = (rank: number, t: Team, points: number): StandingRow => ({
  rank, team: t, played: 4, won: 1, drawn: 1, lost: 2, goals_for: 5, goals_against: 4,
  goal_difference: 1, points, form: ['W', 'D', 'L', 'L'],
});

const league = competition('c-1', 'Women Academy League', '2026');
const cup = competition('c-2', 'Delta Cup', '2026');
const table = [
  row(1, team('t-1', 'Giza Lions'), 9),
  row(2, team('t-2', 'AIMZ U18 Women', true), 6),
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

jest.setTimeout(30_000);

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
});

afterEach(() => jest.restoreAllMocks());

describe('StandingsScreen', () => {
  beforeEach(() => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.standings).mockResolvedValue(table);
  });
  afterEach(() => jest.clearAllMocks());

  it('names the competition once, in its tab, and not again below', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    // The selected tab already says which competition this is, so a card
    // repeating the name and season under it was only spending vertical space.
    expect(await screen.findByText('Women Academy League')).toBeTruthy();
    expect(screen.getAllByText('Women Academy League')).toHaveLength(1);
    expect(screen.queryByLabelText('Women Academy League, season 2026')).toBeNull();
    expect(screen.queryByText('2026')).toBeNull();
  });

  // The gold edge used to be a left border, which is part of the box: it inset
  // the leader's cells and left them sitting right of every row beneath.
  it('lays the leading row out on the same columns as the rest', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Giza Lions');
    // The card, not the tap targets inside it: the card is what carries the
    // border and padding the columns are measured from.
    const rows = screen.getAllByTestId(/^standings-row-/u);
    expect(rows).toHaveLength(table.length);
    const boxes = rows.map((node) => StyleSheet.flatten(node.props.style) as ViewStyle);
    const leader = boxes[0]!;
    for (const other of boxes.slice(1)) {
      expect(leader.borderLeftWidth ?? 0).toBe(other.borderLeftWidth ?? 0);
      expect(leader.paddingHorizontal).toBe(other.paddingHorizontal);
      expect(leader.paddingVertical).toBe(other.paddingVertical);
      expect(leader.gap).toBe(other.gap);
    }
  });

  it('still names the competition when there is no switcher to name it', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    expect(await screen.findByText('Women Academy League')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    // The name is all that is left; the season line went with the card.
    expect(screen.queryByText('2026')).toBeNull();
  });

  it('offers a switcher and changes table when several competitions run', async () => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league, cup], total: 2, limit: 100, offset: 0 });
    const screen = await render(<StandingsScreen />, { wrapper });

    expect(await screen.findByRole('tab', { name: 'Women Academy League' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByTestId('competition-tab-c-1-fill')).toBeTruthy();
    expect(screen.getByTestId('standings-content')).toBeTruthy();
    // Defaults to the first competition.
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-1'));

    fireEvent.press(screen.getByRole('tab', { name: 'Delta Cup' }));
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-2'));
    expect(screen.getByRole('tab', { name: 'Delta Cup' }).props.accessibilityState.selected).toBe(true);
  });

  it('switches a knockout between its groups and bracket views', async () => {
    const knockout = { ...league, team_count: 8, group_size: 4 };
    jest.mocked(api.competitions).mockResolvedValue({ items: [knockout], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.bracket).mockResolvedValue({ competition_id: knockout.id, team_count: 8, rounds: [] });
    const screen = await render(<StandingsScreen />, { wrapper });

    expect(await screen.findByRole('tab', { name: 'Groups' })).toBeTruthy();
    fireEvent.press(screen.getByRole('tab', { name: 'Bracket' }));
    expect(await screen.findByText('No bracket yet')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Bracket' }).props.accessibilityState.selected).toBe(true);
  });

  it('badges each team by whether it is ours', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Giza Lions');
    // One AIMZ squad and one opponent are in the fixture table.
    expect(screen.getByTestId('badge-aimz', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('badge-opponent', { includeHiddenElements: true })).toBeTruthy();
  });

  it('marks first place with a trophy that nobody else gets', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Giza Lions');
    // Rank 1 only — a second trophy would make the highlight meaningless.
    expect(screen.getAllByLabelText('First place')).toHaveLength(1);
  });
});

describe('StandingsScreen — form guide', () => {
  beforeEach(() => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.standings).mockResolvedValue(table);
  });
  afterEach(() => jest.clearAllMocks());

  it('reads the last five results newest first', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    // Both fixture rows carry W, D, L, L, so both teams get a strip.
    expect(await screen.findAllByLabelText('Recent form: won, drew, lost, lost')).toHaveLength(table.length);
  });

  it('leaves out the strip for a team that has not played', async () => {
    jest.mocked(api.standings).mockResolvedValue([
      { ...row(1, team('t-3', 'Newly Entered'), 0), played: 0, won: 0, drawn: 0, lost: 0, form: [] },
    ]);
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Newly Entered');
    expect(screen.queryByLabelText(/^Recent form/)).toBeNull();
  });
});

// Arriving from Manage after setting a competition up: the admin should land on
// that table, not on whichever competition happens to sort first.
describe('StandingsScreen — arriving from Manage', () => {
  beforeEach(() => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league, cup], total: 2, limit: 100, offset: 0 });
    jest.mocked(api.standings).mockResolvedValue(table);
  });
  afterEach(() => jest.clearAllMocks());

  it('opens the competition the route names', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ competition: 'c-2' });
    const screen = await render(<StandingsScreen />, { wrapper });
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-2'));
    expect(screen.getByLabelText('Delta Cup').props.accessibilityState.selected).toBe(true);
  });

  it('falls back to the first competition when the route names none', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({});
    await render(<StandingsScreen />, { wrapper });
    await waitFor(() => expect(api.standings).toHaveBeenCalledWith('c-1'));
  });
});


describe('StandingsScreen — opening a team, and comparing two', () => {
  beforeEach(() => {
    jest.mocked(api.competitions).mockResolvedValue({ items: [league], total: 1, limit: 100, offset: 0 });
    jest.mocked(api.standings).mockResolvedValue(table);
  });
  afterEach(() => jest.clearAllMocks());

  const push = () => jest.mocked(require('expo-router').router.push);
  // The row's label carries its figures too, so match on the name and points it
  // opens with rather than spelling the whole readout out at every call site.
  const lions = /^Giza Lions, 9 points/u;
  const aimz = /^AIMZ U18 Women, 6 points/u;

  it('opens a team when its row is tapped', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText(lions));

    expect(push()).toHaveBeenCalledWith({ pathname: '/team/[id]', params: { id: 't-1' } });
  });

  // Comparing is one action, so it gets one control however long the table is.
  it('carries a single compare control for the whole table', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Giza Lions');

    expect(screen.getAllByLabelText('Compare two teams')).toHaveLength(1);
    expect(screen.queryByLabelText(/^Compare Giza Lions/u)).toBeNull();
  });

  // The control took a column of its own out of every row; the figures still
  // have to sit under the labels that name them.
  it('keeps the numbers under the labels they belong to', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    await screen.findByText('Giza Lions');
    const width = (node: { props: { style?: unknown } }) => (StyleSheet.flatten(node.props.style) as ViewStyle).width;

    expect(width(screen.getByText('P'))).toBe(width(screen.getAllByText('4')[0]!));
    expect(width(screen.getByText('GD'))).toBe(width(screen.getAllByText('+1')[0]!));
  });

  // One control for an action taken once: the table asks who, the rows answer.
  it('asks for two teams when the header control is pressed', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Compare two teams'));

    expect(push()).not.toHaveBeenCalled();
    expect(await screen.findByText('Select two teams to compare.')).toBeTruthy();
  });

  // Nothing picked yet, so there is nobody for a row to open.
  it('picks a team instead of opening it while comparing', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Compare two teams'));
    fireEvent.press(await screen.findByLabelText(lions));

    expect(push()).not.toHaveBeenCalled();
    expect(await screen.findByText(/Select another team to compare with Giza Lions/u)).toBeTruthy();
    expect(screen.getByLabelText(lions).props.accessibilityState.selected).toBe(true);
  });

  it('lets the same row put a team back down', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Compare two teams'));
    fireEvent.press(await screen.findByLabelText(lions));
    fireEvent.press(await screen.findByLabelText(lions));

    await waitFor(() => expect(screen.getByText('Select two teams to compare.')).toBeTruthy());
    expect(push()).not.toHaveBeenCalled();
  });

  it('compares only once a second team is picked', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Compare two teams'));
    fireEvent.press(await screen.findByLabelText(lions));
    expect(push()).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByLabelText(aimz));

    expect(push()).toHaveBeenCalledWith({ pathname: '/compare/[a]/[b]', params: { a: 't-1', b: 't-2' } });
  });

  it('offers a way out of comparison without choosing anyone', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Compare two teams'));
    fireEvent.press(await screen.findByLabelText(lions));
    fireEvent.press(await screen.findByLabelText('Cancel comparison'));

    await waitFor(() => expect(screen.queryByText(/Select another team to compare/u)).toBeNull());
    expect(screen.queryByText('Select two teams to compare.')).toBeNull();
    expect(push()).not.toHaveBeenCalled();
  });

  // The mode is a mode: leaving it hands the rows back to opening teams.
  it('opens teams again once the comparison is off', async () => {
    const screen = await render(<StandingsScreen />, { wrapper });
    fireEvent.press(await screen.findByLabelText('Compare two teams'));
    fireEvent.press(await screen.findByLabelText('Compare two teams'));
    fireEvent.press(await screen.findByLabelText(lions));

    expect(push()).toHaveBeenCalledWith({ pathname: '/team/[id]', params: { id: 't-1' } });
  });
});
