import { render } from '@testing-library/react-native';

import { MatchTimeline } from '@/src/components/MatchTimeline';
import type { MatchEvent } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const event = (over: Partial<MatchEvent>): MatchEvent => ({
  id: 'e-1', match_id: 'match-1', type: 'goal', minute: 12, team_id: 'home',
  player_id: null, secondary_player_id: null, related_event_id: null, notes: null,
  is_penalty: false, substitution_reason: null, penalty_outcome: null,
  client_operation_id: null, created_at: '', updated_at: '',
  ...over,
} as MatchEvent);

const names = new Map([['p-home', 'Aya Nabil'], ['p-away', 'Salma Fouad'], ['p-assist', 'Habiba Ashraf']]);

const timeline = (events: MatchEvent[]) => render(
  <MatchTimeline awayTeamName="Al Ahly U13" events={events} homeTeamId="home" homeTeamName="AIMZ U13" playerNames={names} />,
);

describe('MatchTimeline', () => {
  it('says so plainly when nothing has happened yet', async () => {
    const screen = await timeline([]);
    expect(screen.getByText('Match events will appear here.')).toBeTruthy();
  });

  // The point of the two columns: a row names its team by which side it is on,
  // so the label has to carry the team it belongs to.
  it('files each event under the team that made it', async () => {
    const screen = await timeline([
      event({ id: 'e-home', player_id: 'p-home', minute: 12 }),
      event({ id: 'e-away', player_id: 'p-away', team_id: 'away', minute: 34 }),
    ]);

    expect(screen.getByLabelText("12' AIMZ U13, Goal, Aya Nabil")).toBeTruthy();
    expect(screen.getByLabelText("34' Al Ahly U13, Goal, Salma Fouad")).toBeTruthy();
  });

  it('keeps a goal and its assist on the one row', async () => {
    const screen = await timeline([event({ player_id: 'p-home', secondary_player_id: 'p-assist' })]);

    expect(screen.getByText('Aya Nabil')).toBeTruthy();
    expect(screen.getByText('Assist: Habiba Ashraf')).toBeTruthy();
  });

  it('marks a penalty and names who came off in a substitution', async () => {
    const screen = await timeline([
      event({ id: 'e-pen', player_id: 'p-home', is_penalty: true }),
      event({ id: 'e-sub', type: 'substitution', player_id: 'p-assist', secondary_player_id: 'p-home', minute: 60 }),
    ]);

    expect(screen.getByText('Aya Nabil (pen)')).toBeTruthy();
    expect(screen.getByText('Off: Aya Nabil')).toBeTruthy();
    expect(screen.getByText('Substitution')).toBeTruthy();
  });

  // An own goal is a goal for the other side, so it is filed under them — while
  // still naming the side who put it in.
  it('files an own goal under the team it counted for', async () => {
    const screen = await timeline([event({ type: 'own_goal', team_id: 'away', minute: 45 })]);

    expect(screen.getByLabelText("45' AIMZ U13, Own goal, Al Ahly U13")).toBeTruthy();
    expect(screen.getByText('Own goal')).toBeTruthy();
  });

  it('files our own goal under the opponent, the same way round', async () => {
    const screen = await timeline([event({ type: 'own_goal', team_id: 'home', minute: 45 })]);
    expect(screen.getByLabelText("45' Al Ahly U13, Own goal, AIMZ U13")).toBeTruthy();
  });

  it('stamps an event with no minute as full time', async () => {
    const screen = await timeline([event({ minute: null, player_id: 'p-home' })]);
    expect(screen.getByText('FT')).toBeTruthy();
  });
});
