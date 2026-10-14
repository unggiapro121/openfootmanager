//! The training facility scales what every player gains from a session.

use super::*;

fn game_with_trainee_at(training_level: u8) -> Game {
    let mut game = make_game();
    game.players = vec![trainee("regular", 100)];
    game.teams[0].facilities.training = training_level;
    game
}

/// Given two identical clubs, one with a level-1 and one with a level-10
/// training facility,
/// When the same player trains through the same year at each,
/// Then he gains about 18% more at the level-10 club.
#[test]
fn a_top_training_facility_speeds_development_by_about_a_fifth() {
    let mut basic = game_with_trainee_at(1);
    let mut top = game_with_trainee_at(10);
    let before = physical_total(&basic, "regular");

    train_for_days(&mut basic, 365);
    train_for_days(&mut top, 365);

    let basic_gain = f64::from(physical_total(&basic, "regular") - before);
    let top_gain = f64::from(physical_total(&top, "regular") - before);
    let ratio = top_gain / basic_gain;
    assert!(
        (1.08..=1.30).contains(&ratio),
        "level 1 gained {basic_gain}, level 10 gained {top_gain} (ratio {ratio:.2})"
    );
}

/// Given a player who has reached his potential, at a level-10 training facility,
/// When he trains for a year,
/// Then his attributes do not rise: the facility does not lift the ceiling.
#[test]
fn a_top_training_facility_does_not_lift_a_peaked_player() {
    let mut game = game_with_trainee_at(10);
    let year = 2025;
    let player = &mut game.players[0];
    // 0 means "not yet set"; 1 is clamped up to his overall.
    player.potential = 1;
    refresh_player_derived(player, year);
    let before = physical_total(&game, "regular");

    train_for_days(&mut game, 365);

    assert!(physical_total(&game, "regular") <= before);
}
