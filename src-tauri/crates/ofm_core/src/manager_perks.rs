//! What the user's reputation is worth off the pitch (phase 2 lane M, M-5):
//! players settle for less, sponsors pay more. Offline only (X19): an online
//! session must not buy an advantage with a reputation earned elsewhere, so
//! every perk passes through [`financial_perks_apply`].

use crate::game::Game;

/// The share off a player's wage demand a reputation of 900 or more earns.
const WAGE_DISCOUNT_MAX: f64 = 0.15;
/// The share added to a sponsor's offer a reputation of 900 or more earns.
const SPONSOR_UPLIFT_MAX: f64 = 0.10;
/// Perks start above the reputation every manager begins with, and reach
/// their full value here.
const PERKS_FROM: f64 = domain::manager::STARTING_REPUTATION as f64;
const PERKS_FULL_AT: f64 = 900.0;

/// Whether this session pays the user's reputation perks. Always, for now:
/// there are only offline sessions. G-1, which brings online sessions, turns
/// it off for them.
pub fn financial_perks_apply(game: &Game) -> bool {
    let _ = game;
    true
}

/// How far between nothing (at the starting reputation) and the full perk
/// (at 900) `reputation` stands.
fn perk_share(reputation: u32) -> f64 {
    ((f64::from(reputation) - PERKS_FROM) / (PERKS_FULL_AT - PERKS_FROM)).clamp(0.0, 1.0)
}

/// The share off a wage demand the user's club gets, when perks apply.
fn wage_discount_for(perks_apply: bool, reputation: u32) -> f64 {
    if !perks_apply {
        return 0.0;
    }
    WAGE_DISCOUNT_MAX * perk_share(reputation)
}

/// The share added to a sponsor's offer to the user's club, when perks apply.
fn sponsor_uplift_for(perks_apply: bool, reputation: u32) -> f64 {
    if !perks_apply {
        return 0.0;
    }
    SPONSOR_UPLIFT_MAX * perk_share(reputation)
}

fn is_users_club(game: &Game, team_id: &str) -> bool {
    game.manager.team_id.as_deref() == Some(team_id)
}

/// The share off what players ask `team_id` to pay them: the user's reputation
/// at work, so nothing for any club but the user's.
pub fn wage_discount(game: &Game, team_id: &str) -> f64 {
    if !is_users_club(game, team_id) {
        return 0.0;
    }
    wage_discount_for(financial_perks_apply(game), game.manager.reputation)
}

/// The share added to what a sponsor offers `team_id`; nothing for any club
/// but the user's.
pub fn sponsor_uplift(game: &Game, team_id: &str) -> f64 {
    if !is_users_club(game, team_id) {
        return 0.0;
    }
    sponsor_uplift_for(financial_perks_apply(game), game.manager.reputation)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(left: f64, right: f64) -> bool {
        (left - right).abs() < 1e-9
    }

    /// Given reputations of 500, 700, 900 and 1000,
    /// When the wage discount is read,
    /// Then it is 0, 7.5%, 15% and still 15%.
    #[test]
    fn the_wage_discount_grows_from_the_start_to_nine_hundred() {
        assert!(close(wage_discount_for(true, 500), 0.0));
        assert!(close(wage_discount_for(true, 700), 0.075));
        assert!(close(wage_discount_for(true, 900), 0.15));
        assert!(close(wage_discount_for(true, 1000), 0.15));
        assert!(close(wage_discount_for(true, 300), 0.0));
    }

    /// Given the same reputations,
    /// When the sponsor uplift is read,
    /// Then it is 0, 5%, 10% and still 10%.
    #[test]
    fn the_sponsor_uplift_grows_from_the_start_to_nine_hundred() {
        assert!(close(sponsor_uplift_for(true, 500), 0.0));
        assert!(close(sponsor_uplift_for(true, 700), 0.05));
        assert!(close(sponsor_uplift_for(true, 900), 0.10));
        assert!(close(sponsor_uplift_for(true, 1000), 0.10));
    }

    /// Given a session where perks do not apply (an online one, once there are),
    /// When either perk is read at a reputation of 900,
    /// Then both are nothing.
    #[test]
    fn no_perk_applies_when_the_session_pays_none() {
        assert!(close(wage_discount_for(false, 900), 0.0));
        assert!(close(sponsor_uplift_for(false, 900), 0.0));
    }

    /// Given a user at 900,
    /// When the perks for their club and for another club are read,
    /// Then only their own club gets them.
    #[test]
    fn only_the_users_club_gets_the_perks() {
        use chrono::{TimeZone, Utc};
        let mut manager = domain::manager::Manager::new(
            "mgr_user".to_string(),
            "Sam".to_string(),
            "Boss".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("club-a".to_string());
        manager.reputation = 900;
        let clock =
            crate::clock::GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let game = Game::new(clock, manager, vec![], vec![], vec![], vec![]);

        assert!(close(wage_discount(&game, "club-a"), 0.15));
        assert!(close(wage_discount(&game, "club-b"), 0.0));
        assert!(close(sponsor_uplift(&game, "club-a"), 0.10));
        assert!(close(sponsor_uplift(&game, "club-b"), 0.0));
    }
}
