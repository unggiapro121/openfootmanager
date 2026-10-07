-- A manager's command of each play style, as JSON keyed by style name. '{}'
-- deserializes to 50 in every style, the same neutral mastery
-- `domain::manager::PlayStyleMastery::default` gives an old JSON save.
ALTER TABLE managers ADD COLUMN play_style_mastery TEXT NOT NULL DEFAULT '{}';
