import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TrainingStatsPanel } from '@/src/components/TrainingStatsPanel';
import { api } from '@/src/lib/api';
import type { Player, TrainingMetric } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, usePathname: () => '/player/p-1' }));
jest.mock('@/src/lib/platformAlert', () => ({ showMessage: jest.fn(), showToast: jest.fn() }));
let mockUser: { role: string; player_id: string | null } | null = { role: 'player', player_id: 'p-1' };
jest.mock('@/src/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
let mockChildren: { id: string; name: string }[] = [];
jest.mock('@/src/auth/useMyTeam', () => ({ useMyChildren: () => ({ children: mockChildren, isLoading: false, isError: false, refetch: jest.fn() }) }));
jest.mock('@/src/lib/api', () => ({
  api: { playerTrainingStats: jest.fn(), attendanceRequests: jest.fn(), requestAttendanceChange: jest.fn() },
  ApiError: class extends Error {},
}));

const metric = (key: string, label: string, playerKind: TrainingMetric['player_kind']): TrainingMetric => ({
  id: `m-${key}`, key, label, kind: 'rating', min_value: 1, max_value: 10,
  unit: null, player_kind: playerKind, sort_order: 10, is_active: true,
});

const overall = metric('overall_rating', 'Overall Rating', 'all');
const dribbling = metric('dribbling', 'Dribbling', 'outfield');
const shooting = metric('shooting', 'Shooting', 'outfield');
const passing = metric('passing', 'Passing', 'outfield');
const shotStopping = metric('shot_stopping', 'Shot Stopping', 'goalkeeper');
const handling = metric('handling', 'Handling', 'goalkeeper');
const distribution = metric('distribution', 'Distribution', 'goalkeeper');
const allMetrics = [overall, dribbling, shooting, passing, shotStopping, handling, distribution];

const stats = (pct: number | null, teamPct: number | null, position = 'CM', sessions?: unknown[]) => {
  const relevant = position === 'GK' ? [overall, shotStopping, handling, distribution] : [overall, dribbling, shooting, passing];
  return {
    player: { id: 'p-1', name: 'Salma Nabil', position } as Player,
    metrics: allMetrics,
    attendance: { attended: 8, expected: 10, late: 1, pct, team_pct: teamPct },
    totals: allMetrics.map((item, index) => ({ metric: item, value: 7 + (index / 10), sessions: 8 })),
    sessions: sessions ?? [{
      id: 's-1', starts_at: '2026-10-06T04:00:00.000Z', venue: 'Palm', status: 'present' as const,
      values: Object.fromEntries(relevant.map((item, index) => [item.id, 7 + index])),
    }],
  };
};

const session = (id: string, status: string | null) => ({
  id, starts_at: '2026-09-07T08:45:00.000Z', venue: 'Palm', status, values: {},
});

const requestFor = (sessionId: string, status: string, decisionReason: string | null = null) => ({
  id: `r-${sessionId}`, training_session_id: sessionId, player_id: 'p-1',
  current_status: 'absent', requested_status: 'present', reason: 'I attended but was marked absent.',
  status, decided_at: null, decision_reason: decisionReason, created_at: '2026-09-08T08:00:00.000Z',
  player: null, session: null,
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const show = async (pct: number | null, teamPct: number | null, position = 'CM', sessions?: unknown[]) => {
  jest.mocked(api.playerTrainingStats).mockResolvedValue(stats(pct, teamPct, position, sessions) as never);
  return render(<TrainingStatsPanel playerId="p-1" />, { wrapper });
};

describe("a player read against her squad's attendance", () => {
  beforeEach(() => {
    mockUser = { role: 'player', player_id: 'p-1' };
    mockChildren = [];
    jest.mocked(api.attendanceRequests).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 } as never);
  });
  afterEach(() => jest.clearAllMocks());

  /**
   * A record on its way is not a record of nothing.
   *
   * The empty panel — `0 of 0`, dashes, "No sessions recorded yet" — is only
   * ever the answer to a read that came back empty, never the state of one
   * still waiting. Pinned because the two look identical on screen, and the
   * difference matters most when somebody is looking at a player they cannot
   * sanity-check from memory.
   */
  it('waits rather than drawing zeros while the read is still out', async () => {
    jest.mocked(api.playerTrainingStats).mockReturnValue(new Promise(() => undefined) as never);
    const screen = await render(<TrainingStatsPanel playerId="p-1" />, { wrapper });

    expect(screen.getByText('Loading training stats')).toBeTruthy();
    expect(screen.queryByText('0 of 0')).toBeNull();
    expect(screen.queryByText('No sessions recorded yet.')).toBeNull();
    expect(screen.queryByText('Session breakdown')).toBeNull();
  });

  // And once it does come back empty, the empty state is the honest answer.
  it('says so plainly when the player really has nothing recorded', async () => {
    jest.mocked(api.playerTrainingStats).mockResolvedValue({
      ...stats(null, null, 'CM', []), attendance: { attended: 0, late: 0, expected: 0, pct: null, team_pct: null },
      totals: allMetrics.map((item) => ({ metric: item, value: null, sessions: 0 })),
    } as never);
    const screen = await render(<TrainingStatsPanel playerId="p-1" />, { wrapper });
    expect(await screen.findByText('No sessions recorded yet.')).toBeTruthy();
  });

  it('gives the squad a cell of its own and still uses six', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText('8 of 10')).toBeTruthy();
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('Team Average')).toBeTruthy();
    expect(screen.getByText('60%')).toBeTruthy();
    // Her own cell holds her own figures and nothing else now.
    expect(screen.queryByText(/Team avg/iu)).toBeNull();
    expect(screen.getAllByTestId('stat-cell')).toHaveLength(6);
  });

  /**
   * The overall mark is a summary of the other three rather than a skill of its
   * own, and the cell it used to close is the squad's now. It is still on every
   * session line, where it says what it is about.
   */
  it('keeps the overall mark out of the summary and on the session line', async () => {
    const screen = await show(80, 60);
    await screen.findByText('Dribbling avg');
    expect(screen.queryByText('Overall Rating avg')).toBeNull();
    expect(screen.getByText(/Overall 7\/10/u)).toBeTruthy();
  });

  it('calls her above the squad when she is clear of it', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText('Above average')).toBeTruthy();
  });

  it('calls her below the squad when she trails it', async () => {
    const screen = await show(50, 75);
    expect(await screen.findByText('Below average')).toBeTruthy();
  });

  /**
   * The band exists so one missed session does not flip a player from one word
   * to the other, which means both its edges are worth pinning: five points is
   * still level, six is not.
   */
  it('counts five points either way as level with the squad', async () => {
    const above = await show(80, 75);
    expect(await above.findByText('Average')).toBeTruthy();

    const below = await show(70, 75);
    expect(await below.findByText('Average')).toBeTruthy();
  });

  it('calls six points a difference', async () => {
    const screen = await show(81, 75);
    expect(await screen.findByText('Above average')).toBeTruthy();
  });

  // Nobody has taken a register for the squad, so there is nothing to be read
  // against — better silent than a verdict drawn from nothing.
  it('leaves the comparison out when the squad has no figure', async () => {
    const screen = await show(80, null);
    expect(await screen.findByText('80%')).toBeTruthy();
    expect(screen.queryByText('Team Average')).toBeNull();
    expect(screen.queryByText(/average/iu)).toBeNull();
  });

  it('shows the outfield ratings and no goalkeeper ratings or minutes', async () => {
    const screen = await show(80, 60);
    expect(await screen.findByText('Dribbling avg')).toBeTruthy();
    expect(screen.getByText('Shooting avg')).toBeTruthy();
    expect(screen.getByText('Passing avg')).toBeTruthy();
    expect(screen.queryByText('Shot Stopping avg')).toBeNull();
    expect(screen.queryByText('Minutes trained')).toBeNull();
  });

  it('switches the summary and session breakdown to goalkeeper ratings', async () => {
    const screen = await show(80, 60, 'GK');
    expect(await screen.findByText('Shot Stopping avg')).toBeTruthy();
    expect(screen.getByText('Handling avg')).toBeTruthy();
    expect(screen.getByText('Distribution avg')).toBeTruthy();
    expect(screen.queryByText('Dribbling avg')).toBeNull();
    expect(screen.getByText(/Overall 7\/10 · Shot Stopping 8\/10 · Handling 9\/10 · Distribution 10\/10/)).toBeTruthy();
  });
});

