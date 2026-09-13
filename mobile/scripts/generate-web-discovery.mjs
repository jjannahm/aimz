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

const headers = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; connect-src 'self' ${apiOrigin}; img-src 'self' data: blob: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
${production ? '' : '  X-Robots-Tag: noindex, nofollow\n'}
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
