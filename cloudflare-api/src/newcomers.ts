import type { Context, Hono } from "hono";
import { ApiProblem, adminUser, jsonObject, nowIso, parsePagination, stringField } from "./helpers";

type App = Hono<{ Bindings: Env }>;
type Stage = "new" | "contacted" | "follow_up" | "trial_booked" | "closed";
type Outcome = "joined" | "not_interested" | "declined";
const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const FIELDS = [
  ["branch", 2, 120], ["full_name", 2, 160], ["mobile", 5, 60],
  ["email", 3, 320], ["whatsapp_mobile", 5, 60], ["date_of_birth", 10, 10],
  ["nationality", 2, 100], ["address", 2, 500], ["previous_academy", 2, 200],
  ["school_university", 2, 200], ["father_name", 2, 160], ["father_mobile", 5, 60],
  ["mother_name", 2, 160], ["mother_mobile", 5, 60], ["medical_concerns", 2, 4000],
  ["medications", 2, 4000], ["consent_version", 1, 40],
] as const;

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function newInvite(env: Env): Promise<{ code: string; compact: string; hash: string }> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    const compact = [...bytes].map((byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join("");
    const hash = await sha256(compact);
    if (!await env.DB.prepare("SELECT id FROM registration_invites WHERE code_hash=?").bind(hash).first()) {
      return { compact, hash, code: `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8)}` };
    }
  }
  throw new ApiProblem(503, "invite_generation_failed", "Could not generate an invitation code.");
}

async function verifyTurnstile(c: Context<{ Bindings: Env }>, token: string, ip: string): Promise<void> {
  if (!c.env.TURNSTILE_SECRET) throw new ApiProblem(503, "turnstile_unavailable", "Application verification is unavailable.");
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: c.env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  const result = await response.json<{ success?: boolean; action?: string; hostname?: string }>();
  const hosts = c.env.TURNSTILE_HOSTNAMES.split(",").map((host) => host.trim());
  if (!result.success || result.action !== "newcomer_application" || !result.hostname || !hosts.includes(result.hostname)) {
    throw new ApiProblem(422, "turnstile_failed", "Complete the security check and try again.");
  }
}

async function rateLimit(c: Context<{ Bindings: Env }>, ip: string): Promise<void> {
  const key = await sha256(`${c.env.JWT_SECRET}:${ip}`);
  const row = await c.env.DB.prepare("SELECT * FROM newcomer_rate_limits WHERE key_hash=?")
    .bind(key).first<{ window_started_at: string; attempts: number }>();
  const now = nowIso();
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  if (!row || row.window_started_at < cutoff) {
    await c.env.DB.prepare(`INSERT INTO newcomer_rate_limits(key_hash,window_started_at,attempts)
      VALUES(?,?,1) ON CONFLICT(key_hash) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=1`)
      .bind(key, now).run();
  } else if (row.attempts >= 5) {
    throw new ApiProblem(429, "rate_limited", "Too many applications. Try again in 15 minutes.");
  } else {
    await c.env.DB.prepare("UPDATE newcomer_rate_limits SET attempts=attempts+1 WHERE key_hash=?")
      .bind(key).run();
  }
}

async function duplicate(env: Env, id: string, email: string, mobile: string, whatsapp: string): Promise<boolean> {
  return Boolean(await env.DB.prepare(`SELECT id FROM newcomer_applications
    WHERE id<>? AND (lower(email)=lower(?) OR mobile=? OR whatsapp_mobile=?) LIMIT 1`)
    .bind(id, email, mobile, whatsapp).first());
}

