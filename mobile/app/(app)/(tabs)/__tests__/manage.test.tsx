import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import ManageScreen from '@/app/(app)/(tabs)/manage';
import { api } from '@/src/lib/api';

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
  },
  ApiError: class extends Error {},
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
});
