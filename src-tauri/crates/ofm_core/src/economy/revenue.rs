//! What a club earns, and so what it can afford to pay.
//!
//! Income grows steeply with reputation, as it does in real football: a club
//! at the top of the game earns well over a hundred million a season, one in
//! the lowest tier a few million. It comes from three streams. Broadcast money
//! and commercial income arrive every week. Matchday income depends on how many
//! fans the club draws and what it charges them.

use domain::team::Team;

use super::valuation::TOP_REPUTATION;

/// Broadcast plus commercial income a season, at the top of the reputation scale.
const TOP_CLUB_CENTRAL_INCOME: f64 = 120_000_000.0;
/// What even the smallest professional club earns from television and sponsors.
const BASE_CENTRAL_INCOME: f64 = 1_000_000.0;
/// Broadcast's share of central income. The rest is commercial.
const BROADCAST_SHARE: f64 = 0.55;

const HOME_LEAGUE_GAMES_PER_SEASON: i64 = 19;
const WEEKS_PER_SEASON: i64 = 52;

/// The share of income a club can spend on wages and stay solvent. Real clubs
/// run at 50–70%; UEFA caps squad cost at 70%.
const WAGE_SHARE_OF_REVENUE: f64 = 0.6;
/// Cash a club opens a career with, as a share of a season's income.
const OPENING_CASH_SHARE_OF_REVENUE: f64 = 0.35;
/// A rich club pays above the market rate, a poor one far below it.
const MAX_PAY_LEVEL: f64 = 1.5;
const MIN_PAY_LEVEL: f64 = 0.05;

fn reputation_share(reputation: u32) -> f64 {
    f64::from(reputation) / TOP_REPUTATION
}

/// Broadcast plus commercial income a season.
fn season_central_income(reputation: u32) -> f64 {
    BASE_CENTRAL_INCOME + TOP_CLUB_CENTRAL_INCOME * reputation_share(reputation).powi(3)
}

pub fn weekly_broadcast_income(reputation: u32) -> i64 {
    (season_central_income(reputation) * BROADCAST_SHARE / WEEKS_PER_SEASON as f64) as i64
}

pub fn weekly_commercial_income(reputation: u32) -> i64 {
    (season_central_income(reputation) * (1.0 - BROADCAST_SHARE) / WEEKS_PER_SEASON as f64) as i64
}

/// Average ticket price: about €25 in the lowest tiers, near €100 at the top.
pub fn ticket_price(reputation: u32) -> f64 {
    15.0 + 85.0 * reputation_share(reputation).min(1.1)
}

/// How many fans want a ticket for an ordinary home game. A big club fills a
/// big stadium; a small one does not, however large its ground.
pub(crate) fn matchday_demand(reputation: u32) -> u32 {
    let reputation = f64::from(reputation);
    (3_000.0 + reputation * reputation * 0.08) as u32
}

/// Gate receipts for one home game. `turnout` scales the usual demand (1.0 is
/// an ordinary game) and attendance is capped by the stadium.
pub fn matchday_gate(reputation: u32, stadium_capacity: u32, turnout: f64) -> i64 {
    let attendance =
        (f64::from(matchday_demand(reputation)) * turnout).min(f64::from(stadium_capacity));
    (attendance * ticket_price(reputation)) as i64
}

/// A season's income from broadcast, commercial and ordinary home gates.
/// Prize money and transfers are left out: no club can plan on them.
pub(crate) fn projected_season_revenue(team: &Team) -> i64 {
    season_central_income(team.reputation) as i64
        + matchday_gate(team.reputation, team.stadium_capacity, 1.0) * HOME_LEAGUE_GAMES_PER_SEASON
}

/// What the club can spend on player wages a week and stay solvent.
pub(crate) fn weekly_wage_capacity(team: &Team) -> i64 {
    (projected_season_revenue(team) as f64 * WAGE_SHARE_OF_REVENUE / WEEKS_PER_SEASON as f64) as i64
}

pub(crate) fn opening_cash(team: &Team) -> i64 {
    (projected_season_revenue(team) as f64 * OPENING_CASH_SHARE_OF_REVENUE) as i64
}

/// The pay level that brings a weekly wage bill of `market_bill` within `capacity`.
pub(crate) fn pay_level_for(capacity: i64, market_bill: f64) -> f64 {
    if market_bill <= 0.0 {
        return MAX_PAY_LEVEL;
    }
    (capacity as f64 / market_bill).clamp(MIN_PAY_LEVEL, MAX_PAY_LEVEL)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn club(reputation: u32, stadium_capacity: u32) -> Team {
        let mut team = Team::new(
            "t1".to_string(),
            "Club".to_string(),
            "CLB".to_string(),
            "GB".to_string(),
            "Town".to_string(),
            "Ground".to_string(),
            stadium_capacity,
        );
        team.reputation = reputation;
        team
    }

    /// Given a club at the top of the game with a large stadium,
    /// When its season's income is projected,
    /// Then it earns on the real-world scale, well over €100M.
    #[test]
    fn a_top_club_earns_on_the_real_world_scale() {
        let revenue = projected_season_revenue(&club(875, 60_000));

        assert!(revenue > 100_000_000, "{revenue}");
    }

    /// Given a club near the bottom of the reputation scale,
    /// When its season's income is projected,
    /// Then it earns a few million at most.
    #[test]
    fn a_small_club_earns_a_few_million() {
        let revenue = projected_season_revenue(&club(105, 50_000));

        assert!((1_000_000..=6_000_000).contains(&revenue), "{revenue}");
    }

    /// Given two clubs with the same reputation, one with a ground half the size
    /// of its following,
    /// When a home gate is taken,
    /// Then the smaller ground caps the attendance and the receipts.
    #[test]
    fn the_stadium_caps_the_gate() {
        let demand = matchday_demand(800);
        let full = matchday_gate(800, demand * 2, 1.0);
        let capped = matchday_gate(800, demand / 2, 1.0);

        assert!(capped * 2 <= full + 100, "capped {capped} full {full}");
    }

    /// Given a small club with an 80,000-seat stadium,
    /// When a home gate is taken,
    /// Then it draws its small following, not a full house.
    #[test]
    fn a_small_club_does_not_fill_a_big_stadium() {
        let gate = matchday_gate(105, 80_000, 1.0);

        assert!(gate < 200_000, "{gate}");
    }

    /// Given a club whose income carries twice its squad's market wages, and one
    /// whose income carries a tenth of them,
    /// When their pay levels are set,
    /// Then the first pays above the market and the second far below it.
    #[test]
    fn pay_level_follows_what_income_can_carry() {
        assert!(pay_level_for(200_000, 100_000.0) > 1.0);
        assert!(pay_level_for(10_000, 100_000.0) < 0.2);
    }

    /// Given a club of any standing,
    /// When its weekly broadcast and commercial income are added up over a season,
    /// Then they come to its central income.
    #[test]
    fn broadcast_and_commercial_make_up_central_income() {
        let weekly = weekly_broadcast_income(600) + weekly_commercial_income(600);

        let season = weekly * WEEKS_PER_SEASON;

        assert!((season as f64 - season_central_income(600)).abs() < 200.0);
    }
}
