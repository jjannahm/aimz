import type { UserRole } from '@/src/types/api';

/** A tab route, and whether it is drawn on the dock for this account. */
export type TabVisibility = { name: string; title: string; onBar: boolean };

/**
 * Which tabs each role gets.
 *
 * Kept apart from the layout that draws them because it is a rule rather than
 * a rendering. Declaration order is dock order: Hub, Reports, My Team,
 * Matches — a family's own week first, then what has been written about them,
 * then their squad, then the academy's fixtures. An admin has neither of the
 * first two and reads My Team, Matches, Manage.
 *
 * A manager runs one squad, so they get three — their fixtures, their squad,
 * and the Manage screen held to it — and none of the academy-wide browsing.
 * The Hub is the screen for somebody being told things rather than deciding
 * them, so it is not one of the three.
 *
 * Every route is returned whatever the answer. A tab leaves the dock by having
 * no `href`, which keeps a deep link to it resolving.
 */
export function tabsForRole(role: UserRole | undefined): TabVisibility[] {
  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const isFamily = !isAdmin && !isManager;
  return [
    { name: 'my-team', title: 'Hub', onBar: isFamily },
    { name: 'reports', title: 'Reports', onBar: isFamily },
    // "My Team" rather than "Players": for a family it is their own squad they
    // are looking at, not a directory of the academy.
    { name: 'players', title: 'My Team', onBar: !isManager },
    { name: 'index', title: 'Matches', onBar: true },
    { name: 'squad', title: 'Team', onBar: isManager },
    { name: 'manage', title: 'Manage', onBar: isAdmin || isManager },
    // Reached from the gear in every screen's header, never from the dock.
    { name: 'settings', title: 'Settings', onBar: false },
  ];
}
