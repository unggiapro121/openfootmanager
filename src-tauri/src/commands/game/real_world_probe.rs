//! What the real-world package plays like: the measurement phase 2's data steps
//! are judged by.
//!
//! ```text
//! OFM_REAL_WORLD_PACKAGE=/path/to/real-world-2025-26.ofm \
//!   cargo test --release --lib real_world_probe -- --ignored --nocapture
//! ```
//!
//! The golden matches and `sim-bench --guardrails` build synthetic `PlayerData`,
//! so they cannot see a change to the world's data: new attributes, a new OVR
//! table, a trait whose condition moved. Those reach a match only through a real
//! world, as a different XI picked or a different player carrying a trait. This
//! builds that world the way "New game" does (`build_game_from_world_data`,
//! `begin_career`), plays a span of days and prints what the league matches
//! came to.
//!
//! The run is not exactly repeatable even on a pinned seed: building a world
//! from a package mints UUIDs for the staff and squad top-ups it generates, and
//! some draws are keyed by id. So it plays `OFM_PROBE_RUNS` worlds (seed, seed+1,
//! …) and reports the pooled figures with their standard errors. Two code
//! versions differ only when they differ by more than about two of those.
//!
//! Knobs: `OFM_PROBE_SEED`, `OFM_PROBE_RUNS` (default 3), `OFM_PROBE_DAYS` (default 150), `OFM_PROBE_CLUB`
//! (default the first club), `OFM_PROBE_SCOPE=home` to simulate only the club's
//! home region instead of every competition, `OFM_PROBE_OUT` for a JSON copy.

use std::collections::BTreeMap;
use std::path::Path;

use domain::league::{FixtureCompetition, FixtureStatus};
use domain::manager::Manager;
use ofm_core::career::{begin_career, CareerScope};
use ofm_core::game::Game;
use ofm_core::generator::{
    build_world_from_package, load_world_package_from_ofm,
    normalize_imported_world_for_career_start, DefinitionSources,
};
use serde::Serialize;

use super::startup::normalize_startup_options;
use super::world_build::build_game_from_world_data;
use super::world_load::game_clock_for_world;

const OPENING_YEAR: i32 = 2026;

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[derive(Default, Serialize)]
struct LeagueTotals {
    matches: u32,
    goals: u32,
    /// Sum of squared match goal totals, for the standard error of goals/game.
    goals_squared: u64,
    home_wins: u32,
    draws: u32,
    away_wins: u32,
    substitutions: u32,
}

impl LeagueTotals {
    fn pct(&self, n: u32) -> f64 {
        f64::from(n) / f64::from(self.matches.max(1)) * 100.0
    }

    fn goals_per_game(&self) -> f64 {
        f64::from(self.goals) / f64::from(self.matches.max(1))
    }

    fn goals_per_game_se(&self) -> f64 {
        let n = f64::from(self.matches.max(1));
        let mean = self.goals_per_game();
        let variance = (self.goals_squared as f64 / n - mean * mean).max(0.0);
        (variance / n).sqrt()
    }

    /// Standard error of a percentage share, in percentage points.
    fn pct_se(&self, k: u32) -> f64 {
        let n = f64::from(self.matches.max(1));
        let p = f64::from(k) / n;
        (p * (1.0 - p) / n).sqrt() * 100.0
    }

    fn add(&mut self, other: &LeagueTotals) {
        self.matches += other.matches;
        self.goals += other.goals;
        self.goals_squared += other.goals_squared;
        self.home_wins += other.home_wins;
        self.draws += other.draws;
        self.away_wins += other.away_wins;
        self.substitutions += other.substitutions;
    }
}

