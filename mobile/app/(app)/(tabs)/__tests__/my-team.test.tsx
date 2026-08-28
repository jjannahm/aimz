import { fireEvent, render, waitFor } from '@testing-library/react-native';

import HubScreen from '@/app/(app)/(tabs)/my-team';

jest.mock('expo-router', () => ({ Redirect: 'Redirect', router: { push: jest.fn() }, usePathname: () => '/(app)/(tabs)/my-team' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'player', player_id: 'player-1' } }) }));
jest.mock('@/src/components/myTeam/ScheduleSection', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { ScheduleSection: () => React.createElement(Text, null, 'Schedule content') };
});
jest.mock('@/src/components/myTeam/AnnouncementsSection', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { AnnouncementsSection: () => React.createElement(Text, null, 'Announcement content') };
});

describe('HubScreen navigation', () => {
  it('switches between its two fixed sections', async () => {
    const screen = await render(<HubScreen />);

    expect(screen.getByText('Schedule content')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Schedule' }).props.accessibilityState.selected).toBe(true);

    fireEvent.press(screen.getByRole('tab', { name: 'Announcements' }));
    await waitFor(() => expect(screen.getByText('Announcement content')).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Announcements' }).props.accessibilityState.selected).toBe(true);
  });
});
