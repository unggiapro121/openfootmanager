//! Shots from distance (phase 2, P2.5; `pass-cure-heading-freekick-enhancement.md`
//! §5, decisions X9 and X40).
//!
//! Until phase 2 every shot was struck inside the box; a third of real shots
//! come from outside it. Now each action in the attacking third may become a
//! shot from distance instead of the one-on-one, taken by a midfielder
//! (`MIDFIELDER_SHARE` of the time) or by the man on the ball:
//!
//! ```text
//! logit = BASE + (a[slot] − a[ST]) + 1.35·(long_shots − μ[slot])/10
//!         + 0.90 for ShootsFromDistance + 0.25 against a compact defence
//! P     = min(σ(logit), 0.45)
//! ```
//!
//! `a` and `μ` are the position table `ofm_core` assigns `ShootsFromDistance`
//! by (`assigned_traits.rs`), read by the formation slot the shooter stands in.
//! Only the differences between positions carry over: that table fits the
//! chance of having the habit, once a career, and this is a chance every time
//! the ball comes to him, so the level is `BASE`, calibrated on the
//! real-world probe for 30–35% of shots from outside the box (decision F3).
//!
//! The shot, with `R = 0.60·long_shots + 0.25·curve + 0.15·composure` (× condition):
//!
//! ```text
//! blocked   = clamp(0.31 × the defence's shape, 0.18, 0.45)
//! on target = clamp(0.32 + (R − 50)/220, 0.12, 0.70) × 1.08 LongShooter × 1.08 Curler (≤ ×1.12)
//! goal      = clamp(0.14 + (R − keeper)/250, 0.02, 0.35)
//! ```
//!
//! An average one is worth about 3% of a goal, as in real football (3.7%). It
//! replaces the one-on-one rather than adding to it, so goals do not rise.

use rand::{Rng, RngExt};

use crate::event::{EventDetail, EventType, MatchEvent, ShotKind};
use crate::pitch_position::PitchPosition;
use crate::shared::{PlayerSnap, TraitContext, tactics_shape_modifier, trait_bonus};
use crate::types::{DefensiveShape, Position, Side, Zone};

use super::LiveMatchState;
use super::helpers::{danger_band, save_quality};

/// The level of the chance to shoot from distance, against a striker at his
/// position's usual long shots. Calibrated on the real-world probe for 30–35%
/// of shots from outside the box (30.9%), not on the lan-can sweep: its
/// synthetic forwards shoot 18 points above their side, so their long shots
/// sit far above any real striker's and their chance runs into the cap.
const BASE: f64 = -2.30;
/// How often the man who might shoot from distance is a midfielder arriving
/// from behind rather than the man on the ball.
const MIDFIELDER_SHARE: f64 = 0.55;
const LONG_SHOTS_SLOPE: f64 = 1.35;
const HABIT_BONUS: f64 = 0.90;
const COMPACT_BONUS: f64 = 0.25;
const MAX_CHANCE: f64 = 0.45;
/// The striker's base, the reference the other positions are read against.
const STRIKER_BASE: f64 = -2.85;

const BLOCK_BASE: f64 = 0.31;
const BLOCK_MIN: f64 = 0.18;
const BLOCK_MAX: f64 = 0.45;
/// Of the blocked shots, the share the defence comes away with.
const BLOCK_DEFENCE_KEEPS: f64 = 0.40;
const ON_TARGET_BASE: f64 = 0.32;
const ON_TARGET_SPREAD: f64 = 220.0;
const ON_TARGET_MIN: f64 = 0.12;
const ON_TARGET_MAX: f64 = 0.70;
const LONG_SHOOTER_ACCURACY: f64 = 1.08;
const CURLER_ACCURACY: f64 = 1.08;
const TRAIT_ACCURACY_CAP: f64 = 1.12;
const GOAL_BASE: f64 = 0.14;
const GOAL_SPREAD: f64 = 250.0;
const GOAL_MIN: f64 = 0.02;
const GOAL_MAX: f64 = 0.35;
/// The share of saved shots from distance pushed behind for a corner: a
/// keeper holds more of them than of shots from close in.
const SAVE_TO_CORNER: f64 = 0.30;

