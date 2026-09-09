import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import ReportsScreen from '@/app/(app)/(tabs)/reports';
import { api } from '@/src/lib/api';
import type { PlayerReport } from '@/src/types/api';

let mockUser: { role: string; player_id: string | null } = { role: 'player', player_id: 'p-1' };

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ Redirect: 'Redirect', router: { push: jest.fn() }, usePathname: () => '/(app)/(tabs)/reports' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/src/lib/api', () => ({
  api: { playerReports: jest.fn() },
  ApiError: class extends Error {},
}));
// The card itself is the shared report, tested where it is drawn.
jest.mock('@/src/components/ReportCard', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { ReportCard: ({ report }: { report: { title: string } }) => React.createElement(Text, null, `Report: ${report.title}`) };
});

const report = (id: string, title: string, name: string): PlayerReport => ({
  id, player_id: id, player: { name } as PlayerReport['player'], team_id: 't-1', team: null,
  title, period_start: '2026-01-01', period_end: '2026-06-30', coach_feedback: 'Good term.',
  status: 'published', snapshot: {} as PlayerReport['snapshot'], snapshot_source: 'frozen', share_token: null,
} as PlayerReport);

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('ReportsScreen', () => {
  beforeEach(() => {
    mockUser = { role: 'player', player_id: 'p-1' };
    jest.mocked(api.playerReports).mockResolvedValue({ items: [report('r-1', 'Spring term', 'Salma Nabil')], total: 1, limit: 50, offset: 0 });
  });
  afterEach(() => jest.clearAllMocks());

  it('gives a player the reports written about her, on a tab of its own', async () => {
    const screen = await render(<ReportsScreen />, { wrapper });
    expect(await screen.findByText('Report: Spring term')).toBeTruthy();
    expect(screen.getByRole('header')).toHaveTextContent('Reports');
  });

  // A family with more than one child picks between them; one report needs no
  // chooser at all.
  it('offers a chooser once there is more than one report', async () => {
    mockUser = { role: 'parent', player_id: null };
    jest.mocked(api.playerReports).mockResolvedValue({
      items: [report('r-1', 'Spring term', 'Salma Nabil'), report('r-2', 'Spring term', 'Mariam Adel')],
      total: 2, limit: 50, offset: 0,
    });
    const screen = await render(<ReportsScreen />, { wrapper });

    await fireEvent.press(await screen.findByRole('tab', { name: 'Mariam Adel' }));
    expect(screen.getByRole('tab', { name: 'Mariam Adel' }).props.accessibilityState.selected).toBe(true);
  });

  /**
   * Hiding the tab takes it off the dock but leaves the route registered, so
   * the screen turns an admin away itself — the same guard the Hub carries.
   */
  it('turns an administrator away rather than reading somebody a report', async () => {
    mockUser = { role: 'admin', player_id: null };
    const screen = await render(<ReportsScreen />, { wrapper });

    expect(screen.queryByRole('header')).toBeNull();
    await waitFor(() => expect(api.playerReports).not.toHaveBeenCalled());
  });

  it('says so plainly when the account is not linked to a player', async () => {
    mockUser = { role: 'player', player_id: null };
    const screen = await render(<ReportsScreen />, { wrapper });
    expect(await screen.findByText('Account not linked')).toBeTruthy();
  });
});
