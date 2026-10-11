pub mod ai;
pub(crate) mod duel;
pub mod engine;
pub mod event;
pub mod live_match;
pub mod rating;
pub mod report;
pub(crate) mod shared;
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

pub use engine::simulate;
pub use engine::simulate_with_rng;
pub use event::{EventType, MatchEvent};
pub use live_match::{
    LiveMatchState, MatchCommand, MatchPhase, MatchSnapshot, MinuteResult, PenaltyShootoutSnapshot,
    SetPieceTakers, SubstitutionRecord,
};
pub use report::{GoalDetail, GoalSource, MatchReport, PlayerMatchStats, TeamStats};
pub use types::{
    BreakSpeed, CoachMastery, CounterPressDuration, DefensiveLine, DefensiveShape, MarkingStyle,
    MatchConfig, PlayStyle, PlayerData, PlayerRole, Position, PressingIntensity, Side,
    TacticalDial, TacticsBuildUpStyle, TacticsConfig, TacticsPitchWidth, TeamData, Tempo, Zone,
};
