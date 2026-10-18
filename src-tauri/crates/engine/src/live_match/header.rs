//! The second stage of an aerial duel the attackers won after a cross: the
//! header itself (phase 2, P2.2; `pass-cure-heading-freekick-enhancement.md`
//! §4.2, decision X36).
//!
//! The first stage, who reaches the ball, is `duel::aerial_win_probability`
//! and reads `aerial`. This one reads `heading`: where the ball goes once it is
//! reached. Until phase 2 a won header was played as an ordinary shot with the
//! feet (`shooting`), so a tall centre-forward who could not finish was as
//! dangerous from a cross as a poacher.
//!
//! ```text
//! rating    = 0.60·heading + 0.20·composure + 0.20·decisions        (× condition)
//! on target = clamp(0.40 + (rating − 50)/200, 0.15, 0.85) × 1.08 if PowerHeader
//! keeper    = 0.50·reflexes + 0.35·handling + 0.15·positioning      (× condition, traits)
//! goal      = clamp(0.28·DefLine + (rating − keeper)/160, 0.08, 0.65)
//! ```
//!
//! A header is never fouled into a penalty: the 3.6% box foul belongs to a shot
//! worked inside the box, not to a ball met in the air.

use rand::{Rng, RngExt};

use crate::event::{EventDetail, EventType, MatchEvent, ShotKind};
use crate::shared::{PlayerSnap, TraitContext, tactics_defensive_conversion_mod, trait_bonus};
use crate::types::{Position, Side, Zone};

use super::LiveMatchState;
use super::helpers::{danger_band, save_quality};

const ACCURACY_BASE: f64 = 0.40;
const ACCURACY_SPREAD: f64 = 200.0;
const ACCURACY_MIN: f64 = 0.15;
const ACCURACY_MAX: f64 = 0.85;
/// `PowerHeader` puts more of his headers on target.
const POWER_HEADER_ACCURACY: f64 = 1.08;
pub(crate) const CONVERSION_BASE: f64 = 0.28;
const CONVERSION_SPREAD: f64 = 160.0;
const CONVERSION_MIN: f64 = 0.08;
const CONVERSION_MAX: f64 = 0.65;

/// How well a player heads the ball at goal, before his condition.
fn header_rating(header: &PlayerSnap) -> f64 {
    0.60 * f64::from(header.heading)
        + 0.20 * f64::from(header.composure)
        + 0.20 * f64::from(header.decisions)
}

/// How well a keeper deals with a header, before his condition and traits:
/// mostly reactions, at close range.
fn keeper_rating_against_header(keeper: &PlayerSnap) -> f64 {
    0.50 * f64::from(keeper.reflexes)
        + 0.35 * f64::from(keeper.handling)
        + 0.15 * f64::from(keeper.positioning)
}

/// The chance a header of `rating` is on target.
fn header_accuracy(rating: f64, power_header: bool) -> f64 {
    let accuracy =
        (ACCURACY_BASE + (rating - 50.0) / ACCURACY_SPREAD).clamp(ACCURACY_MIN, ACCURACY_MAX);
    if power_header {
        (accuracy * POWER_HEADER_ACCURACY).min(1.0)
    } else {
        accuracy
    }
}

/// The chance an on-target header beats the keeper.
fn header_conversion(rating: f64, keeper: f64, defensive_line: f64, base: f64) -> f64 {
    (base * defensive_line + (rating - keeper) / CONVERSION_SPREAD)
        .clamp(CONVERSION_MIN, CONVERSION_MAX)
}

impl LiveMatchState {
    /// `header` has won the ball in the air from `crosser_id`'s cross: play
    /// the header out. A goal names the crosser as the assist.
    pub(super) fn resolve_header<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        header: PlayerSnap,
        crosser_id: String,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let def_side = att_side.opposite();
        let zone = Zone::attacking_box(att_side);
        let goalkeeper = self.snap_player(def_side, Position::Goalkeeper, rng);

        let rating = self.condition_adjusted_skill(&header.id, header_rating(&header));
        let keeper = self
            .condition_adjusted_skill(&goalkeeper.id, keeper_rating_against_header(&goalkeeper))
            * trait_bonus(&goalkeeper, TraitContext::Goalkeeping);

        if rng.random_range(0.0..1.0f64) >= header_accuracy(rating, header.has_trait("PowerHeader"))
        {
            let miss = MatchEvent::new(minute, EventType::ShotOffTarget, att_side, zone)
                .with_shot_kind(ShotKind::Header)
                .with_player(&header.id)
                .with_detail(EventDetail::Shot {
                    danger: danger_band(rating),
                });
            self.emit(&mut events, miss);
            let goal_kick = MatchEvent::new(minute, EventType::GoalKick, def_side, zone);
            self.emit(&mut events, goal_kick);
            self.ball_zone = Zone::defensive_third(def_side);
            self.possession = def_side;
            return events;
        }

        let defensive_line =
            tactics_defensive_conversion_mod(&self.team_ref(def_side).tactics, &self.config.knobs);
        let base = self.config.knobs.header_conversion_base;
        if rng.random_range(0.0..1.0f64) < header_conversion(rating, keeper, defensive_line, base) {
            let context = self.goal_context(att_side);
            let goal = MatchEvent::new(minute, EventType::Goal, att_side, zone)
                .with_shot_kind(ShotKind::Header)
                .with_player(&header.id)
                .with_secondary(&crosser_id)
                .with_detail(EventDetail::Goal { context });
            self.emit(&mut events, goal);
            self.add_goal(att_side);
            self.ball_zone = Zone::Midfield;
            self.possession = def_side;
        } else {
            let save = MatchEvent::new(minute, EventType::ShotSaved, att_side, zone)
                .with_shot_kind(ShotKind::Header)
                .with_player(&header.id)
                .with_secondary(&goalkeeper.id)
                .with_detail(EventDetail::Save {
                    quality: save_quality(keeper),
                });
            self.emit(&mut events, save);
            self.after_save(minute, att_side, &mut events, rng);
        }
        events
    }
}

