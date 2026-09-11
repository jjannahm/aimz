import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import SharedMatchReportScreen from '@/app/m/[token]';
import { api } from '@/src/lib/api';
import type { SharedMatchReport } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ token: 'a-private-address' }) }));
jest.mock('@/src/lib/api', () => ({
  ApiError: class extends Error { status?: number },
  api: { sharedMatchReport: jest.fn() },
}));

const report: SharedMatchReport = {
  published_at: '2026-09-06T18:00:00.000Z',
  published_by_name: 'Coach Nour',
  snapshot: {
    version: 1,
    match: {
      competition: 'Girls U12 League', kickoff: '2026-09-06T15:00:00.000Z', venue: 'AIMZ Ground',
      home: 'AIMZ U12', away: 'Wadi Degla', home_score: 3, away_score: 1,
      formation: '4-3-3', man_of_the_match: 'Nour Hassan',
    },
    goals: [
      { minute: 12, team: 'AIMZ U12', scorer: 'Nour Hassan', assist: 'Habiba Tarek', penalty: false, own_goal: false },
      { minute: 34, team: 'AIMZ U12', scorer: 'Nour Hassan', assist: null, penalty: true, own_goal: false },
      { minute: 55, team: 'Wadi Degla', scorer: 'Malak Omar', assist: null, penalty: false, own_goal: false },
      { minute: 71, team: 'AIMZ U12', scorer: null, assist: null, penalty: false, own_goal: true },
    ],
    cards: [{ minute: 63, team: 'Wadi Degla', player: 'Malak Omar', colour: 'yellow' }],
    substitutions: [{ minute: 60, team: 'AIMZ U12', on: 'Salma Adel', off: 'Habiba Tarek', reason: 'tactical' }],
    penalties_missed: [],
    squads: [{
      team: 'AIMZ U12',
      players: [
        { name: 'Nour Hassan', jersey_number: 9, position: 'ST', started: true, captain: true, minutes: 90, goals: 2, assists: 0, yellow_cards: 0, red_cards: 0 },
        { name: 'Habiba Tarek', jersey_number: 7, position: 'RW', started: true, captain: false, minutes: 60, goals: 0, assists: 1, yellow_cards: 0, red_cards: 0 },
        { name: 'Salma Adel', jersey_number: 11, position: 'CM', started: false, captain: false, minutes: 30, goals: 0, assists: 0, yellow_cards: 0, red_cards: 0 },
      ],
    }],
    generated_at: '2026-09-06T18:00:00.000Z',
  },
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('the page a match report link opens', () => {
  afterEach(() => jest.clearAllMocks());

  it('reads the whole match without asking who is looking', async () => {
    jest.mocked(api.sharedMatchReport).mockResolvedValue(report);
    const screen = await render(<SharedMatchReportScreen />, { wrapper });

    // The name is both a side of the scoreline and the team-sheet heading.
    await waitFor(() => expect(screen.getAllByText('AIMZ U12').length).toBeGreaterThan(0));
    // Named on the scoreline, and again beside the goal and card it earned.
    expect(screen.getAllByText('Wadi Degla').length).toBeGreaterThan(0);
    expect(screen.getByText('Girls U12 League · 4-3-3')).toBeTruthy();
    // The result in words as well as in the scoreline.
    expect(screen.getByText(/Home win/)).toBeTruthy();
    expect(screen.getByText(/AIMZ Ground/)).toBeTruthy();
    expect(screen.getByText('Player of the match')).toBeTruthy();

    // A penalty says so, and an own goal names the side rather than a scorer,
    // so it never reads as somebody's scoring record.
    expect(screen.getByText('Nour Hassan (pen)')).toBeTruthy();
    expect(screen.getByText('Own goal — AIMZ U12')).toBeTruthy();
    expect(screen.getByText('Assist Habiba Tarek · AIMZ U12')).toBeTruthy();

    // A card carries a word, never only a colour.
    expect(screen.getByText('Yellow')).toBeTruthy();
    expect(screen.getByText('Salma Adel on')).toBeTruthy();

    // The team sheet, in its two halves, with the captain marked, what each
    // player did, and how long she was on for — a nought included.
    expect(screen.getByText('Nour Hassan (C)')).toBeTruthy();
    expect(screen.getByText('Starters')).toBeTruthy();
    expect(screen.getByText('Substitutes')).toBeTruthy();
    expect(screen.getByText('2 goals')).toBeTruthy();
    expect(screen.getByText('1 assist')).toBeTruthy();
    expect(screen.getByText('90 min')).toBeTruthy();
    expect(screen.getByText('60 min')).toBeTruthy();
    // The half it is in says it now, so the line under a name does not.
    expect(screen.queryByText(/· substitute/u)).toBeNull();

    expect(screen.getByText(/Shared by Coach Nour/)).toBeTruthy();
  });

  /**
   * A wrong address, a replaced one and a withdrawn report are one message on
   * purpose: the page cannot say which, and telling them apart would make the
   * link a way of finding out which matches exist.
   */
  it('says to ask for a new link rather than which of three things went wrong', async () => {
    const notFound = Object.assign(new Error('gone'), { status: 404 });
    jest.mocked(api.sharedMatchReport).mockRejectedValue(notFound);
    const screen = await render(<SharedMatchReportScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText(/no longer available/)).toBeTruthy());
    expect(screen.getByText(/Ask the academy for a new link/)).toBeTruthy();
  });

  // Nothing happened worth listing is different from the block being broken.
  it('says so when a match had no goals', async () => {
    jest.mocked(api.sharedMatchReport).mockResolvedValue({
      ...report,
      snapshot: { ...report.snapshot, match: { ...report.snapshot.match, home_score: 0, away_score: 0, man_of_the_match: null }, goals: [], cards: [], substitutions: [] },
    });
    const screen = await render(<SharedMatchReportScreen />, { wrapper });

    await waitFor(() => expect(screen.getByText('No goals were recorded.')).toBeTruthy());
    expect(screen.getByText(/Draw/)).toBeTruthy();
    expect(screen.queryByText('Player of the match')).toBeNull();
    // Empty blocks are dropped rather than shown holding nothing.
    expect(screen.queryByText('CARDS')).toBeNull();
    expect(screen.queryByText('SUBSTITUTIONS')).toBeNull();
  });
});
