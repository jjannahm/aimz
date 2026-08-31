-- An account that stops working on a date.
--
-- Wanted for accounts handed to someone who only needs to look for a while: a
-- reviewer, a trial coach, a parent visiting for a tournament. An account with
-- no row here never expires, which is every account that already exists.
--
-- A table of its own rather than a column on `users`. Adding one would mean
-- either an ALTER or rebuilding a table five others hold foreign keys into, and
-- an expiry is a fact about an arrangement rather than part of who someone is.
-- The row goes when the account does.
--
-- Nothing is deleted when the moment passes: the account stops signing in and
-- stops refreshing, and an administrator can lift the date or set a new one, so
-- an expiry is a lock rather than a demolition.
CREATE TABLE account_expiry (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
