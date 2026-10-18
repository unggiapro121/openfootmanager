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
//! home region instead of every competition, `OFM_PROBE_SCOPE=europe` to play the
//! European competitions and count only the 17 leagues of the football-data
//! reference table (phase 2, GĐ5 P5.0, X80; the club then defaults to the
//! first of the Premier League), `OFM_PROBE_OUT` for a JSON copy, `OFM_KNOBS`
//! for a calibration knob file (X82), `OFM_STRENGTH_BRIDGE` for the line
//! real results drew over the strength gap (`gd5-strength-bridge.json`, X81).
//!
//! Both probes end with GĐ5's verdict: their rows of `engine::targets`, PASS
//! or FAIL (GĐ5-tech-spec §11.2).

use std::collections::BTreeMap;
use std::path::Path;

use domain::league::{FixtureCompetition, FixtureStatus};
use domain::manager::Manager;
use engine::targets::{self, Band};
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
    /// Results by the gap in strength `S` between the two clubs at the start
    /// of the run (phase 2, GĐ5 P5.0, X81): buckets 0–2, 2–4, … 8–10, 10+.
    by_gap: [GapTotals; GAP_BUCKETS],
    /// Results by the shape each club ended the run in (phase 2, GĐ5 P5.1,
    /// X83, X88): the first look at formation balance on real players.
    by_formation: BTreeMap<String, FormationRecord>,
}

/// One shape's league results, from the side of the club playing it.
#[derive(Default, Clone, Copy, Serialize)]
struct FormationRecord {
    matches: u32,
    wins: u32,
    draws: u32,
    losses: u32,
    goals_for: u32,
    goals_against: u32,
    /// Points the real line expects over the same matches, from the gap in
    /// `S` and the venue (`OFM_STRENGTH_BRIDGE`); 0 without a bridge.
    expected_points: f64,
}

impl FormationRecord {
    fn add_result(&mut self, scored: u8, conceded: u8, expected_points: f64) {
        self.matches += 1;
        self.goals_for += u32::from(scored);
        self.goals_against += u32::from(conceded);
        self.expected_points += expected_points;
        match scored.cmp(&conceded) {
            std::cmp::Ordering::Greater => self.wins += 1,
            std::cmp::Ordering::Equal => self.draws += 1,
            std::cmp::Ordering::Less => self.losses += 1,
        }
    }

    fn merge(&mut self, other: &FormationRecord) {
        self.matches += other.matches;
        self.wins += other.wins;
        self.draws += other.draws;
        self.losses += other.losses;
        self.goals_for += other.goals_for;
        self.goals_against += other.goals_against;
        self.expected_points += other.expected_points;
    }

    fn points(&self) -> f64 {
        f64::from(3 * self.wins + self.draws)
    }

    fn pct(&self, n: u32) -> f64 {
        f64::from(n) / f64::from(self.matches.max(1)) * 100.0
    }
}

/// How many 2-point buckets of strength gap the probe reports; the last is
/// everything from 10 up.
const GAP_BUCKETS: usize = 6;

/// Results in one bucket of strength gap, from the stronger club's side.
#[derive(Default, Clone, Copy, Serialize)]
struct GapTotals {
    matches: u32,
    strong_wins: u32,
    draws: u32,
    strong_losses: u32,
    /// Of those, the matches the stronger club played at home.
    strong_at_home: u32,
    /// The stronger club's wins the real line expects over the same matches,
    /// home and gap as played (`OFM_STRENGTH_BRIDGE`).
    expected_strong_wins: f64,
}

impl GapTotals {
    fn pct(&self, n: u32) -> f64 {
        f64::from(n) / f64::from(self.matches.max(1)) * 100.0
    }
}

/// The real line over the strength gap: the ordered probit
/// `gd5-strength-bridge.py` fits to the 2024-25 results by `S`
/// (`fit_on_results`). Results rather than the closing odds (`fit_on_market`)
/// because `S` is built after that season and so reads 3–4 points steeper
/// than the market did (GĐ5 P5.0, Đ6).
#[derive(Clone, Copy)]
struct StrengthBridge {
    beta: f64,
    eta: f64,
    c: f64,
}

impl StrengthBridge {
    fn from_env() -> Option<Self> {
        let path = std::env::var("OFM_STRENGTH_BRIDGE").ok()?;
        let json: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&path).expect("OFM_STRENGTH_BRIDGE names a readable file"),
        )
        .expect("a JSON strength bridge");
        let fit = &json["fit_on_results"];
        let read = |key: &str| {
            fit[key]
                .as_f64()
                .expect("the bridge carries beta, eta and c")
        };
        Some(Self {
            beta: read("beta"),
            eta: read("eta"),
            c: read("c"),
        })
    }

    /// The chance that the stronger club wins, `gap` points of `S` ahead, at
    /// home or away.
    /// Home win, draw and away win the real line expects at a strength gap
    /// of `home_minus_away`, home advantage included.
    fn outcome(&self, home_minus_away: f64) -> (f64, f64, f64) {
        let latent = self.beta * home_minus_away + self.eta;
        let home = 1.0 - normal_cdf(self.c - latent);
        let away = normal_cdf(-self.c - latent);
        (home, 1.0 - home - away, away)
    }

    fn strong_win(&self, gap: f64, at_home: bool) -> f64 {
        if at_home {
            1.0 - normal_cdf(self.c - (self.beta * gap + self.eta))
        } else {
            normal_cdf(-self.c - (-self.beta * gap + self.eta))
        }
    }
}

