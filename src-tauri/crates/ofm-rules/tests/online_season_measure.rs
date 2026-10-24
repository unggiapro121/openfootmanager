//! E3-7: online seasons played the way the server will play them (S-7 §3.6–§3.8), measured to
//! choose the season ruleset's development multiplier (Q5) and to check that a match a day with
//! a session a day does not wear squads down. Run by hand:
//! `cargo test --release -p ofm-rules --test online_season_measure -- --ignored --nocapture`.
//!
//! A day: every player's injury counts down a day; every club plans and trains (`train_player`,
//! which is also the day's recovery, with no taper); then, from day 2, each league plays its
//! round. At the end of a season: aging, online retirement, and the season into the career.
//! Squads are not topped up, so the third season is played by smaller squads than the first.

use std::collections::{BTreeMap, HashMap};

use domain::manager::PlayStyleMastery;
use domain::player::Player;
use domain::staff::Staff;
use domain::team::Team;
use engine::MatchConfig;
use engine::ai::AiProfile;
use ofm_rules::match_session::{Controller, MatchSeed, MatchSession, MatchSetup};
use ofm_rules::match_summary::MatchSummary;
use ofm_rules::squad::{
    FixtureLoad, SideSelection, build_side, coach_mastery_from, management_quality_from_rating,
    selection_seed,
};
use ofm_rules::training::{TrainingDay, session_rng, team_training_plan, train_online_day};
use ofm_rules::worldgen::online::{Generator, OnlineContentPack};
use ofm_rules::{age, aging, ai_training, match_form, player_wear, playing_time, season};
use ofm_rules::{season_stats, seed};

const SEED: u64 = 0x0E37;
const CLUBS: u64 = 56;
const DAYS: u32 = 28;
const SEASONS: u32 = 3;
const FIRST_YEAR: u32 = 2026;
/// Day 0 is a Saturday.
const START_WEEKDAY: u32 = 5;
/// A season's minutes: 26 matches of 90.
const SEASON_MINUTES: u32 = 26 * 90;

/// One way to play an online season: the development multiplier, and the season ruleset's online
/// recovery (S-7 Qs7-11). `rest_days: 0, injury_scale: 1` is the game's own day.
#[derive(Clone, Copy)]
struct Variant {
    multiplier: f64,
    /// Rest days of recovery an online day adds to its session (`train_online_day`).
    rest_days: u32,
    /// Injuries out for this many times fewer days (`assign_online_match_injury`).
    injury_scale: u32,
}

struct Club {
    team: Team,
    players: Vec<Player>,
    staff: Vec<Staff>,
    mastery: PlayStyleMastery,
    rating: u8,
}

#[derive(Default)]
struct Measure {
    /// Per round: the sum of the eleven's mean condition at kick-off, and the sides counted.
    kickoff: BTreeMap<u32, (f64, u32)>,
    starters: u32,
    starters_below_60: u32,
    injuries: u32,
    injury_days: u32,
    /// Age band → (sum of OVR change over a season, players) for regular starters.
    growth: BTreeMap<&'static str, (f64, u32)>,
    /// Age band → (sum of OVR change, players) for everyone.
    growth_all: BTreeMap<&'static str, (f64, u32)>,
    retired_by_age: BTreeMap<i32, u32>,
    veterans_by_age: BTreeMap<i32, u32>,
    smallest_squad: usize,
}

fn world() -> Vec<Club> {
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(SEED, &pack).expect("a generator");
    (0..CLUBS)
        .map(|ordinal| {
            let club = generator
                .club("AsiaSoutheast", ordinal, 0, FIRST_YEAR, None)
                .expect("a club");
            Club {
                rating: club.coach.rating(),
                mastery: club.coach.play_style_mastery,
                team: club.team,
                players: club.players,
                staff: club.staff,
            }
        })
        .collect()
}

fn band(age: i32) -> &'static str {
    match age {
        ..=19 => "≤19",
        20..=22 => "20–22",
        23..=26 => "23–26",
        27..=30 => "27–30",
        _ => "31+",
    }
}

fn train(club: &mut Club, season_number: u32, day: u32, football_year: u32, v: Variant) {
    let (year, date) = season::season_football_date(football_year, day, DAYS);
    let weekday = season::season_weekday(START_WEEKDAY, day);
    for player in &mut club.players {
        player_wear::recover_injury(player, 1);
    }
    let available: Vec<&Player> = club.players.iter().filter(|p| p.injury.is_none()).collect();
    ai_training::plan_session(&mut club.team, &available, weekday);
    let staff: Vec<&Staff> = club.staff.iter().collect();
    let plan = team_training_plan(&club.team, &staff, None);
    let training_day = TrainingDay {
        weekday_num: weekday,
        year,
        date,
        development_multiplier: v.multiplier,
    };
    let key = season::day_key(season_number, day);
    for player in &mut club.players {
        let mut rng = session_rng(SEED, &player.id, &key);
        train_online_day(player, &plan, &training_day, v.rest_days, &mut rng);
    }
}

