const normalizeBaseUrl = (value: string) => value.replace(/\/$/, '');

export const appConfig = {
  apiBaseUrl: normalizeBaseUrl(
    process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000',
  ),
  livePollingIntervalMs: 12_000,
  requestTimeoutMs: 8_000,
} as const;
