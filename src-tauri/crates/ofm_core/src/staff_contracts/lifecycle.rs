//! The manager's three decisions about staff: hire, renew and release.

use crate::game::Game;
use serde::{Deserialize, Serialize};

/// What hiring, renewing or releasing one staff member would do to the books.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StaffContractPreview {
    pub staff_id: String,
    /// The weekly wage they ask for a new contract, whether joining or renewing.
    pub asking_wage: u32,
    /// What the club pays them now; zero for someone not on its books.
    pub current_wage: u32,
    pub contract_end: Option<String>,
    /// What releasing them today would cost; zero for someone not on its books.
    pub severance_cost: i64,
    pub weekly_wage_bill: i64,
    /// The weekly wage bill once they sign at `asking_wage`.
    pub projected_wage_bill: i64,
    pub wage_budget: i64,
    pub within_wage_budget: bool,
}

const ERR_STAFF_NOT_FOUND: &str = "be.error.staffMemberNotFound";
const ERR_STAFF_EMPLOYED: &str = "be.error.staffMemberAlreadyEmployed";
const ERR_STAFF_NOT_IN_TEAM: &str = "be.error.staffMemberNotInTeam";
const ERR_TEAM_NOT_FOUND: &str = "be.error.teamNotFound";
const ERR_WAGE_BUDGET: &str = "be.error.staffWageBudget";

/// What hiring (someone on the market) or renewing (someone already at
/// `team_id`) would cost, and what releasing them would.
pub fn preview_staff_contract(
    game: &Game,
    team_id: &str,
    staff_id: &str,
) -> Result<StaffContractPreview, String> {
    let staff = game
        .staff
        .iter()
        .find(|staff| staff.id == staff_id)
        .ok_or_else(|| ERR_STAFF_NOT_FOUND.to_string())?;
    let team = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .ok_or_else(|| ERR_TEAM_NOT_FOUND.to_string())?;
    let (current_wage, contract_end) = match staff.team_id.as_deref() {
        None => (0, None),
        Some(employer) if employer == team_id => (staff.wage, staff.contract_end.clone()),
        Some(_) => return Err(ERR_STAFF_EMPLOYED.to_string()),
    };

    let today = game.clock.current_date.date_naive();
    let asking_wage = super::staff_asking_wage(staff);
    let weekly_wage_bill = crate::finances::calc_wages(game, team_id);
    let projected_wage_bill = weekly_wage_bill - i64::from(current_wage) + i64::from(asking_wage);
    Ok(StaffContractPreview {
        staff_id: staff.id.clone(),
        asking_wage,
        current_wage,
        severance_cost: crate::contracts::severance_for_remaining_term(
            contract_end.as_deref(),
            current_wage,
            today,
        ),
        contract_end,
        weekly_wage_bill,
        projected_wage_bill,
        wage_budget: team.wage_budget,
        within_wage_budget: fits_wage_budget(
            team.wage_budget,
            weekly_wage_bill,
            projected_wage_bill,
        ),
    })
}

/// The board's line on staff wages: no signing that takes the weekly bill over
/// the wage budget. A renewal that does not raise an over-budget bill is let
/// through, or a club that is already over could never keep anyone.
fn fits_wage_budget(wage_budget: i64, current_bill: i64, projected_bill: i64) -> bool {
    projected_bill <= wage_budget || projected_bill <= current_bill
}

/// Sign `preview`'s terms for `years`, once the board has agreed to the wage.
/// Everything is checked before anything is written.
fn sign(game: &mut Game, preview: &StaffContractPreview, years: u8) -> Result<(), String> {
    let contract_end = super::contract_end_after(game.clock.current_date.date_naive(), years)?;
    if !preview.within_wage_budget {
        return Err(format!("{ERR_WAGE_BUDGET}?budget={}", preview.wage_budget));
    }
    if let Some(staff) = game
        .staff
        .iter_mut()
        .find(|staff| staff.id == preview.staff_id)
    {
        staff.wage = preview.asking_wage;
        staff.contract_end = Some(contract_end);
    }
    Ok(())
}

