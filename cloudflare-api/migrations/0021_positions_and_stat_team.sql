-- Two changes to the player record, both about attribution.
--
-- 1. Positions become a fixed vocabulary of sixteen codes. They were free text,
--    so "GK", "Goalkeeper" and "Keeper" were three different positions and
--    nothing could reliably find a squad's keepers. The API validates the codes
--    from here on; existing prose is mapped across below. No CHECK constraint
--    is added, because adding one to an existing column needs a full table
--    rebuild in D1 and the API boundary already refuses anything else.
--
-- 2. A statistic records which squad the player turned out for. Until now the
--    leaders table read the age group off the player's *current* team, so
--    promoting someone from U14 to U16 moved last season's U14 goals with her.
--    The lineup has carried the right answer all along and nothing read it.

-- 1. Positions -------------------------------------------------------------

-- Exact names first, so anything already written in full keeps its own code
-- rather than being flattened onto the middle of its line.
UPDATE players SET position = 'GK'  WHERE lower(trim(position)) IN ('gk', 'goalkeeper', 'keeper', 'goal keeper', 'goalie');
UPDATE players SET position = 'LWB' WHERE lower(trim(position)) IN ('lwb', 'left wing-back', 'left wing back');
UPDATE players SET position = 'RWB' WHERE lower(trim(position)) IN ('rwb', 'right wing-back', 'right wing back');
UPDATE players SET position = 'CB'  WHERE lower(trim(position)) IN ('cb', 'centre-back', 'centre back', 'center back', 'central defender');
UPDATE players SET position = 'LB'  WHERE lower(trim(position)) IN ('lb', 'left-back', 'left back');
UPDATE players SET position = 'RB'  WHERE lower(trim(position)) IN ('rb', 'right-back', 'right back');
UPDATE players SET position = 'DM'  WHERE lower(trim(position)) IN ('dm', 'defensive midfield', 'defensive midfielder', 'holding midfielder');
UPDATE players SET position = 'AM'  WHERE lower(trim(position)) IN ('am', 'attacking midfield', 'attacking midfielder');
UPDATE players SET position = 'LM'  WHERE lower(trim(position)) IN ('lm', 'left midfield', 'left midfielder');
UPDATE players SET position = 'RM'  WHERE lower(trim(position)) IN ('rm', 'right midfield', 'right midfielder');
UPDATE players SET position = 'CM'  WHERE lower(trim(position)) IN ('cm', 'centre midfield', 'centre midfielder', 'central midfielder', 'midfield', 'midfielder');
UPDATE players SET position = 'LW'  WHERE lower(trim(position)) IN ('lw', 'left wing', 'left winger');
UPDATE players SET position = 'RW'  WHERE lower(trim(position)) IN ('rw', 'right wing', 'right winger');
UPDATE players SET position = 'SS'  WHERE lower(trim(position)) IN ('ss', 'second striker', 'support striker');
UPDATE players SET position = 'CF'  WHERE lower(trim(position)) IN ('cf', 'centre-forward', 'centre forward', 'center forward');
UPDATE players SET position = 'ST'  WHERE lower(trim(position)) IN ('st', 'striker', 'forward', 'attacker');

-- Then whatever is left, by the line the prose points at. Each line resolves to
-- its most central position: a "Defender" becomes a centre-back rather than
-- this migration guessing a flank she may never have played on.
UPDATE players SET position = 'GK' WHERE position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST')
  AND (lower(position) LIKE 'goal%' OR lower(position) LIKE '%keeper%');
UPDATE players SET position = 'CM' WHERE position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST')
  AND lower(position) LIKE '%mid%';
UPDATE players SET position = 'CB' WHERE position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST')
  AND (lower(position) LIKE 'def%' OR lower(position) LIKE '%back%');
UPDATE players SET position = 'ST' WHERE position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST')
  AND (lower(position) LIKE '%forward%' OR lower(position) LIKE '%strik%' OR lower(position) LIKE '%wing%' OR lower(position) LIKE '%attack%');

-- Anything that named no position at all. The column is NOT NULL, so there is
-- always something here to replace.
UPDATE players SET position = 'CM'
  WHERE position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST');

