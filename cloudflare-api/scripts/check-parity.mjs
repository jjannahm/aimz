#!/usr/bin/env node
/**
 * Prints which `/api/v1` endpoint families the mobile app calls, and which of
 * the two server implementations actually serve them.
 *
 * This exists because every parity claim in this repository has been a
 * hand-typed number that nobody re-checked, and each one rotted: the AWS
 * runbook still names "eight route groups" that `backend/` has had for weeks,
 * while the Stage 3 cutover document claimed a parity that was never reached.
 * Documentation cites this command instead of a number, so the number cannot
 * go stale on its own.
 *
 * Advisory. The gap is known and accepted — Cloudflare is the platform and
 * `backend/` is a frozen reference — so this reports and never fails a build.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERBS = "get|post|put|patch|delete";

/** The first path segment after `/api/v1`, which is the unit a reader thinks in. */
function family(path) {
  const m = /^\/?(?:api\/v1\/)?([a-z0-9-]+)/.exec(path.replace(/^\//, ""));
  return m ? m[1] : null;
}

function listFiles(dir, ext) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Hono routes are all single-line `app.get("/api/v1/...")` literals. */
function workerRoutes() {
  const paths = new Set();
  let registrations = 0;
  for (const file of listFiles(join(ROOT, "cloudflare-api", "src"), ".ts")) {
    if (file.endsWith(".test.ts")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(new RegExp(`app\\.(?:${VERBS})\\("([^"]+)"`, "g"))) {
      paths.add(m[1]);
      registrations += 1;
    }
  }
  return { paths, registrations };
}

/**
 * FastAPI needs more care than the Worker:
 *   - three router objects are in play (`router`, `admin_router`, `public_router`),
 *     so matching only `@router.` silently loses five routes;
 *   - nine decorators put the path on the following line, so a single-line
 *     regex loses those too;
 *   - the family often comes from the `include_router(prefix=...)` in
 *     router.py rather than from the decorator itself.
 */
function backendRoutes() {
  const routesDir = join(ROOT, "backend", "app", "api", "v1", "routes");
  const prefixes = new Map(); // "module.router_object" -> prefix
  try {
    const routerPy = readFileSync(join(ROOT, "backend", "app", "api", "v1", "router.py"), "utf8");
    for (const m of routerPy.matchAll(/include_router\(\s*(\w+)\.(\w+)([^)]*)\)/g)) {
      const prefix = /prefix="([^"]+)"/.exec(m[3]);
      prefixes.set(`${m[1]}.${m[2]}`, prefix ? prefix[1] : "");
    }
  } catch {
    return null; // backend/ is gone: report rather than crash
  }

  const paths = new Set();
  let registrations = 0;
  for (const file of listFiles(routesDir, ".py")) {
    const module = file.split("/").pop().replace(/\.py$/, "");
    const src = readFileSync(file, "utf8");
    // `\s` spans newlines, so this one pattern covers both the same-line
    // decorators and the nine that put the path on the following line. The
    // path may be empty — `@router.get("")` under a prefix is how
    // `/api/v1/health` is declared — so this matches zero-or-more, not one.
    const pattern = new RegExp(`@(\\w*router)\\.(?:${VERBS})\\(\\s*"([^"]*)"`, "g");
    for (const m of src.matchAll(pattern)) {
      const prefix = prefixes.get(`${module}.${m[1]}`) ?? "";
      paths.add(`/api/v1${prefix}${m[2]}`);
      registrations += 1;
    }
  }
  return { paths, registrations };
}

/** What the app actually asks for — the set that decides whether a cutover works. */
function appFamilies() {
  const families = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        for (const m of readFileSync(full, "utf8").matchAll(/\/api\/v1\/([a-z0-9-]+)/g)) {
          families.add(m[1]);
        }
      }
    }
  };
  walk(join(ROOT, "mobile", "src"));
  walk(join(ROOT, "mobile", "app"));
  return families;
}

const worker = workerRoutes();
const backend = backendRoutes();
const app = appFamilies();

const workerFamilies = new Set([...worker.paths].map(family).filter(Boolean));
const backendFamilies = backend ? new Set([...backend.paths].map(family).filter(Boolean)) : new Set();

const rows = [...app].sort();
const missing = rows.filter((f) => !backendFamilies.has(f));
const unserved = rows.filter((f) => !workerFamilies.has(f));

const pad = (s, n) => String(s).padEnd(n);
console.log();
console.log(`${pad("FAMILY", 24)}${pad("APP", 7)}${pad("WORKER", 9)}FASTAPI`);
console.log(`${pad("-".repeat(6), 24)}${pad("---", 7)}${pad("------", 9)}-------`);
for (const f of rows) {
  console.log(
    `${pad(f, 24)}${pad("yes", 7)}${pad(workerFamilies.has(f) ? "yes" : "MISSING", 9)}` +
      (backendFamilies.has(f) ? "yes" : "MISSING"),
  );
}
console.log();
console.log(
  `Paths:         Worker ${worker.paths.size}   FastAPI ${backend ? backend.paths.size : "n/a"}   ` +
    `(distinct URLs, ignoring which verbs each accepts)`,
);
console.log(
  `Registrations: Worker ${worker.registrations}   FastAPI ${backend ? backend.registrations : "n/a"}   ` +
    `(one per verb+path handler)`,
);
console.log(
  `Families: app calls ${rows.length}   Worker serves ${rows.length - unserved.length}/${rows.length}   ` +
    `FastAPI serves ${rows.length - missing.length}/${rows.length}`,
);
if (missing.length) {
  console.log();
  console.log(`FastAPI is missing ${missing.length}: ${missing.join(" ")}`);
}
if (unserved.length) {
  console.log();
  console.log(`WARNING: the app calls ${unserved.length} families the Worker does not serve: ${unserved.join(" ")}`);
}
console.log();
