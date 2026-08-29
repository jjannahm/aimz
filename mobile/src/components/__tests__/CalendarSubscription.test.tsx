import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Linking, Share } from 'react-native';

import { CalendarSubscription } from '@/src/components/CalendarSubscription';
import { api } from '@/src/lib/api';
import { confirmAction } from '@/src/lib/platformAlert';

let mockRole: 'admin' | 'parent' | 'player' = 'parent';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: mockRole } }) }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    calendarFeed: jest.fn(),
    regenerateCalendarFeed: jest.fn(),
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

describe('CalendarSubscription', () => {
  beforeEach(() => {
    mockRole = 'parent';
    jest.mocked(api.calendarFeed).mockResolvedValue({ url: 'https://api.aimz.test/api/v1/calendar/private/aimz.ics', subscribed_at: null });
    jest.mocked(api.regenerateCalendarFeed).mockResolvedValue({ url: 'https://api.aimz.test/api/v1/calendar/new/aimz.ics', subscribed_at: null });
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('opens the private feed as a calendar subscription from the Hub', async () => {
    const screen = await render(<CalendarSubscription placement="hub" />, { wrapper });
    fireEvent.press(await screen.findByRole('button', { name: 'Subscribe to calendar' }));

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('webcal://api.aimz.test/api/v1/calendar/private/aimz.ics'));
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('shares the HTTPS address when the device has no calendar handler', async () => {
    jest.mocked(Linking.canOpenURL).mockResolvedValue(false);
    const screen = await render(<CalendarSubscription placement="hub" />, { wrapper });
    fireEvent.press(await screen.findByRole('button', { name: 'Subscribe to calendar' }));

    await waitFor(() => expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('https://api.aimz.test/api/v1/calendar/private/aimz.ics'),
    })));
  });

  it('leaves the Hub once a calendar client has fetched the feed', async () => {
    jest.mocked(api.calendarFeed).mockResolvedValue({ url: 'https://api.aimz.test/calendar.ics', subscribed_at: '2026-08-30T10:00:00.000Z' });
    const screen = await render(<CalendarSubscription placement="hub" />, { wrapper });

    await waitFor(() => expect(screen.queryByLabelText('Calendar subscription')).toBeNull());
  });

  it('warns in Settings before regenerating the link', async () => {
    const screen = await render(<CalendarSubscription placement="settings" />, { wrapper });
    fireEvent.press(await screen.findByRole('button', { name: 'Regenerate link' }));

    expect(confirmAction).toHaveBeenCalledWith(
      'Regenerate calendar link?',
      expect.stringContaining('existing calendar subscription will stop updating'),
      'Regenerate',
      expect.any(Function),
      { destructive: true },
    );
    expect(api.regenerateCalendarFeed).not.toHaveBeenCalled();
  });

  it('does not request or show a feed for administrators', async () => {
    mockRole = 'admin';
    const screen = await render(<CalendarSubscription placement="settings" />, { wrapper });
    expect(screen.queryByLabelText('Calendar subscription')).toBeNull();
    expect(api.calendarFeed).not.toHaveBeenCalled();
  });
});
