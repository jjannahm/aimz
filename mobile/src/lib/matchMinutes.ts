import type { LineupEntry, MatchEvent } from '@/src/types/api';

/**
 * A substitution records the player arriving in `player_id` and the player
 * leaving in `secondary_player_id`. Both are needed: without the outgoing
 * player there is no way to know when their match ended.
 */
export type PlayerMinutes = { playerId: string; minutes: number; onAt: number; offAt: number | null; started: boolean };

/**
 * Work out how long each player was on the pitch.
 *
 * Starters are on from the first minute. A player brought on starts at the
 * minute of their substitution, and one taken off stops there. Anyone still on
 * when the clock is read is credited up to that point, so the figure keeps up
 * with a running match instead of waiting for full time.
 */
export function computeMinutesPlayed(
  lineup: Pick<LineupEntry, 'player_id' | 'is_starter'>[],
  events: Pick<MatchEvent, 'type' | 'minute' | 'player_id' | 'secondary_player_id'>[],
  elapsedMinutes: number,
): PlayerMinutes[] {
  const clock = Math.max(0, Math.round(elapsedMinutes));
  const state = new Map<string, { onAt: number | null; offAt: number | null; started: boolean }>();

  for (const entry of lineup) {
    state.set(entry.player_id, { onAt: entry.is_starter ? 0 : null, offAt: null, started: entry.is_starter });
  }

  const subs = events
    .filter((event) => event.type === 'substitution')
    .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0));

  for (const sub of subs) {
    const minute = Math.min(Math.max(0, sub.minute ?? clock), clock);
    if (sub.player_id) {
      const arriving = state.get(sub.player_id) ?? { onAt: null, offAt: null, started: false };
      // Only the first arrival counts; a player cannot come on twice.
      if (arriving.onAt === null) arriving.onAt = minute;
      state.set(sub.player_id, arriving);
    }
    if (sub.secondary_player_id) {
      const leaving = state.get(sub.secondary_player_id) ?? { onAt: 0, offAt: null, started: true };
      if (leaving.offAt === null) leaving.offAt = minute;
      state.set(sub.secondary_player_id, leaving);
    }
  }

  return [...state.entries()]
    .filter(([, value]) => value.onAt !== null)
    .map(([playerId, value]) => {
      const onAt = value.onAt ?? 0;
      const offAt = value.offAt;
      return {
        playerId,
        onAt,
        offAt,
        started: value.started,
        minutes: Math.max(0, (offAt ?? clock) - onAt),
      };
    });
}

/** "60'" for someone still on, "0–60'" for someone taken off. */
export function describeSpell(spell: PlayerMinutes): string {
  if (spell.offAt === null) return `${spell.minutes}'`;
  return `${spell.minutes}' (${spell.onAt}–${spell.offAt}')`;
}
