import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AccountsSection } from '@/src/components/manage/AccountsSection';
import { api } from '@/src/lib/api';
import { showMessage } from '@/src/lib/platformAlert';
import type { AdminAccount, Player } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/lib/api', () => ({
  api: { adminUsers: jest.fn(), linkUserPlayer: jest.fn() },
  ApiError: class extends Error {},
}));
jest.mock('@/src/lib/platformAlert', () => ({
  ...jest.requireActual('@/src/lib/platformAlert'),
  showMessage: jest.fn(),
  showToast: jest.fn(),
}));

const player = (id: string, name: string): Player => ({
  id, name, team_id: 'team-u14', position: 'CM', jersey_number: 7, photo_key: null, photo_url: null,
  is_active: true, created_at: '', updated_at: '',
});

const players = [player('player-1', 'Amina Adel'), player('player-2', 'Nour Hassan')];

const account = (over: Partial<AdminAccount> & Pick<AdminAccount, 'id' | 'name' | 'email' | 'role'>): AdminAccount => ({
  player: null, team: null, children: [], player_id: null, is_active: true, created_at: '', updated_at: '',
  ...over,
} as AdminAccount);

const page = (items: AdminAccount[]) => ({ items, total: items.length, limit: 100, offset: 0 });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false }, mutations: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const open = async (screen: ReturnType<typeof render> extends Promise<infer T> ? T : never) => {
  await fireEvent.press(await screen.findByRole('button', { name: 'Show registered accounts' }));
};

describe('AccountsSection', () => {
  afterEach(() => jest.clearAllMocks());

  it('reads a parent through their children, and offers them no player picker', async () => {
    // The regression this screen was built around: a parent links through
    // user_children, so the player join is null for every one of them. Showing
    // that as "Not linked" invites an administrator to "fix" a working account
    // by writing a field no parent ever reads.
    jest.mocked(api.adminUsers).mockResolvedValue(page([
      account({ id: 'u-1', name: 'Hala Nabil', email: 'hala@aimz.test', role: 'parent', children: [
        { id: 'player-1', name: 'Mariam Adel', team_id: 'team-u13', team_name: 'AIMZ U13' },
        { id: 'player-2', name: 'Salma Nabil', team_id: 'team-u9', team_name: 'AIMZ U9' },
      ] }),
    ]));
    const screen = await render(<AccountsSection players={players} />, { wrapper });
    await open(screen);

    expect(await screen.findByText('Mariam Adel, Salma Nabil')).toBeTruthy();
    expect(screen.queryByText('Not linked')).toBeNull();
    // The row does not open, so the picker that would write users.player_id is
    // never reachable for a parent.
    await fireEvent.press(screen.getByLabelText('Hala Nabil, Parent, Mariam Adel, Salma Nabil'));
    expect(screen.queryByText('Linked player')).toBeNull();
  });

  it('calls a parent with no children broken, which is what they are', async () => {
    jest.mocked(api.adminUsers).mockResolvedValue(page([
      account({ id: 'u-1', name: 'Hala Nabil', email: 'hala@aimz.test', role: 'parent' }),
    ]));
    const screen = await render(<AccountsSection players={players} />, { wrapper });
    await open(screen);
    expect(await screen.findByText('No children linked')).toBeTruthy();
  });

  it('links an unlinked player account to the player it is for', async () => {
    jest.mocked(api.adminUsers).mockResolvedValue(page([
      account({ id: 'u-2', name: 'Malak Sherif', email: 'malak@aimz.test', role: 'player' }),
    ]));
    jest.mocked(api.linkUserPlayer).mockResolvedValue({ id: 'u-2' } as never);
    const screen = await render(<AccountsSection players={players} />, { wrapper });
    await open(screen);

    expect(await screen.findByText('Not linked')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Malak Sherif, Player, Not linked'));
    await fireEvent.press(await screen.findByTestId('player-picker-trigger'));
    await fireEvent.press(await screen.findByTestId('player-picker-option-player-2'));

    await waitFor(() => expect(api.linkUserPlayer).toHaveBeenCalledWith('u-2', 'player-2'));
  });

  it('says which account already holds a player rather than failing silently', async () => {
    jest.mocked(api.adminUsers).mockResolvedValue(page([
      account({ id: 'u-2', name: 'Malak Sherif', email: 'malak@aimz.test', role: 'player' }),
    ]));
    jest.mocked(api.linkUserPlayer).mockRejectedValue(new Error('Another account is already linked to that player.'));
    const screen = await render(<AccountsSection players={players} />, { wrapper });
    await open(screen);

    await fireEvent.press(await screen.findByLabelText('Malak Sherif, Player, Not linked'));
    await fireEvent.press(await screen.findByTestId('player-picker-trigger'));
    await fireEvent.press(await screen.findByTestId('player-picker-option-player-1'));

    await waitFor(() => expect(showMessage).toHaveBeenCalledWith('Link not changed', 'Another account is already linked to that player.'));
  });

  it('an administrator manages rather than plays, so is not called unlinked', async () => {
    jest.mocked(api.adminUsers).mockResolvedValue(page([
      account({ id: 'u-3', name: 'AIMZ Admin', email: 'admin@aimz.test', role: 'admin' }),
    ]));
    const screen = await render(<AccountsSection players={players} />, { wrapper });
    await open(screen);
    expect(await screen.findByText('Manages the academy')).toBeTruthy();
    expect(screen.queryByText('Not linked')).toBeNull();
  });
});
