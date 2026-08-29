-- Appearances for matches that were already played.
--
-- `player_match_stats.appeared` was only ever written as a side effect of doing
-- something: an event naming the player, minutes typed in by hand, or being the
-- keeper. Taking the field never wrote it. So a player who turned out every
-- week and never scored counted nil appearances — in the leaders table, in the
-- awards, and on her own profile.
--
-- The team sheet has held the answer all along. From here on `pitchStatements`
-- keeps the flag right as a match is played; this is the same rule applied
-- backwards, once, to everything already in the table.
--
-- Only ever sets the flag, never clears it. An appearance already recorded came
-- from an event, from saved minutes, or from goalkeeping, and every one of
-- those means the player was on the pitch — there is nothing here to correct
-- downwards, and clearing would throw away the only record a match scored
-- without a team sheet has.
--
-- `minutes_played` is left at nought on any row this creates. It is not
-- derivable from the sheet, it is what an admin types in, and inventing a
-- number would be worse than admitting there isn't one.

-- Ids keep the shape every other row uses: SQLite has no uuid(), so this is the
-- usual randomblob spelling of a version-4 one. Written out at each use rather
-- than hidden behind a view, because a subquery that names no outer column can
-- be evaluated once for the whole statement, which would hand every row the
-- same primary key.

-- 1. Everyone who started a match that has kicked off.
INSERT INTO player_match_stats (id, match_id, player_id, team_id, appeared, minutes_played, created_at, updated_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), l.match_id, l.player_id, l.team_id, 1, 0, m.updated_at, m.updated_at
FROM match_lineup_entries l
JOIN matches m ON m.id = l.match_id
WHERE l.is_starter = 1 AND m.status <> 'scheduled'
ON CONFLICT(match_id, player_id) DO UPDATE SET
  appeared = 1,
  team_id = COALESCE(player_match_stats.team_id, excluded.team_id),
  updated_at = excluded.updated_at;

-- 2. Everyone brought on. On a substitution, `player_id` is the player arriving
-- and `secondary_player_id` the one going off, which is the reading the
-- goalkeeping walk already relies on. Whoever went off started, so rule 1 has
-- her; only the arrival is new here.
INSERT INTO player_match_stats (id, match_id, player_id, team_id, appeared, minutes_played, created_at, updated_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), e.match_id, e.player_id, e.team_id, 1, 0, m.updated_at, m.updated_at
FROM match_events e
JOIN matches m ON m.id = e.match_id
WHERE e.type = 'substitution' AND e.player_id IS NOT NULL AND m.status <> 'scheduled'
ON CONFLICT(match_id, player_id) DO UPDATE SET
  appeared = 1,
  team_id = COALESCE(player_match_stats.team_id, excluded.team_id),
  updated_at = excluded.updated_at;
