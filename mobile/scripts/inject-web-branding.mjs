import { readFile, writeFile } from 'node:fs/promises';

const indexPath = new URL('../dist/index.html', import.meta.url);
const themePath = new URL('../src/theme/index.ts', import.meta.url);

/**
 * Read one palette's background straight out of the theme module.
 *
 * The export ignores `app/+html.tsx` — `web.output` is `single`, so Expo builds
 * `index.html` from its own template — which leaves this script as the only
 * place the document can be told what to paint before the app hydrates. Reading
 * the value rather than repeating it keeps the two from drifting apart.
 */
async function backgroundColors() {
  const source = await readFile(themePath, 'utf8');
  const read = (palette) => {
    const block = source.slice(source.indexOf(palette));
    const match = /background:\s*'(#[0-9A-Fa-f]{6})'/.exec(block);
    if (!match) throw new Error(`inject-web-branding: no background colour found for ${palette}.`);
    return match[1];
  };
  return { dark: read('const dark = {'), light: read('export const lightColors') };
}

let html = await readFile(indexPath, 'utf8');

if (!html.includes('manifest.webmanifest')) {
  const { dark, light } = await backgroundColors();
  const branding = [
    '<link rel="manifest" href="/manifest.webmanifest"/>',
    '<link rel="apple-touch-icon" href="/aimz-icon-192.png"/>',
    '<meta name="application-name" content="AIMZ Egypt"/>',
    '<meta name="apple-mobile-web-app-title" content="AIMZ"/>',
    '<meta name="apple-mobile-web-app-capable" content="yes"/>',
    `<style id="aimz-scheme">body{background-color:${light};overscroll-behavior-y:none}` +
      `@media (prefers-color-scheme:dark){body{background-color:${dark}}}</style>`,
  ].join('');
  html = html.replace('</head>', `${branding}</head>`);
  await writeFile(indexPath, html);
}