/// Hire `staff_id` from the market for `years` at their asking wage. There is
/// no fee: the wage is the whole cost, paid weekly from the next Monday.
pub fn hire_staff(game: &mut Game, team_id: &str, staff_id: &str, years: u8) -> Result<(), String> {
    // The preview refuses someone at another club; this refuses one already here.
    if is_at(game, staff_id, team_id) {
        return Err(ERR_STAFF_EMPLOYED.to_string());
    }
    let preview = preview_staff_contract(game, team_id, staff_id)?;
    sign(game, &preview, years)?;
    if let Some(staff) = game.staff.iter_mut().find(|staff| staff.id == staff_id) {
        staff.team_id = Some(team_id.to_string());
    }
    Ok(())
}

/// Give one of `team_id`'s staff a fresh contract of `years` from today, at
/// what they ask now.
pub fn renew_staff_contract(
    game: &mut Game,
    team_id: &str,
    staff_id: &str,
    years: u8,
) -> Result<(), String> {
    if !is_at(game, staff_id, team_id) {
        return Err(ERR_STAFF_NOT_IN_TEAM.to_string());
    }
    let preview = preview_staff_contract(game, team_id, staff_id)?;
    sign(game, &preview, years)
}

/// Release one of `team_id`'s staff today, paying off the rest of their
/// contract, and return what that cost. They go back on the market.
pub fn release_staff(game: &mut Game, team_id: &str, staff_id: &str) -> Result<i64, String> {
    if !is_at(game, staff_id, team_id) {
        return Err(ERR_STAFF_NOT_IN_TEAM.to_string());
    }
    let preview = preview_staff_contract(game, team_id, staff_id)?;
    if preview.severance_cost > 0 {
        pay_severance(game, team_id, staff_id, preview.severance_cost)?;
    }
    if let Some(staff) = game.staff.iter_mut().find(|staff| staff.id == staff_id) {
        staff.team_id = None;
        staff.contract_end = None;
        staff.wage = preview.asking_wage;
    }
    Ok(preview.severance_cost)
}

fn is_at(game: &Game, staff_id: &str, team_id: &str) -> bool {
    game.staff
        .iter()
        .any(|staff| staff.id == staff_id && staff.team_id.as_deref() == Some(team_id))
}

