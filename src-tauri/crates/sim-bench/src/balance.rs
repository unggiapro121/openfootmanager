//! The formation-balance table (phase 2, GĐ3, decision X60): each formation
//! against 4-4-2 between sides of the same rating, so a formation that wins for
//! free shows up before the lanes of GĐ3 hand it to the player.
//!
//! The matches are headless: an AI manager on the touchline switches 4-4-2 to
//! 4-3-3 or 4-2-3-1 when it is losing, which would blur the very comparison the
//! table makes. Two separately drawn "70" sides differ by far more than
//! nothing, so every formation is played by many squad pairs (each pair its own
//! draw) with home alternating inside the pair; with 400 pairs the pair-to-pair
//! spread adds about 0.7 points to the 1.3 of the matches themselves.

use engine::{simulate_with_rng, MatchConfig, PlayStyle};
use rand::rngs::StdRng;
use rand::SeedableRng;

use crate::builder::build_team;
use crate::sweep::FORMATIONS;

/// Every formation is measured against this one.
const BASELINE: &str = "4-4-2";
/// Both sides' rating, as in the guardrail sweep's centre.
const RATING: u8 = 70;
/// Matches each squad pair plays (home alternating).
const GAMES_PER_PAIR: u32 = 10;

/// One formation's record against 4-4-2, from the formation's side.
pub struct BalanceRow {
    pub formation: &'static str,
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
}

impl BalanceRow {
    fn pct(&self, n: u32) -> f64 {
        f64::from(n) / f64::from(self.games.max(1)) * 100.0
    }

    /// Wins minus losses, in points.
    pub fn edge(&self) -> f64 {
        self.pct(self.wins) - self.pct(self.losses)
    }

    /// Standard error of [`BalanceRow::edge`] over the matches, in points:
    /// Var = (pW + pL − (pW − pL)²) / n.
    pub fn edge_se(&self) -> f64 {
        let (w, l) = (self.pct(self.wins) / 100.0, self.pct(self.losses) / 100.0);
        ((w + l - (w - l).powi(2)) / f64::from(self.games.max(1))).sqrt() * 100.0
    }
}

/// Play `games` matches (rounded up to whole pairs) for each formation
/// against 4-4-2.
pub fn run(config: &MatchConfig, seed: u64, games: u32) -> Vec<BalanceRow> {
    let pairs = games.div_ceil(GAMES_PER_PAIR).max(1);
    FORMATIONS
        .iter()
        .copied()
        .filter(|f| *f != BASELINE)
        .enumerate()
        .map(|(index, formation)| {
            let mut row = BalanceRow {
                formation,
                games: 0,
                wins: 0,
                draws: 0,
                losses: 0,
            };
            for pair in 0..pairs {
                let pair_seed =
                    seed ^ ((index as u64 + 1) << 40) ^ u64::from(pair).wrapping_mul(0x9E37_79B9);
                let mut team_rng = StdRng::seed_from_u64(pair_seed);
                let side = build_team(
                    "side",
                    "Side FC",
                    RATING,
                    PlayStyle::Balanced,
                    formation,
                    &mut team_rng,
                );
                let base = build_team(
                    "base",
                    "Base FC",
                    RATING,
                    PlayStyle::Balanced,
                    BASELINE,
                    &mut team_rng,
                );
                for g in 0..GAMES_PER_PAIR {
                    let mut rng = StdRng::seed_from_u64(pair_seed.wrapping_add(u64::from(g)));
                    let side_home = g % 2 == 0;
                    let report = if side_home {
                        simulate_with_rng(&side, &base, config, &mut rng)
                    } else {
                        simulate_with_rng(&base, &side, config, &mut rng)
                    };
                    let (scored, conceded) = if side_home {
                        (report.home_goals, report.away_goals)
                    } else {
                        (report.away_goals, report.home_goals)
                    };
                    row.games += 1;
                    match scored.cmp(&conceded) {
                        std::cmp::Ordering::Greater => row.wins += 1,
                        std::cmp::Ordering::Equal => row.draws += 1,
                        std::cmp::Ordering::Less => row.losses += 1,
                    }
                }
            }
            row
        })
        .collect()
}

pub fn print_table(rows: &[BalanceRow]) {
    println!();
    println!(
        "Formation balance · each against {BASELINE} · OVR {RATING} both · headless · {} games a formation",
        rows.first().map_or(0, |r| r.games)
    );
    println!("  formation   win%  draw%  loss%   win−loss  ±se");
    for row in rows {
        println!(
            "  {:<9}  {:>5.1}  {:>5.1}  {:>5.1}   {:>+8.1}  {:>3.1}",
            row.formation,
            row.pct(row.wins),
            row.pct(row.draws),
            row.pct(row.losses),
            row.edge(),
            row.edge_se()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given a short balance run,
    /// when it is played,
    /// then every formation but 4-4-2 has a row, each with its whole pairs of
    /// games, and the results add up.
    #[test]
    fn every_formation_but_the_baseline_gets_a_row() {
        let rows = run(&MatchConfig::default(), 3, 20);
        assert_eq!(rows.len(), FORMATIONS.len() - 1);
        assert!(rows.iter().all(|r| r.formation != BASELINE));
        for row in &rows {
            assert_eq!(row.games, 20);
            assert_eq!(row.wins + row.draws + row.losses, row.games);
        }
    }
}
