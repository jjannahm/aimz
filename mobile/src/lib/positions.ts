/**
 * Positions are free text, so a keeper is recognised rather than flagged.
 *
 * Matched the same way the worker matches it when it works out who conceded a
 * goal, so the app and the record agree on who was in goal.
 */
export function isGoalkeeper(position: string | null | undefined): boolean {
  const value = (position ?? '').trim().toLowerCase();
  return value.startsWith('goal') || value === 'gk';
}
