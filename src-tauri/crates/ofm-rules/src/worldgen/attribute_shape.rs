//! The shape of a generated player's attribute profile, learned from real players.
//!
//! A real player's attributes are not independent: a passer's vision, first touch and decisions
//! rise together, a centre-back's tackling follows his defending, a striker has none of either.
//! Each table in [`attribute_shape_tables`] holds, for one position, how every attribute moves
//! with overall (`per_ovr`), with height and weight, and the covariance of what is left over
//! (as its Cholesky factor), all fitted on the real-world package by
//! `fm-document/comon/scripts/attribute-shape-fit.py`.
//!
//! A profile is drawn at [`REFERENCE_OVR`]; [`shift_to_level`] then moves it to the player's own
//! level along the same slopes, and [`fit_to_ovr`] closes the last points by adding to the
//! attributes his position is rated on. Nothing is multiplied, so a high attribute is never
//! stretched towards 99 and a low one towards 1.

use domain::player::{Player, PlayerAttributes, Position};
use rand::Rng;

use super::attribute_shape_tables as tables;
use super::physique::{Physique, standard_normal};
use crate::player_rating::{attribute_weights, natural_ovr, primary_position};

/// The overall a freshly drawn profile is centred on.
pub const REFERENCE_OVR: f64 = 60.0;

/// One position's fitted profile model, in the order of `player_rating::ATTRIBUTE_KEYS`.
pub struct ShapeTable {
    pub intercept: [f64; 26],
    pub per_ovr: [f64; 26],
    pub per_z_height: [f64; 26],
    pub per_z_weight: [f64; 26],
    /// Lower-triangular Cholesky factor of the residual covariance, one row per attribute.
    pub chol: &'static [&'static [f64]],
}

/// The table a position draws from. A detailed position has its own; the group buckets a young
/// player carries until his position settles pool the positions of their group, and the
/// mirrored positions (left/right, wing-backs with full-backs) share one.
pub fn table_for(position: &Position) -> &'static ShapeTable {
    match position {
        Position::Goalkeeper => &tables::GK,
        Position::CenterBack => &tables::CB,
        Position::LeftBack
        | Position::RightBack
        | Position::LeftWingBack
        | Position::RightWingBack => &tables::FB,
        Position::DefensiveMidfielder => &tables::DM,
        Position::CentralMidfielder => &tables::CM,
        Position::AttackingMidfielder => &tables::AM,
        Position::LeftMidfielder | Position::RightMidfielder => &tables::WM,
        Position::LeftWinger | Position::RightWinger => &tables::W,
        Position::Striker => &tables::ST,
        Position::Defender => &tables::DEF,
        Position::Midfielder => &tables::MID,
        Position::Forward => &tables::FWD,
    }
}

fn slot_mut(attributes: &mut PlayerAttributes, index: usize) -> &mut u8 {
    match index {
        0 => &mut attributes.pace,
        1 => &mut attributes.stamina,
        2 => &mut attributes.strength,
        3 => &mut attributes.agility,
        4 => &mut attributes.aerial,
        5 => &mut attributes.passing,
        6 => &mut attributes.long_passing,
        7 => &mut attributes.crossing,
        8 => &mut attributes.curve,
        9 => &mut attributes.free_kick,
        10 => &mut attributes.shooting,
        11 => &mut attributes.long_shots,
        12 => &mut attributes.tackling,
        13 => &mut attributes.dribbling,
        14 => &mut attributes.first_touch,
        15 => &mut attributes.heading,
        16 => &mut attributes.defending,
        17 => &mut attributes.positioning,
        18 => &mut attributes.vision,
        19 => &mut attributes.decisions,
        20 => &mut attributes.composure,
        21 => &mut attributes.aggression,
        22 => &mut attributes.teamwork,
        23 => &mut attributes.leadership,
        24 => &mut attributes.handling,
        _ => &mut attributes.reflexes,
    }
}

fn to_attribute(value: f64) -> u8 {
    value.round().clamp(1.0, 99.0) as u8
}

