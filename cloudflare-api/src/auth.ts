import type { Context, Hono } from "hono";
import { ApiProblem, adminUser, currentUser, jsonObject, nowIso, stringField } from "./helpers";
import {
  createAccessToken,
  hashPassword,
  hashSecret,
  newToken,
  publicUser,
  verifyPassword,
} from "./security";
import type { InviteRow, UserRole, UserRow } from "./types";

type App = Hono<{ Bindings: Env }>;

async function ensureSeeded(env: Env): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.INITIAL_INVITE_CODE) return;
  const email = env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  let adminId = existing?.id;
  if (!adminId) {
    adminId = crypto.randomUUID();
    const now = nowIso();
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (id, name, email, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', 1, ?, ?)",
    ).bind(adminId, env.ADMIN_NAME, email, passwordHash, now, now).run();
  }
  const inviteHash = await hashSecret(env.INITIAL_INVITE_CODE.trim());
  await env.DB.prepare(
    "INSERT OR IGNORE INTO registration_invites (id, label, code_hash, is_active, created_by_id, created_at) VALUES (?, 'Initial staging invite', ?, 1, ?, ?)",
  ).bind(crypto.randomUUID(), inviteHash, adminId, nowIso()).run();
}

async function issueTokens(env: Env, user: UserRow): Promise<Record<string, unknown>> {
  const expiresIn = Number(env.ACCESS_TOKEN_SECONDS);
  const accessToken = await createAccessToken(user.id, user.role, env.JWT_SECRET, expiresIn);
  const refreshToken = newToken();
  const refreshHash = await hashSecret(refreshToken);
  const expiresAt = new Date(Date.now() + Number(env.REFRESH_TOKEN_DAYS) * 86_400_000).toISOString();
  await env.DB.prepare(
    "INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), user.id, refreshHash, expiresAt, nowIso()).run();
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: expiresIn,
    user: publicUser(user),
  };
}

function emailField(body: Record<string, unknown>): string {
  const email = stringField(body, "email", { min: 3, max: 320 });
  if (!email || !email.includes("@")) {
    throw new ApiProblem(422, "validation_error", "Enter a valid email address.", [{ field: "email", message: "Enter a valid email address." }]);
  }
  return email.toLowerCase();
}

async function passwordLogin(c: Context<{ Bindings: Env }>): Promise<Response> {
  await ensureSeeded(c.env);
  const body = await jsonObject(c);
  const email = emailField(body);
  const password = stringField(body, "password", { min: 1, max: 128 });
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ? AND is_active = 1").bind(email).first<UserRow>();
  if (!user || !password || !(await verifyPassword(password, user.password_hash))) {
    throw new ApiProblem(401, "invalid_credentials", "Email or password is incorrect.");
  }
  return c.json(await issueTokens(c.env, user));
}