#[cfg(test)]
mod tests {
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::types::MatchConfig;

    /// A match between two 4-4-2s of 70s, the home striker's heading set.
    fn match_with_heading(heading: u8) -> LiveMatchState {
        let mut home = make_team("home");
        home.players[9].heading = heading;
        LiveMatchState::new(
            home,
            make_team("away"),
            MatchConfig::default(),
            vec![],
            vec![],
            false,
        )
    }

    /// Outcomes of `count` headers by the home striker: (on target, goals).
    fn header_outcomes(state: &mut LiveMatchState, count: u32) -> (u32, u32) {
        let header = state.snap_player_by_id("home_f1", Side::Home);
        let mut rng = StdRng::seed_from_u64(7);
        let (mut on_target, mut goals) = (0, 0);
        for _ in 0..count {
            let events =
                state.resolve_header(10, Side::Home, header.clone(), "home_m1".into(), &mut rng);
            // The score is a u8; thousands of headers would overflow it.
            state.home_score = 0;
            on_target += u32::from(
                events
                    .iter()
                    .any(|e| matches!(e.event_type, EventType::Goal | EventType::ShotSaved)),
            );
            goals += u32::from(events.iter().any(|e| e.event_type == EventType::Goal));
        }
        (on_target, goals)
    }

    /// Given a striker heading at 85 and one heading at 45, otherwise equal,
    /// when each heads 4,000 crosses,
    /// then the better header hits the target and scores clearly more often.
    #[test]
    fn heading_decides_where_a_won_header_goes() {
        let (good_on, good_goals) = header_outcomes(&mut match_with_heading(85), 4_000);
        let (poor_on, poor_goals) = header_outcomes(&mut match_with_heading(45), 4_000);
        assert!(good_on > poor_on + 400, "on target {good_on} vs {poor_on}");
        assert!(
            good_goals > poor_goals * 3 / 2,
            "goals {good_goals} vs {poor_goals}"
        );
    }

    /// Given many headers,
    /// when each is played out,
    /// then none is fouled into a penalty, every attempt is a header, and the
    /// header's own goal names the crosser as the assist. (A save can lead to
    /// a corner, whose events follow in the same list.)
    #[test]
    fn a_header_is_never_fouled_and_always_a_header() {
        let mut state = match_with_heading(70);
        let header = state.snap_player_by_id("home_f1", Side::Home);
        let mut rng = StdRng::seed_from_u64(11);
        for _ in 0..2_000 {
            let events =
                state.resolve_header(10, Side::Home, header.clone(), "home_m1".into(), &mut rng);
            state.home_score = 0;
            for event in &events {
                assert!(
                    !matches!(
                        event.event_type,
                        EventType::Foul | EventType::PenaltyAwarded | EventType::PenaltyGoal
                    ),
                    "{event:?}"
                );
                if matches!(
                    event.event_type,
                    EventType::Goal | EventType::ShotSaved | EventType::ShotOffTarget
                ) {
                    assert_eq!(event.shot_kind, Some(ShotKind::Header));
                }
            }
            let own = events
                .iter()
                .find(|e| {
                    matches!(
                        e.event_type,
                        EventType::Goal | EventType::ShotSaved | EventType::ShotOffTarget
                    )
                })
                .expect("the header is an attempt");
            assert_eq!(own.player_id.as_deref(), Some("home_f1"));
            if own.event_type == EventType::Goal {
                assert_eq!(own.secondary_player_id.as_deref(), Some("home_m1"));
            }
        }
    }

    /// Given the accuracy of a header at a range of ratings,
    /// when the header is a PowerHeader,
    /// then it is 8% likelier on target, and the plain chance stays in its band.
    #[test]
    fn power_header_puts_more_on_target_within_the_band() {
        for rating in [20.0, 50.0, 70.0, 95.0] {
            let plain = header_accuracy(rating, false);
            assert!((ACCURACY_MIN..=ACCURACY_MAX).contains(&plain));
            assert!((header_accuracy(rating, true) - plain * POWER_HEADER_ACCURACY).abs() < 1e-12);
        }
        assert_eq!(header_accuracy(50.0, false), ACCURACY_BASE);
    }

    /// Given an equal header and keeper on a neutral line,
    /// when the conversion is read,
    /// then it is the base 28%, rising with the header and the line height.
    #[test]
    fn conversion_rises_with_the_header_and_a_high_line() {
        assert_eq!(
            header_conversion(70.0, 70.0, 1.0, CONVERSION_BASE),
            CONVERSION_BASE
        );
        assert!(header_conversion(80.0, 70.0, 1.0, CONVERSION_BASE) > CONVERSION_BASE);
        assert!(header_conversion(70.0, 70.0, 1.12, CONVERSION_BASE) > CONVERSION_BASE);
        assert_eq!(
            header_conversion(10.0, 99.0, 0.85, CONVERSION_BASE),
            CONVERSION_MIN
        );
    }
}
