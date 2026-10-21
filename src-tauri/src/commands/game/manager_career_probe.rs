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
//! higher. The board is kept content (satisfaction 100 every day) so the user
//! keeps the job: an average manager at a club that expects titles is often
//! sacked within a season or two, and an unemployed user measures nothing about
//! the reputation rule. Knobs: `OFM_CAREER_CLUBS` (comma-separated club ids, default
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
                game.manager.satisfaction = 100;
                ofm_core::turn::process_day(&mut game);
                days += 1;
                assert!(days < MAX_DAYS_PER_SEASON, "the season never completed");
            }
            game.manager.satisfaction = 100;
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

/// Mastery probe (M-2): plays each sample club's seasons the way a user who
/// takes every match to the field does — through `advance_time_with_mode("live")`
/// and `finish_live_match`, the GUI's own path — and prints the XP each match
/// earned and the club style's mastery after each season. Also prints the
/// mastery AI head coaches open the world with in their club's style, the bar a
/// user at 50 is measured against (`làn-M-tech-spec.md` §6.7).
///
/// ```sh
/// OFM_REAL_WORLD_PACKAGE=/path/to/real-world-2025-26.ofm OFM_PROBE_SCOPE=home \
///   cargo test --release --lib manager_mastery_probe -- --ignored --nocapture
/// ```
#[test]
#[ignore = "builds the real-world package and plays seasons of it; run explicitly"]
fn manager_mastery_probe() {
    use crate::application::live_match::finish_live_match;
    use crate::application::time_advancement::advance_time_with_mode;
    use ofm_core::state::StateManager;

    let Ok(package) = std::env::var("OFM_REAL_WORLD_PACKAGE") else {
        eprintln!("OFM_REAL_WORLD_PACKAGE is not set; nothing to probe.");
        return;
    };
    let seed = env_or("OFM_PROBE_SEED", 20_260_601_u64);
    let seasons = env_or("OFM_CAREER_SEASONS", 1_u32);
    let clubs = std::env::var("OFM_CAREER_CLUBS").unwrap_or_else(|_| DEFAULT_CLUBS.to_string());

    for (index, club) in clubs
        .split(',')
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .enumerate()
    {
        let started = std::time::Instant::now();
        let game = build_game_for_club(Path::new(&package), seed, Some(club));
        if index == 0 {
            print_ai_coach_mastery(&game);
        }
        let style = game
            .teams
            .iter()
            .find(|team| team.id == club)
            .map(|team| team.play_style.clone())
            .expect("the club exists");
        println!("== {club} ({style:?}), seed {seed}");
        let state = StateManager::new();
        state.set_game(game);
        for _ in 0..seasons {
            let mut gains = Vec::new();
            let mut days = 0;
            while !state.get_game(is_season_complete).unwrap_or(true) {
                state.update_game(|game| game.manager.satisfaction = 100);
                advance_time_with_mode(&state, "live", None).expect("the day advances");
                if state.with_live_match(|_| ()).is_some() {
                    let response = finish_live_match(&state, None).expect("the match finishes");
                    gains.extend(response.mastery_gain);
                }
                days += 1;
                assert!(days < MAX_DAYS_PER_SEASON, "the season never completed");
            }
            let mastery = state
                .get_game(|game| game.manager.play_style_mastery.for_style(&style))
                .unwrap_or(0);
            let total: u32 = gains.iter().map(|gain| gain.xp).sum();
            let in_club_style = gains.iter().filter(|gain| gain.style == style).count();
            println!(
                "  season: {} managed matches · {} XP ({:.2}/match) · {} in {:?} · mastery {:?} {}",
                gains.len(),
                total,
                f64::from(total) / gains.len().max(1) as f64,
                in_club_style,
                style,
                style,
                mastery,
            );
            state.update_game(|game| {
                game.manager.satisfaction = 100;
                advance_to_next_season(game).expect("a complete season rolls over");
            });
        }
        println!("  ({:.0} s)", started.elapsed().as_secs_f64());
    }
}

/// The mastery AI head coaches hold in their own club's style as the world opens.
fn print_ai_coach_mastery(game: &ofm_core::game::Game) {
    let mut values: Vec<u8> = game
        .teams
        .iter()
        .filter_map(|team| {
            let manager_id = team.manager_id.as_deref()?;
            let manager = game.managers.iter().find(|m| m.id == manager_id)?;
            (manager.id != game.manager.id)
                .then(|| manager.play_style_mastery.for_style(&team.play_style))
        })
        .collect();
    values.sort_unstable();
    if values.is_empty() {
        return;
    }
    let at = |share: f64| values[((values.len() - 1) as f64 * share) as usize];
    println!(
        "AI head coaches in their club's style ({}): p10 {} · median {} · p90 {}",
        values.len(),
        at(0.1),
        at(0.5),
        at(0.9)
    );
}