#[derive(Serialize)]
struct ProbeReport {
    seeds: Vec<u64>,
    days: u32,
    club: String,
    active_competitions: usize,
    /// Each run's league totals, then the pooled ones.
    runs: Vec<LeagueTotals>,
    league: LeagueTotals,
    /// Mean OVR of every player, by the engine's position group.
    mean_ovr_by_group: BTreeMap<String, f64>,
    /// How many players carry each trait.
    trait_counts: BTreeMap<String, u32>,
    /// Share of players at each natural position who shoot from distance by
    /// habit (phase 2, P1.5): (players, share in %).
    shoots_from_distance_by_position: BTreeMap<String, (u32, f64)>,
}

fn build_game(package: &Path, seed: u64) -> Game {
    let (pkg, errors) = load_world_package_from_ofm(package);
    assert!(errors.is_empty(), "package errors: {errors:?}");
    let sources = DefinitionSources::embedded_only();
    let mut options = normalize_startup_options(None).expect("default startup options");
    options.start_year = OPENING_YEAR;
    let mut world = build_world_from_package(&pkg, Some(OPENING_YEAR as u32), &sources)
        .expect("the package builds a world");
    // A package carries no seed, so "New game" draws one; the probe pins it.
    world.generation_seed = Some(seed);
    let clock = game_clock_for_world(&options, &world.metadata).expect("a clock for the world");
    normalize_imported_world_for_career_start(&mut world, OPENING_YEAR as u32);
    let manager = Manager::new(
        "mgr_user".to_string(),
        "Probe".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let (mut game, stats) = build_game_from_world_data(clock, manager, &options, world);

    let club = std::env::var("OFM_PROBE_CLUB")
        .ok()
        .filter(|id| game.teams.iter().any(|team| &team.id == id))
        .unwrap_or_else(|| game.teams[0].id.clone());
    let competitions = match std::env::var("OFM_PROBE_SCOPE").as_deref() {
        Ok("home") => None,
        _ => Some(game.competitions.iter().map(|c| c.id.clone()).collect()),
    };
    begin_career(
        &mut game,
        &club,
        CareerScope {
            regions: None,
            competitions,
        },
        stats,
    )
    .expect("the career begins");
    game
}

/// League matches played on or after `since` (ISO date). Fixtures a world is
/// built with mid-season are caught up by a cheaper model before kick-off, so
/// they are left out: they are not the engine this probe measures.
fn league_totals(game: &Game, since: &str) -> LeagueTotals {
    let mut totals = LeagueTotals::default();
    let fixtures = game
        .competitions
        .iter()
        .flat_map(|competition| competition.fixtures.iter());
    for fixture in fixtures {
        if fixture.competition != FixtureCompetition::League
            || fixture.status != FixtureStatus::Completed
            || fixture.date.as_str() < since
        {
            continue;
        }
        let Some(result) = &fixture.result else {
            continue;
        };
        let goals = u32::from(result.home_goals) + u32::from(result.away_goals);
        totals.matches += 1;
        totals.goals += goals;
        totals.goals_squared += u64::from(goals * goals);
        match result.home_goals.cmp(&result.away_goals) {
            std::cmp::Ordering::Greater => totals.home_wins += 1,
            std::cmp::Ordering::Equal => totals.draws += 1,
            std::cmp::Ordering::Less => totals.away_wins += 1,
        }
        if let Some(report) = &result.report {
            totals.substitutions += report
                .events
                .iter()
                .filter(|event| event.event_type == "Substitution")
                .count() as u32;
        }
    }
    totals
}

fn mean_ovr_by_group(game: &Game) -> BTreeMap<String, f64> {
    let mut sums: BTreeMap<String, (f64, u32)> = BTreeMap::new();
    for player in &game.players {
        let entry = sums
            .entry(format!("{:?}", player.position.to_group_position()))
            .or_default();
        entry.0 += f64::from(player.ovr);
        entry.1 += 1;
    }
    sums.into_iter()
        .map(|(group, (sum, n))| (group, (sum / f64::from(n) * 100.0).round() / 100.0))
        .collect()
}

fn shoots_from_distance_by_position(game: &Game) -> BTreeMap<String, (u32, f64)> {
    let mut counts: BTreeMap<String, (u32, u32)> = BTreeMap::new();
    for player in &game.players {
        let entry = counts
            .entry(format!("{:?}", player.natural_position))
            .or_default();
        entry.0 += 1;
        entry.1 += u32::from(
            player
                .traits
                .contains(&domain::player::PlayerTrait::ShootsFromDistance),
        );
    }
    counts
        .into_iter()
        .map(|(position, (n, with))| {
            let share = f64::from(with) / f64::from(n.max(1)) * 100.0;
            (position, (n, (share * 10.0).round() / 10.0))
        })
        .collect()
}

fn trait_counts(game: &Game) -> BTreeMap<String, u32> {
    let mut counts = BTreeMap::new();
    for player in &game.players {
        for player_trait in &player.traits {
            *counts.entry(format!("{player_trait:?}")).or_insert(0) += 1;
        }
    }
    counts
}

/// Given the real-world package and a fixed seed,
/// when a career is opened and `OFM_PROBE_DAYS` days are played,
/// then the league results, OVR means and trait counts are printed for comparison.
/// Given the real-world package,
/// when a career opens,
/// then the share of players who shoot from distance by habit is printed by
/// natural position, real (package) and generated players apart: the habit's
/// base rates were set on the real ones (P1.5), and the generator's flat
/// attribute draws put generated attackers above them.
#[test]
#[ignore = "builds the real-world package; run explicitly with OFM_REAL_WORLD_PACKAGE"]
fn real_world_habit_shares() {
    let Ok(package) = std::env::var("OFM_REAL_WORLD_PACKAGE") else {
        return;
    };
    let game = build_game(
        Path::new(&package),
        env_or("OFM_PROBE_SEED", 20_260_601_u64),
    );
    // Real (package) players carry slug ids; generated ones carry UUIDs.
    let mut by: BTreeMap<(String, bool), (u32, u32)> = BTreeMap::new();
    for player in &game.players {
        let generated = player.id.len() == 36 && player.id.matches('-').count() == 4;
        let e = by
            .entry((format!("{:?}", player.natural_position), generated))
            .or_default();
        e.0 += 1;
        e.1 += u32::from(
            player
                .traits
                .contains(&domain::player::PlayerTrait::ShootsFromDistance),
        );
    }
    for ((position, generated), (n, with)) in by {
        if n >= 50 {
            println!(
                "{position:<22} {:<9} n {n:>5}  {:.1}%",
                if generated { "generated" } else { "real" },
                f64::from(with) / f64::from(n) * 100.0
            );
        }
    }
}

/// What real players do inside a match, read from full engine reports: the
/// compact reports a career keeps hold only goals, cards and substitutions.
#[derive(Default, Serialize)]
struct MatchShares {
    matches: u32,
    goals: u32,
    goals_squared: u64,
    shots: u64,
    corners: u64,
    corner_goals: u64,
    penalties_awarded: u64,
    aerial_won: u64,
    aerial_lost: u64,
    cross_goals: u64,
    fouls_final_third: u64,
    fouls_in_box: u64,
    direct_free_kicks: u64,
    direct_free_kick_goals: u64,
    long_shots: u64,
    long_shot_goals: u64,
    counter_one_v_ones_won: u64,
    counter_goals: u64,
    /// Phase 2, GĐ3 (P3.0): one-on-ones in the attacking third and crosses by
    /// lane (left, centre, right), box shots by the shooter's group (DEF, MID,
    /// FWD, substitutes), and goals with the head, corners included.
    final_third_lanes: [u64; 3],
    crosses_by_lane: [u64; 3],
    box_shots_by_group: [u64; 4],
    headed_goals: u64,
}

impl MatchShares {
    fn add(&mut self, report: &engine::MatchReport) {
        let goals = u32::from(report.home_goals) + u32::from(report.away_goals);
        self.matches += 1;
        self.goals += goals;
        self.goals_squared += u64::from(goals * goals);
        self.shots += u64::from(report.home_stats.shots + report.away_stats.shots);
        self.corners += u64::from(report.home_stats.corners + report.away_stats.corners);
        self.corner_goals += report
            .goals
            .iter()
            .filter(|goal| goal.goal_source == engine::GoalSource::Corner)
            .count() as u64;
        self.penalties_awarded += report
            .events
            .iter()
            .filter(|event| event.event_type == engine::EventType::PenaltyAwarded)
            .count() as u64;
        self.direct_free_kicks += report
            .events
            .iter()
            .filter(|event| {
                event.shot_kind == Some(engine::ShotKind::DirectFreeKick)
                    && matches!(
                        event.event_type,
                        engine::EventType::Goal
                            | engine::EventType::ShotSaved
                            | engine::EventType::ShotOffTarget
                            | engine::EventType::ShotBlocked
                    )
            })
            .count() as u64;
        self.direct_free_kick_goals += report
            .goals
            .iter()
            .filter(|goal| goal.goal_source == engine::GoalSource::DirectFreeKick)
            .count() as u64;
        self.long_shots += report
            .events
            .iter()
            .filter(|event| {
                event.shot_kind == Some(engine::ShotKind::LongRange)
                    && matches!(
                        event.event_type,
                        engine::EventType::Goal
                            | engine::EventType::ShotSaved
                            | engine::EventType::ShotOffTarget
                            | engine::EventType::ShotBlocked
                    )
            })
            .count() as u64;
        self.long_shot_goals += report
            .goals
            .iter()
            .filter(|goal| goal.goal_source == engine::GoalSource::LongShot)
            .count() as u64;
        for event in &report.events {
            if event.tactical_context == Some(engine::TacticalContext::Counter) {
                match event.event_type {
                    engine::EventType::Dribble => self.counter_one_v_ones_won += 1,
                    engine::EventType::Goal => self.counter_goals += 1,
                    _ => {}
                }
            }
        }
        let tally = engine::EventTally::of_report(report);
        self.aerial_won += tally.aerial_won;
        self.aerial_lost += tally.aerial_lost;
        self.cross_goals += tally.cross_goals;
        self.fouls_final_third += tally.fouls_final_third;
        self.fouls_in_box += tally.fouls_in_box;
        for lane in 0..3 {
            self.final_third_lanes[lane] += tally.final_third_lanes[lane];
            self.crosses_by_lane[lane] += tally.crosses_by_lane[lane];
        }
        for group in 0..4 {
            self.box_shots_by_group[group] += tally.box_shots_by_group[group];
        }
        self.headed_goals += report
            .events
            .iter()
            .filter(|event| {
                event.event_type == engine::EventType::Goal
                    && event.shot_kind == Some(engine::ShotKind::Header)
            })
            .count() as u64;
    }

    fn per_match(&self, count: u64) -> f64 {
        count as f64 / f64::from(self.matches.max(1))
    }

    fn pct(part: u64, whole: u64) -> f64 {
        part as f64 / whole.max(1) as f64 * 100.0
    }
}

/// Given the real-world package,
/// when every scheduled fixture of the probe club's league is played once in
/// each of `OFM_MATCH_PROBE_RUNS` worlds (default 10) (the world itself is left as it was),
/// then the shares only a full report shows are printed: defenders' aerial
/// wins, goals per corner, penalties and fouls by zone (phase 2, P2.0).
#[test]
#[ignore = "builds the real-world package and plays a league season of matches; run explicitly"]
fn real_world_match_probe() {
    let Ok(package) = std::env::var("OFM_REAL_WORLD_PACKAGE") else {
        eprintln!("OFM_REAL_WORLD_PACKAGE is not set; nothing to probe.");
        return;
    };
    let first_seed = env_or("OFM_PROBE_SEED", 20_260_601_u64);
    // A world's league season takes seconds, so this one plays more of them.
    let run_count = env_or("OFM_MATCH_PROBE_RUNS", 10_u64).max(1);
    let started = std::time::Instant::now();
    let mut shares = MatchShares::default();
    for seed in first_seed..first_seed + run_count {
        let game = build_game(Path::new(&package), seed);
        let fixture_count = game
            .league
            .as_ref()
            .map_or(0, |league| league.fixtures.len());
        for index in 0..fixture_count {
            let Ok(mut session) = ofm_core::live_match_manager::create_live_match(
                &game,
                index,
                ofm_core::live_match_manager::MatchMode::Instant,
                false,
            ) else {
                continue;
            };
            session.user_side = None;
            session.run_to_completion();
            shares.add(&session.match_state.into_report());
        }
    }
    let n = f64::from(shares.matches.max(1));
    let mean = f64::from(shares.goals) / n;
    let se = ((shares.goals_squared as f64 / n - mean * mean).max(0.0) / n).sqrt();
    println!(
        "real-world match probe · {} runs · {} matches · {:.1}s",
        run_count,
        shares.matches,
        started.elapsed().as_secs_f64()
    );
    println!(
        "  goals/game {mean:.3} ± {se:.3} · shots/game {:.2} · penalties/game {:.3}",
        shares.per_match(shares.shots),
        shares.per_match(shares.penalties_awarded)
    );
    println!(
        "  defender aerial win {:.1}% ({} duels) · cross goals {:.1}% of goals",
        MatchShares::pct(shares.aerial_lost, shares.aerial_won + shares.aerial_lost),
        shares.aerial_won + shares.aerial_lost,
        MatchShares::pct(shares.cross_goals, u64::from(shares.goals))
    );
    println!(
        "  corners/game {:.2} · goals per corner {:.2}% · corner goals {:.1}% of goals",
        shares.per_match(shares.corners),
        MatchShares::pct(shares.corner_goals, shares.corners),
        MatchShares::pct(shares.corner_goals, u64::from(shares.goals))
    );
    println!(
        "  fouls/game in the final third {:.2} · in the box {:.2}",
        shares.per_match(shares.fouls_final_third),
        shares.per_match(shares.fouls_in_box)
    );
    println!(
        "  shots from distance {:.1}% of shots · scored {:.1}% · {:.1}% of goals",
        MatchShares::pct(shares.long_shots, shares.shots),
        MatchShares::pct(shares.long_shot_goals, shares.long_shots),
        MatchShares::pct(shares.long_shot_goals, u64::from(shares.goals))
    );
    println!(
        "  one-on-ones won on the break/game {:.2} · g (goals per one) {:.3}",
        shares.per_match(shares.counter_one_v_ones_won),
        shares.counter_goals as f64 / shares.counter_one_v_ones_won.max(1) as f64
    );
    println!(
        "  direct free kicks/game {:.2} · scored {:.1}% · {:.1}% of goals",
        shares.per_match(shares.direct_free_kicks),
        MatchShares::pct(shares.direct_free_kick_goals, shares.direct_free_kicks),
        MatchShares::pct(shares.direct_free_kick_goals, u64::from(shares.goals))
    );
    let lanes: u64 = shares.final_third_lanes.iter().sum();
    let box_shots: u64 = shares.box_shots_by_group.iter().sum();
    let [def, mid, fwd, subs] = shares.box_shots_by_group;
    println!(
        "  final-third one-on-ones left/centre/right {:.1}/{:.1}/{:.1}% · crosses/game {:.2} · headed goals {:.1}% of goals",
        MatchShares::pct(shares.final_third_lanes[0], lanes),
        MatchShares::pct(shares.final_third_lanes[1], lanes),
        MatchShares::pct(shares.final_third_lanes[2], lanes),
        shares.per_match(shares.crosses_by_lane.iter().sum()),
        MatchShares::pct(shares.headed_goals, u64::from(shares.goals))
    );
    println!(
        "  box shots by group FWD/MID/DEF/subs {:.1}/{:.1}/{:.1}/{:.1}%",
        MatchShares::pct(fwd, box_shots),
        MatchShares::pct(mid, box_shots),
        MatchShares::pct(def, box_shots),
        MatchShares::pct(subs, box_shots)
    );
    if let Ok(out) = std::env::var("OFM_PROBE_OUT") {
        let json = serde_json::to_string_pretty(&shares).expect("match shares serialize");
        std::fs::write(&out, json).expect("match shares written");
        println!("  → {out}");
    }
    assert!(shares.matches > 0, "the probe played no matches");
}

#[test]
#[ignore = "builds the real-world package and plays months of it; run explicitly"]
fn real_world_probe() {
    let Ok(package) = std::env::var("OFM_REAL_WORLD_PACKAGE") else {
        eprintln!("OFM_REAL_WORLD_PACKAGE is not set; nothing to probe.");
        return;
    };
    let first_seed = env_or("OFM_PROBE_SEED", 20_260_601_u64);
    let run_count = env_or("OFM_PROBE_RUNS", 3_u64).max(1);
    let days = env_or("OFM_PROBE_DAYS", 150_u32);

    let started = std::time::Instant::now();
    let seeds: Vec<u64> = (0..run_count).map(|i| first_seed + i).collect();
    let mut runs = Vec::new();
    let mut pooled = LeagueTotals::default();
    let mut last_game = None;
    for &seed in &seeds {
        let mut game = build_game(Path::new(&package), seed);
        let opening = game.clock.current_date.format("%Y-%m-%d").to_string();
        for _ in 0..days {
            ofm_core::turn::process_day(&mut game);
        }
        let totals = league_totals(&game, &opening);
        println!(
            "  run seed {seed}: {} matches · goals/game {:.3} · home/draw/away {:.1}/{:.1}/{:.1}",
            totals.matches,
            totals.goals_per_game(),
            totals.pct(totals.home_wins),
            totals.pct(totals.draws),
            totals.pct(totals.away_wins)
        );
        pooled.add(&totals);
        runs.push(totals);
        last_game = Some(game);
    }
    let game = last_game.expect("at least one run");

    let report = ProbeReport {
        seeds,
        days,
        club: game.manager.team_id.clone().unwrap_or_default(),
        active_competitions: game.active_competition_ids.len(),
        runs,
        league: pooled,
        mean_ovr_by_group: mean_ovr_by_group(&game),
        trait_counts: trait_counts(&game),
        shoots_from_distance_by_position: shoots_from_distance_by_position(&game),
    };
    let l = &report.league;
    println!(
        "real-world probe · {} runs · {} days from {} · club {} · {} competitions · {:.1}s",
        report.seeds.len(),
        report.days,
        OPENING_YEAR,
        report.club,
        report.active_competitions,
        started.elapsed().as_secs_f64()
    );
    println!(
        "  pooled: {} league matches · goals/game {:.3} ± {:.3} · home/draw/away {:.1}/{:.1}/{:.1} (± {:.1}) · subs/match {:.2}",
        l.matches,
        l.goals_per_game(),
        l.goals_per_game_se(),
        l.pct(l.home_wins),
        l.pct(l.draws),
        l.pct(l.away_wins),
        l.pct_se(l.draws),
        f64::from(l.substitutions) / f64::from(l.matches.max(1))
    );
    println!(
        "  mean OVR by group (last run): {:?}",
        report.mean_ovr_by_group
    );
    println!("  traits (last run): {:?}", report.trait_counts);
    println!(
        "  shoots from distance by natural position (players, %): {:?}",
        report.shoots_from_distance_by_position
    );
    if let Ok(out) = std::env::var("OFM_PROBE_OUT") {
        let json = serde_json::to_string_pretty(&report).expect("probe report serializes");
        std::fs::write(&out, json).expect("probe report written");
        println!("  → {out}");
    }
    assert!(l.matches > 0, "the probe played no league matches");
}
