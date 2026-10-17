//! Roles that act without being picked for a duel (phase 2, P2.6; S1 §3.2B–D,
//! decisions X41 and X42): the sweeper keeper, the inverted full-back and the
//! centre-back pair. The engine picks players for a duel by group, so a
//! keeper, a full-back in midfield or a pair of centre-backs never had a duel
//! of their own to change; each acts here at the one moment it matters.
//!
//! **Sweeper keeper.** On the break, once the forward is past his defender, a
//! sweeper keeper comes for the ball before he can shoot:
//!
//! ```text
//! sweep = (pace + positioning + decisions)/3 of the keeper   (× condition)
//! P     = σ(2·ln(sweep / pace of the forward) + ln 1.05)
//! ```
//!
//! He wins it, or the forward shoots at the goal he has left, scoring
//! `KEEPER_OFF_HIS_LINE_GOAL` of the time. A break past the defender is worth
//! `g` = 0.086 of a goal without him (measured on the real-world probe), so he
//! pays his way when `(1 − P)·0.14 < g`: from `P` ≈ 0.40, which a good one
//! clears and a slow one does not (decision X41; GĐ5 recalibrates, X8).
//!
//! **Inverted full-back.** A full-back or wing-back told to step into midfield
//! adds to his side's hold on the ball when it has it:
//!
//! ```text
//! Δ = clamp(((passing + vision)/2 − midfielders' mean of the same)/20, −0.25, 1)
//! one:  × (1 + 0.08·Δ)        two:  × (1 + 0.08·max Δ + 0.03·min Δ)
//! ```
//!
//! **Centre-back pair.** A Stopper beside a Cover CB covers each other (×1.08
//! on the defender in every one-on-one); two Stoppers both step out and leave
//! the space behind them (×0.85 against a break); two Cover CBs both drop and
//! leave the edge of the box (×0.85 otherwise).

use rand::{Rng, RngExt};

use crate::event::{EventType, MatchEvent, ShotKind, TacticalContext};
use crate::pitch_position::PitchPosition;
use crate::shared::PlayerSnap;
use crate::types::{PlayerData, PlayerRole, Position, Side, Zone};

use super::LiveMatchState;

const SWEEP_GAMMA: f64 = 2.0;
const SWEEP_ANCHOR: f64 = 1.05;
/// The chance a forward who beats a sweeper keeper scores at the goal he has
/// left. Set so the keeper breaks even at a 40% chance of winning the ball
/// (X41); the design's 0.20 started him at a loss in every match.
const KEEPER_OFF_HIS_LINE_GOAL: f64 = 0.14;

const INVERTED_FULL_BACK_MAX_LIFT: f64 = 0.08;
const SECOND_INVERTED_FULL_BACK_LIFT: f64 = 0.03;
const INVERTED_FULL_BACK_SPREAD: f64 = 20.0;
const INVERTED_FULL_BACK_FLOOR: f64 = -0.25;

const MIXED_PAIR: f64 = 1.08;
const SAME_PAIR: f64 = 0.85;

/// The chance a keeper of `sweep` wins the ball off a forward of `pace`.
fn sweeper_chance(sweep: f64, pace: f64) -> f64 {
    let logit = SWEEP_GAMMA * (sweep.max(1.0) / pace.max(1.0)).ln() + SWEEP_ANCHOR.ln();
    1.0 / (1.0 + (-logit).exp())
}

/// How far an inverted full-back's passing and vision sit above his side's
/// midfield, in the design's units.
fn inverted_full_back_delta(own: f64, midfield: f64) -> f64 {
    ((own - midfield) / INVERTED_FULL_BACK_SPREAD).clamp(INVERTED_FULL_BACK_FLOOR, 1.0)
}

/// The lift one or two inverted full-backs give their side's hold on the ball.
fn inverted_full_back_lift(deltas: &[f64]) -> f64 {
    match deltas {
        [] => 1.0,
        [one] => 1.0 + INVERTED_FULL_BACK_MAX_LIFT * one,
        [a, b, ..] => {
            1.0 + INVERTED_FULL_BACK_MAX_LIFT * a.max(*b)
                + SECOND_INVERTED_FULL_BACK_LIFT * a.min(*b)
        }
    }
}

