//! A club's authored tactics and default line-up: `tactics` on a package team.
//!
//! What a world opens with, not a standing order. The club starts in the shape,
//! side, roles and phase settings the author wrote; from then on an AI club
//! reviews them like any other (`ai_formation`, `ai_tactics`, its matchday
//! selection), and the manager who takes the club over changes them by hand.
//! Anything left out is chosen the way it is for a club with no `tactics`.

use std::collections::HashSet;

use domain::player::Player;
use domain::team::{MatchRoles, Team};

use super::package::PackageError;
use crate::ai_formation::AI_FORMATIONS;
use crate::player_rating::formation_slots;

/// A shape the game does not offer, named by `formation`.
pub(super) const UNKNOWN_FORMATION: &str = "be.error.package.unknownFormation";
/// A starter, role holder or set-piece taker who is not one of the club's own
/// authored players, named by `player`.
pub(super) const TACTICS_PLAYER_NOT_IN_CLUB: &str = "be.error.package.tacticsPlayerNotInClub";
/// One player named for two slots of the starting eleven, named by `player`.
pub(super) const DUPLICATE_STARTER: &str = "be.error.package.duplicateStarter";

/// The data type lives with `TeamDef` in `ofm_rules::worldgen::definitions` (phase 3, E3-5c);
/// validating and applying it reads the package, so it stays here.
pub use ofm_rules::worldgen::definitions::TeamTacticsDef;

/// Every player the tactics name, with no duplicates.
fn named_players(tactics: &TeamTacticsDef) -> Vec<&str> {
    let roles = &tactics.match_roles;
    let takers = roles.iter().flat_map(|roles| {
        [
            &roles.captain,
            &roles.vice_captain,
            &roles.penalty_taker,
            &roles.free_kick_taker,
            &roles.corner_taker,
        ]
    });
    let mut seen = HashSet::new();
    tactics
        .starting_xi
        .iter()
        .filter(|id| !id.is_empty())
        .map(String::as_str)
        .chain(tactics.player_roles.keys().map(String::as_str))
        .chain(takers.flatten().map(String::as_str))
        .filter(|id| seen.insert(*id))
        .collect()
}

/// The problems with `tactics` on the team `team_id`, whose authored players
/// are `club_players`.
pub(super) fn validate_team_tactics(
    team_id: &str,
    tactics: &TeamTacticsDef,
    club_players: &HashSet<&str>,
) -> Vec<PackageError> {
    let mut errors = Vec::new();
    if let Some(formation) = &tactics.formation
        && !AI_FORMATIONS.contains(&formation.as_str())
    {
        errors.push(
            PackageError::new(UNKNOWN_FORMATION, "")
                .with("team", team_id)
                .with("formation", formation),
        );
    }
    for player in named_players(tactics) {
        if !club_players.contains(player) {
            errors.push(
                PackageError::new(TACTICS_PLAYER_NOT_IN_CLUB, "")
                    .with("team", team_id)
                    .with("player", player),
            );
        }
    }
    let mut starters = HashSet::new();
    let mut reported = HashSet::new();
    for starter in tactics.starting_xi.iter().filter(|id| !id.is_empty()) {
        if !starters.insert(starter) && reported.insert(starter) {
            errors.push(
                PackageError::new(DUPLICATE_STARTER, "")
                    .with("team", team_id)
                    .with("player", starter),
            );
        }
    }
    errors
}

/// Open `team` in its authored tactics. `players` is the finished squad; a
/// player the tactics name who is not in it is skipped rather than trusted, so
/// a package that failed validation still builds a playable club.
pub(super) fn apply_authored_tactics(
    team: &mut Team,
    players: &[Player],
    tactics: &TeamTacticsDef,
) {
    let in_squad: HashSet<&str> = players.iter().map(|player| player.id.as_str()).collect();
    let formation = tactics
        .formation
        .as_deref()
        .filter(|formation| AI_FORMATIONS.contains(formation));
    if let Some(formation) = formation {
        team.formation = formation.to_string();
        if let Some(eleven) = full_eleven(&tactics.starting_xi, formation, &in_squad) {
            team.starting_xi_ids = eleven;
        }
    }
    if let Some(phase) = &tactics.phase {
        team.tactics_phase = phase.clone();
    }
    for (player, role) in &tactics.player_roles {
        if in_squad.contains(player.as_str()) {
            team.player_roles.insert(player.clone(), role.clone());
        }
    }
    if let Some(roles) = &tactics.match_roles {
        let keep = |id: &Option<String>| id.clone().filter(|id| in_squad.contains(id.as_str()));
        team.match_roles = MatchRoles {
            captain: keep(&roles.captain),
            vice_captain: keep(&roles.vice_captain),
            penalty_taker: keep(&roles.penalty_taker),
            free_kick_taker: keep(&roles.free_kick_taker),
            corner_taker: keep(&roles.corner_taker),
        };
    }
}

