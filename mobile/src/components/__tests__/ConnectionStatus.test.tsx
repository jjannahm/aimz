import { act, render, waitFor } from '@testing-library/react-native';

const mockWaitUntilReady = jest.fn();

jest.mock('@/src/config', () => ({
  appConfig: { apiBaseUrl: 'https://api.example.test' },
}));
jest.mock('@/src/lib/api', () => ({
  api: { waitUntilReady: (...args: unknown[]) => mockWaitUntilReady(...args) },
}));

import { ConnectionStatus } from '@/src/components/ConnectionStatus';

describe('ConnectionStatus', () => {
  beforeEach(() => {
    mockWaitUntilReady.mockReset();
  });

  it('shows a cold-start state and recovers when the API is ready', async () => {
    let resolveReadiness: (() => void) | undefined;
    mockWaitUntilReady.mockImplementation((onWaiting?: () => void) => {
      onWaiting?.();
      return new Promise<void>((resolve) => {
        resolveReadiness = resolve;
      });
    });

    const screen = await render(<ConnectionStatus />);
    await waitFor(() => expect(screen.getByText('Preview server is waking up')).toBeTruthy());

    await act(async () => resolveReadiness?.());
    await waitFor(() => expect(screen.getByText('Preview server ready')).toBeTruthy());
  });
});
