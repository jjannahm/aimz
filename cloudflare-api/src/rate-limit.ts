import type { Context } from "hono";
import { ApiProblem } from "./helpers";

/**
 * Guards on the endpoints anybody can reach without being signed in, and on
 * the one place a signed-in session can guess at a password.
 *
 * Cloudflare's rate limiting binding counts per location rather than globally,
 * so these are a brake on abuse and not an accounting system: a distributed
 * attempt spread across colos gets more attempts than one number suggests.
 * That is the right trade here — the alternative is a coordinated counter on
 * every login, which would cost a round trip on the hot path to buy precision
 * nobody is asking for.
 *
 * Every limiter is optional at runtime. `wrangler dev` without the binding, and
 * the integration tests, simply run unguarded rather than failing closed on an
 * endpoint that has to work.
 */
export interface RateLimiters {
  /** One account's sign-in attempts, whoever is making them. */
  LOGIN_BY_ACCOUNT?: RateLimit;
  /** One address's sign-in attempts. Deliberately loose: see below. */
  LOGIN_BY_IP?: RateLimit;
  /** One refresh token being presented over and over. */
  REFRESH_BY_TOKEN?: RateLimit;
  /** One address refreshing. Looser still — a household has several devices. */
  REFRESH_BY_IP?: RateLimit;
  /** One address looking up invitation codes, which are credentials too. */
  INVITE_BY_IP?: RateLimit;
  /** One address registering, which also spends an invitation code. */
  REGISTER_BY_IP?: RateLimit;
  /** One signed-in account guessing at its own current password. */
  PASSWORD_BY_ACCOUNT?: RateLimit;
}

/**
 * The address a request came from, as Cloudflare saw it.
 *
 * Absent only when something upstream has stripped it, in which case every
 * caller shares the one bucket. That is the safe direction: a shared bucket
 * throttles, it does not admit.
 */
export function clientAddress(c: Context): string {
  return c.req.header("CF-Connecting-IP") ?? c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Ask one limiter, and refuse with 429 if it says no.
 *
 * The refusal says which bucket ran out — an account or an address — because
 * "try again shortly" with no reason is the kind of message that generates a
 * support call. It does not say how many attempts are left, which would be a
 * tuning guide for anybody probing it.
 */
export async function enforce(
  limiter: RateLimit | undefined,
  key: string,
  bucket: "account" | "address",
  detail: string,
): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (success) return;
  // Rare by construction, so logged in full rather than sampled: each line is
  // either an attack in progress or a limit set too tight, and both are worth
  // seeing whole.
  console.warn(JSON.stringify({ message: "rate limited", bucket }));
  throw new ApiProblem(429, "rate_limited", detail);
}
