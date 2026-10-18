//! A defence that wins the ball in its own third: does it go straight up the
//! pitch or play out from the back? (Phase 2, GĐ4, P4.1, decision X77;
//! GĐ4-tech-spec §5.6.)
//!
//! Until GĐ4 the ball jumped: a one-on-one won in the own third, a cross or a
//! corner cleared, put the winners straight into their attacking third, so a
//! side played out from the back only after a goal kick, about six times a
//! match. Now the winners go direct `p_direct` of the time, as before (lane
//! drawn, an open flank there to be hit, P3.6); otherwise they keep the ball in
//! their own third and play out against the side that just lost it, whose
//! counter-press makes that first build-up harder.

use rand::{Rng, RngExt};

use crate::shared::PlayerSnap;
use crate::types::{BreakSpeed, CounterPressDuration, Side, TacticsConfig, Zone};

use super::LiveMatchState;

/// How often a defence that has won the ball goes straight up the pitch,
/// before its break speed and the other side's counter-press. Real football
/// reaches the final third within 10 seconds of such a win 9% of the time and
/// later 41% (`gd4-real-reference.txt`, item 10). Set at P4.1 by the goal
/// budget, not by that: each 0.1 less costs about 0.075 goals a match on the
/// guardrail sweep, and 0.70 keeps the real-world league probe at 2.93, just
/// above GĐ4's soft floor of 2.9 (X77). Lowering it towards real football is
/// one of GĐ5's ways to the 2.6–2.9 target.
pub(crate) const P_DIRECT_BASE: f64 = 0.70;
const P_DIRECT_MIN: f64 = 0.10;
const P_DIRECT_MAX: f64 = 0.80;

/// A side that breaks slowly goes direct less often. The spec started at 0.7
/// / 1.4; each 0.1 of `p_direct` is worth about four points of wins over
/// losses between equal sides, so that made `Slow` cost ten points and `Fast`
/// win five over the default. Narrowed at P4.1 (0.93 / 1.07); at P4.6 `Fast`
/// went to 1.0: its own break after the ball is won in open play already
/// made it win by more than five once GĐ4's other packages were in
/// (`dial-balance-p46.txt`).
fn break_mod(speed: BreakSpeed) -> f64 {
    match speed {
        BreakSpeed::Slow => 0.93,
        BreakSpeed::Medium => 1.0,
        BreakSpeed::Fast => 1.0,
    }
}

/// A counter-press at once smothers the quick ball forward. With this and
/// [`counter_press_mod`] at the spec's 0.85 / 0.70 and 1.10 / 1.20, a long
/// counter-press won by eight points; narrowed at P4.1 (Long +2.1, Short −1.2).
fn press_mod(counter_press: CounterPressDuration) -> f64 {
    match counter_press {
        CounterPressDuration::None => 1.0,
        CounterPressDuration::Short => 0.95,
        CounterPressDuration::Long => 0.90,
    }
}

/// … and presses the first build-up harder.
pub(super) fn counter_press_mod(counter_press: CounterPressDuration) -> f64 {
    match counter_press {
        CounterPressDuration::None => 1.0,
        CounterPressDuration::Short => 1.05,
        CounterPressDuration::Long => 1.10,
    }
}

/// `p_direct`: the chance the side that won the ball (`winner`) goes straight
/// up the pitch, against the side that lost it (`loser`).
pub(super) fn direct_chance(base: f64, winner: &TacticsConfig, loser: &TacticsConfig) -> f64 {
    (base * break_mod(winner.break_speed) * press_mod(loser.counter_press_duration))
        .clamp(P_DIRECT_MIN, P_DIRECT_MAX)
}

