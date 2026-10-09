//! What a scout's judgement is worth against the season's youth pool, which the
//! AI clubs are signing from at the same time.
//!
//! Run it explicitly — it plays many seeded worlds:
//!
//! ```text
//! cargo test -p ofm_core --test youth_scouting_probe --release -- --ignored --nocapture
//! ```
//!
//! Every youngster in the pool is ranked by true potential within his nation's
//! cohort as the pool was drawn. A recommendation's rank is the share of that
//! cohort with more potential than him: 0% is the cohort's best. The pool is
//! the same for every scout, so a better rank is the scout choosing better, or
//! choosing earlier, not better youngsters existing.

use chrono::{TimeZone, Utc};
use domain::manager::Manager;
use domain::staff::{Staff, StaffAttributes, StaffRole};
use ofm_core::clock::GameClock;
use ofm_core::game::{Game, YouthScoutingObjective, YouthScoutingRegion};
use ofm_core::generator::{
    DefinitionSources, WorldGenConfig, generate_world_data_seeded_with,
    repair_opening_youth_academies,
};
use ofm_core::scouting::start_youth_scouting;
use ofm_core::turn;
use std::collections::HashMap;

fn worlds() -> u64 {
    std::env::var("OFM_PROBE_WORLDS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(12)
}

/// Searches per world for each scout and moment, each its own draw.
const SEARCHES: usize = 4;

/// A seeded compact world with a league, opened as a career opens.
fn seeded_world(seed: u64) -> Game {
    let world = generate_world_data_seeded_with(
        seed,
        &WorldGenConfig::compact(),
        &DefinitionSources::embedded_only(),
    );
    let start = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();
    let mut manager = Manager::new(
        "probe-mgr".to_string(),
        "Probe".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire(world.teams[0].id.clone());
    let team_ids: Vec<String> = world.teams.iter().map(|team| team.id.clone()).collect();
    let mut game = Game::new(
        GameClock::new(start),
        manager,
        world.teams,
        world.players,
        world.staff,
        vec![],
    );
    game.seed = seed;
    game.available_staff_market_last_activity_date = Some(start.format("%Y-%m-%d").to_string());
    repair_opening_youth_academies(&mut game);
    game.league = Some(ofm_core::schedule::generate_league(
        "Probe League",
        2026,
        &team_ids,
        start,
    ));
    ofm_core::season_context::refresh_game_context(&mut game);
    ofm_core::economy::open_world_economy(&mut game);
    game.teams[0].finance = 1_000_000_000;
    game
}

/// Each pool youngster's rank in his nation's cohort, as the pool was drawn.
fn cohort_ranks(game: &Game) -> HashMap<String, f64> {
    let mut ranks = HashMap::new();
    for kids in game.youth_pool.as_ref().expect("a pool").nations.values() {
        for kid in kids {
            let better = kids.iter().filter(|other| other.potential > kid.potential);
            ranks.insert(kid.id.clone(), better.count() as f64 / kids.len() as f64);
        }
    }
    ranks
}

fn probe_scout(rating: u8) -> Staff {
    let mut scout = Staff::new(
        "probe-scout".to_string(),
        "Probe".to_string(),
        "Scout".to_string(),
        "1985-01-01".to_string(),
        StaffRole::Scout,
        StaffAttributes {
            coaching: 30,
            judging_ability: rating,
            judging_potential: rating,
            physiotherapy: 20,
        },
    );
    scout.team_id = None;
    scout
}

/// The ranks of the youngsters one high-potential search recommends.
fn one_search(game: &Game, rating: u8, facility: u8, ranks: &HashMap<String, f64>) -> Vec<f64> {
    let mut game = game.clone();
    let mut scout = probe_scout(rating);
    scout.team_id = game.manager.team_id.clone();
    game.staff.push(scout);
    game.teams[0].facilities.scouting = facility;
    if start_youth_scouting(
        &mut game,
        "probe-scout",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::HighPotential,
        None,
    )
    .is_err()
    {
        return Vec::new();
    }
    for _ in 0..10 {
        turn::process_day(&mut game);
    }
    game.messages
        .iter()
        .filter_map(|message| message.context.youth_prospects.as_ref())
        .flatten()
        .filter_map(|kid| ranks.get(&kid.id).copied())
        .collect()
}

#[derive(Default)]
struct Cell {
    ranks: Vec<f64>,
}

impl Cell {
    fn mean(&self) -> f64 {
        100.0 * self.ranks.iter().sum::<f64>() / self.ranks.len().max(1) as f64
    }
    fn top_tenth(&self) -> f64 {
        let top = self.ranks.iter().filter(|rank| **rank < 0.10).count();
        100.0 * top as f64 / self.ranks.len().max(1) as f64
    }
}

#[test]
#[ignore]
fn report_scouting_against_the_pool() {
    let cells_spec: [(u8, u8); 4] = [(20, 1), (50, 1), (80, 1), (80, 3)];
    let moments: [(&str, u32); 3] = [("week 1", 0), ("week 20", 140), ("week 40", 280)];
    let mut cells: HashMap<(usize, usize), Cell> = HashMap::new();
    // AI signings: true potential by the signing club's best scout band.
    let mut ai_by_band: HashMap<&str, Vec<u8>> = HashMap::new();
    let mut demand_start = 0usize;
    let mut demand_left = 0usize;

    for seed in 0..worlds() {
        let mut game = seeded_world(seed);
        ofm_core::youth_pool::ensure_pool(&mut game);
        let ranks = cohort_ranks(&game);
        let pool = game.youth_pool.as_ref().unwrap();
        demand_start += pool.demand.values().map(Vec::len).sum::<usize>();
        let mut played = 0;
        for (moment_index, (_, day)) in moments.iter().enumerate() {
            while played < *day {
                turn::process_day(&mut game);
                played += 1;
            }
            for (cell_index, (rating, facility)) in cells_spec.iter().enumerate() {
                for search in 0..SEARCHES {
                    // A different search each time: the clock moves a day per search.
                    let mut copy = game.clone();
                    copy.clock.advance_days(search as i64);
                    let found = one_search(&copy, *rating, *facility, &ranks);
                    cells
                        .entry((moment_index, cell_index))
                        .or_default()
                        .ranks
                        .extend(found);
                }
            }
        }
        while played < 364 {
            turn::process_day(&mut game);
            played += 1;
        }
        demand_left += game
            .youth_pool
            .as_ref()
            .unwrap()
            .demand
            .values()
            .map(Vec::len)
            .sum::<usize>();
        for player in game.players.iter().filter(|p| p.id.starts_with("youth-pool-")) {
            let Some(club) = player.team_id.as_deref() else {
                continue;
            };
            let best = game
                .staff
                .iter()
                .filter(|s| s.role == StaffRole::Scout && s.team_id.as_deref() == Some(club))
                .map(|s| s.attributes.judging_ability)
                .max()
                .unwrap_or(0);
            let band = match best {
                80.. => ">= 80",
                60..=79 => "60-79",
                40..=59 => "40-59",
                _ => "< 40",
            };
            ai_by_band.entry(band).or_default().push(player.potential);
        }
    }

    println!();
    println!("{} worlds, {SEARCHES} high-potential searches each per cell.", worlds());
    println!("Rank of the recommended in the nation's cohort by true potential (0% = best).");
    println!(
        "{:>8} {:>6} {:>9} {:>11} {:>10}",
        "moment", "scout", "facility", "mean rank", "top 10%"
    );
    for (moment_index, (moment, _)) in moments.iter().enumerate() {
        for (cell_index, (rating, facility)) in cells_spec.iter().enumerate() {
            let cell = &cells[&(moment_index, cell_index)];
            println!(
                "{:>8} {:>6} {:>9} {:>10.1}% {:>9.1}%   (n={})",
                moment,
                rating,
                facility,
                cell.mean(),
                cell.top_tenth(),
                cell.ranks.len()
            );
        }
    }
    println!();
    println!("AI signings from the pool, by the club's best scout's judging ability:");
    for band in ["< 40", "40-59", "60-79", ">= 80"] {
        let potentials = ai_by_band.get(band).cloned().unwrap_or_default();
        let mean = potentials.iter().map(|p| f64::from(*p)).sum::<f64>()
            / potentials.len().max(1) as f64;
        println!("{band:>6}: mean potential {mean:.1} (n={})", potentials.len());
    }
    println!(
        "AI demand filled by the season's end: {:.1}% ({} of {})",
        100.0 * (demand_start - demand_left) as f64 / demand_start.max(1) as f64,
        demand_start - demand_left,
        demand_start
    );
}