fn is_full_back_slot(slot: PitchPosition) -> bool {
    matches!(
        slot,
        PitchPosition::LeftBack
            | PitchPosition::RightBack
            | PitchPosition::LeftWingBack
            | PitchPosition::RightWingBack
    )
}

fn passing_and_vision(player: &PlayerData) -> f64 {
    (f64::from(player.passing) + f64::from(player.vision)) / 2.0
}

impl LiveMatchState {
    /// The players of `side` still on the pitch with the slot each stands in,
    /// or none when the XI does not fill its formation.
    fn on_pitch_by_slot(&self, side: Side) -> Vec<(&PlayerData, PitchPosition)> {
        let team = self.team_ref(side);
        let slots = crate::pitch_position::formation_slots(&team.formation);
        if slots.len() != team.players.len() {
            return Vec::new();
        }
        team.players
            .iter()
            .zip(slots)
            .filter(|(player, _)| !self.out_of_play(&player.id))
            .collect()
    }

    /// The lift `side`'s inverted full-backs give its hold on the ball.
    pub(super) fn inverted_full_back_factor(&self, side: Side) -> f64 {
        let on_pitch = self.on_pitch_by_slot(side);
        let midfielders: Vec<f64> = on_pitch
            .iter()
            .filter(|(player, _)| player.position == Position::Midfielder)
            .map(|(player, _)| passing_and_vision(player))
            .collect();
        if midfielders.is_empty() {
            return 1.0;
        }
        let midfield = midfielders.iter().sum::<f64>() / midfielders.len() as f64;
        let deltas: Vec<f64> = on_pitch
            .iter()
            .filter(|(player, slot)| {
                player.role == PlayerRole::InvertedFB && is_full_back_slot(*slot)
            })
            .map(|(player, _)| inverted_full_back_delta(passing_and_vision(player), midfield))
            .collect();
        inverted_full_back_lift(&deltas)
    }

    /// How `side`'s centre-back pairing changes its defender in a
    /// one-on-one, on the break (`on_the_break`) or not.
    pub(super) fn centre_back_pair_factor(&self, side: Side, on_the_break: bool) -> f64 {
        let on_pitch = self.on_pitch_by_slot(side);
        let at_centre_back = |role: PlayerRole| {
            on_pitch
                .iter()
                .filter(|(player, slot)| *slot == PitchPosition::CenterBack && player.role == role)
                .count()
        };
        match (
            at_centre_back(PlayerRole::Stopper),
            at_centre_back(PlayerRole::CoverCB),
        ) {
            (stoppers, covers) if stoppers >= 1 && covers >= 1 => MIXED_PAIR,
            (stoppers, 0) if stoppers >= 2 && on_the_break => SAME_PAIR,
            (0, covers) if covers >= 2 && !on_the_break => SAME_PAIR,
            _ => 1.0,
        }
    }

