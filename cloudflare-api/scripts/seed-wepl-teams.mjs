/**
 * Sets up the team list: the fifteen clubs of the Egyptian Women's Premier
 * League, AIMZ itself, and the academy's age groups, archiving whatever else
 * was there. The age groups wear the club logo and are not entered in the
 * league.
 *
 * Every club is created with `badge_style: "generated"`, so the badge each one
 * shows is its own uploaded logo, falling back to a monogram shield until that
 * logo is in place. All are `is_aimz` by default —
 * the flag gates players, lineups and live scoring, and a league app wants all
 * of that on. Pass --opponents to create the league clubs as opponents instead,
 * which leaves the Players tab holding only AIMZ and makes club-versus-club
 * fixtures score-entry only.
 *
 * Reruns update rather than duplicate: a club already present by name is
 * patched, teams this script owns are never archived by a later run, and a club
 * that already has a logo keeps it rather than storing the same picture twice.
 * Pass --replace-crests to overwrite the artwork.
 *
 * Usage:
 *   API_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-wepl-teams.mjs [--dry-run] [--opponents] [--crests <dir>] [--replace-crests]
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const API_URL = (process.env.API_URL ?? "https://aimz-api-staging.shared-links.workers.dev").replace(/\/$/u, "");
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const DRY_RUN = process.argv.includes("--dry-run");
const AS_OPPONENTS = process.argv.includes("--opponents");
const CRESTS_DIR = process.argv[process.argv.indexOf("--crests") + 1];
const WANTS_CRESTS = process.argv.includes("--crests");
/** Re-upload even when the team already has a logo, to swap the artwork. */
const REPLACE_CRESTS = process.argv.includes("--replace-crests");

const COMPETITION = { name: "Egyptian Women's Premier League", season: "2026/27", type: "league" };

const MEDIA_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
/** `Wadi Degla` and `wadi-degla.png` should find each other. */
const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");

/**
 * The academy's own side, carried in the same list as the league clubs so it
 * gets the same treatment: an uploaded logo, not the crest TeamBadge draws.
 */
const HOME = { name: "AIMZ", badge: "generated", logo: "aimz", inLeague: true };

/**
 * The age groups. They wear the club's logo rather than one of their own, and
 * they are not entered in the league — they play their own fixtures. Listing
 * them here is also what stops a later run archiving them along with whatever
 * else it did not recognise.
 */
const SQUADS = ["U9", "U11", "U13", "U15", "U18"].map((name) => ({
  name, badge: "generated", logo: "aimz", inLeague: false,
}));

/**
 * The clubs as the Score Itt app lists them. The first ten were read off its
 * own screens; the last five come from research and are the ones to correct
 * first if a name reads wrong in the app.
 */
const LEAGUE_CLUBS = [
  "FC Masar",
  "Al Ahly",
  "Wadi Degla",
  "Pyramids",
  "Palm Hills",
  "Zamalek",
  "Modern Sport",
  "Bank El Ahly",
  "ZED",
  "RA SC",
  "Al Mokawloon Al Arab",
  "El Masry",
  "SAK FC",
  "ENPPI",
  "Al Tayaran",
];

/** Everything the seeder owns: the league clubs, our senior side, our age groups. */
const CLUBS = [
  ...LEAGUE_CLUBS.map((name) => ({ name, badge: "generated", logo: slugify(name), inLeague: true })),
  HOME,
  ...SQUADS,
];