/// Φ, the standard normal distribution, through erf (Abramowitz and Stegun
/// 7.1.26, error below 1.5e-7).
fn normal_cdf(x: f64) -> f64 {
    let z = x.abs() / std::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.327_591_1 * z);
    let poly = t
        * (0.254_829_592
            + t * (-0.284_496_736
                + t * (1.421_413_741 + t * (-1.453_152_027 + t * 1.061_405_429))));
    let erf = 1.0 - poly * (-z * z).exp();
    0.5 * (1.0 + erf.copysign(x))
}

/// One row of GĐ5's verdict (GĐ5-tech-spec §5): a target, what the probe
/// measured and whether it lands in the band of `engine::targets`.
struct Gd5Row {
    target: &'static str,
    name: String,
    value: f64,
    band: String,
    pass: bool,
}

impl Gd5Row {
    fn banded(target: &'static str, name: &str, value: f64, band: Band) -> Self {
        Self {
            target,
            name: name.to_string(),
            value,
            band: band.to_string(),
            pass: band.contains(value),
        }
    }
}

/// Print GĐ5's verdict: each row PASS or FAIL, then the whole.
fn gd5_verdict(rows: &[Gd5Row]) {
    println!("  GĐ5 verdict (engine::targets):");
    for row in rows {
        println!(
            "    {:<4} {:<4} {:<52} {:>8.3}   {}",
            if row.pass { "PASS" } else { "FAIL" },
            row.target,
            row.name,
            row.value,
            row.band
        );
    }
    let failed = rows.iter().filter(|row| !row.pass).count();
    println!(
        "    → {}",
        if failed == 0 {
            "PASS".to_string()
        } else {
            format!("FAIL ({failed} of {})", rows.len())
        }
    );
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
        for (mine, theirs) in self.by_gap.iter_mut().zip(other.by_gap.iter()) {
            mine.matches += theirs.matches;
            mine.strong_wins += theirs.strong_wins;
            mine.draws += theirs.draws;
            mine.strong_losses += theirs.strong_losses;
            mine.strong_at_home += theirs.strong_at_home;
            mine.expected_strong_wins += theirs.expected_strong_wins;
        }
        for (formation, record) in &other.by_formation {
            self.by_formation
                .entry(formation.clone())
                .or_default()
                .merge(record);
        }
    }
}

/// Every club's strength `S` in `game` (phase 2, GĐ5 P5.0, X81).
fn strengths(game: &Game) -> std::collections::HashMap<String, f64> {
    game.teams
        .iter()
        .filter_map(|team| {
            ofm_core::team_strength::club_strength(game, &team.id)
                .map(|s| (team.id.clone(), s.strength))
        })
        .collect()
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
    /// The league clubs' formations at the end of the last run, % (T21).
    formations: BTreeMap<String, f64>,
    /// League clubs whose shape at the end of the last run is not the one
    /// they opened in (phase 2, GĐ5 P5.1: the weekly review's hysteresis).
    formation_changes: u32,
    /// Emergency squad top-ups per season, pooled over the runs (X83
    /// condition 1: a shape drives what a club thinks it is short of).
    top_ups_per_season: f64,
    /// The league clubs' squads at the end of the last run (X83 condition 1).
    squad_shape: SquadShape,
}

/// How the league clubs' squads are made up, by the engine's position group.
#[derive(Default, Serialize)]
struct SquadShape {
    clubs: u32,
    /// Mean players per club in each group, injured included.
    mean_by_group: BTreeMap<String, f64>,
    /// Clubs with fewer fit players in a group than their shape has slots for.
    short_clubs: u32,
}

/// The leagues of the football-data 2024-25 reference table (P0.5,
/// `fm-document/comon/sim-bench/reference/`) the package has: all of its 18
/// but Greece's.
const REFERENCE_LEAGUES: [&str; 17] = [
    "eng-premier-league",
    "eng-championship",
    "eng-league-one",
    "eng-league-two",
    "sco-premiership",
    "ger-bundesliga",
    "ger-2-bundesliga",
    "ita-serie-a",
    "ita-serie-b",
    "esp-la-liga",
    "esp-la-liga-2",
    "fra-ligue-1",
    "fra-ligue-2",
    "nld-eredivisie",
    "bel-pro-league",
    "por-liga-portugal",
    "tur-super-lig",
];

/// The countries of the reference leagues: a European probe plays their
/// leagues and cups, and the European competitions.
const EUROPE_COUNTRIES: [&str; 10] = ["ENG", "SCO", "DE", "IT", "ES", "FR", "NL", "BE", "PT", "TR"];

