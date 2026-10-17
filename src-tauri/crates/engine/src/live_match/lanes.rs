//! The lane matrix: which lane the ball goes down when a side moves it up a
//! zone (phase 2, GĐ3, P3.3; GĐ3-tech-spec §7, decisions X11, X52).
//!
//! Three branches, read off the lane the ball is in now (S1 §4.1 drew the next
//! lane without looking at the current one, F1):
//!
//! ```text
//! from the centre:  stay c         out to each flank (1 − c) / 2
//! from a flank:     stay s         inside a          switch to the other flank w
//! ```
//!
//! Width sets the four numbers. A switch of play is a long ball, so `w` scales
//! with the passer's `long_passing`, the difference going to staying. A flank
//! the attacking side has nobody on is seldom chosen. Runs only under
//! `Grid15`.

use rand::{Rng, RngExt};

use crate::event::Lane;
use crate::shared::PlayerSnap;
use crate::types::{Side, TacticsPitchWidth};

use super::LiveMatchState;

/// One width's branch probabilities.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct LaneOdds {
    /// From the centre, staying there.
    pub centre_stays: f64,
    /// From a flank, staying on it.
    pub flank_stays: f64,
    /// From a flank, coming inside.
    pub comes_inside: f64,
    /// From a flank, switching to the other one.
    pub switches: f64,
}

/// `c, s, a, w` for each width (GĐ3-tech-spec §7.2), calibrated at P3.3.
///
/// The spec's starting table settles at 49 / 32 / 22% down the centre, but a
/// match rarely lets the chain settle: kick-offs, goal kicks and every entry
/// into the box put the ball back in the middle, so `Normal` at the spec's
/// numbers sent 42% of the final third's one-on-ones down the centre. Real
/// football plays about 22% of its final-third actions there (StatsBomb
/// 2015/16: 37.9 / 21.8 / 40.3%, `fm-document/comon/sim-bench/reference/
/// gd3-real-reference.txt`). `Normal` is set on the guardrail sweep to that
/// (21.9%, 9 formations); `Narrow` and `Wide` keep the spec's ratio to it,
/// `c` and `a` scaled by the same factor. The switch stays as designed; from
/// a flank the three branches sum to one.
pub(super) fn lane_odds(width: TacticsPitchWidth) -> LaneOdds {
    match width {
        TacticsPitchWidth::Narrow => LaneOdds {
            centre_stays: 0.21,
            flank_stays: 0.78,
            comes_inside: 0.16,
            switches: 0.06,
        },
        TacticsPitchWidth::Normal => LaneOdds {
            centre_stays: 0.15,
            flank_stays: 0.78,
            comes_inside: 0.10,
            switches: 0.12,
        },
        TacticsPitchWidth::Wide => LaneOdds {
            centre_stays: 0.105,
            flank_stays: 0.79,
            comes_inside: 0.07,
            switches: 0.14,
        },
    }
}

/// How a passer's long passing scales the switch of play: 0.5 at 25 or
/// below, 1.0 at 50, 1.5 at 75 or above.
pub(super) fn long_pass_mod(long_passing: u8) -> f64 {
    (0.5 + (f64::from(long_passing) - 50.0) / 50.0).clamp(0.5, 1.5)
}

/// The floor of a flank's cover: a flank with nobody on it is still chosen
/// now and then, three times less often than a covered one.
const MIN_COVER: f64 = 0.3;

fn index(lane: Lane) -> usize {
    match lane {
        Lane::Left => 0,
        Lane::Centre => 1,
        Lane::Right => 2,
    }
}

const LANES: [Lane; 3] = [Lane::Left, Lane::Centre, Lane::Right];

/// The next lane from `from`, for a passer whose long passing scales the
/// switch by `switch_mod`, with each flank's weight scaled by the attacking
/// side's `cover` of it (0.3–1.0; the centre is not scaled).
pub(super) fn next_lane<R: Rng>(
    from: Lane,
    odds: LaneOdds,
    switch_mod: f64,
    cover: [f64; 3],
    rng: &mut R,
) -> Lane {
    let mut weights = [0.0f64; 3];
    match from {
        Lane::Centre => {
            weights[index(Lane::Centre)] = odds.centre_stays;
            let out = (1.0 - odds.centre_stays) / 2.0;
            weights[index(Lane::Left)] = out;
            weights[index(Lane::Right)] = out;
        }
        flank => {
            let switches = (odds.switches * switch_mod).min(1.0 - odds.comes_inside);
            weights[index(flank)] = odds.flank_stays + odds.switches - switches;
            weights[index(Lane::Centre)] = odds.comes_inside;
            weights[index(flank.mirrored())] = switches;
        }
    }
    for lane in [Lane::Left, Lane::Right] {
        weights[index(lane)] *= cover[index(lane)].clamp(MIN_COVER, 1.0);
    }
    let total: f64 = weights.iter().sum();
    let mut roll = rng.random_range(0.0..total);
    for lane in LANES {
        let w = weights[index(lane)];
        if roll < w {
            return lane;
        }
        roll -= w;
    }
    Lane::Centre
}

