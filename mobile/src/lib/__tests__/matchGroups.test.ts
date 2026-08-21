import { groupMatches } from '@/src/lib/matchGroups';
import type { Match } from '@/src/types/api';

function match(id: string, kickoff: string, competitionId: string, competitionName: string, status: Match['status']): Match {
  return {
    id, competition_id: competitionId, home_team_id: `${id}-home`, away_team_id: `${id}-away`,
    kickoff_datetime: kickoff, venue: 'AIMZ Arena', status, phase: status === 'finished' ? 'finished' : status === 'live' ? 'first_half' : 'not_started',
    phase_started_at: status === 'live' ? kickoff : null, home_score: 0, away_score: 0, revision: 0,
    lineup_format: null, formation: null, man_of_the_match_player_id: null,
    half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15, has_extra_time: false,
    extra_time_half_length_minutes: 15, created_at: kickoff, updated_at: kickoff,
    home_team: null, away_team: null,
    competition: { id: competitionId, name: competitionName, season: '2026/27', type: 'league', created_at: kickoff, updated_at: kickoff },
  };
}

describe('groupMatches', () => {
  const now = new Date(2026, 7, 20, 12);

  it('groups local calendar dates and competitions with counts', () => {
    const items = [
      match('1', new Date(2026, 7, 20, 9).toISOString(), 'league', 'Academy League', 'scheduled'),
      match('2', new Date(2026, 7, 20, 11).toISOString(), 'cup', 'AIMZ Cup', 'scheduled'),
      match('3', new Date(2026, 7, 20, 14).toISOString(), 'league', 'Academy League', 'scheduled'),
      match('4', new Date(2026, 7, 21, 10).toISOString(), 'cup', 'AIMZ Cup', 'scheduled'),
    ];
    const groups = groupMatches(items, 'scheduled', now);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ isToday: true, matchesCount: 3 });
    expect(groups[0]?.competitions.map((group) => [group.competitionName, group.matches.length])).toEqual([['Academy League', 2], ['AIMZ Cup', 1]]);
  });

  it('sorts upcoming ascending and results descending', () => {
    const early = match('early', new Date(2026, 7, 20, 9).toISOString(), 'league', 'League', 'scheduled');
    const late = match('late', new Date(2026, 7, 21, 9).toISOString(), 'league', 'League', 'scheduled');
    expect(groupMatches([late, early], 'scheduled', now).map((group) => group.matchesCount && group.dateKey)).toEqual([
      `${early.kickoff_datetime.slice(0, 10)}`,
      `${late.kickoff_datetime.slice(0, 10)}`,
    ]);
    expect(groupMatches([{ ...early, status: 'finished', phase: 'finished' }, { ...late, status: 'finished', phase: 'finished' }], 'finished', now).map((group) => group.dateKey)).toEqual([
      late.kickoff_datetime.slice(0, 10),
      early.kickoff_datetime.slice(0, 10),
    ]);
  });
});
