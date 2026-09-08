import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import SharedReportScreen from '@/app/r/[token]';
import { api } from '@/src/lib/api';
import type { SharedReport } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ token: 'a-private-address' }) }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error { status?: number },
  api: { sharedReport: jest.fn() },
}));

const report: SharedReport = {
  title: 'Autumn term',
  period_start: '2026-09-01',
  period_end: '2026-12-20',
  coach_feedback: 'Reads the game well and is first to every second ball.',
  published_at: '2026-12-20T09:00:00.000Z',
  published_by_name: 'Coach Nour',
  snapshot: {
    version: 1,
    player: { name: 'Layla Hassan', team_name: 'AIMZ U14', position: 'CM', jersey_number: 8 },
    attendance: { attended: 12, expected: 14, pct: 86 },
    matches: { appearances: 9, minutes: 604, goals: 3, assists: 2, yellow_cards: 1, red_cards: 0 },
    fees: { charged_piastres: 360000, paid_piastres: 290000, outstanding_piastres: 70000, overdue: 1 },
    generated_at: '2026-12-20T09:00:00.000Z',
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the page a shared report link opens', () => {
  afterEach(() => jest.clearAllMocks());

  // The whole point: a parent with no account can read this.
  it('reads a report without anybody being signed in', async () => {
    jest.mocked(api.sharedReport).mockResolvedValue(report);
    const screen = await render(<SharedReportScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('Autumn term')).toBeTruthy());
    expect(api.sharedReport).toHaveBeenCalledWith('a-private-address');
    expect(screen.getByText('Layla Hassan · Centre midfield · AIMZ U14')).toBeTruthy();
    expect(screen.getByText('1 September 2026 to 20 December 2026')).toBeTruthy();
  });

  it('shows the training, matches, fees and the coach’s words', async () => {
    jest.mocked(api.sharedReport).mockResolvedValue(report);
    const screen = await render(<SharedReportScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('86%')).toBeTruthy());
    expect(screen.getByText('12 of 14')).toBeTruthy();
    expect(screen.getByText('604')).toBeTruthy();
    expect(screen.getByText('3,600.00 EGP')).toBeTruthy();
    expect(screen.getByText('700.00 EGP')).toBeTruthy();
    expect(screen.getByText('Outstanding, overdue')).toBeTruthy();
    expect(screen.getByText('Reads the game well and is first to every second ball.')).toBeTruthy();
    expect(screen.getByText('Written by Coach Nour on 20 December 2026.')).toBeTruthy();
  });

  // A replaced link, a withdrawn report and a wrong address are one message:
  // the page cannot tell them apart and a parent only needs to know to ask.
  it('says to ask for a new link when the address no longer works', async () => {
    const gone = Object.assign(new Error('No report matches this address.'), { status: 404 });
    jest.mocked(api.sharedReport).mockRejectedValue(gone);
    const screen = await render(<SharedReportScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('This report is no longer available. Ask the academy for a new link.')).toBeTruthy());
  });

  it('says nothing was recorded rather than showing a misleading zero', async () => {
    jest.mocked(api.sharedReport).mockResolvedValue({
      ...report,
      snapshot: { ...report.snapshot!, attendance: { attended: 0, expected: 0, pct: null }, matches: { ...report.snapshot!.matches, appearances: 0 }, fees: { charged_piastres: 0, paid_piastres: 0, outstanding_piastres: 0, overdue: 0 } },
    });
    const screen = await render(<SharedReportScreen />, { wrapper });
    await waitFor(() => expect(screen.getByText('No register was taken over this period.')).toBeTruthy());
    expect(screen.getByText('No matches played over this period.')).toBeTruthy();
    expect(screen.getByText('Nothing has been charged.')).toBeTruthy();
  });
});
