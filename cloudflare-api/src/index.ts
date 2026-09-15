import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { registerAuditRoutes } from "./audit";
import { registerAnnouncementRoutes } from "./announcements";
import { registerAuthRoutes } from "./auth";
import { registerCalendarRoutes } from "./calendar";
import { registerDomainRoutes } from "./domain";
import { registerFeeRoutes } from "./fees";
import { encryptionConfigured, sealLegacyHealthData } from "./field-crypto";
import { ApiProblem, currentUser, errorResponse, isProduction } from "./helpers";
import { registerKitRoutes } from "./kit";
import { registerKnockoutRoutes } from "./knockout";
import { registerMatchRoutes } from "./matches";
import { maxUploadBytes, registerMediaRoutes } from "./media";
import { registerNewcomerRoutes } from "./newcomers";
import { registerInvoiceRoutes } from "./invoices";
import { registerMatchReportRoutes } from "./match-reports";
import { registerReportRoutes } from "./reports";
import { purgeExpiredAudit, purgeSpentSessions } from "./retention";
import { registerAttendanceRequestRoutes } from "./attendance-requests";
import { registerBranchRoutes } from "./branches";
import { registerPlayerInformationRoutes } from "./player-information";
import { registerRosterRoutes } from "./roster";
import { registerStatsRoutes } from "./stats";
import { registerTrainingRoutes } from "./training";
import { registerTrainingStatsRoutes } from "./training-stats";

const app = new Hono<{ Bindings: Env }>();

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/u;
const MEDIA_READ = /^\/api\/v1\/media\/(?!uploads(\/|$))/u;
/** Room for every JSON body the app sends; a bulk squad or a register is a few kilobytes. */
const JSON_BODY_LIMIT = 1_048_576;

/**
 * The rate limiters production will not start without.
 *
 * Named here rather than inferred, so adding a limiter to the config without
 * adding it to this list is a deliberate omission rather than an oversight.
 */
const REQUIRED_LIMITERS = [
  "LOGIN_BY_ACCOUNT",
  "LOGIN_BY_IP",
  "REFRESH_BY_TOKEN",
  "REFRESH_BY_IP",
  "INVITE_BY_IP",
  "REGISTER_BY_IP",
  "PASSWORD_BY_ACCOUNT",
] as const satisfies readonly (keyof Env)[];

/**
 * Headers every response carries, whatever route produced it.
 *
 * The API serves JSON, a calendar file and images, and none of them is ever a
 * page: nothing here should run script, be framed, or send a referrer. Images
 * are the one thing the app's own origin embeds with <img>, so only they may
 * be read cross-origin, and they are sandboxed in case one is ever opened on
 * its own.
 */
