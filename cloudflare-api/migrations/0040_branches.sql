-- Where the academy trains.
--
-- A newcomer application has recorded its branch as free text since 0035, and
-- the filter above the intake queue was a text box to match. That is fine for
-- storing what somebody chose and useless for offering the choice: nothing in
-- the database could say which branches exist, only which ones had already
-- been typed.
--
-- So the four branches become rows. Applications keep storing the branch by
-- name rather than by id: the name is what was chosen at the time, and a
-- branch that closes or is renamed must not silently rewrite an application
-- made last spring. This table is the list to choose from, not a foreign key
-- the intake depends on.
CREATE TABLE branches (
  id TEXT PRIMARY KEY,
  -- Matched against newcomer_applications.branch, so it is the whole name as
  -- an applicant sees it.
  name TEXT NOT NULL UNIQUE,
  -- Which side of Cairo, which is how the academy itself groups them.
  area TEXT NOT NULL CHECK (area IN ('East', 'West')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX ix_branches_active ON branches(is_active, sort_order);

INSERT INTO branches (id, name, area, sort_order, is_active, created_at, updated_at) VALUES
  ('branch-auc', 'AUC', 'East', 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('branch-gardenia', 'Gardenia (Agyal Park)', 'East', 2, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('branch-palm-hills', 'Palm Hills Sporting Club', 'West', 3, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('branch-kings-crown', 'King''s School The Crown', 'West', 4, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
