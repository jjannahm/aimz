import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import ManageScreen from '@/app/(app)/(tabs)/manage';
import { api } from '@/src/lib/api';
import { showToast } from '@/src/lib/platformAlert';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  Redirect: 'Redirect',
  router: { push: jest.fn() },
  usePathname: () => '/manage',
}));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), requestMediaLibraryPermissionsAsync: jest.fn() }));
let mockRole = 'admin';
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: mockRole } }) }));
jest.mock('@/src/components/AuditTrail', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { AuditTrail: ({ heading }: { heading?: string }) => React.createElement(Text, null, `Audit trail content${heading ? ` under ${heading}` : ''}`) };
});
jest.mock('@/src/components/manage/FeesManager', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { FeesManager: () => React.createElement(Text, null, 'Fees coach content') };
});
jest.mock('@/src/components/manage/TrainingStatsManager', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { TrainingStatsManager: () => React.createElement(Text, null, 'Training stats content') };
});
jest.mock('@/src/components/manage/ReportsManager', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { ReportsManager: () => React.createElement(Text, null, 'Reports coach content') };
});
jest.mock('@/src/components/manage/HubManagers', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    AnnouncementsManager: () => React.createElement(Text, null, 'Announcements coach content'),
    ScheduleManager: () => React.createElement(Text, null, 'Schedule coach content'),
  };
});
jest.mock('@/src/lib/api', () => ({
  api: {
    adminUsers: jest.fn(),
    branches: jest.fn(),
    competitions: jest.fn(),
    groups: jest.fn(),
    invites: jest.fn(),
    matches: jest.fn(),
    players: jest.fn(),
    teams: jest.fn(),
    createTeam: jest.fn(),
    updateTeam: jest.fn(),
    createPlayer: jest.fn(),
    createInvite: jest.fn(),
    deletePlayer: jest.fn(),
  },
  ApiError: class extends Error {},
}));
jest.mock('@/src/lib/platformAlert', () => ({
  ...jest.requireActual('@/src/lib/platformAlert'),
  showToast: jest.fn(),
  showMessage: jest.fn(),
  confirmAction: jest.fn((_title: string, _body: string, _label: string, onConfirm: () => void) => onConfirm()),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const emptyPage = { items: [], total: 0, limit: 100, offset: 0 };

/** Every Manage section arrives with its Add form folded away. */
const openForm = async (screen: Awaited<ReturnType<typeof render>>, section: string) =>
  fireEvent.press(await screen.findByRole('button', { name: `Show add ${section} form` }));

/**
 * The navigation pills, by testID rather than by role: the sub-tabs under
 * Squads and Schedule are a SegmentedControl, whose segments are tabs too, so
 * a role query would return both rows mixed together.
 */
const pills = (screen: Awaited<ReturnType<typeof render>>) =>
  screen.getAllByTestId(/^manage-tab-[a-z]+$/u).map((pill) => pill.props.accessibilityLabel);

/** One half of a shared pill: Squads and Schedule each hold two sections. */
const subTab = async (screen: Awaited<ReturnType<typeof render>>, name: string) =>
  fireEvent.press(await screen.findByRole('tab', { name }));

describe('ManageScreen navigation', () => {
  beforeEach(() => {
    mockRole = 'admin';
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.mocked(api.teams).mockResolvedValue(emptyPage);
    jest.mocked(api.competitions).mockResolvedValue(emptyPage);
    jest.mocked(api.players).mockResolvedValue(emptyPage);
    jest.mocked(api.matches).mockResolvedValue(emptyPage);
    jest.mocked(api.invites).mockResolvedValue([]);
    jest.mocked(api.branches).mockResolvedValue({ items: [{ name: 'Gardenia (Agyal Park)', area: 'East' }, { name: 'AUC', area: 'East' }] });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('offers a pill for each section, with opponents folded into its pair', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await screen.findByText('Add squads');

    expect(pills(screen)).toEqual([
      'Squads',
      'Competitions',
      'Players',
      'Schedule',
      'Matches',
      'Announcements',
      'Invites',
      'Fees',
      'Reports',
      'Newcomers',
      'Kit',
      'Activity',
    ]);
    // The one still merged away is reachable, but underneath its pill.
    expect(screen.queryByTestId('manage-tab-opponents')).toBeNull();
    expect(screen.getByTestId('manage-tab-teams-fill')).toBeTruthy();
    expect(screen.getByTestId('manage-content')).toBeTruthy();
  });

  /**
   * The audit log was only ever an administrator's to read, and moving it out
   * of Settings must not have handed it to anybody else. Matches, which a coach
   * could always reach under Schedule, must not have been taken away either.
   */
  it('keeps the academy-wide pills away from a coach', async () => {
    mockRole = 'coach';
    const screen = await render(<ManageScreen />, { wrapper });
    await screen.findByTestId('manage-tab-schedule');

    expect(pills(screen)).toEqual(['Schedule', 'Announcements', 'Reports', 'Kit']);
    expect(screen.queryByTestId('manage-tab-matches')).toBeNull();
    expect(screen.queryByTestId('manage-tab-activity')).toBeNull();
  });

  it('opens the Squads pill on our own squads, with opponents alongside', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    expect(await screen.findByRole('tab', { name: 'AIMZ Squads' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'AIMZ Squads' }).props.accessibilityState.selected).toBe(true);
    expect(await screen.findByText('Add squads')).toBeTruthy();

    await subTab(screen, 'Opponent Squads');
    expect(await screen.findByText('Add opponents')).toBeTruthy();
  });

  it('opens Schedule straight onto training, with matches on their own pill', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(screen.getByTestId('manage-tab-schedule'));
    expect(await screen.findByText('Schedule coach content')).toBeTruthy();
    // The mode selector that used to sit here is gone: Schedule is training now.
    expect(screen.queryByRole('tab', { name: 'Training Sessions' })).toBeNull();

    await fireEvent.press(screen.getByTestId('manage-tab-matches'));
    expect(await screen.findByText('Add matches')).toBeTruthy();
    expect(screen.queryByText('Schedule coach content')).toBeNull();
  });

  it('reaches the audit log from the Activity pill', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(screen.getByTestId('manage-tab-activity'));

    // The trail carries its own heading and magnifier; the section above it says
    // nothing more, so the line that used to explain it is gone.
    expect(await screen.findByText('Audit trail content under Admin activity')).toBeTruthy();
    expect(screen.queryByText('Every change an admin made to a match.')).toBeNull();
    expect(screen.getByRole('button', { name: 'See the full log' })).toBeTruthy();
  });

  // Each pill keeps its own half; leaving and coming back starts over.
  it('reaches the fees ledger from its own pill', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(screen.getByTestId('manage-tab-fees'));
    expect(await screen.findByText('Fees coach content')).toBeTruthy();
    // Fees manages itself, so the shared Add form is not on the page at all.
    expect(screen.queryByText('Add squads')).toBeNull();
  });

  it('reaches the reports from their own pill, with the training numbers alongside', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(screen.getByTestId('manage-tab-reports'));
    expect(await screen.findByText('Reports coach content')).toBeTruthy();

    await subTab(screen, 'Training Stats');
    expect(await screen.findByText('Training stats content')).toBeTruthy();
    expect(screen.queryByText('Reports coach content')).toBeNull();
  });

  it('starts a pill back on its first half when it is left and returned to', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await subTab(screen, 'Opponent Squads');
    await screen.findByText('Add opponents');

    await fireEvent.press(screen.getByTestId('manage-tab-players'));
    await fireEvent.press(screen.getByTestId('manage-tab-teams'));
    expect(await screen.findByText('Add squads')).toBeTruthy();
  });

  it('changes section, clears the previous form, and reaches hub sections', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await openForm(screen, 'squads');
    const teamName = await screen.findByLabelText('Team or squad name');
    await fireEvent.changeText(teamName, 'Unsaved squad');

    await subTab(screen, 'Opponent Squads');
    // The new section arrives folded, so the previous form is gone from the page.
    expect(screen.queryByLabelText('Opponent name')).toBeNull();
    await openForm(screen, 'opponents');
    expect(await screen.findByLabelText('Opponent name')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Opponent Squads' }).props.accessibilityState.selected).toBe(true);

    await subTab(screen, 'AIMZ Squads');
    await openForm(screen, 'squads');
    await waitFor(() => expect(screen.getByLabelText('Team or squad name').props.value).toBe(''));

    await fireEvent.press(screen.getByTestId('manage-tab-schedule'));
    expect(await screen.findByText('Schedule coach content')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('manage-tab-announcements'));
    expect(await screen.findByText('Announcements coach content')).toBeTruthy();
  });

  it('opens every section with its form folded away', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    expect(await screen.findByText('Add squads')).toBeTruthy();
    // Folded, the card still says what it holds.
    expect(screen.getByText('A squad’s name, branch, age group, competition and coaches.')).toBeTruthy();
    expect(screen.queryByLabelText('Team or squad name')).toBeNull();

    await openForm(screen, 'squads');
    expect(await screen.findByLabelText('Team or squad name')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Hide add squads form' }));
    await waitFor(() => expect(screen.queryByLabelText('Team or squad name')).toBeNull());
  });

  // Pressing Edit against a closed form would scroll to nothing and read as the
  // button doing nothing at all, so the row unfolds the card on its way in.
  it('unfolds the form when a row is edited', async () => {
    jest.mocked(api.players).mockResolvedValue({ ...emptyPage, items: [{ id: 'player-1', name: 'Amina Adel', team_id: 'team-1', position: 'CM', jersey_number: 14 }] } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Players' }));
    expect(screen.queryByLabelText('Player name')).toBeNull();

    await fireEvent.press(await screen.findByRole('button', { name: 'Show current players' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByText('Edit players')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Player name').props.value).toBe('Amina Adel'));
  });

  it('groups current AIMZ squads by branch and keeps legacy squads visible', async () => {
    jest.mocked(api.teams).mockResolvedValue({ ...emptyPage, total: 4, items: [
      { id: 'team-1', name: 'U12 Blue', branch: 'Gardenia', is_aimz: true, season: '2026/27' },
      { id: 'team-2', name: 'U14 Blue', branch: 'Gardenia', is_aimz: true, season: '2026/27' },
      { id: 'team-3', name: 'U16 West', branch: 'Palm Hills', is_aimz: true, season: '2026/27' },
      { id: 'team-4', name: 'Legacy squad', branch: null, is_aimz: true, season: '2026/27' },
    ] } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('button', { name: 'Show current squads' }));

    expect(await screen.findByRole('header', { name: 'Gardenia' })).toBeTruthy();
    expect(screen.getByText('2 squads')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Palm Hills' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Branch not set' })).toBeTruthy();
    expect(screen.getByText('Legacy squad')).toBeTruthy();
  });

  /**
   * Whether a family has the app at all is read off who has registered against
   * the player: their own login, or a parent holding them as a child. A row
   * carries that and nothing else beside Edit and Delete — the family glyph
   * that used to open the private roster details is gone.
   */
  it('says which players are on the app', async () => {
    jest.mocked(api.players).mockResolvedValue({ ...emptyPage, items: [
      { id: 'player-1', name: 'Amina Adel', position: 'CM', jersey_number: 14 },
      { id: 'player-2', name: 'Amina Nabil', position: 'CM', jersey_number: 11 },
    ] } as never);
    jest.mocked(api.adminUsers).mockResolvedValue({ ...emptyPage, items: [
      { id: 'user-1', name: 'Amina Adel', email: 'a@a.test', role: 'player', player: { id: 'player-1' }, team: null, children: [] },
    ] } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Players' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Show current players' }));

    expect(await screen.findByText('On the app')).toBeTruthy();
    expect(screen.getByText('No app')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Private roster details' })).toBeNull();
  });

  it('searches the current players rather than scrolling them', async () => {
    jest.mocked(api.players).mockResolvedValue({ ...emptyPage, items: [
      { id: 'player-1', name: 'Amina Adel', position: 'CM', jersey_number: 14 },
      { id: 'player-2', name: 'Nour Hassan', position: 'GK', jersey_number: 1 },
    ] } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Players' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Search current players' }));

    await fireEvent.changeText(screen.getByTestId('search-input'), 'nour');
    await waitFor(() => expect(screen.queryByText('Amina Adel')).toBeNull());
    expect(screen.getByText('Nour Hassan')).toBeTruthy();

    // A row is matched on the line beneath the name too, so a position or a
    // shirt number finds it.
    await fireEvent.changeText(screen.getByTestId('search-input'), '#14');
    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());
    expect(screen.queryByText('Nour Hassan')).toBeNull();
  });

  it('leaves a search behind when the section changes', async () => {
    jest.mocked(api.players).mockResolvedValue({ ...emptyPage, items: [{ id: 'player-1', name: 'Amina Adel', position: 'CM', jersey_number: 14 }] } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Players' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Search current players' }));
    await fireEvent.changeText(screen.getByTestId('search-input'), 'nobody');
    await waitFor(() => expect(screen.getByText('Nothing matches that.')).toBeTruthy());

    await fireEvent.press(screen.getByRole('tab', { name: 'Squads' }));
    await fireEvent.press(await screen.findByRole('tab', { name: 'Players' }));
    expect(await screen.findByText('Amina Adel')).toBeTruthy();
    expect(screen.getByTestId('search-input').props.value).toBe('');
  });
});