impl LiveMatchState {
    /// `winner` has won the ball in its own third, from an attack it stopped.
    /// Straight up the pitch, or a build-up under the other side's
    /// counter-press. Going direct, `cleared_by` (the defender who won it)
    /// plays the lane on as before; a set piece cleared names nobody and keeps
    /// the lane it had.
    pub(super) fn after_defensive_win<R: Rng>(
        &mut self,
        winner: Side,
        cleared_by: Option<&PlayerSnap>,
        rng: &mut R,
    ) {
        let loser = winner.opposite();
        self.possession = winner;
        let p_direct = direct_chance(
            self.config.knobs.p_direct_base,
            &self.team_ref(winner).tactics,
            &self.team_ref(loser).tactics,
        );
        if rng.random_range(0.0..1.0f64) < p_direct {
            self.ball_zone = Zone::attacking_third(winner);
            if let Some(defender) = cleared_by {
                self.regain_lane(winner, Some(defender), rng);
            }
        } else {
            self.ball_zone = Zone::defensive_third(winner);
            self.counter_pressing = Some(loser);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::types::MatchConfig;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn tactics(break_speed: BreakSpeed, counter_press: CounterPressDuration) -> TacticsConfig {
        TacticsConfig {
            break_speed,
            counter_press_duration: counter_press,
            ..TacticsConfig::default()
        }
    }

    /// Given sides that break slow, at medium pace and fast,
    /// when they win the ball against a side that does not counter-press,
    /// then a slow side goes direct least, and a fast one no less than a
    /// medium one.
    #[test]
    fn breaking_fast_goes_direct_more_often() {
        let loser = tactics(BreakSpeed::Medium, CounterPressDuration::None);
        let chance = |speed| {
            direct_chance(
                P_DIRECT_BASE,
                &tactics(speed, CounterPressDuration::None),
                &loser,
            )
        };
        assert!(chance(BreakSpeed::Slow) < chance(BreakSpeed::Medium));
        assert!(chance(BreakSpeed::Medium) <= chance(BreakSpeed::Fast));
        assert_eq!(chance(BreakSpeed::Medium), P_DIRECT_BASE);
    }

    /// Given a side that wins the ball,
    /// when the side that lost it counter-presses longer,
    /// then the winners go direct less often.
    #[test]
    fn a_counter_press_smothers_the_quick_ball_forward() {
        let winner = tactics(BreakSpeed::Medium, CounterPressDuration::None);
        let chance =
            |press| direct_chance(P_DIRECT_BASE, &winner, &tactics(BreakSpeed::Medium, press));
        assert!(chance(CounterPressDuration::Long) < chance(CounterPressDuration::Short));
        assert!(chance(CounterPressDuration::Short) < chance(CounterPressDuration::None));
    }

    /// Given a defence that wins the ball many times,
    /// when it is not going direct,
    /// then it keeps the ball in its own third and the side that lost it is
    /// counter-pressing; when it is, the ball is in its attacking third.
    #[test]
    fn a_win_either_goes_direct_or_plays_out() {
        let mut rng = StdRng::seed_from_u64(7);
        let (mut direct, mut built) = (0, 0);
        for _ in 0..2_000 {
            let mut s = LiveMatchState::new(
                make_team("home"),
                make_team("away"),
                MatchConfig::default(),
                Vec::new(),
                Vec::new(),
                false,
            );
            s.after_defensive_win(Side::Away, None, &mut rng);
            assert_eq!(s.possession, Side::Away);
            if s.ball_zone == Zone::attacking_third(Side::Away) {
                direct += 1;
                assert_eq!(s.counter_pressing, None);
            } else {
                built += 1;
                assert_eq!(s.ball_zone, Zone::defensive_third(Side::Away));
                assert_eq!(s.counter_pressing, Some(Side::Home));
            }
        }
        let share = f64::from(direct) / f64::from(direct + built);
        assert!((share - P_DIRECT_BASE).abs() < 0.03, "{share:.3}");
    }

    /// Given a home side whose left back has just gone up,
    /// when the away side wins the ball many times,
    /// then a break into the open flank only ever comes from going direct.
    #[test]
    fn only_a_direct_ball_hits_an_open_flank() {
        let mut rng = StdRng::seed_from_u64(5);
        let mut exploits = 0;
        for _ in 0..4_000 {
            let mut s = LiveMatchState::new(
                make_team("home"),
                make_team("away"),
                MatchConfig::default(),
                Vec::new(),
                Vec::new(),
                false,
            );
            s.current_minute = 30;
            let left_back = s.home.players[1].id.clone();
            s.note_full_back_push(Side::Home, crate::event::Lane::Left, &left_back, &mut rng);
            let defender = PlayerSnap::from(&s.away.players[4]);
            s.after_defensive_win(Side::Away, Some(&defender), &mut rng);
            if s.pending_exploit.is_some() {
                exploits += 1;
                assert_eq!(s.ball_zone, Zone::attacking_third(Side::Away));
            }
        }
        assert!(exploits > 0);
    }

    /// Given a match whose knobs set `p_direct_base` low, and one at the
    /// default,
    /// when a defence wins the ball many times,
    /// then it goes direct far less often: the engine reads the knob, not the
    /// constant (phase 2, GĐ5 P5.0).
    #[test]
    fn the_direct_share_follows_its_knob() {
        let share = |base: f64| {
            let mut rng = StdRng::seed_from_u64(9);
            let mut config = MatchConfig::default();
            config.knobs.p_direct_base = base;
            let direct = (0..2_000)
                .filter(|_| {
                    let mut s = LiveMatchState::new(
                        make_team("home"),
                        make_team("away"),
                        config.clone(),
                        Vec::new(),
                        Vec::new(),
                        false,
                    );
                    s.after_defensive_win(Side::Away, None, &mut rng);
                    s.ball_zone == Zone::attacking_third(Side::Away)
                })
                .count();
            direct as f64 / 2_000.0
        };
        assert!(share(0.2) < share(P_DIRECT_BASE) - 0.3);
    }
}
