import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { KitSection } from '@/src/components/myTeam/KitSection';
import { api } from '@/src/lib/api';

let mockUser: { role: string; player_id: string | null } = { role: 'player', player_id: 'p-1' };

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/hub' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/src/lib/platformAlert', () => ({ showMessage: jest.fn() }));
jest.mock('@/src/lib/api', () => ({
  api: { kitOrders: jest.fn(), orderKit: jest.fn(), myChildren: jest.fn() },
  ApiError: class extends Error { constructor(message: string) { super(message); } },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const emptyPage = { items: [], total: 0, limit: 50, offset: 0 };

describe('ordering kit as a family', () => {
  beforeEach(() => {
    mockUser = { role: 'player', player_id: 'p-1' };
    jest.mocked(api.kitOrders).mockResolvedValue(emptyPage as never);
    jest.mocked(api.myChildren).mockResolvedValue({ items: [] } as never);
    jest.mocked(api.orderKit).mockResolvedValue({} as never);
  });
  afterEach(() => jest.clearAllMocks());

  const open = async () => {
    const screen = await render(<KitSection />, { wrapper });
    await fireEvent.press(await screen.findByText('Order kit'));
    return screen;
  };

  /**
   * The point of moving off the old form: an order names the roster player, so
   * nobody retypes a child's name and date of birth to place one.
   */
  it('sends the roster player rather than asking for a name and birth date', async () => {
    const screen = await open();
    await fireEvent.changeText(screen.getByLabelText('Team'), 'Senzo 2013');
    await fireEvent.changeText(screen.getByLabelText('Name on the shirt'), 'JANA');

    // Nothing on this form asks who the child is beyond which player it is for.
    expect(screen.queryByLabelText(/date of birth/iu)).toBeNull();
    expect(screen.queryByLabelText(/full name/iu)).toBeNull();
  });

  it('will not place an order missing a size the supplier needs', async () => {
    const screen = await open();
    await fireEvent.changeText(screen.getByLabelText('Team'), 'Senzo 2013');
    await fireEvent.changeText(screen.getByLabelText('Name on the shirt'), 'JANA');

    await fireEvent.press(screen.getByText('Place the order'));

    expect(await screen.findAllByText('Choose a size.')).toHaveLength(3);
    expect(api.orderKit).not.toHaveBeenCalled();
  });

  it('refuses a shirt number that is not one', async () => {
    const screen = await open();
    await fireEvent.changeText(screen.getByLabelText('Team'), 'Senzo 2013');
    await fireEvent.changeText(screen.getByLabelText('Name on the shirt'), 'JANA');
    await fireEvent.changeText(screen.getByLabelText('Number on the shirt (optional)'), '100');

    await fireEvent.press(screen.getByText('Place the order'));

    expect(await screen.findByText('A number between 0 and 99.')).toBeTruthy();
    expect(api.orderKit).not.toHaveBeenCalled();
  });

  it('says so plainly when the account has no player behind it', async () => {
    mockUser = { role: 'player', player_id: null };
    const screen = await render(<KitSection />, { wrapper });
    expect(await screen.findByText('Account not linked')).toBeTruthy();
  });

  it('shows an order that has been placed, and where it has got to', async () => {
    jest.mocked(api.kitOrders).mockResolvedValue({
      items: [{
        id: 'k-1', player_id: 'p-1', player_name: 'Jana Sherif', team_id: 't-1', squad_name: 'AIMZ U13',
        ordered_by_id: 'u-1', team_label: 'Senzo 2013', kind: 'player', shirt_name: 'JANA', shirt_number: 10,
        kit_size: '12', hoodie_size: 'S', outwear_size: 'S', delivery: 'home', status: 'fulfilled',
        notes: null, created_at: '2026-09-10T08:00:00.000Z', updated_at: '2026-09-10T08:00:00.000Z',
      }], total: 1, limit: 50, offset: 0,
    } as never);
    const screen = await render(<KitSection />, { wrapper });

    expect(await screen.findByText('Jana Sherif')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Kit 12 · Hoodie S · Outwear S/u)).toBeTruthy());
  });
});
