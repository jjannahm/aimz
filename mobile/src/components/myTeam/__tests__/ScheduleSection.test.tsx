import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { ScheduleSection } from '@/src/components/myTeam/ScheduleSection';
import { api } from '@/src/lib/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ usePathname: () => '/', router: { push: jest.fn() } }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'player', player_id: 'p-1' } }) }));
jest.mock('@/src/lib/api', () => ({ api: { trainingSessions: jest.fn() }, ApiError: class extends Error {} }));

const session = (id: string, startsAt: string) => ({
  id, team_id: 't-1', team: { id: 't-1', name: 'U13' }, starts_at: startsAt,
  duration_minutes: 90, venue: 'Palm', notes: null, created_at: '', updated_at: '',
});

const THREAD = 'rgba(255, 255, 255, 0.16)';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('ScheduleSection timeline thread', () => {
  beforeEach(() => {
    jest.mocked(api.trainingSessions).mockResolvedValue({
      items: [
        session('s-1', '2026-09-07T15:00:00.000Z'),
        session('s-2', '2026-09-14T15:00:00.000Z'),
        session('s-3', '2026-09-21T15:00:00.000Z'),
      ],
      total: 3, limit: 100, offset: 0,
    } as never);
  });
  afterEach(() => jest.clearAllMocks());

  // The thread used to stop a whole row above the session it led to, because
  // the last row drew no line at all.
  it('runs the thread down to the last session rather than stopping short', async () => {
    const screen = await render(<ScheduleSection />, { wrapper });
    await screen.findAllByText('Palm');

    type Node = { props?: { style?: unknown }; children?: unknown[] | null };
    type Line = { backgroundColor?: string; width?: number; height?: number; bottom?: number };
    const lines: Line[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const flat = StyleSheet.flatten((node as Node).props?.style) as Line | undefined;
      if (flat?.width === 1 && flat.backgroundColor === THREAD) lines.push(flat);
      for (const child of (node as Node).children ?? []) walk(child);
    };
    walk(screen.toJSON());
    // The next session is featured on its own, leaving two rows on the thread.
    expect(lines).toHaveLength(2);

    const last = lines[lines.length - 1]!;
    // Capped at the dot's centre instead of running on into a row that is not there.
    expect(last.height).toBe(26);
    expect(last.bottom).toBeUndefined();
  });
});
