//! Matches finish what training starts: a player who plays develops faster than
//! one who only trains.

use super::*;

/// Given two identical 19-year-olds with room to grow, one a regular starter and
/// one who has not played for weeks, on the same club's Physical programme,
/// When they go through the same 150 sessions,
/// Then the regular gains well over one and a half times as much.
#[test]
fn a_regular_starter_develops_faster_than_a_player_who_only_trains() {
    let mut game = make_game();
    game.players = vec![trainee("regular", 100), trainee("unused", 0)];
    let regular_before = physical_total(&game, "regular");
    let unused_before = physical_total(&game, "unused");

    for _ in 0..150 {
        for player in game.players.iter_mut() {
            player.condition = 90;
        }
        // A fresh day each time, so each session draws its own dice.
        game.clock.advance_days(1);
        training::process_training(&mut game, 0);
    }

    let regular_gain = physical_total(&game, "regular") - regular_before;
    let unused_gain = physical_total(&game, "unused") - unused_before;
    assert!(
        f64::from(regular_gain) > 1.5 * f64::from(unused_gain),
        "regular gained {regular_gain}, unused gained {unused_gain}"
    );
}
