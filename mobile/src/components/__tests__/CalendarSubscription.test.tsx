import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Linking, Share } from 'react-native';

import { CalendarSubscription } from '@/src/components/CalendarSubscription';
import { api } from '@/src/lib/api';
import { confirmAction } from '@/src/lib/platformAlert';

let mockRole: 'admin' | 'parent' | 'player' = 'parent';

const FEED = 'https://api.aimz.test/api/v1/calendar/private/aimz.ics';

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
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The card is folded when it mounts, so every action test opens it first. */
async function expand(screen: Awaited<ReturnType<typeof render>>) {
  await fireEvent.press(await screen.findByRole('button', { name: 'Show calendar subscription form' }));
  await waitFor(() => expect(screen.getByTestId('calendar-actions')).toBeTruthy());
  return screen;
}

/** Runs whatever `confirmAction` was handed, which is what pressing Confirm does. */
const confirmLast = () => jest.mocked(confirmAction).mock.calls.at(-1)![3]!();

describe('CalendarSubscription', () => {
  beforeEach(() => {
    mockRole = 'parent';
    jest.mocked(api.calendarFeed).mockResolvedValue({ url: FEED, subscribed_at: null });
    jest.mocked(api.createCalendarFeed).mockResolvedValue({ url: FEED, subscribed_at: null });
    jest.mocked(api.regenerateCalendarFeed).mockResolvedValue({ url: 'https://api.aimz.test/api/v1/calendar/new/aimz.ics', subscribed_at: null });
    jest.mocked(api.removeCalendarFeed).mockResolvedValue(undefined);
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('folds away, showing only whether a calendar has picked the feed up', async () => {
    jest.mocked(api.calendarFeed).mockResolvedValue({ url: FEED, subscribed_at: '2026-08-30T09:00:00.000Z' });
    const screen = await render(<CalendarSubscription />, { wrapper });
    expect(await screen.findByText(/^Connected /u)).toBeTruthy();
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
    await confirmLast();
    await waitFor(() => expect(api.regenerateCalendarFeed).toHaveBeenCalled());
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
    await confirmLast();
    await waitFor(() => expect(api.removeCalendarFeed).toHaveBeenCalled());
    // Back to offering setup rather than a dead link.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Set up calendar' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Remove subscription' })).toBeNull();
  });

  it('offers setup when there is no feed, and opens it once made', async () => {
    jest.mocked(api.calendarFeed).mockResolvedValue({ url: null, subscribed_at: null });
    const screen = await expand(await render(<CalendarSubscription />, { wrapper }));
    expect(screen.queryByRole('button', { name: 'Add on another device' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Set up calendar' }));
    await waitFor(() => expect(api.createCalendarFeed).toHaveBeenCalled());
    // Straight into the calendar, rather than handing back a link to press again.
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(FEED.replace('https:', 'webcal:')));
  });

  it('does not request or show a feed for administrators', async () => {
    mockRole = 'admin';
    const screen = await render(<CalendarSubscription />, { wrapper });
    expect(screen.queryByText('Calendar subscription')).toBeNull();
    expect(api.calendarFeed).not.toHaveBeenCalled();
  });
});