    /// On the break, with `forward` past his defender: whether `att_side`'s
    /// opponents' sweeper keeper comes for the ball. His events if he does,
    /// `None` (no draw made) when the keeper is not a sweeper.
    pub(super) fn try_sweeper_keeper<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        forward: &PlayerSnap,
        rng: &mut R,
    ) -> Option<Vec<MatchEvent>> {
        let def_side = att_side.opposite();
        let keeper = self
            .keeper_on_the_pitch(def_side)
            .filter(|keeper| keeper.role == PlayerRole::SweeperKeeper)
            .map(PlayerSnap::from)?;
        let sweep = self.condition_adjusted_skill(
            &keeper.id,
            (f64::from(keeper.pace) + f64::from(keeper.positioning) + f64::from(keeper.decisions))
                / 3.0,
        );
        let mut events = Vec::new();
        if rng.random_range(0.0..1.0f64) < sweeper_chance(sweep, f64::from(forward.pace)) {
            let claimed = MatchEvent::new(
                minute,
                EventType::Interception,
                def_side,
                Zone::attacking_third(att_side),
            )
            .with_player(&keeper.id)
            .with_tactical_context(TacticalContext::SweeperKeeperInterception);
            self.emit(&mut events, claimed);
            self.possession = def_side;
            self.ball_zone = Zone::attacking_third(att_side);
            return Some(events);
        }
        let zone = Zone::attacking_box(att_side);
        let shot = |event_type: EventType| {
            MatchEvent::new(minute, event_type, att_side, zone)
                .with_shot_kind(ShotKind::Open)
                .with_player(&forward.id)
                .with_tactical_context(TacticalContext::KeeperOffHisLine)
        };
        if rng.random_range(0.0..1.0f64) < KEEPER_OFF_HIS_LINE_GOAL {
            let context = self.goal_context(att_side);
            let goal =
                shot(EventType::Goal).with_detail(crate::event::EventDetail::Goal { context });
            self.emit(&mut events, goal);
            self.add_goal(att_side);
            self.ball_zone = Zone::Midfield;
        } else {
            // Wide of the empty goal, or cleared off the line by a defender
            // who got back: the keeper's side restarts either way.
            self.emit(&mut events, shot(EventType::ShotOffTarget));
            let goal_kick = MatchEvent::new(minute, EventType::GoalKick, def_side, zone);
            self.emit(&mut events, goal_kick);
            self.ball_zone = Zone::defensive_third(def_side);
        }
        self.possession = def_side;
        Some(events)
    }
}

#[cfg(test)]
mod tests {
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::types::MatchConfig;

    fn match_between(home: crate::types::TeamData, away: crate::types::TeamData) -> LiveMatchState {
        LiveMatchState::new(home, away, MatchConfig::default(), vec![], vec![], false)
    }

    /// Given a quick, sharp keeper and a slow one against the same forward,
    /// when their chances of winning the ball are read,
    /// then the quick one wins it about as often as the anchor says when he
    /// is as quick as the forward, and the slow one far less.
    #[test]
    fn a_quicker_keeper_wins_more_of_the_ball() {
        let even = sweeper_chance(80.0, 80.0);
        assert!((even - SWEEP_ANCHOR / (1.0 + SWEEP_ANCHOR)).abs() < 1e-12);
        assert!(sweeper_chance(60.0, 80.0) < even - 0.1);
    }

    /// Given an away side whose keeper is not a sweeper,
    /// when a home forward breaks past his defender,
    /// then the keeper does not come, and no draw is made.
    #[test]
    fn only_a_sweeper_keeper_comes_off_his_line() {
        let mut state = match_between(make_team("home"), make_team("away"));
        let forward = state.snap_player_by_id("home_f1", Side::Home);
        let mut rng = StdRng::seed_from_u64(1);
        let before = rng.random::<u64>();
        let mut rng = StdRng::seed_from_u64(1);
        assert!(
            state
                .try_sweeper_keeper(10, Side::Home, &forward, &mut rng)
                .is_none()
        );
        assert_eq!(rng.random::<u64>(), before);
    }

    /// Given an away sweeper keeper,
    /// when home forwards break past their defender many times,
    /// then he wins the ball some of the time, and when he does not, the
    /// forward scores about 14% of the time at the goal he has left; every
    /// event says which of the two it was.
    #[test]
    fn a_sweeper_keeper_wins_the_ball_or_leaves_his_goal_open() {
        let mut away = make_team("away");
        away.players[0].role = PlayerRole::SweeperKeeper;
        let mut state = match_between(make_team("home"), away);
        let forward = state.snap_player_by_id("home_f1", Side::Home);
        let mut rng = StdRng::seed_from_u64(2);
        let (mut claimed, mut beaten, mut goals) = (0, 0, 0);
        for _ in 0..6_000 {
            let events = state
                .try_sweeper_keeper(10, Side::Home, &forward, &mut rng)
                .expect("a sweeper keeper comes");
            state.home_score = 0;
            match events[0].tactical_context {
                Some(TacticalContext::SweeperKeeperInterception) => claimed += 1,
                Some(TacticalContext::KeeperOffHisLine) => {
                    beaten += 1;
                    goals += u32::from(events[0].event_type == EventType::Goal);
                }
                other => panic!("unexpected context {other:?}"),
            }
        }
        assert!(
            claimed > 1_000 && beaten > 1_000,
            "claimed {claimed}, beaten {beaten}"
        );
        let rate = f64::from(goals) / f64::from(beaten);
        assert!((0.11..=0.17).contains(&rate), "scored {rate}");
    }

