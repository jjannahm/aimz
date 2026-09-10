/**
 * What the register can say, and what each answer counts for.
 *
 * Gathered here because five places compute an attendance figure — the player
 * profile, her own training page, the squad average she is read against, the
 * published report, and the register's own tallies — and they must agree. A
 * sixth answer added to the list below should not need any of them edited, and
 * a rule spelled out five times is a rule that eventually is not.
 */
export const ATTENDANCE_STATUSES = ["present", "late", "absent"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * The statuses that count as having turned up.
 *
 * Late is one of them: she was there. Marking her absent would be untrue and
 * would cost her a percentage point she earned, which is the whole reason the
 * third status exists.
 */
export const ATTENDED: readonly AttendanceStatus[] = ["present", "late"];

const column = (alias?: string) => (alias ? `${alias}.status` : "status");
const list = (statuses: readonly AttendanceStatus[]) => statuses.map((status) => `'${status}'`).join(", ");

/** `SUM(...)` over the statuses that count as attended, for a percentage. */
export const attendedSql = (alias?: string) => `SUM(CASE WHEN ${column(alias)} IN (${list(ATTENDED)}) THEN 1 ELSE 0 END)`;

/** `SUM(...)` over the late marks alone, so punctuality stays visible. */
export const lateSql = (alias?: string) => `SUM(CASE WHEN ${column(alias)} = 'late' THEN 1 ELSE 0 END)`;