if (!EMAIL || !PASSWORD) { console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD."); process.exit(1); }
if (WANTS_CRESTS && !CRESTS_DIR) { console.error("--crests needs a directory."); process.exit(1); }

let token = "";
async function call(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return parsed;
}

/** Files named for their club, so a crest can be matched to the team it belongs to. */
async function readCrests(directory) {
  const found = new Map();
  for (const entry of await readdir(directory)) {
    const type = MEDIA_TYPES[extname(entry).toLowerCase()];
    if (type) found.set(slugify(entry.slice(0, -extname(entry).length)), { path: join(directory, entry), type });
  }
  return found;
}

/** presign → multipart POST → point the team at the stored object. */
async function uploadCrest(team, crest) {
  const presign = await call("/api/v1/media/uploads/presign", { method: "POST", body: { entity: "team", entity_id: team.id, content_type: crest.type } });
  const form = new FormData();
  for (const [field, value] of Object.entries(presign.fields)) form.append(field, value);
  form.append("file", new File([await readFile(crest.path)], "crest", { type: crest.type }));
  const uploaded = await fetch(presign.upload_url, { method: "POST", body: form });
  if (!uploaded.ok) throw new Error(`upload ${team.name} → ${uploaded.status} ${await uploaded.text()}`);
  await call(`/api/v1/teams/${team.id}`, { method: "PATCH", body: { logo_key: presign.object_key } });
}

async function main() {
  ({ access_token: token } = await call("/api/v1/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } }));
  const [competitions, teams] = await Promise.all([call("/api/v1/competitions?limit=100"), call("/api/v1/teams?limit=200")]);
  const crests = WANTS_CRESTS ? await readCrests(CRESTS_DIR) : new Map();
  if (WANTS_CRESTS) console.log(`${crests.size} crest file(s) in ${CRESTS_DIR}\n`);

  // The clubs need a competition or they never reach the standings table.
  let league = competitions.items.find((item) => item.name === COMPETITION.name && item.season === COMPETITION.season);
  if (league) {
    console.log(`= ${league.name} ${league.season} (already there)`);
  } else if (DRY_RUN) {
    console.log(`+ ${COMPETITION.name} ${COMPETITION.season}`);
    league = { id: "dry-run" };
  } else {
    league = await call("/api/v1/competitions", { method: "POST", body: COMPETITION });
    console.log(`+ ${league.name} ${league.season}`);
  }

  console.log(`\nTeams — ${AS_OPPONENTS ? "league clubs as opponents" : "all squads"}, uploaded logos`);
  const byName = new Map(teams.items.map((team) => [team.name, team]));
  const seeded = new Set();
  for (const { name, badge, logo, inLeague } of CLUBS) {
    // Our own teams stay squads even when the league clubs are seeded as opponents.
    const ours = !inLeague || name === HOME.name || !AS_OPPONENTS;
    const shared = { name, season: COMPETITION.season, is_aimz: ours, is_active: true, badge_style: badge, competition_id: inLeague ? league.id : null };
    const existing = byName.get(name);
    const crest = crests.get(logo);
    if (DRY_RUN) { console.log(`  ${existing ? "~" : "+"} ${name}${crest ? (existing?.logo_key && !REPLACE_CRESTS ? " (crest already up)" : " (crest uploaded)") : ""}`); if (existing) seeded.add(existing.id); continue; }

    const team = existing
      ? await call(`/api/v1/teams/${existing.id}`, { method: "PATCH", body: shared })
      : await call("/api/v1/teams", { method: "POST", body: shared });
    seeded.add(team.id);
    const wants = crest && (REPLACE_CRESTS || !team.logo_key);
    if (wants) await uploadCrest(team, crest);
    const note = wants ? " (crest uploaded)" : crest ? " (crest already up)" : "";
    console.log(`  ${existing ? "~" : "+"} ${name}${note}`);
  }

  const missing = CLUBS.filter(({ logo }) => !crests.has(logo)).map(({ name }) => name);
  if (WANTS_CRESTS && missing.length) console.log(`\nNo crest file for: ${missing.join(", ")}`);

  // Archived rather than deleted: the API refuses to delete a team a player or
  // match still points at, so this is the one path that works for all of them.
  const stale = teams.items.filter((team) => !seeded.has(team.id) && team.is_active);
  console.log(`\nArchiving ${stale.length} existing team(s)`);
  for (const team of stale) {
    if (!DRY_RUN) await call(`/api/v1/teams/${team.id}`, { method: "PATCH", body: { is_active: false } });
    console.log(`  - ${team.name}`);
  }
  console.log(DRY_RUN ? "\nDry run — nothing was written." : "\nDone.");
}

main().catch((error) => { console.error(error.message); process.exit(1); });
