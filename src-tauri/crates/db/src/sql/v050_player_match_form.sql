-- A player's recent match form: a moving average of his match ratings in tenths
-- of a point (60 = 6.0, an ordinary game). It scales how fast training develops
-- him. 60 must match `domain::player::DEFAULT_MATCH_FORM`, so a row written
-- before this column existed loads exactly as an old JSON save does.
ALTER TABLE players ADD COLUMN match_form INTEGER NOT NULL DEFAULT 60;
