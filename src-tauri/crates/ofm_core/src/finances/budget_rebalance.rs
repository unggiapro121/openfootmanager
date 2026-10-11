//! Moving money between a club's wage budget and its transfer budget.
//!
//! A pound a week of wages costs that pound on every payday left in the
//! season, so the two budgets trade at that rate. Only the board's allowances
//! move; the cash in the bank does not.

use crate::game::Game;
use chrono::{Datelike, NaiveDate};
use serde::Serialize;

/// Wage budgets move in steps of this much a week.
pub const BUDGET_REBALANCE_STEP: i64 = 1_000;

/// Paydays assumed when the season's end is not known yet.
const PAYDAYS_WITHOUT_A_SEASON_END: u32 = 52;

/// What the manager may set the weekly wage budget to, and at what price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BudgetRebalanceTerms {
    pub paydays_left: u32,
    pub wage_budget: i64,
    pub transfer_budget: i64,
    pub min_wage_budget: i64,
    pub max_wage_budget: i64,
    pub step: i64,
}

pub fn budget_rebalance_terms(game: &Game, team_id: &str) -> Result<BudgetRebalanceTerms, String> {
    let team = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .ok_or("be.error.managedTeamNotFound".to_string())?;
    let season_end = game
        .season_context
        .season_end
        .as_deref()
        .and_then(|text| NaiveDate::parse_from_str(text, "%Y-%m-%d").ok());
    let paydays_left = paydays_left(game.clock.current_date.date_naive(), season_end);
    let wage_bill = super::calc_wages(game, team_id);
    let affordable_rise = team.transfer_budget.max(0) / i64::from(paydays_left);
    Ok(BudgetRebalanceTerms {
        paydays_left,
        wage_budget: team.wage_budget,
        transfer_budget: team.transfer_budget,
        // A club already paying past its budget may raise it, never cut it.
        min_wage_budget: wage_bill.min(team.wage_budget),
        max_wage_budget: team.wage_budget
            + affordable_rise / BUDGET_REBALANCE_STEP * BUDGET_REBALANCE_STEP,
        step: BUDGET_REBALANCE_STEP,
    })
}

/// Set `team_id`'s weekly wage budget to `new_wage_budget`, paying for the
/// change from the transfer budget at one week's change per payday left.
pub fn rebalance_budgets(
    game: &mut Game,
    team_id: &str,
    new_wage_budget: i64,
) -> Result<BudgetRebalanceTerms, String> {
    let terms = budget_rebalance_terms(game, team_id)?;
    if !(terms.min_wage_budget..=terms.max_wage_budget).contains(&new_wage_budget) {
        return Err("be.error.budgetRebalanceOutOfRange".to_string());
    }
    let change = new_wage_budget - terms.wage_budget;
    let at_an_end =
        new_wage_budget == terms.min_wage_budget || new_wage_budget == terms.max_wage_budget;
    if change % BUDGET_REBALANCE_STEP != 0 && !at_an_end {
        return Err("be.error.budgetRebalanceStep".to_string());
    }
    let team = game
        .teams
        .iter_mut()
        .find(|team| team.id == team_id)
        .ok_or("be.error.managedTeamNotFound".to_string())?;
    team.wage_budget = new_wage_budget;
    team.transfer_budget = (team.transfer_budget - change * i64::from(terms.paydays_left)).max(0);
    budget_rebalance_terms(game, team_id)
}

