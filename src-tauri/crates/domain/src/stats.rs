use crate::league::FixtureCompetition;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct StatsState {
    pub player_matches: Vec<PlayerMatchStatsRecord>,
    pub team_matches: Vec<TeamMatchStatsRecord>,
}

impl StatsState {
    pub fn append(&mut self, other: StatsState) {
        self.player_matches.extend(other.player_matches);
        self.team_matches.extend(other.team_matches);
    }

    /// Drops every player and team row from a season before `first_season`.
    pub fn retain_seasons_from(&mut self, first_season: u32) {
        self.player_matches
            .retain(|record| record.season >= first_season);
        self.team_matches
            .retain(|record| record.season >= first_season);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayerMatchStatsRecord {
    pub fixture_id: String,
    pub season: u32,
    pub matchday: u32,
    pub date: String,
    pub competition: FixtureCompetition,
    pub player_id: String,
    pub team_id: String,
    pub opponent_team_id: String,
    pub home_team_id: String,
    pub away_team_id: String,
    pub home_goals: u8,
    pub away_goals: u8,
    pub minutes_played: u8,
    pub goals: u8,
    pub assists: u8,
    pub shots: u8,
    pub shots_on_target: u8,
    pub passes_completed: u8,
    pub passes_attempted: u8,
    pub tackles_won: u8,
    pub interceptions: u8,
    pub fouls_committed: u8,
    pub yellow_cards: u8,
    pub red_cards: u8,
    pub rating: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeamMatchStatsRecord {
    pub fixture_id: String,
    pub season: u32,
    pub matchday: u32,
    pub date: String,
    pub competition: FixtureCompetition,
    pub team_id: String,
    pub opponent_team_id: String,
    pub home_team_id: String,
    pub away_team_id: String,
    pub goals_for: u8,
    pub goals_against: u8,
    pub possession_pct: u8,
    pub shots: u16,
    pub shots_on_target: u16,
    pub passes_completed: u16,
    pub passes_attempted: u16,
    pub tackles_won: u16,
    pub interceptions: u16,
    pub fouls_committed: u16,
    pub yellow_cards: u8,
    pub red_cards: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player_row(fixture_id: &str, season: u32) -> PlayerMatchStatsRecord {
        PlayerMatchStatsRecord {
            fixture_id: fixture_id.to_string(),
            season,
            matchday: 1,
            date: "2026-01-01".to_string(),
            competition: FixtureCompetition::League,
            player_id: "p1".to_string(),
            team_id: "a".to_string(),
            opponent_team_id: "b".to_string(),
            home_team_id: "a".to_string(),
            away_team_id: "b".to_string(),
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

    fn team_row(fixture_id: &str, season: u32) -> TeamMatchStatsRecord {
        TeamMatchStatsRecord {
            fixture_id: fixture_id.to_string(),
            season,
            matchday: 1,
            date: "2026-01-01".to_string(),
            competition: FixtureCompetition::League,
            team_id: "a".to_string(),
            opponent_team_id: "b".to_string(),
            home_team_id: "a".to_string(),
            away_team_id: "b".to_string(),
            goals_for: 0,
            goals_against: 0,
            possession_pct: 50,
            shots: 0,
            shots_on_target: 0,
            passes_completed: 0,
            passes_attempted: 0,
            tackles_won: 0,
            interceptions: 0,
            fouls_committed: 0,
            yellow_cards: 0,
            red_cards: 0,
        }
    }

    /// Given player and team rows from three seasons, when the ones before the
    /// middle season are dropped, then the middle and latest seasons remain in
    /// both lists.
    #[test]
    fn keeps_only_the_seasons_from_the_given_one() {
        let mut stats = StatsState {
            player_matches: vec![
                player_row("old", 1),
                player_row("mid", 2),
                player_row("new", 3),
            ],
            team_matches: vec![team_row("old", 1), team_row("mid", 2), team_row("new", 3)],
        };

        stats.retain_seasons_from(2);

        let players: Vec<&str> = stats
            .player_matches
            .iter()
            .map(|r| r.fixture_id.as_str())
            .collect();
        let teams: Vec<&str> = stats
            .team_matches
            .iter()
            .map(|r| r.fixture_id.as_str())
            .collect();
        assert_eq!(players, vec!["mid", "new"]);
        assert_eq!(teams, vec!["mid", "new"]);
    }
}
