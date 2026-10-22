//! The rating-gap sweep: how the stronger side fares as the gap widens.
//!
//! One squad pair per gap used to decide every row, and two "70 OVR" sides
//! drawn separately differ by far more than nothing: across pairs the win rate
//! at a given gap moved by about 14 points (analysis-passing-crossing-curve.md
//! §E.5). So each gap is now played by many independently drawn pairs, the
//! stronger side at home in half of each pair's games, and gap 0 pits a squad
//! against its own mirror image, which makes the even matchup truly even.

use std::time::Instant;

use engine::ai::{ai_decide, AiPersonality, AiProfile};
use engine::{
    simulate_with_rng, LiveMatchState, MatchConfig, MatchReport, PlayStyle, PlayerData, Side,
    TeamData,
};
use rand::rngs::StdRng;
use rand::{Rng, RngExt, SeedableRng};

use crate::builder::{build_bench, build_team, mirror};
use crate::stats::BenchStats;

/// The nine formations a side can line up in: the eight the game has always
/// had and 3-4-2-1 (phase 2, P2.7). `--formation-mix` draws from them.
pub const FORMATIONS: [&str; 9] = engine::FORMATIONS;

/// How much weaker each bench player is than the XI.
const BENCH_PENALTY: u8 = 8;

/// Upper bound on engine steps for one match, so a phase-machine bug cannot
/// hang the bench. A regulation match takes about 100.
const MAX_STEPS: usize = 200;

pub struct SweepSpec<'a> {
    /// The weaker side sits `gap / 2` below this, the stronger `gap - gap / 2` above.
    pub centre: u8,
    pub gaps: Vec<u8>,
    /// Independently drawn squad pairs per gap.
    pub pairs: u32,
    /// Matches per gap, split evenly over the pairs.
    pub games_per_gap: u32,
    /// Seven-man benches and `ai_decide` on both sides, as every unwatched
    /// fixture in the game is played. Without it the XIs play ninety minutes alone.
    pub managed: bool,
    pub formation: &'a str,
    /// Each squad draws its formation from [`FORMATIONS`] instead of playing
    /// `formation` (phase 2, GĐ3, X60). A squad and its mirror at gap 0 still
    /// share one.
    pub formation_mix: bool,
    pub seed: u64,
}

/// One gap's results, from the stronger side's point of view.
pub struct GapRow {
    pub gap: u8,
    pub strong_rating: u8,
    pub weak_rating: u8,
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub goals: u32,
}

impl GapRow {
    pub fn pct(&self, n: u32) -> f64 {
        f64::from(n) / f64::from(self.games.max(1)) * 100.0
    }

    pub fn win_pct(&self) -> f64 {
        self.pct(self.wins)
    }

    /// Standard error of the win percentage, in percentage points.
    pub fn win_pct_se(&self) -> f64 {
        let p = f64::from(self.wins) / f64::from(self.games.max(1));
        (p * (1.0 - p) / f64::from(self.games.max(1))).sqrt() * 100.0
    }

    pub fn goals_per_game(&self) -> f64 {
        f64::from(self.goals) / f64::from(self.games.max(1))
    }
}

pub struct SweepResult {
    pub rows: Vec<GapRow>,
    /// Every match of the sweep, for the goal-source and duel aggregates.
    pub stats: BenchStats,
    /// Wall time of each match, in microseconds.
    pub match_micros: Vec<u64>,
    pub managed: bool,
}

impl SweepResult {
    /// The `q`-quantile (0.0–1.0) of match wall time, in microseconds.
    pub fn micros_quantile(&self, q: f64) -> u64 {
        let mut sorted = self.match_micros.clone();
        sorted.sort_unstable();
        if sorted.is_empty() {
            return 0;
        }
        let index = ((sorted.len() - 1) as f64 * q).round() as usize;
        sorted[index]
    }
}

pub fn run(config: &MatchConfig, spec: &SweepSpec<'_>) -> SweepResult {
    let mut stats = BenchStats::default();
    let mut match_micros = Vec::new();
    let mut rows = Vec::new();
    let games_per_pair = (spec.games_per_gap / spec.pairs.max(1)).max(2);
    let mut game_index = 0u64;
    let sweep_start = Instant::now();

    for &gap in &spec.gaps {
        let strong_rating = spec.centre.saturating_add(gap - gap / 2).min(99);
        let weak_rating = spec.centre.saturating_sub(gap / 2).max(10);
        let mut row = GapRow {
            gap,
            strong_rating,
            weak_rating,
            games: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goals: 0,
        };
        for pair in 0..spec.pairs {
            let pair_seed =
                spec.seed ^ (u64::from(gap) << 32) ^ u64::from(pair).wrapping_mul(0x9E37_79B9);
            let mut team_rng = StdRng::seed_from_u64(pair_seed);
            let squads = draw_pair(spec, strong_rating, weak_rating, gap, &mut team_rng);
            for g in 0..games_per_pair {
                let mut rng = StdRng::seed_from_u64(spec.seed.wrapping_add(game_index));
                game_index += 1;
                let strong_home = g % 2 == 0;
                let started = Instant::now();
                let report = play_pair(&squads, strong_home, spec.managed, config, &mut rng);
                match_micros.push(started.elapsed().as_micros() as u64);
                stats.add(&report);
                tally(&mut row, &report, strong_home);
            }
        }
        rows.push(row);
    }
    stats.total_time_secs = sweep_start.elapsed().as_secs_f64();

    SweepResult {
        rows,
        stats,
        match_micros,
        managed: spec.managed,
    }
}

