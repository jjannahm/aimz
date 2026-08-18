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
  isStaging,
  enableMedia: parseFlag(process.env.EXPO_PUBLIC_ENABLE_MEDIA, true),
  enablePasswordReset: parseFlag(process.env.EXPO_PUBLIC_ENABLE_PASSWORD_RESET, true),
  livePollingIntervalMs: 12_000,
  requestTimeoutMs: isStaging ? 75_000 : 8_000,
  wakeTimeoutMs: 90_000,
} as const;
