import { appConfig } from '@/src/config';

/**
 * Resolves a stored image to something `<Image>` can load.
 *
 * The Cloudflare API serves media from its own origin and returns the path
 * root-relative; the Python backend returns an absolute signed S3 URL. Passing
 * an absolute URL straight through keeps both working from one call site.
 */
export function mediaUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^(https?:|data:|blob:|file:)/u.test(value)) return value;
  return `${appConfig.apiBaseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
}
