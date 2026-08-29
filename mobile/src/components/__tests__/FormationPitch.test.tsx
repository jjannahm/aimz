import { fireEvent, render } from '@testing-library/react-native';

import { arrangeByFormation, bucketFor, FormationPitch, inferFormation } from '@/src/components/FormationPitch';
import { FORMATIONS, LINEUP_FORMATS, formationRows, outfieldCount, type Player } from '@/src/types/api';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const player = (id: string, name: string, position: string, jersey: number): Player => ({
  id, name, position, jersey_number: jersey, team_id: 't', photo_key: null, photo_url: null,
  is_active: true, created_at: '', updated_at: '',
});

describe('formation catalogue', () => {
  it('only offers shapes that fit the format', () => {
    for (const format of LINEUP_FORMATS) {
      for (const shape of FORMATIONS[format]) {
        const total = formationRows(shape).reduce((sum, count) => sum + count, 0);
        expect(total).toBe(outfieldCount(format));
      }
    }
  });

  it('never offers an eleven-a-side shape to a seven-a-side match', () => {
    expect(FORMATIONS[7]).not.toContain('4-4-2');
    expect(FORMATIONS[11]).toContain('4-4-2');
  });
});

describe('bucketFor', () => {
  it('puts every position in the vocabulary on its own line', () => {
    expect(bucketFor('GK')).toBe('GK');
    expect(bucketFor('CB')).toBe('DEF');
    expect(bucketFor('RB')).toBe('DEF');
    expect(bucketFor('CM')).toBe('MID');
    expect(bucketFor('ST')).toBe('FWD');
    expect(bucketFor('LW')).toBe('FWD');
  });

  // The old free-text heuristic tested "back" before "wing", so a wing-back
  // landed in defence by luck of clause ordering. Now it is looked up.
  it('puts a wing-back in defence and a winger up front', () => {
    expect(bucketFor('LWB')).toBe('DEF');
    expect(bucketFor('RWB')).toBe('DEF');
    expect(bucketFor('RW')).toBe('FWD');
  });

  it('treats anything unrecognised as midfield rather than dropping the player', () => {
    expect(bucketFor('Utility')).toBe('MID');
  });
});

describe('arrangeByFormation', () => {
  const squad = [
    player('gk', 'Nour Hassan', 'GK', 1),
    ...Array.from({ length: 3 }, (_, i) => player(`d${i}`, `Def ${i}`, 'CB', 2 + i)),
    ...Array.from({ length: 2 }, (_, i) => player(`m${i}`, `Mid ${i}`, 'CM', 5 + i)),
    player('f0', 'Fwd 0', 'ST', 7),
  ];

  it('fills each row with the count the formation asks for', () => {
    const { keeper, rows } = arrangeByFormation(squad, '3-2-1');
    expect(keeper).toHaveLength(1);
    expect(rows.map((row) => row.length)).toEqual([3, 2, 1]);
  });

  it('puts defenders nearest the keeper and forwards furthest', () => {
    const { rows } = arrangeByFormation(squad, '3-2-1');
    expect(rows[0]!.every((p) => p.position === 'CB')).toBe(true);
    expect(rows[2]![0]!.position).toBe('ST');
  });

  it('places every starter, even when positions do not match the shape', () => {
    // A squad with no forwards still has to field a 3-2-1.
    const lopsided = [
      player('gk', 'Keeper', 'GK', 1),
      ...Array.from({ length: 6 }, (_, i) => player(`d${i}`, `Def ${i}`, 'CB', 2 + i)),
    ];
    const { keeper, rows } = arrangeByFormation(lopsided, '3-2-1');
    const placed = keeper.length + rows.flat().length;
    expect(placed).toBe(lopsided.length);
  });
});

