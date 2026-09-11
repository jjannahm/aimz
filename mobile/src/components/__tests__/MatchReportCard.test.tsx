import { render, within } from '@testing-library/react-native';

import { MatchReportCard } from '@/src/components/MatchReportCard';
import type { MatchReportSnapshot } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const player = (name: string, started: boolean, minutes: number, over: Record<string, unknown> = {}) => ({
  name, jersey_number: 1, position: 'CM', started, captain: false, minutes,
  goals: 0, assists: 0, yellow_cards: 0, red_cards: 0, ...over,
});

const snapshot = (squad: Partial<MatchReportSnapshot['squads'][number]>): MatchReportSnapshot => ({
  version: 1,
  match: {
    competition: 'Girls U11', kickoff: '2026-08-31T10:15:00.000Z', venue: 'Palm hills',
    home: 'U11', away: 'Al Ahly U11', home_score: 1, away_score: 1, formation: null, man_of_the_match: null,
  },
  goals: [], cards: [], substitutions: [], penalties_missed: [],
  squads: [{ team: 'U11', staff: { coach: null, assistant_coach: null }, players: [], ...squad }],
  generated_at: '2026-08-31T12:00:00.000Z',
}) as MatchReportSnapshot;

describe('the team sheet on a match report', () => {
  /**
   * A team sheet is read in two halves, and the page says which half it is in
   * once at the top rather than appending "substitute" to every bench name.
   */
  it('splits the squad into starters and substitutes', async () => {
    const screen = await render(<MatchReportCard report={snapshot({ players: [
      player('Hana Nabil', true, 2),
      player('Layla Gamal', false, 1),
    ] })} />);

    expect(screen.getByText('Starters')).toBeTruthy();
    expect(screen.getByText('Substitutes')).toBeTruthy();
    expect(screen.queryByText(/· substitute/u)).toBeNull();
  });

  /**
   * Every name carries its minutes, a nought included: "0 min" is the answer
   * for somebody who was named and never used, and a blank would read as a
   * figure nobody bothered to record.
   */
  it('gives every player her minutes, including none at all', async () => {
    const screen = await render(<MatchReportCard report={snapshot({ players: [
      player('Hana Nabil', true, 2),
      player('Farida Anwar', false, 0),
    ] })} />);

    expect(screen.getByText('2 min')).toBeTruthy();
    expect(screen.getByText('0 min')).toBeTruthy();
  });

  it('keeps the captain, the goals and the shirt beside the name', async () => {
    const screen = await render(<MatchReportCard report={snapshot({ players: [
      player('Malak Sabry', true, 1, { captain: true, goals: 1, jersey_number: 5 }),
    ] })} />);

    expect(screen.getByText('Malak Sabry (C)')).toBeTruthy();
    expect(screen.getByText('1 goal')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('1 min')).toBeTruthy();
  });

  it('names the coaches who picked the side', async () => {
    const screen = await render(<MatchReportCard report={snapshot({
      staff: { coach: 'Nadia Fouad', assistant_coach: 'Omar Adel' },
      players: [player('Hana Nabil', true, 2)],
    })} />);

    expect(screen.getByText('Nadia Fouad')).toBeTruthy();
    expect(screen.getByText('Omar Adel')).toBeTruthy();
  });

  // An academy that never named an assistant should not be made to look as
  // though the report lost one.
  it('says plainly when a staff role is unfilled', async () => {
    const screen = await render(<MatchReportCard report={snapshot({
      staff: { coach: 'Nadia Fouad', assistant_coach: null },
      players: [player('Hana Nabil', true, 2)],
    })} />);

    expect(screen.getByText('Not assigned')).toBeTruthy();
  });

  /**
   * A report published before the coaches were on it has no `staff` at all.
   * Its address is already out, so it has to keep rendering.
   */
  it('renders a report published before staff were recorded', async () => {
    const older = snapshot({ players: [player('Hana Nabil', true, 2)] });
    delete (older.squads[0] as { staff?: unknown }).staff;

    const screen = await render(<MatchReportCard report={older} />);
    expect(screen.getByText('Hana Nabil')).toBeTruthy();
    expect(screen.queryByText('Coach')).toBeNull();
  });

  it('says so when no team sheet was named at all', async () => {
    const screen = await render(<MatchReportCard report={snapshot({ players: [] })} />);
    expect(screen.getByText('No team sheet was named.')).toBeTruthy();
    expect(screen.queryByText('Starters')).toBeNull();
  });

  // A sheet of eleven with nobody on the bench should not print an empty
  // heading over nothing.
  it('leaves out a half that has nobody in it', async () => {
    const screen = await render(<MatchReportCard report={snapshot({ players: [player('Hana Nabil', true, 2)] })} />);
    expect(screen.getByText('Starters')).toBeTruthy();
    expect(screen.queryByText('Substitutes')).toBeNull();
  });
});
