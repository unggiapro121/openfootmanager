use crate::game::Game;
use domain::player::Player;

/// Returns all players (senior and youth) belonging to the given team.
/// Filtering to senior squad is done client-side.
pub fn query_squad(game: &Game, team_id: &str) -> Vec<Player> {
    game.players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(team_id))
        .cloned()
        .collect()
}

/// Each player of the team rated at every pitch position, by id — the same
/// ratings a match is built with, so the tactics board shows a player out of
/// position at the rating he would play there.
pub fn query_squad_position_ratings(
    game: &Game,
    team_id: &str,
) -> std::collections::HashMap<String, Vec<engine::PositionRating>> {
    game.players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(team_id))
        .map(|p| (p.id.clone(), crate::turn::squad::position_ratings(p)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::test_support::uniform_attributes;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::player::Position;
    use domain::team::Team;

    fn player(id: &str, team_id: &str, position: Position) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "1998-01-01".to_string(),
            "GB".to_string(),
            position,
            uniform_attributes(70),
        );
        player.team_id = Some(team_id.to_string());
        player
    }

    fn game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let team = |id: &str| {
            Team::new(
                id.to_string(),
                id.to_string(),
                id.to_string(),
                "England".to_string(),
                "City".to_string(),
                "Ground".to_string(),
                10_000,
            )
        };
        Game::new(
            clock,
            manager,
            vec![team("home"), team("away")],
            vec![
                player("cb", "home", Position::CenterBack),
                player("st", "home", Position::Striker),
                player("other", "away", Position::Striker),
            ],
            vec![],
            vec![],
        )
    }

    /// Given a team, when its position ratings are asked for, then each of its
    /// players — and no one else — is rated at all fourteen positions, Natural
    /// at his own.
    #[test]
    fn each_player_of_the_team_is_rated_at_every_position() {
        let ratings = query_squad_position_ratings(&game(), "home");

        assert_eq!(ratings.len(), 2);
        assert!(!ratings.contains_key("other"));
        let centre_back = &ratings["cb"];
        assert_eq!(centre_back.len(), 14);
        let natural = centre_back
            .iter()
            .find(|rating| rating.fit == engine::PositionFit::Natural)
            .map(|rating| rating.position);
        assert_eq!(natural, Some(engine::PitchPosition::CenterBack));
    }
}
