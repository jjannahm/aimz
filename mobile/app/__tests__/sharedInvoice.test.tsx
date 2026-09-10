import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import SharedInvoiceScreen from '@/app/i/[token]';
import { api } from '@/src/lib/api';
import type { SharedInvoice } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ token: 'a-private-address' }) }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error { status?: number },
  api: { sharedInvoice: jest.fn() },
}));

const invoice: SharedInvoice = {
  issued_at: '2026-09-10T09:00:00.000Z',
  issued_by_name: 'Academy Office',
  snapshot: {
    version: 1,
    reference: 'AIMZ-202609-7QK4TP',
    issued_on: '2026-09-10',
    player: { name: 'Amina Adel' },
    squad: { name: 'AIMZ U16', branch: 'Maadi' },
    lines: [
      { label: 'Monthly subscription', period: '2026-08', due_on: '2026-08-05', amount_piastres: 120000, paid_piastres: 20000, balance_piastres: 100000, status: 'overdue' },
      { label: 'Away kit', period: null, due_on: '2026-09-20', amount_piastres: 40000, paid_piastres: 0, balance_piastres: 40000, status: 'unpaid' },
    ],
    totals: { charged_piastres: 160000, paid_piastres: 20000, outstanding_piastres: 140000, overdue: 1 },
    payment_instructions: 'InstaPay to aimz@bank',
    not_due_yet: 1,
    generated_at: '2026-09-10T09:00:00.000Z',
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the page an invoice link opens', () => {
  afterEach(() => jest.clearAllMocks());

  it('leads with what is owed, then what it covers', async () => {
    jest.mocked(api.sharedInvoice).mockResolvedValue(invoice);
    const screen = await render(<SharedInvoiceScreen />, { wrapper });

    // The one figure somebody opened this to find, before any breakdown.
    await waitFor(() => expect(screen.getByText('1,400.00 EGP')).toBeTruthy());
    expect(screen.getByText('Total due, overdue')).toBeTruthy();
    expect(screen.getByText('AIMZ-202609-7QK4TP')).toBeTruthy();
    expect(screen.getByText('Amina Adel')).toBeTruthy();
    expect(screen.getByText('AIMZ U16 · Maadi')).toBeTruthy();

    // A month reads as a month, never as the sortable form the API stores.
    expect(screen.getByText('Monthly subscription · August 2026')).toBeTruthy();
    expect(screen.getByText('Away kit')).toBeTruthy();
    // Part paid says what was charged and what came in, not just the balance.
    expect(screen.getByText('1,200.00 EGP charged, 200.00 EGP paid')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Unpaid')).toBeTruthy();

    expect(screen.getByText('InstaPay to aimz@bank')).toBeTruthy();
    expect(screen.getByText(/Issued by Academy Office/)).toBeTruthy();
  });

  /**
   * A month the academy has not earned yet is left off, and the invoice says
   * so. A parent comparing this against what they can see in the app should
   * not be left wondering why a month they know about is missing.
   */
  it('explains the month it deliberately did not bill', async () => {
    jest.mocked(api.sharedInvoice).mockResolvedValue(invoice);
    const screen = await render(<SharedInvoiceScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText(/One further month is not on this invoice/)).toBeTruthy());
    expect(screen.getByText(/fourth session has been attended/)).toBeTruthy();
  });

  it('keeps quiet about it when there is nothing to explain', async () => {
    jest.mocked(api.sharedInvoice).mockResolvedValue({
      ...invoice,
      snapshot: { ...invoice.snapshot, not_due_yet: 0, payment_instructions: null },
    });
    const screen = await render(<SharedInvoiceScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());
    expect(screen.queryByText(/not on this invoice/)).toBeNull();
    // Payment details are optional, so their block goes rather than sitting empty.
    expect(screen.queryByText('How to pay')).toBeNull();
  });

  it('says to ask for a new link rather than which of three things went wrong', async () => {
    jest.mocked(api.sharedInvoice).mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    const screen = await render(<SharedInvoiceScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText(/no longer available/)).toBeTruthy());
    expect(screen.getByText(/Ask the academy for a new link/)).toBeTruthy();
  });
});
