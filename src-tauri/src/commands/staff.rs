use log::info;
use std::sync::Arc;
use tauri::State;

use ofm_core::game::Game;
use ofm_core::staff_contracts::{self, StaffContractPreview, DEFAULT_STAFF_CONTRACT_YEARS};
use ofm_core::state::StateManager;

use crate::commands::util::{mutate_active_game, user_team_id};

/// `contract_years` is optional so a caller that does not choose a term gets
/// the default one.
#[tauri::command]
pub fn hire_staff(
    state: State<'_, Arc<StateManager>>,
    staff_id: String,
    contract_years: Option<u8>,
) -> Result<Game, String> {
    hire_staff_internal(
        &state,
        &staff_id,
        contract_years.unwrap_or(DEFAULT_STAFF_CONTRACT_YEARS),
    )
}

pub fn hire_staff_internal(
    state: &StateManager,
    staff_id: &str,
    contract_years: u8,
) -> Result<Game, String> {
    info!("[cmd] hire_staff: staff_id={staff_id} years={contract_years}");
    mutate_active_game(state, |game| {
        let team_id = user_team_id(game)?;
        staff_contracts::hire_staff(game, &team_id, staff_id, contract_years)?;

        game.available_staff_market_last_activity_date =
            Some(game.clock.current_date.format("%Y-%m-%d").to_string());
        ofm_core::generator::process_available_staff_market(game);

        Ok(())
    })
}

#[tauri::command]
pub fn release_staff(
    state: State<'_, Arc<StateManager>>,
    staff_id: String,
) -> Result<Game, String> {
    release_staff_internal(&state, &staff_id)
}

/// Releases the staff member and pays off the rest of their contract.
pub fn release_staff_internal(state: &StateManager, staff_id: &str) -> Result<Game, String> {
    info!("[cmd] release_staff: staff_id={staff_id}");
    mutate_active_game(state, |game| {
        let team_id = user_team_id(game)?;
        staff_contracts::release_staff(game, &team_id, staff_id).map(|_| ())
    })
}

#[tauri::command]
pub fn refresh_staff_market(state: State<'_, Arc<StateManager>>) -> Result<Game, String> {
    refresh_staff_market_internal(&state)
}

/// Replaces the whole staff market, free, while the month's refreshes last.
pub fn refresh_staff_market_internal(state: &StateManager) -> Result<Game, String> {
    info!("[cmd] refresh_staff_market");
    mutate_active_game(state, ofm_core::generator::refresh_available_staff_market)
}

#[tauri::command]
pub fn renew_staff_contract(
    state: State<'_, Arc<StateManager>>,
    staff_id: String,
    contract_years: Option<u8>,
) -> Result<Game, String> {
    renew_staff_contract_internal(
        &state,
        &staff_id,
        contract_years.unwrap_or(DEFAULT_STAFF_CONTRACT_YEARS),
    )
}

pub fn renew_staff_contract_internal(
    state: &StateManager,
    staff_id: &str,
    contract_years: u8,
) -> Result<Game, String> {
    info!("[cmd] renew_staff_contract: staff_id={staff_id} years={contract_years}");
    mutate_active_game(state, |game| {
        let team_id = user_team_id(game)?;
        staff_contracts::renew_staff_contract(game, &team_id, staff_id, contract_years)
    })
}

#[tauri::command]
pub fn preview_staff_contract(
    state: State<'_, Arc<StateManager>>,
    staff_id: String,
) -> Result<StaffContractPreview, String> {
    preview_staff_contract_internal(&state, &staff_id)
}

/// What hiring, renewing or releasing the staff member would cost the user's club.
pub fn preview_staff_contract_internal(
    state: &StateManager,
    staff_id: &str,
) -> Result<StaffContractPreview, String> {
    state
        .get_game(|game| {
            let team_id = user_team_id(game)?;
            staff_contracts::preview_staff_contract(game, &team_id, staff_id)
        })
        .unwrap_or_else(|| Err("be.error.noActiveGameSession".to_string()))
}