describe('FormationPitch', () => {
  it('shows the formation label and a shirt per starter', async () => {
    const squad = [
      player('gk', 'Nour Hassan', 'GK', 1),
      player('d0', 'Salma Nabil', 'CB', 2),
      player('m0', 'Mariam Adel', 'CM', 6),
    ];
    const screen = await render(<FormationPitch formation="1-1" starters={squad} />);
    expect(screen.getByText('1-1')).toBeTruthy();
    // First names, since that is how the squad is called out on the touchline.
    expect(screen.getByText('Nour')).toBeTruthy();
    expect(screen.getByText('Salma')).toBeTruthy();
    expect(screen.queryByText('Hassan')).toBeNull();
  });
});

describe('inferFormation', () => {
  const squad = [
    player('gk', 'Keeper', 'GK', 1),
    ...Array.from({ length: 3 }, (_, i) => player(`d${i}`, `Def ${i}`, 'CB', 2 + i)),
    ...Array.from({ length: 2 }, (_, i) => player(`m${i}`, `Mid ${i}`, 'CM', 5 + i)),
    player('f0', 'Fwd', 'ST', 7),
  ];

  it('reads the shape the squad is already playing', () => {
    expect(inferFormation(squad)).toBe('3-2-1');
  });

  it('skips empty rows rather than emitting a zero', () => {
    const noMids = squad.filter((p) => !p.id.startsWith('m'));
    expect(inferFormation(noMids)).toBe('3-1');
  });

  it('returns null when there is nobody outfield', () => {
    expect(inferFormation([player('gk', 'Keeper', 'GK', 1)])).toBeNull();
  });
});

describe('FormationPitch without a stored formation', () => {
  it('still draws, marking the shape as inferred', async () => {
    const squad = [
      player('gk', 'Nour Hassan', 'GK', 1),
      player('d0', 'Salma Nabil', 'CB', 2),
      player('f0', 'Mariam Adel', 'ST', 9),
    ];
    const screen = await render(<FormationPitch formation={null} starters={squad} />);
    expect(screen.getByText(/1-1/u)).toBeTruthy();
    expect(screen.getByText(/from positions/u)).toBeTruthy();
  });
});

describe('captain armband', () => {
  const squad = [
    player('gk', 'Nour Hassan', 'GK', 1),
    player('d0', 'Salma Nabil', 'CB', 2),
    player('f0', 'Mariam Adel', 'ST', 9),
  ];

  it('marks only the captain', async () => {
    const screen = await render(<FormationPitch captainId="d0" formation="1-1" starters={squad} />);
    expect(screen.getByLabelText('Salma Nabil, captain')).toBeTruthy();
    expect(screen.queryByLabelText('Nour Hassan, captain')).toBeNull();
  });

  it('shows no armband when nobody is named', async () => {
    const screen = await render(<FormationPitch captainId={null} formation="1-1" starters={squad} />);
    expect(screen.queryByText('C')).toBeNull();
  });
});


describe('FormationPitch shirts as buttons', () => {
  const squad = [player('gk', 'Jana Kamal', 'GK', 1), player('d0', 'Aya Nabil', 'CB', 6)];

  it('opens the player a shirt belongs to', async () => {
    const onSelect = jest.fn();
    const screen = await render(<FormationPitch formation="1-1" onSelect={onSelect} starters={squad} />);
    fireEvent.press(screen.getByLabelText('Aya Nabil, open stats'));

    expect(onSelect).toHaveBeenCalledWith('d0');
  });

  // The keeper is placed separately from the outfield rows, so prove it too.
  it('opens the keeper as readily as an outfielder', async () => {
    const onSelect = jest.fn();
    const screen = await render(<FormationPitch formation="1-1" onSelect={onSelect} starters={squad} />);
    fireEvent.press(screen.getByLabelText('Jana Kamal, open stats'));

    expect(onSelect).toHaveBeenCalledWith('gk');
  });

  it('leaves shirts as plain shirts where there is nowhere to go', async () => {
    const screen = await render(<FormationPitch formation="1-1" starters={squad} />);
    expect(screen.queryByLabelText('Aya Nabil, open stats')).toBeNull();
  });
});
