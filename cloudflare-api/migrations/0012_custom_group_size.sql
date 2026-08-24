-- How many teams share a group. Null means the four every knockout was drawn
-- with before custom shapes existed, so the groups of an existing competition
-- still divide out of its team count the way they always did.
ALTER TABLE competitions ADD COLUMN group_size INTEGER;
