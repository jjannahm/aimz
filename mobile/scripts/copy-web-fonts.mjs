import { copyFile, mkdir, readdir } from 'node:fs/promises';

/**
 * Lift the app's fonts out of a directory the host will not serve.
 *
 * Metro writes a bundled asset to a path that mirrors where it came from, so a
 * font installed by pnpm lands under `dist/assets/node_modules/.pnpm/...`.
 * Cloudflare Pages does not serve dot directories, and `_redirects` sends
 * anything it cannot find to `index.html` with a 200 — so the request succeeds,
 * returns HTML, fails to parse as a font, and every screen quietly falls back to
 * a system face. The same thing happened to the icon font, which is why a copy
 * of it sits in `public/fonts` and is loaded from there on web.
 *
 * Rather than commit a copy of each weight, they are lifted here after the
 * export, to the stable `/fonts/<Family>.ttf` path `app/_layout.tsx` asks for on
 * web. The content hash is dropped: the name has to be predictable for the app
 * to name it, and these are immutable for a given build anyway.
 */
const distUrl = new URL('../dist/', import.meta.url);
const assetsUrl = new URL('assets/', distUrl);
const fontsUrl = new URL('fonts/', distUrl);

/** Every `.ttf` under a directory whose path names a Google font package. */
async function googleFonts(directory, insidePackage = false) {
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const child = new URL(`${encodeURIComponent(entry.name)}${entry.isDirectory() ? '/' : ''}`, directory);
    if (entry.isDirectory()) {
      found.push(...await googleFonts(child, insidePackage || entry.name.includes('expo-google-fonts')));
    } else if (insidePackage && entry.name.endsWith('.ttf')) {
      found.push({ url: child, name: entry.name });
    }
  }
  return found;
}

const fonts = await googleFonts(assetsUrl);

// Nothing to copy means either the fonts stopped being bundled or Metro changed
// where it puts them. Both are silent breakages on the deployed site, so this
// fails the build rather than shipping a page that renders in the wrong face.
if (fonts.length === 0) {
  console.error('\ncopy-web-fonts failed:\n  - no @expo-google-fonts .ttf found under dist/assets.\n');
  process.exit(1);
}

await mkdir(fontsUrl, { recursive: true });
for (const font of fonts) {
  // `Roboto_400Regular.678ba85b….ttf` is asked for as `Roboto_400Regular.ttf`.
  const family = font.name.split('.')[0];
  await copyFile(font.url, new URL(`${family}.ttf`, fontsUrl));
}

console.log(`copy-web-fonts: served ${fonts.length} font${fonts.length === 1 ? '' : 's'} from /fonts.`);
