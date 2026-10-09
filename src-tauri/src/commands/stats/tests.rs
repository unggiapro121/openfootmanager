use chrono::{TimeZone, Utc};
use domain::league::{
    CompactLineup, CompactMatchReport, CompactTeamMatchStats, Fixture, FixtureCompetition,
    FixtureStatus, GoalEvent, League, LineupSlot, MatchResult,
};
use domain::manager::Manager;
use domain::player::{Player, PlayerAttributes, PlayerSeasonStats, Position};
use domain::stats::{PlayerMatchStatsRecord, StatsState, TeamMatchStatsRecord};
use domain::team::Team;
use ofm_core::clock::GameClock;
use ofm_core::game::Game;
use ofm_core::state::StateManager;

use super::fixture::get_fixture_detail_internal;
use super::leaders::get_competition_leaders_internal;
use super::player::{get_player_match_history_internal, get_player_stats_overview_internal};
use super::team::{get_team_match_history_internal, get_team_stats_overview_internal};

fn default_attrs() -> PlayerAttributes {
    PlayerAttributes {
        pace: 60,
        stamina: 60,
        strength: 60,
        agility: 60,
        passing: 60,
        shooting: 60,
        tackling: 60,
        dribbling: 60,
        defending: 60,
        positioning: 60,
        vision: 60,
        decisions: 60,
        composure: 60,
        aggression: 60,
        teamwork: 60,
        leadership: 60,
        handling: 60,
        reflexes: 60,
        aerial: 60,
    }
}

fn make_player(id: &str, team_id: &str, natural_position: Position) -> Player {
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        id.to_string(),
        "2000-01-01".to_string(),
        "England".to_string(),
        natural_position.clone(),
        default_attrs(),
    );
    player.team_id = Some(team_id.to_string());
    player.natural_position = natural_position;
    player
}

/// The game with a league whose current schedule holds `fixture_ids`, as
/// every fixture of the season being played is held.
fn on_the_current_schedule(mut game: Game, fixture_ids: &[&str]) -> Game {
    let mut league = League::new("league-now".to_string(), "Now".to_string(), 2026, &[]);
    league.fixtures = fixture_ids
        .iter()
        .map(|id| Fixture {
            id: id.to_string(),
            status: FixtureStatus::Completed,
            ..Default::default()
        })
        .collect();
    game.competitions.push(league);
    game
}

fn make_game(players: Vec<Player>) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 7, 1, 0, 0, 0).unwrap());
    let mut manager = Manager::new(
        "mgr-1".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());

    let mut team = Team::new(
        "team-1".to_string(),
        "Alpha FC".to_string(),
        "ALP".to_string(),
        "England".to_string(),
        "Alpha City".to_string(),
        "Alpha Ground".to_string(),
        20_000,
    );
    team.starting_xi_ids = players.iter().map(|player| player.id.clone()).collect();

    let opponent = Team::new(
        "team-2".to_string(),
        "Bravo FC".to_string(),
        "BRV".to_string(),
        "England".to_string(),
        "Bravo City".to_string(),
        "Bravo Ground".to_string(),
        18_000,
    );

    Game::new(
        clock,
        manager,
        vec![team, opponent],
        players,
        vec![],
        vec![],
    )
}

