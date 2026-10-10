//! How well the projection's reference path predicts what players actually do.
//! Every player of 23 or under at a club is projected from his true overall
//! and ceiling — the model, not a scout, is on trial — under his own club's
//! coaching, then three seasons are played day by day, season ends included.
//!
//! Run it explicitly — it plays several seeded worlds for three seasons:
//!
//! ```text
//! cargo test -p ofm_core --lib --release potential_projection::probe -- --ignored --nocapture
//! ```
//!
//! "Near reference" are players whose average playing time (55–80) and match
//! form (6.5–7.5) over the three seasons sat close to the reference conditions;
//! their mean miss is what `PROJECTION_K` is tuned on. Each multiple in
//! `K_SCALES` is reported, so a retune reads off the row whose miss is nearest 0.

use super::*;
use crate::clock::GameClock;
use crate::generator::{
    DefinitionSources, WorldGenConfig, generate_world_data_seeded_with,
    repair_opening_youth_academies,
};
use chrono::{Datelike, TimeZone, Utc};
use domain::manager::Manager;
use std::collections::HashMap;

const SEASONS: usize = 3;
/// Multiples of `PROJECTION_K` tried at once. Growth is linear in the coaching
/// multiplier, so scaling it is scaling K.
const K_SCALES: [f64; 5] = [0.8, 0.9, 1.0, 1.1, 1.25];
const OLDEST_TRACKED: u32 = 23;

fn worlds() -> u64 {
    std::env::var("OFM_PROBE_WORLDS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(3)
}

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
    repair_opening_youth_academies(&mut game);
    game.league = Some(crate::schedule::generate_league(
        "Probe League",
        2026,
        &team_ids,
        start,
    ));
    crate::season_context::refresh_game_context(&mut game);
    crate::economy::open_world_economy(&mut game);
    game
}

struct Tracked {
    age: u32,
    group: Position,
    start: u8,
    /// Projected expected overall after 1, 2, 3 seasons, for each of `K_SCALES`.
    expected: Vec<[u8; SEASONS]>,
    actual: [Option<u8>; SEASONS],
    playing_time: Vec<u8>,
    match_form: Vec<u8>,
}

impl Tracked {
    fn average(values: &[u8]) -> f64 {
        values.iter().map(|v| f64::from(*v)).sum::<f64>() / values.len().max(1) as f64
    }
    fn near_reference(&self) -> bool {
        let playing_time = Self::average(&self.playing_time);
        let form = Self::average(&self.match_form);
        (55.0..=80.0).contains(&playing_time) && (65.0..=75.0).contains(&form)
    }
    fn regular_in_form(&self) -> bool {
        Self::average(&self.playing_time) >= 80.0 && Self::average(&self.match_form) >= 70.0
    }
    fn rarely_plays(&self) -> bool {
        Self::average(&self.playing_time) < 30.0
    }
}

fn track(game: &Game) -> HashMap<String, Tracked> {
    let speed = game.development_speed.multiplier();
    game.players
        .iter()
        .filter(|player| !player.retired)
        .filter_map(|player| {
            let team_id = player.team_id.as_deref()?;
            let age = age_today(game, player);
            (age <= OLDEST_TRACKED).then_some(())?;
            let estimate = ProspectEstimate {
                prospect_id: player.id.clone(),
                ovr_low: player.ovr,
                ovr_high: player.ovr,
                ovr_band: 0,
                potential_low: player.potential,
                potential_high: player.potential,
                potential_band: 0,
                attributes: Vec::new(),
            };
            let position = crate::player_rating::primary_position(player);
            let coaching = crate::training::coaching_mult(game, team_id);
            let expected = K_SCALES
                .iter()
                .map(|scale| {
                    let projection = project(&ProjectionInput {
                        estimate: &estimate,
                        age,
                        position: &position,
                        development_multiplier: speed,
                        coaching_mult: coaching * scale,
                    });
                    let mut by_season = [0; SEASONS];
                    for (season, slot) in by_season.iter_mut().enumerate() {
                        *slot = projection
                            .points
                            .get(season + 1)
                            .map_or(player.ovr, |point| point.expected);
                    }
                    by_season
                })
                .collect();
            Some((
                player.id.clone(),
                Tracked {
                    age,
                    group: position.to_group_position(),
                    start: player.ovr,
                    expected,
                    actual: [None; SEASONS],
                    playing_time: Vec::new(),
                    match_form: Vec::new(),
                },
            ))
        })
        .collect()
}

