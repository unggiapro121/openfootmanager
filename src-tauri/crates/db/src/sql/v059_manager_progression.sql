-- The user's career progression as JSON: reputation history and the running
-- season tallies. '{}' deserializes to `ManagerProgression::default`, the same
-- empty progression an old JSON save gets, so existing rows need no backfill.
ALTER TABLE managers ADD COLUMN progression TEXT NOT NULL DEFAULT '{}';
