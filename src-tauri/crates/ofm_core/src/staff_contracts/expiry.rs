//! Staff contracts over time: priced as a career opens, renewed or run out
//! day by day, and the market's asking wages kept current.

use super::{DEFAULT_STAFF_CONTRACT_YEARS, contract_end_after, full_name, staff_asking_wage};
use crate::game::Game;
use chrono::{Months, NaiveDate};
use domain::staff::{Staff, StaffRole};
use std::collections::HashMap;

/// How far ahead of the end the manager is told a staff contract is running out.
const RENEWAL_NOTICE_DAYS: i64 = 60;

/// Opening contracts run 12 to 47 months, so a world's staff do not all come
/// up for renewal on the same day.
const OPENING_MIN_MONTHS: u32 = 12;
const OPENING_MONTH_SPREAD: u64 = 36;
const OPENING_TERM_SEED: u64 = 0x5747_4146_4643_4f4e;

/// Put the world's staff on the money scale as a career opens.
///
/// Club staff get the contract their club can carry: their asking wage at the
/// club's pay level, as players get theirs, so a small club is not ruined by a
/// coach generation happened to make brilliant. The market asks full price.
/// A contract already set (an authored or older one) is kept.
pub fn open_staff_contracts(game: &mut Game) {
    let today = game.clock.current_date.date_naive();
    let pay_levels: HashMap<String, f64> = game
        .teams
        .iter()
        .map(|team| (team.id.clone(), team.pay_level))
        .collect();
    for staff in &mut game.staff {
        let asking = staff_asking_wage(staff);
        match staff.team_id.as_deref() {
            None => staff.wage = asking,
            Some(team_id) => {
                let Some(&pay_level) = pay_levels.get(team_id) else {
                    continue;
                };
                if staff.contract_end.is_some() {
                    continue;
                }
                staff.wage = crate::economy::scaled_wage(asking, pay_level);
                staff.contract_end = Some(opening_contract_end(today, &staff.id));
            }
        }
    }
}

fn opening_contract_end(today: NaiveDate, staff_id: &str) -> String {
    let spread = crate::stable_hash::stable_hash(staff_id.as_bytes(), OPENING_TERM_SEED)
        % OPENING_MONTH_SPREAD;
    let months = OPENING_MIN_MONTHS + spread as u32;
    today
        .checked_add_months(Months::new(months))
        .unwrap_or(today)
        .format("%Y-%m-%d")
        .to_string()
}

/// List everyone on the market at what they ask now. Cheap enough to run daily,
/// and it reaches staff from every source — generation, retirement, release,
/// older saves — without each having to remember to price them.
pub fn price_unattached_staff(game: &mut Game) {
    for staff in game
        .staff
        .iter_mut()
        .filter(|staff| staff.team_id.is_none())
    {
        staff.wage = staff_asking_wage(staff);
    }
}

/// The day's staff contract business: warn the manager about their staff's
/// contracts running out, let theirs go when one has, and renew the AI clubs'.
///
/// AI clubs never hire or fire staff, so they keep everyone, on a fresh
/// contract at the wage the club can pay; otherwise a few seasons in, every AI
/// club would be left with no staff at all.
pub fn process_staff_contracts(game: &mut Game) {
    let today = game.clock.current_date.date_naive();
    let user_team_id = game.manager.team_id.clone();
    let mut expired = Vec::new();
    let mut expiring = Vec::new();
    for (index, staff) in game.staff.iter().enumerate() {
        let Some(team_id) = staff.team_id.as_deref() else {
            continue;
        };
        let Some(days_left) =
            crate::contracts::contract_days_remaining(staff.contract_end.as_deref(), today)
        else {
            continue;
        };
        let at_user_club = user_team_id.as_deref() == Some(team_id);
        if days_left <= 0 {
            expired.push((index, at_user_club));
        } else if at_user_club && days_left <= RENEWAL_NOTICE_DAYS {
            expiring.push(index);
        }
    }

    for index in expiring {
        warn_contract_running_out(game, index);
    }
    for (index, at_user_club) in expired {
        if at_user_club {
            let_contract_run_out(game, index);
        } else {
            renew_for_ai_club(game, index, today);
        }
    }
}