/// A sacked probe manager would leave no league to finish; keep him on.
fn keep_manager(game: &mut Game) {
    if game.manager.team_id.is_none() {
        let club = game.teams[0].id.clone();
        game.manager.hire(club);
    }
}

/// Play `SEASONS` years day by day, rolling each season over as it ends,
/// sampling playing time and form each Monday and reading every tracked
/// player's overall on each anniversary of the start.
fn play_years(game: &mut Game, tracked: &mut HashMap<String, Tracked>) {
    for day in 1..=(365 * SEASONS) {
        keep_manager(game);
        if crate::end_of_season::is_season_complete(game) {
            if let Err(error) = crate::end_of_season::advance_to_next_season(game) {
                println!("rollover refused on day {day}: {error}");
            }
            keep_manager(game);
        }
        crate::turn::process_day(game);
        let monday = game.clock.current_date.weekday() == chrono::Weekday::Mon;
        let anniversary = (day % 365 == 0).then(|| day / 365 - 1);
        for player in &game.players {
            let Some(entry) = tracked.get_mut(&player.id) else {
                continue;
            };
            if monday {
                entry.playing_time.push(player.playing_time);
                entry.match_form.push(player.match_form);
            }
            if let Some(season) = anniversary
                && !player.retired
            {
                entry.actual[season] = Some(player.ovr);
            }
        }
    }
}

fn median(mut values: Vec<f64>) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    values.sort_by(|a, b| a.total_cmp(b));
    values[values.len() / 2]
}

fn report(label: &str, entries: &[&Tracked], scale: usize) {
    let mut line = format!("{label:<28} n={:<5}", entries.len());
    for season in 0..SEASONS {
        let misses: Vec<f64> = entries
            .iter()
            .filter_map(|entry| {
                entry.actual[season]
                    .map(|actual| f64::from(actual) - f64::from(entry.expected[scale][season]))
            })
            .collect();
        let gains: Vec<f64> = entries
            .iter()
            .filter_map(|entry| {
                entry.actual[season].map(|actual| f64::from(actual) - f64::from(entry.start))
            })
            .collect();
        let projected: Vec<f64> = entries
            .iter()
            .map(|entry| f64::from(entry.expected[scale][season]) - f64::from(entry.start))
            .collect();
        let within: f64 = misses.iter().filter(|miss| miss.abs() <= 2.0).count() as f64
            / misses.len().max(1) as f64;
        let mean = misses.iter().sum::<f64>() / misses.len().max(1) as f64;
        line.push_str(&format!(
            " | +{}: miss mean {:+.1} med {:+.0} | gain act {:.0} proj {:.0} | ±2 {:.0}%",
            season + 1,
            mean,
            median(misses),
            median(gains),
            median(projected),
            within * 100.0
        ));
    }
    println!("{line}");
}

/// Given seeded worlds played for three seasons, when every young player's
/// reference projection is compared with what he did, then print the misses
/// by how close he lived to the reference conditions, by age and by position.
#[test]
#[ignore = "probe: plays several worlds for three seasons; run with --ignored --nocapture"]
fn probe_projection_against_three_seasons() {
    let mut all: Vec<Tracked> = Vec::new();
    for seed in 1..=worlds() {
        let mut game = seeded_world(seed);
        let mut tracked = track(&game);
        play_years(&mut game, &mut tracked);
        all.extend(tracked.into_values());
    }

    let pick = |keep: &dyn Fn(&Tracked) -> bool| all.iter().filter(|e| keep(e)).collect::<Vec<_>>();
    for (scale_index, scale) in K_SCALES.iter().enumerate() {
        println!(
            "\nK = {:.2} ({scale} x {PROJECTION_K}); worlds = {}",
            PROJECTION_K * scale,
            worlds()
        );
        let report = |label: &str, entries: &[&Tracked]| report(label, entries, scale_index);
        report("all <= 23", &pick(&|_| true));
        report("near reference", &pick(&|e| e.near_reference()));
        report("regular in form", &pick(&|e| e.regular_in_form()));
        report("rarely plays", &pick(&|e| e.rarely_plays()));
        for (label, ages) in [
            ("age <= 18", 0..=18),
            ("age 19-20", 19..=20),
            ("age 21-23", 21..=23),
        ] {
            report(
                &format!("near ref, {label}"),
                &pick(&|e| e.near_reference() && ages.contains(&e.age)),
            );
        }
        for group in [
            Position::Goalkeeper,
            Position::Defender,
            Position::Midfielder,
            Position::Forward,
        ] {
            report(
                &format!("regular, {group:?}"),
                &pick(&|e| e.regular_in_form() && e.group == group),
            );
        }
    }
}