/// The position table of `ofm_core::assigned_traits`: (base logit, mean long
/// shots) by formation slot, `None` for a keeper. `ofm_core` pins the two
/// copies together in a test, since the engine may not depend on it.
pub fn long_shot_norm(slot: PitchPosition) -> Option<(f64, f64)> {
    use PitchPosition::*;
    match slot {
        Goalkeeper => None,
        CenterBack => Some((-7.74, 37.9)),
        RightBack | LeftBack | RightWingBack | LeftWingBack => Some((-6.04, 47.9)),
        DefensiveMidfielder => Some((-4.72, 56.7)),
        CentralMidfielder => Some((-3.61, 60.5)),
        AttackingMidfielder => Some((-3.02, 63.0)),
        RightMidfielder | LeftMidfielder => Some((-3.09, 60.4)),
        RightWinger | LeftWinger => Some((-3.29, 61.6)),
        Striker => Some((-2.85, 63.7)),
    }
}

/// The slot read for a player whose formation slot is not known: the plainest
/// one of his group.
fn default_slot(group: Position) -> PitchPosition {
    match group {
        Position::Goalkeeper => PitchPosition::Goalkeeper,
        Position::Defender => PitchPosition::CenterBack,
        Position::Midfielder => PitchPosition::CentralMidfielder,
        Position::Forward => PitchPosition::Striker,
    }
}

/// The chance a player at `slot` tries a shot from distance this action.
fn trigger_chance(
    slot: PitchPosition,
    long_shots: u8,
    shoots_from_distance: bool,
    against_compact: bool,
) -> f64 {
    let Some((base, mean)) = long_shot_norm(slot) else {
        return 0.0;
    };
    let logit = BASE
        + (base - STRIKER_BASE)
        + LONG_SHOTS_SLOPE * (f64::from(long_shots) - mean) / 10.0
        + if shoots_from_distance {
            HABIT_BONUS
        } else {
            0.0
        }
        + if against_compact { COMPACT_BONUS } else { 0.0 };
    (1.0 / (1.0 + (-logit).exp())).min(MAX_CHANCE)
}

fn shot_rating(shooter: &PlayerSnap) -> f64 {
    0.60 * f64::from(shooter.long_shots)
        + 0.25 * f64::from(shooter.curve)
        + 0.15 * f64::from(shooter.composure)
}

fn block_chance(shape: f64) -> f64 {
    (BLOCK_BASE * shape).clamp(BLOCK_MIN, BLOCK_MAX)
}

fn on_target_chance(rating: f64, long_shooter: bool, curler: bool) -> f64 {
    let mut traits = 1.0;
    if long_shooter {
        traits *= LONG_SHOOTER_ACCURACY;
    }
    if curler {
        traits *= CURLER_ACCURACY;
    }
    (ON_TARGET_BASE + (rating - 50.0) / ON_TARGET_SPREAD).clamp(ON_TARGET_MIN, ON_TARGET_MAX)
        * traits.min(TRAIT_ACCURACY_CAP)
}

fn goal_chance(rating: f64, keeper: f64) -> f64 {
    (GOAL_BASE + (rating - keeper) / GOAL_SPREAD).clamp(GOAL_MIN, GOAL_MAX)
}

