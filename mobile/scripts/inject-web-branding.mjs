import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../dist/index.html', import.meta.url);
let html = await readFile(indexPath, 'utf8');

if (!html.includes('manifest.webmanifest')) {
  const branding = [
    '<link rel="manifest" href="/manifest.webmanifest"/>',
    '<link rel="apple-touch-icon" href="/aimz-icon-192.png"/>',
    '<meta name="application-name" content="AIMZ Egypt"/>',
    '<meta name="apple-mobile-web-app-title" content="AIMZ"/>',
    '<meta name="apple-mobile-web-app-capable" content="yes"/>',
  ].join('');
  html = html.replace('</head>', `${branding}</head>`);
  await writeFile(indexPath, html);
}