export function registerNewcomerRoutes(app: App): void {
  app.post("/api/v1/newcomer-applications", async (c) => {
    const body = await jsonObject(c);
    const submissionId = stringField(body, "client_submission_id", { min: 8, max: 64 })!;
    const existing = await c.env.DB.prepare("SELECT * FROM newcomer_applications WHERE client_submission_id=?")
      .bind(submissionId).first<Record<string, string>>();
    if (existing) return c.json({ id: existing.id, stage: existing.stage });
    const token = stringField(body, "turnstile_token", { min: 1, max: 2048 })!;
    if (body.consent !== true) throw new ApiProblem(422, "validation_error", "Consent is required.");
    const values: Record<string, string> = {};
    for (const [field, min, max] of FIELDS) values[field] = stringField(body, field, { min, max })!;
    if (!values.email.includes("@") || !/^\d{4}-\d{2}-\d{2}$/u.test(values.date_of_birth)) {
      throw new ApiProblem(422, "validation_error", "Enter a valid email and date of birth.");
    }
    const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
    await verifyTurnstile(c, token, ip);
    await rateLimit(c, ip);
    const id = crypto.randomUUID();
    const now = nowIso();
    const columns = FIELDS.map(([field]) => field);
    await c.env.DB.prepare(`INSERT INTO newcomer_applications
      (id,source,stage,client_submission_id,${columns.join(",")},consented_at,created_at,updated_at)
      VALUES(?,'public_link','new',?,${columns.map(() => "?").join(",")},?,?,?)`)
      .bind(id, submissionId, ...columns.map((field) => values[field]), now, now, now).run();
    // Whether somebody else has already applied with this number is the
    // academy's to see, not the sender's: the answer is about a third party and
    // a stranger who guessed a mobile could read it. The queue still flags it.
    return c.json({ id, stage: "new" }, 201);
  });

  app.get("/api/v1/admin/newcomers", async (c) => {
    await adminUser(c);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const history = url.searchParams.get("queue") === "history";
    const search = `%${url.searchParams.get("search")?.trim() ?? ""}%`;
    const source = url.searchParams.get("source");
    const stage = url.searchParams.get("stage");
    const branch = url.searchParams.get("branch");
    const clauses = [`stage ${history ? "=" : "<>"} 'closed'`,
      "(full_name LIKE ? OR email LIKE ? OR mobile LIKE ? OR whatsapp_mobile LIKE ?)"];
    const bindings: string[] = [search, search, search, search];
    if (source && ["public_link", "account_registration"].includes(source)) { clauses.push("source=?"); bindings.push(source); }
    if (stage && ["new", "contacted", "follow_up", "trial_booked", "closed"].includes(stage)) { clauses.push("stage=?"); bindings.push(stage); }
    if (branch) { clauses.push("branch=?"); bindings.push(branch); }
    const where = clauses.join(" AND ");
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT count(*) total FROM newcomer_applications WHERE ${where}`)
        .bind(...bindings).first<{ total: number }>(),
      c.env.DB.prepare(`SELECT *, EXISTS(SELECT 1 FROM newcomer_applications d WHERE d.id<>newcomer_applications.id
        AND (lower(d.email)=lower(newcomer_applications.email) OR d.mobile=newcomer_applications.mobile OR d.whatsapp_mobile=newcomer_applications.whatsapp_mobile)) duplicate_likely
        FROM newcomer_applications WHERE ${where} ORDER BY next_follow_up_at IS NULL,next_follow_up_at,created_at DESC LIMIT ? OFFSET ?`)
        .bind(...bindings, limit, offset).all(),
    ]);
    return c.json({ items: rows.results.map((row) => ({ ...row, duplicate_likely: Boolean(row.duplicate_likely), notes: [] })), total: count?.total ?? 0, limit, offset });
  });

  /**
   * The branches applications have actually been made from.
   *
   * There is no branch table: an application records the branch it came from
   * as text, which is the academy's own list of where it operates. Reading the
   * distinct values back is therefore the whole truth about which branches
   * exist, and keeps the filter from offering one nobody has ever applied to
   * or from hardcoding a list that would go stale the day a branch opened.
   */
  app.get("/api/v1/admin/newcomers/branches", async (c) => {
    await adminUser(c);
    const rows = await c.env.DB.prepare(
      "SELECT DISTINCT branch FROM newcomer_applications WHERE branch <> '' ORDER BY branch COLLATE NOCASE",
    ).all<{ branch: string }>();
    return c.json({ items: rows.results.map((row) => row.branch) });
  });

  app.get("/api/v1/admin/newcomers/:id", async (c) => {
    await adminUser(c);
    const item = await c.env.DB.prepare("SELECT * FROM newcomer_applications WHERE id=?").bind(c.req.param("id")).first<Record<string, string>>();
    if (!item) throw new ApiProblem(404, "newcomer_not_found", "Newcomer application not found.");
    const notes = await c.env.DB.prepare("SELECT * FROM newcomer_notes WHERE application_id=? ORDER BY created_at DESC").bind(item.id).all();
    return c.json({ ...item, duplicate_likely: await duplicate(c.env, item.id, item.email, item.mobile, item.whatsapp_mobile), notes: notes.results });
  });

  app.patch("/api/v1/admin/newcomers/:id", async (c) => {
    const admin = await adminUser(c);
    const body = await jsonObject(c);
    const stage = body.stage as Stage | undefined;
    const outcome = body.outcome as Outcome | null | undefined;
    if (stage && !["new", "contacted", "follow_up", "trial_booked", "closed"].includes(stage)) throw new ApiProblem(422, "validation_error", "Choose a valid stage.");
    if (outcome && !["joined", "not_interested", "declined"].includes(outcome)) throw new ApiProblem(422, "validation_error", "Choose a valid outcome.");
    if (stage === "closed" && !outcome) throw new ApiProblem(422, "outcome_required", "Choose a closed outcome.");
    // A PATCH says only what it is changing, and absent is not the same as null:
    // the app clears a follow-up by sending null and marks somebody contacted by
    // sending no follow-up at all. Writing the column either way threw the
    // reminder away at the moment it began to matter, and blanked the reason a
    // closed application was closed. So each of these is written only when the
    // body carries it.
    const given = (field: string) => Object.hasOwn(body, field);
    const instant = (field: string) => {
      const value = body[field];
      if (value === null || value === undefined) return null;
      if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
        throw new ApiProblem(422, "validation_error", `Enter a date and time for ${field.replaceAll("_", " ")}.`);
      }
      return value;
    };
    const now = nowIso();
    const result = await c.env.DB.prepare(`UPDATE newcomer_applications SET
      stage=coalesce(?,stage),
      outcome=CASE WHEN ?=1 THEN ? ELSE outcome END,
      last_contacted_at=coalesce(?,last_contacted_at),
      next_follow_up_at=CASE WHEN ?=1 THEN ? ELSE next_follow_up_at END,
      -- Closed once: a later edit of a closed record keeps the hour it closed,
      -- and reopening it drops the stamp rather than leaving a stale one.
      closed_at=CASE WHEN coalesce(?,stage)='closed' THEN coalesce(closed_at,?) ELSE NULL END,
      reviewed_by_id=?,updated_at=? WHERE id=?`)
      .bind(
        stage ?? null,
        given("outcome") ? 1 : 0, outcome ?? null,
        instant("last_contacted_at"),
        given("next_follow_up_at") ? 1 : 0, instant("next_follow_up_at"),
        stage ?? null, now, admin.id, now, c.req.param("id"),
      ).run();
    if (!result.meta.changes) throw new ApiProblem(404, "newcomer_not_found", "Newcomer application not found.");
    return c.json(await c.env.DB.prepare("SELECT * FROM newcomer_applications WHERE id=?").bind(c.req.param("id")).first());
  });

  app.post("/api/v1/admin/newcomers/:id/notes", async (c) => {
    const admin = await adminUser(c);
    const body = await jsonObject(c);
    const note = { id: crypto.randomUUID(), application_id: c.req.param("id"), author_id: admin.id, body: stringField(body, "body", { min: 1, max: 4000 })!, created_at: nowIso() };
    try {
      await c.env.DB.prepare("INSERT INTO newcomer_notes(id,application_id,author_id,body,created_at) VALUES(?,?,?,?,?)")
        .bind(note.id, note.application_id, note.author_id, note.body, note.created_at).run();
    } catch { throw new ApiProblem(404, "newcomer_not_found", "Newcomer application not found."); }
    return c.json(note, 201);
  });

  app.post("/api/v1/admin/newcomers/:id/assign-and-confirm", async (c) => {
    const admin = await adminUser(c);
    const body = await jsonObject(c);
    const teamId = stringField(body, "team_id", { min: 1, max: 36 })!;
    const position = stringField(body, "position", { min: 1, max: 60 })!;
    const jersey = typeof body.jersey_number === "number" ? body.jersey_number : null;
    if (jersey !== null && (!Number.isInteger(jersey) || jersey < 0 || jersey > 99)) {
      throw new ApiProblem(422, "validation_error", "Jersey number must be between 0 and 99.");
    }
    const item = await c.env.DB.prepare("SELECT * FROM newcomer_applications WHERE id=?")
      .bind(c.req.param("id")).first<Record<string, string | null>>();
    if (!item) throw new ApiProblem(404, "newcomer_not_found", "Newcomer application not found.");
    const team = await c.env.DB.prepare("SELECT id,name FROM teams WHERE id=? AND is_aimz=1 AND is_active=1")
      .bind(teamId).first<{ id: string; name: string }>();
    if (!team) throw new ApiProblem(422, "team_not_found", "Choose an active AIMZ squad.");
    if (jersey !== null && await c.env.DB.prepare("SELECT id FROM players WHERE team_id=? AND jersey_number=? AND id<>coalesce(?, '')")
      .bind(teamId, jersey, item.player_id).first()) {
      throw new ApiProblem(409, "jersey_in_use", "That jersey number is already used in this squad.");
    }
    const playerId = item.player_id ?? crypto.randomUUID();
    const now = nowIso();
    const statements = [];
    if (item.player_id) {
      statements.push(c.env.DB.prepare("UPDATE players SET team_id=?,position=?,jersey_number=?,date_of_birth=?,updated_at=? WHERE id=?")
        .bind(teamId, position, jersey, item.date_of_birth, now, playerId));
    } else {
      statements.push(c.env.DB.prepare(`INSERT INTO players(id,name,team_id,position,jersey_number,date_of_birth,is_active,created_at,updated_at)
        VALUES(?,?,?,?,?,?,1,?,?)`).bind(playerId, item.full_name, teamId, position, jersey, item.date_of_birth, now, now));
      statements.push(c.env.DB.prepare("INSERT INTO player_contacts(id,player_id,name,relationship,phone,created_at,updated_at) VALUES(?,?,?,'father',?,?,?)")
        .bind(crypto.randomUUID(), playerId, item.father_name, item.father_mobile, now, now));
      statements.push(c.env.DB.prepare("INSERT INTO player_contacts(id,player_id,name,relationship,phone,created_at,updated_at) VALUES(?,?,?,'mother',?,?,?)")
        .bind(crypto.randomUUID(), playerId, item.mother_name, item.mother_mobile, now, now));
    }
    let invitation: Record<string, unknown> | null = null;
    if (item.user_id) {
      statements.push(c.env.DB.prepare("UPDATE users SET player_id=?,onboarding_status='approved',updated_at=? WHERE id=?")
        .bind(playerId, now, item.user_id));
    } else {
      const generated = await newInvite(c.env);
      const inviteId = crypto.randomUUID();
      statements.push(c.env.DB.prepare(`INSERT INTO registration_invites
        (id,label,code_hash,kind,player_id,team_id,application_id,max_uses,use_count,is_active,created_by_id,created_at)
        VALUES(?,?,?,'player',?,?,?,1,0,1,?,?)`)
        .bind(inviteId, `${item.full_name} — ${team.name}`, generated.hash, playerId, teamId, item.id, admin.id, now));
      statements.push(c.env.DB.prepare("UPDATE newcomer_applications SET invite_id=? WHERE id=?").bind(inviteId, item.id));
      invitation = {
        id: inviteId, label: `${item.full_name} — ${team.name}`, kind: "player",
        player_id: playerId, team_id: teamId, application_id: item.id, max_uses: 1,
        use_count: 0, is_active: true, created_at: now, code: generated.code,
        share_url: `${c.env.PUBLIC_FORM_ORIGIN}/join/${generated.compact}`,
      };
    }
    statements.push(c.env.DB.prepare(`UPDATE newcomer_applications SET player_id=?,suggested_team_id=?,stage='closed',outcome='joined',closed_at=?,next_follow_up_at=NULL,reviewed_by_id=?,updated_at=? WHERE id=?`)
      .bind(playerId, teamId, now, admin.id, now, item.id));
    await c.env.DB.batch(statements);
    return c.json({ application: await c.env.DB.prepare("SELECT * FROM newcomer_applications WHERE id=?").bind(item.id).first(), player_id: playerId, invitation });
  });
}
