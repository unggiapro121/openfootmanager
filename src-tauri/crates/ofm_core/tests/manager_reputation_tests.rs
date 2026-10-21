//! The user's reputation reviewed at season end (phase 2 lane M, M-1).

use chrono::{TimeZone, Utc};
use domain::league::{
    Fixture, FixtureCompetition, FixtureStatus, League, MatchResult, StandingEntry,
};
use domain::manager::{HonourKind, Manager};
use domain::team::Team;
use ofm_core::clock::GameClock;
use ofm_core::end_of_season::process_end_of_season;
use ofm_core::game::Game;

fn make_team(id: &str, name: &str, reputation: u32) -> Team {
    let mut team = Team::new(
        id.to_string(),
        name.to_string(),
        name[..3].to_string(),
        "England".to_string(),
        "London".to_string(),
        "Stadium".to_string(),
        40_000,
    );
    team.reputation = reputation;
    team
}

fn completed(id: &str, home: &str, away: &str, home_goals: u8, away_goals: u8) -> Fixture {
    Fixture {
        id: id.to_string(),
        matchday: 1,
        date: "2026-05-01".to_string(),
        home_team_id: home.to_string(),
        away_team_id: away.to_string(),
        competition: FixtureCompetition::League,
        status: FixtureStatus::Completed,
        result: Some(MatchResult {
            home_goals,
            away_goals,
            home_scorers: vec![],
            away_scorers: vec![],
            report: None,
            home_penalties: None,
            away_penalties: None,
        }),
        ..Default::default()
    }
}

fn standing(team_id: &str, won: u32, lost: u32) -> StandingEntry {
    StandingEntry {
        team_id: team_id.to_string(),
        played: won + lost,
        won,
        drawn: 0,
        lost,
        goals_for: won,
        goals_against: lost,
        points: won * 3,
    }
}

fn division(id: &str, priority: u32, clubs: [&str; 2], winner_first: bool) -> League {
    let [first, second] = if winner_first {
        clubs
    } else {
        [clubs[1], clubs[0]]
    };
    League {
        id: id.to_string(),
        name: id.to_string(),
        country_id: Some("ENG".to_string()),
        priority,
        season: 1,
        participant_ids: clubs.iter().map(|club| club.to_string()).collect(),
        fixtures: vec![
            completed(&format!("{id}-1"), first, second, 1, 0),
            completed(&format!("{id}-2"), second, first, 0, 1),
        ],
        standings: vec![standing(first, 2, 0), standing(second, 0, 2)],
        ..Default::default()
    }
}

/// Two divisions of two clubs each, every league match played: `top-a` beats
/// `top-b` in the first division, `low-a` beats `low-b` in the second, so
/// `top-b` goes down and `low-a` goes up.
fn two_division_game(user_club: &str, reputations: [u32; 4]) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 5, 20, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "mgr_user".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire(user_club.to_string());
    let teams = vec![
        make_team("top-a", "Alpha FC", reputations[0]),
        make_team("top-b", "Bravo FC", reputations[1]),
        make_team("low-a", "Charlie FC", reputations[2]),
        make_team("low-b", "Delta FC", reputations[3]),
    ];
    let first = division("eng-1", 0, ["top-a", "top-b"], true);
    let second = division("eng-2", 1, ["low-a", "low-b"], true);
    let mut game = Game::new(clock, manager, teams, vec![], vec![], vec![]);
    game.league = Some(first.clone());
    game.competitions = vec![first, second];
    game
}

/// Given the user led every league match of a second-division club ranked
/// below its rival by reputation, which won the division and went up,
/// When the season ends,
/// Then the user gains a place above expectation at three quarters weight
/// (8), the second-tier title at three quarters (23) and promotion (20),
/// measured against the club's reputation before the season's results moved it.
#[test]
fn a_promoted_user_gains_for_the_finish_and_the_promotion() {
    let mut game = two_division_game("low-a", [700, 650, 300, 400]);
    game.manager.progression.season_league_matches_led = 2;

    process_end_of_season(&mut game);

    let change = game
        .manager
        .progression
        .reputation_log
        .last()
        .expect("the season was reviewed")
        .clone();
    assert_eq!(change.performance, 8);
    assert_eq!(change.honours, 43);
    assert_eq!(change.club_pull, 0);
    assert_eq!(change.before, 500);
    assert_eq!(change.after, 551);
    assert_eq!(game.manager.reputation, 551);
    assert_eq!(change.team_id.as_deref(), Some("low-a"));
}

/// Given the user's first-division club finished where its reputation put it
/// and went down,
/// When the season ends,
/// Then relegation costs 30.
#[test]
fn a_relegated_user_loses_reputation() {
    let mut game = two_division_game("top-b", [600, 500, 300, 300]);
    game.manager.progression.season_league_matches_led = 2;

    process_end_of_season(&mut game);

    let change = game.manager.progression.reputation_log.last().unwrap();
    assert_eq!(change.performance, 0);
    assert_eq!(change.honours, -30);
    assert_eq!(game.manager.reputation, 470);
}

/// Given a user who took over a relegated club too late to lead any of its
/// league matches,
/// When the season ends,
/// Then neither the finish nor the relegation is theirs.
#[test]
fn a_user_who_led_no_league_match_carries_none_of_the_table() {
    let mut game = two_division_game("top-b", [600, 500, 300, 300]);
    game.manager.progression.season_league_matches_led = 0;

    process_end_of_season(&mut game);

    let change = game.manager.progression.reputation_log.last().unwrap();
    assert_eq!(change.performance, 0);
    assert_eq!(change.honours, 0);
    assert_eq!(change.league_matches_led, 0);
    assert_eq!(change.league_matches_played, 2);
    assert_eq!(game.manager.reputation, 500);
}

