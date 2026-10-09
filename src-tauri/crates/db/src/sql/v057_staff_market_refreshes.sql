-- The manager's manual refreshes of the staff market this calendar month, as
-- JSON. '{}' is none used, as `Game::staff_market_refreshes` defaults to.
ALTER TABLE game_meta ADD COLUMN staff_market_refreshes_json TEXT NOT NULL DEFAULT '{}';
