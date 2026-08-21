import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import AuditLogScreen from '@/app/(app)/audit';
import { api } from '@/src/lib/api';
import type { AuditEntry } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  Redirect: 'Redirect',
}));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
jest.mock('@/src/lib/api', () => ({
  api: { auditLog: jest.fn() },
  ApiError: class extends Error {},
}));

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'a-1', actor_id: 'u-1', actor_name: 'Coach Yasmin', action: 'event_added',
  entity_type: 'match_event', entity_id: 'e-1', match_id: 'match-1',
  summary: 'Added goal at 12\'.', created_at: '2026-08-20T18:40:00.000Z',
  ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

jest.setTimeout(30_000);

describe('AuditLogScreen', () => {
  afterEach(() => jest.clearAllMocks());

  it('names the admin behind each change', async () => {
    jest.mocked(api.auditLog).mockResolvedValue({ items: [entry()], total: 1, limit: 50, offset: 0 });
    const screen = await render(<AuditLogScreen />, { wrapper });
    expect(await screen.findByText("Added goal at 12'.")).toBeTruthy();
    expect(screen.getByText(/Coach Yasmin/)).toBeTruthy();
  });

  it('separates a correction from the admin who made it', async () => {
    jest.mocked(api.auditLog).mockResolvedValue({
      items: [
        entry({ id: 'a-1', actor_name: 'Coach Yasmin', summary: "Added goal at 12'." }),
        entry({ id: 'a-2', actor_name: 'Coach Dina', action: 'event_removed', summary: 'Removed an event from the timeline.' }),
      ],
      total: 2, limit: 50, offset: 0,
    });
    const screen = await render(<AuditLogScreen />, { wrapper });
    // The point of the trail: two admins on one match stay distinguishable.
    expect(await screen.findByText(/Coach Yasmin/)).toBeTruthy();
    expect(screen.getByText(/Coach Dina/)).toBeTruthy();
    expect(screen.getByText('2 actions recorded')).toBeTruthy();
  });

  it('says so when nothing has been recorded', async () => {
    jest.mocked(api.auditLog).mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
    const screen = await render(<AuditLogScreen />, { wrapper });
    expect(await screen.findByText('Nothing recorded yet')).toBeTruthy();
  });
});
