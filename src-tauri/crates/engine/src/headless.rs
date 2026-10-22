//! One call, kick-off to final whistle.
//!
//! This drives [`LiveMatchState`], the engine every real fixture goes through,
//! with nothing on the touchline: no benches, no manager commands and no extra
//! time. It is the entry point for sim-bench, the Sim Lab and the engine tests,
//! so they measure the same engine the game plays.

use rand::Rng;

use crate::live_match::LiveMatchState;
use crate::report::MatchReport;
use crate::types::{MatchConfig, TeamData};

/// Upper bound on engine steps for one match. A regulation match takes about
/// 100 (90 minutes, stoppage time, and one step per phase change), so this is
/// only reached if the phase machine stops advancing.
const MAX_STEPS: usize = 200;

/// Simulate a full match between two teams and return a detailed report.
#[expect(
    clippy::disallowed_methods,
    reason = "unseeded by design and called by nothing; removed in phase 3 E3-1"
)]
pub fn simulate(home: &TeamData, away: &TeamData, config: &MatchConfig) -> MatchReport {
    let mut rng = rand::rng();
    simulate_with_rng(home, away, config, &mut rng)
}

/// Simulate with an explicit RNG (useful for deterministic tests).
pub fn simulate_with_rng<R: Rng>(
    home: &TeamData,
    away: &TeamData,
    config: &MatchConfig,
    rng: &mut R,
) -> MatchReport {
    // A side with nobody on its books cannot play.
    if home.players.is_empty() || away.players.is_empty() {
        return MatchReport::from_events(Vec::new(), 0, 0, 0);
    }

    let mut state = LiveMatchState::new(
        home.clone(),
        away.clone(),
        config.clone(),
        Vec::new(),
        Vec::new(),
        false,
    );
    for _ in 0..MAX_STEPS {
        if state.is_finished() {
            break;
        }
        state.step_minute(rng);
    }
    debug_assert!(
        state.is_finished(),
        "match did not finish in {MAX_STEPS} steps"
    );
    state.into_report()
}
