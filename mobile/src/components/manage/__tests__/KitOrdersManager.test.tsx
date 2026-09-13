import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { KitOrdersManager } from '@/src/components/manage/KitOrdersManager';
import { api } from '@/src/lib/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/manage' }));
// Marking an order paid asks first; the test takes the confirmation as given.
jest.mock('@/src/lib/platformAlert', () => ({
  showMessage: jest.fn(),
  confirmAction: (_title: string, _message: string, _label: string, onConfirm: () => void) => onConfirm(),
}));
jest.mock('@/src/lib/api', () => ({
  api: { kitOrders: jest.fn(), setKitStatus: jest.fn() },
  ApiError: class extends Error {},
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const order = (over: Record<string, unknown> = {}) => ({
  id: 'k-1', player_id: 'p-1', player_name: 'Jana Sherif', team_id: 't-1', squad_name: 'AIMZ U13',
  ordered_by_id: 'u-1', team_label: 'Senzo 2013', kind: 'player', shirt_name: 'JANA', shirt_number: 10,
  kit_size: '12', hoodie_size: 'S', outwear_size: 'S', delivery: 'branch', status: 'ordered',
  notes: null, paid_at: null, created_at: '2026-09-10T08:00:00.000Z', updated_at: '2026-09-10T08:00:00.000Z', ...over,
});

describe('the kit book', () => {
  beforeEach(() => {
    jest.mocked(api.kitOrders).mockResolvedValue({ items: [order()], total: 1, limit: 100, offset: 0 } as never);
    jest.mocked(api.setKitStatus).mockResolvedValue(order({ status: 'fulfilled', paid_at: '2026-09-10T09:00:00.000Z' }) as never);
  });
  afterEach(() => jest.clearAllMocks());

  // The open orders are the list somebody works from; a season of filled ones
  // underneath would bury them.
  it('opens on the orders still to be paid for', async () => {
    const screen = await render(<KitOrdersManager />, { wrapper });
    await waitFor(() => expect(api.kitOrders).toHaveBeenCalledWith('?status=ordered'));
    expect(screen.getByRole('tab', { name: 'Orders' }).props.accessibilityState.selected).toBe(true);
  });

  it('gives the supplier one line to work from', async () => {
    const screen = await render(<KitOrdersManager />, { wrapper });
    expect(await screen.findByText('Jana Sherif')).toBeTruthy();
    expect(screen.getByText(/JANA 10 · Kit 12 · Hoodie S · Outwear S/u)).toBeTruthy();
    // Both names, because the supplier's is not the squad's.
    expect(screen.getByText(/Senzo 2013 · AIMZ U13/u)).toBeTruthy();
  });

  // An order sits in the queue until somebody says the money arrived. Opening
  // it, or reading it, is not that.
  it('moves an order to Ready only when it is marked paid', async () => {
    const screen = await render(<KitOrdersManager />, { wrapper });
    await fireEvent.press(await screen.findByText('Mark as paid'));
    expect(api.setKitStatus).toHaveBeenCalledWith('k-1', 'fulfilled');
  });

  it('reads a different queue when one is chosen', async () => {
    const screen = await render(<KitOrdersManager />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Cancelled' }));
    await waitFor(() => expect(api.kitOrders).toHaveBeenCalledWith('?status=cancelled'));
  });

  // A paid order offers no "mark as paid", or pressing it would say nothing new.
  it('offers only the moves an order has left, and says when it was paid', async () => {
    jest.mocked(api.kitOrders).mockResolvedValue({ items: [order({ status: 'fulfilled', paid_at: '2026-09-10T09:00:00.000Z' })], total: 1, limit: 100, offset: 0 } as never);
    const screen = await render(<KitOrdersManager />, { wrapper });
    await screen.findByText('Jana Sherif');
    expect(screen.queryByText('Mark as paid')).toBeNull();
    expect(screen.getByText(/^Paid /u)).toBeTruthy();
    expect(screen.getByText('Back to orders')).toBeTruthy();
  });
});
