-- A player's recent share of his club's minutes (0-100), which scales how fast
-- training develops him. 50 is the neutral "not yet known" value and must match
-- `domain::player::DEFAULT_PLAYING_TIME`, so a row written before this column
-- existed loads exactly as an old JSON save does.
ALTER TABLE players ADD COLUMN playing_time INTEGER NOT NULL DEFAULT 50;