/// The strong and weak squads of one pair, with their benches.
struct Pair {
    strong: TeamData,
    strong_bench: Vec<PlayerData>,
    weak: TeamData,
    weak_bench: Vec<PlayerData>,
}

fn draw_pair(
    spec: &SweepSpec<'_>,
    strong_rating: u8,
    weak_rating: u8,
    gap: u8,
    rng: &mut StdRng,
) -> Pair {
    let formation = |rng: &mut StdRng| {
        if spec.formation_mix {
            FORMATIONS[rng.random_range(0..FORMATIONS.len())]
        } else {
            spec.formation
        }
    };
    let strong_formation = formation(rng);
    let strong = build_team(
        "strong",
        "Strong FC",
        strong_rating,
        PlayStyle::Balanced,
        strong_formation,
        rng,
    );
    let strong_bench = build_bench("strong", strong_rating, BENCH_PENALTY, rng);
    if gap == 0 {
        // Two identical sides: the only asymmetry left is who is at home, and
        // that alternates, so any lean in the result is the engine's.
        let weak = mirror(&strong, "weak", "Weak FC");
        let weak_bench = strong_bench
            .iter()
            .map(|p| {
                let mut copy = p.clone();
                copy.id = copy.id.replacen("strong", "weak", 1);
                copy
            })
            .collect();
        return Pair {
            strong,
            strong_bench,
            weak,
            weak_bench,
        };
    }
    let weak_formation = formation(rng);
    let weak = build_team(
        "weak",
        "Weak FC",
        weak_rating,
        PlayStyle::Balanced,
        weak_formation,
        rng,
    );
    let weak_bench = build_bench("weak", weak_rating, BENCH_PENALTY, rng);
    Pair {
        strong,
        strong_bench,
        weak,
        weak_bench,
    }
}

fn play_pair<R: Rng>(
    pair: &Pair,
    strong_home: bool,
    managed: bool,
    config: &MatchConfig,
    rng: &mut R,
) -> MatchReport {
    let (home, home_bench, away, away_bench) = if strong_home {
        (
            &pair.strong,
            &pair.strong_bench,
            &pair.weak,
            &pair.weak_bench,
        )
    } else {
        (
            &pair.weak,
            &pair.weak_bench,
            &pair.strong,
            &pair.strong_bench,
        )
    };
    if !managed {
        return simulate_with_rng(home, away, config, rng);
    }
    play_managed(home, away, home_bench, away_bench, config, rng)
}

/// A match the way `ofm_core` plays an unwatched fixture: benches, and the AI
/// manager consulted every minute on both touchlines.
pub fn play_managed<R: Rng>(
    home: &TeamData,
    away: &TeamData,
    home_bench: &[PlayerData],
    away_bench: &[PlayerData],
    config: &MatchConfig,
    rng: &mut R,
) -> MatchReport {
    let mut state = LiveMatchState::new(
        home.clone(),
        away.clone(),
        config.clone(),
        home_bench.to_vec(),
        away_bench.to_vec(),
        false,
    );
    let manager = AiProfile {
        reputation: 500,
        experience: 50,
        personality: AiPersonality::Pragmatist,
    };
    for _ in 0..MAX_STEPS {
        if state.is_finished() {
            break;
        }
        state.step_minute(rng);
        for side in [Side::Home, Side::Away] {
            for command in ai_decide(&state, side, &manager, rng) {
                // A refused command (no cover on the bench, substitutions used
                // up) changes nothing, and is not a bench failure.
                let _ = state.apply_command(command);
            }
        }
    }
    state.into_report()
}

fn tally(row: &mut GapRow, report: &MatchReport, strong_home: bool) {
    let (scored, conceded) = if strong_home {
        (report.home_goals, report.away_goals)
    } else {
        (report.away_goals, report.home_goals)
    };
    row.games += 1;
    row.goals += u32::from(scored) + u32::from(conceded);
    match scored.cmp(&conceded) {
        std::cmp::Ordering::Greater => row.wins += 1,
        std::cmp::Ordering::Equal => row.draws += 1,
        std::cmp::Ordering::Less => row.losses += 1,
    }
}

