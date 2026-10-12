//! Roster invariants shared across the engine's join-a-team paths.
//!
//! The persistence layer enforces "no two players at one club share a jersey
//! number" via a unique index, but enforcement at save time only catches
//! violations *after* the in-memory state has already produced one. This
//! module is the single choke point that prevents such states from arising.

use crate::game::Game;
use domain::player::Player;
use domain::team::Team;

/// The oldest a player may be and still play in a club's youth academy. A
/// manager cannot put an older player there; an AI club promotes its academy
/// players out of it once they pass it; the generator seeds opening academies
/// from players no older.
pub const YOUTH_ACADEMY_MAX_AGE: i32 = 21;

/// Decide which jersey number `player` should wear at `team`.
///
/// * If the player's current jersey is free at `team`, returns it (no churn).
/// * Otherwise picks the lowest available number in `1..=99` at the destination.
/// * Returns `None` only when all 99 slots at the destination are already
///   taken — unreachable for any realistic squad size, but the caller should
///   still handle it.
///
/// Pure: does not mutate anything. The caller writes the returned value into
/// `player.jersey_number` as part of whichever team-change side-effect it is
/// already performing.
///
/// The player about to be moved is excluded from the destination's occupied
/// set by id, so the function is safe to call even when the player happens
/// to already be at `team` (e.g. an idempotent reassignment).
pub fn resolve_jersey_for(game: &Game, player: &Player, team: &Team) -> Option<u8> {
    let occupied = game
        .players
        .iter()
        .filter(|other| other.id != player.id && other.team_id.as_deref() == Some(team.id.as_str()))
        .filter_map(|other| other.jersey_number);
    jersey_among(occupied, player.jersey_number)
}

/// The shirt number a player takes among `occupied` numbers: his own when it
/// is free, else the lowest free one in `1..=99`, or `None` when all are taken.
/// The rule [`resolve_jersey_for`] applies to a game, for callers — the world
/// generator — that have the squad in hand before there is one.
pub(crate) fn jersey_among(
    occupied: impl IntoIterator<Item = u8>,
    current: Option<u8>,
) -> Option<u8> {
    let occupied: std::collections::HashSet<u8> = occupied.into_iter().collect();
    match current {
        Some(current) if !occupied.contains(&current) => Some(current),
        _ => (1u8..=99).find(|number| !occupied.contains(number)),
    }
}

