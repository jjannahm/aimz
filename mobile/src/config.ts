const normalizeBaseUrl = (value: string) => value.replace(/\/$/, '');
const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';
const isStaging = appEnvironment === 'staging';
const parseFlag = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : value.toLowerCase() === 'true';

const browserOrigin = () =>
  typeof window !== 'undefined' && window.location?.origin ? window.location.origin : undefined;

/**
 * Every release bundle — a store build, an internal preview, a web export —
 * has `__DEV__` false. That is the signal worth trusting, rather than
 * EXPO_PUBLIC_APP_ENV: the mistake this guards against is a build profile with
 * no `env` block at all, and such a profile has not set APP_ENV either, so it
 * would read as development and sail straight past the check.
 */
const isReleaseBundle = typeof __DEV__ === 'boolean' ? !__DEV__ : false;

/**
 * A fallback host is a convenience while developing and a trap once we ship. A
 * release build missing this variable still launches, quietly talking to
 * localhost or to staging, so the mistake reaches families instead of us. Here
 * the absence stops the bundle rather than being papered over.
 */
const required = (name: string, value: string | undefined, fallback: string) => {
  if (value) return value;
  if (isReleaseBundle) {
    throw new Error(
      `${name} must be set for a release build. Add it to that profile's "env" block in eas.json.`,
    );
  }
  return fallback;
};

/**
 * Passwords, sessions and children's details all travel to this address, so a
 * release build refuses one that is not HTTPS. Loopback is exempt because it
 * never leaves the machine; anything else over plain HTTP would put every sign-in
 * on the network in the clear, which is exactly what an ALB address without a
 * certificate would do.
 */
export const requireSecureApiUrl = (value: string, release: boolean) => {
  // Matched as text rather than parsed with URL, whose getters are not
  // implemented on every React Native runtime this bundle may start on.
  const secure = /^https:\/\/[^/\s]+/iu.test(value);
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/iu.test(value);
  if (release && !secure && !loopback) {
    throw new Error(`EXPO_PUBLIC_API_URL must use HTTPS in a release build (got ${value.split('/').slice(0, 3).join('/')}).`);
  }
  return value;
};

export const appConfig = {
  apiBaseUrl: normalizeBaseUrl(requireSecureApiUrl(
    required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL, 'http://127.0.0.1:8000'),
    isReleaseBundle,
  )),
  environment: appEnvironment,
  /**
   * Where this app is served from, which is what a shared report link points
   * at — the reader opens a page, not the API. On the web the app already
   * knows; on a phone it has to be told, and outside a release build falls
   * back to the staging site.
   */
  webOrigin: normalizeBaseUrl(
    process.env.EXPO_PUBLIC_WEB_ORIGIN
    ?? browserOrigin()
    ?? required('EXPO_PUBLIC_WEB_ORIGIN', undefined, 'https://aimz-egypt-staging.pages.dev'),
  ),
  isStaging,
  enableMedia: parseFlag(process.env.EXPO_PUBLIC_ENABLE_MEDIA, true),
  enablePasswordReset: parseFlag(process.env.EXPO_PUBLIC_ENABLE_PASSWORD_RESET, true),
  livePollingIntervalMs: 12_000,
  requestTimeoutMs: isStaging ? 15_000 : 8_000,
  wakeTimeoutMs: 15_000,
} as const;