/// Book the payoff the way a player's is booked: in the cash journal, which
/// moves the club's cash, and as a line in the club's finance history.
fn pay_severance(game: &mut Game, team_id: &str, staff_id: &str, cost: i64) -> Result<(), String> {
    let name = game
        .staff
        .iter()
        .find(|staff| staff.id == staff_id)
        .map(super::full_name)
        .unwrap_or_default();
    let date = game.clock.current_date.date_naive();
    crate::finances::post(
        game,
        team_id,
        -cost,
        crate::finances::CashKind::ContractTermination,
        date,
    )?;
    if let Some(team) = game.teams.iter_mut().find(|team| team.id == team_id) {
        team.financial_ledger
            .push(domain::team::FinancialTransaction {
                date: date.format("%Y-%m-%d").to_string(),
                description: crate::contracts::backend_text_with_param(
                    "be.msg.contractTerminated.ledgerDescription",
                    "player",
                    &name,
                ),
                amount: -cost,
                kind: domain::team::FinancialTransactionKind::ContractTermination,
            });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::staff_contracts::test_fixtures::*;
    use crate::staff_contracts::{DEFAULT_STAFF_CONTRACT_YEARS, staff_asking_wage};
    use domain::finance::CashKind;

    fn budget_error(game: &Game) -> String {
        format!(
            "be.error.staffWageBudget?budget={}",
            team_of(game, USER_TEAM).wage_budget
        )
    }

    /// Given a coach on the market,
    /// When the manager hires them for the default term,
    /// Then they join at their asking wage until two years from today.
    #[test]
    fn hiring_signs_the_coach_at_their_asking_wage_for_the_chosen_term() {
        let mut game = game_with(vec![coach("c1", 80)]);
        let asking = staff_asking_wage(staff_member(&game, "c1"));

        hire_staff(&mut game, USER_TEAM, "c1", DEFAULT_STAFF_CONTRACT_YEARS).expect("hire");

        let hired = staff_member(&game, "c1");
        assert_eq!(hired.team_id.as_deref(), Some(USER_TEAM));
        assert_eq!(hired.wage, asking);
        assert_eq!(hired.contract_end.as_deref(), Some("2028-08-01"));
    }

    /// Given a coach on the market,
    /// When the manager hires them for three years,
    /// Then the contract runs three years.
    #[test]
    fn the_manager_can_choose_a_longer_term() {
        let mut game = game_with(vec![coach("c1", 60)]);

        hire_staff(&mut game, USER_TEAM, "c1", 3).expect("hire");

        assert_eq!(
            staff_member(&game, "c1").contract_end.as_deref(),
            Some("2029-08-01")
        );
    }

    /// Given a coach on the market,
    /// When the manager hires them,
    /// Then no money moves today — staff come on a free transfer and are paid weekly.
    #[test]
    fn hiring_costs_no_fee() {
        let mut game = game_with(vec![coach("c1", 80)]);
        let cash_before = team_of(&game, USER_TEAM).finance;

        hire_staff(&mut game, USER_TEAM, "c1", DEFAULT_STAFF_CONTRACT_YEARS).expect("hire");

        let team = team_of(&game, USER_TEAM);
        assert_eq!(team.finance, cash_before);
        assert_eq!(team.season_expenses, 0);
    }

    /// Given a club whose wage budget is smaller than an elite coach's asking wage,
    /// When the manager tries to hire that coach,
    /// Then the board refuses and the coach stays on the market.
    #[test]
    fn hiring_over_the_wage_budget_is_refused() {
        let mut game = game_with(vec![coach("c1", 95)]);
        game.teams[0].wage_budget = 5_000;

        let result = hire_staff(&mut game, USER_TEAM, "c1", DEFAULT_STAFF_CONTRACT_YEARS);

        assert_eq!(result, Err(budget_error(&game)));
        assert!(staff_member(&game, "c1").team_id.is_none());
    }

    /// Given a coach on the market,
    /// When the manager asks for a five-year contract,
    /// Then it is refused and nothing changes.
    #[test]
    fn hiring_for_an_invalid_term_changes_nothing() {
        let mut game = game_with(vec![coach("c1", 60)]);

        let result = hire_staff(&mut game, USER_TEAM, "c1", 5);

        assert_eq!(
            result,
            Err("be.error.staffContractYearsInvalid".to_string())
        );
        assert!(staff_member(&game, "c1").team_id.is_none());
    }

    /// Given a coach already working for another club,
    /// When the manager tries to hire them,
    /// Then it is refused: only staff on the market can be hired.
    #[test]
    fn staff_employed_elsewhere_cannot_be_hired() {
        let mut game = game_with(vec![employed(coach("c1", 60), AI_TEAM, 3_000, None)]);

        let result = hire_staff(&mut game, USER_TEAM, "c1", DEFAULT_STAFF_CONTRACT_YEARS);

        assert_eq!(
            result,
            Err("be.error.staffMemberAlreadyEmployed".to_string())
        );
    }

    /// Given a coach on 4,000 a week with 10 weeks and 2 days left on their contract,
    /// When the manager releases them,
    /// Then the club pays 11 weeks' wages as severance, booked as a contract termination.
    #[test]
    fn releasing_pays_the_rest_of_the_contract() {
        let mut game = game_with(vec![employed(
            coach("c1", 60),
            USER_TEAM,
            4_000,
            Some("2026-10-12"),
        )]);
        let cash_before = team_of(&game, USER_TEAM).finance;

        let severance = release_staff(&mut game, USER_TEAM, "c1").expect("release");

        assert_eq!(severance, 44_000);
        let team = team_of(&game, USER_TEAM);
        assert_eq!(team.finance, cash_before - 44_000);
        assert!(game.cash_journal.iter().any(|entry| {
            entry.kind == CashKind::ContractTermination && entry.amount == -44_000
        }));
        assert!(
            team.financial_ledger
                .iter()
                .any(|row| row.amount == -44_000)
        );
    }

    /// Given a coach the club has released,
    /// When the market is read,
    /// Then they are back on it with no club, no contract and their asking wage.
    #[test]
    fn a_released_coach_returns_to_the_market_at_their_asking_wage() {
        let mut game = game_with(vec![employed(
            coach("c1", 70),
            USER_TEAM,
            1_000,
            Some("2027-08-01"),
        )]);

        release_staff(&mut game, USER_TEAM, "c1").expect("release");

        let released = staff_member(&game, "c1");
        assert!(released.team_id.is_none());
        assert!(released.contract_end.is_none());
        assert_eq!(released.wage, staff_asking_wage(released));
    }

    /// Given a coach the club never gave a contract end (an older save),
    /// When the manager releases them,
    /// Then there is nothing left to pay out.
    #[test]
    fn releasing_staff_without_a_contract_costs_nothing() {
        let mut game = game_with(vec![employed(coach("c1", 60), USER_TEAM, 4_000, None)]);
        let cash_before = team_of(&game, USER_TEAM).finance;

        let severance = release_staff(&mut game, USER_TEAM, "c1").expect("release");

        assert_eq!(severance, 0);
        assert_eq!(team_of(&game, USER_TEAM).finance, cash_before);
    }

    /// Given a coach working for another club,
    /// When the manager tries to release them,
    /// Then it is refused.
    #[test]
    fn staff_of_another_club_cannot_be_released() {
        let mut game = game_with(vec![employed(coach("c1", 60), AI_TEAM, 4_000, None)]);

        let result = release_staff(&mut game, USER_TEAM, "c1");

        assert_eq!(result, Err("be.error.staffMemberNotInTeam".to_string()));
        assert_eq!(staff_member(&game, "c1").team_id.as_deref(), Some(AI_TEAM));
    }

    /// Given a coach on an old, cheap contract that runs out in a month,
    /// When the manager renews it for a year,
    /// Then the new term starts today and the wage moves to their asking wage.
    #[test]
    fn renewing_resets_the_term_at_the_asking_wage() {
        let mut game = game_with(vec![employed(
            coach("c1", 80),
            USER_TEAM,
            1_000,
            Some("2026-09-01"),
        )]);

        renew_staff_contract(&mut game, USER_TEAM, "c1", 1).expect("renew");

        let renewed = staff_member(&game, "c1");
        assert_eq!(renewed.contract_end.as_deref(), Some("2027-08-01"));
        assert_eq!(renewed.wage, staff_asking_wage(renewed));
    }

    /// Given a club that can afford a coach's old wage but not their asking wage,
    /// When the manager tries to renew,
    /// Then the board refuses and the old contract stands.
    #[test]
    fn a_renewal_that_breaks_the_wage_budget_is_refused() {
        let mut game = game_with(vec![employed(
            coach("c1", 95),
            USER_TEAM,
            1_000,
            Some("2026-09-01"),
        )]);
        game.teams[0].wage_budget = 5_000;

        let result = renew_staff_contract(&mut game, USER_TEAM, "c1", 2);

        assert_eq!(result, Err(budget_error(&game)));
        let kept = staff_member(&game, "c1");
        assert_eq!(kept.wage, 1_000);
        assert_eq!(kept.contract_end.as_deref(), Some("2026-09-01"));
    }

    /// Given a coach on the market and a club already paying 2,000 a week,
    /// When the manager previews hiring them,
    /// Then the preview shows their asking wage, the bill after signing and that it fits.
    #[test]
    fn the_hiring_preview_shows_the_wage_bill_after_signing() {
        let mut game = game_with(vec![
            coach("c1", 70),
            employed(coach("c2", 40), USER_TEAM, 2_000, None),
        ]);
        game.teams[0].wage_budget = 100_000;
        let asking = staff_asking_wage(staff_member(&game, "c1"));

        let preview = preview_staff_contract(&game, USER_TEAM, "c1").expect("preview");

        assert_eq!(preview.asking_wage, asking);
        assert_eq!(preview.current_wage, 0);
        assert_eq!(preview.severance_cost, 0);
        assert_eq!(preview.weekly_wage_bill, 2_000);
        assert_eq!(preview.projected_wage_bill, 2_000 + i64::from(asking));
        assert!(preview.within_wage_budget);
    }

    /// Given one of the club's coaches on 4,000 a week with 10 weeks and 2 days left,
    /// When the manager previews their contract,
    /// Then it shows the severance and the bill if they were renewed at their asking wage.
    #[test]
    fn the_preview_for_the_clubs_own_coach_shows_severance_and_renewal() {
        let game = game_with(vec![employed(
            coach("c1", 70),
            USER_TEAM,
            4_000,
            Some("2026-10-12"),
        )]);
        let asking = staff_asking_wage(staff_member(&game, "c1"));

        let preview = preview_staff_contract(&game, USER_TEAM, "c1").expect("preview");

        assert_eq!(preview.current_wage, 4_000);
        assert_eq!(preview.severance_cost, 44_000);
        assert_eq!(preview.projected_wage_bill, i64::from(asking));
        assert_eq!(preview.contract_end.as_deref(), Some("2026-10-12"));
    }
}
