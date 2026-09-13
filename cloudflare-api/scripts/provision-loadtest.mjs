/**
 * Builds the staging world the load test needs, then proves it works.
 *
 * Staging only. Everything it writes is invented — a squad, its players, one
 * opponent, one finished match, and a pool of family logins — and every row it
 * owns carries the run's prefix, so the dataset can be picked out of staging
 * later by name alone.
 *
 * It never prints a password. The generated logins go to
 * `loadtest/accounts.json`, which is git-ignored, and nowhere else.
 *
 * Usage:
 *   API_URL=https://aimz-api-staging.shared-links.workers.dev \
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/provision-loadtest.mjs
 *
 *   node scripts/provision-loadtest.mjs --dry-run      # writes nothing; prints the plan
 *   node scripts/provision-loadtest.mjs --verify-only  # re-checks the pool on disk
 *   node scripts/provision-loadtest.mjs --fresh        # ignore a reusable pool, mint a new one
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

const API_URL = (process.env.API_URL ?? "https://aimz-api-staging.shared-links.workers.dev").replace(/\/$/u, "");
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const DRY_RUN = process.argv.includes("--dry-run");
const VERIFY_ONLY = process.argv.includes("--verify-only");
const FRESH = process.argv.includes("--fresh");
const ACCOUNTS = Number(process.env.ACCOUNTS ?? 20);

/**
 * The mark every row of this dataset carries: `LOADTEST_20260913_1432`.
 *
 * Minute granularity because a rerun has to be able to mint a distinct batch —
 * nothing here can delete an account or reset its password, and a player
 * already claimed by one account cannot be handed to another.
 */
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/gu, "").replace("T", "_");
const PREFIX = `LOADTEST_${stamp}`;

const ACCOUNTS_FILE = new URL("../loadtest/accounts.json", import.meta.url);
const DATASET_FILE = new URL("../loadtest/dataset.json", import.meta.url);

/** Anything that smells like the real thing. Checked before a single request. */
function refuseProduction() {
  if (/\bprod\b|production|\blive\b/iu.test(API_URL)) {
    console.error(`REFUSING: "${API_URL}" looks like production. This script writes invented data.`);
    process.exit(1);
  }
  if (!/staging|localhost|127\.0\.0\.1/iu.test(API_URL)) {
    console.error(`REFUSING: "${API_URL}" is not recognisably staging or local.`);
    process.exit(1);
  }
}

let token = "";

