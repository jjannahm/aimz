-- A table no code reads, on the one database that has it.
--
-- On 2026-09-14 the production database was migrated from a working copy that
-- still carried `0045_rate_limits.sql`, an early sign-in limiter replaced by the
-- rate limiting bindings in #215 before it ever reached main. That file created
-- `rate_limits` there and nowhere else. It holds nothing and nothing uses it
-- (the newcomer form keeps its own `newcomer_rate_limits`), so it goes, and every
-- database ends on the same schema. Elsewhere this does nothing.
DROP TABLE IF EXISTS rate_limits;
