//! The game's money on one scale: what players are worth, what clubs earn, and
//! what clubs can afford to pay.
//!
//! Values used to be set once, at world generation, and never again. A player
//! who grew from 65 to 83 kept the price of a 65. Every price is now worked out
//! again each week from the player as he is.

pub mod revenue;
pub mod valuation;

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate, Weekday};

use crate::game::Game;
use domain::player::Player;

/// How a fresh price replaces the stored one.
#[derive(Clone, Copy)]
enum Repricing {
    /// Straight to the new price: a world opening, or a save adopting this scale.
    Exact,
    /// Part of the way, so a week's form nudges the price instead of jumping it.
    Drift,
}

/// Reprice every player on Mondays, the day the rest of the club's books are kept.
pub fn refresh_weekly_player_values(game: &mut Game) {
    let today = game.clock.current_date.date_naive();
    if today.weekday() != Weekday::Mon {
        return;
    }
    reprice_players(game, today, Repricing::Drift);
}

/// Put a world on the real-world money scale as a career opens: price every
/// player, fit each club's opening wages to its means, and give it the cash and
/// budgets its income supports.
///
/// Run while contracts are still staged, before the career opens them. A
/// player's authored value seeds nothing beyond this point, and neither do
/// authored wages: both are worked out like everyone else's, so no player
/// starts frozen on a price the market no longer pays.
pub fn open_world_economy(game: &mut Game) {
    let today = game.clock.current_date.date_naive();
    reprice_players(game, today, Repricing::Exact);
    crate::generator::fit_opening_wages_to_means(game);
    crate::staff_contracts::open_staff_contracts(game);
    settle_club_finances(game);
}

/// Bring a career saved on the old money scale onto this one, once.
///
/// Prices are set exactly. Signed contracts are kept as they were agreed:
/// they come back to the table at renewal, on this scale. A club the old scale
/// left short of cash is lifted to the reserve its income now supports, plus a
/// season of whatever its inherited wage bill costs beyond that income. The
/// debt and the bill were the old model's doing, not its manager's, and a season
/// is the time contracts need to start coming up for renewal on this scale.
pub fn adopt_real_world_scale(game: &mut Game) {
    let today = game.clock.current_date.date_naive();
    reprice_players(game, today, Repricing::Exact);
    let bills = weekly_wage_bills(game);
    let reserves = game
        .teams
        .iter()
        .map(|team| {
            let bill = bills.get(team.id.as_str()).copied().unwrap_or(0);
            let weekly_shortfall =
                (bill - revenue::projected_season_revenue(team) / WEEKS_PER_SEASON).max(0);
            (
                team.id.clone(),
                revenue::opening_cash(team) + weekly_shortfall * WEEKS_PER_SEASON,
            )
        })
        .collect();
    lift_cash_to(game, reserves);
    set_season_budgets(game);
}

/// Set each club's wage and transfer budgets for a new season from its income
/// and its cash.
pub fn set_season_budgets(game: &mut Game) {
    set_pay_levels(game, |player| player.wage() > 0);
    let bills = weekly_wage_bills(game);
    for team in &mut game.teams {
        let bill = bills.get(team.id.as_str()).copied().unwrap_or(0);
        team.wage_budget =
            revenue::weekly_wage_capacity(team).max(bill * 100 / BILL_SHARE_OF_BUDGET);
        team.transfer_budget = transfer_budget_from_cash(team.finance);
    }
}

/// A club whose income cannot carry the contracts it has signed still keeps a
/// little room under its budget, as generation always gave it: 93% used.
const BILL_SHARE_OF_BUDGET: i64 = 93;

/// Half the cash in hand. The other half is the club's cushion against a bad
/// season.
fn transfer_budget_from_cash(finance: i64) -> i64 {
    (finance / 2).max(0)
}