-- The same treatment for the position a player was played in for one match,
-- which is nullable and stays nullable: no entry means no position was set.
UPDATE match_lineup_entries SET position = 'GK'  WHERE lower(trim(position)) IN ('gk', 'goalkeeper', 'keeper', 'goal keeper', 'goalie');
UPDATE match_lineup_entries SET position = 'LWB' WHERE lower(trim(position)) IN ('lwb', 'left wing-back', 'left wing back');
UPDATE match_lineup_entries SET position = 'RWB' WHERE lower(trim(position)) IN ('rwb', 'right wing-back', 'right wing back');
UPDATE match_lineup_entries SET position = 'CB'  WHERE lower(trim(position)) IN ('cb', 'centre-back', 'centre back', 'center back', 'central defender');
UPDATE match_lineup_entries SET position = 'LB'  WHERE lower(trim(position)) IN ('lb', 'left-back', 'left back');
UPDATE match_lineup_entries SET position = 'RB'  WHERE lower(trim(position)) IN ('rb', 'right-back', 'right back');
UPDATE match_lineup_entries SET position = 'DM'  WHERE lower(trim(position)) IN ('dm', 'defensive midfield', 'defensive midfielder', 'holding midfielder');
UPDATE match_lineup_entries SET position = 'AM'  WHERE lower(trim(position)) IN ('am', 'attacking midfield', 'attacking midfielder');
UPDATE match_lineup_entries SET position = 'LM'  WHERE lower(trim(position)) IN ('lm', 'left midfield', 'left midfielder');
UPDATE match_lineup_entries SET position = 'RM'  WHERE lower(trim(position)) IN ('rm', 'right midfield', 'right midfielder');
UPDATE match_lineup_entries SET position = 'CM'  WHERE lower(trim(position)) IN ('cm', 'centre midfield', 'centre midfielder', 'central midfielder', 'midfield', 'midfielder');
UPDATE match_lineup_entries SET position = 'LW'  WHERE lower(trim(position)) IN ('lw', 'left wing', 'left winger');
UPDATE match_lineup_entries SET position = 'RW'  WHERE lower(trim(position)) IN ('rw', 'right wing', 'right winger');
UPDATE match_lineup_entries SET position = 'SS'  WHERE lower(trim(position)) IN ('ss', 'second striker', 'support striker');
UPDATE match_lineup_entries SET position = 'CF'  WHERE lower(trim(position)) IN ('cf', 'centre-forward', 'centre forward', 'center forward');
UPDATE match_lineup_entries SET position = 'ST'  WHERE lower(trim(position)) IN ('st', 'striker', 'forward', 'attacker');

UPDATE match_lineup_entries SET position = 'GK' WHERE position IS NOT NULL
  AND position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST')
  AND (lower(position) LIKE 'goal%' OR lower(position) LIKE '%keeper%');
UPDATE match_lineup_entries SET position = 'CM' WHERE position IS NOT NULL
  AND position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST')
  AND lower(position) LIKE '%mid%';
UPDATE match_lineup_entries SET position = 'CB' WHERE position IS NOT NULL
  AND position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST')
  AND (lower(position) LIKE 'def%' OR lower(position) LIKE '%back%');
UPDATE match_lineup_entries SET position = 'ST' WHERE position IS NOT NULL
  AND position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST')
  AND (lower(position) LIKE '%forward%' OR lower(position) LIKE '%strik%' OR lower(position) LIKE '%wing%' OR lower(position) LIKE '%attack%');

UPDATE match_lineup_entries SET position = 'CM' WHERE position IS NOT NULL
  AND position NOT IN ('GK','CB','LB','RB','LWB','RWB','DM','CM','AM','LM','RM','LW','RW','SS','CF','ST');

-- 2. The squad a statistic belongs to ---------------------------------------

-- Nullable so the ALTER succeeds on a populated table, then filled immediately.
-- It stays nullable rather than being rebuilt NOT NULL: a row that predates any
-- lineup and whose player has since been deleted has no honest answer, and a
-- null there reads as "unknown" instead of a wrong squad.
ALTER TABLE player_match_stats ADD COLUMN team_id TEXT REFERENCES teams(id);

-- The lineup is the record of who turned out for whom, so it answers first.
UPDATE player_match_stats SET team_id = (
  SELECT l.team_id FROM match_lineup_entries l
  WHERE l.match_id = player_match_stats.match_id AND l.player_id = player_match_stats.player_id
) WHERE team_id IS NULL;

-- Rows with no lineup entry fall back to the squad the player is on now. This
-- preserves exactly today's answer for that older data — it does not correct
-- it — and everything recorded from here on is stamped at the time it happens.
UPDATE player_match_stats SET team_id = (
  SELECT p.team_id FROM players p WHERE p.id = player_match_stats.player_id
) WHERE team_id IS NULL;

CREATE INDEX ix_player_match_stats_team ON player_match_stats(team_id);
