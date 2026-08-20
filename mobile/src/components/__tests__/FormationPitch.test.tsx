import { render } from '@testing-library/react-native';

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
  it('reads the free-text positions the roster actually uses', () => {
    expect(bucketFor('Goalkeeper')).toBe('GK');
    expect(bucketFor('Defender')).toBe('DEF');
    expect(bucketFor('Right Back')).toBe('DEF');
    expect(bucketFor('Midfielder')).toBe('MID');
    expect(bucketFor('Forward')).toBe('FWD');
    expect(bucketFor('Winger')).toBe('FWD');
  });

  it('treats anything unrecognised as midfield rather than dropping the player', () => {
    expect(bucketFor('Utility')).toBe('MID');
  });
});

describe('arrangeByFormation', () => {
  const squad = [
    player('gk', 'Nour Hassan', 'Goalkeeper', 1),
    ...Array.from({ length: 3 }, (_, i) => player(`d${i}`, `Def ${i}`, 'Defender', 2 + i)),
    ...Array.from({ length: 2 }, (_, i) => player(`m${i}`, `Mid ${i}`, 'Midfielder', 5 + i)),
    player('f0', 'Fwd 0', 'Forward', 7),
  ];

  it('fills each row with the count the formation asks for', () => {
    const { keeper, rows } = arrangeByFormation(squad, '3-2-1');
    expect(keeper).toHaveLength(1);
    expect(rows.map((row) => row.length)).toEqual([3, 2, 1]);
  });

  it('puts defenders nearest the keeper and forwards furthest', () => {
    const { rows } = arrangeByFormation(squad, '3-2-1');
    expect(rows[0]!.every((p) => p.position === 'Defender')).toBe(true);
    expect(rows[2]![0]!.position).toBe('Forward');
  });

  it('places every starter, even when positions do not match the shape', () => {
    // A squad with no forwards still has to field a 3-2-1.
    const lopsided = [
      player('gk', 'Keeper', 'Goalkeeper', 1),
      ...Array.from({ length: 6 }, (_, i) => player(`d${i}`, `Def ${i}`, 'Defender', 2 + i)),
    ];
    const { keeper, rows } = arrangeByFormation(lopsided, '3-2-1');
    const placed = keeper.length + rows.flat().length;
    expect(placed).toBe(lopsided.length);
  });
});

describe('FormationPitch', () => {
  it('shows the formation label and a shirt per starter', async () => {
    const squad = [
      player('gk', 'Nour Hassan', 'Goalkeeper', 1),
      player('d0', 'Salma Nabil', 'Defender', 2),
      player('m0', 'Mariam Adel', 'Midfielder', 6),
    ];
    const screen = await render(<FormationPitch formation="1-1" starters={squad} />);
    expect(screen.getByText('1-1')).toBeTruthy();
    // Surnames keep the pitch readable at small sizes.
    expect(screen.getByText('Hassan')).toBeTruthy();
    expect(screen.getByText('Nabil')).toBeTruthy();
  });
});

describe('inferFormation', () => {
  const squad = [
    player('gk', 'Keeper', 'Goalkeeper', 1),
    ...Array.from({ length: 3 }, (_, i) => player(`d${i}`, `Def ${i}`, 'Defender', 2 + i)),
    ...Array.from({ length: 2 }, (_, i) => player(`m${i}`, `Mid ${i}`, 'Midfielder', 5 + i)),
    player('f0', 'Fwd', 'Forward', 7),
  ];

  it('reads the shape the squad is already playing', () => {
    expect(inferFormation(squad)).toBe('3-2-1');
  });

  it('skips empty rows rather than emitting a zero', () => {
    const noMids = squad.filter((p) => !p.id.startsWith('m'));
    expect(inferFormation(noMids)).toBe('3-1');
  });

  it('returns null when there is nobody outfield', () => {
    expect(inferFormation([player('gk', 'Keeper', 'Goalkeeper', 1)])).toBeNull();
  });
});

describe('FormationPitch without a stored formation', () => {
  it('still draws, marking the shape as inferred', async () => {
    const squad = [
      player('gk', 'Nour Hassan', 'Goalkeeper', 1),
      player('d0', 'Salma Nabil', 'Defender', 2),
      player('f0', 'Mariam Adel', 'Forward', 9),
    ];
    const screen = await render(<FormationPitch formation={null} starters={squad} />);
    expect(screen.getByText(/1-1/u)).toBeTruthy();
    expect(screen.getByText(/from positions/u)).toBeTruthy();
  });
});
