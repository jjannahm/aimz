import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ScheduleManager } from '@/src/components/manage/HubManagers';
import { api } from '@/src/lib/api';
import type { AttendanceRequest, Team, TrainingSession } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/manage' }));
jest.mock('@/src/lib/platformAlert', () => ({ showMessage: jest.fn(), showToast: jest.fn(), confirmAction: jest.fn() }));
jest.mock('@/src/lib/api', () => ({
  api: {
    trainingSessions: jest.fn(),
    attendanceRequests: jest.fn(),
    createTrainingSchedule: jest.fn(),
    updateTrainingSession: jest.fn(),
    deleteTrainingSession: jest.fn(),
  },
  ApiError: class extends Error {},
}));

const team = { id: 'team-u13', name: 'U13' } as Team;

const session = (id: string, startsAt: string): TrainingSession => ({
  id, team_id: team.id, team, starts_at: startsAt, duration_minutes: 90, venue: 'Palm',
  notes: null, series_id: null, created_at: '', updated_at: '',
});

const request = (id: string, sessionId: string): AttendanceRequest => ({
  id, training_session_id: sessionId, player_id: 'p-1', current_status: 'absent',
  requested_status: 'present', reason: 'I attended but was marked absent.', status: 'pending',
  decided_at: null, decision_reason: null, created_at: '', player: null, session: null,
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const sessions = [session('s-1', '2026-08-31T08:45:00.000Z'), session('s-2', '2026-09-07T08:45:00.000Z')];

const open = async () => {
  const screen = await render(<ScheduleManager teams={[team]} />, { wrapper });
  await fireEvent.press(await screen.findByRole('button', { name: 'Show current training sessions' }));
  return screen;
};

/**
 * A correction is answered on the session it is about, which is no use unless
 * the list says which session that is. Nothing else in the app tells a coach
 * somebody has asked, so without this line a request waits until the family
 * mentions it.
 */
describe('the training schedule, as the coach who works it', () => {
  beforeEach(() => {
    jest.mocked(api.trainingSessions).mockResolvedValue({ items: sessions, total: 2, limit: 100, offset: 0 } as never);
    jest.mocked(api.attendanceRequests).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 } as never);
  });
  afterEach(() => jest.clearAllMocks());

  it('says which session has a correction waiting, and how many', async () => {
    jest.mocked(api.attendanceRequests).mockResolvedValue({
      items: [request('r-1', 's-2'), request('r-2', 's-2')], total: 2, limit: 100, offset: 0,
    } as never);
    const screen = await open();

    expect(await screen.findByText('2 attendance corrections waiting')).toBeTruthy();
    // Only the session it was asked about carries it.
    expect(screen.getAllByText(/attendance correction/u)).toHaveLength(1);
  });

  it('counts one as one', async () => {
    jest.mocked(api.attendanceRequests).mockResolvedValue({ items: [request('r-1', 's-1')], total: 1, limit: 100, offset: 0 } as never);
    const screen = await open();
    expect(await screen.findByText('1 attendance correction waiting')).toBeTruthy();
  });

  it('says nothing on a session nobody has asked about', async () => {
    const screen = await open();
    await screen.findAllByText('U13');
    expect(screen.queryByText(/attendance correction/u)).toBeNull();
  });
});