    /// Given the lift one and two inverted full-backs give,
    /// when they are read,
    /// then one at the midfield's level adds nothing, one far above adds 8%,
    /// one far below takes 2%, and a second adds 3% of his own.
    #[test]
    fn inverted_full_backs_lift_the_hold_on_the_ball_within_bounds() {
        assert_eq!(inverted_full_back_lift(&[]), 1.0);
        assert_eq!(inverted_full_back_lift(&[0.0]), 1.0);
        assert_eq!(
            inverted_full_back_lift(&[inverted_full_back_delta(99.0, 50.0)]),
            1.08
        );
        assert_eq!(
            inverted_full_back_lift(&[inverted_full_back_delta(10.0, 90.0)]),
            0.98
        );
        assert!((inverted_full_back_lift(&[1.0, 1.0]) - 1.11).abs() < 1e-12);
    }

    /// Given a home side whose right-back is an inverted full-back with far
    /// better passing and vision than its midfield, and one whose centre-back
    /// is given the role,
    /// when their hold on the ball is read,
    /// then only the full-back in a full-back slot lifts it.
    #[test]
    fn only_a_full_back_slot_makes_an_inverted_full_back() {
        let mut home = make_team("home");
        home.players[4].role = PlayerRole::InvertedFB;
        home.players[4].passing = 95;
        home.players[4].vision = 95;
        let state = match_between(home.clone(), make_team("away"));
        assert!(state.inverted_full_back_factor(Side::Home) > 1.05);
        let mut miscast = make_team("home");
        miscast.players[2].role = PlayerRole::InvertedFB;
        miscast.players[2].passing = 95;
        miscast.players[2].vision = 95;
        let state = match_between(miscast, make_team("away"));
        assert_eq!(state.inverted_full_back_factor(Side::Home), 1.0);
    }

    /// Given centre-back pairs of each kind,
    /// when their effect on the defender is read on the break and not,
    /// then a mixed pair helps always, two Stoppers hurt only on the break,
    /// two Cover CBs hurt only off it, and anyone else is neutral.
    #[test]
    fn centre_back_pairs_cover_each_other_or_leave_a_gap() {
        let pair = |a: PlayerRole, b: PlayerRole| {
            let mut away = make_team("away");
            away.players[2].role = a;
            away.players[3].role = b;
            match_between(make_team("home"), away)
        };
        let factor = |state: &LiveMatchState, on_the_break| {
            state.centre_back_pair_factor(Side::Away, on_the_break)
        };
        let mixed = pair(PlayerRole::Stopper, PlayerRole::CoverCB);
        assert_eq!(
            (factor(&mixed, true), factor(&mixed, false)),
            (MIXED_PAIR, MIXED_PAIR)
        );
        let stoppers = pair(PlayerRole::Stopper, PlayerRole::Stopper);
        assert_eq!(
            (factor(&stoppers, true), factor(&stoppers, false)),
            (SAME_PAIR, 1.0)
        );
        let covers = pair(PlayerRole::CoverCB, PlayerRole::CoverCB);
        assert_eq!(
            (factor(&covers, true), factor(&covers, false)),
            (1.0, SAME_PAIR)
        );
        let plain = pair(PlayerRole::Standard, PlayerRole::Standard);
        assert_eq!((factor(&plain, true), factor(&plain, false)), (1.0, 1.0));
    }
}
