import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import MatchesScreen from '@/app/(app)/(tabs)/index';
import { api } from '@/src/lib/api';

jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/(app)/(tabs)' }));
jest.mock('@/src/lib/api', () => ({
  api: { matches: jest.fn() },
  ApiError: class extends Error {},
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('MatchesScreen navigation', () => {
  beforeEach(() => {
    jest.mocked(api.matches).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  });
  afterEach(() => jest.clearAllMocks());

  it('switches the match query through the fixed status segments', async () => {
    const screen = await render(<MatchesScreen />, { wrapper });

    await waitFor(() => expect(api.matches).toHaveBeenCalledWith('?match_status=live&limit=50'));
    fireEvent.press(screen.getByRole('tab', { name: 'Results' }));
    await waitFor(() => expect(api.matches).toHaveBeenCalledWith('?match_status=finished&limit=50'));
    expect(screen.getByRole('tab', { name: 'Results' }).props.accessibilityState.selected).toBe(true);
  });
});
