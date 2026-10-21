use log::info;
use ofm_core::manager_mastery::{manager_progression_view, ManagerProgressionView};
use ofm_core::state::StateManager;
use std::sync::Arc;
use tauri::State;

/// The user's play style mastery as the manager screen shows it (phase 2 M-2).
#[tauri::command]
pub fn get_manager_progression(
    state: State<'_, Arc<StateManager>>,
) -> Result<ManagerProgressionView, String> {
    info!("[cmd] get_manager_progression");
    get_manager_progression_internal(&state)
}

pub fn get_manager_progression_internal(
    state: &StateManager,
) -> Result<ManagerProgressionView, String> {
    state
        .get_game(|game| manager_progression_view(&game.manager))
        .ok_or_else(|| "be.error.noActiveGameSession".to_string())
}

#[cfg(test)]
mod tests {
    use super::get_manager_progression_internal;
    use ofm_core::state::StateManager;

    /// Given no game is open,
    /// When the progression is asked for,
    /// Then the caller gets the no-session key rather than a panic.
    #[test]
    fn without_a_game_the_progression_is_refused() {
        let state = StateManager::new();

        let result = get_manager_progression_internal(&state);

        assert_eq!(result.unwrap_err(), "be.error.noActiveGameSession");
    }
}