/// `starting_xi` when it names a distinct squad player for every slot of
/// `formation`. A partial side is left to the game, which builds a whole one
/// around nothing rather than around half an author's intent.
fn full_eleven(
    starting_xi: &[String],
    formation: &str,
    in_squad: &HashSet<&str>,
) -> Option<Vec<String>> {
    let slots = formation_slots(formation).len();
    let distinct: HashSet<&str> = starting_xi.iter().map(String::as_str).collect();
    let complete = starting_xi.len() == slots
        && distinct.len() == slots
        && starting_xi.iter().all(|id| in_squad.contains(id.as_str()));
    complete.then(|| starting_xi.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generator::TeamDef;
    use crate::generator::package::{PlayerDef, WorldPackage, validate_references};

    fn package_with(tactics: TeamTacticsDef) -> WorldPackage {
        let mut team: TeamDef = serde_json::from_value(serde_json::json!({
            "id": "arsenal", "name": "Arsenal", "city": "London", "country": "ENG",
            "colors": { "primary": "#ff0000", "secondary": "#ffffff" }
        }))
        .unwrap();
        team.tactics = Some(tactics);
        let player = |id: &str, club: &str| -> PlayerDef {
            serde_json::from_value(serde_json::json!({
                "id": id, "firstName": "A", "lastName": id, "club": club,
                "nationality": "ENG", "position": "Striker"
            }))
            .unwrap()
        };
        let chelsea: TeamDef = serde_json::from_value(serde_json::json!({
            "id": "chelsea", "name": "Chelsea", "city": "London", "country": "ENG",
            "colors": { "primary": "#0000ff", "secondary": "#ffffff" }
        }))
        .unwrap();
        let mut package = WorldPackage::default();
        package.teams.extend([team, chelsea]);
        package
            .players
            .extend([player("saka", "arsenal"), player("palmer", "chelsea")]);
        package
    }

    fn tactics_errors(package: &WorldPackage) -> Vec<(String, Vec<(String, String)>)> {
        validate_references(package)
            .into_iter()
            .filter(|error| {
                [
                    UNKNOWN_FORMATION,
                    TACTICS_PLAYER_NOT_IN_CLUB,
                    DUPLICATE_STARTER,
                ]
                .contains(&error.code.as_str())
            })
            .map(|error| (error.code, error.params))
            .collect()
    }

    /// Given tactics that name only the club's own players in a shape the
    /// game offers, when the package is validated, then nothing is reported.
    #[test]
    fn tactics_naming_the_clubs_own_players_are_valid() {
        let package = package_with(TeamTacticsDef {
            formation: Some("4-3-3".into()),
            starting_xi: vec!["saka".into()],
            ..Default::default()
        });

        assert!(tactics_errors(&package).is_empty());
    }

    /// Given a shape the game does not offer, when the package is validated,
    /// then it is reported with the team and the shape.
    #[test]
    fn an_unknown_formation_is_reported() {
        let package = package_with(TeamTacticsDef {
            formation: Some("2-3-5".into()),
            ..Default::default()
        });

        assert_eq!(
            tactics_errors(&package),
            vec![(
                UNKNOWN_FORMATION.to_string(),
                vec![
                    ("team".to_string(), "arsenal".to_string()),
                    ("formation".to_string(), "2-3-5".to_string())
                ]
            )]
        );
    }

    /// Given a starter and a captain from another club and one starter named
    /// twice, when the package is validated, then the outsider is reported
    /// once and the repeated starter once.
    #[test]
    fn outsiders_and_repeated_starters_are_reported_once_each() {
        let package = package_with(TeamTacticsDef {
            formation: Some("4-4-2".into()),
            starting_xi: vec!["palmer".into(), "saka".into(), "saka".into()],
            match_roles: Some(MatchRoles {
                captain: Some("palmer".into()),
                ..Default::default()
            }),
            ..Default::default()
        });

        let codes: Vec<(String, String)> = tactics_errors(&package)
            .into_iter()
            .map(|(code, params)| (code, params[1].1.clone()))
            .collect();
        assert_eq!(
            codes,
            vec![
                (TACTICS_PLAYER_NOT_IN_CLUB.to_string(), "palmer".to_string()),
                (DUPLICATE_STARTER.to_string(), "saka".to_string()),
            ]
        );
    }
}
