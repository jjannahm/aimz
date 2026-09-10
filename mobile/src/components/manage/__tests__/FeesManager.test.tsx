import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { FeesManager } from '@/src/components/manage/FeesManager';
import { api } from '@/src/lib/api';
import { showToast } from '@/src/lib/platformAlert';
import type { FeeCharge, FeePlan, FeeSummary, Player, Team } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
const mockShareInvoice = jest.fn();
jest.mock('@/src/lib/invoiceLink', () => ({
  ...jest.requireActual('@/src/lib/invoiceLink'),
  shareInvoice: (...args: unknown[]) => mockShareInvoice(...args),
}));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    feePlans: jest.fn(), createFeePlan: jest.fn(), updateFeePlan: jest.fn(), generateFees: jest.fn(),
    feeCharges: jest.fn(), feeCharge: jest.fn(), createFeeCharge: jest.fn(), voidFeeCharge: jest.fn(),
    recordFeePayment: jest.fn(), teamFeeSummary: jest.fn(), players: jest.fn(),
    createInvoice: jest.fn(), createSquadInvoices: jest.fn(),
  },
}));
jest.mock('@/src/lib/platformAlert', () => ({
  ...jest.requireActual('@/src/lib/platformAlert'),
  showMessage: jest.fn(),
  showToast: jest.fn(),
  confirmAction: jest.fn((_t: string, _b: string, _l: string, onConfirm: () => void) => onConfirm()),
}));

const team = { id: 'team-1', name: 'AIMZ U14' } as Team;
const player = (id: string, name: string) => ({ id, name } as Player);

const plan = { id: 'plan-1', team_id: team.id, label: 'Monthly subscription', amount_piastres: 120000, due_day: 5, is_active: true } as FeePlan;

const summary = (over: Partial<FeeSummary> = {}): FeeSummary => ({
  team,
  period: '2026-09',
  totals: { charged_piastres: 360000, paid_piastres: 200000, outstanding_piastres: 160000, players_total: 3, players_paid: 1, players_overdue: 1, players_outstanding: 2 },
  players: [
    { player: player('p-1', 'Amina Adel'), charged_piastres: 120000, paid_piastres: 0, outstanding_piastres: 120000, status: 'overdue' },
    { player: player('p-2', 'Nour Hassan'), charged_piastres: 120000, paid_piastres: 60000, outstanding_piastres: 60000, status: 'partial' },
    { player: player('p-3', 'Salma Rashad'), charged_piastres: 120000, paid_piastres: 120000, outstanding_piastres: 0, status: 'paid' },
  ],
  ...over,
});

const charge = (over: Partial<FeeCharge> = {}): FeeCharge => ({
  id: 'charge-1', player_id: 'p-1', player: player('p-1', 'Amina Adel'), team_id: team.id,
  fee_plan_id: 'plan-1', period: '2026-09', label: 'Monthly subscription · 2026-09',
  amount_piastres: 120000, paid_piastres: 0, outstanding_piastres: 120000, status: 'overdue',
  due_on: '2026-09-05', voided_at: null, void_reason: null, ...over,
});

