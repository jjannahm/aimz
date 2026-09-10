-- Who a notice is for, and how loudly it is said.
--
-- Until now an announcement had one dial and one switch: a squad or nothing,
-- and pinned or not. Two things were missing. There was no way to tell one
-- family rather than a whole squad — a question about one player's fees went
-- to thirty households or to none — and no way to say that something is
-- urgent, which is different from saying it should stay at the top.
--
-- `audience` says which kind of thing is being addressed and `priority` how
-- loudly. `pinned` stays as a stored column rather than being derived on read,
-- because every existing reader orders by it; it is written from the priority,
-- which is what makes "urgent is always pinned" structural rather than a rule
-- somebody has to remember.
--
-- SQLite cannot add a CHECK to an existing column, so the table is rebuilt.
-- Nothing holds a foreign key into announcements, so DROP TABLE fires no
-- cascade and only the rows themselves need copying aside.

CREATE TABLE announcements_backup AS SELECT * FROM announcements;

DROP TABLE announcements;

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  -- The squad a notice is for, kept where it has always been. Null for the
  -- whole academy and for one addressed to coaches.
  team_id TEXT REFERENCES teams(id) ON DELETE CASCADE,
  -- 'academy' reaches everybody, 'team' reaches one squad — or the named
  -- players on it — and 'coaches' reaches those who run squads rather than
  -- the families in them.
  audience TEXT NOT NULL DEFAULT 'academy' CHECK (audience IN ('academy', 'team', 'coaches')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  priority TEXT NOT NULL DEFAULT 'standard' CHECK (priority IN ('standard', 'pinned', 'urgent')),
  -- Written from the priority, never set on its own: urgent is pinned, and a
  -- reader ordering by this column cannot see the two disagree.
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Everything that existed was either a squad notice or an academy one, and
-- pinned or not, which is exactly what the two new columns say.
INSERT INTO announcements (id, team_id, audience, title, body, author_id, priority, pinned, created_at, updated_at)
SELECT id,
       team_id,
       CASE WHEN team_id IS NULL THEN 'academy' ELSE 'team' END,
       title,
       body,
       author_id,
       CASE WHEN pinned = 1 THEN 'pinned' ELSE 'standard' END,
       pinned,
       created_at,
       updated_at
  FROM announcements_backup;

CREATE INDEX ix_announcements_team_created ON announcements(team_id, created_at);
CREATE INDEX ix_announcements_audience ON announcements(audience, created_at);

DROP TABLE announcements_backup;

-- Named recipients, for a notice meant for some of a squad rather than all of
-- it, or for particular coaches.
--
-- A row names either a player or a user, never both: a family is reached
-- through the roster player they speak for — which is how every other private
-- thing in this app is addressed — while a coach has no roster record and is
-- reached as an account. No rows at all means the whole audience.
CREATE TABLE announcement_recipients (
  announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  CHECK ((player_id IS NULL) <> (user_id IS NULL))
);

CREATE INDEX ix_announcement_recipients_announcement ON announcement_recipients(announcement_id);
CREATE INDEX ix_announcement_recipients_player ON announcement_recipients(player_id);
CREATE INDEX ix_announcement_recipients_user ON announcement_recipients(user_id);
