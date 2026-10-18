//! The long ball out of the own third (phase 2, GĐ4, P4.2; GĐ4-tech-spec §6,
//! decisions X69 and X70).
//!
//! A side on the ball in its own third plays it long `p_long` of the time,
//! by its build-up dial, more often from a goal kick. The best long passer
//! near the ball hits it (the keeper at a goal kick), and it clears the
//! midfield `P_skip` of the time, more often the better he is. Short of that
//! it drops in midfield for nobody: a second ball. Over the top it is met in
//! the attacking third: in the air against a defender, or, against a high
//! line, in a race into the space behind. Won in the air, it has to be
//! brought down (first touch), or it is loose again.

use rand::{Rng, RngExt};

use crate::duel;
use crate::event::{EventType, MatchEvent, TacticalContext};
use crate::pitch_position::PitchPosition;
use crate::shared::{PlayerSnap, TraitContext, trait_bonus};
use crate::types::{
    DefensiveLine, PlayerData, PlayerRole, Position, Side, TacticsBuildUpStyle, Zone,
};

use super::LiveMatchState;
use super::presence::{Column, out_of_lane_factor};
use super::zone_resolution::scale_odds;

/// The most a long ball clears the midfield, however good the passer. The
/// spec started at 0.80, which sent 40% of long balls over the midfield on
/// the guardrail sweep (the best long passer near the ball hits it); real
/// football gets 13% of its long balls out of the own third into the final
/// third (`gd4-real-reference.txt`, item 3). 0.35 gives 18%. Calibrated at
/// P4.2.
const P_MAX: f64 = 0.35;
/// The long passing (`Q_long`) at which half of `P_MAX` gets through: 60, not
/// S2's 70, which only 4.8% of real centre backs reach (§3.5).
const Q0: f64 = 60.0;
const TAU: f64 = 6.0;
/// The race into the space behind: `logit = ln(pace_att / pace_def) + ln K`.
const K_RACE: f64 = 0.85;
/// Bringing the ball down after winning it in the air:
/// `P_HOLD_MAX · σ((first_touch − HOLD_CENTRE) / HOLD_TAU)`, centred on the
/// real forwards' mean first touch (65.6), not S2's 75.
const P_HOLD_MAX: f64 = 0.85;
const HOLD_CENTRE: f64 = 65.0;
const HOLD_TAU: f64 = 6.0;
/// A ball-playing keeper plays his goal kicks short more often.
const BALL_PLAYING_KEEPER_LONG: f64 = 0.6;

/// How often a side in its own third plays it long, by its build-up dial: in
/// open play and from a goal kick (§6.1). The spec's starting values; with
/// them `Mixed` plays 35% of its build-ups long (real football: a third of
/// the passes out of the own third). Real goal kicks go long 80% of the time.
fn long_ball_share(style: TacticsBuildUpStyle, goal_kick: bool) -> f64 {
    match (style, goal_kick) {
        (TacticsBuildUpStyle::Short, false) => 0.0,
        (TacticsBuildUpStyle::Mixed, false) => 0.20,
        (TacticsBuildUpStyle::Long, false) => 0.60,
        (TacticsBuildUpStyle::Short, true) => 0.15,
        (TacticsBuildUpStyle::Mixed, true) => 0.55,
        (TacticsBuildUpStyle::Long, true) => 0.85,
    }
}

/// How often a high line leaves room behind for a race instead of a header.
fn race_share(line: DefensiveLine) -> f64 {
    match line {
        DefensiveLine::VeryLow => 0.0,
        DefensiveLine::Low => 0.10,
        DefensiveLine::Medium => 0.25,
        DefensiveLine::High => 0.55,
    }
}

/// A long passer's quality before condition: long passing, vision to pick
/// the man, composure (S2 §2.2).
fn long_ball_quality(p: &PlayerSnap) -> f64 {
    0.65 * f64::from(p.long_passing) + 0.25 * f64::from(p.vision) + 0.10 * f64::from(p.composure)
}

/// The roles that hit the long ball best (§6.2).
fn long_ball_role(role: PlayerRole) -> f64 {
    match role {
        PlayerRole::BallPlayingCB
        | PlayerRole::DeepLyingPlaymaker
        | PlayerRole::BallPlayingKeeper => 1.10,
        PlayerRole::HalfBack => 1.05,
        _ => 1.0,
    }
}

