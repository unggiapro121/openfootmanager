//! The user's career record kept match by match (after GĐ5): the manager
//! screen shows the season so far, cups included, not zeros until May.

use super::*;
use domain::league::CompetitionFormat;

/// The fixture of `make_game_with_match` as a one-match knockout tie of
/// `competition` kind between team1 and team2.
fn game_with_tie(competition: FixtureCompetition) -> Game {
    let mut game = make_game_with_match();
    let cup = game.league.as_mut().unwrap();
    cup.id = "the-cup".to_string();
    cup.rules.format = CompetitionFormat::Knockout;
    cup.standings.clear();
    cup.fixtures[0].competition = competition;
    game
}

fn open_entry(game: &Game) -> Option<&domain::manager::ManagerCareerEntry> {
    game.manager
        .career_history
        .iter()
        .find(|entry| entry.team_id == "team1" && entry.end_date.is_none())
}

/// Given the user's club wins a league match,
/// When the result is applied,
/// Then the career record and the club's history entry count it at once.
#[test]
fn a_league_win_counts_in_the_career_at_once() {
    let mut game = make_game_with_match();

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(2, 1));

    let stats = &game.manager.career_stats;
    assert_eq!(
        (stats.matches_managed, stats.wins, stats.draws, stats.losses),
        (1, 1, 0, 0)
    );
    let entry = open_entry(&game).expect("an open history entry for the club");
    assert_eq!(
        (entry.matches, entry.wins, entry.draws, entry.losses),
        (1, 1, 0, 0)
    );
}

/// Given the user's club loses at home,
/// When the result is applied,
/// Then it counts as a loss.
#[test]
fn a_league_defeat_counts_as_a_loss() {
    let mut game = make_game_with_match();

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(0, 3));

    let stats = &game.manager.career_stats;
    assert_eq!((stats.matches_managed, stats.wins, stats.losses), (1, 0, 1));
}

/// Given the user's club draws a cup tie (a shoot-out decides it later),
/// When the result is applied,
/// Then the cup match counts too, as a draw.
#[test]
fn a_cup_tie_counts_too() {
    let mut game = game_with_tie(FixtureCompetition::Cup);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 1));

    let stats = &game.manager.career_stats;
    assert_eq!((stats.matches_managed, stats.draws), (1, 1));
}

/// Given the user's club plays a friendly,
/// When the result is applied,
/// Then the career record does not move.
#[test]
fn a_friendly_does_not_count() {
    let mut game = game_with_tie(FixtureCompetition::Friendly);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(3, 0));

    assert_eq!(game.manager.career_stats.matches_managed, 0);
}

/// Given a match between two clubs the user does not lead,
/// When the result is applied,
/// Then the user's record does not move.
#[test]
fn another_clubs_match_does_not_count() {
    let mut game = make_game_with_match();
    game.manager.team_id = Some("team3".to_string());

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(3, 0));

    assert_eq!(game.manager.career_stats.matches_managed, 0);
}
