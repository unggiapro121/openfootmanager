-- When each of the user's scouts may next go on a youth search, as JSON keyed
-- by scout id. '{}' is no scout resting, as `Game::scout_youth_rest_until`
-- defaults to.
ALTER TABLE game_meta ADD COLUMN scout_youth_rest_until_json TEXT NOT NULL DEFAULT '{}';
