import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AttendancePanel } from '@/src/components/AttendancePanel';
import { api } from '@/src/lib/api';
import type { AttendanceMark, Player, TrainingRegister, TrainingSession } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error {},
  api: { setTrainingAttendance: jest.fn(), trainingAttendance: jest.fn() },
}));
jest.mock('@/src/lib/platformAlert', () => ({ showMessage: jest.fn() }));

const session = { id: 't-1', team_id: 'team-1' } as TrainingSession;
const player = (id: string, name: string) => ({ id, name } as Player);

const mark = (id: string, name: string, status: AttendanceMark['status']): AttendanceMark =>
  ({ player: player(id, name), status, marked_at: status ? '2026-09-01T10:00:00Z' : null });

const register = (items: AttendanceMark[]): TrainingRegister => ({
  items,
  present: items.filter((row) => row.status === 'present').length,
  absent: items.filter((row) => row.status === 'absent').length,
  unmarked: items.filter((row) => row.status === null).length,
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const squad = [mark('p-1', 'Amina Adel', null), mark('p-2', 'Nour Hassan', null), mark('p-3', 'Salma Rashad', null)];

describe('AttendancePanel', () => {
  beforeEach(() => {
    jest.mocked(api.trainingAttendance).mockResolvedValue(register(squad));
    jest.mocked(api.setTrainingAttendance).mockResolvedValue(register(squad));
  });

  afterEach(() => jest.clearAllMocks());

  it('offers the whole squad to mark before anybody has been', async () => {
    const screen = await render(<AttendancePanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());
    expect(screen.getByRole('radio', { name: 'Amina Adel present' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Salma Rashad absent' })).toBeTruthy();
  });

  it('counts the register at the top', async () => {
    jest.mocked(api.trainingAttendance).mockResolvedValue(register([
      mark('p-1', 'Amina Adel', 'present'), mark('p-2', 'Nour Hassan', 'present'), mark('p-3', 'Salma Rashad', 'absent'),
    ]));
    const screen = await render(<AttendancePanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByLabelText('Present 2, absent 1')).toBeTruthy());
  });

  it('saves a mark as it is made, without a save button', async () => {
    const screen = await render(<AttendancePanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());
    await fireEvent.press(screen.getByRole('radio', { name: 'Amina Adel present' }));
    await waitFor(() => expect(api.setTrainingAttendance).toHaveBeenCalledWith('t-1', [{ player_id: 'p-1', status: 'present' }]));
  });

  // The register has to be editable after saving, which includes undoing.
  it('takes a mark off again when the one already chosen is pressed', async () => {
    jest.mocked(api.trainingAttendance).mockResolvedValue(register([mark('p-1', 'Amina Adel', 'present')]));
    const screen = await render(<AttendancePanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());
    await fireEvent.press(screen.getByRole('radio', { name: 'Amina Adel present' }));
    await waitFor(() => expect(api.setTrainingAttendance).toHaveBeenCalledWith('t-1', [{ player_id: 'p-1', status: null }]));
  });

  it('changes a mark from present to absent', async () => {
    jest.mocked(api.trainingAttendance).mockResolvedValue(register([mark('p-1', 'Amina Adel', 'present')]));
    const screen = await render(<AttendancePanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());
    await fireEvent.press(screen.getByRole('radio', { name: 'Amina Adel absent' }));
    await waitFor(() => expect(api.setTrainingAttendance).toHaveBeenCalledWith('t-1', [{ player_id: 'p-1', status: 'absent' }]));
  });

  it('marks everyone still unmarked in one go', async () => {
    jest.mocked(api.trainingAttendance).mockResolvedValue(register([
      mark('p-1', 'Amina Adel', 'absent'), mark('p-2', 'Nour Hassan', null), mark('p-3', 'Salma Rashad', null),
    ]));
    const screen = await render(<AttendancePanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Rest present')).toBeTruthy());
    await fireEvent.press(screen.getByText('Rest present'));
    await waitFor(() => expect(api.setTrainingAttendance).toHaveBeenCalledWith('t-1', [
      { player_id: 'p-2', status: 'present' }, { player_id: 'p-3', status: 'present' },
    ]));
  });

  it('offers nothing to fill in once the whole squad is marked', async () => {
    jest.mocked(api.trainingAttendance).mockResolvedValue(register([mark('p-1', 'Amina Adel', 'present')]));
    const screen = await render(<AttendancePanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Amina Adel')).toBeTruthy());
    expect(screen.queryByText('Rest present')).toBeNull();
    expect(screen.queryByText('Not marked')).toBeNull();
  });

  it('says so plainly when the squad is empty', async () => {
    jest.mocked(api.trainingAttendance).mockResolvedValue(register([]));
    const screen = await render(<AttendancePanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('This squad has no players on it yet.')).toBeTruthy());
  });
});
