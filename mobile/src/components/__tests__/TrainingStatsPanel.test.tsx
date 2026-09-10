import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TrainingStatsPanel } from '@/src/components/TrainingStatsPanel';
import { api } from '@/src/lib/api';
import type { Player, TrainingMetric } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/lib/api', () => ({ api: { playerTrainingStats: jest.fn() }, ApiError: class extends Error {} }));

const metric = (key: string, label: string, playerKind: TrainingMetric['player_kind']): TrainingMetric => ({
  id: `m-${key}`, key, label, kind: 'rating', min_value: 1, max_value: 10,
  unit: null, player_kind: playerKind, sort_order: 10, is_active: true,
});

const overall = metric('overall_rating', 'Overall Rating', 'all');
const dribbling = metric('dribbling', 'Dribbling', 'outfield');
const shooting = metric('shooting', 'Shooting', 'outfield');
const passing = metric('passing', 'Passing', 'outfield');
const shotStopping = metric('shot_stopping', 'Shot Stopping', 'goalkeeper');
const handling = metric('handling', 'Handling', 'goalkeeper');
const distribution = metric('distribution', 'Distribution', 'goalkeeper');
const allMetrics = [overall, dribbling, shooting, passing, shotStopping, handling, distribution];

const stats = (pct: number | null, teamPct: number | null, position = 'CM') => {
  const relevant = position === 'GK' ? [overall, shotStopping, handling, distribution] : [overall, dribbling, shooting, passing];
  return {
    player: { id: 'p-1', name: 'Salma Nabil', position } as Player,
    metrics: allMetrics,
    attendance: { attended: 8, expected: 10, late: 1, pct, team_pct: teamPct },
    totals: allMetrics.map((item, index) => ({ metric: item, value: 7 + (index / 10), sessions: 8 })),
    sessions: [{
      id: 's-1', starts_at: '2026-10-06T04:00:00.000Z', venue: 'Palm', status: 'present' as const,
      values: Object.fromEntries(relevant.map((item, index) => [item.id, 7 + index])),
    }],
  };
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const show = async (pct: number | null, teamPct: number | null, position = 'CM') => {
  jest.mocked(api.playerTrainingStats).mockResolvedValue(stats(pct, teamPct, position) as never);
  return render(<TrainingStatsPanel playerId="p-1" />, { wrapper });
};

describe("a player read against her squad's attendance", () => {
  afterEach(() => jest.clearAllMocks());

  it('uses exactly six equal cells and keeps attendance figures together', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText('8 of 10')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText(/Team avg 60%/)).toBeTruthy();
    expect(screen.getAllByTestId('stat-cell')).toHaveLength(6);
  });

  it('calls her above the squad when she is clear of it', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText(/Above average/)).toBeTruthy();
  });

  it('calls her below the squad when she trails it', async () => {
    const screen = await show(50, 75);
    expect(await screen.findByText(/Below average/)).toBeTruthy();
  });

  /**
   * The band exists so one missed session does not flip a player from one word
   * to the other, which means both its edges are worth pinning: five points is
   * still level, six is not.
   */
  it('counts five points either way as level with the squad', async () => {
    const above = await show(80, 75);
    expect(await above.findByText(/· Average$/)).toBeTruthy();

    const below = await show(70, 75);
    expect(await below.findByText(/· Average$/)).toBeTruthy();
  });

  it('calls six points a difference', async () => {
    const screen = await show(81, 75);
    expect(await screen.findByText(/Above average/)).toBeTruthy();
  });

  // Nobody has taken a register for the squad, so there is nothing to be read
  // against — better silent than a verdict drawn from nothing.
  it('leaves the comparison out when the squad has no figure', async () => {
    const screen = await show(80, null);
    expect(await screen.findByText('80%')).toBeTruthy();
    expect(screen.queryByText(/Team avg/iu)).toBeNull();
  });

  it('shows all four outfield ratings and no goalkeeper ratings or minutes', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText('Overall Rating avg')).toBeTruthy();
    expect(await screen.findByText('Dribbling avg')).toBeTruthy();
    expect(screen.getByText('Shooting avg')).toBeTruthy();
    expect(screen.getByText('Passing avg')).toBeTruthy();
    expect(screen.queryByText('Shot Stopping avg')).toBeNull();
    expect(screen.queryByText('Minutes trained')).toBeNull();
  });

  it('switches the summary and session breakdown to goalkeeper ratings', async () => {
    const screen = await show(80, 60, 'GK');
    expect(await screen.findByText('Overall Rating avg')).toBeTruthy();
    expect(screen.getByText('Shot Stopping avg')).toBeTruthy();
    expect(screen.getByText('Handling avg')).toBeTruthy();
    expect(screen.getByText('Distribution avg')).toBeTruthy();
    expect(screen.queryByText('Dribbling avg')).toBeNull();
    expect(screen.getByText(/Overall 7\/10 · Shot Stopping 8\/10 · Handling 9\/10 · Distribution 10\/10/)).toBeTruthy();
  });
});
