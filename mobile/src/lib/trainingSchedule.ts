import { fromEgyptWallClock, toEgyptWallClock, type WallClock } from '@/src/lib/egyptTime';
import type { TrainingSession } from '@/src/types/api';

type CalendarDate = Pick<WallClock, 'year' | 'month' | 'day'>;
type WeeklyInput = { weekdays: number[]; wallClock: WallClock; endsOn?: CalendarDate | null };

const calendar = (date: CalendarDate) => Date.UTC(date.year, date.month - 1, date.day);
const fromCalendar = (value: number): CalendarDate => { const date = new Date(value); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }; };
const dayKey = ({ year, month, day }: CalendarDate) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function expandWeekly({ weekdays, wallClock, endsOn }: WeeklyInput): string[] {
  const selected = new Set(weekdays);
  if (!selected.size || [...selected].some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return [];
  const start = calendar(wallClock);
  const end = endsOn ? calendar(endsOn) : start + (26 * 7 - 1) * 86_400_000;
  if (end < start) return [];
  const output: string[] = [];
  for (let cursor = start; cursor <= end && output.length < 200; cursor += 86_400_000) {
    const date = new Date(cursor);
    if (!selected.has(date.getUTCDay())) continue;
    const day = fromCalendar(cursor);
    output.push(fromEgyptWallClock({ ...day, hour: wallClock.hour, minute: wallClock.minute }).toISOString());
  }
  return output;
}

export type TrainingDateGroup = { dateKey: string; date: Date; isToday: boolean; sessions: TrainingSession[] };

export function groupSessionsByDate(sessions: TrainingSession[], now = new Date()): TrainingDateGroup[] {
  const today = dayKey(toEgyptWallClock(now));
  const groups = new Map<string, TrainingSession[]>();
  for (const session of [...sessions].sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at))) {
    const key = dayKey(toEgyptWallClock(new Date(session.starts_at)));
    groups.set(key, [...groups.get(key) ?? [], session]);
  }
  return [...groups.entries()].map(([dateKey, rows]) => ({ dateKey, date: new Date(rows[0]!.starts_at), isToday: dateKey === today, sessions: rows }));
}
