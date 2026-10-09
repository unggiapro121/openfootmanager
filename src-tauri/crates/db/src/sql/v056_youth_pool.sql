-- The season's youth pool — every nation's unattached youngsters and what each
-- AI club still means to sign — as JSON. 'null' is no pool yet, as
-- `Game::youth_pool` defaults to; the career draws one on its next Monday.
ALTER TABLE game_meta ADD COLUMN youth_pool_json TEXT NOT NULL DEFAULT 'null';
