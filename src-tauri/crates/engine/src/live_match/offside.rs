//! Offside (phase 2, after GĐ5; `fm-document/comon/analysis-offside.md`).
//!
//! The engine plays zones and lanes, not positions, so offside is a chance at
//! the three moments real runners are flagged: a ball played into the final
//! third, a ball over the top for a race, and a break. Real football: 4.35
//! flagged a match (StatsBomb 2015/16, 100 matches).
//!
//! ```text
//! P(offside) = base(moment) × line × trap × runner, at most 0.6
//!   line   VeryLow 0.4 · Low 0.7 · Medium 1.0 · High 1.5
//!   trap   Off 1 · On offside_trap_factor
//!   runner 1 + (60 − (positioning + decisions)/2) / 50, in 0.6–1.4
//! ```
//!
//! Flagged, the defending side restarts from its own third. An offside trap
//! catches more runners, but a runner who beats it is through: his race for
//! the ball over the top gains `offside_trap_beaten`.

use rand::{Rng, RngExt};

use super::LiveMatchState;
use crate::event::{EventType, MatchEvent};
use crate::knobs::CalibrationKnobs;
use crate::shared::PlayerSnap;
use crate::types::{DefensiveLine, OffsideTrap, Side, Zone};

/// When a runner can be caught offside.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OffsideMoment {
    /// A ball played from midfield into the final third.
    IntoTheFinalThird,
    /// A ball over the top for a race in behind.
    OverTheTop,
    /// A ball played forward the moment it is won, on the break.
    OnTheBreak,
}

/// The highest chance of a flag, whatever the line and the runner.
const MAX_CHANCE: f64 = 0.6;

/// The chance a runner reading the line at `reading` (his positioning and
/// decisions) is flagged against `line` and `trap` at `moment`.
pub(crate) fn offside_chance(
    moment: OffsideMoment,
    line: DefensiveLine,
    trap: OffsideTrap,
    reading: f64,
    knobs: &CalibrationKnobs,
) -> f64 {
    let base = match moment {
        OffsideMoment::IntoTheFinalThird => knobs.offside_pass,
        OffsideMoment::OverTheTop => knobs.offside_long_ball,
        OffsideMoment::OnTheBreak => knobs.offside_break,
    };
    // A higher line leaves less room to stay on behind it.
    let line_factor = match line {
        DefensiveLine::VeryLow => 0.4,
        DefensiveLine::Low => 0.7,
        DefensiveLine::Medium => 1.0,
        DefensiveLine::High => 1.5,
    };
    let trap_factor = match trap {
        OffsideTrap::Off => 1.0,
        OffsideTrap::On => knobs.offside_trap_factor,
    };
    // A forward who reads the line times his run.
    let runner_factor = (1.0 + (60.0 - reading) / 50.0).clamp(0.6, 1.4);
    (base * line_factor * trap_factor * runner_factor).clamp(0.0, MAX_CHANCE)
}

/// How well `runner` reads the line: the mean of his positioning and decisions.
pub(crate) fn reading_of(runner: &PlayerSnap) -> f64 {
    (f64::from(runner.positioning) + f64::from(runner.decisions)) / 2.0
}

