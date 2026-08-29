import { parseSquad } from '@/src/components/manage/BulkPlayerImport';

describe('parseSquad', () => {
  it('reads a pasted squad, one player per line', () => {
    expect(parseSquad('Nour Hassan, ST, 9\nSalma Adel, GK, 1')).toEqual([
      { line: 1, name: 'Nour Hassan', position: 'ST', jersey: 9, problem: null },
      { line: 2, name: 'Salma Adel', position: 'GK', jersey: 1, problem: null },
    ]);
  });

  it('takes a position in any case, and a number with or without a hash', () => {
    const [first, second] = parseSquad('Habiba Tarek, lwb, #3\nMalak Omar, Cb, 4');
    expect(first).toMatchObject({ position: 'LWB', jersey: 3, problem: null });
    expect(second).toMatchObject({ position: 'CB', jersey: 4, problem: null });
  });

  it('makes the number optional', () => {
    expect(parseSquad('Farida Sami, CM')).toEqual([
      { line: 1, name: 'Farida Sami', position: 'CM', jersey: null, problem: null },
    ]);
  });

  it('drops blank lines rather than complaining about them', () => {
    expect(parseSquad('Nour Hassan, ST, 9\n\n   \nSalma Adel, GK, 1')).toHaveLength(2);
  });

  it('keeps the line number so a problem points at the row that caused it', () => {
    const rows = parseSquad('Nour Hassan, ST, 9\nYara Nabil, Goalkeeper, 1');
    expect(rows[1]).toMatchObject({ line: 2, problem: '“Goalkeeper” is not a position.' });
  });

  it('refuses prose where a position code belongs', () => {
    expect(parseSquad('Yara Nabil, Striker')[0]!.problem).toBe('“Striker” is not a position.');
    expect(parseSquad('Yara Nabil, ')[0]!.problem).toBe('Name a position, for example ST.');
  });

  it('wants a real name', () => {
    expect(parseSquad('N, ST, 9')[0]!.problem).toBe('Give the player a name.');
  });

  it('holds a number to 0 through 99', () => {
    expect(parseSquad('Nour Hassan, ST, 100')[0]!.problem).toBe('A number is 0 to 99.');
    expect(parseSquad('Nour Hassan, ST, -1')[0]!.problem).toBe('A number is 0 to 99.');
    expect(parseSquad('Nour Hassan, ST, nine')[0]!.problem).toBe('A number is 0 to 99.');
    expect(parseSquad('Nour Hassan, GK, 0')[0]!.problem).toBeNull();
  });

  // The API refuses a clash against the squad already saved, but two identical
  // numbers inside one paste would only surface after the whole batch bounced.
  it('catches a number used twice in the same paste', () => {
    const rows = parseSquad('Nour Hassan, ST, 9\nSalma Adel, GK, 9');
    expect(rows[0]!.problem).toBeNull();
    expect(rows[1]!.problem).toBe('Number 9 is used twice here.');
  });

  it('lets two players go unnumbered', () => {
    const rows = parseSquad('Nour Hassan, ST\nSalma Adel, GK');
    expect(rows.every((row) => row.problem === null)).toBe(true);
  });
});
