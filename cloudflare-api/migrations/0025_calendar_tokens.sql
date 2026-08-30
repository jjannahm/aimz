-- Migration 0025: a parent's calendar subscription. The URL a calendar client polls carries a
-- random token, never a user id: an id is guessable across accounts, and it
-- would name the account inside a string that Apple, Google and Outlook all
-- store and sync.
--
-- The token is kept as itself rather than hashed, which is the one place this
-- differs from registration_invites.code_hash. A subscription URL has to stay
-- readable: the parent adds it on a second device, or taps Subscribe and never
-- finishes, and a hash could answer neither. It is a capability URL, the same
-- shape as Google Calendar's own secret address, and it grants only fixtures —
-- squad, opponent, time, venue — with no contact details and nothing about a
-- child beyond the squad they play for. Regenerating is the revocation.
CREATE TABLE calendar_tokens (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  -- Stamped once, when a calendar client first fetches the feed. That is what
  -- subscribing actually means; tapping the button is only an intention, and
  -- the parent may never finish adding it. Regenerating clears it along with
  -- the token, because they genuinely do have to add the new URL.
  first_fetched_at TEXT
);
CREATE INDEX ix_calendar_tokens_token ON calendar_tokens(token);
