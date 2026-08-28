/**
 * Fills every age-group league with the real clubs, as that club's youth side.
 *
 * The Egyptian Women's Premier League holds the real clubs under their own
 * names. The age-group leagues had invented ones — Cairo Stars, Delta Girls and
 * the rest — which this replaces with "Al Ahly U9", "Zamalek U13" and so on,
 * one per club per league. Each wears its club's own crest: the uploaded logo
 * is referenced by key rather than copied, so all six rows of a club point at
 * one picture in storage.
 *
 * The premier league itself is left alone. Its clubs keep their senior names
 * and their entry in it.
 *
 * Reruns update rather than duplicate: a club already present in a league by
 * name is patched, and a fixture already seeded at the same venue is left as it
 * stands.
 *
 * Staging only. Every fixture and every goal it writes is invented, in keeping
 * with the "Fictional data only" banner the preview carries; never point it at
 * anything holding real academy records.
 *
 * Usage:
 *   API_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/seed-age-group-leagues.mjs [--dry-run] [--keep-invented]
 */
const API_URL = (process.env.API_URL ?? "https://aimz-api-staging.shared-links.workers.dev").replace(/\/$/u, "");
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const DRY_RUN = process.argv.includes("--dry-run");
/** Leaves the invented clubs and their fixtures in place, for a look first. */
const KEEP_INVENTED = process.argv.includes("--keep-invented");

const PREMIER_LEAGUE = "Egyptian Women's Premier League";
/** Marks every fixture this script owns, so a rerun updates rather than duplicates. */
const VENUE = "AIMZ Mock Ground";
/** Enough that a table has something to sort on without a full double season. */
const ROUNDS = 3;

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
    const pairs = [];
    for (let pair = 0; pair < rotation.length / 2; pair += 1) {
      const home = rotation[pair]; const away = rotation[rotation.length - 1 - pair];
      // Alternating who is at home keeps one side from hosting every week.
      if (home && away) pairs.push(round % 2 ? { home: away, away: home } : { home, away });
    }
    rounds.push(pairs);
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

/** "Women U9" and "U9" alike answer "U9", which is what the clubs are suffixed with. */
const ageLabel = (name) => (/\bU(\d+)\b/u.exec(name) ?? [])[0] ?? null;

