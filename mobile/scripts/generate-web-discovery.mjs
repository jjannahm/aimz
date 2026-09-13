import { writeFile } from 'node:fs/promises';

const distUrl = new URL('../dist/', import.meta.url);
const environment = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';
const production = environment === 'production';
const origin = (process.env.EXPO_PUBLIC_WEB_ORIGIN ?? 'https://aimz-egypt-staging.pages.dev').replace(/\/$/u, '');
const apiOrigin = process.env.EXPO_PUBLIC_API_URL ? new URL(process.env.EXPO_PUBLIC_API_URL).origin : 'http://127.0.0.1:*';
const publicPaths = ['/', '/privacy', '/terms', '/cookies'];

const robots = production
  ? `User-agent: *\nAllow: /\nDisallow: /login\nDisallow: /register\nDisallow: /reset-password\nSitemap: ${origin}/sitemap.xml\n`
  : 'User-agent: *\nDisallow: /\n';

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${publicPaths.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join('\n')}
</urlset>
`;

// The app is never meant to be framed: `frame-ancestors` and X-Frame-Options
// keep another site from overlaying it to steal a tap on "Delete account" or
// a scoring button. HSTS keeps every later visit on HTTPS.
const policy = (extra = {}) => Object.entries({
  'default-src': "'self'",
  'connect-src': `'self' ${apiOrigin}`,
  'img-src': "'self' data: blob: https:",
  'font-src': "'self' data:",
  'style-src': "'self' 'unsafe-inline'",
  'script-src': "'self'",
  'frame-src': "'none'",
  'manifest-src': "'self'",
  'worker-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'frame-ancestors': "'none'",
  ...extra,
}).map(([directive, value]) => `${directive} ${value}`).join('; ');

// The static application form is the one page that loads Cloudflare
// Turnstile. "!" drops the site-wide policy first: Pages joins two policies
// set for the same path, and a browser enforces both.
const turnstile = { 'script-src': "'self' https://challenges.cloudflare.com", 'frame-src': 'https://challenges.cloudflare.com' };

const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Content-Security-Policy: ${policy()}
${production ? '' : '  X-Robots-Tag: noindex, nofollow\n'}
/apply
  ! Content-Security-Policy
  Content-Security-Policy: ${policy(turnstile)}

/apply/*
  ! Content-Security-Policy
  Content-Security-Policy: ${policy(turnstile)}

/_expo/static/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=86400

/aimz-icon-*.png
  Cache-Control: public, max-age=86400
`;

await Promise.all([
  writeFile(new URL('robots.txt', distUrl), robots),
  writeFile(new URL('sitemap.xml', distUrl), sitemap),
  writeFile(new URL('_headers', distUrl), headers),
]);

console.log(`generate-web-discovery: ${production ? 'indexable production' : 'blocked non-production'} files for ${origin}.`);
