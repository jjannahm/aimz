import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerAuditRoutes } from "./audit";
import { registerAuthRoutes } from "./auth";
import { registerDomainRoutes } from "./domain";
import { ApiProblem, errorResponse } from "./helpers";
import { registerKnockoutRoutes } from "./knockout";
import { registerMatchRoutes } from "./matches";
import { registerStatsRoutes } from "./stats";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => cors({
  origin: (origin) => origin === c.env.FRONTEND_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(origin) ? origin : c.env.FRONTEND_ORIGIN,
  allowHeaders: ["Authorization", "Content-Type", "If-None-Match"],
  exposeHeaders: ["ETag"],
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  maxAge: 86400,
})(c, next));

app.get("/api/v1/health", (c) => c.json({ status: "ok", service: "aimz-api", version: "0.2.0", environment: c.env.ENVIRONMENT }));
app.get("/api/v1/health/ready", async (c) => {
  await c.env.DB.prepare("SELECT 1 AS ready").first();
  return c.json({ status: "ready" });
});

registerAuthRoutes(app);
registerDomainRoutes(app);
registerMatchRoutes(app);
registerStatsRoutes(app);
registerAuditRoutes(app);
registerKnockoutRoutes(app);

app.post("/api/v1/media/uploads/presign", () => { throw new ApiProblem(503, "media_disabled", "Photo uploads are disabled in this staging preview."); });
app.notFound((c) => errorResponse(c, new ApiProblem(404, "not_found", "The requested endpoint was not found.")));
app.onError((error, c) => {
  if (error instanceof ApiProblem) return errorResponse(c, error);
  console.error(JSON.stringify({ message: "request failed", error: error instanceof Error ? error.message : String(error), path: c.req.path }));
  return errorResponse(c, new ApiProblem(503, "internal_error", "The AIMZ preview could not complete this request."));
});

export default app;
