import type { Player, TrainingMetric } from '@/src/types/api';

/** One reading read out of a pasted sheet, ready to show back before sending. */
export interface ParsedReading {
  metric: TrainingMetric;
  value: number | null;
  problem: string | null;
}

/** One row of the sheet: a player, and what was recorded against them. */
export interface ParsedRow {
  line: number;
  name: string;
  player: Player | null;
  readings: ParsedReading[];
  problem: string | null;
}

export interface ParsedSheet {
  /** The metrics the header named, in the order the columns came in. */
  columns: TrainingMetric[];
  rows: ParsedRow[];
  /** What is wrong with the sheet as a whole, rather than with one row. */
  problem: string | null;
}

/**
 * Excel puts tabs between cells when you copy, and commas when you save as CSV.
 * A sheet arrives one way or the other and nobody should have to know which.
 */
const cellsOf = (line: string) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((cell) => cell.trim().replace(/^"|"$/gu, ''));

/** Loose enough to match a header a person typed: "Minutes trained" finds minutes_trained. */
const normalise = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/gu, '');

/**
 * Reads a pasted or uploaded sheet of training readings.
 *
 * The first row names the columns: a player column, then one column per metric.
 * Everything is checked here and shown back before anything is sent, because
 * the API takes the batch or none of it and a rejection afterwards tells an
 * administrator very little about which of thirty rows was wrong.
 *
 * A blank cell is not a zero. It means nothing was recorded for that player and
 * that metric, which for a mark out of ten is a different thing entirely.
 */
export function parseTrainingSheet(text: string, metrics: TrainingMetric[], squad: Player[]): ParsedSheet {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length < 2) {
    return { columns: [], rows: [], problem: 'Paste the heading row and at least one player.' };
  }

  const header = cellsOf(lines[0]!);
  const byName = new Map(metrics.flatMap((metric) => [[normalise(metric.label), metric], [normalise(metric.key), metric]] as const));
  // The first column is whoever the row is about; the rest name metrics.
  const columns: (TrainingMetric | null)[] = header.slice(1).map((cell) => byName.get(normalise(cell)) ?? null);
  const named = columns.filter((metric): metric is TrainingMetric => metric !== null);
  if (!named.length) {
    return { columns: [], rows: [], problem: `No column matched a metric. The headings are: ${metrics.map((metric) => metric.label).join(', ')}.` };
  }

  const players = new Map(squad.map((player) => [normalise(player.name), player]));
  const rows = lines.slice(1).map((line, index) => {
    const cells = cellsOf(line);
    const name = cells[0] ?? '';
    const player = players.get(normalise(name)) ?? null;
    const readings: ParsedReading[] = [];
    columns.forEach((metric, column) => {
      if (!metric) return;
      const raw = (cells[column + 1] ?? '').trim();
      if (!raw) return;
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        readings.push({ metric, value: null, problem: `${metric.label}: “${raw}” is not a number.` });
        return;
      }
      // The scale belongs to the metric, so a sheet is checked against whatever
      // the academy has decided it is rather than against a number in the app.
      if (metric.kind === 'rating') {
        const low = metric.min_value ?? 0;
        const high = metric.max_value ?? 10;
        if (value < low || value > high) {
          readings.push({ metric, value: null, problem: `${metric.label} is scored ${low} to ${high}.` });
          return;
        }
      } else if (value < 0) {
        readings.push({ metric, value: null, problem: `${metric.label} cannot be negative.` });
        return;
      }
      readings.push({ metric, value, problem: null });
    });

    const problem = !name ? 'Name the player this row is about.'
      : !player ? `“${name}” is not on this squad.`
        : readings.some((reading) => reading.problem) ? readings.find((reading) => reading.problem)!.problem
          : !readings.length ? 'Nothing was recorded on this row.'
            : null;
    return { line: index + 2, name, player, readings, problem };
  });

  return { columns: named, rows, problem: null };
}

/** The readings a sheet is ready to send, dropping the rows that are not. */
export function readyReadings(sheet: ParsedSheet): { player_id: string; metric_id: string; value: number }[] {
  return sheet.rows
    .filter((row) => !row.problem && row.player)
    .flatMap((row) => row.readings
      .filter((reading) => reading.value !== null)
      .map((reading) => ({ player_id: row.player!.id, metric_id: reading.metric.id, value: reading.value! })));
}

/** A heading row an administrator can copy into Excel to start from. */
export const sheetTemplate = (metrics: TrainingMetric[]) => ['Player', ...metrics.map((metric) => metric.label)].join(',');