async function main() {
  ({ access_token: token } = await call("/api/v1/auth/login", { method: "POST", body: { email: EMAIL, password: PASSWORD } }));
  const [competitions, teams, players, matches] = await Promise.all([
    call("/api/v1/competitions?limit=100"), call("/api/v1/teams?limit=300"),
    call("/api/v1/players?limit=500"), call("/api/v1/matches?limit=300"),
  ]);

  const premier = competitions.items.find((competition) => competition.name === PREMIER_LEAGUE);
  if (!premier) { console.error(`No "${PREMIER_LEAGUE}" found.`); process.exit(1); }
  // Every league that is an age group, which is every league but the premier one.
  const leagues = competitions.items.filter((competition) => competition.id !== premier.id && ageLabel(competition.name));
  if (!leagues.length) { console.error("No age-group leagues found."); process.exit(1); }

  // The real clubs, as the premier league holds them. AIMZ is the academy
  // itself and fields its own age squads, so it is not one of the opponents.
  const clubs = teams.items.filter((team) => team.competition_id === premier.id && team.name !== "AIMZ");
  if (!clubs.length) { console.error("No clubs entered in the premier league."); process.exit(1); }
  console.log(`${clubs.length} clubs, ${leagues.length} age-group leagues.`);

  /** What this script writes, by league and club: "Al Ahly U9". */
  const youthName = (club, label) => `${club.name} ${label}`;
  const wanted = new Set(leagues.flatMap((league) => clubs.map((club) => youthName(club, ageLabel(league.name)))));

  // 1. The invented clubs, and every fixture that referenced them. The API
  // refuses to delete a team a match still points at, so the matches go first.
  const invented = teams.items.filter((team) => !team.is_aimz && !wanted.has(team.name));
  if (KEEP_INVENTED) {
    console.log(`\nLeaving ${invented.length} invented club(s) in place.`);
  } else if (invented.length) {
    const inventedIds = new Set(invented.map((team) => team.id));
    const orphaned = matches.items.filter((match) => inventedIds.has(match.home_team_id) || inventedIds.has(match.away_team_id));
    console.log(`\nRemoving ${invented.length} invented club(s) and ${orphaned.length} fixture(s) that used them.`);
    for (const match of orphaned) {
      if (DRY_RUN) { console.log(`  - fixture ${match.id}`); continue; }
      await call(`/api/v1/matches/${match.id}`, { method: "DELETE" });
    }
    for (const team of invented) {
      if (DRY_RUN) { console.log(`  - ${team.name}`); continue; }
      await call(`/api/v1/teams/${team.id}`, { method: "DELETE" });
    }
  }

  // 2. A youth side per club per league, wearing the club's own crest, plus the
  // academy's own squad for that age group entered alongside them.
  const entrants = new Map();
  for (const league of leagues) {
    const label = ageLabel(league.name);
    const squad = teams.items.find((team) => team.is_aimz && team.age_group === label);
    if (!squad) console.warn(`  ! no AIMZ squad for ${label}; ${league.name} will have clubs only`);
    else if (squad.competition_id !== league.id) {
      // The squads were entered in a leftover tournament, or in nothing at all.
      console.log(`\n${league.name}: entering AIMZ ${label}`);
      if (!DRY_RUN) await call(`/api/v1/teams/${squad.id}`, { method: "PATCH", body: { competition_id: league.id } });
    }
    const line = [];
    for (const club of clubs) {
      const name = youthName(club, label);
      const already = teams.items.find((team) => team.name === name);
      const body = {
        name, is_aimz: false, age_group: label, season: league.season,
        // Referenced, not re-uploaded: one picture serves the club and all of
        // its age groups.
        logo_key: club.logo_key ?? null, badge_style: club.badge_style ?? null,
        competition_id: league.id,
      };
      if (DRY_RUN) { line.push(already ? `=${name}` : `+${name}`); entrants.set(name, already ?? { id: `dry-${name}`, name }); continue; }
      const saved = already
        ? await call(`/api/v1/teams/${already.id}`, { method: "PATCH", body })
        : await call("/api/v1/teams", { method: "POST", body });
      line.push(already ? `=${name}` : `+${name}`);
      entrants.set(name, saved);
    }
    console.log(`${league.name}: ${line.length} clubs`);
    entrants.set(league.id, [squad, ...clubs.map((club) => entrants.get(youthName(club, label)))].filter(Boolean));
  }

  if (DRY_RUN) { console.log("\nDry run. Fictional data only."); return; }

  // 3. Fixtures, so each league's table, top scorers and top assisters have
  // something varied to show.
  const squads = new Map(teams.items.map((team) => [team.id, players.items.filter((player) => player.team_id === team.id)]));
  for (const league of leagues) {
    const entered = entrants.get(league.id) ?? [];
    if (entered.length < 2) { console.warn(`Skipping ${league.name}: ${entered.length} team(s).`); continue; }
    const roll = random(league.id);
    const rounds = roundRobin(entered).slice(0, ROUNDS);
    const fixtures = rounds.flat();
    const scorers = new Map(entered.map((team) => [team.id, weighted(squads.get(team.id) ?? [], 0)]));
    const assisters = new Map(entered.map((team) => [team.id, weighted(squads.get(team.id) ?? [], 2)]));
    console.log(`\n${league.name} (${league.season}) — ${entered.length} teams, ${fixtures.length} fixtures`);
    for (const [index, fixture] of fixtures.entries()) {
      const venue = `${VENUE} ${index + 1}`;
      const already = matches.items.find((match) => match.competition_id === league.id && match.venue === venue);
      if (already) { console.log(`  = ${fixture.home.name} v ${fixture.away.name} (already seeded)`); continue; }
      const [homeGoals, awayGoals] = SCORELINES[Math.floor(roll() * SCORELINES.length)];
      const kickoff = new Date(Date.now() - (fixtures.length - index) * 7 * 86_400_000).toISOString();
      const match = await call("/api/v1/matches", { method: "POST", body: { competition_id: league.id, home_team_id: fixture.home.id, away_team_id: fixture.away.id, kickoff_datetime: kickoff, venue, status: "scheduled", half_length_minutes: 45, num_halves: 2, half_time_break_minutes: 15, has_extra_time: false, extra_time_half_length_minutes: 15 } });
      // The row's own flag is 0/1; a patch merges over it, so it is restated as
      // the boolean the API validates.
      const setStatus = (next) => call(`/api/v1/matches/${match.id}`, { method: "PATCH", body: { status: next, has_extra_time: false } });
      await setStatus("live");
      const appearances = [...squads.get(fixture.home.id) ?? [], ...squads.get(fixture.away.id) ?? []].map((player) => ({ player_id: player.id, appeared: true, minutes_played: 90 }));
      if (appearances.length) await call(`/api/v1/matches/${match.id}/player-stats`, { method: "PUT", body: appearances });
      const minutes = new Set();
      for (const [team, goals] of [[fixture.home, homeGoals], [fixture.away, awayGoals]]) {
        for (let goal = 0; goal < goals; goal += 1) {
          let minute = 1 + Math.floor(roll() * 90);
          while (minutes.has(minute)) minute = 1 + Math.floor(roll() * 90);
          minutes.add(minute);
          // Scorers and assisters are drawn from separate weighted cores, so a
          // handful of names pile up goals and a different handful the assists.
          // A club side has no roster, so its goals are recorded without one.
          const pool = scorers.get(team.id) ?? [];
          const scorer = pool.length ? pool[Math.floor(roll() * pool.length)] : null;
          const helpers = (assisters.get(team.id) ?? []).filter((player) => player.id !== scorer?.id);
          const assister = helpers.length && roll() > 0.3 ? helpers[Math.floor(roll() * helpers.length)] : null;
          await call(`/api/v1/matches/${match.id}/events`, { method: "POST", body: { type: "goal", minute, team_id: team.id, player_id: scorer?.id ?? null, secondary_player_id: assister?.id ?? null, is_penalty: false, client_operation_id: `age-${match.id.slice(0, 8)}-${team.id.slice(0, 6)}-${goal}` } });
        }
      }
      await setStatus("finished");
      console.log(`  + ${fixture.home.name} ${homeGoals}-${awayGoals} ${fixture.away.name}`);
    }
  }
  console.log("\nDone. Fictional data only.");
}

main().catch((error) => { console.error(error.message); process.exit(1); });
