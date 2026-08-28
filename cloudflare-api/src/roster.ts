import type { Hono } from "hono";
import { ApiProblem, adminUser, jsonObject, nowIso, stringField } from "./helpers";
import type { PlayerContactRow, PlayerRow } from "./types";

type App = Hono<{ Bindings: Env }>;

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function privateRoster(env: Env, player: PlayerRow): Promise<Record<string, unknown>> {
  const contacts = await env.DB.prepare("SELECT * FROM player_contacts WHERE player_id=? ORDER BY name").bind(player.id).all<PlayerContactRow>();
  return { player_id: player.id, date_of_birth: player.date_of_birth, contacts: contacts.results };
}

export function registerRosterRoutes(app: App): void {
  app.get("/api/v1/players/:id/contacts", async (c) => {
    await adminUser(c);
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(c.req.param("id")).first<PlayerRow>();
    if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
    return c.json(await privateRoster(c.env, player));
  });

  app.put("/api/v1/players/:id/contacts", async (c) => {
    await adminUser(c);
    const player = await c.env.DB.prepare("SELECT * FROM players WHERE id=?").bind(c.req.param("id")).first<PlayerRow>();
    if (!player) throw new ApiProblem(404, "player_not_found", "Player not found.");
    const body = await jsonObject(c);
    const date = stringField(body, "date_of_birth", { optional: true, nullable: true, max: 10 }) ?? null;
    if (date && !validDateOnly(date)) throw new ApiProblem(422, "validation_error", "Enter a real birth date as YYYY-MM-DD.", [{ field: "date_of_birth", message: "Use a valid YYYY-MM-DD date." }]);
    if (!Array.isArray(body.contacts) || body.contacts.length > 20) throw new ApiProblem(422, "validation_error", "Add up to 20 roster contacts.", [{ field: "contacts", message: "Add up to 20 contacts." }]);
    const now = nowIso();
    const contacts = body.contacts.map<PlayerContactRow>((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiProblem(422, "validation_error", "Check each roster contact.");
      const item = value as Record<string, unknown>;
      return { id: crypto.randomUUID(), player_id: player.id, name: stringField(item, "name", { min: 2, max: 160 })!, relationship: stringField(item, "relationship", { optional: true, nullable: true, max: 80 }) ?? null, email: stringField(item, "email", { optional: true, nullable: true, max: 320 }) ?? null, phone: stringField(item, "phone", { optional: true, nullable: true, max: 60 }) ?? null, created_at: now, updated_at: now };
    });
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE players SET date_of_birth=?, updated_at=? WHERE id=?").bind(date, now, player.id),
      c.env.DB.prepare("DELETE FROM player_contacts WHERE player_id=?").bind(player.id),
      ...contacts.map((contact) => c.env.DB.prepare("INSERT INTO player_contacts (id, player_id, name, relationship, email, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(contact.id, contact.player_id, contact.name, contact.relationship, contact.email, contact.phone, now, now)),
    ]);
    return c.json({ player_id: player.id, date_of_birth: date, contacts });
  });
}
