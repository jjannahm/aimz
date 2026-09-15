import { appendFile, copyFile, mkdir, readdir } from 'node:fs/promises';

/**
 * Publish the app-association files at a path that actually gets deployed.
 *
 * Two separate things swallow these files, and the first one hides the second.
 *
 * `public/.well-known` is not copied into `dist` by the export, because the
 * directory starts with a dot. Copying it there by hand does not help either:
 * `wrangler pages deploy` skips dot directories when it uploads, so the files
 * still never reach the site. Both failures end the same way — the SPA fallback
 * answers `/.well-known/apple-app-site-association` with `index.html` and a
 * 200, which looks perfectly healthy from a browser.
 *
 * It is not healthy anywhere that matters. Apple fetches that file to verify an
 * associated domain and Android fetches `assetlinks.json` to verify an App
 * Link; both expect JSON, both get HTML, and both quietly stop opening
 * `/join/CODE` in the app. An invitation cut for a family lands in a browser.
 *
 * So the files are written to `dist/well-known/` — no dot, therefore uploaded —
 * and `_redirects` rewrites the real paths onto them with a 200, which is a
 * rewrite rather than a redirect because Apple does not follow redirects when
 * it verifies. `_headers` then sets the JSON content type: Apple requires
 * `application/json` and will reject the file without it, and the association
 * file deliberately has no extension for Pages to infer one from — left alone
 * it is served as `application/octet-stream`.
 *
 * This runs *after* `generate-web-discovery.mjs`, which rewrites `_headers`
 * wholesale. Running before it, these rules were appended and then thrown away,
 * and the only visible symptom was a content type nobody was looking at.
 */
const source = new URL('../public/.well-known/', import.meta.url);
const distUrl = new URL('../dist/', import.meta.url);
const destination = new URL('well-known/', distUrl);

let entries;
try {
  entries = await readdir(source, { withFileTypes: true });
} catch {
  console.error('public/.well-known is missing; universal links and App Links cannot be verified.');
  process.exit(1);
}

const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
if (!files.length) {
  console.error('public/.well-known holds no files.');
  process.exit(1);
}

await mkdir(destination, { recursive: true });
for (const file of files) {
  await copyFile(new URL(file, source), new URL(file, destination));
}

// Appended rather than written: `_redirects` and `_headers` are copied out of
// `public/` by the export and already carry rules of their own.
const rewrites = files.map((file) => `/.well-known/${file} /well-known/${file} 200`).join('\n');
await appendFile(new URL('_redirects', distUrl), `\n# App-association files, served from a path wrangler will upload.\n${rewrites}\n`, 'utf8');

const headers = files.map((file) => `/well-known/${file}\n  Content-Type: application/json\n  X-Robots-Tag: noindex`).join('\n');
await appendFile(new URL('_headers', distUrl), `\n${headers}\n`, 'utf8');

console.log(`Published ${files.length} app-association file(s) at /well-known, rewritten from /.well-known.`);