impl LiveMatchState {
    /// `side` has moved the ball up a zone, `passer` playing it on: draw the
    /// lane it goes down (`Grid15` only).
    pub(super) fn advance_lane<R: Rng>(&mut self, side: Side, passer: &PlayerSnap, rng: &mut R) {
        if !self.plays_grid15() {
            return;
        }
        let odds = lane_odds(self.team_ref(side).tactics.width);
        let lane = next_lane(
            self.lane_for(side),
            odds,
            long_pass_mod(passer.long_passing),
            self.attacking_presence(side),
            rng,
        );
        self.set_lane_for(side, lane);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    const FULL: [f64; 3] = [1.0, 1.0, 1.0];

    /// The share of advances that go down the centre once the chain settles:
    /// `a / (a + (1 − c))`.
    fn settled_centre_share(odds: LaneOdds) -> f64 {
        odds.comes_inside / (odds.comes_inside + (1.0 - odds.centre_stays))
    }

    /// Given each width and a passer of average long passing,
    /// when the ball is moved up 100,000 times,
    /// then the share of moves down the centre settles within a point of
    /// `a / (a + (1 − c))`.
    #[test]
    fn the_centre_share_settles_where_the_formula_says() {
        for width in [
            TacticsPitchWidth::Narrow,
            TacticsPitchWidth::Normal,
            TacticsPitchWidth::Wide,
        ] {
            let odds = lane_odds(width);
            let mut rng = StdRng::seed_from_u64(1);
            let mut lane = Lane::Centre;
            let n = 100_000;
            let mut centre = 0;
            for _ in 0..n {
                lane = next_lane(lane, odds, 1.0, FULL, &mut rng);
                centre += usize::from(lane == Lane::Centre);
            }
            let share = centre as f64 / f64::from(n);
            assert!(
                (share - settled_centre_share(odds)).abs() <= 0.01,
                "{width:?}: {share:.3} against {:.3}",
                settled_centre_share(odds)
            );
        }
    }

    /// Given a flank and a passer with long passing 90, and one with 40,
    /// when the ball is moved on many times,
    /// then the first switches play more often.
    #[test]
    fn a_long_passer_switches_play_more_often() {
        let odds = lane_odds(TacticsPitchWidth::Normal);
        let switches = |long_passing: u8| {
            let mut rng = StdRng::seed_from_u64(2);
            (0..50_000)
                .filter(|_| {
                    next_lane(
                        Lane::Left,
                        odds,
                        long_pass_mod(long_passing),
                        FULL,
                        &mut rng,
                    ) == Lane::Right
                })
                .count()
        };
        assert!(
            switches(90) > switches(40) * 2,
            "{} vs {}",
            switches(90),
            switches(40)
        );
    }

    /// Given a side with nobody on its left,
    /// when the ball is moved on from the centre,
    /// then the left is chosen three times less often than the right.
    #[test]
    fn an_empty_flank_is_chosen_less() {
        let odds = lane_odds(TacticsPitchWidth::Normal);
        let mut rng = StdRng::seed_from_u64(3);
        let (mut left, mut right) = (0u32, 0u32);
        for _ in 0..60_000 {
            match next_lane(Lane::Centre, odds, 1.0, [0.0, 1.0, 1.0], &mut rng) {
                Lane::Left => left += 1,
                Lane::Right => right += 1,
                Lane::Centre => {}
            }
        }
        let ratio = f64::from(left) / f64::from(right);
        assert!((ratio - MIN_COVER).abs() < 0.03, "left/right {ratio:.3}");
    }

    /// Given the three widths,
    /// when their settled centre shares are compared,
    /// then narrower plays more down the middle.
    #[test]
    fn narrower_plays_more_down_the_middle() {
        let share = |w| settled_centre_share(lane_odds(w));
        assert!(share(TacticsPitchWidth::Narrow) > share(TacticsPitchWidth::Normal));
        assert!(share(TacticsPitchWidth::Normal) > share(TacticsPitchWidth::Wide));
    }

    /// Given each width,
    /// when the branches from a flank are added up,
    /// then they make one.
    #[test]
    fn a_flank_branches_add_up_to_one() {
        for width in [
            TacticsPitchWidth::Narrow,
            TacticsPitchWidth::Normal,
            TacticsPitchWidth::Wide,
        ] {
            let o = lane_odds(width);
            assert!((o.flank_stays + o.comes_inside + o.switches - 1.0).abs() < 1e-9);
        }
    }
}