/**
 * Saying the register is wrong, from the line that says it.
 *
 * A family may ask; nobody else may, and nobody at all writes the register from
 * here — the ask is a request, and a coach or an administrator answers it.
 */
describe('asking for an absence to be corrected', () => {
  beforeEach(() => {
    mockUser = { role: 'player', player_id: 'p-1' };
    mockChildren = [];
    jest.mocked(api.attendanceRequests).mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 } as never);
    jest.mocked(api.requestAttendanceChange).mockResolvedValue(requestFor('s-1', 'pending') as never);
  });
  afterEach(() => jest.clearAllMocks());

  it('offers Request Present under an absent session, and only an absent one', async () => {
    const screen = await show(80, 60, 'CM', [session('s-1', 'absent'), session('s-2', 'present'), session('s-3', 'late')]);
    expect(await screen.findByText('Request Present')).toBeTruthy();
    expect(screen.getAllByText('Request Present')).toHaveLength(1);
  });

  it('asks for a reason, and sends the correction a coach will answer', async () => {
    const screen = await show(80, 60, 'CM', [session('s-1', 'absent')]);
    await fireEvent.press(await screen.findByText('Request Present'));

    expect(screen.getByText(/Current status:/u)).toBeTruthy();
    expect(screen.getByText(/Requested status:/u)).toBeTruthy();
    // Nothing is sent on a blank reason: whoever answers has only the words.
    await fireEvent.press(screen.getByText('Submit Request'));
    expect(api.requestAttendanceChange).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Reason'), 'I attended but was marked absent.');
    await fireEvent.press(screen.getByText('Submit Request'));
    await waitFor(() => expect(api.requestAttendanceChange).toHaveBeenCalledWith('s-1', {
      player_id: 'p-1', requested_status: 'present', reason: 'I attended but was marked absent.',
    }));
  });

  /**
   * The bug this pins: the card used to sit inside the dismiss layer, which on
   * the web is a button with a text field inside it — and the space bar in a
   * field presses the button it is inside, so typing a reason closed the form
   * on the first word. The way out is a childless sheet behind the card.
   */
  it('survives a space in the reason, and still closes from the sheet behind it', async () => {
    const screen = await show(80, 60, 'CM', [session('s-1', 'absent')]);
    await fireEvent.press(await screen.findByText('Request Present'));

    const sheet = screen.getByTestId('request-present-backdrop');
    // The form is not inside the way out, so nothing it does can press it.
    expect(within(sheet).queryByLabelText('Reason')).toBeNull();
    expect(sheet.props.accessible).toBe(false);

    await fireEvent.changeText(screen.getByLabelText('Reason'), 'I was there');
    expect(screen.getByText('Submit Request')).toBeTruthy();
    expect(screen.getByLabelText('Reason').props.value).toBe('I was there');

    await fireEvent.press(sheet);
    await waitFor(() => expect(screen.queryByText('Submit Request')).toBeNull());
  });

  it('shows what became of an ask instead of offering it twice', async () => {
    jest.mocked(api.attendanceRequests).mockResolvedValue({ items: [requestFor('s-1', 'pending')], total: 1, limit: 100, offset: 0 } as never);
    const screen = await show(80, 60, 'CM', [session('s-1', 'absent')]);
    expect(await screen.findByText(/Pending/u)).toBeTruthy();
    expect(screen.queryByText('Request Present')).toBeNull();
  });

  it('says why a refused ask was refused', async () => {
    jest.mocked(api.attendanceRequests).mockResolvedValue({ items: [requestFor('s-1', 'rejected', 'You were not at the ground.')], total: 1, limit: 100, offset: 0 } as never);
    const screen = await show(80, 60, 'CM', [session('s-1', 'absent')]);
    expect(await screen.findByText('Rejected')).toBeTruthy();
    expect(screen.getByText(/You were not at the ground\./u)).toBeTruthy();
  });

  it('lets a parent ask for their own child and nobody else', async () => {
    mockUser = { role: 'parent', player_id: null };
    mockChildren = [{ id: 'p-1', name: 'Salma Nabil' }];
    const mine = await show(80, 60, 'CM', [session('s-1', 'absent')]);
    expect(await mine.findByText('Request Present')).toBeTruthy();

    mockChildren = [{ id: 'p-9', name: 'Somebody else' }];
    const theirs = await show(80, 60, 'CM', [session('s-1', 'absent')]);
    await theirs.findByText('Session breakdown');
    expect(theirs.queryByText('Request Present')).toBeNull();
  });

  // A coach reading the same page answers these on the session itself; the
  // register is never written from a player's own record.
  it('offers a coach nothing to press here', async () => {
    mockUser = { role: 'coach', player_id: null };
    const screen = await show(80, 60, 'CM', [session('s-1', 'absent')]);
    await screen.findByText('Session breakdown');
    expect(screen.queryByText('Request Present')).toBeNull();
    expect(api.attendanceRequests).not.toHaveBeenCalled();
  });
});
