pub mod ai;
pub(crate) mod duel;
pub mod event;
mod headless;
pub mod knobs;
mod legacy_blend;
pub mod live_match;
pub mod pitch_position;
pub mod rating;
pub mod report;
pub(crate) mod shared;
pub mod tally;
pub mod targets;
pub mod types;

// Re-export key types for convenience
/// How much likelier a player of `fitness` is to be hurt in a challenge: the
/// less match-fit, the likelier. Mirrors the table `ofm_core` uses for
/// match-day injuries.
pub fn injury_fitness_multiplier(fitness: u8) -> f64 {
    match fitness {
        0..=29 => 3.0,
        30..=49 => 2.0,
        50..=69 => 1.5,
        90.. => 0.7,
        _ => 1.0,
    }
}

/// The version of the match rules, as the online server pins it per season (phase 3, Z1: the fork
/// tags `engine-v<this>`). It is the engine crate's own version, and
/// `tests/golden_tests.rs::engine_version_moves_with_the_golden_tables` fails until it is bumped
/// whenever a change moves a pinned golden match.
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

pub use duel::aerial_rating_of;
pub use event::{EventType, Lane, MatchEvent, SetPiece, ShotKind, TacticalContext};
pub use headless::simulate_with_rng;
pub use knobs::{CalibrationKnobs, apply_knob_file};
pub use legacy_blend::{legacy_dribbling, legacy_passing};
pub use live_match::{
    LiveMatchState, MatchCommand, MatchPhase, MatchSnapshot, MinuteResult, PenaltyShootoutSnapshot,
    SetPieceTakers, SubstitutionRecord,
};
pub use live_match::{is_role_valid_for_position, shot_weight};
pub use pitch_position::{FORMATIONS, PitchPosition, PositionFit, PositionRating, formation_slots};
pub use report::{
    EVENT_PROTOCOL_VERSION, GoalDetail, GoalSource, MatchReport, PlayerMatchStats, TeamSheet,
    TeamStats,
};
pub use shared::{StylePhase, play_style_effects};
pub use tally::EventTally;
pub use types::{
    BreakSpeed, CoachMastery, CounterPressDuration, CrossStyle, DefensiveLine, DefensiveShape,
    Foot, MarkingStyle, MatchConfig, OffsideTrap, PlayStyle, PlayerData, PlayerRole, Position,
    PressingIntensity, Side, TacticalDial, TacticsBuildUpStyle, TacticsConfig, TacticsPitchWidth,
    TeamData, Tempo, Zone,
};
