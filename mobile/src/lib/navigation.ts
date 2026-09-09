import type { UserRole } from '@/src/types/api';

/** A tab route, and whether it is drawn on the bar for this account. */
export type TabVisibility = { name: string; title: string; onBar: boolean };

/**
 * Which tabs each role gets.
 *
 * Kept apart from the layout that draws them because it is a rule rather than
 * a rendering: a manager gets three tabs, an administrator keeps the academy's
 * four, and a family loses Standings when their squad is in no competition.
 * Every route stays registered whatever the answer — a tab leaves the bar by
 * having no `href`, so a deep link to it still resolves.
 *
 * `hasCompetition` is whether the caller's own squads are entered in a league
 * or cup. The API scopes the competitions list to the caller, so this is a
 * fact about them rather than about the academy.
 */
export function tabsForRole(role: UserRole | undefined, hasCompetition: boolean): TabVisibility[] {
  const isAdmin = role === 'admin';
  // A manager runs one squad. They get their fixtures, their squad, and the
  // Manage screen held to it — no academy-wide browsing, and no Hub, which is
  // the screen for somebody being told things rather than deciding them.
  const isManager = role === 'manager';
  // An empty table is worse than no tab. An administrator keeps it either way:
  // they are the one who enters a squad in a competition, and would otherwise
  // have no way back to the screen after the last season closed.
  const standings = !isManager && (isAdmin || hasCompetition);
  return [
    { name: 'index', title: 'Matches', onBar: true },
    { name: 'standings', title: 'Standings', onBar: standings },
    { name: 'players', title: 'Players', onBar: !isManager },
    { name: 'squad', title: 'Team', onBar: isManager },
    { name: 'my-team', title: 'Hub', onBar: !isAdmin && !isManager },
    { name: 'manage', title: 'Manage', onBar: isAdmin || isManager },
    // Reached from the gear in every screen's header, never from the bar.
    { name: 'settings', title: 'Settings', onBar: false },
  ];
}
