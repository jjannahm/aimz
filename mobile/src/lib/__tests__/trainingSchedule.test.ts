import { toEgyptWallClock } from '@/src/lib/egyptTime';
import { expandWeekly, groupSessionsByDate } from '@/src/lib/trainingSchedule';
import type { TrainingSession } from '@/src/types/api';

describe('training schedule recurrence', () => {
  it('preserves Egypt wall-clock time through the daylight-saving boundary', () => {
    const occurrences = expandWeekly({
      weekdays: [2],
      wallClock: { year: 2026, month: 4, day: 21, hour: 18, minute: 30 },
      endsOn: { year: 2026, month: 5, day: 5 },
    });
    expect(occurrences).toEqual([
      '2026-04-21T16:30:00.000Z',
      '2026-04-28T15:30:00.000Z',
      '2026-05-05T15:30:00.000Z',
    ]);
    expect(occurrences.map((iso) => toEgyptWallClock(new Date(iso)).hour)).toEqual([18, 18, 18]);
  });

  it('defaults a blank end date to 26 weeks', () => {
    const occurrences = expandWeekly({ weekdays: [0], wallClock: { year: 2026, month: 8, day: 23, hour: 9, minute: 0 } });
    expect(occurrences).toHaveLength(26);
  });

  it('orders multiple weekdays and includes the end date', () => {
    const occurrences = expandWeekly({
      weekdays: [4, 2],
      wallClock: { year: 2026, month: 8, day: 25, hour: 17, minute: 0 },
      endsOn: { year: 2026, month: 9, day: 3 },
    });
    expect(occurrences.map((iso) => {
      const wall = toEgyptWallClock(new Date(iso));
      return `${wall.month}-${wall.day}`;
    })).toEqual(['8-25', '8-27', '9-1', '9-3']);
  });

  it('groups sessions by their Egypt calendar date', () => {
    const session = (id: string, starts_at: string) => ({ id, starts_at } as TrainingSession);
    const groups = groupSessionsByDate([
      session('after-midnight', '2026-08-24T22:30:00.000Z'),
      session('evening', '2026-08-24T18:00:00.000Z'),
    ], new Date('2026-08-24T22:00:00.000Z'));
    expect(groups.map((group) => group.dateKey)).toEqual(['2026-08-24', '2026-08-25']);
    expect(groups[1]?.isToday).toBe(true);
  });
});
