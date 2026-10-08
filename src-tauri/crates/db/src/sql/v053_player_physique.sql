-- A player's height (cm) and weight (kg), drawn when he is generated and fixed
-- for his career. 0 means not known and must match
-- `domain::player::DEFAULT_HEIGHT_CM` / `DEFAULT_WEIGHT_KG`, so a row written
-- before these columns existed loads exactly as an old JSON save does.
ALTER TABLE players ADD COLUMN height_cm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN weight_kg INTEGER NOT NULL DEFAULT 0;