describe('ManageScreen confirmations', () => {
  beforeEach(() => {
    mockRole = 'admin';
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.mocked(api.teams).mockResolvedValue(emptyPage);
    jest.mocked(api.competitions).mockResolvedValue(emptyPage);
    jest.mocked(api.players).mockResolvedValue(emptyPage);
    jest.mocked(api.matches).mockResolvedValue(emptyPage);
    jest.mocked(api.invites).mockResolvedValue([]);
    jest.mocked(api.branches).mockResolvedValue({ items: [{ name: 'Gardenia (Agyal Park)', area: 'East' }, { name: 'AUC', area: 'East' }] });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('confirms a new squad in the same words the schedule already used', async () => {
    jest.mocked(api.createTeam).mockResolvedValue({ id: 't-1' } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await openForm(screen, 'squads');
    await fireEvent.changeText(await screen.findByLabelText('Team or squad name'), 'AIMZ U14');
    // The branch is chosen from the academy's list now rather than typed.
    await fireEvent.press(screen.getByLabelText('Branch'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Gardenia (Agyal Park) (East)' }));
    await fireEvent.press(screen.getByText('Add item'));
    await waitFor(() => expect(api.createTeam).toHaveBeenCalledWith(expect.objectContaining({ branch: 'Gardenia (Agyal Park)' })));
    expect(showToast).toHaveBeenCalledWith('Squad created');
  });

  // The same form, the same button, a different section: the confirmation has
  // to follow the section rather than the table behind it.
  it('calls an opposing club an opponent, not a squad', async () => {
    jest.mocked(api.createTeam).mockResolvedValue({ id: 't-2' } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await subTab(screen, 'Opponent Squads');
    await openForm(screen, 'opponents');
    await fireEvent.changeText(await screen.findByLabelText('Opponent name'), 'Cairo Stars');
    await fireEvent.press(screen.getByText('Add item'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Opponent created'));
  });

  it('says nothing at all when the save fails', async () => {
    jest.mocked(api.createTeam).mockRejectedValue(new Error('The server refused it.'));
    const screen = await render(<ManageScreen />, { wrapper });
    await openForm(screen, 'squads');
    await fireEvent.changeText(await screen.findByLabelText('Team or squad name'), 'AIMZ U14');
    // The branch is chosen from the academy's list now rather than typed.
    await fireEvent.press(screen.getByLabelText('Branch'));
    await fireEvent.press(await screen.findByRole('button', { name: 'Gardenia (Agyal Park) (East)' }));
    await fireEvent.press(screen.getByText('Add item'));
    await waitFor(() => expect(screen.getByText('The server refused it.')).toBeTruthy());
    expect(showToast).not.toHaveBeenCalled();
  });

  it('says nothing when the form is rejected before anything is sent', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await openForm(screen, 'squads');
    await screen.findByLabelText('Team or squad name');
    // No name typed, so it never reaches the API.
    await fireEvent.press(screen.getByText('Add item'));
    await waitFor(() => expect(screen.getByText('Enter a team or squad name.')).toBeTruthy());
    expect(api.createTeam).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('requires a branch for a new AIMZ squad', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await openForm(screen, 'squads');
    await fireEvent.changeText(await screen.findByLabelText('Team or squad name'), 'AIMZ U14');
    await fireEvent.press(screen.getByText('Add item'));
    expect(await screen.findByText('Enter the squad branch.')).toBeTruthy();
    expect(api.createTeam).not.toHaveBeenCalled();
  });
});

describe('ManageScreen invite player picker', () => {
  const playerPage = {
    ...emptyPage,
    items: [
      { id: 'p-1', name: 'Amina Adel' },
      { id: 'p-2', name: 'Amina Sabry' },
      { id: 'p-3', name: 'Aya Nabil' },
    ],
    total: 3,
  };

  beforeEach(() => {
    mockRole = 'admin';
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.mocked(api.teams).mockResolvedValue(emptyPage);
    jest.mocked(api.competitions).mockResolvedValue(emptyPage);
    jest.mocked(api.players).mockResolvedValue(playerPage as never);
    jest.mocked(api.matches).mockResolvedValue(emptyPage);
    jest.mocked(api.invites).mockResolvedValue([]);
    jest.mocked(api.branches).mockResolvedValue({ items: [{ name: 'Gardenia (Agyal Park)', area: 'East' }, { name: 'AUC', area: 'East' }] });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('searches both invite modes and clears a player when the type changes', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Invites' }));
    await openForm(screen, 'invites');
    expect(await screen.findByText('Choose a player')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Player' }));
    await waitFor(() => expect(screen.getByTestId('player-picker-search')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('player-picker-search'), 'adel');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Amina Adel' }));
    expect(await screen.findByText('Amina Adel')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Invite type' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Parent' }));
    expect(await screen.findByText('Choose children')).toBeTruthy();
    expect(screen.queryByTestId('player-picker-chip-p-1')).toBeNull();

    fireEvent.press(screen.getByRole('button', { name: 'Children' }));
    await waitFor(() => expect(screen.getByTestId('player-picker-search')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('player-picker-search'), 'sabry');
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Amina Sabry' }));
    expect(screen.getByTestId('player-picker-chip-p-2')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByTestId('player-picker-menu')).toBeNull());
  });

  it('allows an unassigned player intake and still requires a parent child', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Invites' }));
    await openForm(screen, 'invites');
    await fireEvent.changeText(await screen.findByLabelText('Invite label'), 'Family invite');
    fireEvent.press(screen.getByRole('button', { name: 'Invite type' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Parent' }));
    // An invitation is generated rather than added, and says so on its button.
    await fireEvent.press(screen.getByText('Generate invitation'));
    expect(await screen.findByText('Choose at least one child.')).toBeTruthy();
    expect(api.createInvite).not.toHaveBeenCalled();
  });
});
