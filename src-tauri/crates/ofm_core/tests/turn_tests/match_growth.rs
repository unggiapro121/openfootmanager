//! "Tập tích — trận trả" (E5-12) is off in the game: a match pays no pool.

use super::*;

/// Given two clubs whose players each hold a pool and a bar, as an online season would leave
/// them,
/// When a league match between them is applied in the game,
/// Then no pool is paid and no bar moves: the game has no match growth (E5-12 O-1).
#[test]
fn a_match_in_the_game_pays_no_pool() {
    let mut game = make_game_with_match();
    for player in game.players.iter_mut() {
        player.match_xp_pending = 60;
        player.match_xp = 70;
    }
    let report = report_with_scorer(1, 0, "t1_fwd0", Side::Home);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    for player in &game.players {
        assert_eq!(
            (player.match_xp_pending, player.match_xp),
            (60, 70),
            "{}",
            player.id
        );
    }
}
