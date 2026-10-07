//! The career's development speed scales every training gain in the world.

use super::*;
use chrono::Datelike;
use ofm_core::development_speed::DevelopmentSpeed;

/// Train `game`'s squad for `days` calendar days, on the days its schedule says.
fn train_for_days(game: &mut Game, days: u32) {
    for _ in 0..days {
        for player in game.players.iter_mut() {
            player.condition = 90;
        }
        game.clock.advance_days(1);
        let weekday = game.clock.current_date.weekday().num_days_from_monday();
        training::process_training(game, weekday);
    }
}

fn game_with_regular_trainee(speed_percent: u16) -> Game {
    let mut game = make_game();
    game.players = vec![trainee("regular", 100)];
    game.development_speed =
        DevelopmentSpeed::from_percent(speed_percent).expect("a speed on the scale");
    game
}

/// Given a regular starter of 19 at a Balanced, Medium-intensity club with a
/// good coach, in a career at the realistic 1×,
/// When he trains for a year with no fixtures to taper for,
/// Then his four physical attributes gain about sixty points between them —
/// roughly fifteen each, not the near-sixty each the old rate gave.
#[test]
fn at_the_realistic_pace_a_regular_gains_about_fifteen_points_an_attribute_in_a_year() {
    let mut game = game_with_regular_trainee(100);
    let before = physical_total(&game, "regular");

    train_for_days(&mut game, 365);

    let gained = physical_total(&game, "regular") - before;
    assert!(
        (40..=85).contains(&gained),
        "a year at 1x gained {gained} physical points"
    );
}

/// Given two identical careers, one at 1× and one at 2×,
/// When the same player trains through the same 150 days in each,
/// Then the player in the 2× career gains about twice as much.
#[test]
fn at_two_times_a_player_develops_about_twice_as_fast() {
    let mut realistic = game_with_regular_trainee(100);
    let mut doubled = game_with_regular_trainee(200);
    let before = physical_total(&realistic, "regular");

    train_for_days(&mut realistic, 150);
    train_for_days(&mut doubled, 150);

    let realistic_gain = f64::from(physical_total(&realistic, "regular") - before);
    let doubled_gain = f64::from(physical_total(&doubled, "regular") - before);
    let ratio = doubled_gain / realistic_gain;
    assert!(
        (1.6..=2.4).contains(&ratio),
        "1x gained {realistic_gain}, 2x gained {doubled_gain} (ratio {ratio:.2})"
    );
}