/// Print the sweep table.
pub fn print_table(result: &SweepResult, spec: &SweepSpec<'_>) {
    println!(
        "Rating-gap sweep · {} pairs × {} games per gap · centre OVR {} · {} · {}",
        spec.pairs,
        (spec.games_per_gap / spec.pairs.max(1)).max(2),
        spec.centre,
        if result.managed {
            "benches + AI managers"
        } else {
            "headless XIs"
        },
        if spec.formation_mix {
            "formations drawn from all nine".to_string()
        } else {
            spec.formation.to_string()
        }
    );
    println!("  gap  strong  weak   win%  ±se   draw%  loss%  goals/game");
    for row in &result.rows {
        println!(
            "  {:>3}  {:>6}  {:>4}  {:>5.1}  {:>4.1}  {:>5.1}  {:>5.1}  {:>10.2}",
            row.gap,
            row.strong_rating,
            row.weak_rating,
            row.win_pct(),
            row.win_pct_se(),
            row.pct(row.draws),
            row.pct(row.losses),
            row.goals_per_game()
        );
    }
    println!(
        "  match time: p50 {} µs · p99 {} µs",
        result.micros_quantile(0.5),
        result.micros_quantile(0.99)
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(gaps: Vec<u8>, managed: bool) -> SweepSpec<'static> {
        SweepSpec {
            centre: 70,
            gaps,
            pairs: 4,
            games_per_gap: 40,
            managed,
            formation: "4-4-2",
            formation_mix: false,
            seed: 7,
        }
    }

    /// Given a sweep with four pairs and forty games per gap,
    /// when it runs,
    /// then every gap plays its forty games and the results add up.
    #[test]
    fn each_gap_plays_its_share_of_games() {
        let result = run(&MatchConfig::default(), &spec(vec![0, 10], false));
        for row in &result.rows {
            assert_eq!(row.games, 40);
            assert_eq!(row.wins + row.draws + row.losses, row.games);
        }
        assert_eq!(result.match_micros.len(), 80);
        assert_eq!(result.stats.games, 80);
    }

    /// Given gap 0,
    /// when a pair is drawn,
    /// then the weak side is the strong side's mirror: same attributes, other ids.
    #[test]
    fn gap_zero_pits_a_squad_against_its_mirror() {
        let s = spec(vec![0], false);
        let pair = draw_pair(&s, 70, 70, 0, &mut StdRng::seed_from_u64(1));
        assert_eq!(pair.strong.players.len(), pair.weak.players.len());
        for (a, b) in pair.strong.players.iter().zip(&pair.weak.players) {
            assert_ne!(a.id, b.id);
            assert_eq!(
                (a.pace, a.shooting, a.reflexes, a.height_cm),
                (b.pace, b.shooting, b.reflexes, b.height_cm)
            );
        }
        for (a, b) in pair.strong_bench.iter().zip(&pair.weak_bench) {
            assert_ne!(a.id, b.id);
            assert_eq!(a.passing, b.passing);
        }
    }

    /// Given a sweep with the formation mix,
    /// when pairs are drawn,
    /// then sides line up in several of the nine formations, and a squad and
    /// its gap-0 mirror always share one.
    #[test]
    fn the_formation_mix_draws_from_all_nine() {
        let mut s = spec(vec![0, 10], false);
        s.formation_mix = true;
        let mut seen = std::collections::HashSet::new();
        for seed in 0..60 {
            let mirror = draw_pair(&s, 70, 70, 0, &mut StdRng::seed_from_u64(seed));
            assert_eq!(mirror.strong.formation, mirror.weak.formation);
            let pair = draw_pair(&s, 75, 65, 10, &mut StdRng::seed_from_u64(seed));
            seen.insert(pair.strong.formation);
            seen.insert(pair.weak.formation);
        }
        assert_eq!(seen.len(), FORMATIONS.len());
    }

    /// Given a managed sweep,
    /// when it runs,
    /// then the AI managers make substitutions, which a headless sweep never does.
    #[test]
    fn a_managed_sweep_uses_the_bench() {
        let count_subs = |managed: bool| {
            let config = MatchConfig::default();
            let s = spec(vec![0], managed);
            let pair = draw_pair(&s, 70, 70, 0, &mut StdRng::seed_from_u64(3));
            (0..10u64)
                .map(|g| {
                    let report = play_pair(
                        &pair,
                        g % 2 == 0,
                        managed,
                        &config,
                        &mut StdRng::seed_from_u64(g),
                    );
                    report
                        .events
                        .iter()
                        .filter(|e| e.event_type == engine::EventType::Substitution)
                        .count()
                })
                .sum::<usize>()
        };
        assert_eq!(count_subs(false), 0);
        assert!(count_subs(true) > 0);
    }

    /// Given a set of recorded match times,
    /// when quantiles are read,
    /// then the median and the extremes come out of the sorted list.
    #[test]
    fn match_time_quantiles_come_from_the_sorted_times() {
        let result = SweepResult {
            rows: Vec::new(),
            stats: BenchStats::default(),
            match_micros: vec![50, 10, 40, 20, 30],
            managed: false,
        };
        assert_eq!(result.micros_quantile(0.0), 10);
        assert_eq!(result.micros_quantile(0.5), 30);
        assert_eq!(result.micros_quantile(1.0), 50);
    }
}