fn sample_stats_state() -> StatsState {
    StatsState {
        player_matches: vec![
            PlayerMatchStatsRecord {
                fixture_id: "fixture-older".to_string(),
                season: 2025,
                matchday: 1,
                date: "2025-06-10".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-1".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-1".to_string(),
                away_team_id: "team-2".to_string(),
                home_goals: 2,
                away_goals: 1,
                minutes_played: 90,
                goals: 1,
                assists: 0,
                shots: 4,
                shots_on_target: 2,
                passes_completed: 20,
                passes_attempted: 24,
                tackles_won: 1,
                interceptions: 0,
                fouls_committed: 1,
                yellow_cards: 0,
                red_cards: 0,
                rating: 7.2,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-latest".to_string(),
                season: 2025,
                matchday: 2,
                date: "2025-06-17".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-1".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-3".to_string(),
                home_team_id: "team-3".to_string(),
                away_team_id: "team-1".to_string(),
                home_goals: 0,
                away_goals: 3,
                minutes_played: 88,
                goals: 2,
                assists: 1,
                shots: 5,
                shots_on_target: 3,
                passes_completed: 24,
                passes_attempted: 28,
                tackles_won: 2,
                interceptions: 1,
                fouls_committed: 0,
                yellow_cards: 0,
                red_cards: 0,
                rating: 8.4,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-other-player".to_string(),
                season: 2025,
                matchday: 2,
                date: "2025-06-17".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-2".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-3".to_string(),
                home_team_id: "team-3".to_string(),
                away_team_id: "team-1".to_string(),
                home_goals: 0,
                away_goals: 3,
                minutes_played: 90,
                goals: 0,
                assists: 0,
                shots: 1,
                shots_on_target: 0,
                passes_completed: 40,
                passes_attempted: 48,
                tackles_won: 4,
                interceptions: 3,
                fouls_committed: 2,
                yellow_cards: 1,
                red_cards: 0,
                rating: 7.0,
            },
        ],
        team_matches: vec![],
    }
}

fn sample_team_stats_state() -> StatsState {
    StatsState {
        player_matches: vec![],
        team_matches: vec![
            TeamMatchStatsRecord {
                fixture_id: "fixture-1".to_string(),
                season: 2025,
                matchday: 1,
                date: "2025-08-01".to_string(),
                competition: FixtureCompetition::League,
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-1".to_string(),
                away_team_id: "team-2".to_string(),
                goals_for: 2,
                goals_against: 0,
                possession_pct: 58,
                shots: 14,
                shots_on_target: 6,
                passes_completed: 420,
                passes_attempted: 500,
                tackles_won: 18,
                interceptions: 11,
                fouls_committed: 9,
                yellow_cards: 1,
                red_cards: 0,
            },
            TeamMatchStatsRecord {
                fixture_id: "fixture-2".to_string(),
                season: 2026,
                matchday: 1,
                date: "2026-08-01".to_string(),
                competition: FixtureCompetition::League,
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-2".to_string(),
                away_team_id: "team-1".to_string(),
                goals_for: 3,
                goals_against: 1,
                possession_pct: 62,
                shots: 16,
                shots_on_target: 7,
                passes_completed: 460,
                passes_attempted: 540,
                tackles_won: 20,
                interceptions: 13,
                fouls_committed: 10,
                yellow_cards: 2,
                red_cards: 0,
            },
        ],
    }
}

