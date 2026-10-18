//! The calibration targets of phase 2's GĐ5 (GĐ5-tech-spec §5, §11.2): one
//! table read by both measures, so a band lives in one place.
//!
//! Some targets need synthetic mirror squads and are judged by sim-bench's
//! guardrails (`--stage gd5`); the rest need a real world and are judged by
//! the real-world probes. Each side only *measures* the other's rows.
//! Sources are in `fm-document/comon/sim-bench/reference/` (`gd5-real-reference.txt`,
//! `gd5-strength-bridge.json`, the P0.5 football-data table).

use std::fmt;

/// A closed range a measure must land in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Band {
    pub lo: f64,
    pub hi: f64,
}

impl Band {
    pub const fn new(lo: f64, hi: f64) -> Self {
        Self { lo, hi }
    }

    /// Nothing above `hi`.
    pub const fn at_most(hi: f64) -> Self {
        Self {
            lo: f64::NEG_INFINITY,
            hi,
        }
    }

    pub fn contains(&self, value: f64) -> bool {
        (self.lo..=self.hi).contains(&value)
    }
}

impl fmt::Display for Band {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.lo == f64::NEG_INFINITY {
            write!(f, "≤ {}", self.hi)
        } else {
            write!(f, "{}–{}", self.lo, self.hi)
        }
    }
}

// --- Judged by the European league probe ---------------------------------

/// T1: goals a game. The 2024-25 leagues: 2.69 across 18, 2.83 in the top five.
pub const GOALS_PER_GAME: Band = Band::new(2.6, 2.9);
/// T2: home wins minus away wins, in points.
pub const HOME_EDGE: Band = Band::new(9.0, 13.0);
/// T3: draws, %.
pub const DRAWS: Band = Band::new(25.0, 27.0);
/// T5: how far the stronger club's win rate may sit from the market's line in
/// each 2-point bucket of strength gap from 0 to 10 (X81), in points.
pub const STRENGTH_GAP_TOLERANCE: f64 = 3.0;
/// T21: the AI's formations (X83): at least this many in use, none above
/// this share (%).
pub const FORMATIONS_IN_USE_MIN: usize = 5;
pub const FORMATION_SHARE_MAX: f64 = 40.0;

// --- Judged by the match probe -------------------------------------------

/// T8: goals scored with the head, corners included, % of goals.
pub const HEADED_GOALS: Band = Band::new(16.0, 22.0);
/// T9b: goals from outside the box, open play and direct free kicks together,
/// % of goals.
pub const OUTSIDE_BOX_GOALS: Band = Band::new(10.0, 14.0);
/// T10: goals straight from a free kick, % of goals (X39).
pub const DIRECT_FREE_KICK_GOALS: Band = Band::new(1.5, 3.0);
/// T11: corners a match.
pub const CORNERS_PER_GAME: Band = Band::new(9.0, 10.5);
/// T13: shots a match.
pub const SHOTS_PER_GAME: Band = Band::new(23.0, 26.0);
/// T14: shots after each ball lost in the own third (X84).
pub const SHOTS_PER_HIGH_TURNOVER: Band = Band::new(0.07, 0.12);
/// T16: standard deviation of a side's possession across matches, points
/// (X87).
pub const POSSESSION_SD: Band = Band::new(8.4, 12.4);
/// T19: the widest gap between two natural positions' mean match rating.
pub const RATING_SPREAD: Band = Band::at_most(0.3);
/// T20: the league's top scorer's goals in a season.
pub const TOP_SCORER_GOALS: Band = Band::new(25.0, 36.0);

// --- Judged by both: the guardrails and the match probe -------------------

/// T12: defenders' share of aerial duels after a cross or a set piece.
pub const DEFENDER_AERIAL_WIN: Band = Band::new(56.0, 59.0);

// --- Judged by the guardrails ---------------------------------------------

/// T4: mirror squads at gap 0, win and draw %, each ±3 around 35/30/35.
pub const MIRROR_WIN: Band = Band::new(32.0, 38.0);
pub const MIRROR_DRAW: Band = Band::new(27.0, 33.0);
/// T7: median milliseconds a match.
pub const MATCH_MS_P50: Band = Band::at_most(2.5);
/// T15: loose balls after a long ball won by the side that kicked it, %
/// (X84).
pub const SECOND_BALL_KICKER_WIN: Band = Band::new(35.0, 40.0);
/// T17, T18: formation, role, dial and blueprint balance, points of wins over
/// losses either way.
pub const BALANCE_MAX: f64 = 5.0;

#[cfg(test)]
mod tests {
    use super::*;

    /// Given a band and a one-sided band,
    /// when values on, inside and outside their edges are tested,
    /// then the edges count as inside.
    #[test]
    fn a_band_includes_its_edges() {
        assert!(GOALS_PER_GAME.contains(2.6));
        assert!(GOALS_PER_GAME.contains(2.9));
        assert!(!GOALS_PER_GAME.contains(2.91));
        assert!(RATING_SPREAD.contains(0.0));
        assert!(!RATING_SPREAD.contains(0.31));
        assert_eq!(GOALS_PER_GAME.to_string(), "2.6–2.9");
        assert_eq!(RATING_SPREAD.to_string(), "≤ 0.3");
    }
}
