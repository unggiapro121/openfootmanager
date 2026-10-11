use crate::game::Game;
use domain::league::StandingEntry;
use std::collections::HashMap;

const POSITION_DELTA_WEIGHT: i32 = 12;
const CHAMPION_BONUS: i32 = 12;
const BOTTOM_FINISH_PENALTY: i32 = 8;
const MIN_REPUTATION: i32 = 0;
const MAX_REPUTATION: i32 = 1000;

/// Expected finishing positions ranked by reputation, considering only the
/// teams that actually contested these standings — so a second-division club is
/// measured against its division, not the whole game world.
fn expected_positions(game: &Game, final_standings: &[StandingEntry]) -> HashMap<String, usize> {
    let participating: std::collections::HashSet<&str> = final_standings
        .iter()
        .map(|standing| standing.team_id.as_str())
        .collect();
    let mut ordered_teams: Vec<_> = game
        .teams
        .iter()
        .filter(|team| participating.contains(team.id.as_str()))
        .collect();
    ordered_teams.sort_by(|left, right| {
        right
            .reputation
            .cmp(&left.reputation)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });

    ordered_teams
        .into_iter()
        .enumerate()
        .map(|(index, team)| (team.id.clone(), index + 1))
        .collect()
}

/// How many of a club's best seniors its squad reputation is read from: a
/// matchday squad, so one star or a long tail of reserves does not decide it.
const SQUAD_SAMPLE: usize = 16;

/// Squad rating → reputation: 60 → 250, 70 → 500, 80 → 850, in straight lines
/// between them and on past either end, clamped to 100–1000.
const SQUAD_REPUTATION_ANCHORS: [(f64, f64); 3] = [(60.0, 250.0), (70.0, 500.0), (80.0, 850.0)];
const SQUAD_REPUTATION_FLOOR: f64 = 100.0;

/// The reputation a squad rated `top_squad_ovr` (the mean overall of its best
/// [`SQUAD_SAMPLE`] seniors) deserves.
pub(crate) fn squad_quality_reputation(top_squad_ovr: f64) -> u32 {
    let [low, mid, high] = SQUAD_REPUTATION_ANCHORS;
    let (from, to) = if top_squad_ovr <= mid.0 {
        (low, mid)
    } else {
        (mid, high)
    };
    let slope = (to.1 - from.1) / (to.0 - from.0);
    let reputation = from.1 + (top_squad_ovr - from.0) * slope;
    reputation
        .clamp(SQUAD_REPUTATION_FLOOR, f64::from(MAX_REPUTATION as u32))
        .round() as u32
}

/// Mean overall of a club's best [`SQUAD_SAMPLE`] seniors, or `None` for a club
/// with no seniors.
fn top_squad_ovr(game: &Game, team_id: &str) -> Option<f64> {
    let mut ratings: Vec<u8> = game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some(team_id) && !player.retired)
        .filter(|player| player.squad_role == domain::player::SquadRole::Senior)
        .map(|player| player.ovr)
        .collect();
    if ratings.is_empty() {
        return None;
    }
    ratings.sort_unstable_by(|left, right| right.cmp(left));
    ratings.truncate(SQUAD_SAMPLE);
    Some(ratings.iter().map(|&ovr| f64::from(ovr)).sum::<f64>() / ratings.len() as f64)
}

/// Bring every club's reputation in line with its squad, once, when the world
/// opens: a club whose authored reputation is far below what its squad is
/// worth — a Portuguese side rated under a weaker Belgian one, an English club
/// at 120 — is lifted halfway to its squad's reputation. A club is never
/// lowered, so a famous name keeps its standing through a weak squad. From
/// here on, results move reputation as before ([`update_team_reputation`]).
pub fn align_reputations_with_squads(game: &mut Game) {
    let squad_reputations: HashMap<String, u32> = game
        .teams
        .iter()
        .filter_map(|team| {
            top_squad_ovr(game, &team.id)
                .map(|ovr| (team.id.clone(), squad_quality_reputation(ovr)))
        })
        .collect();
    for team in &mut game.teams {
        if let Some(&squad_reputation) = squad_reputations.get(&team.id) {
            team.reputation = team
                .reputation
                .max((team.reputation + squad_reputation) / 2);
        }
    }
}

fn next_reputation(
    current_reputation: u32,
    expected_position: usize,
    final_position: usize,
    team_count: usize,
) -> u32 {
    let expected_position = expected_position as i32;
    let final_position = final_position as i32;
    let position_delta = (expected_position - final_position) * POSITION_DELTA_WEIGHT;
    let champion_bonus = if final_position == 1 {
        CHAMPION_BONUS
    } else {
        0
    };
    let bottom_finish_penalty = if final_position == team_count as i32 {
        BOTTOM_FINISH_PENALTY
    } else {
        0
    };

    (current_reputation as i32 + position_delta + champion_bonus - bottom_finish_penalty)
        .clamp(MIN_REPUTATION, MAX_REPUTATION) as u32
}

