import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Linking, Share } from 'react-native';

import { CalendarSubscription } from '@/src/components/CalendarSubscription';
import { api } from '@/src/lib/api';
import { calendarFeedKey } from '@/src/lib/calendarLink';
import { confirmAction, showToast } from '@/src/lib/platformAlert';
import type { CalendarFeed } from '@/src/types/api';

let mockRole: 'admin' | 'parent' | 'player' = 'parent';

const FEED = 'https://api.aimz.test/api/v1/calendar/private/aimz.ics';
const READY_FEED: CalendarFeed = { url: FEED, subscribed_at: null };

let queryClient: QueryClient;

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: mockRole } }) }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    calendarFeed: jest.fn(),
    createCalendarFeed: jest.fn(),
    regenerateCalendarFeed: jest.fn(),
    removeCalendarFeed: jest.fn(),
  },
}));
jest.mock('@/src/lib/platformAlert', () => ({
  confirmAction: jest.fn(),
  showMessage: jest.fn(),
  showToast: jest.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** The card is folded when it mounts, so every action test opens it first. */
async function expand(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(screen.getByRole('button', { name: 'Show calendar subscription form' }));
  await waitFor(() => expect(screen.getByTestId('calendar-actions')).toBeTruthy());
  return screen;
}

/** Runs whatever `confirmAction` was handed, which is what pressing Confirm does. */
const confirmLast = () => jest.mocked(confirmAction).mock.calls.at(-1)![3]!();

describe('CalendarSubscription', () => {
  beforeEach(() => {
    mockRole = 'parent';
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: Infinity, retry: false },
        mutations: { gcTime: Infinity, retry: false },
      },
    });
    // These are component interaction tests, not API timing tests. Starting
    // with fresh cache data keeps React Query's scheduler out of the initial
    // render and removes the race with Testing Library's one-second timeout.
    queryClient.setQueryData(calendarFeedKey, READY_FEED);
    jest.mocked(api.calendarFeed).mockResolvedValue(READY_FEED);
    jest.mocked(api.createCalendarFeed).mockResolvedValue({ url: FEED, subscribed_at: null });
    jest.mocked(api.regenerateCalendarFeed).mockResolvedValue({ url: 'https://api.aimz.test/api/v1/calendar/new/aimz.ics', subscribed_at: null });
    jest.mocked(api.removeCalendarFeed).mockResolvedValue(undefined);
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('folds away, showing only whether a calendar has picked the feed up', async () => {
    queryClient.setQueryData(calendarFeedKey, { url: FEED, subscribed_at: '2026-08-30T09:00:00.000Z' });
    const screen = await render(<CalendarSubscription />, { wrapper });
    expect(screen.getByText(/^Connected /u)).toBeTruthy();
    // Nothing to press until it is opened.
    expect(screen.queryByTestId('calendar-actions')).toBeNull();
  });

  it('opens the private feed as a subscription', async () => {
    const screen = await expand(await render(<CalendarSubscription />, { wrapper }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add on another device' }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(FEED.replace('https:', 'webcal:')));
  });

  it('shares the HTTPS address when the device has no calendar handler', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(false);
    const screen = await expand(await render(<CalendarSubscription />, { wrapper }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add on another device' }));
    await waitFor(() => expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ url: FEED })));
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('warns before regenerating the link', async () => {
    const screen = await expand(await render(<CalendarSubscription />, { wrapper }));
    await fireEvent.press(screen.getByRole('button', { name: 'Regenerate link' }));
    expect(api.regenerateCalendarFeed).not.toHaveBeenCalled();
    expect(confirmAction).toHaveBeenCalledWith(
      'Regenerate calendar link?',
      expect.stringContaining('stop updating'),
      'Regenerate',
      expect.any(Function),
      { destructive: true },
    );
    confirmLast();
    // Wait for onSuccess, not merely for mutationFn to start, so no mutation
    // work can bleed through cleanup into the next test.
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('New calendar link ready'));
  });

  // Removing is not undo, and the confirm has to say so.
  it('warns before removing, and says setting up again gives a different link', async () => {
    const screen = await expand(await render(<CalendarSubscription />, { wrapper }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove subscription' }));
    expect(api.removeCalendarFeed).not.toHaveBeenCalled();
    expect(confirmAction).toHaveBeenCalledWith(
      'Remove calendar subscription?',
      expect.stringContaining('different link'),
      'Remove',
      expect.any(Function),
      { destructive: true },
    );
    confirmLast();
    // Back to offering setup rather than a dead link.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Set up calendar' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Remove subscription' })).toBeNull();
  });

  it('offers setup when there is no feed, and opens it once made', async () => {
    queryClient.setQueryData(calendarFeedKey, { url: null, subscribed_at: null });
    const screen = await expand(await render(<CalendarSubscription />, { wrapper }));
    expect(screen.queryByRole('button', { name: 'Add on another device' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Set up calendar' }));
    // Straight into the calendar, rather than handing back a link to press again.
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(FEED.replace('https:', 'webcal:')));
  });

  it('does not request or show a feed for administrators', async () => {
    mockRole = 'admin';
    queryClient.removeQueries({ queryKey: calendarFeedKey });
    const screen = await render(<CalendarSubscription />, { wrapper });
    expect(screen.queryByText('Calendar subscription')).toBeNull();
    expect(api.calendarFeed).not.toHaveBeenCalled();
  });
});
