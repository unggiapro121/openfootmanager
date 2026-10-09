use log::info;
use std::sync::Arc;
use tauri::State;

use ofm_core::state::StateManager;

#[tauri::command]
pub fn check_season_complete(state: State<'_, Arc<StateManager>>) -> Result<bool, String> {
    log::debug!("[cmd] check_season_complete");
    state
        .get_game(ofm_core::end_of_season::is_season_complete)
        .ok_or_else(|| "be.error.noActiveGameSession".to_string())
}

#[tauri::command]
pub fn advance_to_next_season(
    state: State<'_, Arc<StateManager>>,
) -> Result<serde_json::Value, String> {
    info!("[cmd] advance_to_next_season");
    advance_to_next_season_internal(&state)
}

/// Rolls the season over, then drops the per-match stats rows from before the
/// season that just ended. Nothing shows an older season's matches, and the
/// season just ended is kept so a new season's "recent matches" still reach
/// back into it. Rows carry their own competition's season, which is why the
/// cut is a season number rather than a date.
pub fn advance_to_next_season_internal(state: &StateManager) -> Result<serde_json::Value, String> {
    let (response, ended_season) = state
        .update_game(|game| {
            let summary = ofm_core::end_of_season::advance_to_next_season(game)?;
            let ended_season = summary.season;
            let response = if game.manager.team_id.is_none() {
                serde_json::json!({
                    "action": "fired",
                    "game": game,
                    "summary": summary,
                })
            } else {
                serde_json::json!({
                    "game": game,
                    "summary": summary,
                })
            };
            Ok::<_, String>((response, ended_season))
        })
        .unwrap_or_else(|| Err("be.error.noActiveGameSession".to_string()))?;
    // The game lock is released before the stats lock is taken.
    state.with_stats_state(|stats| stats.retain_seasons_from(ended_season));
    Ok(response)
}

#[tauri::command]
pub fn get_season_awards(
    state: State<'_, Arc<StateManager>>,
) -> Result<ofm_core::season_awards::SeasonAwards, String> {
    log::debug!("[cmd] get_season_awards");
    state
        .get_game(|game| {
            // The awards screen shows the race within the user's own division.
            let user_team_id = game.manager.team_id.clone().unwrap_or_default();
            match ofm_core::end_of_season::user_division(game, &user_team_id) {
                Some(division) => {
                    ofm_core::season_awards::compute_division_season_awards(game, division)
                }
                None => ofm_core::season_awards::compute_season_awards(game),
            }
        })
        .ok_or_else(|| "be.error.noActiveGameSession".to_string())
}

#[cfg(test)]
mod tests {
    use super::advance_to_next_season_internal;
    use chrono::{TimeZone, Utc};
    use domain::league::{
        Fixture, FixtureCompetition, FixtureStatus, League, MatchResult, StandingEntry,
    };
    use domain::manager::Manager;
    use domain::stats::{PlayerMatchStatsRecord, StatsState};
    use domain::team::Team;
    use ofm_core::clock::GameClock;
    use ofm_core::game::Game;
    use ofm_core::state::StateManager;

    fn team(id: &str) -> Team {
        Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "England".to_string(),
            "City".to_string(),
            "Ground".to_string(),
            20_000,
        )
    }

    fn played(id: &str, home: &str, away: &str) -> Fixture {
        Fixture {
            id: id.to_string(),
            matchday: 1,
            date: "2026-05-01".to_string(),
            home_team_id: home.to_string(),
            away_team_id: away.to_string(),
            competition: FixtureCompetition::League,
            status: FixtureStatus::Completed,
            result: Some(MatchResult {
                home_goals: 1,
                away_goals: 0,
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn standing(team_id: &str, won: u32, lost: u32) -> StandingEntry {
        StandingEntry {
            team_id: team_id.to_string(),
            played: won + lost,
            won,
            drawn: 0,
            lost,
            goals_for: won,
            goals_against: lost,
            points: won * 3,
        }
    }

    /// A two-club league of season 5 with both its fixtures played.
    fn finished_season() -> StateManager {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 5, 20, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr".to_string(),
            "Alex".to_string(),
            "Boss".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("home".to_string());
        manager.satisfaction = 80;
        let mut game = Game::new(
            clock,
            manager,
            vec![team("home"), team("away")],
            vec![],
            vec![],
            vec![],
        );
        game.league = Some(League {
            id: "league".to_string(),
            name: "League".to_string(),
            season: 5,
            fixtures: vec![played("f1", "home", "away"), played("f2", "away", "home")],
            standings: vec![standing("home", 1, 1), standing("away", 1, 1)],
            ..Default::default()
        });
        let state = StateManager::new();
        state.set_game(game);
        state
    }

    fn row(fixture_id: &str, season: u32) -> PlayerMatchStatsRecord {
        PlayerMatchStatsRecord {
            fixture_id: fixture_id.to_string(),
            season,
            matchday: 1,
            date: "2026-01-01".to_string(),
            competition: FixtureCompetition::League,
            player_id: "p1".to_string(),
            team_id: "home".to_string(),
            opponent_team_id: "away".to_string(),
            home_team_id: "home".to_string(),
            away_team_id: "away".to_string(),
            home_goals: 0,
            away_goals: 0,
            minutes_played: 90,
            goals: 0,
            assists: 0,
            shots: 0,
            shots_on_target: 0,
            passes_completed: 0,
            passes_attempted: 0,
            tackles_won: 0,
            interceptions: 0,
            fouls_committed: 0,
            yellow_cards: 0,
            red_cards: 0,
            rating: 6.5,
        }
    }

    fn fixture_ids(state: &StateManager) -> Vec<String> {
        state
            .get_stats_state(|stats| {
                stats
                    .player_matches
                    .iter()
                    .map(|record| record.fixture_id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Given stats rows from the season before last, the season just ended and
    /// another competition's later season,
    /// When the season is advanced,
    /// Then only the rows from before the season just ended are dropped.
    #[test]
    fn advancing_drops_stats_from_before_the_season_just_ended() {
        let state = finished_season();
        state.set_stats_state(StatsState {
            player_matches: vec![row("two-ago", 4), row("just-ended", 5), row("later", 6)],
            team_matches: vec![],
        });

        advance_to_next_season_internal(&state).expect("a finished season advances");

        assert_eq!(fixture_ids(&state), vec!["just-ended", "later"]);
    }

    /// Given a season still being played,
    /// When advancing is asked for,
    /// Then it is refused and no stats row is dropped.
    #[test]
    fn a_refused_advance_keeps_every_stats_row() {
        let state = finished_season();
        state.update_game(|game| {
            let league = game.league.as_mut().expect("the league");
            league.fixtures[1].status = FixtureStatus::Scheduled;
            league.fixtures[1].result = None;
        });
        state.set_stats_state(StatsState {
            player_matches: vec![row("two-ago", 4), row("just-ended", 5)],
            team_matches: vec![],
        });

        let refusal = advance_to_next_season_internal(&state).unwrap_err();

        assert_eq!(refusal, "be.error.seasonNotComplete");
        assert_eq!(fixture_ids(&state), vec!["two-ago", "just-ended"]);
    }
}
