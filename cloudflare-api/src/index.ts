import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerAuditRoutes } from "./audit";
import { registerAnnouncementRoutes } from "./announcements";
import { registerAuthRoutes } from "./auth";
import { registerCalendarRoutes } from "./calendar";
import { registerDomainRoutes } from "./domain";
import { registerFeeRoutes } from "./fees";
import { ApiProblem, currentUser, errorResponse } from "./helpers";
import { registerKitRoutes } from "./kit";
import { registerKnockoutRoutes } from "./knockout";
import { registerMatchRoutes } from "./matches";
import { registerMediaRoutes } from "./media";
import { registerNewcomerRoutes } from "./newcomers";
import { registerInvoiceRoutes } from "./invoices";
import { registerMatchReportRoutes } from "./match-reports";
import { registerReportRoutes } from "./reports";
import { purgeExpiredAudit } from "./retention";
import { registerAttendanceRequestRoutes } from "./attendance-requests";
import { registerBranchRoutes } from "./branches";
import { registerPlayerInformationRoutes } from "./player-information";
import { registerRosterRoutes } from "./roster";
import { registerStatsRoutes } from "./stats";
import { registerTrainingRoutes } from "./training";
import { registerTrainingStatsRoutes } from "./training-stats";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (c, next) => cors({
  origin: (origin) => origin === c.env.FRONTEND_ORIGIN || origin === c.env.PUBLIC_FORM_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(origin) ? origin : c.env.FRONTEND_ORIGIN,
  allowHeaders: ["Authorization", "Content-Type", "If-None-Match"],
  exposeHeaders: ["ETag"],
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  maxAge: 86400,
})(c, next));

/**
 * The handful of addresses that must answer a stranger.
 *
 * Everything else behind /api/v1 requires a signed-in account. The roster is
 * the names of children: it was readable by anyone who knew the address,
 * because authorisation was written per route and the read routes never
 * received any. A gate in front of all of them cannot be forgotten by the next
 * route somebody adds, which is the whole reason it lives here rather than in
 * each module.
 */
const PUBLIC_ROUTES: { method: string; path: RegExp }[] = [
  // Liveness and readiness, which a deploy checks before an account exists.
  { method: "GET", path: /^\/api\/v1\/health(\/ready)?$/u },
  // The ways in, and the way back in.
  { method: "POST", path: /^\/api\/v1\/auth\/(login|register|refresh|logout|password-reset\/(request|confirm))$/u },
  { method: "POST", path: /^\/api\/v1\/auth\/invitations\/resolve$/u },
  { method: "POST", path: /^\/api\/v1\/newcomer-applications$/u },
  // A calendar client polls this with no headers it can be given; the random
  // token in the address is the whole of the credential.
  { method: "GET", path: /^\/api\/v1\/calendar\/[^/]+\/aimz\.ics$/u },
  // A report handed to a family, whose address is the whole of the credential.
  { method: "GET", path: /^\/api\/v1\/reports\/[^/]+$/u },
  // And the same bargain for a match report sent to a parents' group.
  { method: "GET", path: /^\/api\/v1\/match-reports\/[^/]+$/u },
  // And for an invoice sent to one family.
  { method: "GET", path: /^\/api\/v1\/invoices\/[^/]+$/u },
  // Badges and photos are fetched by <img>, which sends no Authorization; and
  // an upload authorises itself with the signed token in its own body.
  { method: "GET", path: /^\/api\/v1\/media\/.+$/u },
  { method: "POST", path: /^\/api\/v1\/media\/uploads$/u },
];

const isPublic = (method: string, path: string) =>
  method === "OPTIONS" || PUBLIC_ROUTES.some((route) => route.method === method && route.path.test(path));

app.use("/api/*", async (c, next) => {
  if (isPublic(c.req.method, c.req.path)) return next();
  // Throwing here rather than returning lets onError render it in the same
  // shape every other refusal takes.
  const user = await currentUser(c);
  const pendingAllowed = /^\/api\/v1\/users\/me$/u.test(c.req.path)
    || c.req.path === "/api/v1/auth/password/change";
  if (user.onboarding_status === "pending" && !pendingAllowed) {
    throw new ApiProblem(403, "approval_pending", "Your player application is awaiting approval.");
  }
  if (user.onboarding_status === "declined" && !pendingAllowed) {
    throw new ApiProblem(403, "application_declined", "This player application was declined.");
  }
  return next();
});

app.get("/api/v1/health", (c) => c.json({ status: "ok", service: "aimz-api", version: "0.2.0", environment: c.env.ENVIRONMENT }));
app.get("/api/v1/health/ready", async (c) => {
  await c.env.DB.prepare("SELECT 1 AS ready").first();
  return c.json({ status: "ready" });
});

registerAuthRoutes(app);
registerNewcomerRoutes(app);
registerKitRoutes(app);
registerDomainRoutes(app);
registerMatchRoutes(app);
registerStatsRoutes(app);
registerAuditRoutes(app);
registerKnockoutRoutes(app);
registerTrainingRoutes(app);
registerTrainingStatsRoutes(app);
registerAnnouncementRoutes(app);
registerRosterRoutes(app);
registerPlayerInformationRoutes(app);
registerBranchRoutes(app);
registerAttendanceRequestRoutes(app);
registerMediaRoutes(app);
registerCalendarRoutes(app);
registerFeeRoutes(app);
registerReportRoutes(app);
registerMatchReportRoutes(app);
registerInvoiceRoutes(app);

app.notFound((c) => errorResponse(c, new ApiProblem(404, "not_found", "The requested endpoint was not found.")));
app.onError((error, c) => {
  if (error instanceof ApiProblem) return errorResponse(c, error);
  console.error(JSON.stringify({ message: "request failed", error: error instanceof Error ? error.message : String(error), path: c.req.path }));
  return errorResponse(c, new ApiProblem(503, "internal_error", "The AIMZ preview could not complete this request."));
});

/**
 * The worker itself: the API, plus the timer that keeps the activity log to a
 * month. The Hono app is exported by name as well, because the integration
 * tests drive it through `app.request` rather than through `fetch`.
 */
export { app };
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purgeExpiredAudit(env).then(
      (deleted) => { if (deleted) console.log(JSON.stringify({ message: "purged expired activity", deleted })); },
      (error: unknown) => { console.error(JSON.stringify({ message: "activity purge failed", error: error instanceof Error ? error.message : String(error) })); },
    ));
  },
} satisfies ExportedHandler<Env>;