#[test]
fn get_player_stats_overview_aggregates_history_and_uses_exact_position_cohorts() {
    let mut player = make_player("player-1", "team-1", Position::Striker);
    player.stats = PlayerSeasonStats {
        appearances: 1,
        goals: 1,
        assists: 1,
        clean_sheets: 0,
        yellow_cards: 0,
        red_cards: 0,
        avg_rating: 7.0,
        rated_appearances: 1,
        minutes_played: 90,
        shots: 2,
        shots_on_target: 1,
        passes_completed: 10,
        passes_attempted: 12,
        tackles_won: 1,
        interceptions: 0,
        fouls_committed: 1,
    };
    let peer_a = make_player("player-2", "team-1", Position::Striker);
    let peer_b = make_player("player-3", "team-1", Position::Striker);
    let broad_bucket_peer = make_player("player-4", "team-1", Position::Forward);

    let state = StateManager::new();
    state.set_game(on_the_current_schedule(
        make_game(vec![player, peer_a, peer_b, broad_bucket_peer]),
        &[
            "fixture-a",
            "fixture-b",
            "fixture-peer-a-1",
            "fixture-peer-a-2",
            "fixture-peer-b-1",
            "fixture-peer-b-2",
            "fixture-forward-only-1",
            "fixture-forward-only-2",
        ],
    ));
    state.set_stats_state(StatsState {
        player_matches: vec![
            PlayerMatchStatsRecord {
                fixture_id: "fixture-a".to_string(),
                season: 2025,
                matchday: 1,
                date: "2025-08-01".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-1".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-1".to_string(),
                away_team_id: "team-2".to_string(),
                home_goals: 2,
                away_goals: 0,
                minutes_played: 90,
                goals: 1,
                assists: 1,
                shots: 6,
                shots_on_target: 3,
                passes_completed: 25,
                passes_attempted: 30,
                tackles_won: 4,
                interceptions: 2,
                fouls_committed: 1,
                yellow_cards: 0,
                red_cards: 0,
                rating: 8.1,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-b".to_string(),
                season: 2026,
                matchday: 1,
                date: "2026-08-01".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-1".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-2".to_string(),
                away_team_id: "team-1".to_string(),
                home_goals: 1,
                away_goals: 3,
                minutes_played: 90,
                goals: 2,
                assists: 0,
                shots: 4,
                shots_on_target: 2,
                passes_completed: 20,
                passes_attempted: 25,
                tackles_won: 2,
                interceptions: 1,
                fouls_committed: 2,
                yellow_cards: 0,
                red_cards: 0,
                rating: 8.4,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-peer-a-1".to_string(),
                season: 2025,
                matchday: 1,
                date: "2025-08-01".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-2".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-1".to_string(),
                away_team_id: "team-2".to_string(),
                home_goals: 1,
                away_goals: 0,
                minutes_played: 90,
                goals: 0,
                assists: 0,
                shots: 2,
                shots_on_target: 1,
                passes_completed: 18,
                passes_attempted: 24,
                tackles_won: 1,
                interceptions: 1,
                fouls_committed: 1,
                yellow_cards: 0,
                red_cards: 0,
                rating: 6.9,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-peer-a-2".to_string(),
                season: 2026,
                matchday: 1,
                date: "2026-08-01".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-2".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-2".to_string(),
                away_team_id: "team-1".to_string(),
                home_goals: 1,
                away_goals: 1,
                minutes_played: 90,
                goals: 1,
                assists: 0,
                shots: 3,
                shots_on_target: 1,
                passes_completed: 20,
                passes_attempted: 28,
                tackles_won: 2,
                interceptions: 1,
                fouls_committed: 2,
                yellow_cards: 0,
                red_cards: 0,
                rating: 7.1,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-peer-b-1".to_string(),
                season: 2025,
                matchday: 1,
                date: "2025-08-01".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-3".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-1".to_string(),
                away_team_id: "team-2".to_string(),
                home_goals: 0,
                away_goals: 0,
                minutes_played: 90,
                goals: 0,
                assists: 0,
                shots: 3,
                shots_on_target: 1,
                passes_completed: 19,
                passes_attempted: 24,
                tackles_won: 2,
                interceptions: 1,
                fouls_committed: 1,
                yellow_cards: 0,
                red_cards: 0,
                rating: 7.0,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-peer-b-2".to_string(),
                season: 2026,
                matchday: 1,
                date: "2026-08-01".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-3".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-2".to_string(),
                away_team_id: "team-1".to_string(),
                home_goals: 0,
                away_goals: 1,
                minutes_played: 90,
                goals: 0,
                assists: 0,
                shots: 4,
                shots_on_target: 2,
                passes_completed: 18,
                passes_attempted: 22,
                tackles_won: 1,
                interceptions: 1,
                fouls_committed: 1,
                yellow_cards: 0,
                red_cards: 0,
                rating: 7.2,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-forward-only-1".to_string(),
                season: 2025,
                matchday: 1,
                date: "2025-08-01".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-4".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-1".to_string(),
                away_team_id: "team-2".to_string(),
                home_goals: 1,
                away_goals: 1,
                minutes_played: 90,
                goals: 0,
                assists: 0,
                shots: 30,
                shots_on_target: 12,
                passes_completed: 40,
                passes_attempted: 45,
                tackles_won: 1,
                interceptions: 0,
                fouls_committed: 2,
                yellow_cards: 0,
                red_cards: 0,
                rating: 7.3,
            },
            PlayerMatchStatsRecord {
                fixture_id: "fixture-forward-only-2".to_string(),
                season: 2026,
                matchday: 1,
                date: "2026-08-01".to_string(),
                competition: FixtureCompetition::League,
                player_id: "player-4".to_string(),
                team_id: "team-1".to_string(),
                opponent_team_id: "team-2".to_string(),
                home_team_id: "team-2".to_string(),
                away_team_id: "team-1".to_string(),
                home_goals: 0,
                away_goals: 1,
                minutes_played: 90,
                goals: 0,
                assists: 0,
                shots: 30,
                shots_on_target: 14,
                passes_completed: 42,
                passes_attempted: 48,
                tackles_won: 1,
                interceptions: 0,
                fouls_committed: 2,
                yellow_cards: 0,
                red_cards: 0,
                rating: 7.4,
            },
        ],
        team_matches: vec![],
    });

    let overview = get_player_stats_overview_internal(&state, "player-1").unwrap();

    assert!(overview.percentile_eligible);
    assert_eq!(overview.metrics.shots.total, 10);
    assert_eq!(overview.metrics.shots.per90, Some(5.0));
    assert_eq!(overview.metrics.shots.percentile, Some(100));
    assert_eq!(overview.metrics.passes.completed, 45);
    assert_eq!(overview.metrics.passes.attempted, 55);
    assert_eq!(overview.metrics.passes.accuracy, Some(81.8));
    assert_eq!(overview.metrics.passes.percentile, Some(100));
}

