interface Env {
  /** Secret binding provisioned with `wrangler secret put`; never stored in config. */
  TURNSTILE_SECRET: string;
}
