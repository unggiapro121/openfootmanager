-- The user's offers still waiting for the other side's answer, as JSON. '[]'
-- is none, as `Game::awaited_replies` defaults to.
ALTER TABLE game_meta ADD COLUMN awaited_replies_json TEXT NOT NULL DEFAULT '[]';
