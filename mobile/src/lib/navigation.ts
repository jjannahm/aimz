import type { UserRole } from '@/src/types/api';

/** A tab route, and whether it is drawn on the dock for this account. */
export type TabVisibility = { name: string; title: string; onBar: boolean };

/** Every tab route there is, with the wording that does not depend on who reads it. */
const ROUTES: Record<string, string> = {
  index: 'Matches',
  players: 'My Team',
  squad: 'My Team',
  reports: 'Reports',
  'my-team': 'Hub',
  manage: 'Manage',
  settings: 'Settings',
};

/**
 * The dock each role is given, in the order it is drawn.
 *
 * Written out per role rather than as one list with conditions threaded
 * through it: the three orders genuinely differ, and a shared list with
 * exceptions in it was harder to read than three short lists.
 *
 *     admin   Matches · Teams · Manage — the academy, left to right
 *     coach   Matches · My Team · Manage — the one squad they run
 *     family  Matches · My Team · Reports · Hub — read from the thumb end, so
 *             their own week sits nearest the hand
 *
 * Every other route is still returned, off the dock, so a deep link to it
 * resolves whoever is signed in. Settings is on nobody's dock: it is the gear
 * in each screen's header.
 */
const DOCK: Record<'admin' | 'coach' | 'family', string[]> = {
  admin: ['index', 'players', 'manage'],
  coach: ['index', 'squad', 'manage'],
  family: ['index', 'players', 'reports', 'my-team'],
};

/**
 * The squads tab is named for whoever is reading it: "My Team" for a family,
 * because it is their own squad and not a directory, and "Teams" for an
 * administrator, to whom it is exactly that.
 */
const titleFor = (name: string, isAdmin: boolean): string => (name === 'players' && isAdmin ? 'Teams' : ROUTES[name]!);

export function tabsForRole(role: UserRole | undefined): TabVisibility[] {
  const isAdmin = role === 'admin';
  const onDock = DOCK[isAdmin ? 'admin' : role === 'coach' ? 'coach' : 'family'];
  const rest = Object.keys(ROUTES).filter((name) => !onDock.includes(name));
  return [
    ...onDock.map((name) => ({ name, onBar: true, title: titleFor(name, isAdmin) })),
    ...rest.map((name) => ({ name, onBar: false, title: titleFor(name, isAdmin) })),
  ];
}