#[test]
fn get_player_stats_overview_falls_back_to_current_season_totals_for_legacy_saves() {
    let mut player = make_player("player-1", "team-1", Position::Striker);
    player.stats = PlayerSeasonStats {
        appearances: 10,
        goals: 4,
        assists: 3,
        clean_sheets: 0,
        yellow_cards: 1,
        red_cards: 0,
        avg_rating: 7.2,
        rated_appearances: 10,
        minutes_played: 450,
        shots: 20,
        shots_on_target: 10,
        passes_completed: 80,
        passes_attempted: 100,
        tackles_won: 9,
        interceptions: 6,
        fouls_committed: 5,
    };
    let mut peer_a = make_player("player-2", "team-1", Position::Striker);
    peer_a.stats = PlayerSeasonStats {
        appearances: 10,
        goals: 2,
        assists: 2,
        clean_sheets: 0,
        yellow_cards: 0,
        red_cards: 0,
        avg_rating: 7.0,
        rated_appearances: 10,
        minutes_played: 450,
        shots: 10,
        shots_on_target: 5,
        passes_completed: 70,
        passes_attempted: 100,
        tackles_won: 6,
        interceptions: 4,
        fouls_committed: 3,
    };
    let mut peer_b = make_player("player-3", "team-1", Position::Striker);
    peer_b.stats = PlayerSeasonStats {
        appearances: 10,
        goals: 3,
        assists: 2,
        clean_sheets: 0,
        yellow_cards: 0,
        red_cards: 0,
        avg_rating: 7.0,
        rated_appearances: 10,
        minutes_played: 450,
        shots: 15,
        shots_on_target: 8,
        passes_completed: 75,
        passes_attempted: 100,
        tackles_won: 7,
        interceptions: 5,
        fouls_committed: 4,
    };

    let state = StateManager::new();
    state.set_game(make_game(vec![player, peer_a, peer_b]));

    let overview = get_player_stats_overview_internal(&state, "player-1").unwrap();

    assert!(overview.percentile_eligible);
    assert_eq!(overview.metrics.shots.total, 20);
    assert_eq!(overview.metrics.shots.per90, Some(4.0));
    assert_eq!(overview.metrics.passes.accuracy, Some(80.0));
    assert_eq!(overview.metrics.shots.percentile, Some(100));
}

