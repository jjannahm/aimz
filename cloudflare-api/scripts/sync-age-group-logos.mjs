/**
 * Points every "<Club> U<n>" team at the logo its parent club is wearing.
 *
 * The age groups carry their own copy of the artwork, so fixing a club's crest
 * leaves its five age groups on the old picture. This assigns the parent's
 * existing logo_key rather than uploading again: both rows then reference the
 * same R2 object, so there is nothing extra to store and no way for them to
 * drift apart until the parent changes again.
 *
 * Only updates teams that already exist; it never creates one. Lists what it
 * will change and writes nothing without --confirm.
 *
 * Usage:
 *   API_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node sync-age-group-logos.mjs [--confirm]
 */
const API_URL = (process.env.API_URL ?? "https://aimz-api-staging.shared-links.workers.dev").replace(/\/$/u, "");
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const CONFIRM = process.argv.includes("--confirm");

if (!EMAIL || !PASSWORD) { console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD."); process.exit(1); }

let token = "";
async function call(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  ({ access_token: token } = await call("/api/v1/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } }));
  const teams = await call("/api/v1/teams?limit=200");
  const byName = new Map(teams.items.map((team) => [team.name, team]));

  const pending = [];
  for (const team of teams.items) {
    // "Al Ahly U13" belongs to "Al Ahly"; the academy's own "U13" has no prefix
    // and already wears the club logo, so it does not match.
    const parentName = team.name.match(/^(.+?)\s+U\d+$/u)?.[1];
    if (!parentName) continue;
    const parent = byName.get(parentName);
    if (!parent?.logo_key) continue;
    if (team.logo_key === parent.logo_key) continue;
    pending.push({ team, parent });
  }

  if (!pending.length) { console.log("Every age group already matches its club."); return; }

  console.log(`${pending.length} age group(s) on artwork their club no longer uses:\n`);
  const byParent = new Map();
  for (const item of pending) byParent.set(item.parent.name, [...(byParent.get(item.parent.name) ?? []), item.team.name]);
  for (const [parent, kids] of [...byParent].sort()) console.log(`  ${parent.padEnd(22)} ${kids.length}  (${kids.sort().join(", ")})`);

  if (!CONFIRM) { console.log(`\nNothing written. Re-run with --confirm to update these ${pending.length}.`); return; }

  console.log("");
  for (const { team, parent } of pending) {
    await call(`/api/v1/teams/${team.id}`, { method: "PATCH", body: { logo_key: parent.logo_key } });
  }
  console.log(`Updated ${pending.length} age group(s) to their club's logo.`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
