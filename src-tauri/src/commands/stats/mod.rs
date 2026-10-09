use std::sync::Arc;
mod dto;
mod fixture;
mod leaders;
mod player;
mod shared;
mod team;

#[cfg(test)]
mod tests;

use ofm_core::state::StateManager;
use tauri::State;

pub use self::dto::{CompetitionLeadersDto, FixtureDetailDto};
// Only the MCP renderer's tests build one by hand.
#[cfg(all(test, feature = "mcp"))]
pub(crate) use self::dto::{FixturePlayerRefDto, LeaderEntryDto};
use self::dto::{
    PlayerMatchHistoryEntryDto, PlayerStatsOverviewDto, TeamMatchHistoryEntryDto,
    TeamStatsOverviewDto,
};
pub use self::fixture::get_fixture_detail_internal;
pub use self::leaders::get_competition_leaders_internal;
pub use self::player::{get_player_match_history_internal, get_player_stats_overview_internal};
pub use self::team::{get_team_match_history_internal, get_team_stats_overview_internal};

#[tauri::command]
pub fn get_player_match_history(
    state: State<'_, Arc<StateManager>>,
    player_id: String,
    limit: Option<usize>,
) -> Result<Vec<PlayerMatchHistoryEntryDto>, String> {
    get_player_match_history_internal(&state, &player_id, limit)
}

#[tauri::command]
pub fn get_player_stats_overview(
    state: State<'_, Arc<StateManager>>,
    player_id: String,
) -> Result<PlayerStatsOverviewDto, String> {
    get_player_stats_overview_internal(&state, &player_id)
}

#[tauri::command]
pub fn get_team_stats_overview(
    state: State<'_, Arc<StateManager>>,
    team_id: String,
) -> Result<Option<TeamStatsOverviewDto>, String> {
    get_team_stats_overview_internal(&state, &team_id)
}

#[tauri::command]
pub fn get_team_match_history(
    state: State<'_, Arc<StateManager>>,
    team_id: String,
    limit: Option<usize>,
) -> Result<Vec<TeamMatchHistoryEntryDto>, String> {
    get_team_match_history_internal(&state, &team_id, limit)
}

/// One fixture's full record — result, report, lineups and every captured stat
/// — for the match-details dialog.
#[tauri::command]
pub fn get_fixture_detail(
    state: State<'_, Arc<StateManager>>,
    fixture_id: String,
) -> Result<FixtureDetailDto, String> {
    get_fixture_detail_internal(&state, &fixture_id)
}

/// A competition's goal, assist and card leaders for the Tournaments screen.
#[tauri::command]
pub fn get_competition_leaders(
    state: State<'_, Arc<StateManager>>,
    competition_id: String,
) -> Result<CompetitionLeadersDto, String> {
    get_competition_leaders_internal(&state, &competition_id)
}