#[cfg(test)]
mod tests {
    use super::{
        hire_staff_internal, preview_staff_contract_internal, refresh_staff_market_internal,
        release_staff_internal, renew_staff_contract_internal,
    };
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::staff::{Staff, StaffAttributes, StaffRole};
    use domain::team::Team;
    use ofm_core::clock::GameClock;
    use ofm_core::game::Game;
    use ofm_core::staff_contracts::staff_asking_wage;
    use ofm_core::state::StateManager;

    fn make_team() -> Team {
        let mut team = Team::new(
            "team-1".to_string(),
            "User FC".to_string(),
            "USR".to_string(),
            "England".to_string(),
            "London".to_string(),
            "User Ground".to_string(),
            25_000,
        );
        team.manager_id = Some("manager-1".to_string());
        team
    }

    fn make_staff() -> Staff {
        let mut staff = Staff::new(
            "staff-1".to_string(),
            "Alex".to_string(),
            "Coach".to_string(),
            "1985-01-01".to_string(),
            StaffRole::Coach,
            StaffAttributes {
                coaching: 70,
                judging_ability: 50,
                judging_potential: 50,
                physiotherapy: 30,
            },
        );
        staff.wage = 12_000;
        staff
    }

    fn make_employed_staff() -> Staff {
        let mut staff = make_staff();
        staff.team_id = Some("team-1".to_string());
        staff
    }