pub fn update_team_reputation(game: &mut Game, final_standings: &[StandingEntry]) {
    if final_standings.is_empty() {
        return;
    }

    let expected_positions = expected_positions(game, final_standings);
    let team_count = final_standings.len();

    for (index, standing) in final_standings.iter().enumerate() {
        if let Some(team) = game
            .teams
            .iter_mut()
            .find(|team| team.id == standing.team_id)
        {
            let expected_position = expected_positions
                .get(&standing.team_id)
                .copied()
                .unwrap_or(index + 1);
            team.reputation =
                next_reputation(team.reputation, expected_position, index + 1, team_count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{next_reputation, update_team_reputation};
    use crate::clock::GameClock;
    use crate::game::Game;
    use chrono::{TimeZone, Utc};
    use domain::league::StandingEntry;

    fn make_game_with_reputations(reputations: &[(&str, u32)]) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 5, 20, 12, 0, 0).unwrap());
        let manager = domain::manager::Manager::new(
            "mgr".to_string(),
            "Alex".to_string(),
            "Boss".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let teams = reputations
            .iter()
            .map(|(id, reputation)| {
                let mut team = domain::team::Team::new(
                    id.to_string(),
                    id.to_string(),
                    id.to_string(),
                    "Country".to_string(),
                    "City".to_string(),
                    "Stadium".to_string(),
                    10_000,
                );
                team.reputation = *reputation;
                team
            })
            .collect();
        Game::new(clock, manager, teams, vec![], vec![], vec![])
    }

    #[test]
    fn expectation_is_relative_to_the_division_not_the_whole_world() {
        // "minnow" is the weakest club in the world, but within its two-club
        // division it is expected to finish last — so finishing last there is
        // meeting expectations (no positional gain), and the bottom-finish
        // penalty applies.
        let mut game = make_game_with_reputations(&[("giant", 900), ("mid", 500), ("minnow", 100)]);
        let division_standings = vec![
            StandingEntry::new("mid".to_string()),
            StandingEntry::new("minnow".to_string()),
        ];

        update_team_reputation(&mut game, &division_standings);

        let minnow = game.teams.iter().find(|t| t.id == "minnow").unwrap();
        assert!(
            minnow.reputation < 100,
            "meeting a last-place expectation must not be rewarded as an overperformance \
             against the global table (got {})",
            minnow.reputation
        );
        let giant = game.teams.iter().find(|t| t.id == "giant").unwrap();
        assert_eq!(
            giant.reputation, 900,
            "teams outside the division are untouched"
        );
    }

    #[test]
    fn champion_outperforming_expectation_gains_reputation() {
        assert!(next_reputation(320, 8, 1, 10) > 320);
    }

    #[test]
    fn bottom_finish_after_high_expectation_loses_reputation() {
        assert!(next_reputation(860, 1, 10, 10) < 860);
    }

    #[test]
    fn reputation_is_clamped_within_supported_bounds() {
        assert_eq!(next_reputation(995, 10, 1, 10), 1000);
        assert_eq!(next_reputation(5, 1, 10, 10), 0);
    }
}

#[cfg(test)]
mod squad_quality_tests {
    use super::{align_reputations_with_squads, squad_quality_reputation};
    use crate::clock::GameClock;
    use crate::game::Game;
    use crate::test_support::uniform_attributes;
    use chrono::{TimeZone, Utc};
    use domain::player::{Player, Position};
    use domain::team::Team;

    fn club(id: &str, reputation: u32) -> Team {
        let mut team = Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "Country".to_string(),
            "City".to_string(),
            "Stadium".to_string(),
            10_000,
        );
        team.reputation = reputation;
        team
    }

    /// Sixteen seniors at `ovr` for `team_id`.
    fn squad(team_id: &str, ovr: u8) -> Vec<Player> {
        (0..16)
            .map(|index| {
                let mut player = Player::new(
                    format!("{team_id}-{index}"),
                    "P".to_string(),
                    "Player".to_string(),
                    "1998-01-01".to_string(),
                    "GB".to_string(),
                    Position::CentralMidfielder,
                    uniform_attributes(ovr),
                );
                player.team_id = Some(team_id.to_string());
                player.ovr = ovr;
                player
            })
            .collect()
    }

    fn game(teams: Vec<Team>, players: Vec<Player>) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 6, 1, 12, 0, 0).unwrap());
        let manager = domain::manager::Manager::new(
            "mgr".to_string(),
            "Alex".to_string(),
            "Boss".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        Game::new(clock, manager, teams, players, vec![], vec![])
    }

    /// Given squads rated 60, 70 and 80, then their squad reputation is 250, 500
    /// and 850, between the anchors in a straight line, and clamped outside them.
    #[test]
    fn squad_reputation_follows_the_anchors() {
        assert_eq!(squad_quality_reputation(60.0), 250);
        assert_eq!(squad_quality_reputation(70.0), 500);
        assert_eq!(squad_quality_reputation(75.0), 675);
        assert_eq!(squad_quality_reputation(80.0), 850);
        assert_eq!(squad_quality_reputation(40.0), 100);
        assert_eq!(squad_quality_reputation(95.0), 1000);
    }

    /// Given a club whose authored reputation is far below its squad, then it is
    /// lifted halfway to its squad's reputation; given a big club with a squad
    /// that rates it lower, then its reputation is kept, never lowered.
    #[test]
    fn underrated_clubs_are_lifted_and_big_clubs_are_never_lowered() {
        let mut game = game(
            vec![club("underrated", 120), club("giant", 940)],
            [squad("underrated", 70), squad("giant", 72)].concat(),
        );

        align_reputations_with_squads(&mut game);

        let reputation_of = |id: &str| game.teams.iter().find(|t| t.id == id).unwrap().reputation;
        assert_eq!(reputation_of("underrated"), (120 + 500) / 2);
        assert_eq!(reputation_of("giant"), 940);
    }
}
