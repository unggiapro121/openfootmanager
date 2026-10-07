//! Form on the pitch carries over to the training ground.

use super::*;

/// Given two identical regular starters of 19, one in excellent form (8.0) and
/// one in a dreadful run (4.0), on the same club's Physical programme,
/// When they go through the same 150 sessions,
/// Then the one in form gains clearly more — but the one out of form still develops.
#[test]
fn a_player_in_form_develops_faster_than_one_out_of_form() {
    let mut game = make_game();
    let mut in_form = trainee("in_form", 100);
    in_form.match_form = 80;
    let mut out_of_form = trainee("out_of_form", 100);
    out_of_form.match_form = 40;
    game.players = vec![in_form, out_of_form];
    let in_form_before = physical_total(&game, "in_form");
    let out_of_form_before = physical_total(&game, "out_of_form");

    for _ in 0..150 {
        for player in game.players.iter_mut() {
            player.condition = 90;
        }
        game.clock.advance_days(1);
        training::process_training(&mut game, 0);
    }

    let in_form_gain = f64::from(physical_total(&game, "in_form") - in_form_before);
    let out_of_form_gain = f64::from(physical_total(&game, "out_of_form") - out_of_form_before);
    assert!(
        in_form_gain > 1.2 * out_of_form_gain,
        "in form gained {in_form_gain}, out of form gained {out_of_form_gain}"
    );
    assert!(
        out_of_form_gain > 0.0,
        "a poor run slows development, it does not stop it"
    );
}
