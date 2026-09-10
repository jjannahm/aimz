import type { Context, Hono } from "hono";
import { ApiProblem, currentUser, enumField, jsonObject, nowIso, parsePagination, publicPlayer, publicTeam, stringField } from "./helpers";
import { assertAdminOnly, assertCanManageTeam, linkedPlayerIds, managedTeamIds, managingUser, requireAimzTeam } from "./team-access";
import type { AnnouncementRow, PlayerRow, TeamRow, UserRow } from "./types";

type App = Hono<{ Bindings: Env }>;

interface JoinedAnnouncement extends AnnouncementRow {
  author_name: string | null;
}

/** Who a notice is for, and how loudly it is said. */
const AUDIENCES = ["academy", "team", "coaches"] as const;
const PRIORITIES = ["standard", "pinned", "urgent"] as const;

/**
 * Urgent is always pinned.
 *
 * Derived here rather than asked of whoever is posting, so the two cannot be
 * set to disagree — and every reader that orders by `pinned`, which is all of
 * them, keeps working without knowing about priorities at all.
 */
const pinnedFor = (priority: (typeof PRIORITIES)[number]): number => (priority === "standard" ? 0 : 1);

/**
 * A feed asked for by squad, when the asker is held to their own.
 *
 * Refused rather than quietly answered with their own notices: asking for
 * another squad's feed is asking for something they may not have, and an
 * answer that silently means something else is worse than a refusal.
 */
function assertOwnSquad(requested: string | null, allowed: string[]): void {
  if (!requested || allowed.includes(requested)) return;
  throw new ApiProblem(403, "team_access_denied", "You can only open your own squad's team hub.");
}

async function announcementById(env: Env, id: string): Promise<AnnouncementRow> {
  const row = await env.DB.prepare("SELECT * FROM announcements WHERE id=?").bind(id).first<AnnouncementRow>();
  if (!row) throw new ApiProblem(404, "announcement_not_found", "Announcement not found.");
  return row;
}

/** The players and coaches a notice names, or empty when it names nobody. */
async function recipientsOf(env: Env, announcementId: string): Promise<{ players: PlayerRow[]; coaches: UserRow[] }> {
  const rows = await env.DB.prepare("SELECT player_id, user_id FROM announcement_recipients WHERE announcement_id=?")
    .bind(announcementId).all<{ player_id: string | null; user_id: string | null }>();
  const playerIds = rows.results.map((row) => row.player_id).filter((id): id is string => Boolean(id));
  const userIds = rows.results.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  const [players, coaches] = await Promise.all([
    playerIds.length
      ? env.DB.prepare(`SELECT * FROM players WHERE id IN (${playerIds.map(() => "?").join(",")}) ORDER BY name`).bind(...playerIds).all<PlayerRow>()
      : Promise.resolve({ results: [] as PlayerRow[] }),
    userIds.length
      ? env.DB.prepare(`SELECT * FROM users WHERE id IN (${userIds.map(() => "?").join(",")}) ORDER BY name`).bind(...userIds).all<UserRow>()
      : Promise.resolve({ results: [] as UserRow[] }),
  ]);
  return { players: players.results, coaches: coaches.results };
}

async function publicAnnouncement(env: Env, row: JoinedAnnouncement | AnnouncementRow, authorName?: string | null): Promise<Record<string, unknown>> {
  const team = row.team_id ? await env.DB.prepare("SELECT * FROM teams WHERE id=?").bind(row.team_id).first<TeamRow>() : null;
  const name = "author_name" in row ? row.author_name : authorName ?? null;
  const { players, coaches } = await recipientsOf(env, row.id);
  return {
    ...row,
    pinned: Boolean(row.pinned),
    author_name: name,
    team: publicTeam(team),
    // Named recipients, so the screen that posted it can say who it went to
    // rather than only that it went to "one squad".
    player_ids: players.map((player) => player.id),
    players: players.map((player) => publicPlayer(player)),
    coach_ids: coaches.map((coach) => coach.id),
    coaches: coaches.map((coach) => ({ id: coach.id, name: coach.name })),
  };
}

/**
 * What this notice is addressed to, read off a request.
 *
 * The three audiences take different company: a squad notice needs a squad and
 * may name players on it, a coaches notice may name coaches, and an academy
 * notice takes neither. Anything sent that does not belong to the chosen
 * audience is dropped rather than stored, so a notice cannot carry a stale
 * squad from a form somebody changed their mind on.
 */
