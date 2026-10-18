//! A club's strength as one number, the bridge between the game's ratings
//! and real results (phase 2, GĐ5 P5.0, decision X81; plan D11).
//!
//! `S = 0.9·XI + 0.1·B3`: XI is the mean slot rating of the best eleven the
//! club can field in its formation, B3 the mean natural OVR of the three best
//! players left on the bench. The probes group results by the gap in `S`
//! and compare them with the betting market's line over the same gap
//! (`fm-document/comon/scripts/gd5-strength-bridge.py`).
//!
//! Condition plays no part: `S` says how good a club is, not how fresh it is
//! on one matchday.

use domain::player::Player;

use crate::game::Game;
use crate::player_rating::{formation_slots, natural_ovr, positional_fit_for_assignment};

/// How much of `S` the starting eleven make up; the bench the rest.
const XI_WEIGHT: f64 = 0.9;
/// How many substitutes count.
const BENCH: usize = 3;

/// A club's strength and its two halves.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct TeamStrength {
    /// The best eleven's mean rating in the slots they would play.
    pub xi: f64,
    /// The three best of the rest, at their natural positions.
    pub bench: f64,
    /// `0.9·xi + 0.1·bench`.
    pub strength: f64,
}

/// The strength of a squad of `players` lining up in `formation`. `None` when
/// they cannot fill it.
pub fn team_strength(formation: &str, players: &[&Player]) -> Option<TeamStrength> {
    let slots = formation_slots(formation);
    if players.len() < slots.len() {
        return None;
    }
    let weights: Vec<Vec<f64>> = slots
        .iter()
        .map(|slot| {
            players
                .iter()
                .map(|player| positional_fit_for_assignment(player, slot))
                .collect()
        })
        .collect();
    let assignment = crate::lineup_assignment::best_assignment(&weights);
    if assignment.len() != slots.len() {
        return None;
    }
    let xi = assignment
        .iter()
        .enumerate()
        .map(|(slot, &player)| weights[slot][player])
        .sum::<f64>()
        / slots.len() as f64;
    let mut rest: Vec<f64> = (0..players.len())
        .filter(|index| !assignment.contains(index))
        .map(|index| natural_ovr(players[index]))
        .collect();
    rest.sort_by(|a, b| b.total_cmp(a));
    let bench = if rest.is_empty() {
        xi
    } else {
        let best = &rest[..rest.len().min(BENCH)];
        best.iter().sum::<f64>() / best.len() as f64
    };
    Some(TeamStrength {
        xi,
        bench,
        strength: XI_WEIGHT * xi + (1.0 - XI_WEIGHT) * bench,
    })
}

/// [`team_strength`] of a club in `game`: its fit, contracted players in its
/// formation.
pub fn club_strength(game: &Game, team_id: &str) -> Option<TeamStrength> {
    let team = game.teams.iter().find(|team| team.id == team_id)?;
    let players: Vec<&Player> = game
        .players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(team_id) && p.injury.is_none())
        .collect();
    team_strength(&team.formation, &players)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::uniform_attributes;
    use domain::player::Position;

    fn player(id: &str, position: Position, value: u8) -> Player {
        Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "1998-01-01".to_string(),
            "GB".to_string(),
            position,
            uniform_attributes(value),
        )
    }

    /// A 4-4-2's eleven natural players at `value`, and `bench` more.
    fn squad(value: u8, bench: &[u8]) -> Vec<Player> {
        use Position::*;
        let mut players: Vec<Player> = [
            Goalkeeper,
            LeftBack,
            CenterBack,
            CenterBack,
            RightBack,
            LeftMidfielder,
            CentralMidfielder,
            CentralMidfielder,
            RightMidfielder,
            Striker,
            Striker,
        ]
        .into_iter()
        .enumerate()
        .map(|(i, position)| player(&format!("p{i}"), position, value))
        .collect();
        for (i, &v) in bench.iter().enumerate() {
            players.push(player(&format!("b{i}"), CentralMidfielder, v));
        }
        players
    }

    /// Given a squad of eleven natural players and four substitutes,
    /// when its strength is read,
    /// then it is nine tenths the eleven and one tenth the three best
    /// substitutes, the fourth left out.
    #[test]
    fn strength_is_nine_tenths_the_eleven_and_a_tenth_the_best_three_on_the_bench() {
        let players = squad(70, &[60, 64, 50, 62]);
        let refs: Vec<&Player> = players.iter().collect();
        let s = team_strength("4-4-2", &refs).expect("a full squad");
        let bench_ovr: Vec<f64> = players[11..].iter().map(natural_ovr).collect();
        let mut best = bench_ovr.clone();
        best.sort_by(|a, b| b.total_cmp(a));
        let bench = (best[0] + best[1] + best[2]) / 3.0;
        assert!((s.bench - bench).abs() < 1e-9, "{s:?}");
        assert!((s.strength - (0.9 * s.xi + 0.1 * s.bench)).abs() < 1e-9);
    }

    /// Given two squads alike but for the eleven's quality,
    /// when their strengths are read,
    /// then the better eleven is the stronger club.
    #[test]
    fn a_better_eleven_is_a_stronger_club() {
        let weak = squad(65, &[60, 60, 60]);
        let strong = squad(75, &[60, 60, 60]);
        let s = |p: &Vec<Player>| {
            team_strength("4-4-2", &p.iter().collect::<Vec<_>>())
                .expect("a full squad")
                .strength
        };
        assert!(s(&strong) > s(&weak) + 5.0);
    }

    /// Given ten players,
    /// when their strength is read,
    /// then there is none: they cannot field a side.
    #[test]
    fn a_squad_short_of_eleven_has_no_strength() {
        let players = squad(70, &[]);
        let refs: Vec<&Player> = players.iter().take(10).collect();
        assert_eq!(team_strength("4-4-2", &refs), None);
    }
}
