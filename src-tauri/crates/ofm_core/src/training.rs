//! The day's training over a save: which clubs train (not those playing today), each club's plan
//! and its taper read off the calendar, every player put through the session. The session itself
//! is `ofm_rules::training`, shared with the online server.

mod fitness_warnings;
pub use fitness_warnings::check_squad_fitness_warnings;

use crate::game::Game;
use domain::staff::Staff;
pub(crate) use ofm_rules::training::age_factor;
use ofm_rules::training::{Taper, TeamTrainingPlan, TrainingDay, session_rng, train_player};

/// What a team's coaches and assistant managers multiply training gains by:
/// 0.8 with none, otherwise 0.85 (coaching 0) to 1.35 (coaching 100) on their
/// average coaching.
pub(crate) fn coaching_mult(game: &Game, team_id: &str) -> f64 {
    ofm_rules::training::coaching_mult(&team_staff(game, team_id))
}

/// Everyone on `team_id`'s staff.
fn team_staff<'a>(game: &'a Game, team_id: &str) -> Vec<&'a Staff> {
    game.staff
        .iter()
        .filter(|s| s.team_id.as_deref() == Some(team_id))
        .collect()
}

/// A club within this many days of its next fixture trains at reduced load.
///
/// No squad does a full session two days before a game; the days before a match
/// are a taper, not a decision the manager re-litigates each week. Keeping this
/// as a property of training rather than of the AI's planner is what stops the
/// two sides of the game running on different physics.
const MATCH_TAPER_DAYS: i64 = 2;

/// This many fixtures inside a week is a congested run.
const CONGESTION_FIXTURE_THRESHOLD: usize = 2;

/// Every club with a fixture today, in any competition it plays in.
///
/// Deliberately matched on date alone, with no filter on `FixtureStatus`. This is
/// asked *after* the day's matches have been simulated, by which point those
/// fixtures read `Completed`; a status filter here would report the clubs that
/// just played ninety minutes as free to train, and they would recover on the
/// very day they were emptied.
///
/// Only competitions in the active scope count. A dormant competition is
/// resolved by a scoreline-only model that charges nobody any condition, so its
/// clubs have not had a match in any physical sense — closing the training
/// ground on them would cost them the day's recovery for nothing.
pub(crate) fn teams_playing_on(game: &Game, date: &str) -> std::collections::HashSet<String> {
    game.competitions_in_play()
        .iter()
        .filter(|competition| game.competition_in_active_scope(competition))
        .flat_map(|competition| competition.fixtures.iter())
        .filter(|fixture| fixture.date == date)
        .flat_map(|fixture| [fixture.home_team_id.clone(), fixture.away_team_id.clone()])
        .collect()
}

/// Every club whose fixture list puts it inside a taper today.
///
/// Reads every competition a club plays in, not just `game.league`: a cup tie
/// tires a squad exactly as much as a league game. Built as one pass over the
/// fixture list rather than a per-club scan — this runs for every club, every
/// day, and a populated world holds tens of thousands of fixtures.
///
/// Only competitions in the active scope count, as in [`teams_playing_on`]: a
/// dormant match charges nobody any condition, so it is nothing to taper for.
fn tapering_teams(game: &Game) -> std::collections::HashMap<String, Taper> {
    use chrono::NaiveDate;
    use domain::league::FixtureStatus;

    let today = game.clock.current_date.date_naive();

    // team id → how many of its fixtures fall inside the next week.
    let mut fixtures_this_week: std::collections::HashMap<&str, usize> =
        std::collections::HashMap::new();
    let mut tapering: std::collections::HashMap<String, Taper> = std::collections::HashMap::new();

    for fixture in game
        .competitions_in_play()
        .iter()
        .filter(|competition| game.competition_in_active_scope(competition))
        .flat_map(|competition| competition.fixtures.iter())
        .filter(|fixture| fixture.status == FixtureStatus::Scheduled)
    {
        let Ok(date) = NaiveDate::parse_from_str(&fixture.date, "%Y-%m-%d") else {
            continue;
        };
        let days = (date - today).num_days();
        if !(0..=7).contains(&days) {
            continue;
        }
        for team_id in [&fixture.home_team_id, &fixture.away_team_id] {
            if days <= MATCH_TAPER_DAYS {
                tapering.entry(team_id.clone()).or_insert(Taper::NearMatch);
            }
            let seen = fixtures_this_week.entry(team_id.as_str()).or_default();
            *seen += 1;
            if *seen >= CONGESTION_FIXTURE_THRESHOLD {
                tapering.insert(team_id.clone(), Taper::Congested);
            }
        }
    }

    tapering
}

/// Process daily training for every club that is not playing today.
///
/// A club's players train according to its current focus, intensity and
/// schedule. Rest days (determined by the weekly schedule) give full condition
/// recovery with no training cost. Players assigned to a training group use that
/// group's focus instead of the team default.
///
/// Clubs with a fixture today are skipped, and only those clubs: whether the
/// training ground opens is a question about *this* club's calendar, not the
/// world's. It used to be asked globally, so one cup tie anywhere shut every
/// training ground in the game and nobody recovered.
///
/// `weekday_num` is 0=Mon .. 6=Sun (chrono Weekday::num_days_from_monday()).
pub fn process_training(game: &mut Game, weekday_num: u32) {
    // Derive the current year from the game clock for accurate age calculations.
    let current_year = game
        .clock
        .current_date
        .format("%Y")
        .to_string()
        .parse::<u32>()
        .unwrap_or(2026);

    // Index each team's plan by id so players are visited once (O(teams + players))
    // instead of rescanning every player for every team (O(teams * players)).
    let tapering = tapering_teams(game);
    let playing_today = teams_playing_on(
        game,
        &game.clock.current_date.format("%Y-%m-%d").to_string(),
    );
    let plans: std::collections::HashMap<String, TeamTrainingPlan> = game
        .teams
        .iter()
        .filter(|t| !playing_today.contains(&t.id))
        .map(|t| {
            let plan = ofm_rules::training::team_training_plan(
                t,
                &team_staff(game, &t.id),
                tapering.get(&t.id).copied(),
            );
            (t.id.clone(), plan)
        })
        .collect();

    let day = TrainingDay {
        weekday_num,
        year: current_year,
        date: game.clock.current_date.format("%Y-%m-%d").to_string(),
        development_multiplier: game.development_speed.multiplier(),
        // The keeper's drill is an online season's (E5-6): the game trains as it always has.
        keeper_drill: None,
    };
    // Each player's dice are his own stream for the day (`session_rng`), not a turn in one
    // stream shared by the list: signing or releasing a player moves nobody else's session.
    let seed = game.seed;
    for player in game.players.iter_mut() {
        let Some(plan) = player.team_id.as_deref().and_then(|id| plans.get(id)) else {
            continue;
        };
        let mut rng = session_rng(seed, &player.id, &day.date);
        train_player(player, plan, &day, &mut rng);
    }
}
