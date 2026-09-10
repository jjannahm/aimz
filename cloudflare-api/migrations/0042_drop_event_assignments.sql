-- Volunteer assignments are gone.
--
-- The panel that wrote this table stood on the match and training screens and
-- was never used: a title, an optional player, and a list nobody claimed from.
-- 0017 is left where it is so the history of the schema still reads straight;
-- this drops the table itself, which is what a deployed database still has.
-- Its two indexes go with it.
DROP TABLE IF EXISTS event_assignments;
