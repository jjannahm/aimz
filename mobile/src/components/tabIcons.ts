/**
 * The glyphs the dock can ask for, in one place.
 *
 * Web draws its own SVG set in `TabIcon.web.tsx` while native uses Ionicons in
 * `TabIcon.tsx`, and Metro swaps one for the other at bundle time. They each
 * held their own copy of this union once, so adding a tab satisfied the native
 * file, type-checked against the native file, tested against the native file —
 * and left web handing React an undefined component. Sharing the names makes
 * `Record<TabIconName, …>` refuse to compile in both until both are answered.
 */
export const TAB_ICON_NAMES = ['manage', 'matches', 'myTeam', 'players', 'reports', 'settings', 'squad'] as const;

export type TabIconName = (typeof TAB_ICON_NAMES)[number];
