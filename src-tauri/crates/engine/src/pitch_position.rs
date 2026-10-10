//! Where on the pitch a formation slot is, and how well a player plays there.
//!
//! The engine resolves every duel by the coarse group (`Position`), but a player
//! deployed at left-back is not the player he is at centre-back. `ofm_core`
//! rates each player at every pitch position before kick-off
//! ([`PlayerData::position_ratings`]); the engine reads the rating of the slot
//! he stands in now — slots move with swaps, substitutions and formation
//! changes — and scales his part in each duel by it against his rating at his
//! natural position.

use serde::{Deserialize, Serialize};

use crate::types::{PlayerData, Position};

/// The fourteen positions a formation slot can be. Mirrors the granular half of
/// `domain::player::Position`, kept independent like every engine type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PitchPosition {
    Goalkeeper,
    RightBack,
    CenterBack,
    LeftBack,
    RightWingBack,
    LeftWingBack,
    DefensiveMidfielder,
    CentralMidfielder,
    AttackingMidfielder,
    RightMidfielder,
    LeftMidfielder,
    RightWinger,
    LeftWinger,
    Striker,
}

impl PitchPosition {
    /// The coarse group the engine resolves duels by.
    pub fn group(self) -> Position {
        match self {
            Self::Goalkeeper => Position::Goalkeeper,
            Self::RightBack
            | Self::CenterBack
            | Self::LeftBack
            | Self::RightWingBack
            | Self::LeftWingBack => Position::Defender,
            Self::DefensiveMidfielder
            | Self::CentralMidfielder
            | Self::AttackingMidfielder
            | Self::RightMidfielder
            | Self::LeftMidfielder => Position::Midfielder,
            Self::RightWinger | Self::LeftWinger | Self::Striker => Position::Forward,
        }
    }
}

/// How familiar a position is to a player.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PositionFit {
    /// His natural position.
    Natural,
    /// One of his alternate positions, or another position in his group.
    Adapted,
    /// Another group altogether.
    Unfamiliar,
}

/// A player's rating at one pitch position: his attributes weighted for it,
/// less what playing out of his natural position costs him.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PositionRating {
    pub position: PitchPosition,
    pub ovr: u8,
    pub fit: PositionFit,
}

/// The pitch position of each slot of `formation`, in XI order: the keeper,
/// then the back line, the midfield and the front line. Unknown shapes are
/// read as 4-4-2.
///
/// The same layout as `ofm_core::player_rating::formation_slots` and the
/// front end's `buildPitchRows`; `ofm_core` pins the two Rust copies together
/// in a test, since the engine may not depend on it.
pub fn formation_slots(formation: &str) -> Vec<PitchPosition> {
    let parts: Vec<usize> = formation
        .split('-')
        .filter_map(|part| part.parse().ok())
        .collect();
    let mut slots = vec![PitchPosition::Goalkeeper];
    match parts.as_slice() {
        [defenders, midfielders, forwards] => {
            slots.extend(defender_line(*defenders));
            slots.extend(midfield_line(*midfielders));
            slots.extend(forward_line(*forwards));
        }
        [defenders, deep, attacking, forwards] => {
            slots.extend(defender_line(*defenders));
            slots.extend(deep_midfield_line(*deep));
            slots.extend(attacking_midfield_line(*attacking));
            slots.extend(forward_line(*forwards));
        }
        _ => return formation_slots("4-4-2"),
    }
    slots
}

fn defender_line(count: usize) -> Vec<PitchPosition> {
    use PitchPosition::*;
    match count {
        3 => vec![CenterBack, CenterBack, CenterBack],
        4 => vec![LeftBack, CenterBack, CenterBack, RightBack],
        5 => vec![
            LeftWingBack,
            CenterBack,
            CenterBack,
            CenterBack,
            RightWingBack,
        ],
        _ => vec![CenterBack; count],
    }
}

fn midfield_line(count: usize) -> Vec<PitchPosition> {
    use PitchPosition::*;
    match count {
        2 => vec![CentralMidfielder, CentralMidfielder],
        3 => vec![DefensiveMidfielder, CentralMidfielder, AttackingMidfielder],
        4 => vec![
            LeftMidfielder,
            CentralMidfielder,
            CentralMidfielder,
            RightMidfielder,
        ],
        5 => vec![
            LeftMidfielder,
            DefensiveMidfielder,
            CentralMidfielder,
            AttackingMidfielder,
            RightMidfielder,
        ],
        _ => vec![CentralMidfielder; count],
    }
}

