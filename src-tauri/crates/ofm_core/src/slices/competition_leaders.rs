//! A competition's player leaderboards: goals, assists, yellow and red cards.
//!
//! The per-match stats rows carry the kind of fixture (league, cup, …) but not
//! which competition it belonged to, so a competition's rows are picked by the
//! ids of its own played fixtures.

use std::collections::{BTreeMap, HashSet};

use domain::league::FixtureStatus;
use domain::stats::PlayerMatchStatsRecord;
use serde::Serialize;

use crate::game::Game;

/// One leaderboard row: the player as he is now, and his tally in the competition.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LeaderEntry {
    pub player_id: String,
    pub match_name: String,
    pub full_name: String,
    pub team_id: Option<String>,
    pub team_name: Option<String>,
    pub value: u32,
}

/// Each leaderboard, best first, at most `limit` rows long.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct CompetitionLeaders {
    pub goals: Vec<LeaderEntry>,
    pub assists: Vec<LeaderEntry>,
    pub yellow_cards: Vec<LeaderEntry>,
    pub red_cards: Vec<LeaderEntry>,
}

#[derive(Default)]
struct Tally {
    goals: u32,
    assists: u32,
    yellow_cards: u32,
    red_cards: u32,
}

/// The ids of a competition's played fixtures; empty for an unknown competition.
pub fn played_fixture_ids(game: &Game, competition_id: &str) -> HashSet<String> {
    game.competitions
        .iter()
        .filter(|competition| competition.id == competition_id)
        .flat_map(|competition| competition.fixtures.iter())
        .filter(|fixture| fixture.status == FixtureStatus::Completed)
        .map(|fixture| fixture.id.clone())
        .collect()
}

/// The leaderboards built from `rows`, which the caller has already narrowed to
/// one competition's fixtures. Ties go to the player whose name sorts first, so
/// the order does not change between two looks at the same table.
pub fn competition_leaders(
    game: &Game,
    rows: &[PlayerMatchStatsRecord],
    limit: usize,
) -> CompetitionLeaders {
    let mut tallies: BTreeMap<&str, Tally> = BTreeMap::new();
    for row in rows {
        let tally = tallies.entry(row.player_id.as_str()).or_default();
        tally.goals += u32::from(row.goals);
        tally.assists += u32::from(row.assists);
        tally.yellow_cards += u32::from(row.yellow_cards);
        tally.red_cards += u32::from(row.red_cards);
    }
    let board = |value: fn(&Tally) -> u32| leaderboard(game, &tallies, value, limit);
    CompetitionLeaders {
        goals: board(|tally| tally.goals),
        assists: board(|tally| tally.assists),
        yellow_cards: board(|tally| tally.yellow_cards),
        red_cards: board(|tally| tally.red_cards),
    }
}

fn leaderboard(
    game: &Game,
    tallies: &BTreeMap<&str, Tally>,
    value: fn(&Tally) -> u32,
    limit: usize,
) -> Vec<LeaderEntry> {
    let mut entries: Vec<LeaderEntry> = tallies
        .iter()
        .filter(|(_, tally)| value(tally) > 0)
        // A player no longer in the world has no name to show, so he drops out.
        .filter_map(|(player_id, tally)| leader_entry(game, player_id, value(tally)))
        .collect();
    entries.sort_by(|a, b| {
        b.value
            .cmp(&a.value)
            .then_with(|| a.full_name.cmp(&b.full_name))
            .then_with(|| a.player_id.cmp(&b.player_id))
    });
    entries.truncate(limit);
    entries
}

