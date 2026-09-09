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
async function paletteColors() {
  const source = await readFile(themePath, 'utf8');
  const read = (palette, key) => {
    const block = source.slice(source.indexOf(palette));
    const match = new RegExp(`${key}:\\s*'(#[0-9A-Fa-f]{6})'`).exec(block);
    if (!match) throw new Error(`inject-web-branding: no ${key} colour found for ${palette}.`);
    return match[1];
  };
  const of = (palette) => ({ background: read(palette, 'background'), muted: read(palette, 'textMuted') });
  return { dark: of('const dark = {'), light: of('export const lightColors') };
}

let html = await readFile(indexPath, 'utf8');

if (!html.includes('manifest.webmanifest')) {
  const { dark, light } = await paletteColors();
  const branding = [
    '<link rel="manifest" href="/manifest.webmanifest"/>',
    '<link rel="apple-touch-icon" href="/aimz-icon-192.png"/>',
    '<meta name="application-name" content="AIMZ Egypt"/>',
    '<meta name="apple-mobile-web-app-title" content="AIMZ"/>',
    '<meta name="apple-mobile-web-app-capable" content="yes"/>',
    // The standards name for the same thing. Safari still reads the Apple one,
    // and every other browser warns in the console that it is deprecated.
    '<meta name="mobile-web-app-capable" content="yes"/>',
    `<style id="aimz-scheme">body{background-color:${light.background};overscroll-behavior-y:none}` +
      `@media (prefers-color-scheme:dark){body{background-color:${dark.background}}}</style>`,
    // What the page shows while the bundle downloads.
    //
    // Nothing painted here before, so a slow connection, a crash and a dead
    // server were one and the same black rectangle — which is exactly how a
    // working site came to be reported as broken. The mark and a turning ring
    // say the app is on its way, and after eight seconds it says so in words.
    //
    // No script: `#root` is empty until React mounts into it, so the sibling
    // rule takes the whole thing away the moment anything renders.
    `<style id="aimz-boot-style">#aimz-boot{align-items:center;color:${light.muted};display:flex;flex-direction:column;gap:20px;`
      + 'font:500 14px/1.4 system-ui,-apple-system,sans-serif;inset:0;justify-content:center;position:fixed;text-align:center}'
      + '#root:not(:empty)~#aimz-boot{display:none}'
      + '#aimz-boot img{height:56px;width:56px}'
      + '#aimz-boot i{animation:aimz-spin 900ms linear infinite;border:2px solid currentColor;border-radius:50%;'
      + 'border-top-color:transparent;display:block;height:22px;opacity:.7;width:22px}'
      + '#aimz-boot p{animation:aimz-say 300ms ease 8s forwards;margin:0;opacity:0;padding:0 24px}'
      + '@keyframes aimz-spin{to{transform:rotate(360deg)}}@keyframes aimz-say{to{opacity:1}}'
      + '@media (prefers-reduced-motion:reduce){#aimz-boot i{animation-duration:2s}}'
      + `@media (prefers-color-scheme:dark){#aimz-boot{color:${dark.muted}}}</style>`,
    // Printing is how a shared report becomes a PDF: every desktop browser and
    // iOS Safari offer Save as PDF inside their own print dialog, which is why
    // there is no PDF library in this app. The app pins itself to the viewport
    // and scrolls inside, so without this a print would produce one screenful
    // and stop; and a dark page would come out as a sheet of black ink.
    '<style id="aimz-print">@media print{'
      + 'html,body,#root{height:auto!important;overflow:visible!important;background:#fff!important}'
      + '*{background-color:transparent!important;color:#000!important;box-shadow:none!important;'
      + '-webkit-print-color-adjust:exact;print-color-adjust:exact}'
      + '[role="button"]{display:none!important}'
      + '}</style>',
  ].join('');
  html = html.replace('</head>', `${branding}</head>`);
  // Sits after #root so the CSS sibling rule can take it away; `aria-hidden`
  // because a screen reader announcing a spinner adds nothing to the wait.
  const boot = '<div id="aimz-boot" aria-hidden="true">'
    + '<img src="/aimz-icon-192.png" alt=""/><i></i>'
    + '<p>Still loading. The first visit downloads the whole app, which can take a moment on a slow connection.</p>'
    + '</div>';
  html = html.replace('</body>', `${boot}</body>`);
  await writeFile(indexPath, html);
}