/// Mondays after `today` up to and including the season's last day. Today's
/// Monday wages were paid as the day began, before the manager could act.
fn paydays_left(today: NaiveDate, season_end: Option<NaiveDate>) -> u32 {
    let Some(end) = season_end.filter(|end| *end >= today) else {
        return PAYDAYS_WITHOUT_A_SEASON_END;
    };
    let days_to_monday = 7 - today.weekday().num_days_from_monday();
    let first_payday = today + chrono::Days::new(u64::from(days_to_monday));
    if first_payday > end {
        return 1;
    }
    let mondays = (end - first_payday).num_days() / 7 + 1;
    u32::try_from(mondays).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::staff::{Staff, StaffAttributes, StaffRole};
    use domain::team::Team;

    fn date(text: &str) -> NaiveDate {
        NaiveDate::parse_from_str(text, "%Y-%m-%d").unwrap()
    }

    /// A club with £50k a week of budget, £20k a week of staff wages and £1m
    /// to spend on transfers, on Wednesday 2 September 2026, ten Mondays from
    /// a season that ends on Monday 9 November.
    fn make_game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 9, 2, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr-user".to_string(),
            "Alex".to_string(),
            "Boss".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team1".to_string());
        let mut team = Team::new(
            "team1".to_string(),
            "Alpha FC".to_string(),
            "ALP".to_string(),
            "England".to_string(),
            "Testville".to_string(),
            "Alpha Ground".to_string(),
            22_000,
        );
        team.finance = 3_000_000;
        team.wage_budget = 50_000;
        team.transfer_budget = 1_000_000;
        let mut coach = Staff::new(
            "coach".to_string(),
            "Sam".to_string(),
            "Coach".to_string(),
            "1975-01-01".to_string(),
            StaffRole::Coach,
            StaffAttributes {
                coaching: 50,
                judging_ability: 30,
                judging_potential: 30,
                physiotherapy: 20,
            },
        );
        coach.team_id = Some("team1".to_string());
        coach.wage = 20_000;
        let mut game = Game::new(clock, manager, vec![team], vec![], vec![coach], vec![]);
        game.season_context.season_end = Some("2026-11-09".to_string());
        game
    }

    fn budgets(game: &Game) -> (i64, i64, i64) {
        let team = &game.teams[0];
        (team.wage_budget, team.transfer_budget, team.finance)
    }

    /// Given a Monday, when counting paydays, then that Monday's wages are
    /// already paid and only the Mondays after it count.
    #[test]
    fn todays_monday_is_already_paid() {
        assert_eq!(
            paydays_left(date("2026-09-07"), Some(date("2026-09-28"))),
            3
        );
    }

    /// Given a midweek day, when counting paydays, then every Monday up to and
    /// including the season's last day counts.
    #[test]
    fn paydays_count_the_mondays_to_the_season_end() {
        assert_eq!(
            paydays_left(date("2026-09-02"), Some(date("2026-11-09"))),
            10
        );
        assert_eq!(
            paydays_left(date("2026-09-02"), Some(date("2026-11-08"))),
            9
        );
    }

    /// Given a season that has ended or has no end yet, when counting paydays,
    /// then the count is never below one, and a full year without an end.
    #[test]
    fn paydays_have_a_floor_and_a_default() {
        assert_eq!(
            paydays_left(date("2026-09-02"), Some(date("2026-09-03"))),
            1
        );
        assert_eq!(
            paydays_left(date("2026-09-02"), Some(date("2026-08-01"))),
            PAYDAYS_WITHOUT_A_SEASON_END
        );
        assert_eq!(
            paydays_left(date("2026-09-02"), None),
            PAYDAYS_WITHOUT_A_SEASON_END
        );
    }

    /// Given ten paydays left, when reading the terms, then the wage budget can
    /// fall to the wage bill and rise by the transfer budget spread over them.
    #[test]
    fn terms_run_from_the_wage_bill_to_the_whole_transfer_budget() {
        let terms = budget_rebalance_terms(&make_game(), "team1").unwrap();
        assert_eq!(terms.paydays_left, 10);
        assert_eq!(terms.min_wage_budget, 20_000);
        assert_eq!(terms.max_wage_budget, 150_000);
        assert_eq!(terms.step, BUDGET_REBALANCE_STEP);
    }

    /// Given a transfer budget that does not divide into whole steps, when
    /// reading the terms, then the top of the range is rounded down to a step.
    #[test]
    fn the_top_of_the_range_is_a_whole_step() {
        let mut game = make_game();
        game.teams[0].transfer_budget = 1_015_000;
        let terms = budget_rebalance_terms(&game, "team1").unwrap();
        assert_eq!(terms.max_wage_budget, 151_000);
    }

    /// Given a club already paying more than its wage budget, when reading the
    /// terms, then the budget cannot fall further but can still rise.
    #[test]
    fn a_club_over_its_wage_budget_can_only_raise_it() {
        let mut game = make_game();
        game.teams[0].wage_budget = 15_000;
        let terms = budget_rebalance_terms(&game, "team1").unwrap();
        assert_eq!(terms.min_wage_budget, 15_000);
        assert_eq!(terms.max_wage_budget, 115_000);
    }

    /// Given ten paydays left, when the wage budget rises by £30k a week, then
    /// the transfer budget falls by £300k and the cash does not move.
    #[test]
    fn raising_the_wage_budget_spends_the_transfer_budget() {
        let mut game = make_game();
        rebalance_budgets(&mut game, "team1", 80_000).unwrap();
        assert_eq!(budgets(&game), (80_000, 700_000, 3_000_000));
    }

    /// Given ten paydays left, when the wage budget falls by £25k a week, then
    /// the transfer budget gains £250k.
    #[test]
    fn lowering_the_wage_budget_frees_transfer_money() {
        let mut game = make_game();
        rebalance_budgets(&mut game, "team1", 25_000).unwrap();
        assert_eq!(budgets(&game), (25_000, 1_250_000, 3_000_000));
    }

    /// Given a rebalance, when it is undone, then both budgets are back where
    /// they started.
    #[test]
    fn a_rebalance_undone_restores_both_budgets() {
        let mut game = make_game();
        rebalance_budgets(&mut game, "team1", 120_000).unwrap();
        rebalance_budgets(&mut game, "team1", 50_000).unwrap();
        assert_eq!(budgets(&game), (50_000, 1_000_000, 3_000_000));
    }

    /// Given a wage budget below the bill or above the transfer budget's
    /// reach, when rebalancing, then it is refused and nothing changes.
    #[test]
    fn a_wage_budget_out_of_range_is_refused() {
        let mut game = make_game();
        for wage_budget in [19_000, 151_000] {
            assert_eq!(
                rebalance_budgets(&mut game, "team1", wage_budget),
                Err("be.error.budgetRebalanceOutOfRange".to_string())
            );
        }
        assert_eq!(budgets(&game), (50_000, 1_000_000, 3_000_000));
    }

    /// Given a change that is not a whole step, when rebalancing, then it is
    /// refused unless it lands on an end of the range.
    #[test]
    fn a_change_off_the_step_is_refused_except_at_the_ends() {
        let mut game = make_game();
        assert_eq!(
            rebalance_budgets(&mut game, "team1", 50_500),
            Err("be.error.budgetRebalanceStep".to_string())
        );
        game.staff[0].wage = 20_500;
        rebalance_budgets(&mut game, "team1", 20_500).unwrap();
        assert_eq!(budgets(&game), (20_500, 1_295_000, 3_000_000));
    }

    /// Given the whole transfer budget spent on wages, when rebalancing to the
    /// top of the range, then the transfer budget is spent but never negative.
    #[test]
    fn the_whole_transfer_budget_can_go_on_wages() {
        let mut game = make_game();
        game.teams[0].transfer_budget = 1_015_000;
        rebalance_budgets(&mut game, "team1", 151_000).unwrap();
        assert_eq!(budgets(&game), (151_000, 5_000, 3_000_000));
    }

    /// Given a club, when the finance screen's previews are built, then they
    /// carry the club's rebalance terms.
    #[test]
    fn finance_previews_carry_the_rebalance_terms() {
        let game = make_game();
        let previews = super::super::finance_action_previews(&game, "team1").unwrap();
        assert_eq!(
            previews.budget_rebalance,
            Some(budget_rebalance_terms(&game, "team1").unwrap())
        );
    }

    /// Given an unknown club, when rebalancing, then it is refused.
    #[test]
    fn an_unknown_club_is_refused() {
        let mut game = make_game();
        assert_eq!(
            rebalance_budgets(&mut game, "nobody", 60_000),
            Err("be.error.managedTeamNotFound".to_string())
        );
    }

    /// Given a rebalanced club, when a new season's budgets are set, then the
    /// rebalance does not carry over.
    #[test]
    fn a_new_season_sets_both_budgets_afresh() {
        let mut fresh = make_game();
        crate::economy::set_season_budgets(&mut fresh);
        let mut game = make_game();
        rebalance_budgets(&mut game, "team1", 120_000).unwrap();
        crate::economy::set_season_budgets(&mut game);
        assert_eq!(budgets(&game), budgets(&fresh));
    }
}
