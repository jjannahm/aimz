import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TrainingStatsPanel } from '@/src/components/TrainingStatsPanel';
import { api } from '@/src/lib/api';
import type { TrainingMetric } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/lib/api', () => ({ api: { playerTrainingStats: jest.fn() }, ApiError: class extends Error {} }));

const metric = (id: string, label: string, kind: 'rating' | 'count'): TrainingMetric => ({
  id, key: id, label, kind, min_value: null, max_value: kind === 'rating' ? 10 : null,
  unit: kind === 'count' ? 'minutes' : null, sort_order: 10, is_active: true,
});

const minutes = metric('m-min', 'Minutes trained', 'count');
const dribbling = metric('m-dri', 'Dribbling', 'rating');

const stats = (pct: number | null, teamPct: number | null) => ({
  player: { id: 'p-1', name: 'Salma Nabil' },
  metrics: [minutes, dribbling],
  attendance: { attended: 8, expected: 10, pct, team_pct: teamPct },
  totals: [
    { metric: minutes, value: 540, sessions: 8 },
    { metric: dribbling, value: 7.5, sessions: 8 },
  ],
  sessions: [],
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const show = async (pct: number | null, teamPct: number | null) => {
  jest.mocked(api.playerTrainingStats).mockResolvedValue(stats(pct, teamPct) as never);
  return render(<TrainingStatsPanel playerId="p-1" />, { wrapper });
};

describe("a player read against her squad's attendance", () => {
  afterEach(() => jest.clearAllMocks());

  it('shows the squad figure beside her own', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText('80%')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('Team average')).toBeTruthy();
  });

  it('calls her above the squad when she is clear of it', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText('Above average')).toBeTruthy();
  });

  it('calls her below the squad when she trails it', async () => {
    const screen = await show(50, 75);
    expect(await screen.findByText('Below average')).toBeTruthy();
  });

  /**
   * The band exists so one missed session does not flip a player from one word
   * to the other, which means both its edges are worth pinning: five points is
   * still level, six is not.
   */
  it('counts five points either way as level with the squad', async () => {
    const above = await show(80, 75);
    expect(await above.findByText('Average')).toBeTruthy();

    const below = await show(70, 75);
    expect(await below.findByText('Average')).toBeTruthy();
  });

  it('calls six points a difference', async () => {
    const screen = await show(81, 75);
    expect(await screen.findByText('Above average')).toBeTruthy();
  });

  // Nobody has taken a register for the squad, so there is nothing to be read
  // against — better silent than a verdict drawn from nothing.
  it('leaves the tile out when the squad has no figure', async () => {
    const screen = await show(80, null);
    expect(await screen.findByText('80%')).toBeTruthy();
    expect(screen.queryByText('Team average')).toBeNull();
    expect(screen.queryByText(/average/iu)).toBeNull();
  });

  it('gives a tile to the marks and not to the minutes', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText('Dribbling avg')).toBeTruthy();
    // Still recorded, and still on every session row below — just not a tile.
    expect(screen.queryByText('Minutes trained')).toBeNull();
    expect(screen.queryByText('540')).toBeNull();
  });
});