impl LiveMatchState {
    /// Whether this action in the attacking third is a shot from distance:
    /// the shot's events if it is, `None` to play the one-on-one with
    /// `attacker` as before.
    pub(super) fn try_long_shot<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        attacker: &PlayerSnap,
        rng: &mut R,
    ) -> Option<Vec<MatchEvent>> {
        let shooter = if rng.random_range(0.0..1.0f64) < MIDFIELDER_SHARE {
            self.snap_player(att_side, Position::Midfielder, rng)
        } else {
            attacker.clone()
        };
        let group = self
            .team_ref(att_side)
            .players
            .iter()
            .find(|p| p.id == shooter.id)
            .map_or(Position::Midfielder, |p| p.position);
        let slot = self
            .slot_of(att_side, &shooter.id)
            .unwrap_or_else(|| default_slot(group));
        let compact =
            self.team_ref(att_side.opposite()).tactics.defensive_shape == DefensiveShape::Compact;
        let chance = trigger_chance(
            slot,
            shooter.long_shots,
            shooter.has_trait("ShootsFromDistance"),
            compact,
        );
        if rng.random_range(0.0..1.0f64) >= chance {
            return None;
        }
        let assister = (shooter.id != attacker.id).then(|| attacker.id.clone());
        Some(self.resolve_long_shot(minute, att_side, shooter, assister, rng))
    }

    /// A shot from distance by `shooter`, from the block to the goal or the
    /// save. A goal names `assister`, if any, as the assist.
    fn resolve_long_shot<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        shooter: PlayerSnap,
        assister: Option<String>,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let def_side = att_side.opposite();
        let zone = Zone::attacking_third(att_side);
        let goalkeeper = self.snap_player(def_side, Position::Goalkeeper, rng);
        let rating = self.condition_adjusted_skill(&shooter.id, shot_rating(&shooter));
        let keeper = self.condition_adjusted_skill(
            &goalkeeper.id,
            (f64::from(goalkeeper.handling)
                + f64::from(goalkeeper.reflexes)
                + f64::from(goalkeeper.positioning))
                / 3.0,
        ) * trait_bonus(&goalkeeper, TraitContext::Goalkeeping);
        let attempt = |event_type: EventType| {
            MatchEvent::new(minute, event_type, att_side, zone)
                .with_shot_kind(ShotKind::LongRange)
                .with_player(&shooter.id)
        };
        let danger = EventDetail::Shot {
            danger: danger_band(rating),
        };

        let shape = tactics_shape_modifier(&self.team_ref(def_side).tactics);
        if rng.random_range(0.0..1.0f64) < block_chance(shape) {
            self.emit(
                &mut events,
                attempt(EventType::ShotBlocked).with_detail(danger),
            );
            if rng.random_range(0.0..1.0f64) < BLOCK_DEFENCE_KEEPS {
                self.possession = def_side;
                self.ball_zone = Zone::Midfield;
            } else {
                // It runs loose to the attackers, who go again.
                self.possession = att_side;
                self.ball_zone = zone;
            }
            return events;
        }

        let on_target = on_target_chance(
            rating,
            shooter.has_trait("LongShooter"),
            shooter.has_trait("Curler"),
        );
        if rng.random_range(0.0..1.0f64) >= on_target {
            self.emit(
                &mut events,
                attempt(EventType::ShotOffTarget).with_detail(danger),
            );
            let goal_kick = MatchEvent::new(
                minute,
                EventType::GoalKick,
                def_side,
                Zone::attacking_box(att_side),
            );
            self.emit(&mut events, goal_kick);
            self.possession = def_side;
            self.ball_zone = Zone::defensive_third(def_side);
            return events;
        }

        if rng.random_range(0.0..1.0f64) < goal_chance(rating, keeper) {
            let context = self.goal_context(att_side);
            let mut goal = attempt(EventType::Goal).with_detail(EventDetail::Goal { context });
            if let Some(id) = &assister {
                goal = goal.with_secondary(id);
            }
            self.emit(&mut events, goal);
            self.add_goal(att_side);
            self.possession = def_side;
            self.ball_zone = Zone::Midfield;
        } else {
            let save = attempt(EventType::ShotSaved)
                .with_secondary(&goalkeeper.id)
                .with_detail(EventDetail::Save {
                    quality: save_quality(keeper),
                });
            self.emit(&mut events, save);
            self.after_save_with(minute, att_side, &mut events, SAVE_TO_CORNER, rng);
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
    use crate::report::GoalSource;
    use crate::types::MatchConfig;

    /// Given a centre-back and a striker, each at his position's usual long
    /// shots, against an open defence,
    /// when their chances of shooting from distance are read,
    /// then the centre-back almost never tries one and the striker does, about
    /// one time in ten (20 times as often).
    #[test]
    fn the_chance_follows_the_slot() {
        let cb = trigger_chance(PitchPosition::CenterBack, 38, false, false);
        let st = trigger_chance(PitchPosition::Striker, 64, false, false);
        assert!(cb < 0.01, "cb {cb}");
        assert!(st > 0.05, "st {st}");
        assert!(st > 20.0 * cb, "st {st}, cb {cb}");
        assert_eq!(
            trigger_chance(PitchPosition::Goalkeeper, 99, true, true),
            0.0
        );
    }

    /// Given a central midfielder with ever better long shots, the habit and a
    /// compact defence,
    /// when his chance is read,
    /// then each raises it, and it never passes 45%.
    #[test]
    fn long_shots_habit_and_a_compact_defence_raise_the_chance_to_a_cap() {
        let cm = PitchPosition::CentralMidfielder;
        let plain = trigger_chance(cm, 60, false, false);
        assert!(trigger_chance(cm, 80, false, false) > plain);
        assert!(trigger_chance(cm, 60, true, false) > plain);
        assert!(trigger_chance(cm, 60, false, true) > plain);
        assert_eq!(trigger_chance(cm, 99, true, true), MAX_CHANCE);
    }

    /// Given the shot's chances at the extremes,
    /// when they are read,
    /// then they stay in their bands, a compact defence blocks more, and the
    /// two traits together lift accuracy by at most 12%.
    #[test]
    fn the_shots_chances_stay_in_their_bands() {
        assert!(block_chance(1.07) > block_chance(1.0));
        assert_eq!(block_chance(0.1), BLOCK_MIN);
        assert_eq!(block_chance(9.0), BLOCK_MAX);
        assert_eq!(on_target_chance(0.0, false, false), ON_TARGET_MIN);
        let plain = on_target_chance(60.0, false, false);
        assert!((on_target_chance(60.0, true, true) - plain * TRAIT_ACCURACY_CAP).abs() < 1e-12);
        assert_eq!(goal_chance(10.0, 99.0), GOAL_MIN);
        assert_eq!(goal_chance(99.0, 10.0), GOAL_MAX);
    }

    /// Given a midfielder who shoots from distance and plenty of chances,
    /// when they are played out,
    /// then every attempt is from distance, outside the box, and a goal from
    /// one is a long-shot goal; an average shot is worth 2–5% of a goal.
    #[test]
    fn a_shot_from_distance_is_struck_outside_the_box() {
        let mut state = LiveMatchState::new(
            make_team("home"),
            make_team("away"),
            MatchConfig::default(),
            vec![],
            vec![],
            false,
        );
        let shooter = state.snap_player_by_id("home_m2", Side::Home);
        let mut rng = StdRng::seed_from_u64(3);
        let (mut shots, mut goals) = (0, 0);
        for _ in 0..8_000 {
            let events = state.resolve_long_shot(30, Side::Home, shooter.clone(), None, &mut rng);
            state.home_score = 0;
            let own = &events[0];
            assert_eq!(own.shot_kind, Some(ShotKind::LongRange));
            assert_eq!(own.zone, Zone::attacking_third(Side::Home));
            shots += 1;
            if own.event_type == EventType::Goal {
                goals += 1;
                assert_eq!(own.goal_source, Some(GoalSource::LongShot));
            }
        }
        let rate = f64::from(goals) / f64::from(shots);
        assert!((0.02..=0.05).contains(&rate), "scored {rate}");
    }
}