fn role_key(staff: &Staff) -> &'static str {
    match staff.role {
        StaffRole::AssistantManager => "staff.roles.AssistantManager",
        StaffRole::Coach => "staff.roles.Coach",
        StaffRole::Scout => "staff.roles.Scout",
        StaffRole::Physio => "staff.roles.Physio",
    }
}

fn warn_contract_running_out(game: &mut Game, index: usize) {
    let staff = &game.staff[index];
    let (Some(team_id), Some(contract_end)) = (staff.team_id.clone(), staff.contract_end.clone())
    else {
        return;
    };
    // Keyed on the contract's end, so a renewed contract is warned about again.
    let key = format!("staff_contract_expiring_{}_{}", staff.id, contract_end);
    let name = full_name(staff);
    let role = role_key(staff);
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    crate::inbox::emit_once(game, &key, || {
        crate::messages::staff_contract_expiring_message(
            &key,
            &team_id,
            &name,
            role,
            &contract_end,
            &today,
        )
    });
}

fn let_contract_run_out(game: &mut Game, index: usize) {
    let staff = &mut game.staff[index];
    let (Some(team_id), Some(contract_end)) = (staff.team_id.take(), staff.contract_end.take())
    else {
        return;
    };
    staff.wage = staff_asking_wage(staff);
    let staff_id = staff.id.clone();
    let key = format!("staff_contract_expired_{}_{}", staff.id, contract_end);
    let name = full_name(staff);
    let role = role_key(staff);
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    crate::inbox::emit_once(game, &key, || {
        crate::messages::staff_contract_expired_message(&key, &team_id, &name, role, &today)
    });
    crate::scouting::call_off_assignments_of(game, &staff_id);
    crate::youth_watchlist::scout_left(game, &staff_id);
}

