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

pub use duel::aerial_rating_of;
pub use event::{EventType, Lane, MatchEvent, SetPiece, ShotKind, TacticalContext};
pub use headless::{simulate, simulate_with_rng};
pub use knobs::{CalibrationKnobs, apply_knob_file};
pub use legacy_blend::{legacy_dribbling, legacy_passing};
pub use live_match::shot_weight;
pub use live_match::{
    LiveMatchState, MatchCommand, MatchPhase, MatchSnapshot, MinuteResult, PenaltyShootoutSnapshot,
    SetPieceTakers, SubstitutionRecord,
};
pub use pitch_position::{PitchPosition, PositionFit, PositionRating, formation_slots};
pub use report::{
    EVENT_PROTOCOL_VERSION, GoalDetail, GoalSource, MatchReport, PlayerMatchStats, TeamSheet,
    TeamStats,
};
pub use tally::EventTally;
pub use types::{
    BreakSpeed, CoachMastery, CounterPressDuration, CrossStyle, DefensiveLine, DefensiveShape,
    Foot, MarkingStyle, MatchConfig, PlayStyle, PlayerData, PlayerRole, Position,
    PressingIntensity, Side, TacticalDial, TacticsBuildUpStyle, TacticsConfig, TacticsPitchWidth,
    TeamData, Tempo, Zone,
};