#[test]
fn get_player_match_history_returns_latest_matches_first_with_limit() {
    let state = StateManager::new();
    state.set_stats_state(sample_stats_state());

    let history = get_player_match_history_internal(&state, "player-1", Some(1)).unwrap();

    assert_eq!(history.len(), 1);
    assert_eq!(history[0].fixture_id, "fixture-latest");
    assert_eq!(history[0].opponent_team_id, "team-3");
    assert_eq!(history[0].goals, 2);
}

#[test]
fn get_player_match_history_returns_empty_when_stats_state_is_missing() {
    let state = StateManager::new();

    let history = get_player_match_history_internal(&state, "player-1", None).unwrap();

    assert!(history.is_empty());
}

#[test]
fn get_team_stats_overview_aggregates_totals_and_match_averages() {
    let state = StateManager::new();
    state.set_game(on_the_current_schedule(
        make_game(vec![make_player("player-1", "team-1", Position::Striker)]),
        &["fixture-1", "fixture-2"],
    ));
    state.set_stats_state(sample_team_stats_state());

    let overview = get_team_stats_overview_internal(&state, "team-1")
        .unwrap()
        .expect("expected team overview");

    assert_eq!(overview.matches_played, 2);
    assert_eq!(overview.goals_for, 5);
    assert_eq!(overview.goals_against, 1);
    assert_eq!(overview.goal_difference, 4);
    assert_eq!(overview.possession_average, Some(60.0));
    assert_eq!(overview.metrics.shots.total, 30);
    assert_eq!(overview.metrics.shots.per_match, Some(15.0));
    assert_eq!(overview.metrics.shots_on_target.total, 13);
    assert_eq!(overview.metrics.shots_on_target.per_match, Some(6.5));
    assert_eq!(overview.metrics.passes.completed, 880);
    assert_eq!(overview.metrics.passes.attempted, 1040);
    assert_eq!(overview.metrics.passes.accuracy, Some(84.6));
    assert_eq!(overview.metrics.tackles_won.per_match, Some(19.0));
}

#[test]
fn get_team_stats_overview_returns_none_without_history() {
    let state = StateManager::new();
    state.set_game(make_game(vec![make_player(
        "player-1",
        "team-1",
        Position::Striker,
    )]));

    let overview = get_team_stats_overview_internal(&state, "team-1").unwrap();

    assert!(overview.is_none());
}

#[test]
fn get_team_match_history_returns_latest_matches_first_with_limit() {
    let state = StateManager::new();
    state.set_game(make_game(vec![make_player(
        "player-1",
        "team-1",
        Position::Striker,
    )]));
    state.set_stats_state(sample_team_stats_state());

    let history = get_team_match_history_internal(&state, "team-1", Some(1)).unwrap();

    assert_eq!(history.len(), 1);
    assert_eq!(history[0].fixture_id, "fixture-2");
    assert_eq!(history[0].opponent_team_id, "team-2");
    assert_eq!(history[0].goals_for, 3);
    assert_eq!(history[0].goals_against, 1);
}

#[test]
fn get_team_match_history_returns_empty_when_stats_state_is_missing() {
    let state = StateManager::new();
    state.set_game(make_game(vec![make_player(
        "player-1",
        "team-1",
        Position::Striker,
    )]));

    let history = get_team_match_history_internal(&state, "team-1", None).unwrap();

    assert!(history.is_empty());
}

fn team_stats(possession_pct: u8) -> CompactTeamMatchStats {
    CompactTeamMatchStats {
        possession_pct,
        shots: 10,
        shots_on_target: 4,
        fouls: 9,
        corners: 5,
        yellow_cards: 1,
        red_cards: 0,
    }
}

