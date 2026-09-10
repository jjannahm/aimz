import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { InformationPanel } from '@/src/components/player/InformationPanel';
import { api } from '@/src/lib/api';
import type { Player, PlayerFinancials, PlayerPersonalDetails, Team } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error {},
  api: { playerPersonalDetails: jest.fn(), playerFinancials: jest.fn() },
}));

const player = { id: 'p-1', name: 'Layla Hassan', position: 'CM', jersey_number: 8 } as Player;

const details: PlayerPersonalDetails = {
  player,
  team: { id: 't-1', name: 'AIMZ U14' } as Team,
  date_of_birth: '2012-04-02',
  age: 14,
  account: null,
  contacts: [{ id: 'c-1', player_id: 'p-1', name: 'Mona Hassan', relationship: 'Mother', email: null, phone: '+20 100 000 0000', created_at: '', updated_at: '' }],
};

const charge = (over = {}) => ({
  id: 'f-1', player_id: 'p-1', player, team_id: 't-1', fee_plan_id: null, period: '2026-09',
  label: 'September fees', amount_piastres: 500000, paid_piastres: 200000, outstanding_piastres: 300000,
  status: 'partial' as const, due_on: '2026-09-01', voided_at: null, void_reason: null,
  sessions_attended: 4, sessions_required: 4,
  created_at: '', updated_at: '',
  payments: [{ id: 'pay-1', fee_charge_id: 'f-1', amount_piastres: 200000, paid_on: '2026-09-03', method: 'cash' as const, note: 'Half now', recorded_by_name: 'Admin', created_at: '' }],
  ...over,
});

const financials: PlayerFinancials = {
  player,
  summary: { charged_piastres: 500000, paid_piastres: 200000, outstanding_piastres: 300000, overdue: 0 },
  items: [charge()],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('InformationPanel', () => {
  beforeEach(() => {
    // The segmented control asks about reduced motion on mount; left real, that
    // resolves outside the test's control and takes the renderer with it.
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.mocked(api.playerPersonalDetails).mockResolvedValue(details);
    jest.mocked(api.playerFinancials).mockResolvedValue(financials);
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens on the details rather than on the money', async () => {
    const screen = await render(<InformationPanel playerId="p-1" />, { wrapper });
    await waitFor(() => expect(api.playerPersonalDetails).toHaveBeenCalledWith('p-1'));
    // The money is not even asked for until somebody asks for it.
    expect(api.playerFinancials).not.toHaveBeenCalled();
  });

  it('shows what the academy holds, and leaves out what it never asks', async () => {
    const screen = await render(<InformationPanel playerId="p-1" />, { wrapper });

    await waitFor(() => expect(screen.getByText('AIMZ U14')).toBeTruthy());
    expect(screen.getByText('2 April 2012 · 14')).toBeTruthy();
    expect(screen.getByText('Mona Hassan · Mother')).toBeTruthy();
    expect(screen.getByText('+20 100 000 0000')).toBeTruthy();
    // No account, so no row saying so: an empty field reads as a failure to
    // record one, when the truth is that nothing asks.
    expect(screen.queryByText('Account email')).toBeNull();
  });

  it('reads the ledger, with each payment as it was taken', async () => {
    const screen = await render(<InformationPanel playerId="p-1" />, { wrapper });
    await fireEvent.press(screen.getByRole('tab', { name: 'Financials' }));

    // The billing month is said the way somebody says it, never as 2026-09.
    await waitFor(() => expect(screen.getByText('September fees · September 2026')).toBeTruthy());
    expect(screen.getByText('Total due')).toBeTruthy();
    expect(screen.getByText('Part paid')).toBeTruthy();
    // What the month was earned by, and the currency said once rather than
    // three times beside figures that then have nowhere to go.
    expect(screen.getByText(/Training sessions:/u)).toBeTruthy();
    expect(screen.getByText('All amounts in EGP')).toBeTruthy();
    expect(screen.queryByText(/5,000 EGP/u)).toBeNull();
    // The month's short form varies with the platform's date data, so this asks
    // that the due date is shown rather than exactly how it is abbreviated.
    expect(screen.getByText(/^Due 1 Sept?\s+2026$/u)).toBeTruthy();
    // The payment itself, not only the total against the charge.
    expect(screen.getByText('Half now')).toBeTruthy();
  });

  it('lists a cancelled charge and owes nothing on it', async () => {
    jest.mocked(api.playerFinancials).mockResolvedValue({
      player,
      summary: { charged_piastres: 0, paid_piastres: 0, outstanding_piastres: 0, overdue: 0 },
      items: [charge({ outstanding_piastres: 500000, paid_piastres: 0, payments: [], status: 'void', void_reason: 'Raised twice', voided_at: '2026-09-05T09:00:00Z' })],
    });
    const screen = await render(<InformationPanel playerId="p-1" />, { wrapper });
    await fireEvent.press(screen.getByRole('tab', { name: 'Financials' }));

    await waitFor(() => expect(screen.getByText('Cancelled')).toBeTruthy());
    expect(screen.getByText(/Nothing is owed on it/)).toBeTruthy();
  });

  it('holds a month back until it has been trained for', async () => {
    jest.mocked(api.playerFinancials).mockResolvedValue({
      player,
      // Not yet earned, so it stays out of the totals as well.
      summary: { charged_piastres: 0, paid_piastres: 0, outstanding_piastres: 0, overdue: 0 },
      items: [charge({ paid_piastres: 0, payments: [], sessions_attended: 3, status: 'not_due' })],
    });
    const screen = await render(<InformationPanel playerId="p-1" />, { wrapper });
    await fireEvent.press(screen.getByRole('tab', { name: 'Financials' }));

    await waitFor(() => expect(screen.getByText('Not due yet')).toBeTruthy());
    // The date is not the point until the month is earned, so it says what is.
    expect(screen.getByText('Falls due after 4 sessions')).toBeTruthy();
    expect(screen.getByText(/of 4/u)).toBeTruthy();
  });

  it('says so plainly when nothing has been charged', async () => {
    jest.mocked(api.playerFinancials).mockResolvedValue({
      player,
      summary: { charged_piastres: 0, paid_piastres: 0, outstanding_piastres: 0, overdue: 0 },
      items: [],
    });
    const screen = await render(<InformationPanel playerId="p-1" />, { wrapper });
    await fireEvent.press(screen.getByRole('tab', { name: 'Financials' }));

    await waitFor(() => expect(screen.getByText('Nothing has been charged yet.')).toBeTruthy());
    // No summary above an empty history: three noughts are not a total.
    expect(screen.queryByText('Total due')).toBeNull();
  });
});
