import { parseTrainingSheet, readyReadings, sheetTemplate } from '@/src/lib/trainingImport';
import type { Player, TrainingMetric } from '@/src/types/api';

const metric = (id: string, key: string, label: string, over: Partial<TrainingMetric> = {}): TrainingMetric => ({
  id, key, label, kind: 'rating', min_value: 1, max_value: 10, unit: null, sort_order: 0, is_active: true, ...over,
});

const metrics = [
  metric('m-min', 'minutes_trained', 'Minutes trained', { kind: 'count', min_value: null, max_value: null, unit: 'minutes' }),
  metric('m-dri', 'dribbling', 'Dribbling'),
  metric('m-sho', 'shooting', 'Shooting'),
];

const squad = [{ id: 'p-1', name: 'Amina Adel' }, { id: 'p-2', name: 'Nour Hassan' }] as Player[];

const parse = (text: string) => parseTrainingSheet(text, metrics, squad);

describe('parseTrainingSheet', () => {
  it('reads a sheet saved from Excel as CSV', () => {
    const sheet = parse('Player,Minutes trained,Dribbling,Shooting\nAmina Adel,90,7,6\nNour Hassan,75,8,9');
    expect(sheet.problem).toBeNull();
    expect(sheet.columns.map((column) => column.key)).toEqual(['minutes_trained', 'dribbling', 'shooting']);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toMatchObject({ name: 'Amina Adel', problem: null });
    expect(readyReadings(sheet)).toHaveLength(6);
  });

  // Copying cells out of Excel gives tabs, saving gives commas. Nobody should
  // have to know which they did.
  it('reads the same sheet pasted straight out of the cells', () => {
    const sheet = parse('Player\tMinutes trained\tDribbling\nAmina Adel\t90\t7');
    expect(sheet.problem).toBeNull();
    expect(readyReadings(sheet)).toEqual([
      { player_id: 'p-1', metric_id: 'm-min', value: 90 },
      { player_id: 'p-1', metric_id: 'm-dri', value: 7 },
    ]);
  });

  it('matches a heading however it was typed', () => {
    const sheet = parse('Name,minutes_trained,DRIBBLING\nAmina Adel,60,5');
    expect(sheet.columns.map((column) => column.key)).toEqual(['minutes_trained', 'dribbling']);
  });

  it('ignores a column it does not recognise rather than refusing the sheet', () => {
    const sheet = parse('Player,Dribbling,Mood\nAmina Adel,7,happy');
    expect(sheet.columns.map((column) => column.key)).toEqual(['dribbling']);
    expect(sheet.rows[0]?.problem).toBeNull();
    expect(readyReadings(sheet)).toEqual([{ player_id: 'p-1', metric_id: 'm-dri', value: 7 }]);
  });

  // A blank is not a nought: for a mark out of ten those are different things.
  it('leaves an empty cell unrecorded rather than reading it as zero', () => {
    const sheet = parse('Player,Minutes trained,Dribbling\nAmina Adel,90,');
    expect(readyReadings(sheet)).toEqual([{ player_id: 'p-1', metric_id: 'm-min', value: 90 }]);
  });

  it('names the player it cannot find, rather than dropping the row silently', () => {
    const sheet = parse('Player,Dribbling\nSomebody Else,7');
    expect(sheet.rows[0]?.problem).toBe('“Somebody Else” is not on this squad.');
    expect(readyReadings(sheet)).toEqual([]);
  });

  it('checks a mark against the scale the metric carries', () => {
    const sheet = parse('Player,Dribbling\nAmina Adel,11');
    expect(sheet.rows[0]?.problem).toBe('Dribbling is scored 1 to 10.');
  });

  it('lets a count be anything but negative', () => {
    expect(parse('Player,Minutes trained\nAmina Adel,240').rows[0]?.problem).toBeNull();
    expect(parse('Player,Minutes trained\nAmina Adel,-5').rows[0]?.problem).toBe('Minutes trained cannot be negative.');
  });

  it('says which cell is not a number', () => {
    expect(parse('Player,Dribbling\nAmina Adel,good').rows[0]?.problem).toBe('Dribbling: “good” is not a number.');
  });

  it('refuses a sheet with no heading row to read', () => {
    expect(parse('Amina Adel,90,7').problem).toBe('Paste the heading row and at least one player.');
  });

  it('says so when no column names a metric at all', () => {
    const sheet = parse('Player,Mood,Weather\nAmina Adel,7,8');
    expect(sheet.problem).toContain('No column matched a metric');
    expect(sheet.problem).toContain('Dribbling');
  });

  it('keeps the good rows when one is wrong', () => {
    const sheet = parse('Player,Dribbling\nAmina Adel,7\nSomebody Else,8\nNour Hassan,9');
    expect(sheet.rows.filter((row) => row.problem)).toHaveLength(1);
    expect(readyReadings(sheet)).toEqual([
      { player_id: 'p-1', metric_id: 'm-dri', value: 7 },
      { player_id: 'p-2', metric_id: 'm-dri', value: 9 },
    ]);
  });

  it('numbers the rows the way the sheet does, counting the heading', () => {
    const sheet = parse('Player,Dribbling\nAmina Adel,7\nNour Hassan,8');
    expect(sheet.rows.map((row) => row.line)).toEqual([2, 3]);
  });
});

describe('sheetTemplate', () => {
  it('gives the headings to start a sheet from', () => {
    expect(sheetTemplate(metrics)).toBe('Player,Minutes trained,Dribbling,Shooting');
  });
});
