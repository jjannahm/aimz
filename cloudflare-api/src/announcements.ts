import type { Hono } from "hono";
import { ApiProblem, adminUser, booleanField, jsonObject, nowIso, parsePagination, publicTeam, stringField } from "./helpers";
import { requireAimzTeam, scopedTeams } from "./team-access";
import type { AnnouncementRow, TeamRow } from "./types";

type App = Hono<{ Bindings: Env }>;

interface JoinedAnnouncement extends AnnouncementRow {
  author_name: string | null;
}

async function announcementById(env: Env, id: string): Promise<AnnouncementRow> {
  const row = await env.DB.prepare("SELECT * FROM announcements WHERE id=?").bind(id).first<AnnouncementRow>();
  if (!row) throw new ApiProblem(404, "announcement_not_found", "Announcement not found.");
  return row;
}

async function publicAnnouncement(env: Env, row: JoinedAnnouncement | AnnouncementRow, authorName?: string | null): Promise<Record<string, unknown>> {
  const team = row.team_id ? await env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(row.team_id).first<TeamRow>() : null;
  const name = "author_name" in row ? row.author_name : authorName ?? null;
  return { ...row, pinned: Boolean(row.pinned), author_name: name, team: publicTeam(team) };
}

export function registerAnnouncementRoutes(app: App): void {
  app.get("/api/v1/announcements", async (c) => {
    const url = new URL(c.req.url);
    const { teamIds } = await scopedTeams(c, url.searchParams.get("team_id"));
    const { limit, offset } = parsePagination(url);
    // Academy-wide notices carry no team and reach everyone; a parent also sees
    // whatever was sent to any squad a child of theirs is on.
    const where = teamIds ? ` WHERE a.team_id IN (${teamIds.map(() => "?").join(",")}) OR a.team_id IS NULL` : "";
    const values = teamIds ?? [];
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM announcements a${where}`).bind(...values).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT a.*, u.name author_name FROM announcements a LEFT JOIN users u ON u.id=a.author_id${where} ORDER BY a.pinned DESC, a.created_at DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<JoinedAnnouncement>(),
    ]);
    return c.json({ items: await Promise.all(rows.results.map((row) => publicAnnouncement(c.env, row))), total: count?.total ?? 0, limit, offset });
  });

  app.post("/api/v1/announcements", async (c) => {
    const actor = await adminUser(c);
    const body = await jsonObject(c);
    const teamId = stringField(body, "team_id", { optional: true, nullable: true, max: 36 }) ?? null;
    if (teamId) await requireAimzTeam(c.env, teamId);
    const now = nowIso();
    const row: AnnouncementRow = { id: crypto.randomUUID(), team_id: teamId, title: stringField(body, "title", { min: 2, max: 160 })!, body: stringField(body, "body", { min: 2, max: 5000 })!, author_id: actor.id, pinned: booleanField(body, "pinned", false) ? 1 : 0, created_at: now, updated_at: now };
    await c.env.DB.prepare("INSERT INTO announcements (id, team_id, title, body, author_id, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(row.id, row.team_id, row.title, row.body, row.author_id, row.pinned, now, now).run();
    return c.json(await publicAnnouncement(c.env, row, actor.name), 201);
  });

  app.patch("/api/v1/announcements/:id", async (c) => {
    const actor = await adminUser(c);
    const current = await announcementById(c.env, c.req.param("id"));
    const body = await jsonObject(c);
    const teamId = body.team_id === undefined ? current.team_id : stringField(body, "team_id", { nullable: true, max: 36 }) ?? null;
    if (teamId) await requireAimzTeam(c.env, teamId);
    const row: AnnouncementRow = { ...current, team_id: teamId, title: stringField(body, "title", { optional: true, min: 2, max: 160 }) ?? current.title, body: stringField(body, "body", { optional: true, min: 2, max: 5000 }) ?? current.body, pinned: body.pinned === undefined ? current.pinned : booleanField(body, "pinned") ? 1 : 0, updated_at: nowIso() };
    await c.env.DB.prepare("UPDATE announcements SET team_id=?, title=?, body=?, pinned=?, updated_at=? WHERE id=?").bind(row.team_id, row.title, row.body, row.pinned, row.updated_at, row.id).run();
    return c.json(await publicAnnouncement(c.env, row, actor.id === row.author_id ? actor.name : null));
  });

  app.delete("/api/v1/announcements/:id", async (c) => {
    await adminUser(c);
    const result = await c.env.DB.prepare("DELETE FROM announcements WHERE id=?").bind(c.req.param("id")).run();
    if (!result.meta.changes) throw new ApiProblem(404, "announcement_not_found", "Announcement not found.");
    return c.body(null, 204);
  });
}
