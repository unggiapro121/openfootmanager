//! A day of the game runs the staff contract business: contracts that end
//! release their staff, and the market lists everyone at what they ask.

use super::*;
use ofm_core::staff_contracts::staff_asking_wage;

/// Given one of the user's coaches whose contract ends today,
/// When the day is processed,
/// Then the coach has left for the market and the manager has been told.
#[test]
fn a_staff_contract_ending_today_releases_the_coach() {
    let mut game = make_game_without_match_today();
    let mut coach = fixtures::make_staff("coach-1", "team1", StaffRole::Coach, "Ana", "Lopez");
    coach.wage = 3_000;
    coach.contract_end = Some("2025-06-15".to_string());
    game.staff.push(coach);

    turn::process_day(&mut game);

    let coach = game
        .staff
        .iter()
        .find(|staff| staff.id == "coach-1")
        .unwrap();
    assert!(coach.team_id.is_none());
    assert!(
        game.messages
            .iter()
            .any(|message| message.id.starts_with("staff_contract_expired_coach-1"))
    );
}

/// Given a coach on the market listed at no wage, as an older save has them,
/// When the day is processed,
/// Then the market lists them at their asking wage.
#[test]
fn the_market_lists_staff_at_their_asking_wage_after_a_day() {
    let mut game = make_game_without_match_today();
    let mut coach = fixtures::make_staff("coach-1", "team1", StaffRole::Coach, "Ana", "Lopez");
    coach.team_id = None;
    game.staff.push(coach);

    turn::process_day(&mut game);

    let coach = game
        .staff
        .iter()
        .find(|staff| staff.id == "coach-1")
        .unwrap();
    assert!(coach.wage > 0);
    assert_eq!(coach.wage, staff_asking_wage(coach));
}
