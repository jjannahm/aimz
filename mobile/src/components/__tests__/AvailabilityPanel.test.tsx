import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AvailabilityPanel } from '@/src/components/AvailabilityPanel';
import { api } from '@/src/lib/api';
import type { Player, TrainingAvailability, TrainingSession } from '@/src/types/api';

let mockUser: { role: 'admin' | 'player'; player_id?: string } = { role: 'player', player_id: 'p-1' };

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error {},
  api: { players: jest.fn(), setTrainingAvailability: jest.fn(), trainingAvailability: jest.fn() },
}));
jest.mock('@/src/lib/platformAlert', () => ({ showMessage: jest.fn() }));

const session = { id: 't-1', team_id: 'team-1' } as TrainingSession;
const squad = [{ id: 'p-1', name: 'Amina Adel' }, { id: 'p-2', name: 'Nour Hassan' }] as Player[];

const row = (over: Partial<TrainingAvailability> = {}) => ({
  id: 'a-1',
  training_session_id: 't-1',
  player_id: 'p-1',
  player: squad[0],
  status: 'going',
  note: null,
  created_at: '2026-08-30T00:00:00Z',
  updated_at: '2026-08-30T00:00:00Z',
  ...over,
}) as TrainingAvailability;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const noteField = (screen: Awaited<ReturnType<typeof render>>) => screen.getByLabelText('Note (optional)');

// A save invalidates the availability cache, so the panel refetches after the
// assertion the test cares about. Waiting for that second read keeps the state
// update it causes inside the test, rather than landing after teardown.
const settle = () => waitFor(() => expect(api.trainingAvailability).toHaveBeenCalledTimes(2));

describe('AvailabilityPanel note', () => {
  beforeEach(() => {
    mockUser = { role: 'player', player_id: 'p-1' };
    jest.mocked(api.trainingAvailability).mockResolvedValue([]);
    jest.mocked(api.setTrainingAvailability).mockResolvedValue(row());
    jest.mocked(api.players).mockResolvedValue({ items: squad, total: squad.length } as Awaited<ReturnType<typeof api.players>>);
  });

  afterEach(() => jest.clearAllMocks());

  it('carries a saved note over when the answer is changed', async () => {
    jest.mocked(api.trainingAvailability).mockResolvedValue([row({ note: 'Back injury' })]);
    const screen = await render(<AvailabilityPanel session={session} />, { wrapper });
    await waitFor(() => expect(noteField(screen).props.value).toBe('Back injury'));

    await fireEvent.press(screen.getByRole('radio', { name: 'Not going' }));

    await waitFor(() => expect(api.setTrainingAvailability).toHaveBeenCalled());
    expect(api.setTrainingAvailability).toHaveBeenCalledWith('t-1', 'not_going', 'Back injury');
    await settle();
  });

  it('loads the saved note into the field', async () => {
    jest.mocked(api.trainingAvailability).mockResolvedValue([row({ note: 'Late from school' })]);
    const screen = await render(<AvailabilityPanel session={session} />, { wrapper });
    await waitFor(() => expect(noteField(screen).props.value).toBe('Late from school'));
  });

  it('offers no save until there is an answer to attach the note to', async () => {
    const screen = await render(<AvailabilityPanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Going' })).toBeTruthy());
    expect(screen.queryByText('Save note')).toBeNull();
  });

  it('saves an edited note against the answer already given', async () => {
    jest.mocked(api.trainingAvailability).mockResolvedValue([row({ note: 'Back injury' })]);
    const screen = await render(<AvailabilityPanel session={session} />, { wrapper });
    await waitFor(() => expect(noteField(screen).props.value).toBe('Back injury'));

    await fireEvent.changeText(noteField(screen), 'Fit again');
    await fireEvent.press(screen.getByText('Save note'));

    await waitFor(() => expect(api.setTrainingAvailability).toHaveBeenCalled());
    expect(api.setTrainingAvailability).toHaveBeenCalledWith('t-1', 'going', 'Fit again');
    await settle();
  });

});

describe('AvailabilityPanel answers', () => {
  beforeEach(() => {
    mockUser = { role: 'admin' };
    jest.mocked(api.trainingAvailability).mockResolvedValue([]);
    jest.mocked(api.players).mockResolvedValue({ items: squad, total: squad.length } as Awaited<ReturnType<typeof api.players>>);
  });

  afterEach(() => jest.clearAllMocks());

  it('asks only whether a player is going or not', async () => {
    mockUser = { role: 'player', player_id: 'p-1' };
    const screen = await render(<AvailabilityPanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Going' })).toBeTruthy());
    expect(screen.getByRole('radio', { name: 'Not going' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Maybe' })).toBeNull();
  });

  // A coach counting a squad has to tell someone staying away from someone who
  // has not looked yet, so the unanswered are named rather than simply absent.
  it('names the players who have not answered', async () => {
    jest.mocked(api.trainingAvailability).mockResolvedValue([row()]);
    const screen = await render(<AvailabilityPanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Going · 1')).toBeTruthy());
    expect(screen.getByText('No response · 1')).toBeTruthy();
    expect(screen.getByText('Nour Hassan')).toBeTruthy();
  });

  it('says so when the whole squad has answered', async () => {
    jest.mocked(api.trainingAvailability).mockResolvedValue([row(), row({ id: 'a-2', player_id: 'p-2', player: squad[1], status: 'not_going' })]);
    const screen = await render(<AvailabilityPanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('No response · 0')).toBeTruthy());
    expect(screen.getByText('Everybody has answered')).toBeTruthy();
  });

  // An admin reads the replies rather than answering in their place, so the
  // panel they open carries the tallies and nothing to fill in.
  it('gives an admin the replies to read, not a vote to cast', async () => {
    jest.mocked(api.trainingAvailability).mockResolvedValue([row()]);
    const screen = await render(<AvailabilityPanel session={session} />, { wrapper });
    await waitFor(() => expect(screen.getByText('Going · 1')).toBeTruthy());
    expect(screen.queryByRole('radio', { name: 'Going' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Not going' })).toBeNull();
    expect(screen.queryByLabelText('Note (optional)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Player' })).toBeNull();
    expect(screen.queryByText('Save note')).toBeNull();
  });
});
