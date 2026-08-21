import { fireEvent, render } from '@testing-library/react-native';

import { BracketView } from '@/src/components/BracketView';
import type { Bracket, Team } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const team = (id: string, name: string): Team => ({
  id, name, squad_code: null, age_group: null, season: null, is_aimz: false, is_active: true,
  logo_key: null, logo_url: null, coach: null, assistant_coach: null,
  competition_id: null, competition_group_id: null, created_at: '', updated_at: '',
} as Team);

const bracket = (over: Partial<Bracket['rounds'][number]['slots'][number]> = {}): Bracket => ({
  competition_id: 'c-1', team_count: 8,
  rounds: [
    { round: 4, label: 'Semi Finals', slots: [
      { id: 's1', round: 4, position: 0, home_team: team('a', 'Alpha FC'), away_team: team('b', 'Bravo FC'), winner_team_id: null, match_id: null, ...over },
      { id: 's2', round: 4, position: 1, home_team: null, away_team: null, winner_team_id: null, match_id: null },
    ] },
    { round: 2, label: 'Final', slots: [
      { id: 'f1', round: 2, position: 0, home_team: null, away_team: null, winner_team_id: null, match_id: null },
    ] },
  ],
});

describe('BracketView', () => {
  it('stacks the rounds so a phone never scrolls sideways', async () => {
    const screen = await render(<BracketView bracket={bracket()} />);
    expect(screen.getByText('Semi Finals')).toBeTruthy();
    expect(screen.getByText('Final')).toBeTruthy();
  });

  it('says a tie is waiting for its teams, not that they withdrew', async () => {
    const screen = await render(<BracketView bracket={bracket()} />);
    expect(screen.getAllByText('To be decided').length).toBe(4);
    expect(screen.queryByText('Withdrawn')).toBeNull();
  });

  // An empty side of a settled tie is a team that is gone, which reads very
  // differently from one that has not arrived yet.
  it('calls an empty side of a decided tie withdrawn', async () => {
    const played = bracket({ away_team: null, winner_team_id: 'a' });
    const screen = await render(<BracketView bracket={played} />);
    expect(screen.getByText('Withdrawn')).toBeTruthy();
  });

  it('offers no admin controls to a player', async () => {
    const screen = await render(<BracketView bracket={bracket()} />);
    expect(screen.queryByText(/Advance to/u)).toBeNull();
    expect(screen.queryByLabelText('Alpha FC wins this tie')).toBeNull();
  });

  it('lets an admin draw a round and name a winner', async () => {
    const onAdvance = jest.fn();
    const onPickWinner = jest.fn();
    const screen = await render(<BracketView bracket={bracket()} onAdvance={onAdvance} onPickWinner={onPickWinner} />);
    // The semi finals already hold teams, so drawing them again is a redraw;
    // the empty final is the round still to be filled.
    fireEvent.press(screen.getByText('Advance to final'));
    expect(onAdvance).toHaveBeenCalledWith(2);
    fireEvent.press(screen.getByText('Redraw semi finals'));
    expect(onAdvance).toHaveBeenCalledWith(4);
    fireEvent.press(screen.getByLabelText('Alpha FC wins this tie'));
    expect(onPickWinner).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }), 'a');
  });
});