const page = <T,>(items: T[]) => ({ items, total: items.length, limit: 100, offset: 0 });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('FeesManager', () => {
  beforeEach(() => {
    jest.mocked(api.feePlans).mockResolvedValue(page([plan]) as never);
    jest.mocked(api.teamFeeSummary).mockResolvedValue(summary());
    jest.mocked(api.players).mockResolvedValue(page([player('p-1', 'Amina Adel')]) as never);
    jest.mocked(api.feeCharges).mockResolvedValue(page([charge()]) as never);
    jest.mocked(api.feeCharge).mockResolvedValue(charge());
    jest.mocked(api.generateFees).mockResolvedValue({ period: '2026-09', created: 3, skipped: 0, squad_size: 3 });
  });

  afterEach(() => jest.clearAllMocks());

  it('leads with what the squad owes', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Charged')).toBeTruthy());
    expect(screen.getByText('3,600.00 EGP')).toBeTruthy();
    expect(screen.getByText('2,000.00 EGP')).toBeTruthy();
    expect(screen.getByText('1,600.00 EGP')).toBeTruthy();
  });

  // The list is opened to find who to chase, so it arrives in that order.
  it('names each family and how they stand', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Part paid')).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.getByText('Nothing owed')).toBeTruthy();
  });

  it('shows the monthly fee already set rather than an empty form', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await waitFor(() => expect(screen.getByText('1,200.00 EGP a month, due on the 5th')).toBeTruthy());
  });

  it('raises a month of charges and says how many', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    const button = await screen.findByText(/^Raise .* charges$/u);
    await fireEvent.press(button);
    await waitFor(() => expect(api.generateFees).toHaveBeenCalledWith('plan-1', expect.stringMatching(/^\d{4}-\d{2}$/u)));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Raised 3 charges'));
  });

  // A second press must read as "already done" rather than as silence.
  it('says a month was already raised instead of nothing', async () => {
    jest.mocked(api.generateFees).mockResolvedValue({ period: '2026-09', created: 0, skipped: 3, squad_size: 3 });
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await fireEvent.press(await screen.findByText(/^Raise .* charges$/u));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Already raised for all 3'));
  });

  it('opens a family to show what they were charged', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await fireEvent.press(await screen.findByLabelText(/^Amina Adel, overdue/u));
    await waitFor(() => expect(api.feeCharges).toHaveBeenCalledWith(expect.stringContaining('player_id=p-1')));
    expect(await screen.findByText('Monthly subscription · 2026-09')).toBeTruthy();
    expect(screen.getByText('0.00 EGP of 1,200.00 EGP · due 2026-09-05')).toBeTruthy();
  });

  it('records a payment in pounds and sends piastres', async () => {
    jest.mocked(api.recordFeePayment).mockResolvedValue(charge({ paid_piastres: 50000, outstanding_piastres: 70000, status: 'partial' }));
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await fireEvent.press(await screen.findByLabelText(/^Amina Adel, overdue/u));
    await fireEvent.press(await screen.findByText('Record payment'));
    await fireEvent.changeText(await screen.findByLabelText('Amount received (EGP)'), '500');
    const buttons = screen.getAllByText('Record payment');
    await fireEvent.press(buttons[buttons.length - 1]!);
    await waitFor(() => expect(api.recordFeePayment).toHaveBeenCalledWith('charge-1', { amount_piastres: 50000, method: 'cash' }));
  });

  it('refuses to send a payment that is not an amount', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await fireEvent.press(await screen.findByLabelText(/^Amina Adel, overdue/u));
    await fireEvent.press(await screen.findByText('Record payment'));
    await fireEvent.changeText(await screen.findByLabelText('Amount received (EGP)'), 'abc');
    const buttons = screen.getAllByText('Record payment');
    await fireEvent.press(buttons[buttons.length - 1]!);
    await waitFor(() => expect(api.recordFeePayment).not.toHaveBeenCalled());
  });

  it('offers to set a fee when the squad has none', async () => {
    jest.mocked(api.feePlans).mockResolvedValue(page([]) as never);
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await waitFor(() => expect(screen.getByText('No monthly fee set for this squad.')).toBeTruthy());
    // Nothing to raise until there is a fee to raise.
    expect(screen.queryByText(/^Raise .* charges$/u)).toBeNull();
  });

  it('says so plainly when there are no squads at all', async () => {
    const screen = await render(<FeesManager teams={[]} />, { wrapper });
    expect(screen.getByText('Add a squad before charging anybody fees.')).toBeTruthy();
  });
});

