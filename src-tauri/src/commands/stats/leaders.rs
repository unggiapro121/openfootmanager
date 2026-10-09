use domain::stats::PlayerMatchStatsRecord;
use ofm_core::slices::competition_leaders::{competition_leaders, played_fixture_ids, LeaderEntry};
use ofm_core::state::StateManager;

use super::dto::{CompetitionLeadersDto, LeaderEntryDto};

const NO_ACTIVE_GAME: &str = "be.error.noActiveGameSession";
const LEADERBOARD_LENGTH: usize = 10;

/// A competition's leaderboards for its current season. The game and the stats
/// are read one after the other, never with both locks held, and only the
/// competition's own rows are copied out of the stats.
pub fn get_competition_leaders_internal(
    state: &StateManager,
    competition_id: &str,
) -> Result<CompetitionLeadersDto, String> {
    let fixture_ids = state
        .get_game(|game| played_fixture_ids(game, competition_id))
        .ok_or_else(|| NO_ACTIVE_GAME.to_string())?;
    let rows: Vec<PlayerMatchStatsRecord> = state
        .get_stats_state(|stats| {
            stats
                .player_matches
                .iter()
                .filter(|row| fixture_ids.contains(&row.fixture_id))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    let leaders = state
        .get_game(|game| competition_leaders(game, &rows, LEADERBOARD_LENGTH))
        .ok_or_else(|| NO_ACTIVE_GAME.to_string())?;
    Ok(CompetitionLeadersDto {
        competition_id: competition_id.to_string(),
        goals: entry_dtos(leaders.goals),
        assists: entry_dtos(leaders.assists),
        yellow_cards: entry_dtos(leaders.yellow_cards),
        red_cards: entry_dtos(leaders.red_cards),
    })
}

fn entry_dtos(entries: Vec<LeaderEntry>) -> Vec<LeaderEntryDto> {
    entries
        .into_iter()
        .map(|entry| LeaderEntryDto {
            player_id: entry.player_id,
            name: entry.match_name,
            full_name: entry.full_name,
            team_id: entry.team_id,
            team_name: entry.team_name,
            value: entry.value,
        })
        .collect()
}
