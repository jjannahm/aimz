import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { Squad } from '@/app/(app)/team/[id]';
import { api } from '@/src/lib/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => ({ id: 't-1' }), usePathname: () => '/team/t-1' }));
jest.mock('@/src/lib/api', () => ({ api: { players: jest.fn(), squadStats: jest.fn() }, ApiError: class extends Error {} }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'coach' } }) }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const player = (id: string, name: string, position: string) => ({ id, name, position, team_id: 't-1', jersey_number: 1, photo_key: null, photo_url: null });

/**
 * A squad list is read the way a team sheet is, so the order is worth pinning
 * against the API's own, which is alphabetical and mixes the lines together.
 * The line each position belongs to is `positions.ts`'s business and tested
 * there; what this pins is that this screen asks it.
 */
describe('the squad list', () => {
  it('reads keepers, defenders, midfield, then attack', async () => {
    jest.mocked(api.players).mockResolvedValue({ items: [
      // Deliberately alphabetical, which is what the API answers with.
      player('p-1', 'Aya Striker', 'ST'),
      player('p-2', 'Dina Sweeper', 'LWB'),
      player('p-3', 'Hana Keeper', 'GK'),
      player('p-4', 'Layla Winger', 'RW'),
      player('p-5', 'Mona Anchor', 'DM'),
      player('p-6', 'Nour Back', 'CB'),
      player('p-7', 'Zeina Playmaker', 'AM'),
    ], total: 7, limit: 100, offset: 0 } as never);
    jest.mocked(api.squadStats).mockResolvedValue([] as never);

    const screen = await render(<Squad teamId="t-1" />, { wrapper });
    await screen.findByText('Hana Keeper');

    const order = screen.getAllByRole('button').map((row) => String(row.props.accessibilityLabel).split(',')[0]);
    expect(order).toEqual([
      'Hana Keeper',      // GK
      'Dina Sweeper',     // DEF, alphabetical within the line
      'Nour Back',        // DEF
      'Mona Anchor',      // MID
      'Zeina Playmaker',  // MID
      'Aya Striker',      // FWD
      'Layla Winger',     // FWD
    ]);
  });
});
