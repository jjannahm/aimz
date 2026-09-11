import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import TrainingSessionScreen from '@/app/(app)/training/[id]';
import { api } from '@/src/lib/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({ id: 't-1' }), usePathname: () => '/training/t-1' }));
jest.mock('@/src/lib/api', () => ({ api: { trainingSession: jest.fn() }, ApiError: class extends Error {} }));

let mockRole = 'coach';
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: { role: mockRole } }) }));

/** The three panels, stubbed: this is about which order they arrive in. */
jest.mock('@/src/components/AttendancePanel', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { AttendancePanel: () => React.createElement(Text, null, 'The register') };
});
jest.mock('@/src/components/AttendanceRequestPanel', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { AttendanceRequestPanel: () => React.createElement(Text, null, 'Attendance corrections') };
});
jest.mock('@/src/components/AvailabilityPanel', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return { AvailabilityPanel: () => React.createElement(Text, null, 'Who is coming') };
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const show = async () => {
  jest.mocked(api.trainingSession).mockResolvedValue({
    id: 't-1', team_id: 'team-1', team: { id: 'team-1', name: 'U13' }, starts_at: '2026-08-31T08:45:00.000Z',
    duration_minutes: 90, venue: 'Palm', notes: null, series_id: null, created_at: '', updated_at: '',
  } as never);
  return render(<TrainingSessionScreen />, { wrapper });
};

/** Where the whole thing is read from, once it is on the page. */
const order = (screen: Awaited<ReturnType<typeof show>>) => {
  const page = JSON.stringify(screen.toJSON());
  return { register: page.indexOf('The register'), corrections: page.indexOf('Attendance corrections') };
};

describe('a training session, as whoever opens it', () => {
  afterEach(() => jest.clearAllMocks());

  /**
   * The corrections used to sit under the register. On a squad of twenty that
   * is a screen and a half below the fold, so a coach had to scroll past every
   * player to find out anybody had asked — which is why, in practice, nobody
   * ever did. They come first for whoever answers them.
   */
  it('puts the corrections above the register for a coach', async () => {
    mockRole = 'coach';
    const screen = await show();
    await screen.findByText('The register');
    const at = order(screen);
    expect(at.corrections).toBeGreaterThan(-1);
    expect(at.corrections).toBeLessThan(at.register);
  });

  it('does the same for an administrator', async () => {
    mockRole = 'admin';
    const screen = await show();
    await screen.findByText('The register');
    const at = order(screen);
    expect(at.corrections).toBeLessThan(at.register);
  });

  // A family has no register to read, and meets the ask where it always was.
  it('gives a family the ask and no register at all', async () => {
    mockRole = 'player';
    const screen = await show();
    expect(await screen.findByText('Attendance corrections')).toBeTruthy();
    expect(screen.queryByText('The register')).toBeNull();
    expect(screen.getByText('Who is coming')).toBeTruthy();
  });
});