/// A game whose league holds `fixture-older` (team-1 2-1 team-2, played, with
/// a report naming player-1 as scorer and starter) and `fixture-next`, still to
/// be played.
fn game_with_a_played_fixture() -> StateManager {
    let mut game = make_game(vec![make_player("player-1", "team-1", Position::Striker)]);
    let mut league = League::new("league-1".to_string(), "Premier".to_string(), 2025, &[]);
    league.fixtures = vec![
        Fixture {
            id: "fixture-older".to_string(),
            competition_id: "league-1".to_string(),
            matchday: 1,
            date: "2025-06-10".to_string(),
            home_team_id: "team-1".to_string(),
            away_team_id: "team-2".to_string(),
            status: FixtureStatus::Completed,
            result: Some(MatchResult {
                home_goals: 2,
                away_goals: 1,
                home_scorers: vec![GoalEvent {
                    player_id: "player-1".to_string(),
                    minute: 12,
                }],
                report: Some(CompactMatchReport {
                    total_minutes: 93,
                    home_stats: team_stats(55),
                    away_stats: team_stats(45),
                    events: vec![],
                    home_lineup: Some(CompactLineup {
                        formation: "4-4-2".to_string(),
                        play_style: "Balanced".to_string(),
                        starters: vec![LineupSlot {
                            player_id: "player-1".to_string(),
                            position: "Striker".to_string(),
                        }],
                        bench: vec![],
                    }),
                    away_lineup: None,
                }),
                ..Default::default()
            }),
            ..Default::default()
        },
        Fixture {
            id: "fixture-next".to_string(),
            competition_id: "league-1".to_string(),
            matchday: 2,
            date: "2025-07-20".to_string(),
            home_team_id: "team-2".to_string(),
            away_team_id: "team-1".to_string(),
            ..Default::default()
        },
    ];
    game.competitions = vec![league];
    let state = StateManager::new();
    state.set_game(game);
    let mut stats = sample_stats_state();
    stats.team_matches = sample_team_stats_state()
        .team_matches
        .into_iter()
        .map(|mut record| {
            record.fixture_id = "fixture-older".to_string();
            record
        })
        .collect();
    state.set_stats_state(stats);
    state
}

/// Given a played fixture with a report and stats rows,
/// When its detail is fetched,
/// Then it names both sides and the competition, carries the result with its
/// report and lineup, and only that fixture's team and player stats, with the
/// players it mentions named.
#[test]
fn get_fixture_detail_returns_a_played_fixtures_full_record() {
    let state = game_with_a_played_fixture();

    let detail = get_fixture_detail_internal(&state, "fixture-older").unwrap();

    assert_eq!(detail.competition_name, "Premier");
    assert_eq!(detail.home_team_name, "Alpha FC");
    assert_eq!(detail.away_team_name, "Bravo FC");
    let result = detail.result.expect("a played fixture has a result");
    assert_eq!((result.home_goals, result.away_goals), (2, 1));
    let report = result.report.expect("the report");
    assert_eq!(report.home_lineup.expect("lineup").formation, "4-4-2");
    assert!(
        detail
            .player_stats
            .iter()
            .all(|row| row.player_id == "player-1"),
        "only fixture-older's rows: {:?}",
        detail.player_stats
    );
    assert_eq!(detail.player_stats.len(), 1);
    assert_eq!(detail.player_stats[0].rating, 7.2);
    assert!(!detail.team_stats.is_empty());
    assert!(detail
        .players
        .iter()
        .any(|player| player.id == "player-1" && player.position == "Striker"));
}

/// Given a fixture still to be played,
/// When its detail is fetched,
/// Then it has no result and no stats.
#[test]
fn get_fixture_detail_of_an_unplayed_fixture_has_no_result() {
    let state = game_with_a_played_fixture();

    let detail = get_fixture_detail_internal(&state, "fixture-next").unwrap();

    assert!(detail.result.is_none());
    assert!(detail.player_stats.is_empty());
    assert!(detail.team_stats.is_empty());
}