export function registerAuthRoutes(app: App): void {
  app.post("/api/v1/auth/register", async (c) => {
    await ensureSeeded(c.env);
    const body = await jsonObject(c);
    const name = stringField(body, "name", { min: 2, max: 120 });
    const email = emailField(body);
    const password = stringField(body, "password", { min: 10, max: 128 });
    const inviteCode = stringField(body, "invite_code", { min: 4, max: 128 });
    if (!name || !password || !inviteCode) throw new ApiProblem(422, "validation_error", "Complete all required fields.");

    const duplicate = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (duplicate) throw new ApiProblem(409, "email_exists", "An account already uses this email address.");

    const inviteHash = await hashSecret(inviteCode);
    const invite = await c.env.DB.prepare("SELECT * FROM registration_invites WHERE code_hash = ?").bind(inviteHash).first<InviteRow>();
    const now = nowIso();
    if (!invite || !invite.is_active || (invite.expires_at && invite.expires_at <= now) || (invite.max_uses !== null && invite.use_count >= invite.max_uses)) {
      throw new ApiProblem(409, "invalid_invite", "This invitation code is invalid, expired, or already used.");
    }

    const user: UserRow = {
      id: crypto.randomUUID(),
      name,
      email,
      password_hash: await hashPassword(password),
      role: "player",
      player_id: null,
      is_active: 1,
      created_at: now,
      updated_at: now,
    };
    const claimId = crypto.randomUUID();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO invite_claims (id, invite_id, user_id, created_at) SELECT ?, id, ?, ? FROM registration_invites WHERE id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR use_count < max_uses)",
      ).bind(claimId, user.id, now, invite.id, now),
      c.env.DB.prepare(
        "INSERT INTO users (id, name, email, password_hash, role, player_id, is_active, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM invite_claims WHERE id = ? AND user_id = ?)",
      ).bind(user.id, user.name, user.email, user.password_hash, user.role, user.player_id, now, now, claimId, user.id),
      c.env.DB.prepare(
        "UPDATE registration_invites SET use_count = use_count + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM invite_claims WHERE id = ? AND user_id = ?)",
      ).bind(invite.id, claimId, user.id),
    ]);
    if ((results[1].meta.changes ?? 0) !== 1) throw new ApiProblem(409, "invalid_invite", "This invitation code is no longer available.");
    return c.json(await issueTokens(c.env, user), 201);
  });

  app.post("/api/v1/auth/login", passwordLogin);

  app.post("/api/v1/auth/refresh", async (c) => {
    const body = await jsonObject(c);
    const refreshToken = stringField(body, "refresh_token", { min: 16, max: 256 });
    if (!refreshToken) throw new ApiProblem(401, "invalid_refresh_token", "Sign in again.");
    const tokenHash = await hashSecret(refreshToken);
    const session = await c.env.DB.prepare(
      "SELECT id, user_id FROM refresh_sessions WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?",
    ).bind(tokenHash, nowIso()).first<{ id: string; user_id: string }>();
    if (!session) throw new ApiProblem(401, "invalid_refresh_token", "Your session has expired. Sign in again.");
    const user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ? AND is_active = 1").bind(session.user_id).first<UserRow>();
    if (!user) throw new ApiProblem(401, "invalid_refresh_token", "Your account is unavailable.");
    await c.env.DB.prepare("UPDATE refresh_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(nowIso(), session.id).run();
    return c.json(await issueTokens(c.env, user));
  });

  app.post("/api/v1/auth/logout", async (c) => {
    const body = await jsonObject(c);
    const token = stringField(body, "refresh_token", { min: 16, max: 256 });
    if (token) await c.env.DB.prepare("UPDATE refresh_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").bind(nowIso(), await hashSecret(token)).run();
    return c.body(null, 204);
  });

  app.post("/api/v1/auth/password/change", async (c) => {
    const user = await currentUser(c);
    const body = await jsonObject(c);
    const current = stringField(body, "current_password", { min: 1, max: 128 });
    const next = stringField(body, "new_password", { min: 10, max: 128 });
    if (!current || !next || !(await verifyPassword(current, user.password_hash))) {
      throw new ApiProblem(422, "incorrect_password", "Current password is incorrect.");
    }
    const changedAt = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(next), changedAt, user.id),
      c.env.DB.prepare("UPDATE refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(changedAt, user.id),
    ]);
    return c.json({ message: "Password updated." });
  });

  app.post("/api/v1/auth/password-reset/request", () => { throw new ApiProblem(503, "password_reset_disabled", "Password reset is disabled in staging. Contact an AIMZ administrator."); });
  app.post("/api/v1/auth/password-reset/confirm", () => { throw new ApiProblem(503, "password_reset_disabled", "Password reset is disabled in staging. Contact an AIMZ administrator."); });

  app.get("/api/v1/users/me", async (c) => c.json(publicUser(await currentUser(c))));
  app.patch("/api/v1/users/me", async (c) => {
    const user = await currentUser(c);
    const body = await jsonObject(c);
    const name = stringField(body, "name", { min: 2, max: 120 });
    await c.env.DB.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").bind(name, nowIso(), user.id).run();
    const updated = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first<UserRow>();
    return c.json(publicUser(updated ?? user));
  });
  app.delete("/api/v1/users/me", async (c) => {
    const user = await currentUser(c);
    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
    return c.body(null, 204);
  });

  app.get("/api/v1/admin/users", async (c) => {
    await adminUser(c);
    const result = await c.env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC").all<UserRow>();
    return c.json(result.results.map(publicUser));
  });
  app.post("/api/v1/admin/users", async (c) => {
    await adminUser(c);
    const body = await jsonObject(c);
    const name = stringField(body, "name", { min: 2, max: 120 });
    const email = emailField(body);
    const password = stringField(body, "password", { min: 10, max: 128 });
    const role = body.role === "player" ? "player" : "admin" satisfies UserRole;
    const now = nowIso();
    const user: UserRow = { id: crypto.randomUUID(), name: name!, email, password_hash: await hashPassword(password!), role, player_id: null, is_active: 1, created_at: now, updated_at: now };
    try {
      await c.env.DB.prepare("INSERT INTO users (id, name, email, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)").bind(user.id, user.name, user.email, user.password_hash, user.role, now, now).run();
    } catch {
      throw new ApiProblem(409, "email_exists", "An account already uses this email address.");
    }
    return c.json(publicUser(user), 201);
  });

  app.get("/api/v1/admin/registration-invites", async (c) => {
    await adminUser(c);
    const result = await c.env.DB.prepare("SELECT * FROM registration_invites ORDER BY created_at DESC").all<InviteRow>();
    return c.json(result.results.map(publicInvite));
  });
  app.post("/api/v1/admin/registration-invites", async (c) => {
    const admin = await adminUser(c);
    const body = await jsonObject(c);
    const label = stringField(body, "label", { min: 2, max: 120 });
    const code = stringField(body, "code", { min: 4, max: 128 });
    const expiresAt = typeof body.expires_at === "string" ? body.expires_at : null;
    const maxUses = typeof body.max_uses === "number" && body.max_uses >= 1 ? Math.floor(body.max_uses) : null;
    const invite: InviteRow = { id: crypto.randomUUID(), label: label!, code_hash: await hashSecret(code!), expires_at: expiresAt, max_uses: maxUses, use_count: 0, is_active: 1, created_by_id: admin.id, created_at: nowIso() };
    try {
      await c.env.DB.prepare("INSERT INTO registration_invites (id, label, code_hash, expires_at, max_uses, use_count, is_active, created_by_id, created_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)").bind(invite.id, invite.label, invite.code_hash, invite.expires_at, invite.max_uses, admin.id, invite.created_at).run();
    } catch {
      throw new ApiProblem(409, "invite_exists", "That invitation code already exists.");
    }
    return c.json(publicInvite(invite), 201);
  });
  app.delete("/api/v1/admin/registration-invites/:id", async (c) => {
    await adminUser(c);
    const result = await c.env.DB.prepare("UPDATE registration_invites SET is_active = 0 WHERE id = ?").bind(c.req.param("id")).run();
    if (!result.meta.changes) throw new ApiProblem(404, "invite_not_found", "Invitation code not found.");
    return c.body(null, 204);
  });
}

function publicInvite(invite: InviteRow): Record<string, unknown> {
  return {
    id: invite.id,
    label: invite.label,
    expires_at: invite.expires_at,
    max_uses: invite.max_uses,
    use_count: invite.use_count,
    is_active: Boolean(invite.is_active),
    created_at: invite.created_at,
  };
}
