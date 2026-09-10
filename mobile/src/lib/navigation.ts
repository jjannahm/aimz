import type { UserRole } from '@/src/types/api';

/** A tab route, and whether it is drawn on the dock for this account. */
export type TabVisibility = { name: string; title: string; onBar: boolean };

/**
 * Which tabs each role gets.
 *
 * Kept apart from the layout that draws them because it is a rule rather than
 * a rendering. Declaration order is dock order, and it is read from the right:
 * a family's Hub sits at the thumb end, then Reports, then My Team, with the
 * academy's fixtures furthest away. Written out left to right that is
 * Matches, My Team, Reports, Hub.
 *
 * An administrator reads Manage, Teams, Matches. Two differences, both because
 * the screen is a different screen for them: the squads come before the
 * fixtures, since running the academy starts with who is in it; and it is
 * called Teams rather than My Team, because none of them is theirs.
 *
 * A coach runs one squad, so they get three — their fixtures, their squad,
 * and the Manage screen held to it — and none of the academy-wide browsing.
 * The Hub is the screen for somebody being told things rather than deciding
 * them, so it is not one of the three.
 *
 * Every route is returned whatever the answer. A tab leaves the dock by having
 * no `href`, which keeps a deep link to it resolving.
 */
/** The academy's fixtures, which everybody has. */
const fixtures: TabVisibility = { name: 'index', title: 'Matches', onBar: true };

/** The squads, named for whoever is reading them. */
const squads = (isAdmin: boolean, isCoach = false): TabVisibility => ({
  name: 'players',
  title: isAdmin ? 'Teams' : 'My Team',
  onBar: !isCoach,
});

export function tabsForRole(role: UserRole | undefined): TabVisibility[] {
  const isAdmin = role === 'admin';
  const isCoach = role === 'coach';
  const isFamily = !isAdmin && !isCoach;
  return [
    { name: 'manage', title: 'Manage', onBar: isAdmin || isCoach },
    { name: 'squad', title: 'Team', onBar: isCoach },
    // "My Team" for a family — it is their own squad they are looking at, not
    // a directory — and "Teams" for an administrator, to whom it is exactly
    // that. The two also sit either side of the fixtures depending on which of
    // them is reading.
    ...(isAdmin
      ? [squads(isAdmin, isCoach), fixtures]
      : [fixtures, squads(isAdmin, isCoach)]),
    { name: 'reports', title: 'Reports', onBar: isFamily },
    { name: 'my-team', title: 'Hub', onBar: isFamily },
    // Reached from the gear in every screen's header, never from the dock.
    { name: 'settings', title: 'Settings', onBar: false },
  ];
}