/// Given an id no fixture has,
/// When its detail is fetched,
/// Then the error is the translated "fixture not found" key.
#[test]
fn get_fixture_detail_of_an_unknown_fixture_is_an_error() {
    let state = game_with_a_played_fixture();

    let error = get_fixture_detail_internal(&state, "no-such-fixture").unwrap_err();

    assert_eq!(error, "be.error.liveMatch.fixtureNotFound");
}

/// Given a player who scored in a league fixture and again in a fixture of
/// another competition,
/// When the league's leaders are fetched,
/// Then only the league goal counts, and the row names him and his club.
#[test]
fn get_competition_leaders_counts_only_that_competitions_fixtures() {
    let state = game_with_a_played_fixture();

    let leaders = get_competition_leaders_internal(&state, "league-1").unwrap();

    assert_eq!(leaders.competition_id, "league-1");
    assert_eq!(leaders.goals.len(), 1);
    let scorer = &leaders.goals[0];
    assert_eq!(scorer.player_id, "player-1");
    assert_eq!(scorer.value, 1);
    assert_eq!(scorer.team_name.as_deref(), Some("Alpha FC"));
    assert!(leaders.red_cards.is_empty());
}

/// Given an id no competition has,
/// When its leaders are fetched,
/// Then every board is empty rather than an error.
#[test]
fn get_competition_leaders_of_an_unknown_competition_is_empty() {
    let state = game_with_a_played_fixture();

    let leaders = get_competition_leaders_internal(&state, "no-such-competition").unwrap();

    assert!(leaders.goals.is_empty());
    assert!(leaders.assists.is_empty());
}

/// Given no game is loaded,
/// When leaders are fetched,
/// Then the error is the translated "no active game" key.
#[test]
fn get_competition_leaders_without_a_game_is_an_error() {
    let error = get_competition_leaders_internal(&StateManager::new(), "league-1").unwrap_err();

    assert_eq!(error, "be.error.noActiveGameSession");
}

/// Given a player's rows from a match of this season and from one of the season
/// just ended, which is no longer on any schedule,
/// When his stats overview is built,
/// Then only this season's match counts.
#[test]
fn get_player_stats_overview_counts_only_this_seasons_matches() {
    let state = StateManager::new();
    state.set_game(on_the_current_schedule(
        make_game(vec![make_player("player-1", "team-1", Position::Striker)]),
        &["this-season"],
    ));
    let mut stats = sample_stats_state();
    stats.player_matches.truncate(1);
    let this_season = PlayerMatchStatsRecord {
        fixture_id: "this-season".to_string(),
        shots: 3,
        ..stats.player_matches[0].clone()
    };
    let last_season = PlayerMatchStatsRecord {
        fixture_id: "last-season".to_string(),
        shots: 40,
        ..stats.player_matches[0].clone()
    };
    stats.player_matches = vec![this_season, last_season];
    state.set_stats_state(stats);

    let overview = get_player_stats_overview_internal(&state, "player-1").unwrap();

    assert_eq!(overview.metrics.shots.total, 3);
}

/// Given a team's rows from a match of this season and from one of the season
/// just ended, which is no longer on any schedule,
/// When its stats overview is built,
/// Then only this season's match counts.
#[test]
fn get_team_stats_overview_counts_only_this_seasons_matches() {
    let state = StateManager::new();
    state.set_game(on_the_current_schedule(
        make_game(vec![make_player("player-1", "team-1", Position::Striker)]),
        &["fixture-1"],
    ));
    state.set_stats_state(sample_team_stats_state());

    let overview = get_team_stats_overview_internal(&state, "team-1")
        .unwrap()
        .expect("expected team overview");

    assert_eq!(overview.matches_played, 1);
}
