import { GOALKEEPER, isGoalkeeper, lineFor, matchPositions, POSITIONS, positionLabel, positionName } from '@/src/lib/positions';

describe('the position vocabulary', () => {
  it('matches the one the worker validates against', () => {
    // Kept in step by hand, the way FORMATIONS and LINEUP_FORMATS are. If this
    // fails, cloudflare-api/src/positions.ts has moved and this has not.
    expect(POSITIONS).toHaveLength(16);
    expect(POSITIONS.map((position) => position.code)).toEqual([
      'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LM', 'RM', 'LW', 'RW', 'SS', 'CF', 'ST',
    ]);
  });

  it('names a position, and falls back to whatever was stored', () => {
    expect(positionName('LWB')).toBe('Left wing-back');
    expect(positionName('XX')).toBe('XX');
    expect(positionName(null)).toBe('');
    expect(positionLabel('ST')).toBe('Striker (ST)');
  });

  it('puts a wing-back in defence, which the old free-text guess only managed by accident', () => {
    expect(lineFor('LWB')).toBe('DEF');
    expect(lineFor('LW')).toBe('FWD');
    expect(lineFor('XX')).toBe('MID');
  });

  it('recognises the keeper by her code alone', () => {
    expect(isGoalkeeper(GOALKEEPER)).toBe(true);
    expect(POSITIONS.filter((position) => isGoalkeeper(position.code))).toHaveLength(1);
    // Prose is no longer a position, so it is nobody.
    for (const value of ['Goalkeeper', 'gk', null, undefined, '']) expect(isGoalkeeper(value)).toBe(false);
  });
});

describe('matchPositions', () => {
  it('offers everything before anything is typed', () => {
    expect(matchPositions('')).toHaveLength(16);
    expect(matchPositions('   ')).toHaveLength(16);
  });

  it('narrows to the codes starting with the letter, which is the point of typing one', () => {
    expect(matchPositions('l').map((position) => position.code)).toEqual(['LB', 'LWB', 'LM', 'LW']);
  });

  it('puts a code match ahead of a name match', () => {
    // "CB", "CM", "CF" start with the letter; "Centre-back" and the rest only
    // contain a word that does.
    const codes = matchPositions('c').map((position) => position.code);
    expect(codes.slice(0, 3)).toEqual(['CB', 'CM', 'CF']);
  });

  it('finds a position by a word of its name', () => {
    expect(matchPositions('wing').map((position) => position.code)).toEqual(['LWB', 'RWB', 'LW', 'RW']);
    expect(matchPositions('strik').map((position) => position.code)).toEqual(['SS', 'ST']);
  });

  it('is case insensitive, and matches a whole code typed out', () => {
    expect(matchPositions('lwb').map((position) => position.code)).toEqual(['LWB']);
    expect(matchPositions('GK').map((position) => position.code)).toEqual(['GK']);
  });

  it('matches nothing rather than everything when there is no such position', () => {
    expect(matchPositions('zzz')).toEqual([]);
  });
});