fn europe_scope() -> bool {
    std::env::var("OFM_PROBE_SCOPE").as_deref() == Ok("europe")
}

/// Calibration knobs from `OFM_KNOBS`, for every match this process plays
/// (phase 2, GĐ5 P5.0, X82). The game never reads the variable.
fn apply_knobs_from_env() {
    if let Ok(path) = std::env::var("OFM_KNOBS") {
        let json = std::fs::read_to_string(&path).expect("OFM_KNOBS names a readable file");
        let mut config = engine::MatchConfig::default();
        engine::apply_knob_file(&mut config, &json).expect("a valid knob file");
        ofm_core::live_match_manager::set_probe_match_config(Some(config));
        println!("  knobs from {path}");
    }
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

    let premier_league_club = || {
        game.competitions
            .iter()
            .find(|c| c.id == REFERENCE_LEAGUES[0])
            .and_then(|c| c.participant_ids.first().cloned())
    };
    let club = std::env::var("OFM_PROBE_CLUB")
        .ok()
        .filter(|id| game.teams.iter().any(|team| &team.id == id))
        .or_else(|| europe_scope().then(premier_league_club).flatten())
        .unwrap_or_else(|| game.teams[0].id.clone());
    let competitions = match std::env::var("OFM_PROBE_SCOPE").as_deref() {
        Ok("home") => None,
        Ok("europe") => Some(
            game.competitions
                .iter()
                .filter(|c| {
                    c.country_id
                        .as_deref()
                        .is_some_and(|country| EUROPE_COUNTRIES.contains(&country))
                        || c.region_id.as_deref() == Some("europe")
                })
                .map(|c| c.id.clone())
                .collect(),
        ),
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
fn league_totals(
    game: &Game,
    since: &str,
    strength: &std::collections::HashMap<String, f64>,
    bridge: Option<StrengthBridge>,
) -> LeagueTotals {
    let mut totals = LeagueTotals::default();
    let europe = europe_scope();
    let formation_of: std::collections::HashMap<&str, &str> = game
        .teams
        .iter()
        .map(|team| (team.id.as_str(), team.formation.as_str()))
        .collect();
    let fixtures = game
        .competitions
        .iter()
        .filter(|competition| !europe || REFERENCE_LEAGUES.contains(&competition.id.as_str()))
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
        let expected = match (
            bridge,
            strength.get(&fixture.home_team_id),
            strength.get(&fixture.away_team_id),
        ) {
            (Some(bridge), Some(home), Some(away)) => bridge.outcome(home - away),
            _ => (0.0, 0.0, 0.0),
        };
        for (team_id, scored, conceded, points) in [
            (
                &fixture.home_team_id,
                result.home_goals,
                result.away_goals,
                3.0 * expected.0 + expected.1,
            ),
            (
                &fixture.away_team_id,
                result.away_goals,
                result.home_goals,
                3.0 * expected.2 + expected.1,
            ),
        ] {
            if let Some(formation) = formation_of.get(team_id.as_str()) {
                totals
                    .by_formation
                    .entry((*formation).to_string())
                    .or_default()
                    .add_result(scored, conceded, points);
            }
        }
        totals.matches += 1;
        totals.goals += goals;
        totals.goals_squared += u64::from(goals * goals);
        if let (Some(home), Some(away)) = (
            strength.get(&fixture.home_team_id),
            strength.get(&fixture.away_team_id),
        ) {
            let bucket = (((home - away).abs() / 2.0) as usize).min(GAP_BUCKETS - 1);
            let gap = &mut totals.by_gap[bucket];
            let strong_home = home >= away;
            let (strong, weak) = if strong_home {
                (result.home_goals, result.away_goals)
            } else {
                (result.away_goals, result.home_goals)
            };
            gap.matches += 1;
            gap.strong_at_home += u32::from(strong_home);
            if let Some(bridge) = bridge {
                gap.expected_strong_wins += bridge.strong_win((home - away).abs(), strong_home);
            }
            match strong.cmp(&weak) {
                std::cmp::Ordering::Greater => gap.strong_wins += 1,
                std::cmp::Ordering::Equal => gap.draws += 1,
                std::cmp::Ordering::Less => gap.strong_losses += 1,
            }
        }
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

/// League results by shape, pooled: W/D/L, goals and, with a bridge, points
/// per game against what the gap in `S` predicts (phase 2, GĐ5 P5.1, X88).
fn print_formation_results(by_formation: &BTreeMap<String, FormationRecord>, bridged: bool) {
    println!("  by formation (club's side; points per game, and the S line's expectation):");
    for (formation, record) in by_formation {
        let games = f64::from(record.matches.max(1));
        let expected = if bridged {
            format!(
                " · expected {:.2} · residual {:+.2}",
                record.expected_points / games,
                (record.points() - record.expected_points) / games
            )
        } else {
            String::new()
        };
        println!(
            "    {:>7}: {:>5} matches · {:.1}/{:.1}/{:.1} · {:.2}–{:.2} · ppg {:.2}{expected}",
            formation,
            record.matches,
            record.pct(record.wins),
            record.pct(record.draws),
            record.pct(record.losses),
            f64::from(record.goals_for) / games,
            f64::from(record.goals_against) / games,
            record.points() / games
        );
    }
}

/// The clubs of the reference leagues (all leagues outside the European
/// scope).
fn league_club_ids(game: &Game) -> Vec<&String> {
    let europe = europe_scope();
    game.competitions
        .iter()
        .filter(|c| {
            c.kind == domain::league::CompetitionType::League
                && (!europe || REFERENCE_LEAGUES.contains(&c.id.as_str()))
        })
        .flat_map(|c| c.participant_ids.iter())
        .collect()
}

/// League clubs whose shape now differs from `opening` (club id → shape).
fn formation_changes(game: &Game, opening: &std::collections::HashMap<String, String>) -> u32 {
    league_club_ids(game)
        .into_iter()
        .filter_map(|id| game.teams.iter().find(|team| &team.id == id))
        .filter(|team| opening.get(&team.id) != Some(&team.formation))
        .count() as u32
}

/// The league clubs' squads by position group, and how many cannot fill
/// their shape's slots in some group with fit players.
fn squad_shape(game: &Game) -> SquadShape {
    use domain::player::Position;
    let mut shape = SquadShape::default();
    let mut totals: BTreeMap<String, u32> = BTreeMap::new();
    for id in league_club_ids(game) {
        let Some(team) = game.teams.iter().find(|team| &team.id == id) else {
            continue;
        };
        shape.clubs += 1;
        let mut fit: BTreeMap<String, u32> = BTreeMap::new();
        for player in game
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some(id.as_str()))
        {
            let group = format!("{:?}", player.position.to_group_position());
            *totals.entry(group.clone()).or_default() += 1;
            if player.injury.is_none() {
                *fit.entry(group).or_default() += 1;
            }
        }
        let mut needed: BTreeMap<String, u32> = BTreeMap::new();
        for slot in ofm_core::player_rating::formation_slots(&team.formation) {
            let group: Position = slot.to_group_position();
            *needed.entry(format!("{group:?}")).or_default() += 1;
        }
        if needed
            .iter()
            .any(|(group, slots)| fit.get(group).copied().unwrap_or(0) < *slots)
        {
            shape.short_clubs += 1;
        }
    }
    let clubs = f64::from(shape.clubs.max(1));
    shape.mean_by_group = totals
        .into_iter()
        .map(|(group, n)| (group, f64::from(n) / clubs))
        .collect();
    shape
}

/// The formations the clubs of the reference leagues (all leagues outside the
/// European scope) line up in, % of clubs (T21, X83).
fn formation_shares(game: &Game) -> BTreeMap<String, f64> {
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    for id in league_club_ids(game) {
        if let Some(team) = game.teams.iter().find(|team| &team.id == id) {
            *counts.entry(team.formation.clone()).or_default() += 1;
        }
    }
    let total = f64::from(counts.values().sum::<u32>().max(1));
    counts
        .into_iter()
        .map(|(formation, n)| (formation, f64::from(n) / total * 100.0))
        .collect()
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

/// Given the standard normal distribution,
/// when it is read at 0 and ±1.96,
/// then it gives a half and the two-sided 95% points.
#[test]
fn the_normal_distribution_matches_its_table() {
    assert!((normal_cdf(0.0) - 0.5).abs() < 1e-7);
    assert!((normal_cdf(1.96) - 0.975).abs() < 1e-4);
    assert!((normal_cdf(-1.96) - 0.025).abs() < 1e-4);
}

/// Given a strength line (the one fitted on the 2024-25 market),
/// when the stronger club's chance is read across gaps, at home and away,
/// then it rises with the gap, home is worth more than away, and at gap 0
/// the two are the home and away sides' chances of one even match.
#[test]
fn the_strength_line_rises_with_the_gap_and_favours_home() {
    let bridge = StrengthBridge {
        beta: 0.0858,
        eta: 0.1938,
        c: 0.3559,
    };
    assert!(bridge.strong_win(6.0, true) > bridge.strong_win(2.0, true));
    assert!(bridge.strong_win(6.0, false) > bridge.strong_win(2.0, false));
    assert!(bridge.strong_win(4.0, true) > bridge.strong_win(4.0, false));
    // gd5-strength-bridge.py prints 43.6 and 29.1 at gap 0.
    assert!((bridge.strong_win(0.0, true) - 0.436).abs() < 0.001);
    assert!((bridge.strong_win(0.0, false) - 0.291).abs() < 0.001);
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
    /// Phase 2, GĐ4 (P4.0): build-ups from the own third, those that reached
    /// midfield, those lost there and the shots and goals that followed, and
    /// midfield duels with the ones the side on the ball won.
    build_ups: u64,
    build_ups_completed: u64,
    high_turnovers: u64,
    high_turnover_shots: u64,
    high_turnover_goals: u64,
    midfield_duels: u64,
    midfield_attack_won: u64,
    /// Phase 2, P4.2: long balls out of the own third, and those over the
    /// midfield.
    long_balls: u64,
    long_balls_over: u64,
    /// Phase 2, GĐ5 (P5.0): every goal by its source, and the spread of a
    /// side's possession: the sum of squared distances from 50 over every
    /// side of every match (T16).
    goal_sources: BTreeMap<String, u64>,
    possession_squares: f64,
}

/// Who scores, who sets them up and how players rate, by natural position
/// (phase 2, P3.9: GĐ3 moved the finishing around, so the stats the game shows
/// about players moved with it).
#[derive(Default, Serialize)]
struct PlayerShares {
    /// Goals (penalties included) and assists by the scorer's or provider's
    /// natural position group.
    goals_by_group: BTreeMap<String, u32>,
    assists_by_group: BTreeMap<String, u32>,
    /// Sum and count of match ratings by natural position, for players who
    /// played 45 minutes or more.
    rating_sum: BTreeMap<String, f64>,
    rating_count: BTreeMap<String, u32>,
    /// The most goals any one player scored in each run's league season.
    top_scorer_goals: Vec<u32>,
}

impl PlayerShares {
    fn add(
        &mut self,
        game: &Game,
        report: &engine::MatchReport,
        season: &mut BTreeMap<String, u32>,
    ) {
        let position = |id: &str| {
            game.players
                .iter()
                .find(|p| p.id == id)
                .map(|p| p.natural_position.clone())
        };
        let group = |id: &str| {
            position(id).map_or_else(
                || "?".to_string(),
                |p| format!("{:?}", p.to_group_position()),
            )
        };
        for goal in &report.goals {
            *self
                .goals_by_group
                .entry(group(&goal.scorer_id))
                .or_default() += 1;
            *season.entry(goal.scorer_id.clone()).or_default() += 1;
            if let Some(assist) = &goal.assist_id {
                *self.assists_by_group.entry(group(assist)).or_default() += 1;
            }
        }
        for (id, stats) in &report.player_stats {
            if stats.minutes_played < 45 {
                continue;
            }
            if let Some(p) = position(id) {
                let key = format!("{p:?}");
                *self.rating_sum.entry(key.clone()).or_default() += f64::from(stats.rating);
                *self.rating_count.entry(key).or_default() += 1;
            }
        }
    }

    /// The widest gap between two natural positions' mean match rating, over
    /// positions with at least 100 ratings (T19).
    fn rating_spread(&self) -> f64 {
        let means: Vec<f64> = self
            .rating_sum
            .iter()
            .filter_map(|(k, sum)| {
                let n = self.rating_count.get(k).copied().unwrap_or(0);
                (n >= 100).then(|| sum / f64::from(n))
            })
            .collect();
        let high = means.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let low = means.iter().copied().fold(f64::INFINITY, f64::min);
        if means.is_empty() {
            0.0
        } else {
            high - low
        }
    }

    fn top_scorer_mean(&self) -> f64 {
        let n = self.top_scorer_goals.len().max(1) as f64;
        f64::from(self.top_scorer_goals.iter().sum::<u32>()) / n
    }

    fn print(&self) {
        let share = |map: &BTreeMap<String, u32>| {
            let total: u32 = map.values().sum();
            map.iter()
                .map(|(k, v)| {
                    format!(
                        "{k} {:.1}%",
                        f64::from(*v) / f64::from(total.max(1)) * 100.0
                    )
                })
                .collect::<Vec<_>>()
                .join(" · ")
        };
        println!("  goals by natural group: {}", share(&self.goals_by_group));
        println!(
            "  assists by natural group: {}",
            share(&self.assists_by_group)
        );
        let ratings = self
            .rating_sum
            .iter()
            .map(|(k, sum)| {
                let n = self.rating_count.get(k).copied().unwrap_or(1).max(1);
                format!("{k} {:.2}", sum / f64::from(n))
            })
            .collect::<Vec<_>>()
            .join(" · ");
        println!("  mean match rating (45+ min) by natural position: {ratings}");
        println!(
            "  top scorer's goals per league season: {:?}",
            self.top_scorer_goals
        );
    }
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
        self.build_ups += tally.build_ups;
        self.build_ups_completed += tally.build_ups_completed;
        self.high_turnovers += tally.high_turnovers;
        self.high_turnover_shots += tally.high_turnover_shots;
        self.high_turnover_goals += tally.high_turnover_goals;
        self.midfield_duels += tally.midfield_duels;
        self.midfield_attack_won += tally.midfield_attack_won;
        self.long_balls += tally.long_balls;
        self.long_balls_over += tally.long_balls_over;
        self.headed_goals += report
            .events
            .iter()
            .filter(|event| {
                event.event_type == engine::EventType::Goal
                    && event.shot_kind == Some(engine::ShotKind::Header)
            })
            .count() as u64;
        for goal in &report.goals {
            *self
                .goal_sources
                .entry(format!("{:?}", goal.goal_source))
                .or_default() += 1;
        }
        // Both sides sit the same distance from 50.
        self.possession_squares += 2.0 * (report.home_possession - 50.0).powi(2);
    }

    /// The standard deviation of a side's possession across matches, in
    /// points (T16).
    fn possession_sd(&self) -> f64 {
        (self.possession_squares / f64::from(self.matches.max(1) * 2)).sqrt()
    }

    fn goal_source_pct(&self, source: engine::GoalSource) -> f64 {
        let n = self
            .goal_sources
            .get(&format!("{source:?}"))
            .copied()
            .unwrap_or(0);
        Self::pct(n, u64::from(self.goals))
    }

    fn per_match(&self, count: u64) -> f64 {
        count as f64 / f64::from(self.matches.max(1))
    }

    fn pct(part: u64, whole: u64) -> f64 {
        part as f64 / whole.max(1) as f64 * 100.0
    }
}

/// The match probe's rows of GĐ5's verdict: T8–T14, T16, T19, T20.
fn match_verdict(shares: &MatchShares, players: &PlayerShares) -> Vec<Gd5Row> {
    let goals = u64::from(shares.goals);
    let outside_box = MatchShares::pct(
        shares.long_shot_goals + shares.direct_free_kick_goals,
        goals,
    );
    vec![
        Gd5Row::banded(
            "T8",
            "headed goals, corners included (% of goals)",
            MatchShares::pct(shares.headed_goals, goals),
            targets::HEADED_GOALS,
        ),
        Gd5Row::banded(
            "T9b",
            "goals from outside the box with DFK (% of goals)",
            outside_box,
            targets::OUTSIDE_BOX_GOALS,
        ),
        Gd5Row::banded(
            "T9c",
            "long shots scored (%)",
            MatchShares::pct(shares.long_shot_goals, shares.long_shots),
            targets::LONG_SHOT_CONVERSION,
        ),
        Gd5Row::banded(
            "T9d",
            "long shots (% of shots)",
            MatchShares::pct(shares.long_shots, shares.shots),
            targets::LONG_SHOT_SHARE,
        ),
        Gd5Row::banded(
            "T10",
            "direct free-kick goals (% of goals)",
            shares.goal_source_pct(engine::GoalSource::DirectFreeKick),
            targets::DIRECT_FREE_KICK_GOALS,
        ),
        Gd5Row::banded(
            "T11",
            "corners/game",
            shares.per_match(shares.corners),
            targets::CORNERS_PER_GAME,
        ),
        Gd5Row::banded(
            "T12",
            "defender aerial win (%)",
            MatchShares::pct(shares.aerial_lost, shares.aerial_won + shares.aerial_lost),
            targets::DEFENDER_AERIAL_WIN,
        ),
        Gd5Row::banded(
            "T13",
            "shots/game",
            shares.per_match(shares.shots),
            targets::SHOTS_PER_GAME,
        ),
        Gd5Row::banded(
            "T14",
            "shots per ball lost in the own third",
            shares.high_turnover_shots as f64 / shares.high_turnovers.max(1) as f64,
            targets::SHOTS_PER_HIGH_TURNOVER,
        ),
        Gd5Row::banded(
            "T16",
            "possession standard deviation (points)",
            shares.possession_sd(),
            targets::POSSESSION_SD,
        ),
        Gd5Row::banded(
            "T19",
            "match rating spread by natural position",
            players.rating_spread(),
            targets::RATING_SPREAD,
        ),
        Gd5Row::banded(
            "T20",
            "top scorer's goals a season (mean)",
            players.top_scorer_mean(),
            targets::TOP_SCORER_GOALS,
        ),
    ]
}

/// Given the real-world package,
/// when every scheduled league fixture (friendlies left out) of the probe club's league is played once in
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
    apply_knobs_from_env();
    let first_seed = env_or("OFM_PROBE_SEED", 20_260_601_u64);
    // A world's league season takes seconds, so this one plays more of them.
    let run_count = env_or("OFM_MATCH_PROBE_RUNS", 10_u64).max(1);
    let started = std::time::Instant::now();
    let mut shares = MatchShares::default();
    let mut players = PlayerShares::default();
    for seed in first_seed..first_seed + run_count {
        let game = build_game(Path::new(&package), seed);
        if seed == first_seed {
            if let Some(league) = &game.league {
                println!(
                    "  league {} · {} clubs · {} league fixtures",
                    league.id,
                    league.participant_ids.len(),
                    league
                        .fixtures
                        .iter()
                        .filter(|f| f.competition == FixtureCompetition::League)
                        .count()
                );
            }
        }
        let mut season: BTreeMap<String, u32> = BTreeMap::new();
        let fixture_count = game
            .league
            .as_ref()
            .map_or(0, |league| league.fixtures.len());
        for index in 0..fixture_count {
            // The league's list also holds the pre-season friendlies.
            let is_league_match = game.league.as_ref().is_some_and(|league| {
                league.fixtures[index].competition == FixtureCompetition::League
            });
            if !is_league_match {
                continue;
            }
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
            let report = session.match_state.into_report();
            players.add(&game, &report, &mut season);
            shares.add(&report);
        }
        players
            .top_scorer_goals
            .push(season.values().copied().max().unwrap_or(0));
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
    println!(
        "  build-ups/side/game {:.1} ({:.1}% long, {:.1}% of those over the midfield) · short ones reached midfield {:.1}% · lost in the own third/game {:.2} ({:.3} shots, {:.3} goals each) · midfield duels/game {:.1}, won by the side on the ball {:.1}%",
        shares.per_match(shares.build_ups + shares.long_balls) / 2.0,
        MatchShares::pct(shares.long_balls, shares.build_ups + shares.long_balls),
        MatchShares::pct(shares.long_balls_over, shares.long_balls),
        MatchShares::pct(shares.build_ups_completed, shares.build_ups),
        shares.per_match(shares.high_turnovers),
        shares.high_turnover_shots as f64 / shares.high_turnovers.max(1) as f64,
        shares.high_turnover_goals as f64 / shares.high_turnovers.max(1) as f64,
        shares.per_match(shares.midfield_duels),
        MatchShares::pct(shares.midfield_attack_won, shares.midfield_duels)
    );
    let sources: BTreeMap<String, f64> = shares
        .goal_sources
        .iter()
        .map(|(k, n)| (k.clone(), MatchShares::pct(*n, u64::from(shares.goals))))
        .collect();
    println!("  goal sources: {}", shares_line(&sources));
    println!(
        "  possession: a side's standard deviation {:.1} points",
        shares.possession_sd()
    );
    players.print();
    gd5_verdict(&match_verdict(&shares, &players));
    if let Ok(out) = std::env::var("OFM_PROBE_OUT") {
        let json = serde_json::to_string_pretty(&shares).expect("match shares serialize");
        std::fs::write(&out, json).expect("match shares written");
        println!("  → {out}");
    }
    assert!(shares.matches > 0, "the probe played no matches");
}

fn gap_label(bucket: usize) -> String {
    if bucket + 1 == GAP_BUCKETS {
        format!("{}+", bucket * 2)
    } else {
        format!("{}–{}", bucket * 2, bucket * 2 + 2)
    }
}

fn shares_line(shares: &BTreeMap<String, f64>) -> String {
    let mut sorted: Vec<_> = shares.iter().collect();
    sorted.sort_by(|a, b| b.1.total_cmp(a.1));
    sorted
        .iter()
        .map(|(k, v)| format!("{k} {v:.1}%"))
        .collect::<Vec<_>>()
        .join(" · ")
}

/// The league probe's rows of GĐ5's verdict: T1–T3, T5 (one row per bucket
/// of strength gap 0–10, when a bridge is given) and T21.
fn league_verdict(
    l: &LeagueTotals,
    bridge: Option<StrengthBridge>,
    formations: &BTreeMap<String, f64>,
) -> Vec<Gd5Row> {
    let mut rows = vec![
        Gd5Row::banded(
            "T1",
            "goals/game",
            l.goals_per_game(),
            targets::GOALS_PER_GAME,
        ),
        Gd5Row::banded(
            "T2",
            "home − away wins (points)",
            l.pct(l.home_wins) - l.pct(l.away_wins),
            targets::HOME_EDGE,
        ),
        Gd5Row::banded("T3", "draws (%)", l.pct(l.draws), targets::DRAWS),
    ];
    if bridge.is_some() {
        let tolerance = targets::STRENGTH_GAP_TOLERANCE;
        for (bucket, gap) in l.by_gap.iter().enumerate().take(GAP_BUCKETS - 1) {
            let real = gap.expected_strong_wins / f64::from(gap.matches.max(1)) * 100.0;
            let off = gap.pct(gap.strong_wins) - real;
            rows.push(Gd5Row {
                target: "T5",
                name: format!(
                    "gap S {}: stronger wins − real line (points)",
                    gap_label(bucket)
                ),
                value: off,
                band: format!("±{tolerance} (real {real:.1})"),
                pass: off.abs() <= tolerance,
            });
        }
    }
    let largest = formations.values().copied().fold(0.0, f64::max);
    rows.push(Gd5Row {
        target: "T21",
        name: "largest formation share (%)".to_string(),
        value: largest,
        band: format!(
            "≤ {}, ≥ {} formations (now {})",
            targets::FORMATION_SHARE_MAX,
            targets::FORMATIONS_IN_USE_MIN,
            formations.len()
        ),
        pass: largest <= targets::FORMATION_SHARE_MAX
            && formations.len() >= targets::FORMATIONS_IN_USE_MIN,
    });
    rows
}

#[test]
#[ignore = "builds the real-world package and plays months of it; run explicitly"]
fn real_world_probe() {
    let Ok(package) = std::env::var("OFM_REAL_WORLD_PACKAGE") else {
        eprintln!("OFM_REAL_WORLD_PACKAGE is not set; nothing to probe.");
        return;
    };
    apply_knobs_from_env();
    let first_seed = env_or("OFM_PROBE_SEED", 20_260_601_u64);
    let run_count = env_or("OFM_PROBE_RUNS", 3_u64).max(1);
    let days = env_or("OFM_PROBE_DAYS", 150_u32);

    let bridge = StrengthBridge::from_env();
    let started = std::time::Instant::now();
    let seeds: Vec<u64> = (0..run_count).map(|i| first_seed + i).collect();
    let mut runs = Vec::new();
    let mut pooled = LeagueTotals::default();
    let mut last_game = None;
    let mut top_ups = 0usize;
    let mut opening_formations = std::collections::HashMap::new();
    for &seed in &seeds {
        let mut game = build_game(Path::new(&package), seed);
        let opening = game.clock.current_date.format("%Y-%m-%d").to_string();
        let opening_strength = strengths(&game);
        opening_formations = game
            .teams
            .iter()
            .map(|team| (team.id.clone(), team.formation.clone()))
            .collect();
        for _ in 0..days {
            ofm_core::turn::process_day(&mut game);
        }
        top_ups += game.squad_floor_top_ups.len();
        let totals = league_totals(&game, &opening, &opening_strength, bridge);
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
        formations: formation_shares(&game),
        formation_changes: formation_changes(&game, &opening_formations),
        top_ups_per_season: top_ups as f64
            / run_count.max(1) as f64
            / (f64::from(days) / 365.0).max(f64::EPSILON),
        squad_shape: squad_shape(&game),
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
        "  by strength gap S (stronger club's win/draw/loss %, share of those at home, the real line's win %):"
    );
    for (bucket, gap) in l.by_gap.iter().enumerate() {
        let line = if bridge.is_some() {
            format!(
                " · real line {:.1}",
                gap.expected_strong_wins / f64::from(gap.matches.max(1)) * 100.0
            )
        } else {
            String::new()
        };
        println!(
            "    {:>6}: {:>5} matches · {:.1}/{:.1}/{:.1} · {:.0}% at home{line}",
            gap_label(bucket),
            gap.matches,
            gap.pct(gap.strong_wins),
            gap.pct(gap.draws),
            gap.pct(gap.strong_losses),
            gap.pct(gap.strong_at_home)
        );
    }
    println!(
        "  formations (league clubs, last run): {} · {} clubs changed shape during the run",
        shares_line(&report.formations),
        report.formation_changes
    );
    print_formation_results(&l.by_formation, bridge.is_some());
    println!(
        "  squads (league clubs, last run): {} clubs · per club {:?} · {} short of fit players for their shape · emergency top-ups/season {:.1}",
        report.squad_shape.clubs,
        report
            .squad_shape
            .mean_by_group
            .iter()
            .map(|(group, n)| format!("{group} {n:.1}"))
            .collect::<Vec<_>>(),
        report.squad_shape.short_clubs,
        report.top_ups_per_season
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
    gd5_verdict(&league_verdict(l, bridge, &report.formations));
    if let Ok(out) = std::env::var("OFM_PROBE_OUT") {
        let json = serde_json::to_string_pretty(&report).expect("probe report serializes");
        std::fs::write(&out, json).expect("probe report written");
        println!("  → {out}");
    }
    assert!(l.matches > 0, "the probe played no league matches");
}

/// Every club's strength `S` (phase 2, GĐ5 P5.0, X81) with its league, as JSON
/// to `OFM_PROBE_OUT`, for `gd5-strength-bridge.py` to match against the
/// betting market. The world is built as the probes build it; formations are
/// the clubs' own.
#[test]
#[ignore = "builds the real-world package; run explicitly with OFM_REAL_WORLD_PACKAGE"]
fn real_world_strengths() {
    let Ok(package) = std::env::var("OFM_REAL_WORLD_PACKAGE") else {
        eprintln!("OFM_REAL_WORLD_PACKAGE is not set; nothing to export.");
        return;
    };
    let game = build_game(
        Path::new(&package),
        env_or("OFM_PROBE_SEED", 20_260_601_u64),
    );
    let rows: Vec<serde_json::Value> = game
        .teams
        .iter()
        .filter_map(|team| {
            let s = ofm_core::team_strength::club_strength(&game, &team.id)?;
            let league = game
                .competitions
                .iter()
                .find(|c| {
                    c.kind == domain::league::CompetitionType::League
                        && c.participant_ids.contains(&team.id)
                })
                .map(|c| c.id.clone());
            Some(serde_json::json!({
                "team_id": team.id,
                "name": team.name,
                "league": league,
                "formation": team.formation,
                "xi": s.xi,
                "bench": s.bench,
                "strength": s.strength,
            }))
        })
        .collect();
    println!("  {} clubs with a strength", rows.len());
    if let Ok(out) = std::env::var("OFM_PROBE_OUT") {
        std::fs::write(
            &out,
            serde_json::to_string_pretty(&rows).expect("rows serialize"),
        )
        .expect("strengths written");
        println!("  → {out}");
    }
}
