use crate::game::Game;
use domain::league::CompetitionState;
use domain::world_history::WorldCupChampionRecord;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Deserialize)]
pub struct CompetitionsQuery {}

#[derive(Debug, Serialize)]
pub struct CompetitionsView {
    pub competitions: Vec<CompetitionState>,
    /// Club team names keyed by ID (only teams appearing in competitions).
    pub team_names: BTreeMap<String, String>,
    /// National team names keyed by ID.
    pub national_team_names: BTreeMap<String, String>,
    /// i18n keys for national team nation names, keyed by national team ID.
    /// Frontend resolves these via `t(key)` and the `nations.nationalTeamTemplate`
    /// template rather than displaying the raw English `national_team_names` entry.
    pub national_team_name_keys: BTreeMap<String, String>,
    pub world_cup_champions: Vec<WorldCupChampionRecord>,
    pub manager_team_id: Option<String>,
    pub active_competition_ids: Vec<String>,
}

pub fn query_competitions(game: &Game, _query: &CompetitionsQuery) -> CompetitionsView {
    let competitions = game.competitions.clone();

    // Build club team lookup from all competitions' participants and fixtures.
    let club_team_ids: BTreeSet<&str> = competitions
        .iter()
        .flat_map(|c| {
            c.participant_ids.iter().map(String::as_str).chain(
                c.fixtures
                    .iter()
                    .flat_map(|f| [f.home_team_id.as_str(), f.away_team_id.as_str()]),
            )
        })
        .collect();

    let team_map: BTreeMap<&str, &str> = game
        .teams
        .iter()
        .map(|t| (t.id.as_str(), t.name.as_str()))
        .collect();

    let team_names: BTreeMap<String, String> = team_map
        .iter()
        .filter(|(id, _)| club_team_ids.contains(*id))
        .map(|(id, name)| (id.to_string(), name.to_string()))
        .collect();

    let national_team_names: BTreeMap<String, String> = game
        .national_teams
        .iter()
        .map(|nt| (nt.id.clone(), nt.name.clone()))
        .collect();

    let national_team_name_keys: BTreeMap<String, String> = game
        .national_teams
        .iter()
        .filter_map(|nt| nt.name_key.as_ref().map(|key| (nt.id.clone(), key.clone())))
        .collect();

    CompetitionsView {
        competitions,
        team_names,
        national_team_names,
        national_team_name_keys,
        world_cup_champions: game.world_history.world_cup_champions.clone(),
        manager_team_id: game.manager.team_id.clone(),
        active_competition_ids: game.active_competition_ids.clone(),
    }
}