fn leader_entry(game: &Game, player_id: &str, value: u32) -> Option<LeaderEntry> {
    let player = game.players.iter().find(|player| player.id == player_id)?;
    let team_name = player.team_id.as_deref().and_then(|team_id| {
        game.teams
            .iter()
            .find(|team| team.id == team_id)
            .map(|team| team.name.clone())
    });
    Some(LeaderEntry {
        player_id: player.id.clone(),
        match_name: player.match_name.clone(),
        full_name: player.full_name.clone(),
        team_id: player.team_id.clone(),
        team_name,
        value,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::test_support::uniform_attributes;
    use chrono::{TimeZone, Utc};
    use domain::league::{Fixture, FixtureCompetition, League};
    use domain::manager::Manager;
    use domain::player::{Player, Position};
    use domain::team::Team;

    fn player(id: &str, name: &str, team_id: &str) -> Player {
        let mut player = Player::new(
            id.to_string(),
            name.to_string(),
            format!("{name} Full"),
            "1998-01-01".to_string(),
            "England".to_string(),
            Position::Striker,
            uniform_attributes(60),
        );
        player.team_id = Some(team_id.to_string());
        player
    }

    fn team(id: &str, name: &str) -> Team {
        Team::new(
            id.to_string(),
            name.to_string(),
            name.to_string(),
            "England".to_string(),
            "City".to_string(),
            "Ground".to_string(),
            20_000,
        )
    }

    fn fixture(id: &str, status: FixtureStatus) -> Fixture {
        Fixture {
            id: id.to_string(),
            status,
            ..Default::default()
        }
    }

    fn game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr".to_string(),
            "Alex".to_string(),
            "Boss".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let mut game = Game::new(
            clock,
            manager,
            vec![team("reds", "Reds"), team("blues", "Blues")],
            vec![
                player("kane", "Kane", "reds"),
                player("son", "Son", "reds"),
                player("bellingham", "Bellingham", "blues"),
                // An id that sorts last for a name that sorts first.
                player("z-adams", "Adams", "blues"),
            ],
            vec![],
            vec![],
        );
        let mut league = League::new("eng-1".to_string(), "Premier".to_string(), 2026, &[]);
        league.fixtures = vec![
            fixture("l1", FixtureStatus::Completed),
            fixture("l2", FixtureStatus::Completed),
            fixture("l3", FixtureStatus::Scheduled),
        ];
        let mut cup = League::new("eng-cup".to_string(), "FA Cup".to_string(), 2026, &[]);
        cup.fixtures = vec![fixture("c1", FixtureStatus::Completed)];
        game.competitions = vec![league, cup];
        game
    }

    fn row(fixture_id: &str, player_id: &str) -> PlayerMatchStatsRecord {
        PlayerMatchStatsRecord {
            fixture_id: fixture_id.to_string(),
            season: 2026,
            matchday: 1,
            date: "2026-09-01".to_string(),
            competition: FixtureCompetition::League,
            player_id: player_id.to_string(),
            team_id: "reds".to_string(),
            opponent_team_id: "blues".to_string(),
            home_team_id: "reds".to_string(),
            away_team_id: "blues".to_string(),
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

    fn values(entries: &[LeaderEntry]) -> Vec<(&str, u32)> {
        entries
            .iter()
            .map(|entry| (entry.player_id.as_str(), entry.value))
            .collect()
    }

    /// Given a league with played and unplayed fixtures, then only the played
    /// ones are its fixtures to count, and a cup's are not among them.
    #[test]
    fn only_a_competitions_own_played_fixtures_count() {
        let ids = played_fixture_ids(&game(), "eng-1");

        assert_eq!(ids, HashSet::from(["l1".to_string(), "l2".to_string()]));
        assert!(played_fixture_ids(&game(), "no-such-competition").is_empty());
    }

    /// Given goals, assists and cards over two matches, then each board adds
    /// them up per player, best first, leaving out players with none.
    #[test]
    fn adds_up_each_players_goals_assists_and_cards() {
        let rows = vec![
            PlayerMatchStatsRecord {
                goals: 2,
                assists: 1,
                yellow_cards: 1,
                ..row("l1", "kane")
            },
            PlayerMatchStatsRecord {
                goals: 1,
                ..row("l2", "kane")
            },
            PlayerMatchStatsRecord {
                assists: 2,
                red_cards: 1,
                ..row("l1", "son")
            },
            row("l2", "bellingham"),
        ];

        let leaders = competition_leaders(&game(), &rows, 10);

        assert_eq!(values(&leaders.goals), vec![("kane", 3)]);
        assert_eq!(values(&leaders.assists), vec![("son", 2), ("kane", 1)]);
        assert_eq!(values(&leaders.yellow_cards), vec![("kane", 1)]);
        assert_eq!(values(&leaders.red_cards), vec![("son", 1)]);
    }

    /// Given players level on goals, then the order is by name, not by id, so
    /// the table reads the same every time.
    #[test]
    fn breaks_a_tie_by_name() {
        let rows = vec![
            PlayerMatchStatsRecord {
                goals: 1,
                ..row("l1", "son")
            },
            PlayerMatchStatsRecord {
                goals: 1,
                ..row("l1", "z-adams")
            },
            PlayerMatchStatsRecord {
                goals: 1,
                ..row("l1", "kane")
            },
        ];

        let leaders = competition_leaders(&game(), &rows, 2);

        assert_eq!(values(&leaders.goals), vec![("z-adams", 1), ("kane", 1)]);
    }

    /// Given a leader, then his row names him and his current club.
    #[test]
    fn names_each_leader_and_his_club() {
        let rows = vec![PlayerMatchStatsRecord {
            goals: 1,
            ..row("l1", "bellingham")
        }];

        let leaders = competition_leaders(&game(), &rows, 10);

        let entry = &leaders.goals[0];
        assert_eq!(entry.match_name, "Bellingham");
        assert_eq!(entry.full_name, "Bellingham Full");
        assert_eq!(entry.team_id.as_deref(), Some("blues"));
        assert_eq!(entry.team_name.as_deref(), Some("Blues"));
    }

    /// Given a scorer who is no longer in the world, then he is left out
    /// rather than shown without a name.
    #[test]
    fn leaves_out_a_player_no_longer_in_the_world() {
        let rows = vec![PlayerMatchStatsRecord {
            goals: 4,
            ..row("l1", "retired")
        }];

        assert!(competition_leaders(&game(), &rows, 10).goals.is_empty());
    }
}