fn side(club: &Club, key: &str) -> (engine::TeamData, Vec<engine::PlayerData>) {
    let available: Vec<&Player> = club.players.iter().filter(|p| p.injury.is_none()).collect();
    let injured: Vec<&Player> = club.players.iter().filter(|p| p.injury.is_some()).collect();
    build_side(&SideSelection {
        team_id: &club.team.id,
        team: Some(&club.team),
        available: &available,
        injured: &injured,
        is_user_team: false,
        head_coach: coach_mastery_from(&club.mastery),
        management_quality: management_quality_from_rating(club.rating),
        selection_seed: selection_seed(&club.team.id, key),
        load: FixtureLoad::Normal,
    })
}

fn kickoff_condition(club: &Club, eleven: &engine::TeamData, round: u32, measure: &mut Measure) {
    let by_id: HashMap<&str, u8> = club
        .players
        .iter()
        .map(|p| (p.id.as_str(), p.condition))
        .collect();
    let conditions: Vec<u8> = eleven
        .players
        .iter()
        .filter_map(|p| by_id.get(p.id.as_str()).copied())
        .collect();
    let mean = conditions.iter().map(|c| f64::from(*c)).sum::<f64>() / conditions.len() as f64;
    let entry = measure.kickoff.entry(round).or_default();
    entry.0 += mean;
    entry.1 += 1;
    measure.starters += conditions.len() as u32;
    measure.starters_below_60 += conditions.iter().filter(|c| **c < 60).count() as u32;
}

fn settle(
    club: &mut Club,
    summary: &MatchSummary,
    conceded: u8,
    fixture: &str,
    v: Variant,
    measure: &mut Measure,
) {
    let medical = club.team.facilities.medical;
    let mut wear = seed::rng_for_seed(SEED, &format!("post-match/wear/{}", club.team.id), fixture);
    for player in &mut club.players {
        let stats = summary.player_stats.get(&player.id);
        let (minutes, rating) = stats.map_or((0, 0.0), |s| (s.minutes_played, s.rating));
        playing_time::record_club_match(player, minutes);
        match_form::record_rated_match(player, rating);
        player_wear::apply_match_wear(player, minutes, &mut wear);
        if let Some(stats) = stats {
            season_stats::record_match(player, stats, conceded);
        }
        if summary.injured.contains(&player.id) {
            let mut rng =
                seed::rng_for_seed(SEED, &format!("post-match/injury/{}", player.id), fixture);
            if let Some(injury) =
                player_wear::assign_online_match_injury(player, medical, v.injury_scale, &mut rng)
            {
                measure.injuries += 1;
                measure.injury_days += injury.days_remaining;
            }
        }
    }
}

fn play(
    clubs: &mut [Club],
    (home, away): (usize, usize),
    fixture: &str,
    round: u32,
    v: Variant,
    m: &mut Measure,
) {
    let (home_side, home_bench) = side(&clubs[home], fixture);
    let (away_side, away_bench) = side(&clubs[away], fixture);
    kickoff_condition(&clubs[home], &home_side, round, m);
    kickoff_condition(&clubs[away], &away_side, round, m);
    let mut match_seed = [0u8; 32];
    match_seed[..8].copy_from_slice(
        &ofm_rules::stable_hash::stable_hash(fixture.as_bytes(), SEED).to_le_bytes(),
    );
    let setup = MatchSetup {
        home: home_side,
        away: away_side,
        home_bench,
        away_bench,
        config: MatchConfig::default(),
        allows_extra_time: false,
        seed: MatchSeed(match_seed),
        ai_home: AiProfile::default(),
        ai_away: AiProfile::default(),
        injury_window_steps: None,
        licence_home: None,
        licence_away: None,
    };
    let mut session = MatchSession::new(setup, Controller::Ai, Controller::Ai);
    while !session.is_finished() {
        session.step();
    }
    let summary = MatchSummary::from_report(&session.into_report());
    let (home_goals, away_goals) = (summary.home_goals, summary.away_goals);
    settle(&mut clubs[home], &summary, away_goals, fixture, v, m);
    settle(&mut clubs[away], &summary, home_goals, fixture, v, m);
}

fn close_season(
    clubs: &mut [Club],
    season_number: u32,
    football_year: u32,
    start: &HashMap<String, (u8, i32)>,
    m: &mut Measure,
) {
    let (_, last_day) = season::season_football_date(football_year, DAYS - 1, DAYS);
    for club in clubs.iter_mut() {
        for player in &mut club.players {
            if let Some((ovr, start_age)) = start.get(&player.id) {
                let change = f64::from(player.ovr) - f64::from(*ovr);
                let all = m.growth_all.entry(band(*start_age)).or_default();
                all.0 += change;
                all.1 += 1;
                if player.stats.minutes_played * 2 >= SEASON_MINUTES {
                    let regular = m.growth.entry(band(*start_age)).or_default();
                    regular.0 += change;
                    regular.1 += 1;
                }
            }
            let age = age::age_on(&player.date_of_birth, &last_day).unwrap_or(30);
            season_stats::archive_season(player, season_number, &club.team.id, &club.team.name);
            aging::apply_attribute_curve(player, age, football_year);
            if age >= 33 {
                *m.veterans_by_age.entry(age).or_default() += 1;
            }
            if aging::should_retire_online(player, age, football_year) {
                *m.retired_by_age.entry(age).or_default() += 1;
                player.retired = true;
            }
            season_stats::reset_season(player);
        }
        club.players.retain(|p| !p.retired);
        club.team
            .starting_xi_ids
            .retain(|id| club.players.iter().any(|p| &p.id == id));
        m.smallest_squad = m.smallest_squad.min(club.players.len());
    }
}

