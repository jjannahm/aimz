import type { Hono } from "hono";
import { ApiProblem, adminUser, currentUser, jsonObject, nowIso, parsePagination, stringField } from "./helpers";
import { isGoalkeeper } from "./goalkeeping";
import { linkedPlayerIds } from "./team-access";
import type { UserRow } from "./types";

type App = Hono<{ Bindings: Env }>;

const SIZES = ["S", "M", "L", "XL"] as const;
const STATUSES = ["ordered", "fulfilled", "cancelled"] as const;

/**
 * The players an account may order for: an administrator orders for anybody,
 * a family for their own. A coach is not on this list — kit is bought by the
 * people who wear it, and a squad's staff have no business filling in sizes.
 */
async function orderableFor(env: Env, user: UserRow): Promise<string[] | "all"> {
  if (user.role === "admin") return "all";
  return linkedPlayerIds(env, user);
}

function size(body: Record<string, unknown>, field: string): string {
  const value = stringField(body, field, { min: 1, max: 3 })!.toUpperCase();
  if (!(SIZES as readonly string[]).includes(value)) {
    throw new ApiProblem(422, "validation_error", `Choose a ${field.replace("_", " ")} from the sizes offered.`);
  }
  return value;
}

/** The order with the player it is for, which is where the name comes from. */
const ORDER_SELECT = `SELECT o.*, p.name player_name, p.team_id, t.name squad_name
  FROM kit_orders o JOIN players p ON p.id = o.player_id
  LEFT JOIN teams t ON t.id = p.team_id`;

export function registerKitRoutes(app: App): void {
  /** A family's own orders, or the whole book for an administrator. */
  app.get("/api/v1/kit-orders", async (c) => {
    const user = await currentUser(c);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const allowed = await orderableFor(c.env, user);
    const clauses: string[] = [];
    const bindings: (string | number)[] = [];
    if (allowed !== "all") {
      clauses.push(`o.player_id IN (${allowed.map(() => "?").join(",")})`);
      bindings.push(...allowed);
    }
    const status = url.searchParams.get("status");
    if (status && (STATUSES as readonly string[]).includes(status)) { clauses.push("o.status=?"); bindings.push(status); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const [count, rows] = await Promise.all([
      c.env.DB.prepare(`SELECT count(*) total FROM kit_orders o ${where}`).bind(...bindings).first<{ total: number }>(),
      c.env.DB.prepare(`${ORDER_SELECT} ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).bind(...bindings, limit, offset).all(),
    ]);
    return c.json({ items: rows.results, total: count?.total ?? 0, limit, offset });
  });

  app.post("/api/v1/kit-orders", async (c) => {
    const user = await currentUser(c);
    const body = await jsonObject(c);
    const playerId = stringField(body, "player_id", { min: 1, max: 36 })!;
    const allowed = await orderableFor(c.env, user);
    // Checked before the player is even read, so a stranger cannot use this to
    // find out which ids exist.
    if (allowed !== "all" && !allowed.includes(playerId)) {
      throw new ApiProblem(403, "player_access_denied", "You can only order kit for your own family.");
    }
    const player = await c.env.DB.prepare(`SELECT p.id, p.position, t.name team_label
      FROM players p JOIN teams t ON t.id=p.team_id
      WHERE p.id=? AND p.is_active=1`).bind(playerId).first<{ id: string; position: string; team_label: string }>();
    if (!player) throw new ApiProblem(422, "player_not_found", "That player is not on the roster.");

    const number = body.shirt_number === null || body.shirt_number === undefined ? null : body.shirt_number;
    if (number !== null && (typeof number !== "number" || !Number.isInteger(number) || number < 0 || number > 99)) {
      throw new ApiProblem(422, "validation_error", "A shirt number is between 0 and 99.");
    }
    const kind = isGoalkeeper(player.position) ? "goalkeeper" : "player";
    const order = {
      id: crypto.randomUUID(),
      player_id: playerId,
      ordered_by_id: user.id,
      team_label: player.team_label,
      kind,
      shirt_name: stringField(body, "shirt_name", { min: 1, max: 60 })!,
      shirt_number: number,
      kit_size: size(body, "kit_size"),
      hoodie_size: size(body, "hoodie_size"),
      outwear_size: size(body, "outwear_size"),
      delivery: "branch",
      status: "ordered",
      notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await c.env.DB.prepare(`INSERT INTO kit_orders
      (id,player_id,ordered_by_id,team_label,kind,shirt_name,shirt_number,kit_size,hoodie_size,outwear_size,delivery,status,notes,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(order.id, order.player_id, order.ordered_by_id, order.team_label, order.kind, order.shirt_name,
        order.shirt_number, order.kit_size, order.hoodie_size, order.outwear_size, order.delivery,
        order.status, order.notes, order.created_at, order.updated_at).run();
    return c.json(await c.env.DB.prepare(`${ORDER_SELECT} WHERE o.id=?`).bind(order.id).first(), 201);
  });

  /**
   * Working the book: an order is paid for, or it is called off.
   *
   * `fulfilled` is what an administrator marking an order paid writes, and
   * `paid_at` is stamped the first time it does. Stamped once and kept: an
   * order put back in the queue by mistake was still paid for, and the date
   * money changed hands is not something a wrong tap should rewrite.
   */
  app.patch("/api/v1/admin/kit-orders/:id", async (c) => {
    await adminUser(c);
    const body = await jsonObject(c);
    const status = body.status;
    if (typeof status !== "string" || !(STATUSES as readonly string[]).includes(status)) {
      throw new ApiProblem(422, "validation_error", "Choose ordered, fulfilled or cancelled.");
    }
    const id = c.req.param("id");
    const result = status === "fulfilled"
      ? await c.env.DB.prepare("UPDATE kit_orders SET status=?,paid_at=COALESCE(paid_at,?),updated_at=? WHERE id=?")
        .bind(status, nowIso(), nowIso(), id).run()
      : await c.env.DB.prepare("UPDATE kit_orders SET status=?,updated_at=? WHERE id=?")
        .bind(status, nowIso(), id).run();
    if (!result.meta.changes) throw new ApiProblem(404, "kit_order_not_found", "Kit order not found.");
    return c.json(await c.env.DB.prepare(`${ORDER_SELECT} WHERE o.id=?`).bind(id).first());
  });
}
