//! A package club as the world would open it, for the world editor's tactics
//! board: its authored players built the way world generation builds them, each
//! rated at every position, and the club with the shape, phase settings and
//! roles it would choose for itself.
//!
//! The club's own `tactics` are left out on purpose: the board lays them over
//! this, so what the author changes is shown against what the club would do.
//! Only the authored players are here — the generated players a world build
//! adds to fill a thin squad are rolled at random, so they cannot be lined up
//! ahead of time.

use std::collections::HashMap;

use domain::player::Player;
use domain::team::Team;
use rand::SeedableRng;
use rand::rngs::StdRng;
use serde::Serialize;

use super::TeamDef;
use super::package::PlayerDef;
use crate::stable_hash::stable_hash;

#[derive(Debug, Serialize)]
pub struct PackageClubPreview {
    pub team: Team,
    pub players: Vec<Player>,
    /// Each player's rating at every pitch position, by player id.
    pub position_ratings: HashMap<String, Vec<engine::PositionRating>>,
}

/// `team` and its players among `players` (those whose `club` is the team),
/// as a world opening in `opening_year` (default: the game's own) builds them.
pub fn preview_package_club(
    team: &TeamDef,
    players: &[PlayerDef],
    opening_year: Option<u32>,
) -> PackageClubPreview {
    let opening_year = opening_year
        .unwrap_or_else(super::default_opening_year)
        .clamp(super::MIN_OPENING_YEAR, super::MAX_OPENING_YEAR);
    // Seeded by the club so the preview does not change between two looks.
    let mut rng = StdRng::seed_from_u64(stable_hash(team.id.as_bytes(), 0));
    let names = super::definitions::default_names_definition();
    let mut club = super::build_team(team, &mut rng);
    let squad: Vec<Player> = players
        .iter()
        .filter(|player| player.club == team.id)
        .map(|player| {
            super::generation::generate_player_from_def(
                player,
                &club.id,
                opening_year,
                &names,
                &mut rng,
            )
        })
        .collect();
    let available: Vec<&Player> = squad
        .iter()
        .filter(|player| player.injury.is_none())
        .collect();
    club.formation =
        crate::ai_formation::opening_formation(&club.formation, &available, &club.play_style);
    crate::ai_roles::assign_squad_roles(&mut club, squad.iter());
    let position_ratings = squad
        .iter()
        .map(|player| {
            (
                player.id.clone(),
                crate::turn::squad::position_ratings(player),
            )
        })
        .collect();
    PackageClubPreview {
        team: club,
        players: squad,
        position_ratings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_formation::AI_FORMATIONS;

    fn team() -> TeamDef {
        serde_json::from_value(serde_json::json!({
            "id": "arsenal", "name": "Arsenal", "city": "London", "country": "ENG",
            "colors": { "primary": "#ff0000", "secondary": "#ffffff" },
            "playStyle": "Possession",
            "tactics": { "formation": "3-5-2" }
        }))
        .unwrap()
    }

    fn player(id: &str, club: &str, position: &str) -> PlayerDef {
        serde_json::from_value(serde_json::json!({
            "id": id, "firstName": "A", "lastName": id, "club": club,
            "nationality": "ENG", "position": position, "overall": 75,
            "dateOfBirth": "1998-01-01"
        }))
        .unwrap()
    }

    /// Given a club with authored players and one of another club, when it is
    /// previewed, then only its own players are built, each rated at every
    /// position, under the club's id.
    #[test]
    fn a_preview_builds_the_clubs_own_players() {
        let players = [
            player("raya", "arsenal", "Goalkeeper"),
            player("saliba", "arsenal", "CenterBack"),
            player("palmer", "chelsea", "AttackingMidfielder"),
        ];

        let preview = preview_package_club(&team(), &players, Some(2026));

        let ids: Vec<&str> = preview.players.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["raya", "saliba"]);
        assert!(
            preview
                .players
                .iter()
                .all(|p| p.team_id.as_deref() == Some("arsenal"))
        );
        assert!(!preview.position_ratings["saliba"].is_empty());
    }

    /// Given a club whose package names its own shape, when it is previewed,
    /// then the club shows the shape it would pick itself and its play style's
    /// phase settings: the board lays the authored tactics over these.
    #[test]
    fn a_preview_shows_the_clubs_own_choices_not_its_authored_tactics() {
        let preview = preview_package_club(&team(), &[], Some(2026));

        assert!(AI_FORMATIONS.contains(&preview.team.formation.as_str()));
        assert_eq!(
            preview.team.tactics_phase,
            crate::ai_tactics::blueprint_for(&domain::team::PlayStyle::Possession)
        );
    }
}
