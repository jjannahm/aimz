import { acrossThePitch, byPosition, GOALKEEPER, isGoalkeeper, lineFor, matchPositions, POSITIONS, positionLabel, positionName } from '@/src/lib/positions';

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

describe('byPosition', () => {
  const player = (name: string, position: string | null) => ({ name, position });

  it('reads a squad the way a team sheet does, back to front', () => {
    const squad = [
      player('Striker', 'ST'), player('Keeper', 'GK'),
      player('Midfielder', 'CM'), player('Defender', 'CB'),
    ];
    expect(byPosition(squad).map((entry) => entry.name)).toEqual(['Keeper', 'Defender', 'Midfielder', 'Striker']);
  });

  it('sorts alphabetically within a line', () => {
    const squad = [player('Zara', 'CB'), player('Amira', 'LB'), player('Mona', 'RWB')];
    expect(byPosition(squad).map((entry) => entry.name)).toEqual(['Amira', 'Mona', 'Zara']);
  });

  // A wing-back is a defender because the vocabulary says so, not because of
  // where "wing" happens to fall in the name.
  it('places a wing-back with the defence and a wing with the attack', () => {
    const squad = [player('Winger', 'LW'), player('WingBack', 'LWB')];
    expect(byPosition(squad).map((entry) => entry.name)).toEqual(['WingBack', 'Winger']);
  });

  it('gives someone with no position the midfield, rather than dropping them', () => {
    const squad = [player('Striker', 'ST'), player('Unknown', null), player('Keeper', 'GK')];
    expect(byPosition(squad).map((entry) => entry.name)).toEqual(['Keeper', 'Unknown', 'Striker']);
  });

  it('leaves the list it was given alone', () => {
    const squad = [player('Striker', 'ST'), player('Keeper', 'GK')];
    byPosition(squad);
    expect(squad.map((entry) => entry.name)).toEqual(['Striker', 'Keeper']);
  });
});

describe('acrossThePitch', () => {
  const player = (name: string, position: string) => ({ name, position });

  it('stands a line left, centre, then right', () => {
    const defence = [player('Righty', 'RB'), player('Centre', 'CB'), player('Lefty', 'LB')];
    expect(acrossThePitch(defence).map((entry) => entry.name)).toEqual(['Lefty', 'Centre', 'Righty']);
  });

  // A wing-back is the same flank as the full-back it plays instead of.
  it('puts a wing-back on the side its name gives it', () => {
    const defence = [player('Right', 'RWB'), player('Left', 'LWB')];
    expect(acrossThePitch(defence).map((entry) => entry.name)).toEqual(['Left', 'Right']);
  });

  it('spreads a forward line by its wings', () => {
    const attack = [player('RightWing', 'RW'), player('Striker', 'ST'), player('LeftWing', 'LW')];
    expect(acrossThePitch(attack).map((entry) => entry.name)).toEqual(['LeftWing', 'Striker', 'RightWing']);
  });

  // Depth is the row's business, not the order across it, so these are all
  // central and stay in a settled order.
  it('keeps the central midfield in a stable order', () => {
    const midfield = [player('Zara', 'AM'), player('Amira', 'DM'), player('Mona', 'CM')];
    expect(acrossThePitch(midfield).map((entry) => entry.name)).toEqual(['Amira', 'Mona', 'Zara']);
  });

  it('treats an unknown position as central rather than dropping it', () => {
    const row = [player('Right', 'RM'), player('Mystery', 'ZZ'), player('Left', 'LM')];
    expect(acrossThePitch(row).map((entry) => entry.name)).toEqual(['Left', 'Mystery', 'Right']);
  });
});
