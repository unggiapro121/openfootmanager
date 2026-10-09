use std::collections::BTreeSet;

use domain::league::MatchResult;
use domain::stats::{PlayerMatchStatsRecord, TeamMatchStatsRecord};
use ofm_core::fixture_lookup::{find_fixture, side_name};
use ofm_core::game::Game;
use ofm_core::state::StateManager;

use super::dto::{
    FixtureDetailDto, FixturePlayerRefDto, FixturePlayerStatsDto, FixtureTeamStatsDto,
};
use super::shared::competition_label;

const ERR_FIXTURE_NOT_FOUND: &str = "be.error.liveMatch.fixtureNotFound";

/// The full record of one fixture: its result and report as the fixture keeps
/// them, and the team and player stats captured when it was played.
pub fn get_fixture_detail_internal(
    state: &StateManager,
    fixture_id: &str,
) -> Result<FixtureDetailDto, String> {
    let (team_stats, player_stats) = state
        .get_stats_state(|stats| {
            let teams: Vec<FixtureTeamStatsDto> = stats
                .team_matches
                .iter()
                .filter(|record| record.fixture_id == fixture_id)
                .map(team_stats_dto)
                .collect();
            let players: Vec<FixturePlayerStatsDto> = stats
                .player_matches
                .iter()
                .filter(|record| record.fixture_id == fixture_id)
                .map(player_stats_dto)
                .collect();
            (teams, players)
        })
        .unwrap_or_default();

    state
        .get_game(|game| {
            let found =
                find_fixture(game, fixture_id).ok_or_else(|| ERR_FIXTURE_NOT_FOUND.to_string())?;
            let fixture = found.fixture;
            let players = mentioned_players(game, fixture.result.as_ref(), &player_stats);
            Ok(FixtureDetailDto {
                fixture_id: fixture.id.clone(),
                competition_id: found.competition_id,
                competition_name: found.competition_name,
                competition: competition_label(&fixture.competition),
                matchday: fixture.matchday,
                date: fixture.date.clone(),
                home_team_id: fixture.home_team_id.clone(),
                home_team_name: side_name(game, &fixture.home_team_id),
                away_team_id: fixture.away_team_id.clone(),
                away_team_name: side_name(game, &fixture.away_team_id),
                result: fixture.result.clone(),
                team_stats,
                player_stats,
                players,
            })
        })
        .ok_or_else(|| "be.error.noActiveGameSession".to_string())?
}

fn team_stats_dto(record: &TeamMatchStatsRecord) -> FixtureTeamStatsDto {
    FixtureTeamStatsDto {
        team_id: record.team_id.clone(),
        possession_pct: record.possession_pct,
        shots: record.shots,
        shots_on_target: record.shots_on_target,
        passes_completed: record.passes_completed,
        passes_attempted: record.passes_attempted,
        tackles_won: record.tackles_won,
        interceptions: record.interceptions,
        fouls_committed: record.fouls_committed,
        yellow_cards: record.yellow_cards,
        red_cards: record.red_cards,
    }
}

fn player_stats_dto(record: &PlayerMatchStatsRecord) -> FixturePlayerStatsDto {
    FixturePlayerStatsDto {
        player_id: record.player_id.clone(),
        team_id: record.team_id.clone(),
        minutes_played: record.minutes_played,
        goals: record.goals,
        assists: record.assists,
        shots: record.shots,
        shots_on_target: record.shots_on_target,
        passes_completed: record.passes_completed,
        passes_attempted: record.passes_attempted,
        tackles_won: record.tackles_won,
        interceptions: record.interceptions,
        fouls_committed: record.fouls_committed,
        yellow_cards: record.yellow_cards,
        red_cards: record.red_cards,
        rating: record.rating,
    }
}

/// Every player id the result or the stats name, resolved to a name. An id no
/// player has any more is left out, and the dialog shows it as unknown.
fn mentioned_players(
    game: &Game,
    result: Option<&MatchResult>,
    player_stats: &[FixturePlayerStatsDto],
) -> Vec<FixturePlayerRefDto> {
    let mut ids: BTreeSet<&str> = player_stats
        .iter()
        .map(|row| row.player_id.as_str())
        .collect();
    if let Some(result) = result {
        ids.extend(
            result
                .home_scorers
                .iter()
                .chain(result.away_scorers.iter())
                .map(|goal| goal.player_id.as_str()),
        );
        if let Some(report) = &result.report {
            for event in &report.events {
                ids.extend(event.player_id.as_deref());
                ids.extend(event.secondary_player_id.as_deref());
            }
            for lineup in [&report.home_lineup, &report.away_lineup]
                .into_iter()
                .flatten()
            {
                ids.extend(lineup.starters.iter().map(|slot| slot.player_id.as_str()));
                ids.extend(lineup.bench.iter().map(String::as_str));
            }
        }
    }
    game.players
        .iter()
        .filter(|player| ids.contains(player.id.as_str()))
        .map(|player| FixturePlayerRefDto {
            id: player.id.clone(),
            name: player.match_name.clone(),
            full_name: player.full_name.clone(),
            position: format!("{:?}", player.natural_position),
        })
        .collect()
}
