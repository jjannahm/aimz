-- Which badge a team wears, held apart from is_aimz so a league of peer clubs
-- can each keep their own crest while is_aimz stays a feature flag.
-- NULL keeps the old behaviour: the club crest for our squads, a generated
-- shield for everyone else.
ALTER TABLE teams ADD COLUMN badge_style TEXT CHECK (badge_style IN ('aimz', 'generated'));