/// Draw a profile for `position` at [`REFERENCE_OVR`], following `body`.
pub fn draw_attributes(
    position: &Position,
    body: &Physique,
    rng: &mut impl Rng,
) -> PlayerAttributes {
    let table = table_for(position);
    let z: [f64; 26] = std::array::from_fn(|_| standard_normal(rng));
    let mut attributes = PlayerAttributes {
        pace: 0,
        stamina: 0,
        strength: 0,
        agility: 0,
        passing: 0,
        shooting: 0,
        tackling: 0,
        dribbling: 0,
        defending: 0,
        positioning: 0,
        vision: 0,
        decisions: 0,
        composure: 0,
        aggression: 0,
        teamwork: 0,
        leadership: 0,
        handling: 0,
        reflexes: 0,
        aerial: 0,
        long_passing: 0,
        crossing: 0,
        curve: 0,
        free_kick: 0,
        long_shots: 0,
        first_touch: 0,
        heading: 0,
    };
    for (i, row) in table.chol.iter().enumerate() {
        let noise: f64 = row.iter().zip(&z).map(|(l, z)| l * z).sum();
        *slot_mut(&mut attributes, i) = to_attribute(
            table.intercept[i] + table.per_ovr[i] * 0.0 // at REFERENCE_OVR the slope term is 0
                + table.per_z_height[i] * body.z_height
                + table.per_z_weight[i] * body.z_weight
                + noise,
        );
    }
    attributes
}

/// Move a profile drawn at [`REFERENCE_OVR`] to a player of overall `target`, each attribute by
/// its own slope, so a weak point stays one however good the player is.
pub fn shift_to_level(player: &mut Player, target: f64) {
    let table = table_for(&player.natural_position);
    let delta = target - REFERENCE_OVR;
    for i in 0..26 {
        let slot = slot_mut(&mut player.attributes, i);
        *slot = to_attribute(f64::from(*slot) + table.per_ovr[i] * delta);
    }
}

