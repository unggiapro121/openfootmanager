//! A club's match is recorded in the playing time of everyone on its books.

use super::*;

fn playing_time_of(game: &Game, player_id: &str) -> u8 {
    game.players
        .iter()
        .find(|player| player.id == player_id)
        .map(|player| player.playing_time)
        .expect("player exists")
}

fn set_everyones_playing_time(game: &mut Game, playing_time: u8) {
    for player in game.players.iter_mut() {
        player.playing_time = playing_time;
    }
}

/// Given two clubs whose players all sit at 60,
/// When a match between them is applied and one home forward plays all ninety minutes,
/// Then his playing time rises.
#[test]
fn a_player_who_plays_the_whole_match_gains_playing_time() {
    let mut game = make_game_with_match();
    set_everyones_playing_time(&mut game, 60);
    let report = report_with_scorer(1, 0, "t1_fwd0", Side::Home);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    assert_eq!(playing_time_of(&game, "t1_fwd0"), 66);
}

/// Given two clubs whose players all sit at 60,
/// When a match between them is applied in which a player on either side never got on,
/// Then those players lose playing time, on both sides.
#[test]
fn players_left_out_of_the_match_lose_playing_time_on_both_sides() {
    let mut game = make_game_with_match();
    set_everyones_playing_time(&mut game, 60);
    let report = report_with_scorer(1, 0, "t1_fwd0", Side::Home);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    assert_eq!(playing_time_of(&game, "t1_fwd1"), 51);
    assert_eq!(playing_time_of(&game, "t2_fwd0"), 51);
}

/// Given a third club with no fixture today, its player at 60,
/// When a match between two other clubs is applied,
/// Then his playing time is untouched: it was not his club's match.
#[test]
fn a_match_between_other_clubs_leaves_playing_time_alone() {
    let mut game = make_game_with_match();
    game.players.push(make_player(
        "t3_fwd0",
        "Outsider",
        "team3",
        Position::Forward,
    ));
    set_everyones_playing_time(&mut game, 60);
    let report = report_with_scorer(1, 0, "t1_fwd0", Side::Home);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    assert_eq!(playing_time_of(&game, "t3_fwd0"), 60);
}