fn deep_midfield_line(count: usize) -> Vec<PitchPosition> {
    use PitchPosition::*;
    match count {
        1 => vec![DefensiveMidfielder],
        2 => vec![DefensiveMidfielder, CentralMidfielder],
        _ => vec![DefensiveMidfielder; count],
    }
}

fn attacking_midfield_line(count: usize) -> Vec<PitchPosition> {
    use PitchPosition::*;
    match count {
        1 => vec![AttackingMidfielder],
        2 => vec![AttackingMidfielder, AttackingMidfielder],
        3 => vec![LeftMidfielder, AttackingMidfielder, RightMidfielder],
        _ => vec![AttackingMidfielder; count],
    }
}

fn forward_line(count: usize) -> Vec<PitchPosition> {
    use PitchPosition::*;
    match count {
        1 => vec![Striker],
        2 => vec![Striker, Striker],
        3 => vec![LeftWinger, Striker, RightWinger],
        _ => vec![Striker; count],
    }
}

impl PlayerData {
    /// His rating at `position`, if `ofm_core` rated him there.
    pub fn rating_at(&self, position: PitchPosition) -> Option<PositionRating> {
        self.position_ratings
            .iter()
            .copied()
            .find(|rating| rating.position == position)
    }

    /// How much of himself he brings to `position`: his rating there over his
    /// rating at his natural position. 1.0 when he has no ratings (a synthetic
    /// player) or no natural position among them.
    pub fn effectiveness_at(&self, position: PitchPosition) -> f64 {
        let natural = self
            .position_ratings
            .iter()
            .find(|rating| rating.fit == PositionFit::Natural);
        match (natural, self.rating_at(position)) {
            (Some(natural), Some(here)) if natural.ovr > 0 => {
                f64::from(here.ovr) / f64::from(natural.ovr)
            }
            _ => 1.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PlayerRole;

    fn player(ratings: Vec<PositionRating>) -> PlayerData {
        PlayerData {
            id: "p".to_string(),
            name: "P".to_string(),
            position: Position::Defender,
            ovr: 80,
            condition: 100,
            fitness: 80,
            pace: 70,
            stamina: 70,
            strength: 70,
            agility: 70,
            passing: 70,
            shooting: 70,
            tackling: 70,
            dribbling: 70,
            defending: 70,
            positioning: 70,
            vision: 70,
            decisions: 70,
            composure: 70,
            aggression: 70,
            teamwork: 70,
            leadership: 70,
            handling: 20,
            reflexes: 20,
            aerial: 70,
            height_cm: 0,
            traits: vec![],
            role: PlayerRole::Standard,
            position_ratings: ratings,
        }
    }

    fn rating(position: PitchPosition, ovr: u8, fit: PositionFit) -> PositionRating {
        PositionRating { position, ovr, fit }
    }

    /// Given each formation the game offers, then its slots run keeper, back
    /// line, midfield, front line, eleven in all.
    #[test]
    fn every_formation_lays_out_eleven_slots_back_to_front() {
        use PitchPosition::*;
        assert_eq!(
            formation_slots("4-2-3-1"),
            vec![
                Goalkeeper,
                LeftBack,
                CenterBack,
                CenterBack,
                RightBack,
                DefensiveMidfielder,
                CentralMidfielder,
                LeftMidfielder,
                AttackingMidfielder,
                RightMidfielder,
                Striker,
            ]
        );
        for formation in [
            "4-4-2", "4-3-3", "4-5-1", "3-5-2", "5-3-2", "4-2-3-1", "3-4-3",
        ] {
            assert_eq!(formation_slots(formation).len(), 11, "{formation}");
        }
        assert_eq!(formation_slots("nonsense"), formation_slots("4-4-2"));
    }

    /// Given a centre-back rated 80 at home and 52 up front, then up front he
    /// brings 52/80 of himself, and at home all of himself.
    #[test]
    fn effectiveness_is_the_slot_rating_over_the_natural_one() {
        let centre_back = player(vec![
            rating(PitchPosition::CenterBack, 80, PositionFit::Natural),
            rating(PitchPosition::Striker, 52, PositionFit::Unfamiliar),
        ]);

        assert_eq!(centre_back.effectiveness_at(PitchPosition::CenterBack), 1.0);
        assert_eq!(centre_back.effectiveness_at(PitchPosition::Striker), 0.65);
    }

    /// Given a player with no ratings, then every slot is all of him: synthetic
    /// players in tests and benchmarks play as they always did.
    #[test]
    fn a_player_without_ratings_is_unaffected_by_his_slot() {
        assert_eq!(player(vec![]).effectiveness_at(PitchPosition::Striker), 1.0);
    }
}
