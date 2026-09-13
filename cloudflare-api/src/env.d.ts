interface Env {
  /** Secret binding provisioned with `wrangler secret put`; never stored in config. */
  TURNSTILE_SECRET: string;
  /**
   * Rate limiting bindings, declared in `wrangler.jsonc`.
   *
   * Optional so that `wrangler dev` and the integration tests, which have no
   * such binding, run unguarded rather than failing closed on sign-in.
   */
  LOGIN_BY_ACCOUNT?: RateLimit;
  LOGIN_BY_IP?: RateLimit;
  REFRESH_BY_TOKEN?: RateLimit;
  REFRESH_BY_IP?: RateLimit;
  INVITE_BY_IP?: RateLimit;
  REGISTER_BY_IP?: RateLimit;
  PASSWORD_BY_ACCOUNT?: RateLimit;
  /**
   * Seals health notes at rest (src/field-crypto.ts). A secret, at least 32
   * random characters; required in production, optional in staging.
   */
  DATA_ENCRYPTION_KEY?: string;
}
