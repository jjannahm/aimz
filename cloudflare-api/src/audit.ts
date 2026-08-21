import type { Hono } from "hono";
import { adminUser, parsePagination } from "./helpers";
import type { AuditRow, UserRow } from "./types";

type App = Hono<{ Bindings: Env }>;

interface AuditEntry {
  action: string;
  entityType: string;
  entityId: string | null;
  matchId: string | null;
  summary: string;
}

/**
 * Note an admin write so a match scored by two people can be untangled later.
 *
 * Returns a statement rather than running it, so the audit row lands in the same
 * D1 batch as the change it describes and cannot be recorded for a write that
 * failed. The actor's name is copied in rather than joined, so the trail still
 * reads after the account is removed.
 */
export function recordAudit(env: Env, actor: UserRow, entry: AuditEntry): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO audit_log (id, actor_id, actor_name, action, entity_type, entity_id, match_id, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(),
    actor.id,
    actor.name,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.matchId,
    entry.summary,
    new Date().toISOString(),
  );
}

export function registerAuditRoutes(app: App): void {
  app.get("/api/v1/admin/audit-log", async (c) => {
    await adminUser(c);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const matchId = url.searchParams.get("match_id");
    const where = matchId ? " WHERE match_id = ?" : "";
    const scope = matchId ? [matchId] : [];
    const counted = await c.env.DB.prepare(`SELECT COUNT(*) AS total FROM audit_log${where}`)
      .bind(...scope)
      .first<{ total: number }>();
    // Newest first, with the id breaking ties between rows written in the same batch.
    const rows = await c.env.DB.prepare(
      `SELECT * FROM audit_log${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
    )
      .bind(...scope, limit, offset)
      .all<AuditRow>();
    return c.json({ items: rows.results, total: counted?.total ?? 0, limit, offset });
  });
}
