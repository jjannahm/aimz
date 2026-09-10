-- Training ratings follow the player's existing football position.
--
-- Minutes trained is retired rather than deleted so historical rows remain
-- intact. Inactive metrics are absent from entry, summaries and reports.
ALTER TABLE training_metrics ADD COLUMN player_kind TEXT NOT NULL DEFAULT 'all'
  CHECK (player_kind IN ('all', 'outfield', 'goalkeeper'));

UPDATE training_metrics SET is_active = 0, updated_at = '2026-09-10T00:00:00.000Z'
WHERE key = 'minutes_trained';

UPDATE training_metrics SET player_kind = 'outfield', updated_at = '2026-09-10T00:00:00.000Z'
WHERE key IN ('dribbling', 'shooting', 'passing');

INSERT INTO training_metrics
  (id, key, label, kind, min_value, max_value, unit, sort_order, is_active, created_at, updated_at, player_kind)
VALUES
  ('m-overall',       'overall_rating', 'Overall Rating', 'rating', 1, 10, NULL, 10, 1, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z', 'all'),
  ('m-shot-stopping', 'shot_stopping',  'Shot Stopping',  'rating', 1, 10, NULL, 20, 1, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z', 'goalkeeper'),
  ('m-handling',      'handling',       'Handling',       'rating', 1, 10, NULL, 30, 1, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z', 'goalkeeper'),
  ('m-distribution',  'distribution',   'Distribution',   'rating', 1, 10, NULL, 40, 1, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z', 'goalkeeper');
