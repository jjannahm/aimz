/**
 * Builds the staging world the load test needs, then proves it works.
 *
 * Staging only. Everything it writes is invented — a squad, its players, one
 * opponent, one finished match, and a pool of family logins — and every name
 * carries the same marker so a rerun updates rather than duplicates.
 *
 * It never prints a password. The generated logins go to
 * `loadtest/accounts.json`, which is git-ignored, and nowhere else.
 *
 * Usage:
 *   API_URL=https://aimz-api-staging.shared-links.workers.dev \
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/provision-loadtest.mjs
 *
 *   node scripts/provision-loadtest.mjs --verify-only   # no writes, just checks
 */
import { writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

const API_URL = (process.env.API_URL ?? "https://aimz-api-staging.shared-links.workers.dev").replace(/\/$/u, "");
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const VERIFY_ONLY = process.argv.includes("--verify-only");
const ACCOUNTS = Number(process.env.ACCOUNTS ?? 20);

/** Marks everything this script owns. */
const TAG = "Loadtest";
/**
 * A fresh batch each run.
 *
 * There is no endpoint to delete an account or reset its password, and the
 * password of one already provisioned is not readable — so a rerun mints new
 * logins rather than guessing at old ones. The strays it leaves behind are
 * inert staging rows; `--verify-only` reuses the file instead of minting more.
 */
const BATCH = new Date().toISOString().slice(2, 16).replace(/[-:T]/gu, "");
const SQUAD = `${TAG} U12`;
const OPPONENT = `${TAG} Rivals`;
const COMPETITION = `${TAG} League`;
const VENUE = `${TAG} Ground`;
/** One match per batch, so its team sheet names this batch's players. */
const MATCH_VENUE = () => `${VENUE} ${BATCH}`;

if (!EMAIL || !PASSWORD) { console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD (staging admin)."); process.exit(1); }
if (/\bprod\b|production/iu.test(API_URL)) { console.error(`Refusing to touch what looks like production: ${API_URL}`); process.exit(1); }

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

async function main() {
  console.log(`API: ${API_URL}`);
  token = await signIn(EMAIL, PASSWORD);
  console.log("signed in as administrator");

  // ---------------------------------------------------------------- the squad
  const teams = await call("/api/v1/teams?limit=100");
  let squad = teams.items.find((team) => team.name === SQUAD);
  let opponent = teams.items.find((team) => team.name === OPPONENT);
  const competitions = await call("/api/v1/competitions?limit=100");
  let competition = competitions.items.find((item) => item.name === COMPETITION);

  if (VERIFY_ONLY && (!squad || !opponent || !competition)) {
    console.error("Nothing provisioned yet — run without --verify-only first.");
    process.exit(1);
  }

  if (!competition) competition = await call("/api/v1/competitions", { method: "POST", body: { name: COMPETITION, season: "2026/27", type: "league" } });
  if (!squad) squad = await call("/api/v1/teams", { method: "POST", body: { name: SQUAD, is_aimz: true, age_group: "U12", competition_id: competition.id } });
  if (!opponent) opponent = await call("/api/v1/teams", { method: "POST", body: { name: OPPONENT, is_aimz: false, competition_id: competition.id } });
  console.log(`squad ${squad.id} · opponent ${opponent.id} · competition ${competition.id}`);

  // -------------------------------------------------------------- the players
  const roster = await call(`/api/v1/players?team_id=${squad.id}`);
  // Batch-scoped, because linking is exclusive: a player claimed by an earlier
  // batch's account cannot be handed to this one, so each batch brings its own.
  const mine = (player) => player.name.startsWith(`${TAG} ${BATCH} `);
  const players = roster.items.filter(mine);
  const POSITIONS = ["GK", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];
  for (let index = players.length; index < ACCOUNTS && !VERIFY_ONLY; index += 1) {
    players.push(await call("/api/v1/players", {
      method: "POST",
      body: { name: `${TAG} ${BATCH} Player ${String(index + 1).padStart(2, "0")}`, team_id: squad.id, position: POSITIONS[index % POSITIONS.length], jersey_number: index + 1 },
    }));
  }
  console.log(`${players.length} players on the squad`);
  if (players.length < ACCOUNTS) { console.error(`Need ${ACCOUNTS} players, found ${players.length}.`); process.exit(1); }

  // --------------------------------------------------------------- the match
  const matches = await call(`/api/v1/matches?team_id=${squad.id}`);
  let match = matches.items.find((item) => item.venue === MATCH_VENUE());
  if (!match && !VERIFY_ONLY) {
    match = await call("/api/v1/matches", {
      method: "POST",
      body: {
        competition_id: competition.id, home_team_id: squad.id, away_team_id: opponent.id,
        kickoff_datetime: new Date(Date.now() - 86_400_000).toISOString(), venue: MATCH_VENUE(), status: "scheduled",
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
    // Enough of a thread that the live payload is not empty: two goals, a card
    // and a substitution.
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
  }
  if (!match) { console.error("No match provisioned."); process.exit(1); }
  console.log(`match ${match.id} · ${match.venue}`);

  // ------------------------------------------------------------- the accounts
  const existing = VERIFY_ONLY ? { items: [] } : await call("/api/v1/admin/users?limit=100");
  const pool = [];
  for (let index = 0; index < (VERIFY_ONLY ? 0 : ACCOUNTS); index += 1) {
    const email = `loadtest-${BATCH}-${String(index + 1).padStart(2, "0")}@aimz.example`;
    const password = `Lt-${randomBytes(12).toString("base64url")}`;
    if (existing.items.some((item) => item.email === email)) {
      console.error(`${email} already exists. Batches are minted per minute; wait sixty seconds and rerun.`);
      process.exit(1);
    }
    const account = await call("/api/v1/admin/users", {
      method: "POST",
      body: { name: `${TAG} Family ${index + 1}`, email, password, role: "player" },
    });
    await call(`/api/v1/admin/users/${account.id}`, { method: "PATCH", body: { player_id: players[index].id } });
    pool.push({ email, password, id: account.id });
    await sleep(GENTLE_MS);
  }

  if (!VERIFY_ONLY) {
    writeFileSync(
      new URL("../loadtest/accounts.json", import.meta.url),
      `${JSON.stringify(pool.map(({ email, password }) => ({ email, password })), null, 2)}\n`,
    );
    console.log(`wrote loadtest/accounts.json (${pool.length} accounts, git-ignored)`);
  }

  // ------------------------------------------------------------ the proof
  console.log("\nvalidating every account…");
  const failures = [];
  const readAccounts = VERIFY_ONLY
    ? JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(new URL("../loadtest/accounts.json", import.meta.url), "utf8")))
    : pool;

  for (const account of readAccounts) {
    const label = account.email;
    try {
      const accessToken = await signIn(account.email, account.password);
      if (!accessToken) throw new Error("no access token");

      const live = await fetch(`${API_URL}/api/v1/matches/${match.id}/live`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (live.status !== 200) throw new Error(`live match → ${live.status}`);

      const hub = await fetch(`${API_URL}/api/v1/announcements?limit=50`, { headers: { authorization: `Bearer ${accessToken}` } });
      if (hub.status !== 200) throw new Error(`announcements → ${hub.status}`);
      const notices = await hub.json();
      if (notices.items.length > 50) throw new Error(`announcements returned ${notices.items.length}, expected ≤ 50`);

      console.log(`  ok   ${label}`);
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
      console.log(`  FAIL ${label}: ${error.message}`);
    }
    await sleep(GENTLE_MS);
  }

  console.log("\n────────────────────────────────────────");
  console.log(`squad        ${squad.name} (${squad.id})`);
  console.log(`MATCH_ID     ${match.id}`);
  console.log(`PLAYER_ID    ${players[0].id}   (${players[0].name})`);
  console.log(`accounts     ${readAccounts.length}`);
  console.log(`failures     ${failures.length}`);
  if (failures.length) { failures.forEach((line) => console.error(`  ${line}`)); process.exit(1); }
  console.log("all accounts sign in, see the match, and get a bounded Hub.");
}

main().catch((error) => { console.error(error.message); process.exit(1); });
