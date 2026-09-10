import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { KitOrdersManager } from '@/src/components/manage/KitOrdersManager';
import { api } from '@/src/lib/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/manage' }));
jest.mock('@/src/lib/platformAlert', () => ({ showMessage: jest.fn() }));
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
  notes: null, created_at: '2026-09-10T08:00:00.000Z', updated_at: '2026-09-10T08:00:00.000Z', ...over,
});

describe('the kit book', () => {
  beforeEach(() => {
    jest.mocked(api.kitOrders).mockResolvedValue({ items: [order()], total: 1, limit: 100, offset: 0 } as never);
    jest.mocked(api.setKitStatus).mockResolvedValue(order({ status: 'fulfilled' }) as never);
  });
  afterEach(() => jest.clearAllMocks());

  // The open orders are the list somebody works from; a season of filled ones
  // underneath would bury them.
  it('opens on the orders still to be made', async () => {
    const screen = await render(<KitOrdersManager />, { wrapper });
    await waitFor(() => expect(api.kitOrders).toHaveBeenCalledWith('?status=ordered&limit=100'));
    expect(screen.getByRole('tab', { name: 'To order' }).props.accessibilityState.selected).toBe(true);
  });

  it('gives the supplier one line to work from', async () => {
    const screen = await render(<KitOrdersManager />, { wrapper });
    expect(await screen.findByText('Jana Sherif')).toBeTruthy();
    expect(screen.getByText(/JANA 10 · Kit 12 · Hoodie S · Outwear S/u)).toBeTruthy();
    // Both names, because the supplier's is not the squad's.
    expect(screen.getByText(/Senzo 2013 · AIMZ U13/u)).toBeTruthy();
  });

  it('marks an order ready', async () => {
    const screen = await render(<KitOrdersManager />, { wrapper });
    await fireEvent.press(await screen.findByText('Mark ready'));
    expect(api.setKitStatus).toHaveBeenCalledWith('k-1', 'fulfilled');
  });

  it('reads a different queue when one is chosen', async () => {
    const screen = await render(<KitOrdersManager />, { wrapper });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Cancelled' }));
    await waitFor(() => expect(api.kitOrders).toHaveBeenCalledWith('?status=cancelled&limit=100'));
  });

  // A filled order offers no "mark ready", or the button would say nothing.
  it('offers only the moves an order has left', async () => {
    jest.mocked(api.kitOrders).mockResolvedValue({ items: [order({ status: 'fulfilled' })], total: 1, limit: 100, offset: 0 } as never);
    const screen = await render(<KitOrdersManager />, { wrapper });
    await screen.findByText('Jana Sherif');
    expect(screen.queryByText('Mark ready')).toBeNull();
    expect(screen.getByText('Back to ordered')).toBeTruthy();
  });
});
