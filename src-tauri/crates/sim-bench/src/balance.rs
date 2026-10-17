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
    pub formation: String,
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    /// Goals the formation scored and conceded.
    pub scored: u32,
    pub conceded: u32,
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
                formation: formation.to_string(),
                games: 0,
                wins: 0,
                draws: 0,
                losses: 0,
                scored: 0,
                conceded: 0,
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
                    row.scored += u32::from(scored);
                    row.conceded += u32::from(conceded);
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

/// The full-back trade-off (GĐ3-tech-spec §10.2, from P3.6): a 4-4-2 whose
/// full backs all bomb on (`AttackingFB`) against its own mirror whose full
/// backs stay home (`DefensiveFB`), headless, home alternating. Neither role
/// may win for free: |wins − losses| ≤ 6 points. The row is from the
/// attacking side.
pub fn full_back_tradeoff(config: &MatchConfig, seed: u64, games: u32) -> BalanceRow {
    use engine::{PitchPosition, PlayerRole};
    let pairs = games.div_ceil(GAMES_PER_PAIR).max(1);
    let mut row = BalanceRow {
        formation: "AttFB v DefFB".to_string(),
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        scored: 0,
        conceded: 0,
    };
    let full_back_slots: Vec<usize> = engine::formation_slots(BASELINE)
        .iter()
        .enumerate()
        .filter(|(_, slot)| matches!(slot, PitchPosition::LeftBack | PitchPosition::RightBack))
        .map(|(i, _)| i)
        .collect();
    for pair in 0..pairs {
        let pair_seed = seed ^ (0xFB << 40) ^ u64::from(pair).wrapping_mul(0x9E37_79B9);
        let mut team_rng = StdRng::seed_from_u64(pair_seed);
        let mut attacking = build_team(
            "side",
            "Side FC",
            RATING,
            PlayStyle::Balanced,
            BASELINE,
            &mut team_rng,
        );
        let mut defensive = crate::builder::mirror(&attacking, "base", "Base FC");
        for &i in &full_back_slots {
            attacking.players[i].role = PlayerRole::AttackingFB;
            defensive.players[i].role = PlayerRole::DefensiveFB;
        }
        for g in 0..GAMES_PER_PAIR {
            let mut rng = StdRng::seed_from_u64(pair_seed.wrapping_add(u64::from(g)));
            let attacking_home = g % 2 == 0;
            let report = if attacking_home {
                simulate_with_rng(&attacking, &defensive, config, &mut rng)
            } else {
                simulate_with_rng(&defensive, &attacking, config, &mut rng)
            };
            let (scored, conceded) = if attacking_home {
                (report.home_goals, report.away_goals)
            } else {
                (report.away_goals, report.home_goals)
            };
            row.games += 1;
            row.scored += u32::from(scored);
            row.conceded += u32::from(conceded);
            match scored.cmp(&conceded) {
                std::cmp::Ordering::Greater => row.wins += 1,
                std::cmp::Ordering::Equal => row.draws += 1,
                std::cmp::Ordering::Less => row.losses += 1,
            }
        }
    }
    row
}

/// One dial option against the neutral setup (phase 2, P3.9): a 4-4-2 with
/// the option against its own mirror with none, headless, home alternating,
/// `games` matches. The row is from the option's side.
pub fn dial_against_default(
    config: &MatchConfig,
    seed: u64,
    games: u32,
    label: String,
    tactics: engine::TacticsConfig,
) -> BalanceRow {
    against_mirror(
        config,
        seed ^ (0xD1A1 << 40),
        games,
        label,
        BASELINE,
        |_, option| {
            option.tactics = tactics.clone();
        },
    )
}

/// A role measured against `Standard` in one slot (phase 2, GĐ4, P4.0; the
/// gate of X74 from P4.4).
pub struct RoleCase {
    pub formation: &'static str,
    /// The slot's index in the formation, and the slot.
    pub index: usize,
    pub slot: engine::PitchPosition,
    pub role: engine::PlayerRole,
}

impl RoleCase {
    /// The row's name: the slot and the role.
    pub fn label(&self) -> String {
        format!("{:?} {:?}", self.slot, self.role)
    }
}

/// Every role each kind of slot offers, but `Standard`, each in a formation
/// that has the slot: the first such slot (the left one of a pair) carries it.
pub fn role_cases() -> Vec<RoleCase> {
    use engine::PitchPosition as P;
    let slots = [
        (P::Goalkeeper, "4-4-2"),
        (P::CenterBack, "4-4-2"),
        (P::LeftBack, "4-4-2"),
        (P::LeftWingBack, "5-3-2"),
        (P::DefensiveMidfielder, "4-3-3"),
        (P::CentralMidfielder, "4-4-2"),
        (P::AttackingMidfielder, "4-3-3"),
        (P::LeftMidfielder, "4-4-2"),
        (P::LeftWinger, "4-3-3"),
        (P::Striker, "4-4-2"),
    ];
    let mut cases = Vec::new();
    for (slot, formation) in slots {
        let Some(index) = engine::formation_slots(formation)
            .iter()
            .position(|s| *s == slot)
        else {
            continue;
        };
        for &role in crate::builder::valid_roles(slot) {
            if role == engine::PlayerRole::Standard {
                continue;
            }
            cases.push(RoleCase {
                formation,
                index,
                slot,
                role,
            });
        }
    }
    cases
}

