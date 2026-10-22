//! A package's generated backfill, re-levelled to the real players of its league. Kept with the
//! package builder because it reads the package's competitions; the levels themselves are
//! `ofm_rules::worldgen::calibration`'s.

use std::collections::{HashMap, HashSet};

use domain::league::CompetitionType;
use domain::player::{Player, SquadRole};
use rand::Rng;

use super::competition_def::CompetitionDefinition;
use ofm_rules::worldgen::calibration::{FillerLevel, calibrate_generated_player};

/// Real players a league needs before its own percentiles replace the
/// reputation table: fewer, and a handful of outliers would set its level.
const MIN_REAL_LEAGUE_PLAYERS: usize = 150;

/// Re-level a package's generated backfill to the real players of its league.
///
/// The backfill is first drawn at its club's reputation. Wherever a league holds
/// at least [`MIN_REAL_LEAGUE_PLAYERS`] authored seniors, their own 25th and 50th
/// percentile is the truer level — a package's reputations are an author's
/// estimate, its players are the league itself — so the backfill of that
/// league's clubs is drawn again from it. Only explicitly listed participants
/// are read: a selector resolves against a built world, which does not exist yet.
pub(super) fn calibrate_backfill_to_leagues(
    players: &mut [Player],
    competitions: &[CompetitionDefinition],
    authored_ids: &HashSet<String>,
    current_year: u32,
    rng: &mut impl Rng,
) {
    let mut league_of: HashMap<&str, &str> = HashMap::new();
    for competition in competitions
        .iter()
        .filter(|competition| competition.r#type == CompetitionType::League)
    {
        for team_id in competition.participants.explicit.iter().flatten() {
            league_of.insert(team_id.as_str(), competition.id.as_str());
        }
    }

    let mut real_ovrs: HashMap<&str, Vec<u8>> = HashMap::new();
    for player in players.iter().filter(|player| {
        authored_ids.contains(&player.id) && player.squad_role == SquadRole::Senior
    }) {
        if let Some(league) = player
            .team_id
            .as_deref()
            .and_then(|team_id| league_of.get(team_id))
        {
            real_ovrs.entry(league).or_default().push(player.ovr);
        }
    }
    let levels: HashMap<&str, FillerLevel> = real_ovrs
        .into_iter()
        .filter(|(_, ovrs)| ovrs.len() >= MIN_REAL_LEAGUE_PLAYERS)
        .filter_map(|(league, ovrs)| Some((league, FillerLevel::from_real_ovrs(&ovrs)?)))
        .collect();

    for player in players
        .iter_mut()
        .filter(|player| !authored_ids.contains(&player.id))
    {
        let level = player
            .team_id
            .as_deref()
            .and_then(|team_id| league_of.get(team_id))
            .and_then(|league| levels.get(league))
            .copied();
        if let Some(level) = level {
            calibrate_generated_player(player, level, current_year, rng);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use domain::player::{Position, SquadRole};

    fn median(values: &mut [u8]) -> u8 {
        values.sort_unstable();
        values[values.len() / 2]
    }

    fn package_team(id: &str) -> TeamDef {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": id, "shortName": id[..3].to_uppercase(), "city": "Town",
            "country": "ENG", "colors": {"primary": "#ffffff", "secondary": "#000000"},
            "playStyle": "Balanced", "stadiumName": "Ground",
            "reputationRange": [700, 700]
        }))
        .expect("a team definition")
    }

    fn package_player(club: &str, index: usize, position: Position) -> package::PlayerDef {
        let mut def: package::PlayerDef =
            serde_json::from_str("{}").expect("PlayerDef should default");
        def.id = format!("{club}-{index}");
        def.first_name = "Real".to_string();
        def.last_name = format!("Player{index}");
        def.club = club.to_string();
        def.nationality = "ENG".to_string();
        def.position = position;
        def.date_of_birth = Some("1998-01-01".to_string());
        def.overall = Some(60);
        def
    }

    fn squad_for(club: &str, size: usize) -> Vec<package::PlayerDef> {
        const LAYOUT: [Position; 10] = [
            Position::Goalkeeper,
            Position::Defender,
            Position::Defender,
            Position::Defender,
            Position::Midfielder,
            Position::Midfielder,
            Position::Midfielder,
            Position::Forward,
            Position::Forward,
            Position::Defender,
        ];
        (0..size)
            .map(|index| package_player(club, index, LAYOUT[index % LAYOUT.len()].clone()))
            .collect()
    }

    /// Given a package league of real players rated about 60, one of whose clubs
    /// is thin, and clubs whose reputation would suggest a stronger league,
    /// when the world is built,
    /// then the players generated to fill the thin club play at that league's level.
    #[test]
    fn backfill_in_a_package_league_plays_at_the_leagues_real_level() {
        let mut package = WorldPackage::default();
        let mut club_ids = Vec::new();
        for index in 0..9 {
            let id = format!("club-{index}");
            package.teams.push(package_team(&id));
            let size = if index == 8 { 5 } else { 22 };
            package.players.extend(squad_for(&id, size));
            club_ids.push(id);
        }
        package.competitions.push(
            serde_json::from_value(serde_json::json!({
                "id": "test-league", "name": "Test League", "type": "League",
                "scope": "Domestic", "countryId": "ENG",
                "format": {"kind": "LeagueTable", "legs": 2},
                "participants": {"explicit": club_ids}
            }))
            .expect("a competition definition"),
        );

        let world = build_world_data_from_package(
            &package,
            Some(2026),
            &definitions::DefinitionSources::embedded_only(),
            1,
        );
        let mut backfill: Vec<u8> = world
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some("club-8"))
            .filter(|player| !player.id.starts_with("club-8-"))
            .filter(|player| player.squad_role == SquadRole::Senior)
            .map(|player| player.ovr)
            .collect();
        assert!(
            backfill.len() >= 10,
            "thin club was topped up: {}",
            backfill.len()
        );
        let backfill_median = median(&mut backfill);
        assert!(
            (52..=62).contains(&backfill_median),
            "backfill median {backfill_median} against a league rated about 60"
        );
    }
}
