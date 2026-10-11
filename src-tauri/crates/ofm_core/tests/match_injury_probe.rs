//! How often clubs lose players to injuries suffered in matches.
//!
//! Run it explicitly — it plays seeded worlds for a season:
//!
//! ```text
//! cargo test -p ofm_core --test match_injury_probe --release -- --ignored --nocapture
//! ```
//!
//! Counts the injuries the league's played fixtures record, per club and per
//! match, and how many players are out injured on a sample of days.

use chrono::{TimeZone, Utc};
use domain::manager::Manager;
use ofm_core::clock::GameClock;
use ofm_core::game::Game;
use ofm_core::generator::{
    DefinitionSources, WorldGenConfig, generate_world_data_seeded_with,
    repair_opening_youth_academies,
};
use ofm_core::turn;

const SEEDS: [u64; 5] = [3, 7, 19, 42, 77];

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
    game
}

#[test]
#[ignore]
fn report_match_injuries_over_a_season() {
    println!();
    println!(
        "{:>5} {:>7} {:>8} {:>13} {:>15} {:>15}",
        "seed", "clubs", "matches", "injuries", "per club", "out (mean/day)"
    );
    for seed in SEEDS {
        let mut game = seeded_world(seed);
        let clubs = game.teams.len();
        let mut out_sum = 0usize;
        let mut samples = 0usize;
        for day in 0..330 {
            turn::process_day(&mut game);
            if day % 7 == 0 {
                out_sum += game
                    .players
                    .iter()
                    .filter(|p| p.team_id.is_some() && p.injury.is_some())
                    .count();
                samples += 1;
            }
        }
        let fixtures = &game.league.as_ref().unwrap().fixtures;
        let played: Vec<_> = fixtures.iter().filter_map(|f| f.result.as_ref()).collect();
        let injuries: usize = played
            .iter()
            .filter_map(|result| result.report.as_ref())
            .map(|report| {
                report
                    .events
                    .iter()
                    .filter(|event| event.event_type == "Injury")
                    .count()
            })
            .sum();
        println!(
            "{:>5} {:>7} {:>8} {:>13} {:>15.1} {:>15.1}",
            seed,
            clubs,
            played.len(),
            injuries,
            injuries as f64 / clubs as f64,
            out_sum as f64 / samples.max(1) as f64
        );
    }
}
