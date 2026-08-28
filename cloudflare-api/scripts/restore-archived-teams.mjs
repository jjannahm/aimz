/**
 * Brings archived teams back.
 *
 * Archiving only sets `is_active` to false, so nothing it touched was lost and
 * every player stayed attached to its team. This flips the flag back.
 *
 * Lists what it will restore and asks for --confirm before writing, because
 * which teams belong archived is a judgement only you can make.
 *
 * Usage:
 *   API_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/restore-archived-teams.mjs [--confirm] [--match <text>]
 */
const API_URL = (process.env.API_URL ?? "https://aimz-api-staging.shared-links.workers.dev").replace(/\/$/u, "");
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const CONFIRM = process.argv.includes("--confirm");
const MATCH = process.argv.includes("--match") ? process.argv[process.argv.indexOf("--match") + 1] : null;

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
  const [teams, players] = await Promise.all([call("/api/v1/teams?limit=200"), call("/api/v1/players?limit=500")]);

  const squadSize = new Map();
  for (const player of players.items) squadSize.set(player.team_id, (squadSize.get(player.team_id) ?? 0) + 1);

  let archived = teams.items.filter((team) => !team.is_active);
  if (MATCH) archived = archived.filter((team) => team.name.toLowerCase().includes(MATCH.toLowerCase()));

  if (!archived.length) { console.log("Nothing archived to restore."); return; }

  console.log(`${archived.length} archived team(s)${MATCH ? ` matching "${MATCH}"` : ""}:\n`);
  for (const team of archived.sort((a, b) => a.name.localeCompare(b.name))) {
    const size = squadSize.get(team.id) ?? 0;
    console.log(`  ${team.name.padEnd(28)} ${team.logo_url ? "logo" : "    "}  ${size ? `${size} players` : ""}`);
  }

  if (!CONFIRM) {
    console.log(`\nNothing written. Re-run with --confirm to restore these ${archived.length}.`);
    return;
  }

  console.log("");
  for (const team of archived) {
    await call(`/api/v1/teams/${team.id}`, { method: "PATCH", body: { is_active: true } });
    console.log(`  + ${team.name}`);
  }
  console.log(`\nRestored ${archived.length} team(s).`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