impl LiveMatchState {
    /// Whether `runner` of `att_side` is flagged offside at `moment`. If he
    /// is, the flag is emitted into `events` and the defending side has the
    /// ball in its own third.
    pub(super) fn flag_offside<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        runner: &PlayerSnap,
        moment: OffsideMoment,
        events: &mut Vec<MatchEvent>,
        rng: &mut R,
    ) -> bool {
        let def_side = att_side.opposite();
        let tactics = &self.team_ref(def_side).tactics;
        let chance = offside_chance(
            moment,
            tactics.defensive_line,
            tactics.offside_trap,
            reading_of(runner),
            &self.config.knobs,
        );
        if rng.random_range(0.0..1.0f64) >= chance {
            return false;
        }
        let zone = Zone::attacking_third(att_side);
        let flag =
            MatchEvent::new(minute, EventType::Offside, att_side, zone).with_player(&runner.id);
        self.emit(events, flag);
        self.possession = def_side;
        self.ball_zone = zone;
        self.on_the_break = None;
        self.pending_context = None;
        true
    }

    /// The race for a ball over the top, multiplied for a runner who beat an
    /// offside trap: the line stepped up and left him through.
    pub(super) fn trap_beaten_factor(&self, att_side: Side) -> f64 {
        match self.team_ref(att_side.opposite()).tactics.offside_trap {
            OffsideTrap::Off => 1.0,
            OffsideTrap::On => self.config.knobs.offside_trap_beaten,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chance(line: DefensiveLine, trap: OffsideTrap, reading: f64) -> f64 {
        offside_chance(
            OffsideMoment::IntoTheFinalThird,
            line,
            trap,
            reading,
            &CalibrationKnobs::default(),
        )
    }

    /// Given an average runner against a medium line,
    /// when the ball is played into the final third,
    /// then the flag goes up `offside_pass` of the time.
    #[test]
    fn an_average_runner_against_a_medium_line_is_flagged_at_the_base_rate() {
        let knobs = CalibrationKnobs::default();
        assert!(
            (chance(DefensiveLine::Medium, OffsideTrap::Off, 60.0) - knobs.offside_pass).abs()
                < 1e-12
        );
    }

    /// Given the same runner,
    /// when the line rises and then springs a trap,
    /// then each catches him more often; a deep line hardly ever does.
    #[test]
    fn a_higher_line_and_a_trap_catch_more_runners() {
        let deep = chance(DefensiveLine::VeryLow, OffsideTrap::Off, 60.0);
        let medium = chance(DefensiveLine::Medium, OffsideTrap::Off, 60.0);
        let high = chance(DefensiveLine::High, OffsideTrap::Off, 60.0);
        let trap = chance(DefensiveLine::High, OffsideTrap::On, 60.0);
        assert!(
            deep < medium && medium < high && high < trap,
            "{deep} {medium} {high} {trap}"
        );
    }

    /// Given a home runner on the break against a line that flags everyone
    /// it can,
    /// when he is caught offside,
    /// then the flag names him, the away side has the ball in its own third
    /// and the break is over.
    #[test]
    fn a_runner_caught_offside_hands_the_ball_to_the_defence() {
        use crate::live_match::test_support::make_team;
        use crate::types::MatchConfig;
        use rand::SeedableRng;
        use rand::rngs::StdRng;

        let mut config = MatchConfig::default();
        config.knobs.offside_break = 1.0;
        let mut state = LiveMatchState::new(
            make_team("home"),
            make_team("away"),
            config,
            vec![],
            vec![],
            false,
        );
        state.on_the_break = Some(Side::Home);
        let runner = state.snap_player_by_id(&state.home.players[10].id.clone(), Side::Home);
        let mut rng = StdRng::seed_from_u64(1);
        let mut events = Vec::new();
        let flagged = (0..50).any(|_| {
            state.flag_offside(
                1,
                Side::Home,
                &runner,
                OffsideMoment::OnTheBreak,
                &mut events,
                &mut rng,
            )
        });
        assert!(flagged);
        let flag = events.last().expect("the flag");
        assert_eq!(flag.event_type, EventType::Offside);
        assert_eq!(flag.player_id.as_deref(), Some(runner.id.as_str()));
        assert_eq!(state.possession, Side::Away);
        assert_eq!(state.ball_zone, Zone::attacking_third(Side::Home));
        assert_eq!(state.on_the_break, None);
    }

    /// Given a runner who reads the line well and one who does not,
    /// when each runs against the same line,
    /// then the sharp one is flagged less often.
    #[test]
    fn a_runner_who_reads_the_line_is_flagged_less() {
        let sharp = chance(DefensiveLine::Medium, OffsideTrap::Off, 85.0);
        let slow = chance(DefensiveLine::Medium, OffsideTrap::Off, 35.0);
        assert!(sharp < slow, "{sharp} {slow}");
    }
}
