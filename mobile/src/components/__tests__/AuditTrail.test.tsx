import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AuditTrail } from '@/src/components/AuditTrail';
import { api } from '@/src/lib/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/manage' }));
jest.mock('@/src/lib/api', () => ({ api: { auditLog: jest.fn() }, ApiError: class extends Error {} }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const entry = (id: string, summary: string, actor = 'AIMZ Staging Admin') => ({
  id, actor_id: 'u-1', actor_name: actor, action: 'event_added', entity_type: 'match',
  entity_id: 'm-1', match_id: 'm-1', summary, created_at: '2026-09-09T12:00:00.000Z',
});

describe('the activity trail under a heading', () => {
  beforeEach(() => {
    jest.mocked(api.auditLog).mockResolvedValue({ items: [
      entry('a-1', 'Added goal at 1.'),
      entry('a-2', 'Saved a lineup with 6 starters.', 'Nadia Coach'),
      entry('a-3', 'Aya Nabil · September'),
    ], total: 3, limit: 50, offset: 0 } as never);
  });
  afterEach(() => jest.clearAllMocks());

  it('carries a magnifier that narrows the log', async () => {
    const screen = await render(<AuditTrail heading="Admin activity" limit={20} />, { wrapper });
    expect(await screen.findByText('Added goal at 1.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('section-search-toggle'));
    await fireEvent.changeText(screen.getByTestId('search-input'), 'lineup');
    expect(screen.getByText('Saved a lineup with 6 starters.')).toBeTruthy();
    expect(screen.queryByText('Added goal at 1.')).toBeNull();
  });

  /** Case, the admin who did it, and a player named in the line all find a row. */
  it('searches what a row actually says, whatever the case', async () => {
    const screen = await render(<AuditTrail heading="Admin activity" limit={20} />, { wrapper });
    await screen.findByText('Added goal at 1.');
    await fireEvent.press(screen.getByTestId('section-search-toggle'));

    await fireEvent.changeText(screen.getByTestId('search-input'), 'NADIA');
    expect(screen.getByText('Saved a lineup with 6 starters.')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('search-input'), 'aya nabil');
    expect(screen.getByText('Aya Nabil · September')).toBeTruthy();
    expect(screen.queryByText('Added goal at 1.')).toBeNull();
  });

  // The slice is what Manage opens on; a search has to reach past it or it would
  // only ever find what is already on the screen.
  it('searches the whole log rather than the slice on screen', async () => {
    const screen = await render(<AuditTrail heading="Admin activity" limit={1} />, { wrapper });
    await screen.findByText('Added goal at 1.');
    expect(screen.queryByText('Aya Nabil · September')).toBeNull();

    await fireEvent.press(screen.getByTestId('section-search-toggle'));
    await fireEvent.changeText(screen.getByTestId('search-input'), 'september');
    expect(screen.getByText('Aya Nabil · September')).toBeTruthy();
  });
});
