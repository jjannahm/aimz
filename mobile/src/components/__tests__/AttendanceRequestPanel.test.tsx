import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AttendanceRequestPanel } from '@/src/components/AttendanceRequestPanel';
import { api } from '@/src/lib/api';
import type { AttendanceRequest, Player, TrainingSession } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error {},
  api: {
    attendanceRequests: jest.fn(),
    requestAttendanceChange: jest.fn(),
    approveAttendanceRequest: jest.fn(),
    rejectAttendanceRequest: jest.fn(),
  },
}));
jest.mock('@/src/lib/platformAlert', () => ({ showMessage: jest.fn() }));

const mockUser: { role: string } = { role: 'player' };
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));

const session = { id: 't-1', team_id: 'team-1' } as TrainingSession;

const req = (over: Partial<AttendanceRequest> = {}): AttendanceRequest => ({
  id: 'r-1',
  training_session_id: 't-1',
  player_id: 'p-1',
  current_status: 'absent',
  requested_status: 'late',
  reason: 'I was there, twenty minutes in',
  status: 'pending',
  decided_at: null,
  decision_reason: null,
  created_at: '2026-09-01T10:00:00Z',
  player: { id: 'p-1', name: 'Layla Hassan' } as Player,
  session: null,
  ...over,
});

const page = (items: AttendanceRequest[]) => ({ items, total: items.length, limit: 100, offset: 0 });

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('AttendanceRequestPanel', () => {
  beforeEach(() => {
    mockUser.role = 'player';
    jest.mocked(api.attendanceRequests).mockResolvedValue(page([]));
    jest.mocked(api.requestAttendanceChange).mockResolvedValue(req());
    jest.mocked(api.approveAttendanceRequest).mockResolvedValue(req({ status: 'approved' }));
    jest.mocked(api.rejectAttendanceRequest).mockResolvedValue(req({ status: 'rejected' }));
  });
  afterEach(() => jest.clearAllMocks());

  it('lets a family ask, saying what it should say and why', async () => {
    const screen = await render(<AttendanceRequestPanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Ask for a correction')).toBeTruthy());

    await fireEvent.press(screen.getByRole('tab', { name: 'Late' }));
    await fireEvent.changeText(screen.getByLabelText('Why'), 'I was there, twenty minutes in');
    await fireEvent.press(screen.getByText('Ask for a correction'));

    await waitFor(() => expect(api.requestAttendanceChange).toHaveBeenCalledWith('t-1', {
      reason: 'I was there, twenty minutes in',
      requested_status: 'late',
    }));
  });

  it('shows a raised request instead of the form, so nobody asks twice', async () => {
    jest.mocked(api.attendanceRequests).mockResolvedValue(page([req()]));
    const screen = await render(<AttendanceRequestPanel session={session} />, { wrapper });

    await waitFor(() => expect(screen.getByText('Waiting for a coach to answer')).toBeTruthy());
    expect(screen.queryByText('Ask for a correction')).toBeNull();
  });

  it('tells a family what came of one, and why it was refused', async () => {
    jest.mocked(api.attendanceRequests).mockResolvedValue(page([
      req({ decided_at: '2026-09-02T09:00:00Z', decision_reason: 'You were not at this one', id: 'r-2', status: 'rejected' }),
    ]));
    const screen = await render(<AttendanceRequestPanel session={session} />, { wrapper });

    await waitFor(() => expect(screen.getByText(/Not approved/)).toBeTruthy());
    expect(screen.getByText('“You were not at this one”')).toBeTruthy();
    // A decided request does not stop them raising another: a register can be
    // wrong twice.
    expect(screen.getByText('Ask for a correction')).toBeTruthy();
  });

  it('gives a coach the queue rather than the form', async () => {
    mockUser.role = 'coach';
    jest.mocked(api.attendanceRequests).mockResolvedValue(page([req()]));
    const screen = await render(<AttendanceRequestPanel session={session} />, { wrapper });

    await waitFor(() => expect(screen.getByText('Layla Hassan')).toBeTruthy());
    expect(screen.queryByText('Ask for a correction')).toBeNull();

    await fireEvent.press(screen.getByText('Approve'));
    await waitFor(() => expect(api.approveAttendanceRequest).toHaveBeenCalledWith('r-1'));
  });

  it('shows a decider nothing at all when the queue is empty', async () => {
    mockUser.role = 'admin';
    const screen = await render(<AttendanceRequestPanel session={session} />, { wrapper });
    await waitFor(() => expect(api.attendanceRequests).toHaveBeenCalled());
    // No empty panel taking up room above the register.
    expect(screen.queryByText('Attendance corrections')).toBeNull();
  });
});
