//! How much a player has been playing lately, and what that does for his development.
//!
//! Training builds a player, but only matches finish the job: a youngster who
//! trains with the first team and never plays should not keep pace with one who
//! starts every week. `Player::playing_time` is the record of the one, and
//! `development_factor` is what it is worth on the training ground.

use domain::player::Player;

/// Weight of the latest match in the moving average. At 0.15 the last seven
/// fixtures carry about two thirds of the value, so a dropped starter loses his
/// edge over a month or so rather than overnight, and one good week off the
/// bench does not make a regular.
const LATEST_MATCH_WEIGHT: f64 = 0.15;

const FULL_MATCH_MINUTES: f64 = 90.0;

/// At or above this a player is a regular and develops at the full rate. Below
/// 100 on purpose: a starter routinely substituted on the hour is still a starter.
const REGULAR_PLAYING_TIME: u8 = 80;

/// The share of the full rate that training alone still gives a player who never
/// plays. Not zero: practice still teaches, it just teaches slower.
const UNUSED_DEVELOPMENT_SHARE: f64 = 0.4;

/// Fold one of his club's matches into a player's playing time.
///
/// Called for every player on both clubs' books, including the ones who did not
/// get on: an unused player's zero is exactly the information this records.
/// Extra time counts as a full match, not more — a 120-minute cup tie does not
/// make anyone more of a regular than a league game does.
pub(crate) fn record_club_match(player: &mut Player, minutes_played: u8) {
    let this_match = (f64::from(minutes_played) / FULL_MATCH_MINUTES).min(1.0) * 100.0;
    let updated = f64::from(player.playing_time) * (1.0 - LATEST_MATCH_WEIGHT)
        + this_match * LATEST_MATCH_WEIGHT;
    player.playing_time = updated.round().clamp(0.0, 100.0) as u8;
}

/// The multiplier playing time puts on a player's training gains, from
/// `UNUSED_DEVELOPMENT_SHARE` for a player who never plays up to 1.0 for a regular.
pub(crate) fn development_factor(playing_time: u8) -> f64 {
    let regularity =
        f64::from(playing_time.min(REGULAR_PLAYING_TIME)) / f64::from(REGULAR_PLAYING_TIME);
    UNUSED_DEVELOPMENT_SHARE + (1.0 - UNUSED_DEVELOPMENT_SHARE) * regularity
}

#[cfg(test)]
mod tests {
    use super::{development_factor, record_club_match};
    use domain::player::{Player, PlayerAttributes, Position};

    fn player_with_playing_time(playing_time: u8) -> Player {
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
        player.playing_time = playing_time;
        player
    }

    /// Given a player at 60,
    /// When he plays all ninety minutes of his club's match,
    /// Then his playing time moves 15% of the way to 100.
    #[test]
    fn a_full_match_moves_playing_time_toward_a_hundred() {
        let mut player = player_with_playing_time(60);

        record_club_match(&mut player, 90);

        assert_eq!(player.playing_time, 66);
    }

    /// Given a player at 60,
    /// When his club plays and he does not get on,
    /// Then his playing time moves 15% of the way to zero.
    #[test]
    fn an_unused_player_drifts_toward_zero() {
        let mut player = player_with_playing_time(60);

        record_club_match(&mut player, 0);

        assert_eq!(player.playing_time, 51);
    }

    /// Given a player at 60,
    /// When he comes on for the last half hour,
    /// Then the match counts as a third of a full one.
    #[test]
    fn a_substitute_appearance_counts_in_proportion_to_its_minutes() {
        let mut player = player_with_playing_time(60);

        record_club_match(&mut player, 30);

        assert_eq!(player.playing_time, 56);
    }

    /// Given a player at 60,
    /// When he plays 120 minutes of a cup tie that goes to extra time,
    /// Then it counts the same as a full ninety, not more.
    #[test]
    fn extra_time_counts_no_more_than_a_full_match() {
        let mut player = player_with_playing_time(60);

        record_club_match(&mut player, 120);

        assert_eq!(player.playing_time, 66);
    }

    /// Given a player at the neutral 50,
    /// When he starts and finishes ten matches in a row,
    /// Then he has become a regular.
    #[test]
    fn ten_straight_starts_make_a_regular() {
        let mut player = player_with_playing_time(50);

        for _ in 0..10 {
            record_club_match(&mut player, 90);
        }

        assert!(
            development_factor(player.playing_time) >= 1.0,
            "after ten full matches playing time is {}",
            player.playing_time
        );
    }

    /// Given a player who has not played at all,
    /// When his training gains are weighed,
    /// Then he develops at 40% of a regular's rate.
    #[test]
    fn a_player_who_never_plays_develops_at_forty_percent() {
        assert!((development_factor(0) - 0.4).abs() < 1e-9);
    }

    /// Given a regular, and a player who plays every minute of every game,
    /// When their training gains are weighed,
    /// Then both develop at the full rate.
    #[test]
    fn a_regular_develops_at_the_full_rate() {
        assert!((development_factor(80) - 1.0).abs() < 1e-9);
        assert!((development_factor(100) - 1.0).abs() < 1e-9);
    }

    /// Given a player halfway to being a regular,
    /// When his training gains are weighed,
    /// Then he sits halfway between the floor and the full rate.
    #[test]
    fn half_a_regular_develops_halfway_between_the_floor_and_the_full_rate() {
        assert!((development_factor(40) - 0.7).abs() < 1e-9);
    }
}
