//! The user's season tallies kept as matches are played (phase 2 lane M, M-1).

use super::*;
use domain::league::CompetitionFormat;
use domain::manager::HonourKind;

/// The fixture of `make_game_with_match` turned into a one-match knockout
/// competition of `competition` kind: a final between team1 and team2.
fn game_with_final(competition: FixtureCompetition) -> Game {
    let mut game = make_game_with_match();
    let cup = game.league.as_mut().unwrap();
    cup.id = "the-cup".to_string();
    cup.rules.format = CompetitionFormat::Knockout;
    cup.standings.clear();
    cup.fixtures[0].competition = competition;
    cup.knockout_rounds.push(KnockoutRoundState {
        id: "the-cup-final".to_string(),
        name: "Final".to_string(),
        fixture_ids: vec!["fix1".to_string()],
        ..Default::default()
    });
    game
}

/// Given the user's club plays a league match,
/// When the result is applied,
/// Then it counts as a league match the user led this season.
#[test]
fn a_league_match_of_the_users_club_counts_as_one_led() {
    let mut game = make_game_with_match();

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 0));

    assert_eq!(game.manager.progression.season_league_matches_led, 1);
}

/// Given a league match between two clubs the user does not lead,
/// When the result is applied,
/// Then the user's count does not move.
#[test]
fn another_clubs_league_match_does_not_count() {
    let mut game = make_game_with_match();
    game.manager.team_id = Some("team3".to_string());

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 0));

    assert_eq!(game.manager.progression.season_league_matches_led, 0);
}

/// Given the user's club plays a cup tie,
/// When the result is applied,
/// Then it is not a league match and does not count.
#[test]
fn a_cup_match_is_not_a_league_match_led() {
    let mut game = game_with_final(FixtureCompetition::Cup);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 0));

    assert_eq!(game.manager.progression.season_league_matches_led, 0);
}

/// Given the user's club wins a domestic cup final,
/// When the result is applied,
/// Then the cup is the user's honour for the season and a trophy in their record.
#[test]
fn winning_a_cup_final_is_an_honour_and_a_trophy() {
    let mut game = game_with_final(FixtureCompetition::Cup);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(2, 1));

    let honours = &game.manager.progression.season_honours;
    assert_eq!(honours.len(), 1);
    assert_eq!(honours[0].kind, HonourKind::DomesticCup);
    assert_eq!(honours[0].competition_id, "the-cup");
    assert_eq!(honours[0].team_id, "team1");
    assert_eq!(game.manager.career_stats.trophies, 1);
}

/// Given the user's club loses a cup final,
/// When the result is applied,
/// Then nothing is won.
#[test]
fn losing_a_cup_final_wins_nothing() {
    let mut game = game_with_final(FixtureCompetition::Cup);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(0, 1));

    assert!(game.manager.progression.season_honours.is_empty());
    assert_eq!(game.manager.career_stats.trophies, 0);
}

/// Given the user's club wins a continental final, and another a club world final,
/// When each result is applied,
/// Then each is recorded as its own kind of honour.
#[test]
fn a_finals_kind_follows_its_competition() {
    let mut continental = game_with_final(FixtureCompetition::ContinentalClub);
    let mut club_world = game_with_final(FixtureCompetition::InternationalClub);

    turn::apply_match_report(&mut continental, 0, "team1", "team2", &empty_report(1, 0));
    turn::apply_match_report(&mut club_world, 0, "team1", "team2", &empty_report(1, 0));

    assert_eq!(
        continental.manager.progression.season_honours[0].kind,
        HonourKind::Continental
    );
    assert_eq!(
        club_world.manager.progression.season_honours[0].kind,
        HonourKind::ClubWorld
    );
}

/// Given a final won by a club the user does not lead,
/// When the result is applied,
/// Then the user wins nothing.
#[test]
fn another_clubs_final_is_not_the_users_honour() {
    let mut game = game_with_final(FixtureCompetition::Cup);
    game.manager.team_id = Some("team3".to_string());

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(2, 0));

    assert!(game.manager.progression.season_honours.is_empty());
}
