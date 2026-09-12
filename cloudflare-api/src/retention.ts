/** How long an activity record is kept before it is deleted for good. */
const AUDIT_RETENTION_DAYS = 30;

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
