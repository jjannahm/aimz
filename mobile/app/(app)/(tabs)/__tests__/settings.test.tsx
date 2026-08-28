import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';

import SettingsScreen from '@/app/(app)/(tabs)/settings';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/auth/AuthProvider', () => ({
  useAuth: () => ({
    signOut: jest.fn(),
    user: { email: 'player@example.com', name: 'AIMZ Player', role: 'player' },
  }),
}));
let mockParams: { from?: string } = {};
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/standings',
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('SettingsScreen header', () => {
  afterEach(() => { jest.clearAllMocks(); mockParams = {}; });

  it('shows a close control instead of another settings control', async () => {
    const screen = await render(<SettingsScreen />, { wrapper });

    expect(screen.getByLabelText('Close')).toBeTruthy();
    expect(screen.queryByLabelText('Settings')).toBeNull();
  });

  it('returns to the screen that opened settings', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(true);
    const screen = await render(<SettingsScreen />, { wrapper });

    fireEvent.press(screen.getByLabelText('Close'));

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });


  // Moving between tabs leaves nothing to go back through, so closing used to
  // land on Matches whichever tab the gear was pressed on.
  it('returns to the screen the gear was pressed on', async () => {
    mockParams = { from: '/standings' };
    jest.mocked(router.canGoBack).mockReturnValue(false);
    const screen = await render(<SettingsScreen />, { wrapper });
    fireEvent.press(screen.getByLabelText('Close'));
    expect(router.replace).toHaveBeenCalledWith('/standings');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('does not send itself back to settings', async () => {
    mockParams = { from: '/settings' };
    jest.mocked(router.canGoBack).mockReturnValue(false);
    const screen = await render(<SettingsScreen />, { wrapper });
    fireEvent.press(screen.getByLabelText('Close'));
    expect(router.replace).toHaveBeenCalledWith('/(app)/(tabs)');
  });

  it('falls back to Match centre when settings was opened directly', async () => {
    jest.mocked(router.canGoBack).mockReturnValue(false);
    const screen = await render(<SettingsScreen />, { wrapper });

    fireEvent.press(screen.getByLabelText('Close'));

    expect(router.replace).toHaveBeenCalledWith('/(app)/(tabs)');
    expect(router.back).not.toHaveBeenCalled();
  });
});
