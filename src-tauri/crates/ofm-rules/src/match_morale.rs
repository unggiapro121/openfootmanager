//! How a match moves a player's morale: the team's result and his own part in it. Shared by the
//! desktop's post-match step and the online server's settling, so a player's spirits move the same
//! way in both modes.

use domain::player::Player;
use engine::PlayerMatchStats;
use rand::{Rng, RngExt};

/// A player's morale never falls under this, nor rises over 100.
pub const MORALE_FLOOR: i16 = 10;

/// A positive swing, held back while an unresolved issue (a broken promise, say) weighs on him:
/// halved from severity 50, none from 75.
pub fn capped_positive_recovery(delta: i16, player: &Player) -> i16 {
    let Some(issue) = player.morale_core.unresolved_issue.as_ref() else {
        return delta;
    };
    if delta <= 0 {
        return delta;
    }
    if issue.severity >= 75 {
        return 0;
    }
    if issue.severity >= 50 {
        return ((delta + 1) / 2).max(1);
    }
    delta
}

/// The swing the result gives every player of a side: a win lifts, a draw is mild, a loss costs,
/// more for each goal of margin beyond the first. One draw of `rng`.
pub fn result_delta<R: Rng + ?Sized>(
    rng: &mut R,
    won: bool,
    drawn: bool,
    goal_difference: i16,
) -> i16 {
    if won {
        rng.random_range(3..=8)
    } else if drawn {
        rng.random_range(-2..=3)
    } else {
        let base_loss = rng.random_range(-5..=-2);
        let margin_penalty = (goal_difference.abs() - 1).max(0) * -3;
        base_loss + margin_penalty
    }
}

/// What his own match did: goals and assists lift, a red card tanks, a poor rating costs and a
/// fine one lifts. An unrated cameo (0.0) is not a poor game.
pub fn individual_delta(stats: &PlayerMatchStats) -> i16 {
    let mut delta = i16::from(stats.goals) * 3 + i16::from(stats.assists) * 2;
    if stats.red_cards > 0 {
        delta -= 8;
    }
    if stats.rating > 0.0 && stats.rating < 5.5 {
        delta -= 3;
    } else if stats.rating > 7.5 {
        delta += 2;
    }
    delta
}

/// `player`'s morale after a match, given the side's `result` swing and his own `stats`, if he
/// played.
pub fn morale_after(player: &Player, result: i16, stats: Option<&PlayerMatchStats>) -> u8 {
    let total = capped_positive_recovery(result + stats.map_or(0, individual_delta), player);
    (i16::from(player.morale) + total).clamp(MORALE_FLOOR, 100) as u8
}

#[cfg(test)]
mod tests {
    use domain::player::{PlayerIssue, PlayerIssueCategory};
    use rand::SeedableRng;
    use rand_chacha::ChaCha12Rng;

    use super::*;

    fn player(morale: u8) -> Player {
        let mut player = Player::new(
            "p".into(),
            "P".into(),
            "Player".into(),
            "2000-01-01".into(),
            "VN".into(),
            domain::player::Position::Forward,
            domain::player::PlayerAttributes {
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
                long_passing: 0,
                crossing: 0,
                curve: 0,
                free_kick: 0,
                long_shots: 0,
                first_touch: 0,
                heading: 0,
            },
        );
        player.morale = morale;
        player
    }

    fn stats(goals: u8, assists: u8, red: u8, rating: f32) -> PlayerMatchStats {
        PlayerMatchStats {
            goals,
            assists,
            red_cards: red,
            rating,
            ..PlayerMatchStats::default()
        }
    }

    /// Given a win, a draw and losses by one, two and four goals,
    /// when the result swings are drawn over many seeds,
    /// then a win is 3 to 8, a draw -2 to 3, and a loss -5 to -2 less 3 for each goal beyond one.
    #[test]
    fn the_result_swing_follows_the_margin() {
        for seed in 0..200 {
            let mut rng = ChaCha12Rng::seed_from_u64(seed);
            assert!((3..=8).contains(&result_delta(&mut rng, true, false, 2)));
            assert!((-2..=3).contains(&result_delta(&mut rng, false, true, 0)));
            assert!((-5..=-2).contains(&result_delta(&mut rng, false, false, 1)));
            assert!((-11..=-8).contains(&result_delta(&mut rng, false, false, 3)));
        }
    }

    /// Given a scorer, a sent-off player, a poor game, a fine one and an unrated cameo,
    /// when each one's own swing is worked out,
    /// then goals and assists lift, a red card and a poor rating cost, a fine rating lifts, and
    /// the cameo is neither.
    #[test]
    fn his_own_match_moves_him() {
        assert_eq!(individual_delta(&stats(2, 1, 0, 6.5)), 8);
        assert_eq!(individual_delta(&stats(0, 0, 1, 6.0)), -8);
        assert_eq!(individual_delta(&stats(0, 0, 0, 4.9)), -3);
        assert_eq!(individual_delta(&stats(0, 0, 0, 7.9)), 2);
        assert_eq!(individual_delta(&stats(0, 0, 0, 0.0)), 0);
    }

    /// Given a player with a severe issue, one with a middling one, and one with none,
    /// when a win of +6 is put to each,
    /// then the first gets nothing, the second half, the third all of it; a loss is never held back.
    #[test]
    fn an_issue_holds_back_a_recovery_but_not_a_loss() {
        let issue = |severity| {
            let mut p = player(50);
            p.morale_core.unresolved_issue = Some(PlayerIssue {
                category: PlayerIssueCategory::PlayingTime,
                severity,
            });
            p
        };
        assert_eq!(capped_positive_recovery(6, &issue(80)), 0);
        assert_eq!(capped_positive_recovery(6, &issue(60)), 3);
        assert_eq!(capped_positive_recovery(6, &player(50)), 6);
        assert_eq!(capped_positive_recovery(-6, &issue(80)), -6);
    }

    /// Given players near both ends,
    /// when a big swing is applied,
    /// then morale stays between its floor and 100.
    #[test]
    fn morale_stays_in_its_range() {
        assert_eq!(morale_after(&player(98), 8, None), 100);
        assert_eq!(
            morale_after(&player(12), -11, Some(&stats(0, 0, 1, 4.0))),
            MORALE_FLOOR as u8
        );
        assert_eq!(morale_after(&player(50), 4, Some(&stats(1, 0, 0, 6.0))), 57);
    }
}
