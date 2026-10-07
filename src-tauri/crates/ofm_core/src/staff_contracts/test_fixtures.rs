//! A one-club world with a manager, for the staff contract tests.

use crate::clock::GameClock;
use crate::game::Game;
use chrono::{TimeZone, Utc};
use domain::manager::Manager;
use domain::staff::{Staff, StaffAttributes, StaffRole};
use domain::team::Team;

pub(super) const USER_TEAM: &str = "team-user";
pub(super) const AI_TEAM: &str = "team-ai";

fn team(id: &str) -> Team {
    Team::new(
        id.to_string(),
        format!("{id} FC"),
        "TST".to_string(),
        "England".to_string(),
        "London".to_string(),
        "Ground".to_string(),
        25_000,
    )
}

/// A coach rated `coaching`, with no club and no contract.
pub(super) fn coach(id: &str, coaching: u8) -> Staff {
    Staff::new(
        id.to_string(),
        "Alex".to_string(),
        "Coach".to_string(),
        "1980-01-01".to_string(),
        StaffRole::Coach,
        StaffAttributes {
            coaching,
            judging_ability: 50,
            judging_potential: 50,
            physiotherapy: 30,
        },
    )
}

/// `staff` employed by `team_id` at `wage` a week until `contract_end`.
pub(super) fn employed(
    mut staff: Staff,
    team_id: &str,
    wage: u32,
    contract_end: Option<&str>,
) -> Staff {
    staff.team_id = Some(team_id.to_string());
    staff.wage = wage;
    staff.contract_end = contract_end.map(str::to_string);
    staff
}

/// The user's club and an AI club on 1 August 2026, with `staff`. Neither club
/// has a player, so the wage bill is whatever the staff cost.
pub(super) fn game_with(staff: Vec<Staff>) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire(USER_TEAM.to_string());
    let mut user_team = team(USER_TEAM);
    user_team.manager_id = Some("manager-1".to_string());
    Game::new(
        clock,
        manager,
        vec![user_team, team(AI_TEAM)],
        vec![],
        staff,
        vec![],
    )
}

pub(super) fn staff_member<'a>(game: &'a Game, id: &str) -> &'a Staff {
    game.staff
        .iter()
        .find(|staff| staff.id == id)
        .expect("staff member should exist")
}

pub(super) fn team_of<'a>(game: &'a Game, id: &str) -> &'a Team {
    game.teams
        .iter()
        .find(|team| team.id == id)
        .expect("team should exist")
}
