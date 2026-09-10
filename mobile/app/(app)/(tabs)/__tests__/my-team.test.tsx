import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import HubScreen from '@/app/(app)/(tabs)/my-team';
import { api } from '@/src/lib/api';

jest.mock('expo-router', () => ({ Redirect: 'Redirect', router: { push: jest.fn() }, usePathname: () => '/(app)/(tabs)/my-team' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'player', player_id: 'player-1' } }) }));
// The Hub reaches the calendar through a header button now, not a card.
jest.mock('@/src/components/CalendarButton', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { CalendarButton: () => React.createElement(Text, null, 'Calendar button') };
});
jest.mock('@/src/components/myTeam/ScheduleSection', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { ScheduleSection: () => React.createElement(Text, null, 'Schedule content') };
});
jest.mock('@/src/lib/api', () => ({ api: { announcements: jest.fn() }, ApiError: class extends Error {} }));
jest.mock('@/src/components/myTeam/AnnouncementsSection', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { AnnouncementsSection: () => React.createElement(Text, null, 'Announcement content') };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const announcement = (id: string, priority: string) => ({ id, priority, title: id, body: '', team: null, author_name: null, created_at: '2026-01-01T00:00:00Z' });
const page = (items: unknown[]) => ({ items, total: items.length, limit: 100, offset: 0 });

describe('HubScreen navigation', () => {
  beforeEach(() => jest.mocked(api.announcements).mockResolvedValue(page([]) as never));
  afterEach(() => jest.clearAllMocks());

  it('switches between its two fixed sections', async () => {
    const screen = await render(<HubScreen />, { wrapper });

    expect(screen.getByText('Schedule content')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Schedule' }).props.accessibilityState.selected).toBe(true);
    // The calendar lives in the header now, so it belongs to the screen rather
    // than to whichever section happens to be open.
    expect(screen.getByText('Calendar button')).toBeTruthy();

    await fireEvent.press(screen.getByRole('tab', { name: 'Announcements' }));
    await waitFor(() => expect(screen.getByText('Announcement content')).toBeTruthy());
    expect(screen.getByText('Calendar button')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Announcements' }).props.accessibilityState.selected).toBe(true);
  });

  /**
   * Screen puts its own settings button ahead of whatever a screen passes, so
   * the Hub composes the cluster itself to get the calendar in first. Nothing
   * else would notice if that regressed, hence pinning the order here.
   */
  it('puts the calendar left of the gear', async () => {
    const screen = await render(<HubScreen />, { wrapper });
    const header = JSON.stringify(screen.toJSON());
    expect(header).toContain('Calendar button');
    expect(header.indexOf('Calendar button')).toBeLessThan(header.indexOf('"accessibilityLabel":"Settings"'));
  });

  /**
   * The dot is the only thing telling a player an urgent notice is waiting on a
   * tab they are not looking at, so each half of it is pinned: it appears for an
   * unread urgent one, ignores an ordinary one, and goes once the tab is opened.
   */
  it('marks the Announcements tab when an urgent notice is unread', async () => {
    jest.mocked(api.announcements).mockResolvedValue(page([announcement('a-1', 'urgent')]) as never);
    const screen = await render(<HubScreen />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('segmented-control-dot-announcements')).toBeTruthy());

    await fireEvent.press(screen.getByRole('tab', { name: 'Announcements, urgent unread' }));
    await waitFor(() => expect(screen.queryByTestId('segmented-control-dot-announcements')).toBeNull());
  });

  it('leaves the tab unmarked for an ordinary notice', async () => {
    jest.mocked(api.announcements).mockResolvedValue(page([announcement('a-2', 'standard')]) as never);
    const screen = await render(<HubScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Schedule content')).toBeTruthy());
    expect(screen.queryByTestId('segmented-control-dot-announcements')).toBeNull();
  });

  it('marks the tab again when a later urgent notice arrives', async () => {
    jest.mocked(api.announcements).mockResolvedValue(page([announcement('b-1', 'urgent')]) as never);
    const first = await render(<HubScreen />, { wrapper });
    await fireEvent.press(await first.findByRole('tab', { name: 'Announcements, urgent unread' }));
    await waitFor(() => expect(first.queryByTestId('segmented-control-dot-announcements')).toBeNull());
    first.unmount();

    // What was read stays read; the one posted since has never been seen.
    jest.mocked(api.announcements).mockResolvedValue(page([announcement('b-2', 'urgent'), announcement('b-1', 'urgent')]) as never);
    const second = await render(<HubScreen />, { wrapper });
    await waitFor(() => expect(second.getByTestId('segmented-control-dot-announcements')).toBeTruthy());
  });
});