async function call(path, { method = "GET", body, as = token } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(as ? { authorization: `Bearer ${as}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) {
    const error = new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Long enough that a pool of twenty never resembles a burst to LOGIN_BY_IP. */
const GENTLE_MS = 400;

async function signIn(email, password) {
  const res = await call("/api/v1/auth/login", { method: "POST", body: { email, password }, as: "" });
  return res.access_token;
}

const POSITIONS = ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];
const squadName = (p) => `${p} U12`;
const opponentName = (p) => `${p} Rivals`;
const competitionName = (p) => `${p} League`;
const venueName = (p) => `${p} Ground`;
const playerName = (p, i) => `${p} Player ${String(i + 1).padStart(2, "0")}`;
const accountEmail = (p, i) => `${p.toLowerCase().replace(/_/gu, "-")}-${String(i + 1).padStart(2, "0")}@aimz.example`;

/** What a run would create, said plainly enough to be checked before it happens. */
function printPlan() {
  console.log("PLAN — a dry run. Nothing below has been created, and no request has been sent.\n");
  console.log(`  target        ${API_URL}`);
  console.log(`  prefix        ${PREFIX}`);
  console.log("");
  console.log(`  competition   "${competitionName(PREFIX)}"        1, if absent`);
  console.log(`  squad         "${squadName(PREFIX)}"           1, AIMZ, U12`);
  console.log(`  opponent      "${opponentName(PREFIX)}"        1, not AIMZ`);
  console.log(`  players       "${playerName(PREFIX, 0)}" … ${String(ACCOUNTS).padStart(2, "0")}   ${ACCOUNTS}`);
  console.log(`  match         1, at "${venueName(PREFIX)}", kicked off yesterday`);
  console.log("                  two 30-minute halves; 11 starters and the rest on the bench");
  console.log("                  4 events: 2 goals, 1 yellow card, 1 substitution");
  console.log("                  phases: start → halftime → second half → finish");
  console.log(`  accounts      "${accountEmail(PREFIX, 0)}" …    ${ACCOUNTS}, role player`);
  console.log("                  each linked to one of the players above");
  console.log("");
  console.log("  files         loadtest/accounts.json   git-ignored; logins");
  console.log("                loadtest/dataset.json    git-ignored; ids and prefix");
  console.log("");
  console.log("  afterwards    signs in as each account and checks it can read the match,");
  console.log("                and that the Hub returns no more than 50 announcements.");
  console.log("\n  A later run reuses this pool if it still works, rather than minting another.");
  console.log("\nNo production data is touched. Re-run without --dry-run to apply.");
}

/** A pool already on disk that still works is worth more than a new one. */
async function reusableDataset() {
  if (FRESH || !existsSync(ACCOUNTS_FILE) || !existsSync(DATASET_FILE)) return null;
  let accounts; let dataset;
  try {
    accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    dataset = JSON.parse(readFileSync(DATASET_FILE, "utf8"));
  } catch { return null; }
  if (!Array.isArray(accounts) || accounts.length < ACCOUNTS || !dataset?.match_id) return null;
  // A pool built against another host proves nothing about this one.
  if (dataset.api_url && dataset.api_url !== API_URL) return null;

  console.log(`found an existing pool (${dataset.prefix}); checking whether it still works…`);
  const failures = await verifyPool(accounts, dataset.match_id);
  if (failures.length) {
    console.log(`  it no longer works (${failures.length} failed) — minting a new one.`);
    return null;
  }
  console.log("  it works. Reusing it rather than creating another twenty accounts.");
  return { accounts, dataset };
}

/** Signs in as every account and asks the two questions the load test asks. */
async function verifyPool(accounts, matchId) {
  const failures = [];
  for (const account of accounts) {
    try {
      const accessToken = await signIn(account.email, account.password);
      if (!accessToken) throw new Error("no access token");

      const live = await fetch(`${API_URL}/api/v1/matches/${matchId}/live`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (live.status !== 200) throw new Error(`live match → ${live.status}`);

      const hub = await fetch(`${API_URL}/api/v1/announcements?limit=50`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (hub.status !== 200) throw new Error(`announcements → ${hub.status}`);
      const notices = await hub.json();
      if (notices.items.length > 50) throw new Error(`announcements returned ${notices.items.length}, expected at most 50`);

      console.log(`  ok   ${account.email}`);
    } catch (error) {
      failures.push(`${account.email}: ${error.message}`);
      console.log(`  FAIL ${account.email}: ${error.message}`);
    }
    await sleep(GENTLE_MS);
  }
  return failures;
}

function report(dataset, accounts, failures) {
  console.log("\n────────────────────────────────────────");
  console.log(`PREFIX       ${dataset.prefix}`);
  console.log(`MATCH_ID     ${dataset.match_id}`);
  console.log(`PLAYER_ID    ${dataset.player_id}`);
  console.log(`accounts     ${accounts}`);
  console.log(`failures     ${failures.length}`);
  if (failures.length) { failures.forEach((line) => console.error(`  ${line}`)); process.exit(1); }
  console.log("every account signs in, sees the match, and gets a bounded Hub.");
}

async function main() {
  refuseProduction();

  if (DRY_RUN) { printPlan(); return; }

  if (!EMAIL || !PASSWORD) { console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (staging admin)."); process.exit(1); }
  console.log(`API: ${API_URL}`);
  token = await signIn(EMAIL, PASSWORD);
  console.log("signed in as administrator");

  if (VERIFY_ONLY) {
    if (!existsSync(ACCOUNTS_FILE) || !existsSync(DATASET_FILE)) { console.error("No pool on disk — run without --verify-only first."); process.exit(1); }
    const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    const dataset = JSON.parse(readFileSync(DATASET_FILE, "utf8"));
    console.log(`verifying ${accounts.length} accounts against ${dataset.prefix}…`);
    report(dataset, accounts.length, await verifyPool(accounts, dataset.match_id));
    return;
  }

  const reused = await reusableDataset();
  if (reused) { report(reused.dataset, reused.accounts.length, []); return; }

  // ---------------------------------------------------------------- the squad
  const competition = await call("/api/v1/competitions", { method: "POST", body: { name: competitionName(PREFIX), season: "2026/27", type: "league" } });
  const squad = await call("/api/v1/teams", { method: "POST", body: { name: squadName(PREFIX), is_aimz: true, age_group: "U12", competition_id: competition.id } });
  const opponent = await call("/api/v1/teams", { method: "POST", body: { name: opponentName(PREFIX), is_aimz: false, competition_id: competition.id } });
  console.log(`squad ${squad.id} · opponent ${opponent.id} · competition ${competition.id}`);

  // -------------------------------------------------------------- the players
  const players = [];
  for (let index = 0; index < ACCOUNTS; index += 1) {
    players.push(await call("/api/v1/players", {
      method: "POST",
      body: { name: playerName(PREFIX, index), team_id: squad.id, position: POSITIONS[index % POSITIONS.length], jersey_number: index + 1 },
    }));
  }
  console.log(`${players.length} players created`);

  // --------------------------------------------------------------- the match
  const match = await call("/api/v1/matches", {
    method: "POST",
    body: {
      competition_id: competition.id, home_team_id: squad.id, away_team_id: opponent.id,
      kickoff_datetime: new Date(Date.now() - 86_400_000).toISOString(), venue: venueName(PREFIX), status: "scheduled",
      half_length_minutes: 30, num_halves: 2, half_time_break_minutes: 10,
    },
  });
  // A realistic sheet: eleven start, the rest are named on the bench.
  await call(`/api/v1/matches/${match.id}/lineup`, {
    method: "PUT",
    body: players.map((player, index) => ({
      player_id: player.id, team_id: squad.id, is_starter: index < 11,
      position: player.position, is_captain: index === 1,
    })),
  });
  await call(`/api/v1/matches/${match.id}/phase`, { method: "POST", body: { action: "start_match" } });
  // Enough of a thread that the live payload is not empty.
  const events = [
    { type: "goal", minute: 12, team_id: squad.id, player_id: players[9].id, secondary_player_id: players[7].id },
    { type: "yellow_card", minute: 25, team_id: squad.id, player_id: players[2].id },
    { type: "substitution", minute: 40, team_id: squad.id, player_id: players[11].id, secondary_player_id: players[9].id },
    { type: "goal", minute: 55, team_id: squad.id, player_id: players[11].id },
  ];
  for (const event of events) {
    await call(`/api/v1/matches/${match.id}/events`, { method: "POST", body: { ...event, client_operation_id: randomUUID() } });
  }
  for (const action of ["halftime", "start_second_half", "finish_match"]) {
    await call(`/api/v1/matches/${match.id}/phase`, { method: "POST", body: { action } });
  }
  console.log(`match ${match.id} · ${venueName(PREFIX)}`);

  // ------------------------------------------------------------- the accounts
  const pool = [];
  for (let index = 0; index < ACCOUNTS; index += 1) {
    const email = accountEmail(PREFIX, index);
    const password = `Lt-${randomBytes(12).toString("base64url")}`;
    const account = await call("/api/v1/admin/users", {
      method: "POST",
      body: { name: `${PREFIX} Family ${index + 1}`, email, password, role: "player" },
    });
    await call(`/api/v1/admin/users/${account.id}`, { method: "PATCH", body: { player_id: players[index].id } });
    pool.push({ email, password });
    await sleep(GENTLE_MS);
  }
  writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(pool, null, 2)}\n`);

  const dataset = {
    prefix: PREFIX,
    api_url: API_URL,
    squad_id: squad.id,
    match_id: match.id,
    player_id: players[0].id,
    player_name: players[0].name,
    accounts: pool.length,
    created_at: new Date().toISOString(),
  };
  writeFileSync(DATASET_FILE, `${JSON.stringify(dataset, null, 2)}\n`);
  console.log("wrote loadtest/accounts.json and loadtest/dataset.json (both git-ignored)");

  console.log("\nvalidating every account…");
  report(dataset, pool.length, await verifyPool(pool, match.id));
}

main().catch((error) => { console.error(error.message); process.exit(1); });