/// Who a long ball is aimed at, on top of his presence (§6.3).
fn target_weight(player: &PlayerData, slot: PitchPosition) -> f64 {
    match player.role {
        PlayerRole::TargetMan => 2.0,
        PlayerRole::CompleteForward => 1.5,
        PlayerRole::DefensiveWinger => 1.3,
        _ if slot == PitchPosition::Striker => 1.0,
        _ => 0.6,
    }
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// The chance a long ball of quality `q` clears the midfield.
fn skip_chance(q: f64) -> f64 {
    P_MAX * sigmoid((q - Q0) / TAU)
}

/// The chance a man who won a long ball in the air brings it down.
fn hold_chance(first_touch: f64) -> f64 {
    P_HOLD_MAX * sigmoid((first_touch - HOLD_CENTRE) / HOLD_TAU)
}

impl LiveMatchState {
    /// Whether `side`, on the ball in its own third, plays it long; a goal
    /// kick (the event just before) is played long more often.
    pub(super) fn plays_long<R: Rng>(&self, side: Side, rng: &mut R) -> bool {
        let goal_kick = self.is_goal_kick(side);
        let mut share = long_ball_share(self.team_ref(side).tactics.build_up_style, goal_kick);
        if goal_kick
            && self
                .keeper_on_the_pitch(side)
                .is_some_and(|keeper| keeper.role == PlayerRole::BallPlayingKeeper)
        {
            share *= BALL_PLAYING_KEEPER_LONG;
        }
        share > 0.0 && rng.random_range(0.0..1.0f64) < share
    }

    /// Whether the ball `side` has in its own third came from its goal kick.
    fn is_goal_kick(&self, side: Side) -> bool {
        self.events
            .last()
            .is_some_and(|e| e.event_type == EventType::GoalKick && e.side == side)
    }

    /// The long ball itself; see the module docs. Its events all carry
    /// `LongBall`, the loose balls `SecondBall` and a race won `BallInBehind`.
    pub(super) fn resolve_long_ball<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let outer = self.active_context.replace(TacticalContext::LongBall);
        let passer = self.long_passer(att_side);
        let quality = self.condition_adjusted_skill(&passer.id, long_ball_quality(&passer))
            * trait_bonus(&passer, TraitContext::Passing)
            * long_ball_role(passer.role);
        let from = self.ball_zone;
        // Where it drops: the lane matrix, the switch scaled by his long passing.
        self.advance_lane(att_side, &passer, rng);
        let landing_lane = self.lane_for(att_side);
        let target = self
            .pick_by_presence_with(att_side, Column::Attack, landing_lane, target_weight, rng)
            .map(|picked| picked.player)
            .unwrap_or_else(|| self.snap_player(att_side, Position::Forward, rng));
        let kick = MatchEvent::new(minute, EventType::LongBall, att_side, from)
            .with_player(&passer.id)
            .with_secondary(&target.id);
        self.emit(&mut events, kick);

        if rng.random_range(0.0..1.0f64) >= skip_chance(quality) {
            self.ball_zone = Zone::Midfield;
            events.extend(self.resolve_second_ball(minute, att_side, rng));
            self.active_context = outer;
            return events;
        }
        let zone = Zone::attacking_third(att_side);
        self.ball_zone = zone;
        let defence_lane = self.lane_for(def_side);
        let (defender, kappa) = self
            .pick_by_presence(def_side, Column::Defence, defence_lane, rng)
            .map(|picked| (picked.player, out_of_lane_factor(picked.slot, defence_lane)))
            .unwrap_or_else(|| (self.snap_player(def_side, Position::Defender, rng), 1.0));
        let condition = self.condition_adjusted_skill(&target.id, 1.0)
            / (self.condition_adjusted_skill(&defender.id, 1.0) * kappa);
        let race = rng.random_range(0.0..1.0f64)
            < race_share(self.team_ref(def_side).tactics.defensive_line);
        if race {
            events
                .extend(self.race_in_behind(minute, att_side, &target, &defender, condition, rng));
        } else {
            events.extend(
                self.long_ball_in_the_air(minute, att_side, &target, &defender, condition, rng),
            );
        }
        self.active_context = outer;
        events
    }

    /// The best long passer near the ball: the highest `Q_long` (with his
    /// role) among those of `side` with any build-up presence in its lane, the
    /// keeper at a goal kick.
    fn long_passer(&self, side: Side) -> PlayerSnap {
        if self.is_goal_kick(side)
            && let Some(keeper) = self.keeper_on_the_pitch(side)
        {
            return PlayerSnap::from(keeper);
        }
        let lane = self.lane_for(side);
        self.present_in(side, Column::BuildUp, lane)
            .into_iter()
            .map(|(player, _)| PlayerSnap::from(player))
            .max_by(|a, b| {
                let q = |p: &PlayerSnap| {
                    self.condition_adjusted_skill(&p.id, long_ball_quality(p))
                        * long_ball_role(p.role)
                };
                q(a).total_cmp(&q(b))
            })
            .or_else(|| self.keeper_on_the_pitch(side).map(PlayerSnap::from))
            .unwrap_or_else(PlayerSnap::nobody)
    }

    /// A race onto a ball over a high line (X70): pace against pace. Won, he
    /// is through, as after a one-on-one won on the break (a sweeper keeper
    /// may come for it); lost, the defender has it in his own third. Two
    /// stoppers lose it more often, a stopper and a cover more seldom (F5).
    fn race_in_behind<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        runner: &PlayerSnap,
        defender: &PlayerSnap,
        condition: f64,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let def_side = att_side.opposite();
        let mut events = Vec::new();
        let zone = Zone::attacking_third(att_side);
        let pair = self.centre_back_pair_factor(def_side, true);
        let logit = (f64::from(runner.pace).max(1.0) / f64::from(defender.pace).max(1.0)).ln()
            + K_RACE.ln()
            + (condition / pair).ln();
        if rng.random_range(0.0..1.0f64) < sigmoid(logit) {
            let through = MatchEvent::new(minute, EventType::Dribble, att_side, zone)
                .with_player(&runner.id)
                .with_secondary(&defender.id)
                .with_tactical_context(TacticalContext::BallInBehind);
            self.emit(&mut events, through);
            if let Some(sweeper) = self.try_sweeper_keeper(minute, att_side, runner, rng) {
                events.extend(sweeper);
                return events;
            }
            self.possession = att_side;
            self.ball_zone = Zone::attacking_box(att_side);
            // The shot he gets away is part of the run in behind.
            self.pending_context = Some((att_side, TacticalContext::BallInBehind));
            return events;
        }
        let recovered = MatchEvent::new(minute, EventType::Interception, def_side, zone)
            .with_player(&defender.id);
        self.emit(&mut events, recovered);
        self.possession = def_side;
        self.ball_zone = Zone::defensive_third(def_side);
        events
    }

    /// A long ball met in the air (X70): the aerial duel at the corner's
    /// anchor. Lost, the defender heads it clear into midfield; won, it has
    /// to be brought down, or it drops loose where it was won.
    fn long_ball_in_the_air<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        target: &PlayerSnap,
        defender: &PlayerSnap,
        condition: f64,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let def_side = att_side.opposite();
        let mut events = Vec::new();
        let zone = Zone::attacking_third(att_side);
        let won = scale_odds(duel::aerial_win_probability(target, defender), condition);
        if rng.random_range(0.0..1.0f64) >= won {
            let cleared = MatchEvent::new(minute, EventType::Clearance, def_side, zone)
                .with_player(&defender.id);
            self.emit(&mut events, cleared);
            self.ball_zone = Zone::Midfield;
            events.extend(self.resolve_second_ball(minute, att_side, rng));
            return events;
        }
        let touch = self.condition_adjusted_skill(&target.id, f64::from(target.first_touch));
        if rng.random_range(0.0..1.0f64) < hold_chance(touch) {
            self.possession = att_side;
            self.pending_context = Some((att_side, TacticalContext::LongBall));
            return events;
        }
        events.extend(self.resolve_second_ball(minute, att_side, rng));
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given long passers of 50, 60 and 70,
    /// when the chance their ball clears the midfield is read,
    /// then it rises with them, is half the most at 60, and never passes it.
    #[test]
    fn a_better_long_passer_clears_the_midfield_more_often() {
        assert!(skip_chance(50.0) < skip_chance(60.0));
        assert!(skip_chance(60.0) < skip_chance(70.0));
        assert!((skip_chance(60.0) - P_MAX / 2.0).abs() < 1e-12);
        assert!(skip_chance(99.0) < P_MAX);
    }

    /// Given every build-up dial,
    /// when the share of long balls is read,
    /// then `Short` never plays it long in open play, `Long` most, and a goal
    /// kick goes long more often than open play.
    #[test]
    fn the_build_up_dial_is_the_route() {
        use TacticsBuildUpStyle::*;
        assert_eq!(long_ball_share(Short, false), 0.0);
        for goal_kick in [false, true] {
            assert!(long_ball_share(Short, goal_kick) < long_ball_share(Mixed, goal_kick));
            assert!(long_ball_share(Mixed, goal_kick) < long_ball_share(Long, goal_kick));
        }
        for style in [Short, Mixed, Long] {
            assert!(long_ball_share(style, true) > long_ball_share(style, false));
        }
    }

    /// Given each defensive line,
    /// when the share of races is read,
    /// then the higher the line the more often the ball is run onto.
    #[test]
    fn a_higher_line_leaves_more_room_behind() {
        use DefensiveLine::*;
        assert_eq!(race_share(VeryLow), 0.0);
        assert!(race_share(Low) < race_share(Medium));
        assert!(race_share(Medium) < race_share(High));
    }

    /// Given forwards with a first touch of 55, 65 and 75,
    /// when they try to bring a long ball down,
    /// then the better touch holds it more often.
    #[test]
    fn a_better_first_touch_brings_it_down() {
        assert!(hold_chance(55.0) < hold_chance(65.0));
        assert!(hold_chance(65.0) < hold_chance(75.0));
    }

    use crate::live_match::test_support::make_team;
    use crate::types::{MatchConfig, TeamData};
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn state(home: TeamData, away: TeamData) -> LiveMatchState {
        LiveMatchState::new(
            home,
            away,
            MatchConfig::default(),
            Vec::new(),
            Vec::new(),
            false,
        )
    }

    /// Given a 4-4-2 with the ball in the middle of its own third and one
    /// centre back far the best long passer,
    /// when its long passer is chosen,
    /// then it is him.
    #[test]
    fn the_best_long_passer_near_the_ball_hits_it() {
        let mut home = make_team("home");
        home.players[2].long_passing = 95;
        let s = state(home, make_team("away"));
        assert_eq!(s.long_passer(Side::Home).id, s.home.players[2].id);
    }

    /// The share of 6,000 races a home runner wins against an away side
    /// whose two centre backs play `roles`.
    fn races_won(roles: [PlayerRole; 2]) -> f64 {
        let mut away = make_team("away");
        away.players[2].role = roles[0];
        away.players[3].role = roles[1];
        let mut rng = StdRng::seed_from_u64(4);
        let mut won = 0;
        for _ in 0..6_000 {
            let mut s = state(make_team("home"), away.clone());
            let runner = PlayerSnap::from(&s.home.players[9]);
            let defender = PlayerSnap::from(&s.away.players[2]);
            s.race_in_behind(1, Side::Home, &runner, &defender, 1.0, &mut rng);
            if s.possession == Side::Home {
                won += 1;
            }
        }
        f64::from(won) / 6_000.0
    }

    /// Given two stoppers, and a stopper beside a cover,
    /// when a runner races them onto a ball behind,
    /// then he beats the two stoppers more often (F5).
    #[test]
    fn two_stoppers_lose_the_race_more_often() {
        let stoppers = races_won([PlayerRole::Stopper, PlayerRole::Stopper]);
        let mixed = races_won([PlayerRole::Stopper, PlayerRole::CoverCB]);
        assert!(stoppers > mixed + 0.04, "{stoppers:.3} vs {mixed:.3}");
    }

    /// Given two equal sides,
    /// when a loose ball after a home long ball is played many times,
    /// then each side wins half of them.
    #[test]
    fn equal_sides_win_half_the_second_balls() {
        let mut rng = StdRng::seed_from_u64(8);
        let mut home = 0;
        for _ in 0..20_000 {
            let mut s = state(make_team("home"), make_team("away"));
            s.ball_zone = Zone::Midfield;
            s.resolve_second_ball(1, Side::Home, &mut rng);
            if s.possession == Side::Home {
                home += 1;
            }
        }
        let share = f64::from(home) / 20_000.0;
        assert!((share - 0.5).abs() < 0.01, "{share:.3}");
    }

    /// Given a home long ball dropping loose in the home side's attacking
    /// third,
    /// when the away side wins it,
    /// then the away side has it in its own third and its next action is a
    /// build-up.
    #[test]
    fn a_loose_ball_lost_in_attack_is_the_other_sides_build_up() {
        let mut rng = StdRng::seed_from_u64(2);
        for _ in 0..100 {
            let mut s = state(make_team("home"), make_team("away"));
            s.ball_zone = Zone::attacking_third(Side::Home);
            s.resolve_second_ball(1, Side::Home, &mut rng);
            if s.possession != Side::Away {
                continue;
            }
            assert_eq!(s.ball_zone, Zone::defensive_third(Side::Away));
            let next = s.resolve_action(2, &mut rng);
            assert!(matches!(
                next[0].event_type,
                EventType::PassCompleted | EventType::PassIntercepted | EventType::LongBall
            ));
            return;
        }
        panic!("the away side never won the loose ball");
    }
}