fn renew_for_ai_club(game: &mut Game, index: usize, today: NaiveDate) {
    let Some(pay_level) = game.staff[index]
        .team_id
        .as_deref()
        .and_then(|team_id| game.teams.iter().find(|team| team.id == team_id))
        .map(|team| team.pay_level)
    else {
        return;
    };
    let Ok(contract_end) = contract_end_after(today, DEFAULT_STAFF_CONTRACT_YEARS) else {
        return;
    };
    let staff = &mut game.staff[index];
    staff.wage = crate::economy::scaled_wage(staff_asking_wage(staff), pay_level);
    staff.contract_end = Some(contract_end);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::staff_contracts::staff_asking_wage;
    use crate::staff_contracts::test_fixtures::*;
    use domain::message::MessageCategory;

    fn messages_with_prefix(game: &Game, prefix: &str) -> usize {
        game.messages
            .iter()
            .filter(|message| message.id.starts_with(prefix))
            .count()
    }

    /// Given one of the user's coaches whose contract ends today,
    /// When the day is processed,
    /// Then they leave for the market at their asking wage and the manager is told.
    #[test]
    fn the_users_coach_leaves_when_the_contract_runs_out() {
        let mut game = game_with(vec![employed(
            coach("c1", 70),
            USER_TEAM,
            2_000,
            Some("2026-08-01"),
        )]);

        process_staff_contracts(&mut game);

        let gone = staff_member(&game, "c1");
        assert!(gone.team_id.is_none());
        assert!(gone.contract_end.is_none());
        assert_eq!(gone.wage, staff_asking_wage(gone));
        let message = game
            .messages
            .iter()
            .find(|message| message.id.starts_with("staff_contract_expired_c1"))
            .expect("expiry message");
        assert_eq!(message.category, MessageCategory::Contract);
    }

    /// Given an AI club's coach whose contract ends today,
    /// When the day is processed,
    /// Then the club keeps them on a fresh two-year contract at what it can pay.
    #[test]
    fn an_ai_club_renews_its_coach_when_the_contract_runs_out() {
        let mut game = game_with(vec![employed(
            coach("c1", 70),
            AI_TEAM,
            2_000,
            Some("2026-08-01"),
        )]);
        game.teams[1].pay_level = 0.5;

        process_staff_contracts(&mut game);

        let kept = staff_member(&game, "c1");
        assert_eq!(kept.team_id.as_deref(), Some(AI_TEAM));
        assert_eq!(kept.contract_end.as_deref(), Some("2028-08-01"));
        assert_eq!(
            kept.wage,
            crate::economy::scaled_wage(staff_asking_wage(kept), 0.5)
        );
    }

    /// Given one of the user's coaches with a month left,
    /// When two days are processed,
    /// Then the manager is warned once that the contract is running out.
    #[test]
    fn the_manager_is_warned_once_before_a_staff_contract_runs_out() {
        let mut game = game_with(vec![employed(
            coach("c1", 70),
            USER_TEAM,
            2_000,
            Some("2026-09-01"),
        )]);

        process_staff_contracts(&mut game);
        process_staff_contracts(&mut game);

        assert_eq!(messages_with_prefix(&game, "staff_contract_expiring_c1"), 1);
        assert_eq!(
            staff_member(&game, "c1").team_id.as_deref(),
            Some(USER_TEAM)
        );
    }

    /// Given one of the user's coaches with more than two months left,
    /// When the day is processed,
    /// Then there is no warning yet.
    #[test]
    fn no_warning_while_the_contract_has_months_to_run() {
        let mut game = game_with(vec![employed(
            coach("c1", 70),
            USER_TEAM,
            2_000,
            Some("2027-01-01"),
        )]);

        process_staff_contracts(&mut game);

        assert_eq!(messages_with_prefix(&game, "staff_contract_expiring"), 0);
    }

    /// Given a career opening with staff at clubs and on the market,
    /// When their contracts are opened,
    /// Then club staff are paid what the club can afford for one to four years,
    /// and the market asks full price.
    #[test]
    fn opening_prices_club_staff_by_means_and_the_market_at_full_price() {
        let mut game = game_with(vec![
            employed(coach("c1", 80), AI_TEAM, 0, None),
            coach("c2", 80),
        ]);
        game.teams[1].pay_level = 0.5;

        open_staff_contracts(&mut game);

        let at_club = staff_member(&game, "c1");
        assert_eq!(
            at_club.wage,
            crate::economy::scaled_wage(staff_asking_wage(at_club), 0.5)
        );
        let end = at_club.contract_end.as_deref().expect("contract end");
        assert!(("2027-08-01".."2030-08-01").contains(&end), "{end}");
        let on_market = staff_member(&game, "c2");
        assert_eq!(on_market.wage, staff_asking_wage(on_market));
        assert!(on_market.contract_end.is_none());
    }

    /// Given many club staff opening their contracts on the same day,
    /// When their terms are set,
    /// Then they do not all run out on the same date.
    #[test]
    fn opening_contracts_end_on_different_dates() {
        let staff = (0..12)
            .map(|index| employed(coach(&format!("c{index}"), 60), AI_TEAM, 0, None))
            .collect();
        let mut game = game_with(staff);

        open_staff_contracts(&mut game);

        let ends: std::collections::BTreeSet<_> = game
            .staff
            .iter()
            .filter_map(|staff| staff.contract_end.clone())
            .collect();
        assert!(ends.len() > 3, "{ends:?}");
    }

    /// Given a coach on the market listed at no wage and a club coach on 1,000,
    /// When the market's asking wages are refreshed,
    /// Then the market coach asks their wage and the club coach's contract is untouched.
    #[test]
    fn the_market_lists_every_coach_at_their_asking_wage() {
        let mut game = game_with(vec![
            coach("c1", 70),
            employed(coach("c2", 70), USER_TEAM, 1_000, Some("2027-08-01")),
        ]);

        price_unattached_staff(&mut game);

        let on_market = staff_member(&game, "c1");
        assert_eq!(on_market.wage, staff_asking_wage(on_market));
        assert_eq!(staff_member(&game, "c2").wage, 1_000);
    }

    /// Given one of the user's scouts on a youth search when his contract ends,
    /// When the day is processed,
    /// Then the search is called off with him.
    #[test]
    fn a_scout_whose_contract_ends_leaves_his_searches_behind() {
        let mut game = game_with(vec![employed(
            coach("s1", 60),
            USER_TEAM,
            2_000,
            Some("2026-08-01"),
        )]);
        game.youth_scouting_assignments
            .push(crate::game::YouthScoutingAssignment {
                id: "y1".to_string(),
                scout_id: "s1".to_string(),
                region: Default::default(),
                objective: Default::default(),
                target_position: None,
                days_remaining: 3,
            });

        process_staff_contracts(&mut game);

        assert!(game.youth_scouting_assignments.is_empty());
    }
}