fn run(v: Variant) -> Measure {
    let mut clubs = world();
    let mut measure = Measure {
        smallest_squad: usize::MAX,
        ..Measure::default()
    };
    let pairings = season::round_robin_pairings(14, 2);
    for season_number in 1..=SEASONS {
        let football_year = FIRST_YEAR + season_number - 1;
        let (_, first_day) = season::season_football_date(football_year, 0, DAYS);
        let start: HashMap<String, (u8, i32)> = clubs
            .iter()
            .flat_map(|c| c.players.iter())
            .map(|p| {
                (
                    p.id.clone(),
                    (
                        p.ovr,
                        age::age_on(&p.date_of_birth, &first_day).unwrap_or(30),
                    ),
                )
            })
            .collect();
        for day in 0..DAYS {
            for club in &mut clubs {
                train(club, season_number, day, football_year, v);
            }
            if day < 2 {
                continue;
            }
            let round = day - 1;
            for league in 0..(CLUBS as usize / 14) {
                for (home, away) in &pairings[(round - 1) as usize] {
                    let fixture = format!("s{season_number}/l{league}/r{round}/{home}-{away}");
                    play(
                        &mut clubs,
                        (league * 14 + home, league * 14 + away),
                        &fixture,
                        round,
                        v,
                        &mut measure,
                    );
                }
            }
        }
        close_season(
            &mut clubs,
            season_number,
            football_year,
            &start,
            &mut measure,
        );
    }
    measure
}

fn report(v: Variant, m: &Measure) {
    println!(
        "\n== {}×, +{} rest days a day, injuries ÷{} ({SEASONS} seasons, {CLUBS} clubs) ==",
        v.multiplier, v.rest_days, v.injury_scale
    );
    let line = |rows: &BTreeMap<&'static str, (f64, u32)>| {
        ["≤19", "20–22", "23–26", "27–30", "31+"]
            .iter()
            .map(|b| {
                rows.get(b).map_or(format!("{b}: –"), |(s, n)| {
                    format!("{b}: {:+.2} (n={n})", s / f64::from(*n))
                })
            })
            .collect::<Vec<_>>()
            .join(" · ")
    };
    println!(
        "OVR change a season, regular starters (≥ half the minutes): {}",
        line(&m.growth)
    );
    println!(
        "OVR change a season, everyone:                             {}",
        line(&m.growth_all)
    );
    let rounds: Vec<String> = m
        .kickoff
        .iter()
        .filter(|(round, _)| [1, 5, 10, 15, 20, 26].contains(*round))
        .map(|(round, (sum, n))| format!("r{round} {:.1}", sum / f64::from(*n)))
        .collect();
    println!(
        "XI mean condition at kick-off by round: {}",
        rounds.join(" · ")
    );
    println!(
        "starters below 60 at kick-off: {:.2}%",
        100.0 * f64::from(m.starters_below_60) / f64::from(m.starters)
    );
    let club_seasons = f64::from(CLUBS as u32 * SEASONS);
    println!(
        "injuries per club a season: {:.2}, mean length {:.1} days",
        f64::from(m.injuries) / club_seasons,
        f64::from(m.injury_days) / f64::from(m.injuries.max(1))
    );
    let retirements: Vec<String> = m
        .veterans_by_age
        .iter()
        .map(|(age, n)| {
            let retired = m.retired_by_age.get(age).copied().unwrap_or(0);
            format!("{age}: {retired}/{n}")
        })
        .collect();
    println!(
        "retired / veterans by age at season end: {}",
        retirements.join(" · ")
    );
    println!("smallest squad after a season end: {}", m.smallest_squad);
}

/// Given 56 generated clubs in four leagues,
/// when three online seasons are played by the game's own day and by the online day at several
/// development multipliers,
/// then growth by age, condition at kick-off, injuries and retirements are printed.
#[test]
#[ignore = "a measurement, run by hand"]
#[expect(
    clippy::disallowed_methods,
    reason = "a measurement times itself with the wall clock; it is not a rule and feeds no world"
)]
fn measure_online_seasons() {
    // The rules as they stand, at four multipliers; then candidate online wear at 10×.
    let today = Variant {
        multiplier: 10.0,
        rest_days: 0,
        injury_scale: 1,
    };
    let online = |multiplier| Variant {
        multiplier,
        rest_days: 2,
        injury_scale: 13,
    };
    let variants = [
        today,
        online(10.0),
        online(12.0),
        online(14.0),
        online(16.0),
        online(18.0),
    ];
    for v in variants {
        let started = std::time::Instant::now();
        let measure = run(v);
        report(v, &measure);
        println!("took {:.1} s", started.elapsed().as_secs_f64());
    }
}
