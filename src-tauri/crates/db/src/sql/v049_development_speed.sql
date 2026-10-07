-- How fast players develop in this career, as a percentage of the realistic
-- pace: 100 is 1x, up to 500 (5x) in steps of 50 (`Game::development_speed`).
-- 100 is what a save from before the setting existed plays at, and must match
-- `DevelopmentSpeed::default()`.
ALTER TABLE game_meta ADD COLUMN development_speed_percent INTEGER NOT NULL DEFAULT 100;