/// Given the user won the first division with a club of 900,
/// When the season ends,
/// Then the title is recorded as an honour, counts 30, and the club's name
/// pulls the user up.
#[test]
fn a_league_title_is_an_honour_and_counts_in_full() {
    let mut game = two_division_game("top-a", [900, 500, 300, 300]);
    game.manager.progression.season_league_matches_led = 2;

    process_end_of_season(&mut game);

    let change = game.manager.progression.reputation_log.last().unwrap();
    assert_eq!(change.honours, 30);
    assert_eq!(change.club_pull, 100);
    assert_eq!(game.manager.reputation, 620);
    assert_eq!(game.manager.career_stats.trophies, 1);
}

/// Given a review has run,
/// When the season ends,
/// Then the season's tallies start again from nothing.
#[test]
fn the_season_tallies_are_cleared_after_the_review() {
    let mut game = two_division_game("top-a", [900, 500, 300, 300]);
    game.manager.progression.season_league_matches_led = 2;
    game.manager.progression.season_dismissal = -40;
    game.manager
        .progression
        .season_honours
        .push(domain::manager::Honour {
            competition_id: "eng-cup".to_string(),
            kind: HonourKind::DomesticCup,
            team_id: "top-a".to_string(),
        });

    process_end_of_season(&mut game);

    let progression = &game.manager.progression;
    assert!(progression.season_honours.is_empty());
    assert_eq!(progression.season_league_matches_led, 0);
    assert_eq!(progression.season_dismissal, 0);
    let change = progression.reputation_log.last().unwrap();
    assert_eq!(change.dismissal, -40);
    assert_eq!(change.honours, 50, "title 30 + cup 20");
}

/// Given an AI manager in the world,
/// When the season ends,
/// Then their reputation does not move: only the user's is reviewed.
#[test]
fn ai_managers_keep_their_reputation() {
    let mut game = two_division_game("top-a", [900, 500, 300, 300]);
    game.manager.progression.season_league_matches_led = 2;
    let mut rival = Manager::new(
        "mgr_ai".to_string(),
        "Rival".to_string(),
        "Boss".to_string(),
        "1975-01-01".to_string(),
        "England".to_string(),
    );
    rival.hire("top-b".to_string());
    rival.reputation = 640;
    game.managers.push(rival);

    process_end_of_season(&mut game);

    let rival = game.managers.iter().find(|m| m.id == "mgr_ai").unwrap();
    assert_eq!(rival.reputation, 640);
    assert!(rival.progression.reputation_log.is_empty());
}

/// Given the season was reviewed,
/// When the season ends,
/// Then the user is told the change and its parts.
#[test]
fn the_user_is_told_how_their_reputation_moved() {
    let mut game = two_division_game("low-a", [700, 650, 300, 400]);
    game.manager.progression.season_league_matches_led = 2;

    process_end_of_season(&mut game);

    let message = game
        .messages
        .iter()
        .find(|message| message.id == "manager_reputation_1")
        .expect("the review is announced");
    assert_eq!(
        message.subject_key.as_deref(),
        Some("be.msg.managerReputation.subject")
    );
    assert_eq!(
        message.body_key.as_deref(),
        Some("be.msg.managerReputation.body")
    );
    assert_eq!(message.i18n_params.get("before"), Some(&"500".to_string()));
    assert_eq!(message.i18n_params.get("after"), Some(&"551".to_string()));
    assert_eq!(message.i18n_params.get("delta"), Some(&"+51".to_string()));
    assert_eq!(
        message.i18n_params.get("performance"),
        Some(&"+8".to_string())
    );
    assert_eq!(message.i18n_params.get("honours"), Some(&"+43".to_string()));
}

/// Given a user who led only part of the club's league season,
/// When the season ends,
/// Then the message says how many matches were theirs.
#[test]
fn a_partial_season_message_says_how_many_matches_were_led() {
    let mut game = two_division_game("low-a", [700, 650, 300, 400]);
    game.manager.progression.season_league_matches_led = 1;

    process_end_of_season(&mut game);

    let message = game
        .messages
        .iter()
        .find(|message| message.id == "manager_reputation_1")
        .expect("the review is announced");
    assert_eq!(
        message.body_key.as_deref(),
        Some("be.msg.managerReputation.bodyPartial")
    );
    assert_eq!(message.i18n_params.get("led"), Some(&"1".to_string()));
    assert_eq!(message.i18n_params.get("played"), Some(&"2".to_string()));
}

/// Given a user out of work, whose last review was for season 5, in a world
/// whose fallback competition runs on another calendar (season 1 here),
/// When the season ends,
/// Then the review is the season after the last one, not the fallback's.
#[test]
fn an_unemployed_users_review_follows_on_from_their_last() {
    let mut game = two_division_game("top-a", [900, 500, 300, 300]);
    game.manager.team_id = None;
    game.manager
        .progression
        .reputation_log
        .push(domain::manager::ReputationChange {
            season: 5,
            before: 500,
            after: 540,
            ..Default::default()
        });

    process_end_of_season(&mut game);

    let change = game.manager.progression.reputation_log.last().unwrap();
    assert_eq!(change.season, 6);
    assert_eq!(change.team_id, None);
}
