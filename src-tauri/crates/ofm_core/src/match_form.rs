//! A player's recent form, read from his match ratings, and what it is worth on
//! the training ground.
//!
//! `playing_time` says whether a player is getting games; this says whether he
//! is doing anything with them. A youngster in good form keeps improving
//! faster; one having a poor run slows a little — never by much, because a bad
//! month is not supposed to undo a season's work.

use domain::player::Player;

/// Weight of the latest rated match in the moving average. At 0.2 the last five
/// rated games carry about two thirds of the value.
const LATEST_RATING_WEIGHT: f64 = 0.2;

/// An ordinary game, in tenths: the form at which development runs at the
/// plain rate. Ratings centre on 6.0, so this is where an ordinary player sits.
const ORDINARY_FORM: f64 = 60.0;

/// How much each point of form above or below ordinary moves development.
const DEVELOPMENT_PER_POINT_OF_FORM: f64 = 0.15;

/// A poor run slows development, but only a little.
const SLOWEST_FORM_FACTOR: f64 = 0.9;
/// Excellent form speeds it up, to a point.
const FASTEST_FORM_FACTOR: f64 = 1.3;

/// Fold one rated match into a player's form. A rating of 0.0 means he was not
/// rated (too few minutes) and leaves his form alone.
pub(crate) fn record_rated_match(player: &mut Player, rating: f32) {
    if rating <= 0.0 {
        return;
    }
    let rating_in_tenths = f64::from(rating) * 10.0;
    let updated = f64::from(player.match_form) * (1.0 - LATEST_RATING_WEIGHT)
        + rating_in_tenths * LATEST_RATING_WEIGHT;
    player.match_form = updated.round().clamp(0.0, 100.0) as u8;
}

/// The multiplier form puts on a player's training gains: 1.0 in ordinary form,
/// down to 0.9 in a poor run and up to 1.3 in excellent form.
pub(crate) fn development_factor(match_form: u8) -> f64 {
    let points_from_ordinary = (f64::from(match_form) - ORDINARY_FORM) / 10.0;
    (1.0 + DEVELOPMENT_PER_POINT_OF_FORM * points_from_ordinary)
        .clamp(SLOWEST_FORM_FACTOR, FASTEST_FORM_FACTOR)
}

#[cfg(test)]
mod tests {
    use super::{development_factor, record_rated_match};
    use domain::player::{Player, PlayerAttributes, Position};

    fn player_in_form(match_form: u8) -> Player {
        let mut player = Player::new(
            "p1".to_string(),
            "P. One".to_string(),
            "Player One".to_string(),
            "2006-04-01".to_string(),
            "GB".to_string(),
            Position::Forward,
            PlayerAttributes {
                pace: 60,
                stamina: 60,
                strength: 60,
                agility: 60,
                passing: 60,
                shooting: 60,
                tackling: 60,
                dribbling: 60,
                defending: 60,
                positioning: 60,
                vision: 60,
                decisions: 60,
                composure: 60,
                aggression: 60,
                teamwork: 60,
                leadership: 60,
                handling: 20,
                reflexes: 20,
                aerial: 60,
            },
        );
        player.match_form = match_form;
        player
    }

    /// Given a player in ordinary form (6.0),
    /// When he is rated 8.0,
    /// Then his form moves a fifth of the way there, to 6.4.
    #[test]
    fn a_good_game_lifts_form() {
        let mut player = player_in_form(60);

        record_rated_match(&mut player, 8.0);

        assert_eq!(player.match_form, 64);
    }

    /// Given a player in ordinary form (6.0),
    /// When he is rated 4.5,
    /// Then his form drops a fifth of the way there, to 5.7.
    #[test]
    fn a_poor_game_lowers_form() {
        let mut player = player_in_form(60);

        record_rated_match(&mut player, 4.5);

        assert_eq!(player.match_form, 57);
    }

    /// Given a player in good form (7.0),
    /// When he comes on too late to be rated,
    /// Then his form is untouched.
    #[test]
    fn an_unrated_cameo_leaves_form_alone() {
        let mut player = player_in_form(70);

        record_rated_match(&mut player, 0.0);

        assert_eq!(player.match_form, 70);
    }

    /// Given a player in ordinary form,
    /// When his training gains are weighed,
    /// Then form neither helps nor hinders him.
    #[test]
    fn ordinary_form_develops_at_the_plain_rate() {
        assert!((development_factor(60) - 1.0).abs() < 1e-9);
    }

    /// Given a player in good form (7.0),
    /// When his training gains are weighed,
    /// Then he develops 15% faster.
    #[test]
    fn good_form_speeds_development() {
        assert!((development_factor(70) - 1.15).abs() < 1e-9);
    }

    /// Given a player in excellent form, and one in sensational form,
    /// When their training gains are weighed,
    /// Then both are capped at 30% faster.
    #[test]
    fn excellent_form_is_capped_at_thirty_percent_faster() {
        assert!((development_factor(80) - 1.3).abs() < 1e-9);
        assert!((development_factor(95) - 1.3).abs() < 1e-9);
    }

    /// Given a player in a poor run, and one in a dreadful run,
    /// When their training gains are weighed,
    /// Then neither slows by more than 10%.
    #[test]
    fn poor_form_slows_development_by_at_most_ten_percent() {
        assert!((development_factor(55) - 0.925).abs() < 1e-9);
        assert!((development_factor(40) - 0.9).abs() < 1e-9);
    }
}
