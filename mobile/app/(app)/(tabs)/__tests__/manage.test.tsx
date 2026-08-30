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
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
jest.mock('@/src/components/manage/HubManagers', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    AnnouncementsManager: () => React.createElement(Text, null, 'Announcements manager content'),
    ScheduleManager: () => React.createElement(Text, null, 'Schedule manager content'),
  };
});
jest.mock('@/src/lib/api', () => ({
  api: {
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

describe('ManageScreen navigation', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.mocked(api.teams).mockResolvedValue(emptyPage);
    jest.mocked(api.competitions).mockResolvedValue(emptyPage);
    jest.mocked(api.players).mockResolvedValue(emptyPage);
    jest.mocked(api.matches).mockResolvedValue(emptyPage);
    jest.mocked(api.invites).mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('offers all eight animated tabs with full accessible labels', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await screen.findByText('Add squads');

    expect(screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Squads',
      'Competitions',
      'Opponents',
      'Players',
      'Matches',
      'Schedule',
      'Announcements',
      'Invites',
    ]);
    expect(screen.getByRole('tab', { name: 'Squads' }).props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('manage-tab-teams-fill')).toBeTruthy();
    expect(screen.getByTestId('manage-content')).toBeTruthy();
  });

  it('changes section, clears the previous form, and reaches hub sections', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await openForm(screen, 'squads');
    const teamName = await screen.findByLabelText('Team or squad name');
    await fireEvent.changeText(teamName, 'Unsaved squad');

    await fireEvent.press(screen.getByRole('tab', { name: 'Opponents' }));
    // The new section arrives folded, so the previous form is gone from the page.
    expect(screen.queryByLabelText('Opponent name')).toBeNull();
    await openForm(screen, 'opponents');
    expect(await screen.findByLabelText('Opponent name')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Opponents' }).props.accessibilityState.selected).toBe(true);

    await fireEvent.press(screen.getByRole('tab', { name: 'Squads' }));
    await openForm(screen, 'squads');
    await waitFor(() => expect(screen.getByLabelText('Team or squad name').props.value).toBe(''));

    await fireEvent.press(screen.getByRole('tab', { name: 'Schedule' }));
    expect(await screen.findByText('Schedule manager content')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Announcements' }));
    expect(await screen.findByText('Announcements manager content')).toBeTruthy();
  });

  it('opens every section with its form folded away', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    expect(await screen.findByText('Add squads')).toBeTruthy();
    // Folded, the card still says what it holds.
    expect(screen.getByText('A squad’s name, age group, competition and coaches.')).toBeTruthy();
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

  it('uses the family glyph for a player’s private roster details', async () => {
    jest.mocked(api.players).mockResolvedValue({ ...emptyPage, items: [{ id: 'player-1', name: 'Amina Adel', position: 'CM', jersey_number: 14 }] } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Players' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Show current players' }));

    expect(await screen.findByRole('button', { name: 'Private roster details' })).toBeTruthy();
    expect(screen.getByTestId('family-icon', { includeHiddenElements: true })).toBeTruthy();
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
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.mocked(api.teams).mockResolvedValue(emptyPage);
    jest.mocked(api.competitions).mockResolvedValue(emptyPage);
    jest.mocked(api.players).mockResolvedValue(emptyPage);
    jest.mocked(api.matches).mockResolvedValue(emptyPage);
    jest.mocked(api.invites).mockResolvedValue([]);
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
    await fireEvent.press(screen.getByText('Add item'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Squad created'));
  });

  // The same form, the same button, a different section: the confirmation has
  // to follow the section rather than the table behind it.
  it('calls an opposing club an opponent, not a squad', async () => {
    jest.mocked(api.createTeam).mockResolvedValue({ id: 't-2' } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Opponents' }));
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
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.mocked(api.teams).mockResolvedValue(emptyPage);
    jest.mocked(api.competitions).mockResolvedValue(emptyPage);
    jest.mocked(api.players).mockResolvedValue(playerPage as never);
    jest.mocked(api.matches).mockResolvedValue(emptyPage);
    jest.mocked(api.invites).mockResolvedValue([]);
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

  it('keeps the existing player and parent selection validation', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Invites' }));
    await openForm(screen, 'invites');
    await fireEvent.changeText(await screen.findByLabelText('Invite label'), 'Family invite');
    await fireEvent.changeText(screen.getByLabelText('Invite code'), 'FAMILY-26');

    await fireEvent.press(screen.getByText('Add item'));
    expect(await screen.findByText('Choose a player.')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Invite type' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Parent' }));
    await fireEvent.press(screen.getByText('Add item'));
    expect(await screen.findByText('Choose at least one child.')).toBeTruthy();
    expect(api.createInvite).not.toHaveBeenCalled();
  });
});