function applySecurityHeaders(c: Context): void {
  const headers = c.res.headers;
  const media = c.req.method === "GET" && MEDIA_READ.test(c.req.path);
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Resource-Policy", media ? "cross-origin" : "same-origin");
  headers.set("Content-Security-Policy", media
    ? "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
    : "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}

app.use("*", async (c, next) => {
  // Plain HTTP is refused before anything reads the request, so a password or
  // a token never travels unencrypted even once. `cf` is attached by
  // Cloudflare's edge: a request without it is the test harness calling the
  // app directly, and loopback is local development.
  const url = new URL(c.req.url);
  if (url.protocol === "http:" && c.req.raw.cf && !LOOPBACK_HOST.test(url.hostname)) {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return errorResponse(c, new ApiProblem(403, "https_required", "Use HTTPS to reach the AIMZ API."));
    }
    url.protocol = "https:";
    return c.redirect(url.toString(), 308);
  }
  await next();
  applySecurityHeaders(c);
  // API answers are about somebody's squad, family or account, so nothing keeps
  // them unless the handler has said how: the live poll's `private, no-cache` is
  // what lets it answer 304, and a shared report may be held privately for five
  // minutes. Crests are public and served with their own long-lived policy.
  const publicTeamMedia = c.req.method === "GET" && c.req.path.startsWith("/api/v1/media/teams/");
  if (c.req.path.startsWith("/api/") && !publicTeamMedia && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }
});

app.use("/api/*", async (c, next) => cors({
  // Local browser development may call a staging API; nothing on a developer's
  // machine may call production.
  origin: (origin) => origin === c.env.FRONTEND_ORIGIN || origin === c.env.PUBLIC_FORM_ORIGIN
    || (!isProduction(c.env) && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/u.test(origin)) ? origin : c.env.FRONTEND_ORIGIN,
  allowHeaders: ["Authorization", "Content-Type", "If-None-Match"],
  exposeHeaders: ["ETag", "Retry-After"],
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
  maxAge: 86400,
})(c, next));

/**
 * Production refuses to run half-configured.
 *
 * A short signing secret can be brute-forced into forged sessions, and without
 * the encryption key health notes would be written in the clear. Either is
 * worse than an API that answers 503 until somebody sets the secret, and the
 * readiness probe a deploy runs fails the same way, so it is caught there.
 */
app.use("/api/*", async (c, next) => {
  if (!isProduction(c.env) || c.req.path === "/api/v1/health") return next();
  const missing = [
    ...(c.env.JWT_SECRET?.length >= 32 ? [] : ["JWT_SECRET"]),
    ...(encryptionConfigured(c.env) ? [] : ["DATA_ENCRYPTION_KEY"]),
    // Every limiter is optional in `Env` so that `wrangler dev` and the tests
    // run unguarded rather than failing closed on sign-in. That is the right
    // trade there and the wrong one here: a `ratelimits` block dropped from
    // wrangler.jsonc would take the brakes off login and off invitation-code
    // guessing, and nothing would say so. Production insists on them.
    ...REQUIRED_LIMITERS.filter((name) => !c.env[name]),
  ];
  if (!missing.length) return next();
  console.error(JSON.stringify({ message: "production configuration incomplete", missing }));
  throw new ApiProblem(503, "service_misconfigured", "The AIMZ API is not ready yet.");
});

app.use("/api/*", async (c, next) => bodyLimit({
  maxSize: c.req.path === "/api/v1/media/uploads" ? maxUploadBytes(c.env) + 65_536 : JSON_BODY_LIMIT,
  onError: (context) => errorResponse(context, new ApiProblem(413, "payload_too_large", "That request is too large.")),
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
/**
 * What an unexpected failure is allowed to say.
 *
 * The reader gets nothing: a generic 503, no stack, no SQL, no table names.
 * The log gets enough to find the fault and no more. A D1 constraint violation
 * reports the value that violated it — an email, a child's name — so the raw
 * message is not written down. The error's class, the path and a short digest
 * are enough to group failures and match a report to a log line; the digest is
 * stable for the same message, so a recurring fault is recognisable without the
 * message ever being stored.
 */
async function faultDigest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash).slice(0, 6), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

app.onError(async (error, c) => {
  if (error instanceof ApiProblem) return errorResponse(c, error);
  console.error(JSON.stringify({
    message: "request failed",
    kind: error instanceof Error ? error.name : typeof error,
    digest: await faultDigest(error instanceof Error ? error.message : String(error)),
    path: c.req.path,
  }));
  return errorResponse(c, new ApiProblem(503, "internal_error", "The AIMZ preview could not complete this request."));
});

/**
 * The worker itself: the API, plus the timer that keeps the activity log to a
 * month, sweeps spent sessions, and seals any health notes written before
 * encryption was switched on. The Hono app is exported by name as well,
 * because the integration tests drive it through `app.request` rather than
 * through `fetch`.
 */
export { app };
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const sweep = async () => {
      const [activity, sessions, sealed] = await Promise.all([purgeExpiredAudit(env), purgeSpentSessions(env), sealLegacyHealthData(env)]);
      if (activity || sessions || sealed) console.log(JSON.stringify({ message: "nightly purge", activity, sessions, sealed }));
    };
    ctx.waitUntil(sweep().catch((error: unknown) => {
      console.error(JSON.stringify({ message: "nightly purge failed", error: error instanceof Error ? error.message : String(error) }));
    }));
  },
} satisfies ExportedHandler<Env>;
