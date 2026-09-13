/** How long an activity record is kept before it is deleted for good. */
const AUDIT_RETENTION_DAYS = 30;

/**
 * How long a spent sign-in session is kept after it stops being usable.
 *
 * A few days rather than none: a row that has just been rotated is the only
 * evidence of where a refresh token came from, which is worth having while
 * somebody is still awake to ask about it.
 */
const SESSION_GRACE_DAYS = 7;

const DAY_MS = 86_400_000;

/** The moment before which activity is no longer kept. */
function auditCutoff(now: Date): string {
  return new Date(now.getTime() - AUDIT_RETENTION_DAYS * DAY_MS).toISOString();
}

/**
 * Delete activity older than a month.
 *
 * The trail is a working record — who scored what, and who corrected it a
 * minute later — rather than an archive, and a season of it is tens of
 * thousands of rows nobody reads. Each row is kept a month from its own
 * `created_at`, so this runs on a timer rather than on a screen being opened:
 * the log shrinks whether or not an administrator ever looks.
 *
 * Only `audit_log` is touched. Matches, events, fees and kit orders are the
 * records themselves, not notes about them, and are kept.
 */
export async function purgeExpiredAudit(env: Env, now = new Date()): Promise<number> {
  const result = await env.DB.prepare("DELETE FROM audit_log WHERE created_at < ?").bind(auditCutoff(now)).run();
  return result.meta.changes ?? 0;
}

/**
 * Delete sign-in sessions that can no longer sign anybody in.
 *
 * Every login writes a row here and every refresh writes another, rotating the
 * one before it — so with a fifteen-minute access token each account leaves
 * around a hundred rows a day behind it and nothing ever took them away. At a
 * few hundred accounts that is a table growing by tens of thousands of rows a
 * week, all of it unusable: expired, or revoked the moment it was rotated.
 *
 * A live session is never touched. Only rows that have already expired, or
 * were revoked longer ago than the grace period, are removed.
 */
export async function purgeSpentSessions(env: Env, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SESSION_GRACE_DAYS * DAY_MS).toISOString();
  const result = await env.DB.prepare(
    "DELETE FROM refresh_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)",
  ).bind(now.toISOString(), cutoff).run();
  return result.meta.changes ?? 0;
}
