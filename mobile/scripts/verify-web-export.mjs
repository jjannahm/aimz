import { readFile, readdir } from 'node:fs/promises';

/**
 * Fails the build when the exported bundle does not carry the environment it was
 * built for. `EXPO_PUBLIC_*` values are inlined at transform time, so a stale
 * Metro cache can silently produce a bundle that still points at localhost. That
 * shipped to the staging site once and broke it for every viewer.
 */
const distUrl = new URL('../dist/', import.meta.url);
const expectedApiUrl = process.env.EXPO_PUBLIC_API_URL;
const expectedEnvironment = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

const html = await readFile(new URL('index.html', distUrl), 'utf8');
const bundlePaths = [...html.matchAll(/src="\/(_expo\/static\/js\/web\/[^"]+\.js)"/g)].map((match) => match[1]);

if (bundlePaths.length === 0) {
  throw new Error('verify-web-export: no JavaScript bundle referenced by dist/index.html.');
}

const bundles = await Promise.all(
  bundlePaths.map(async (path) => ({ path, source: await readFile(new URL(path, distUrl), 'utf8') })),
);

const problems = [];

if (expectedApiUrl) {
  const normalized = expectedApiUrl.replace(/\/$/, '');
  if (!bundles.some(({ source }) => source.includes(normalized))) {
    problems.push(
      `EXPO_PUBLIC_API_URL was "${normalized}" but no bundle contains it. ` +
        'The build almost certainly reused a stale Metro cache; re-run the export with --clear.',
    );
  }
}

const environments = new Set(
  bundles.flatMap(({ source }) => [...source.matchAll(/environment:\s*["']([^"']+)["']/g)].map((match) => match[1])),
);

if (environments.size > 0 && !environments.has(expectedEnvironment)) {
  problems.push(
    `EXPO_PUBLIC_APP_ENV was "${expectedEnvironment}" but the bundle was built as ` +
      `${[...environments].map((value) => `"${value}"`).join(', ')}.`,
  );
}

if (problems.length > 0) {
  console.error(`\nverify-web-export failed:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
  process.exit(1);
}

const files = await readdir(distUrl);
console.log(
  `verify-web-export: ${bundlePaths.length} bundle(s), ${files.length} top-level file(s), ` +
    `environment "${expectedEnvironment}"${expectedApiUrl ? `, API ${expectedApiUrl.replace(/\/$/, '')}` : ''}.`,
);
