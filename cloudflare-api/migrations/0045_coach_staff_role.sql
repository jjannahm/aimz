-- Which job a coach account holds on the squad it is assigned to.
--
-- `user_teams` already says which squads an account runs; it could not say in
-- what capacity, so an assistant and a head coach were the same row. Defaulting
-- to 'coach' keeps every assignment already made — an invitation's, an earlier
-- admin's — meaning exactly what it meant before.
ALTER TABLE user_teams ADD COLUMN staff_role TEXT NOT NULL DEFAULT 'coach';