async function targetFrom(c: Context<{ Bindings: Env }>, body: Record<string, unknown>, actor: UserRow, scope: string[] | null): Promise<{
  audience: (typeof AUDIENCES)[number];
  teamId: string | null;
  playerIds: string[];
  coachIds: string[];
}> {
  const ids = (field: string): string[] => (Array.isArray(body[field]) ? (body[field] as unknown[]) : [])
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  // `team_id` on its own, with no audience named, is how every existing caller
  // addresses a squad — and how every row written before today was addressed.
  const audience = body.audience === undefined
    ? (stringField(body, "team_id", { optional: true, nullable: true, max: 36 }) ? "team" : "academy")
    : enumField(body, "audience", AUDIENCES);

  if (audience === "academy") {
    assertAdminOnly(actor, "An announcement to the whole academy");
    return { audience, teamId: null, playerIds: [], coachIds: [] };
  }
  if (audience === "coaches") {
    assertAdminOnly(actor, "An announcement to the academy's coaches");
    const coachIds = ids("coach_ids");
    if (coachIds.length) {
      const known = await c.env.DB.prepare(`SELECT id FROM users WHERE role='coach' AND is_active=1 AND id IN (${coachIds.map(() => "?").join(",")})`)
        .bind(...coachIds).all<{ id: string }>();
      if (known.results.length !== coachIds.length) throw new ApiProblem(422, "coach_not_found", "Choose coaches from the list.");
    }
    return { audience, teamId: null, playerIds: [], coachIds };
  }

  const teamId = stringField(body, "team_id", { min: 1, max: 36 });
  if (!teamId) throw new ApiProblem(422, "validation_error", "Choose a squad.", [{ field: "team_id", message: "Choose a squad." }]);
  assertCanManageTeam(scope, teamId);
  await requireAimzTeam(c.env, teamId);
  const playerIds = ids("player_ids");
  if (playerIds.length) {
    // Naming somebody from another squad would send a squad's notice outside
    // it, which is the one thing this targeting must not allow.
    const onSquad = await c.env.DB.prepare(`SELECT id FROM players WHERE team_id=? AND id IN (${playerIds.map(() => "?").join(",")})`)
      .bind(teamId, ...playerIds).all<{ id: string }>();
    if (onSquad.results.length !== playerIds.length) throw new ApiProblem(422, "player_not_found", "Name only players from this squad.");
  }
  return { audience, teamId, playerIds, coachIds: [] };
}

/** Replaces a notice's named recipients, which is how an edit re-addresses one. */
function recipientWrites(env: Env, announcementId: string, playerIds: string[], coachIds: string[], now: string) {
  return [
    env.DB.prepare("DELETE FROM announcement_recipients WHERE announcement_id=?").bind(announcementId),
    ...playerIds.map((playerId) => env.DB.prepare("INSERT INTO announcement_recipients (announcement_id, player_id, user_id, created_at) VALUES (?, ?, NULL, ?)").bind(announcementId, playerId, now)),
    ...coachIds.map((userId) => env.DB.prepare("INSERT INTO announcement_recipients (announcement_id, player_id, user_id, created_at) VALUES (?, NULL, ?, ?)").bind(announcementId, userId, now)),
  ];
}

