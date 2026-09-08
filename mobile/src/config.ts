const normalizeBaseUrl = (value: string) => value.replace(/\/$/, '');
const appEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';
const isStaging = appEnvironment === 'staging';
const parseFlag = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : value.toLowerCase() === 'true';

export const appConfig = {
  apiBaseUrl: normalizeBaseUrl(
    process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000',
  ),
  environment: appEnvironment,
  /**
   * Where this app is served from, which is what a shared report link points
   * at — the reader opens a page, not the API. On the web the app already
   * knows; on a phone it has to be told, and falls back to the staging site.
   */
  webOrigin: normalizeBaseUrl(
    process.env.EXPO_PUBLIC_WEB_ORIGIN
    ?? (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://aimz-egypt-staging.pages.dev'),
  ),
  isStaging,
  enableMedia: parseFlag(process.env.EXPO_PUBLIC_ENABLE_MEDIA, true),
  enablePasswordReset: parseFlag(process.env.EXPO_PUBLIC_ENABLE_PASSWORD_RESET, true),
  livePollingIntervalMs: 12_000,
  requestTimeoutMs: isStaging ? 15_000 : 8_000,
  wakeTimeoutMs: 15_000,
} as const;
