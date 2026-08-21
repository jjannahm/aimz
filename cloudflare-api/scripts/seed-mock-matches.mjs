/**
 * Seeds seven fictional matches per league so Standings, Top scorers and Top
 * assisters have varied data to show.
 *
 * Staging only. Everything it writes is invented, in keeping with the
 * "Fictional data only" banner the preview carries; never point it at anything
 * holding real academy records.
 *
 * Usage:
 *   API_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-mock-matches.mjs [--dry-run]
 */
const API_URL = (process.env.API_URL ?? "https://aimz-api-staging.shared-links.workers.dev").replace(/\/$/u, "");
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const DRY_RUN = process.argv.includes("--dry-run");
const MATCHES_PER_LEAGUE = 7;
/** Marks every row this script owns, so a rerun updates rather than duplicates. */
const VENUE = "AIMZ Mock Ground";

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
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text}`);
  return parsed;
}

/** Same seed, same fixtures — a rerun never reshuffles a table that was reviewed. */
function random(seed) {
  let state = [...seed].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 17);
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A balanced fixture list, so no team sits on far fewer games than the rest. */
function roundRobin(teams) {
  const rotation = teams.length % 2 ? [...teams, null] : [...teams];
  const rounds = [];
  for (let round = 0; round < rotation.length - 1; round += 1) {
    for (let pair = 0; pair < rotation.length / 2; pair += 1) {
      const home = rotation[pair]; const away = rotation[rotation.length - 1 - pair];
      // Alternating who is at home keeps one side from hosting every week.
      if (home && away) rounds.push(round % 2 ? { home: away, away: home } : { home, away });
    }
    rotation.splice(1, 0, rotation.pop());
  }
  return rounds;
}

/**
 * Five players from the squad, listed often enough that the first two of them
 * finish the season clear of the rest. `offset` moves the core along the squad
 * so the assist list is not the goal list again.
 */
function weighted(squad, offset) {
  if (!squad.length) return [];
  const shares = [5, 4, 3, 2, 1];
  return shares.flatMap((share, index) => Array.from({ length: share }, () => squad[(index + offset) % squad.length]));
}

// Deliberately lopsided, tight and drawn results in one set, so no table reads
// like every fixture was the same game.
const SCORELINES = [[3, 1], [1, 1], [0, 2], [4, 0], [2, 3], [2, 2], [1, 0], [5, 1], [3, 3], [0, 1]];

async function main() {
  ({ access_token: token } = await call("/api/v1/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } }));
  const [competitions, teams, players] = await Promise.all([
    call("/api/v1/competitions?limit=100"), call("/api/v1/teams?limit=200"), call("/api/v1/players?limit=500"),
  ]);
  const existing = await call("/api/v1/matches?limit=200");
  const leagues = competitions.items.filter((competition) => competition.type !== "friendly");
  if (!leagues.length) { console.error("No leagues found."); process.exit(1); }

  for (const league of leagues) {
    const entered = teams.items.filter((team) => team.competition_id === league.id);
    if (entered.length < 2) { console.warn(`Skipping ${league.name}: ${entered.length} team(s) entered.`); continue; }
    const squads = new Map(entered.map((team) => [team.id, players.items.filter((player) => player.team_id === team.id)]));
    const roll = random(league.id);
    // One full round of fixtures rarely reaches seven, so the list wraps into a
    // reverse round with the venues swapped.
    const cycle = roundRobin(entered);
    const fixtures = Array.from({ length: MATCHES_PER_LEAGUE }, (unused, index) => {
      const fixture = cycle[index % cycle.length];
      return index >= cycle.length ? { home: fixture.away, away: fixture.home } : fixture;
    });
    // Who scores and who sets them up are drawn from separate weighted cores, so
    // a handful of names pile up goals and a different handful pile up assists.
    const scorers = new Map(entered.map((team) => [team.id, weighted(squads.get(team.id) ?? [], 0)]));
    const assisters = new Map(entered.map((team) => [team.id, weighted(squads.get(team.id) ?? [], 2)]));
    console.log(`\n${league.name} (${league.season}) — ${entered.length} teams`);
    for (const [index, fixture] of fixtures.entries()) {
      // Five results, one in progress and one to come, so every tab has something.
      const status = index < 5 ? "finished" : index === 5 ? "live" : "scheduled";
      const kickoff = new Date(Date.now() + (index < 5 ? -(5 - index) * 7 * 86_400_000 : index === 5 ? -45 * 60_000 : 6 * 86_400_000)).toISOString();
      const venue = `${VENUE} ${index + 1}`;
      const [homeGoals, awayGoals] = index === 6 ? [0, 0] : SCORELINES[Math.floor(roll() * SCORELINES.length)];
      const label = `${fixture.home.name} ${homeGoals}-${awayGoals} ${fixture.away.name} · ${status}`;
      const already = existing.items.find((match) => match.competition_id === league.id && match.venue === venue);
      if (already) { console.log(`  = ${fixture.home.name} ${already.home_score}-${already.away_score} ${fixture.away.name} · ${already.status} (already seeded)`); continue; }
      if (DRY_RUN) { console.log(`  + ${label}`); continue; }

      const match = await call("/api/v1/matches", { method: "POST", body: { competition_id: league.id, home_team_id: fixture.home.id, away_team_id: fixture.away.id, kickoff_datetime: kickoff, venue, status: "scheduled", half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15, has_extra_time: false, extra_time_half_length_minutes: 15 } });
      if (status === "scheduled") { console.log(`  + ${label}`); continue; }
      // The row's own flag is 0/1; a patch merges over it, so it is restated
      // as the boolean the API validates.
      const setStatus = (next) => call(`/api/v1/matches/${match.id}`, { method: "PATCH", body: { status: next, has_extra_time: false } });
      await setStatus("live");
      const appearances = [...squads.get(fixture.home.id) ?? [], ...squads.get(fixture.away.id) ?? []].map((player) => ({ player_id: player.id, appeared: true, minutes_played: 90 }));
      if (appearances.length) await call(`/api/v1/matches/${match.id}/player-stats`, { method: "PUT", body: appearances });
      const minutes = new Set();
      for (const [team, goals] of [[fixture.home, homeGoals], [fixture.away, awayGoals]]) {
        const squad = squads.get(team.id) ?? [];
        for (let goal = 0; goal < goals; goal += 1) {
          let minute = 1 + Math.floor(roll() * 90);
          while (minutes.has(minute)) minute = 1 + Math.floor(roll() * 90);
          minutes.add(minute);
          // Scorers and assisters are drawn separately from the whole squad, so
          // the tallies spread instead of following one striker down the season.
          const pool = scorers.get(team.id) ?? [];
          const scorer = pool.length ? pool[Math.floor(roll() * pool.length)] : null;
          const helpers = (assisters.get(team.id) ?? []).filter((player) => player.id !== scorer?.id);
          const assister = helpers.length && roll() > 0.3 ? helpers[Math.floor(roll() * helpers.length)] : null;
          await call(`/api/v1/matches/${match.id}/events`, { method: "POST", body: { type: "goal", minute, team_id: team.id, player_id: scorer?.id ?? null, secondary_player_id: assister?.id ?? null, is_penalty: false, client_operation_id: `mock-${match.id.slice(0, 8)}-${team.id.slice(0, 6)}-${goal}` } });
        }
      }
      if (status === "finished") await setStatus("finished");
      console.log(`  + ${label}`);
    }
  }
  console.log("\nDone. Fictional data only.");
}

main().catch((error) => { console.error(error.message); process.exit(1); });
