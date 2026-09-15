import { copyFile, mkdir, readdir } from 'node:fs/promises';

/**
 * Lift the app-association files into the deployed root.
 *
 * `public/` is copied into `dist/` by the export, but not `public/.well-known`:
 * the dot directory is skipped, so the two files that prove this site and the
 * app belong together never reach the deploy. `_redirects` then sends the
 * request to `index.html` with a 200, and both
 * `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
 * answer with HTML.
 *
 * Nothing about that looks broken from a browser. It breaks somewhere no test
 * was watching: Apple fetches the first file to verify an associated domain and
 * Android fetches the second to verify an App Link, both expect JSON, and both
 * silently stop opening `/join/CODE` in the app. An invitation link then lands
 * in a browser instead of the app it was cut for.
 *
 * The same class of problem as the fonts next door, and the same remedy: copy
 * them out after the export rather than hope the bundler starts including them.
 */
const source = new URL('../public/.well-known/', import.meta.url);
const destination = new URL('../dist/.well-known/', import.meta.url);

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
console.log(`Copied ${files.length} app-association file(s) into dist/.well-known.`);
