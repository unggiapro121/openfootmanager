//! Career probe for phase 2 lane M: the user's reputation over several seasons
//! of the real world (`làn-M-tech-spec.md` §5.1, §8).
//!
//! ```sh
//! OFM_REAL_WORLD_PACKAGE=/path/to/real-world-2025-26.ofm \
//! OFM_PROBE_SCOPE=home \
//!   cargo test --release --lib manager_career_probe -- --ignored --nocapture
//! ```
//!
//! The user's club is managed headlessly, as `process_day` plays it, so this is
//! an "average manager": the reputation a player who outthinks the AI earns is
//! higher. Knobs: `OFM_CAREER_CLUBS` (comma-separated club ids, default
//! Manchester City, Crystal Palace, Bristol City), `OFM_CAREER_SEASONS`
//! (default 5), `OFM_PROBE_SEED`.

use std::path::Path;

use ofm_core::end_of_season::{advance_to_next_season, is_season_complete};

use super::real_world_probe::build_game_for_club;

const DEFAULT_CLUBS: &str = "manchester-city,crystal-palace,bristol-city";
/// More days than any season takes, so a stuck calendar fails the probe
/// rather than looping for ever.
const MAX_DAYS_PER_SEASON: u32 = 500;

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

#[test]
#[ignore = "builds the real-world package and plays seasons of it; run explicitly"]
fn manager_career_probe() {
    let Ok(package) = std::env::var("OFM_REAL_WORLD_PACKAGE") else {
        eprintln!("OFM_REAL_WORLD_PACKAGE is not set; nothing to probe.");
        return;
    };
    let seed = env_or("OFM_PROBE_SEED", 20_260_601_u64);
    let seasons = env_or("OFM_CAREER_SEASONS", 5_u32);
    let clubs = std::env::var("OFM_CAREER_CLUBS").unwrap_or_else(|_| DEFAULT_CLUBS.to_string());

    for club in clubs
        .split(',')
        .map(str::trim)
        .filter(|club| !club.is_empty())
    {
        let started = std::time::Instant::now();
        let mut game = build_game_for_club(Path::new(&package), seed, Some(club));
        let club_reputation = game
            .teams
            .iter()
            .find(|team| team.id == club)
            .map_or(0, |team| team.reputation);
        println!("== {club} (club reputation {club_reputation}), seed {seed}");
        for _ in 0..seasons {
            let mut days = 0;
            while !is_season_complete(&game) {
                ofm_core::turn::process_day(&mut game);
                days += 1;
                assert!(days < MAX_DAYS_PER_SEASON, "the season never completed");
            }
            advance_to_next_season(&mut game).expect("a complete season rolls over");
            let change = game
                .manager
                .progression
                .reputation_log
                .last()
                .expect("every season is reviewed");
            println!(
                "  season {}: {} -> {} ({:+}) · P {:+} H {:+} C {:+} · led {}/{} · club {:?} · employed {}",
                change.season,
                change.before,
                change.after,
                i64::from(change.after) - i64::from(change.before),
                change.performance,
                change.honours,
                change.club_pull,
                change.league_matches_led,
                change.league_matches_played,
                change.team_id,
                game.manager.team_id.is_some(),
            );
        }
        println!("  ({:.0} s)", started.elapsed().as_secs_f64());
    }
}
