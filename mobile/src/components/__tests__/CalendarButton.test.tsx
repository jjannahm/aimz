import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Linking, Share } from 'react-native';

import { CalendarButton } from '@/src/components/CalendarButton';
import { api } from '@/src/lib/api';
import { confirmAction } from '@/src/lib/platformAlert';

let mockRole: 'admin' | 'parent' | 'player' = 'parent';

const FEED = 'https://api.aimz.test/api/v1/calendar/private/aimz.ics';
const FRESH = 'https://api.aimz.test/api/v1/calendar/new/aimz.ics';
const webcal = (url: string) => url.replace('https:', 'webcal:');

jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: mockRole } }) }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    calendarFeed: jest.fn(),
    createCalendarFeed: jest.fn(),
    regenerateCalendarFeed: jest.fn(),
  },
}));
jest.mock('@/src/lib/platformAlert', () => ({ confirmAction: jest.fn(), showMessage: jest.fn() }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('CalendarButton', () => {
  beforeEach(() => {
    mockRole = 'parent';
    jest.mocked(api.calendarFeed).mockResolvedValue({ url: null, subscribed_at: null });
    jest.mocked(api.createCalendarFeed).mockResolvedValue({ url: FEED, subscribed_at: null });
    jest.mocked(api.regenerateCalendarFeed).mockResolvedValue({ url: FRESH, subscribed_at: null });
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('sets a feed up and opens it on the first press', async () => {
    const screen = await render(<CalendarButton />, { wrapper });
    await fireEvent.press(await screen.findByTestId('calendar-button'));
    await waitFor(() => expect(api.createCalendarFeed).toHaveBeenCalled());
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(webcal(FEED)));
    // Nothing destructive happened, so nothing was asked.
    expect(confirmAction).not.toHaveBeenCalled();
  });

  /**
   * The guard that matters: regenerating stops every calendar already holding
   * the link from updating, and this is a header icon easy to catch by mistake.
   */
  it('asks before replacing a subscription that already works', async () => {
    jest.mocked(api.calendarFeed).mockResolvedValue({ url: FEED, subscribed_at: '2026-08-30T09:00:00.000Z' });
    const screen = await render(<CalendarButton />, { wrapper });
    await waitFor(() => expect(screen.getByLabelText('Calendar subscription')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('calendar-button'));
    expect(api.regenerateCalendarFeed).not.toHaveBeenCalled();
    expect(confirmAction).toHaveBeenCalledWith(
      'Regenerate calendar link?',
      expect.stringContaining('stop updating'),
      'Regenerate',
      expect.any(Function),
      { destructive: true },
    );

    await jest.mocked(confirmAction).mock.calls.at(-1)![3]!();
    await waitFor(() => expect(api.regenerateCalendarFeed).toHaveBeenCalled());
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(webcal(FRESH)));
  });

  it('names itself for what the press will do', async () => {
    const screen = await render(<CalendarButton />, { wrapper });
    expect(await screen.findByLabelText('Add to calendar')).toBeTruthy();

    jest.mocked(api.calendarFeed).mockResolvedValue({ url: FEED, subscribed_at: null });
    const subscribed = await render(<CalendarButton />, { wrapper });
    expect(await subscribed.findByLabelText('Calendar subscription')).toBeTruthy();
  });

  it('stays out of an administrator’s header', async () => {
    mockRole = 'admin';
    const screen = await render(<CalendarButton />, { wrapper });
    expect(screen.queryByTestId('calendar-button')).toBeNull();
    expect(api.calendarFeed).not.toHaveBeenCalled();
  });
});
