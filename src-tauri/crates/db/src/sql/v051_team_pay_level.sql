-- How a club pays against the market rate for a player's ability (1.0 = the
-- market rate). Set from its income and squad as a career opens and at each
-- season's start; 1.0 must match `domain::team::default_pay_level`, so a row
-- written before this column existed loads as an old JSON save does.
ALTER TABLE teams ADD COLUMN pay_level REAL NOT NULL DEFAULT 1.0;