export function registerAnnouncementRoutes(app: App): void {
  app.get("/api/v1/announcements", async (c) => {
    const url = new URL(c.req.url);
    const user = await currentUser(c);
    const { limit, offset } = parsePagination(url);
    const requestedTeam = url.searchParams.get("team_id");

    // An administrator sees the lot, optionally narrowed to one squad; that is
    // the Manage screen, which has to be able to read back what it posted.
    let where = "";
    let values: unknown[] = [];
    if (user.role === "admin") {
      if (requestedTeam) { where = " WHERE a.team_id = ?"; values = [requestedTeam]; }
    } else if (user.role === "coach") {
      // Their squads' notices, the academy's, and anything addressed to
      // coaches — all of them, or them by name.
      const squads = await managedTeamIds(c.env, user);
      assertOwnSquad(requestedTeam, squads);
      where = ` WHERE a.audience='academy'
        OR (a.audience='team' AND a.team_id IN (${squads.map(() => "?").join(",")}))
        OR (a.audience='coaches' AND (NOT EXISTS (SELECT 1 FROM announcement_recipients r WHERE r.announcement_id=a.id)
          OR EXISTS (SELECT 1 FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.user_id=?)))`;
      values = [...squads, user.id];
    } else {
      // A family: the academy's notices, their squads' — unless that notice
      // names particular players, in which case only if it names one of
      // theirs — and nothing addressed to coaches.
      const playerIds = await linkedPlayerIds(c.env, user);
      const placeholders = playerIds.map(() => "?").join(",");
      if (requestedTeam) {
        const mine = await c.env.DB.prepare(`SELECT DISTINCT team_id FROM players WHERE id IN (${placeholders})`).bind(...playerIds).all<{ team_id: string }>();
        assertOwnSquad(requestedTeam, mine.results.map((row) => row.team_id));
      }
      where = ` WHERE a.audience='academy'
        OR (a.audience='team' AND a.team_id IN (SELECT team_id FROM players WHERE id IN (${placeholders}))
          AND (NOT EXISTS (SELECT 1 FROM announcement_recipients r WHERE r.announcement_id=a.id)
            OR EXISTS (SELECT 1 FROM announcement_recipients r WHERE r.announcement_id=a.id AND r.player_id IN (${placeholders}))))`;
      values = [...playerIds, ...playerIds];
    }

    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) total FROM announcements a${where}`).bind(...values).first<{ total: number }>(),
      // Urgent above pinned above the rest, then newest first: the order the
      // words themselves promise.
      c.env.DB.prepare(`SELECT a.*, u.name author_name FROM announcements a LEFT JOIN users u ON u.id=a.author_id${where}
        ORDER BY CASE a.priority WHEN 'urgent' THEN 0 WHEN 'pinned' THEN 1 ELSE 2 END, a.created_at DESC LIMIT ? OFFSET ?`)
        .bind(...values, limit, offset).all<JoinedAnnouncement>(),
    ]);
    return c.json({ items: await Promise.all(rows.results.map((row) => publicAnnouncement(c.env, row))), total: count?.total ?? 0, limit, offset });
  });

  /** The coaches a notice can be addressed to, for the picker that addresses it. */
  app.get("/api/v1/announcements/coaches", async (c) => {
    const { user } = await managingUser(c);
    assertAdminOnly(user, "The academy's coaches");
    const rows = await c.env.DB.prepare("SELECT id, name, email FROM users WHERE role='coach' AND is_active=1 ORDER BY name").all<{ id: string; name: string; email: string }>();
    return c.json({ items: rows.results });
  });

  app.post("/api/v1/announcements", async (c) => {
    const { user: actor, scope } = await managingUser(c);
    const body = await jsonObject(c);
    const target = await targetFrom(c, body, actor, scope);
    const priority = body.priority === undefined
      // `pinned` is how every existing caller says it, and still means what it
      // has always meant.
      ? (body.pinned === true ? "pinned" : "standard")
      : enumField(body, "priority", PRIORITIES);
    const now = nowIso();
    const row: AnnouncementRow = {
      id: crypto.randomUUID(),
      team_id: target.teamId,
      audience: target.audience,
      title: stringField(body, "title", { min: 2, max: 160 })!,
      body: stringField(body, "body", { min: 2, max: 5000 })!,
      author_id: actor.id,
      priority,
      pinned: pinnedFor(priority),
      created_at: now,
      updated_at: now,
    };
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO announcements (id, team_id, audience, title, body, author_id, priority, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(row.id, row.team_id, row.audience, row.title, row.body, row.author_id, row.priority, row.pinned, now, now),
      ...recipientWrites(c.env, row.id, target.playerIds, target.coachIds, now),
    ]);
    return c.json(await publicAnnouncement(c.env, row, actor.name), 201);
  });

  app.patch("/api/v1/announcements/:id", async (c) => {
    const { user: actor, scope } = await managingUser(c);
    const current = await announcementById(c.env, c.req.param("id"));
    // What it is now decides who may touch it, before what it is being changed
    // into decides where it may go.
    if (current.audience === "team" && current.team_id) assertCanManageTeam(scope, current.team_id);
    else assertAdminOnly(actor, "An announcement to the whole academy");

    const body = await jsonObject(c);
    const target = await targetFrom(c, { team_id: current.team_id, audience: current.audience, ...body }, actor, scope);
    const priority = body.priority === undefined
      ? (body.pinned === undefined ? current.priority : (body.pinned === true ? "pinned" : "standard"))
      : enumField(body, "priority", PRIORITIES);
    const row: AnnouncementRow = {
      ...current,
      team_id: target.teamId,
      audience: target.audience,
      title: stringField(body, "title", { optional: true, min: 2, max: 160 }) ?? current.title,
      body: stringField(body, "body", { optional: true, min: 2, max: 5000 }) ?? current.body,
      priority,
      pinned: pinnedFor(priority),
      updated_at: nowIso(),
    };
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE announcements SET team_id=?, audience=?, title=?, body=?, priority=?, pinned=?, updated_at=? WHERE id=?")
        .bind(row.team_id, row.audience, row.title, row.body, row.priority, row.pinned, row.updated_at, row.id),
      ...recipientWrites(c.env, row.id, target.playerIds, target.coachIds, row.updated_at),
    ]);
    return c.json(await publicAnnouncement(c.env, row, actor.id === row.author_id ? actor.name : null));
  });

  app.delete("/api/v1/announcements/:id", async (c) => {
    const { user: actor, scope } = await managingUser(c);
    const current = await announcementById(c.env, c.req.param("id"));
    if (current.audience === "team" && current.team_id) assertCanManageTeam(scope, current.team_id);
    else assertAdminOnly(actor, "An announcement to the whole academy");
    const result = await c.env.DB.prepare("DELETE FROM announcements WHERE id=?").bind(c.req.param("id")).run();
    if (!result.meta.changes) throw new ApiProblem(404, "announcement_not_found", "Announcement not found.");
    return c.body(null, 204);
  });
}