/// One role in one slot against the same side with `Standard` there: a squad
/// against its own mirror, headless, home alternating, `games` matches. The
/// row is from the role's side.
pub fn role_against_standard(
    config: &MatchConfig,
    seed: u64,
    games: u32,
    case: &RoleCase,
) -> BalanceRow {
    let salt = (case.index as u64) << 32 ^ (case.role as u64) << 24;
    against_mirror(
        config,
        seed ^ (0x201E << 40) ^ salt,
        games,
        case.label(),
        case.formation,
        |standard, option| {
            standard.players[case.index].role = engine::PlayerRole::Standard;
            option.players[case.index].role = case.role;
        },
    )
}

/// A squad in `formation` against its own mirror, which `setup` changes
/// (`setup(base, option)`), headless, home alternating, `games` matches
/// rounded up to whole pairs. The row is from the changed side.
fn against_mirror(
    config: &MatchConfig,
    seed: u64,
    games: u32,
    label: String,
    formation: &str,
    setup: impl Fn(&mut engine::TeamData, &mut engine::TeamData),
) -> BalanceRow {
    let pairs = games.div_ceil(GAMES_PER_PAIR).max(1);
    let mut row = BalanceRow {
        formation: label,
        games: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        scored: 0,
        conceded: 0,
    };
    for pair in 0..pairs {
        let pair_seed = seed ^ u64::from(pair).wrapping_mul(0x9E37_79B9);
        let mut team_rng = StdRng::seed_from_u64(pair_seed);
        let mut base = build_team(
            "base",
            "Base FC",
            RATING,
            PlayStyle::Balanced,
            formation,
            &mut team_rng,
        );
        let mut option = crate::builder::mirror(&base, "side", "Side FC");
        setup(&mut base, &mut option);
        for g in 0..GAMES_PER_PAIR {
            let mut rng = StdRng::seed_from_u64(pair_seed.wrapping_add(u64::from(g)));
            let option_home = g % 2 == 0;
            let report = if option_home {
                simulate_with_rng(&option, &base, config, &mut rng)
            } else {
                simulate_with_rng(&base, &option, config, &mut rng)
            };
            let (scored, conceded) = if option_home {
                (report.home_goals, report.away_goals)
            } else {
                (report.away_goals, report.home_goals)
            };
            row.games += 1;
            row.scored += u32::from(scored);
            row.conceded += u32::from(conceded);
            match scored.cmp(&conceded) {
                std::cmp::Ordering::Greater => row.wins += 1,
                std::cmp::Ordering::Equal => row.draws += 1,
                std::cmp::Ordering::Less => row.losses += 1,
            }
        }
    }
    row
}

pub fn print_table(rows: &[BalanceRow]) {
    print_titled(
        &format!("Formation balance · each against {BASELINE}"),
        "a formation",
        rows,
    );
}

/// Each role against `Standard` in its slot (P4.0).
pub fn print_role_table(rows: &[BalanceRow]) {
    print_titled(
        "Role balance · each role against Standard in its slot",
        "a role",
        rows,
    );
}

fn print_titled(title: &str, unit: &str, rows: &[BalanceRow]) {
    println!();
    println!(
        "{title} · OVR {RATING} both · headless · {} games {unit}",
        rows.first().map_or(0, |r| r.games)
    );
    println!(
        "  {:<32}  win%  draw%  loss%   win−loss  ±se   for  against",
        "side"
    );
    for row in rows {
        println!(
            "  {:<32}  {:>5.1}  {:>5.1}  {:>5.1}   {:>+8.1}  {:>3.1}  {:>4.2}  {:>4.2}",
            row.formation,
            row.pct(row.wins),
            row.pct(row.draws),
            row.pct(row.losses),
            row.edge(),
            row.edge_se(),
            f64::from(row.scored) / f64::from(row.games.max(1)),
            f64::from(row.conceded) / f64::from(row.games.max(1))
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

    /// Given the role table (phase 2, P4.0),
    /// when its rows are listed,
    /// then every role a slot offers but `Standard` has one row, each in a
    /// formation that has the slot.
    #[test]
    fn every_role_but_standard_is_measured_in_a_slot_that_offers_it() {
        let cases = role_cases();
        assert!(cases.iter().all(|c| c.role != engine::PlayerRole::Standard));
        assert!(cases.iter().any(|c| c.role == engine::PlayerRole::Mezzala));
        assert!(cases
            .iter()
            .any(|c| c.role == engine::PlayerRole::SweeperKeeper));
        for case in &cases {
            assert_eq!(
                engine::formation_slots(case.formation)[case.index],
                case.slot,
                "{}",
                case.label()
            );
        }
    }

    /// Given a short role run for one role,
    /// when it is played,
    /// then the row has its whole pairs of games and the results add up.
    #[test]
    fn a_role_row_plays_its_games() {
        let case = role_cases().remove(0);
        let row = role_against_standard(&MatchConfig::default(), 5, 20, &case);
        assert_eq!(row.games, 20);
        assert_eq!(row.wins + row.draws + row.losses, row.games);
    }
}
