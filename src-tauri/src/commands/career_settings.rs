//! Rules a player sets for one career, from Settings > Game Engine.

use log::info;
use std::sync::Arc;
use tauri::State;

use ofm_core::development_speed::DevelopmentSpeed;
use ofm_core::game::Game;
use ofm_core::state::StateManager;

use crate::commands::util::mutate_active_game;

const INVALID_DEVELOPMENT_SPEED: &str = "be.error.invalidDevelopmentSpeed";

/// Set how fast players develop in the active career, as a percentage of the
/// realistic pace (100 = 1×, up to 500 = 5×, in steps of 50).
pub fn set_development_speed_internal(state: &StateManager, percent: u16) -> Result<Game, String> {
    mutate_active_game(state, |game| {
        game.development_speed = DevelopmentSpeed::from_percent(percent)
            .ok_or_else(|| INVALID_DEVELOPMENT_SPEED.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub fn set_development_speed(
    state: State<'_, Arc<StateManager>>,
    percent: u16,
) -> Result<Game, String> {
    info!("[cmd] set_development_speed: percent={percent}");
    set_development_speed_internal(&state, percent)
}

#[cfg(test)]
mod tests {
    use super::set_development_speed_internal;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use ofm_core::clock::GameClock;
    use ofm_core::game::Game;
    use ofm_core::state::StateManager;

    fn state_with_a_career() -> StateManager {
        let manager = Manager::new(
            "manager-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let state = StateManager::new();
        state.set_game(Game::new(clock, manager, vec![], vec![], vec![], vec![]));
        state
    }

    fn stored_percent(state: &StateManager) -> u16 {
        state
            .get_game(|game| game.development_speed.percent())
            .expect("a career is active")
    }

    /// Given an active career at the realistic 1×,
    /// When the player picks 3×,
    /// Then the career develops players at 3×, and the returned game says so.
    #[test]
    fn picking_a_speed_on_the_scale_applies_it_to_the_career() {
        let state = state_with_a_career();

        let returned = set_development_speed_internal(&state, 300).expect("3x is offered");

        assert_eq!(returned.development_speed.percent(), 300);
        assert_eq!(stored_percent(&state), 300);
    }

    /// Given an active career at 2×,
    /// When a speed off the scale is asked for,
    /// Then it is refused with a translation key and the career stays at 2×.
    #[test]
    fn a_speed_off_the_scale_is_refused_and_changes_nothing() {
        let state = state_with_a_career();
        set_development_speed_internal(&state, 200).expect("2x is offered");

        let result = set_development_speed_internal(&state, 125);

        assert_eq!(
            result.err(),
            Some("be.error.invalidDevelopmentSpeed".to_string())
        );
        assert_eq!(stored_percent(&state), 200);
    }

    /// Given no career is open,
    /// When a speed is picked,
    /// Then it is refused because there is no career to apply it to.
    #[test]
    fn with_no_career_open_there_is_nothing_to_set() {
        let state = StateManager::new();

        let result = set_development_speed_internal(&state, 200);

        assert_eq!(
            result.err(),
            Some("be.error.noActiveGameSession".to_string())
        );
    }
}