/// Bring a player's overall to `target` by adding the same amount to every attribute his
/// position is rated on, a few passes to absorb rounding and the limits at 1 and 99.
pub fn fit_to_ovr(player: &mut Player, target: f64) {
    for _ in 0..12 {
        let ovr = natural_ovr(player);
        if ovr <= 0.0 || (ovr - target).abs() < 0.5 {
            return;
        }
        let weights = attribute_weights(&primary_position(player));
        let weight_sum: i32 = weights.iter().map(|(_, w)| w).sum();
        let step = (target - ovr) * 100.0 / f64::from(weight_sum.max(1));
        let step = if step.abs() < 1.0 {
            step.signum()
        } else {
            step.round()
        } as i32;
        for (key, _) in weights {
            if let Some(index) = crate::player_rating::ATTRIBUTE_KEYS
                .iter()
                .position(|k| k == key)
            {
                let slot = slot_mut(&mut player.attributes, index);
                *slot = (i32::from(*slot) + step).clamp(1, 99) as u8;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player_rating::ATTRIBUTE_KEYS;
    use crate::worldgen::physique::sample_physique;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    #[test]
    fn every_table_has_a_full_lower_triangle() {
        for position in [
            Position::Goalkeeper,
            Position::CenterBack,
            Position::LeftBack,
            Position::DefensiveMidfielder,
            Position::CentralMidfielder,
            Position::AttackingMidfielder,
            Position::LeftMidfielder,
            Position::LeftWinger,
            Position::Striker,
            Position::Defender,
            Position::Midfielder,
            Position::Forward,
        ] {
            let table = table_for(&position);
            assert_eq!(table.chol.len(), ATTRIBUTE_KEYS.len());
            for (i, row) in table.chol.iter().enumerate() {
                assert_eq!(row.len(), i + 1);
            }
        }
    }

    #[test]
    fn a_drawn_profile_follows_its_position() {
        let mut rng = StdRng::seed_from_u64(1);
        let mut forwards_defending = 0.0;
        for _ in 0..200 {
            let body = sample_physique(&Position::Striker, None, None, &mut rng);
            let attributes = draw_attributes(&Position::Striker, &body, &mut rng);
            forwards_defending += f64::from(attributes.defending);
        }
        assert!(forwards_defending / 200.0 < 40.0);
    }

    /// 400 squads of generated players at a mid-table club's level, as the world generator
    /// makes them, with their final attributes.
    fn generated_players() -> Vec<Player> {
        use crate::worldgen::calibration::{FillerLevel, calibrate_generated_player};
        use crate::worldgen::definitions::embedded_names;
        use crate::worldgen::generation::{SQUAD_SLOTS, generate_random_player_from_def};
        let names = embedded_names();
        let mut rng = StdRng::seed_from_u64(2026);
        let mut players = Vec::new();
        for _ in 0..400 {
            for slot in 0..SQUAD_SLOTS {
                let mut player =
                    generate_random_player_from_def("t", slot, "ENG", 2026, None, &names, &mut rng);
                calibrate_generated_player(
                    &mut player,
                    FillerLevel::for_reputation(600),
                    2026,
                    &mut rng,
                );
                players.push(player);
            }
        }
        players
    }

    fn value(player: &Player, key: &str) -> f64 {
        f64::from(crate::player_rating::attribute_value(
            &player.attributes,
            key,
        ))
    }

    fn pearson(xs: &[f64], ys: &[f64]) -> f64 {
        let n = xs.len() as f64;
        let (mx, my) = (xs.iter().sum::<f64>() / n, ys.iter().sum::<f64>() / n);
        let cov: f64 = xs.iter().zip(ys).map(|(x, y)| (x - mx) * (y - my)).sum();
        let vx: f64 = xs.iter().map(|x| (x - mx).powi(2)).sum();
        let vy: f64 = ys.iter().map(|y| (y - my).powi(2)).sum();
        cov / (vx * vy).sqrt()
    }

    fn of_position(players: &[Player], position: Position) -> Vec<&Player> {
        players
            .iter()
            .filter(|p| p.natural_position == position)
            .collect()
    }

    /// Given generated outfield players of every position,
    /// when a core skill is compared with the player's overall,
    /// then none is far above it, as in real football (real players: 0.0%, the old generator: 26%).
    #[test]
    fn no_generated_player_has_a_core_skill_far_above_his_overall() {
        let core = [
            "passing",
            "vision",
            "decisions",
            "positioning",
            "composure",
            "teamwork",
        ];
        let players = generated_players();
        let outfield: Vec<&Player> = players
            .iter()
            .filter(|p| p.position != Position::Goalkeeper && (45..=75).contains(&p.ovr))
            .collect();
        let freak = outfield
            .iter()
            .filter(|p| core.iter().any(|k| value(p, k) >= f64::from(p.ovr) + 25.0))
            .count();
        assert!(
            (freak as f64) / (outfield.len() as f64) < 0.02,
            "{freak} of {}",
            outfield.len()
        );
    }

    /// Given generated strikers and centre-backs,
    /// when their defending and shooting are read,
    /// then each has the weak side his position has (real strikers' defending 26, old generator 59).
    #[test]
    fn a_striker_does_not_defend_and_a_centre_back_does_not_shoot() {
        let players = generated_players();
        let strikers = of_position(&players, Position::Striker);
        let backs = of_position(&players, Position::CenterBack);
        let mean =
            |ps: &[&Player], k: &str| ps.iter().map(|p| value(p, k)).sum::<f64>() / ps.len() as f64;
        assert!(
            mean(&strikers, "defending") < 38.0,
            "{}",
            mean(&strikers, "defending")
        );
        assert!(
            mean(&backs, "shooting") < 40.0,
            "{}",
            mean(&backs, "shooting")
        );
        assert!(mean(&backs, "defending") > mean(&strikers, "defending") + 20.0);
    }

    /// Given generated centre-backs and central midfielders,
    /// when related skills are compared,
    /// then they rise together as real players' do, and a split skill is no longer a copy of the
    /// one it came from.
    #[test]
    fn related_skills_rise_together_without_being_copies() {
        let players = generated_players();
        let backs = of_position(&players, Position::CenterBack);
        let mids = of_position(&players, Position::CentralMidfielder);
        let col = |ps: &[&Player], k: &str| ps.iter().map(|p| value(p, k)).collect::<Vec<_>>();
        // Real centre-backs: tackling-defending 0.77; central midfielders: passing-vision 0.63.
        assert!(pearson(&col(&backs, "tackling"), &col(&backs, "defending")) > 0.5);
        assert!(pearson(&col(&mids, "passing"), &col(&mids, "vision")) > 0.35);
        assert!(pearson(&col(&mids, "passing"), &col(&mids, "long_passing")) < 0.97);
        assert!(pearson(&col(&mids, "shooting"), &col(&mids, "long_shots")) < 0.97);
    }

    /// Given generated squads,
    /// when their senior defenders are counted,
    /// then centre-backs are about half, as in real squads (54%), not the one in five the old
    /// group-then-guess generator left.
    #[test]
    fn senior_squads_have_centre_backs() {
        let players = generated_players();
        let defenders: Vec<&Player> = players
            .iter()
            .filter(|p| {
                p.position == Position::Defender && p.natural_position != Position::Defender
            })
            .collect();
        let centre_backs = defenders
            .iter()
            .filter(|p| p.natural_position == Position::CenterBack)
            .count() as f64;
        let share = centre_backs / defenders.len() as f64;
        assert!((0.4..0.7).contains(&share), "centre-back share {share}");
    }

    /// Given a generated academy-age player,
    /// when his position is read,
    /// then he has only a group, which his position settles into later.
    #[test]
    fn a_youth_reserved_slot_has_only_a_group() {
        let players = generated_players();
        for p in players
            .iter()
            .filter(|p| p.natural_position.is_legacy_bucket())
        {
            assert!(p.natural_position == p.position);
        }
        assert!(
            players
                .iter()
                .any(|p| p.natural_position.is_legacy_bucket())
        );
    }
}