describe('invoicing what the ledger says is owed', () => {
  const invoice = (over: Record<string, unknown> = {}) => ({
    id: 'inv-1', reference: 'AIMZ-202609-7QK4TP', player_id: 'p-1', player_name: 'Amina Adel',
    period: '2026-09', share_token: 'a-private-address', issued_at: '2026-09-10T09:00:00.000Z',
    issued_by_name: 'Academy Office', first_opened_at: null,
    snapshot: {
      version: 1, reference: 'AIMZ-202609-7QK4TP', issued_on: '2026-09-10',
      player: { name: 'Amina Adel' }, squad: { name: 'AIMZ U14', branch: null },
      lines: [], totals: { charged_piastres: 120000, paid_piastres: 0, outstanding_piastres: 120000, overdue: 1 },
      payment_instructions: null, not_due_yet: 0, generated_at: '2026-09-10T09:00:00.000Z',
    },
    ...over,
  });

  beforeEach(() => {
    jest.mocked(api.feePlans).mockResolvedValue(page([plan]) as never);
    jest.mocked(api.teamFeeSummary).mockResolvedValue(summary());
    jest.mocked(api.players).mockResolvedValue(page([player('p-1', 'Amina Adel')]) as never);
    jest.mocked(api.feeCharges).mockResolvedValue(page([charge()]) as never);
    jest.mocked(api.createInvoice).mockResolvedValue(invoice() as never);
    jest.mocked(api.createSquadInvoices).mockResolvedValue({ items: [invoice()], skipped: 2 } as never);
  });
  afterEach(() => jest.clearAllMocks());

  // Making one and sending it are the same gesture: an invoice nobody was
  // handed is not a thing anybody wanted.
  it('makes and sends one family an invoice in a single press', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await fireEvent.press(await screen.findByRole('button', { name: /Amina Adel, overdue/ }));
    await fireEvent.press(await screen.findByText('Send invoice'));

    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledWith('p-1', { payment_instructions: null }));
    expect(mockShareInvoice).toHaveBeenCalledWith('a-private-address', 'Amina Adel', 120000);
    // The address is shown once it exists, so it can be copied if the share
    // sheet is not where somebody wants to send it from.
    expect(await screen.findByText(/AIMZ-202609-7QK4TP/)).toBeTruthy();
  });

  // An invoice for nothing is not a thing to send anybody.
  it('offers nothing to send to a family who owes nothing', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await fireEvent.press(await screen.findByRole('button', { name: /Salma Rashad, paid/ }));

    await screen.findByText('Monthly subscription · 2026-09');
    expect(screen.queryByText('Send invoice')).toBeNull();
  });

  /**
   * The monthly run. Whoever owes nothing is skipped rather than sent an
   * invoice for nothing, and the count is said out loud — silence looks like
   * the button did not work.
   */
  it('invoices the whole squad and says who it had nothing to ask', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await fireEvent.press(await screen.findByRole('button', { name: 'Show invoice the squad form' }));
    await fireEvent.press(await screen.findByText(/Invoice AIMZ U14 for/));

    await waitFor(() => expect(api.createSquadInvoices).toHaveBeenCalledWith('team-1', { period: '2026-09', payment_instructions: null }));
    expect(showToast).toHaveBeenCalledWith('1 invoice made, 2 owed nothing');
    // Each result carries its own Send: an invoice names one child and what
    // they owe, so there is nothing here to post to a group.
    expect(await screen.findByText('Send')).toBeTruthy();
  });

  // Typed once, and used by the run and by every single invoice below it.
  it('carries the payment details typed once into what it sends', async () => {
    const screen = await render(<FeesManager teams={[team]} />, { wrapper });
    await fireEvent.press(await screen.findByRole('button', { name: 'Show invoice the squad form' }));
    await fireEvent.changeText(await screen.findByLabelText('How to pay'), 'InstaPay to aimz@bank');

    await fireEvent.press(await screen.findByRole('button', { name: /Amina Adel, overdue/ }));
    await fireEvent.press(await screen.findByText('Send invoice'));

    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledWith('p-1', { payment_instructions: 'InstaPay to aimz@bank' }));
  });
});
