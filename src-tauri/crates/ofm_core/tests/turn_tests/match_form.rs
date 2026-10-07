//! A rated match moves the form of the player who played it.

use super::*;

fn form_of(game: &Game, player_id: &str) -> u8 {
    game.players
        .iter()
        .find(|player| player.id == player_id)
        .map(|player| player.match_form)
        .expect("player exists")
}

/// Given a forward in ordinary form (6.0),
/// When a match is applied in which he is rated 7.5,
/// Then his form rises toward it.
#[test]
fn a_rated_match_moves_the_players_form() {
    let mut game = make_game_with_match();
    let report = report_with_scorer(1, 0, "t1_fwd0", Side::Home);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    assert_eq!(form_of(&game, "t1_fwd0"), 63);
}

/// Given a teammate in good form (7.0) who did not play,
/// When the match is applied,
/// Then his form is where it was: a game he missed says nothing about it.
#[test]
fn a_player_who_did_not_play_keeps_his_form() {
    let mut game = make_game_with_match();
    for player in game.players.iter_mut().filter(|p| p.id == "t1_fwd1") {
        player.match_form = 70;
    }
    let report = report_with_scorer(1, 0, "t1_fwd0", Side::Home);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    assert_eq!(form_of(&game, "t1_fwd1"), 70);
}
