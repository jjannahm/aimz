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
    const teamName = await screen.findByLabelText('Team or squad name');
    await fireEvent.changeText(teamName, 'Unsaved squad');

    await fireEvent.press(screen.getByRole('tab', { name: 'Opponents' }));
    expect(await screen.findByLabelText('Opponent name')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Opponents' }).props.accessibilityState.selected).toBe(true);

    await fireEvent.press(screen.getByRole('tab', { name: 'Squads' }));
    await waitFor(() => expect(screen.getByLabelText('Team or squad name').props.value).toBe(''));

    await fireEvent.press(screen.getByRole('tab', { name: 'Schedule' }));
    expect(await screen.findByText('Schedule manager content')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Announcements' }));
    expect(await screen.findByText('Announcements manager content')).toBeTruthy();
  });

  it('uses the family glyph for a player’s private roster details', async () => {
    jest.mocked(api.players).mockResolvedValue({ ...emptyPage, items: [{ id: 'player-1', name: 'Amina Adel', position: 'CM', jersey_number: 14 }] } as never);
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Players' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Show current players' }));

    expect(await screen.findByRole('button', { name: 'Private roster details' })).toBeTruthy();
    expect(screen.getByTestId('family-icon', { includeHiddenElements: true })).toBeTruthy();
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
    await fireEvent.changeText(await screen.findByLabelText('Opponent name'), 'Cairo Stars');
    await fireEvent.press(screen.getByText('Add item'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Opponent created'));
  });

  it('says nothing at all when the save fails', async () => {
    jest.mocked(api.createTeam).mockRejectedValue(new Error('The server refused it.'));
    const screen = await render(<ManageScreen />, { wrapper });
    await fireEvent.changeText(await screen.findByLabelText('Team or squad name'), 'AIMZ U14');
    await fireEvent.press(screen.getByText('Add item'));
    await waitFor(() => expect(screen.getByText('The server refused it.')).toBeTruthy());
    expect(showToast).not.toHaveBeenCalled();
  });

  it('says nothing when the form is rejected before anything is sent', async () => {
    const screen = await render(<ManageScreen />, { wrapper });
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