/// Give a club's opening squad one shirt each, no two alike.
///
/// Players in `first_claim` (a package's authored numbers) keep theirs ahead of
/// everyone else, so a generated backfill player handed the same number by his
/// squad slot is the one who moves. Anyone left without a shirt, or whose shirt
/// was already taken, gets the lowest free number.
pub(crate) fn number_opening_squad(
    players: &mut [Player],
    first_claim: &std::collections::HashSet<String>,
) {
    let mut taken = std::collections::HashSet::new();
    for claims_first in [true, false] {
        for player in players
            .iter_mut()
            .filter(|player| first_claim.contains(&player.id) == claims_first)
        {
            if let Some(number) = player.jersey_number
                && !taken.insert(number)
            {
                player.jersey_number = None;
            }
        }
    }
    for player in players
        .iter_mut()
        .filter(|player| player.jersey_number.is_none())
    {
        player.jersey_number = jersey_among(taken.iter().copied(), None);
        taken.extend(player.jersey_number);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::player::{Player, PlayerAttributes, Position};
    use domain::team::Team;
    use std::collections::HashSet;

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
            handling: 30,
            reflexes: 30,
            aerial: 60,
        }
    }

    fn make_player(id: &str, team_id: Option<&str>, jersey: Option<u8>) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "England".to_string(),
            Position::Forward,
            default_attrs(),
        );
        player.team_id = team_id.map(|t| t.to_string());
        player.jersey_number = jersey;
        player
    }

    fn make_team(id: &str) -> Team {
        Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "England".to_string(),
            "City".to_string(),
            "Ground".to_string(),
            20_000,
        )
    }

    fn make_game(players: Vec<Player>) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "m-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        Game::new(
            clock,
            manager,
            vec![make_team("team-a")],
            players,
            vec![],
            vec![],
        )
    }

    #[test]
    fn keeps_preferred_jersey_when_free_at_destination() {
        let moving = make_player("p-moving", None, Some(6));
        let game = make_game(vec![make_player("p-existing", Some("team-a"), Some(10))]);
        assert_eq!(
            resolve_jersey_for(&game, &moving, &make_team("team-a")),
            Some(6)
        );
    }

    #[test]
    fn reassigns_when_preferred_jersey_is_taken() {
        let moving = make_player("p-moving", None, Some(6));
        let game = make_game(vec![make_player("p-existing", Some("team-a"), Some(6))]);
        assert_eq!(
            resolve_jersey_for(&game, &moving, &make_team("team-a")),
            Some(1)
        );
    }

    #[test]
    fn picks_lowest_free_when_player_has_no_preferred_jersey() {
        let moving = make_player("p-moving", None, None);
        let players = vec![
            make_player("p-1", Some("team-a"), Some(1)),
            make_player("p-2", Some("team-a"), Some(2)),
            make_player("p-3", Some("team-a"), Some(4)),
        ];
        let game = make_game(players);
        assert_eq!(
            resolve_jersey_for(&game, &moving, &make_team("team-a")),
            Some(3)
        );
    }

    #[test]
    fn excludes_moving_player_from_occupancy() {
        // Moving player already at the destination wearing #6 — resolver must
        // not see their own jersey as a conflict.
        let moving = make_player("p-moving", Some("team-a"), Some(6));
        let game = make_game(vec![moving.clone()]);
        assert_eq!(
            resolve_jersey_for(&game, &moving, &make_team("team-a")),
            Some(6)
        );
    }

    #[test]
    fn ignores_players_at_other_teams_and_free_agents() {
        let moving = make_player("p-moving", None, Some(6));
        let players = vec![
            make_player("p-other-team", Some("team-z"), Some(6)),
            make_player("p-free-agent", None, Some(6)),
        ];
        let game = make_game(players);
        assert_eq!(
            resolve_jersey_for(&game, &moving, &make_team("team-a")),
            Some(6)
        );
    }

    #[test]
    fn returns_none_when_destination_is_full() {
        let moving = make_player("p-moving", None, None);
        let mut players = Vec::new();
        for n in 1u8..=99 {
            players.push(make_player(&format!("p-{}", n), Some("team-a"), Some(n)));
        }
        let game = make_game(players);
        assert_eq!(
            resolve_jersey_for(&game, &moving, &make_team("team-a")),
            None
        );
    }

    fn shirts(players: &[Player]) -> Vec<(&str, Option<u8>)> {
        players
            .iter()
            .map(|player| (player.id.as_str(), player.jersey_number))
            .collect()
    }

    /// Given a package club whose authored striker wears 9 and a generated
    /// backfill player also handed 9 by his squad slot,
    /// when the opening squad is numbered,
    /// then the authored player keeps 9 and the backfill player takes a free shirt.
    #[test]
    fn an_authored_number_wins_over_a_generated_one() {
        let mut players = vec![
            make_player("generated", Some("team-a"), Some(9)),
            make_player("authored", Some("team-a"), Some(9)),
        ];
        let first_claim = HashSet::from(["authored".to_string()]);
        number_opening_squad(&mut players, &first_claim);
        assert_eq!(
            shirts(&players),
            vec![("generated", Some(1)), ("authored", Some(9))]
        );
    }

    /// Given an opening squad where some players were given no shirt,
    /// when it is numbered,
    /// then each of them takes the lowest number nobody else wears.
    #[test]
    fn players_without_a_shirt_take_the_lowest_free_numbers() {
        let mut players = vec![
            make_player("keeper", Some("team-a"), Some(1)),
            make_player("no-shirt-1", Some("team-a"), None),
            make_player("striker", Some("team-a"), Some(3)),
            make_player("no-shirt-2", Some("team-a"), None),
        ];
        number_opening_squad(&mut players, &HashSet::new());
        assert_eq!(
            shirts(&players),
            vec![
                ("keeper", Some(1)),
                ("no-shirt-1", Some(2)),
                ("striker", Some(3)),
                ("no-shirt-2", Some(4)),
            ]
        );
    }

    /// Given two authored players claiming the same shirt (a package that skipped validation),
    /// when the opening squad is numbered,
    /// then the first keeps it and the second is moved to a free number, never left sharing.
    #[test]
    fn a_shirt_claimed_twice_is_kept_by_the_first_claimant() {
        let mut players = vec![
            make_player("first", Some("team-a"), Some(1)),
            make_player("second", Some("team-a"), Some(1)),
        ];
        let first_claim = HashSet::from(["first".to_string(), "second".to_string()]);
        number_opening_squad(&mut players, &first_claim);
        assert_eq!(
            shirts(&players),
            vec![("first", Some(1)), ("second", Some(2))]
        );
    }
}
