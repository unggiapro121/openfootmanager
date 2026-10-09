use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerAdvancedMetricDto {
    pub total: u32,
    pub per90: Option<f32>,
    pub percentile: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerAdvancedPassMetricDto {
    pub completed: u32,
    pub attempted: u32,
    pub accuracy: Option<f32>,
    pub percentile: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStatsOverviewMetricsDto {
    pub shots: PlayerAdvancedMetricDto,
    pub shots_on_target: PlayerAdvancedMetricDto,
    pub passes: PlayerAdvancedPassMetricDto,
    pub tackles_won: PlayerAdvancedMetricDto,
    pub interceptions: PlayerAdvancedMetricDto,
    pub fouls_committed: PlayerAdvancedMetricDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStatsOverviewDto {
    pub percentile_eligible: bool,
    pub metrics: PlayerStatsOverviewMetricsDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlayerMatchHistoryEntryDto {
    pub fixture_id: String,
    pub date: String,
    pub competition: String,
    pub matchday: u32,
    pub opponent_team_id: String,
    pub opponent_name: String,
    pub team_goals: u8,
    pub opponent_goals: u8,
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
#[serde(rename_all = "camelCase")]
pub struct TeamMatchHistoryEntryDto {
    pub fixture_id: String,
    pub date: String,
    pub competition: String,
    pub matchday: u32,
    pub opponent_team_id: String,
    pub opponent_name: String,
    pub goals_for: u8,
    pub goals_against: u8,
    pub possession_pct: u8,
    pub shots: u16,
    pub shots_on_target: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamAdvancedMetricDto {
    pub total: u32,
    pub per_match: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamAdvancedPassMetricDto {
    pub completed: u32,
    pub attempted: u32,
    pub accuracy: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatsOverviewMetricsDto {
    pub shots: TeamAdvancedMetricDto,
    pub shots_on_target: TeamAdvancedMetricDto,
    pub passes: TeamAdvancedPassMetricDto,
    pub tackles_won: TeamAdvancedMetricDto,
    pub interceptions: TeamAdvancedMetricDto,
    pub fouls_committed: TeamAdvancedMetricDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatsOverviewDto {
    pub matches_played: u32,
    pub goals_for: u32,
    pub goals_against: u32,
    pub goal_difference: i32,
    pub possession_average: Option<f32>,
    pub metrics: TeamStatsOverviewMetricsDto,
}

/// Everything kept about one fixture, for the match-details dialog.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureDetailDto {
    pub fixture_id: String,
    pub competition_id: String,
    pub competition_name: String,
    pub competition: String,
    pub matchday: u32,
    pub date: String,
    pub home_team_id: String,
    pub home_team_name: String,
    pub away_team_id: String,
    pub away_team_name: String,
    /// The result as the fixture keeps it, report and lineups included; `None`
    /// until the match is played.
    pub result: Option<domain::league::MatchResult>,
    pub team_stats: Vec<FixtureTeamStatsDto>,
    pub player_stats: Vec<FixturePlayerStatsDto>,
    /// Every player the result or the stats mention, named, so a dialog can
    /// show a scorer who has since retired or left.
    pub players: Vec<FixturePlayerRefDto>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FixtureTeamStatsDto {
    pub team_id: String,
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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FixturePlayerStatsDto {
    pub player_id: String,
    pub team_id: String,
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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FixturePlayerRefDto {
    pub id: String,
    pub name: String,
    pub full_name: String,
    /// Natural position, e.g. `"CenterBack"`.
    pub position: String,
}
