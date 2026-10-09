-- The youth prospects the user is following, as JSON. '[]' is an empty list,
-- as `Game::youth_watchlist` defaults to.
ALTER TABLE game_meta ADD COLUMN youth_watchlist_json TEXT NOT NULL DEFAULT '[]';