    fn make_game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "manager-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team-1".to_string());

        Game::new(
            clock,
            manager,
            vec![make_team()],
            vec![],
            vec![make_staff()],
            vec![],
        )
    }

    fn make_game_with_employed_staff() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "manager-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team-1".to_string());

        Game::new(
            clock,
            manager,
            vec![make_team()],
            vec![],
            vec![make_employed_staff()],
            vec![],
        )
    }

    /// The manager holds a team id that no club in the world has. Both commands
    /// used to swallow that: the club lookup sat behind `if let Some(team)` with
    /// no else, so the staff record changed and the club's books did not.
    fn with_dangling_team_id(mut game: Game) -> Game {
        game.teams[0].id = "team-elsewhere".to_string();
        game
    }

    /// Given the market as the month began,
    /// When the manager refreshes it three times and tries a fourth,
    /// Then each refresh brings a new market and the fourth is refused.
    #[test]
    fn refresh_staff_market_internal_replaces_the_market_three_times_a_month() {
        let state = StateManager::new();
        state.set_game(make_game());

        for _ in 0..3 {
            let game = refresh_staff_market_internal(&state).expect("a refresh");
            assert_eq!(
                game.staff
                    .iter()
                    .filter(|staff| staff.team_id.is_none())
                    .count(),
                12
            );
            assert!(!game.staff.iter().any(|staff| staff.id == "staff-1"));
        }

        assert_eq!(
            refresh_staff_market_internal(&state).err(),
            Some("be.error.staff.marketRefreshesUsed".to_string())
        );
    }

    #[test]
    fn hire_staff_internal_reports_a_team_id_that_matches_no_club() {
        let state = StateManager::new();
        state.set_game(with_dangling_team_id(make_game()));

        let result = hire_staff_internal(&state, "staff-1", 2);

        assert_eq!(result.err(), Some("be.error.teamNotFound".into()));

        // The club is looked up before anything is written, so the staff
        // member must not have been hired either.
        let stored = state.get_game(|game| game.clone()).expect("stored game");
        let staff = stored
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .expect("stored staff should exist");
        assert!(staff.team_id.is_none());
        assert_eq!(stored.teams[0].season_expenses, 0);
    }

    #[test]
    fn release_staff_internal_reports_a_team_id_that_matches_no_club() {
        let state = StateManager::new();
        state.set_game(with_dangling_team_id(make_game_with_employed_staff()));

        let result = release_staff_internal(&state, "staff-1");

        assert_eq!(result.err(), Some("be.error.teamNotFound".into()));

        // Likewise: the staff member stays employed rather than being released
        // while the command reports failure.
        let stored = state.get_game(|game| game.clone()).expect("stored game");
        let staff = stored
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .expect("stored staff should exist");
        assert_eq!(staff.team_id.as_deref(), Some("team-1"));
    }

    /// Given a coach on the market,
    /// When the manager hires them through the command,
    /// Then the stored game has them at the club on their asking wage for two
    /// years, no fee was charged, and the market was refilled.
    #[test]
    fn hire_staff_internal_updates_state() {
        let state = StateManager::new();
        state.set_game(make_game());

        let response = hire_staff_internal(&state, "staff-1", 2).expect("response");
        let available_staff = response
            .staff
            .iter()
            .filter(|staff| staff.team_id.is_none())
            .count();
        assert_eq!(available_staff, 12);
        assert_eq!(
            response
                .available_staff_market_last_activity_date
                .as_deref(),
            Some("2026-08-01")
        );

        let stored_game = state.get_game(|game| game.clone()).expect("stored game");
        let stored_staff = stored_game
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .expect("stored staff should exist");
        let stored_team = stored_game
            .teams
            .iter()
            .find(|team| team.id == "team-1")
            .expect("stored team should exist");
        assert_eq!(stored_staff.team_id.as_deref(), Some("team-1"));
        assert_eq!(stored_staff.wage, staff_asking_wage(stored_staff));
        assert_eq!(stored_staff.contract_end.as_deref(), Some("2028-08-01"));
        assert_eq!(stored_team.season_expenses, 0);
        assert_eq!(
            stored_game
                .available_staff_market_last_activity_date
                .as_deref(),
            Some("2026-08-01")
        );
    }

    #[test]
    fn release_staff_internal_updates_state() {
        let state = StateManager::new();
        state.set_game(make_game_with_employed_staff());

        let response = release_staff_internal(&state, "staff-1").expect("response");
        let staff = response
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .unwrap();

        assert!(staff.team_id.is_none());

        let stored_game = state.get_game(|game| game.clone()).expect("stored game");
        let stored_staff = stored_game
            .staff
            .iter()
            .find(|staff| staff.id == "staff-1")
            .expect("stored staff should exist");
        assert!(stored_staff.team_id.is_none());
    }

    /// Given one of the user's coaches on a cheap contract,
    /// When the manager renews it for three years through the command,
    /// Then the stored game has the new term at the asking wage.
    #[test]
    fn renew_staff_contract_internal_updates_state() {
        let state = StateManager::new();
        let mut game = make_game_with_employed_staff();
        game.staff[0].wage = 1_000;
        game.staff[0].contract_end = Some("2026-09-01".to_string());
        state.set_game(game);

        renew_staff_contract_internal(&state, "staff-1", 3).expect("renew");

        let stored = state
            .get_game(|game| game.staff[0].clone())
            .expect("stored");
        assert_eq!(stored.contract_end.as_deref(), Some("2029-08-01"));
        assert_eq!(stored.wage, staff_asking_wage(&stored));
    }

    /// Given a coach on the market,
    /// When the manager previews hiring them through the command,
    /// Then the preview quotes their asking wage and changes nothing.
    #[test]
    fn preview_staff_contract_internal_quotes_the_asking_wage() {
        let state = StateManager::new();
        state.set_game(make_game());

        let preview = preview_staff_contract_internal(&state, "staff-1").expect("preview");

        let stored = state
            .get_game(|game| game.staff[0].clone())
            .expect("stored");
        assert_eq!(preview.asking_wage, staff_asking_wage(&stored));
        assert!(stored.team_id.is_none());
    }

    /// Given no game loaded,
    /// When a staff contract is previewed,
    /// Then the command reports there is no active game.
    #[test]
    fn preview_staff_contract_internal_without_a_game_reports_it() {
        let state = StateManager::new();

        let result = preview_staff_contract_internal(&state, "staff-1");

        assert_eq!(result, Err("be.error.noActiveGameSession".to_string()));
    }
}