/// Set each club's pay level so that paying its squad at that level fits what
/// its income can carry. `on_the_books` picks the players counted: the ones with
/// a contract, or at a career's opening the ones generation staged one for.
///
/// Academy players count at their whole market wage even though the club pays
/// them half: they are promoted onto that whole wage. Counting them at half was
/// measured to leave more AI clubs in debt over six seasons (27 of 150 against
/// 17), since clubs set wages for a bill that grew as their academy came through.
pub(crate) fn set_pay_levels(game: &mut Game, on_the_books: impl Fn(&Player) -> bool) {
    let reputations = club_reputations(game);
    let mut market_bills: HashMap<String, f64> = HashMap::new();
    for player in game
        .players
        .iter()
        .filter(|player| !player.retired && on_the_books(player))
    {
        let Some(club_id) = player.contract_club_id() else {
            continue;
        };
        let reputation = reputations.get(club_id).copied();
        *market_bills.entry(club_id.to_string()).or_default() +=
            f64::from(valuation::market_wage(player, reputation));
    }
    // Staff are on the same wage bill, so the pay level has to leave room for
    // them; otherwise a club paying its squad all it can afford would sink by
    // exactly its staff's wages every week.
    for staff in &game.staff {
        if let Some(club_id) = staff.team_id.as_deref() {
            *market_bills.entry(club_id.to_string()).or_default() +=
                f64::from(crate::staff_contracts::staff_asking_wage(staff));
        }
    }
    for team in &mut game.teams {
        let market_bill = market_bills.get(team.id.as_str()).copied().unwrap_or(0.0);
        team.pay_level = revenue::pay_level_for(revenue::weekly_wage_capacity(team), market_bill);
    }
}

fn reprice_players(game: &mut Game, today: NaiveDate, repricing: Repricing) {
    let reputations = club_reputations(game);
    for player in game.players.iter_mut().filter(|player| !player.retired) {
        let reputation = player
            .team_id
            .as_deref()
            .and_then(|team_id| reputations.get(team_id).copied());
        let target = valuation::market_value(player, reputation, today);
        player.market_value = match repricing {
            Repricing::Exact => target,
            Repricing::Drift => valuation::drift_toward(player.market_value, target),
        };
    }
}

pub(crate) fn club_reputations(game: &Game) -> HashMap<String, u32> {
    game.teams
        .iter()
        .map(|team| (team.id.clone(), team.reputation))
        .collect()
}

pub(crate) fn scaled_wage(market_wage: u32, pay_level: f64) -> u32 {
    let floor = crate::contracts::MINIMUM_DEFAULT_WAGE as f64;
    (f64::from(market_wage) * pay_level).max(floor) as u32
}

/// Give every club the cash reserve its income supports, if it has less, and
/// budgets to match. The top-up is opening cash, as the other save-format
/// floors are: it corrects a balance the old scale left too small, it is not
/// income.
fn settle_club_finances(game: &mut Game) {
    let reserves = game
        .teams
        .iter()
        .map(|team| (team.id.clone(), revenue::opening_cash(team)))
        .collect();
    lift_cash_to(game, reserves);
    set_season_budgets(game);
}

const WEEKS_PER_SEASON: i64 = 52;

/// Raise each club's cash to its reserve if it holds less, booked as opening cash.
fn lift_cash_to(game: &mut Game, reserves: Vec<(String, i64)>) {
    let date = game.clock.current_date.date_naive();
    let shortfalls: Vec<(String, i64)> = reserves
        .into_iter()
        .filter_map(|(team_id, reserve)| {
            let finance = game.teams.iter().find(|team| team.id == team_id)?.finance;
            Some((team_id, reserve - finance))
        })
        .filter(|(_, shortfall)| *shortfall > 0)
        .collect();
    for (team_id, shortfall) in shortfalls {
        if let Err(error) = crate::finances::credit_opening_cash(game, &team_id, shortfall, date) {
            log::error!("lifting {team_id} onto the real-world money scale failed: {error}");
        }
    }
}

/// Each club's weekly player wage bill, loans shared as the finances share them.
fn weekly_wage_bills(game: &Game) -> HashMap<String, i64> {
    game.teams
        .iter()
        .map(|team| (team.id.clone(), crate::finances::calc_wages(game, &team.id)))
        .collect()
}

#[cfg(test)]
mod tests;
