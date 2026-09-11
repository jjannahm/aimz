/**
 * How long the match itself ran, in playing minutes.
 *
 * The half-time break is wall-clock rather than football: a minute is recorded
 * against the clock the events are stamped with, and that clock does not run
 * through the interval. Extra time counts, because a player on the pitch for it
 * was playing.
 */
export function playedMinutes(match: { half_length_minutes: number; num_halves: number; has_extra_time: number | boolean; extra_time_half_length_minutes: number }): number {
  const regulation = match.half_length_minutes * match.num_halves;
  return regulation + (match.has_extra_time ? 2 * match.extra_time_half_length_minutes : 0);
}

/**
 * What each named player actually played, worked out from the team sheet and
 * the thread of events rather than typed in.
 *
 * A starter plays until she is taken off, sent off, or the match ends. A
 * substitute plays from the minute she comes on to the same three endings, and
 * a substitute who never came on played nothing — which is a nought worth
 * printing, not a blank.
 *
 * A minute nobody recorded is the one thing this cannot work out: an event
 * stamped with no minute is left out of the arithmetic rather than guessed at,
 * so a sheet scored without a clock still gives a starter the full match.
 */
export function minutesFromEvents(
  entries: { player_id: string; is_starter: number | boolean }[],
  events: { type: string; minute: number | null; player_id: string | null; secondary_player_id: string | null }[],
  full: number,
): Map<string, number> {
  const cameOn = new Map<string, number>();
  const wentOff = new Map<string, number>();
  for (const event of events) {
    if (event.minute === null) continue;
    if (event.type === "substitution") {
      if (event.player_id && !cameOn.has(event.player_id)) cameOn.set(event.player_id, event.minute);
      if (event.secondary_player_id && !wentOff.has(event.secondary_player_id)) wentOff.set(event.secondary_player_id, event.minute);
    }
    // Sent off is off: her match ends there whether or not anybody replaced her.
    if (event.type === "red_card" && event.player_id && !wentOff.has(event.player_id)) wentOff.set(event.player_id, event.minute);
  }

  const minutes = new Map<string, number>();
  for (const entry of entries) {
    const on = entry.is_starter ? 0 : cameOn.get(entry.player_id);
    // Named, never used.
    if (on === undefined) { minutes.set(entry.player_id, 0); continue; }
    const off = wentOff.get(entry.player_id) ?? full;
    // A correction can leave a player recorded off before she came on; nobody
    // plays a negative number of minutes.
    minutes.set(entry.player_id, Math.max(0, Math.min(off, full) - on));
  }
  return minutes;
}
