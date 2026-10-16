//! Traits a player is given once, as a habit, rather than read off his
//! attributes: today only `ShootsFromDistance`.
//!
//! Two players with the same long-shot ability need not have the same habit, so
//! the trait is drawn, with a chance that rises with long shots against his
//! position's norm, a little with his overall, and for a wonderkid
//! (GĐ1-tech-spec.md §8.2, decision X5):
//!
//! ```text
//! logit p = a[position] + 1.35·(long_shots − μ[position])/10 + 0.27·(OVR − 65)/10 + 0.70·wonderkid
//! p = min(σ(logit), 0.60)
//! ```
//!
//! 1.35 and 0.27 were fitted on EA FC 25 (the share of players carrying the Power
//! Shot or Finesse Shot PlayStyle). `a` and `μ` were then set on the rebuilt
//! real-world package so each position's rate meets its target, from 0.3% of
//! centre-backs to 10.2% of attacking midfielders
//! (`fm-document/comon/scripts/gd1-shoots-from-distance.py`).
//!
//! The draw is the player's id hashed, not the world's RNG: the same player gets
//! the same answer in every save and at every call, and no later random draw in
//! world generation moves because this one was made. It only ever adds the
//! trait, so calling it again after a player's attributes change cannot take a
//! habit away or hand out a second chance.

use domain::player::{Player, PlayerTrait, Position};

const LONG_SHOTS_SLOPE: f64 = 1.35;
const OVR_SLOPE: f64 = 0.27;
const WONDERKID_BONUS: f64 = 0.70;
const MAX_PROBABILITY: f64 = 0.60;
const ASSIGNED_TRAIT_SEED: u64 = 0x5F0F_D157_A11C_E000;

/// (base logit, mean long shots) for the position, or `None` for a keeper,
/// who never has the habit.
fn base_for(position: &Position) -> Option<(f64, f64)> {
    match position {
        Position::Goalkeeper => None,
        Position::CenterBack | Position::Defender => Some((-7.74, 37.9)),
        Position::RightBack
        | Position::LeftBack
        | Position::RightWingBack
        | Position::LeftWingBack => Some((-6.04, 47.9)),
        Position::DefensiveMidfielder => Some((-4.72, 56.7)),
        Position::CentralMidfielder | Position::Midfielder => Some((-3.61, 60.5)),
        Position::AttackingMidfielder => Some((-3.02, 63.0)),
        Position::RightMidfielder | Position::LeftMidfielder => Some((-3.09, 60.4)),
        Position::RightWinger | Position::LeftWinger => Some((-3.29, 61.6)),
        Position::Striker | Position::Forward => Some((-2.85, 63.7)),
    }
}

/// The chance `player` shoots from distance by habit.
pub fn shoots_from_distance_chance(player: &Player, current_year: u32) -> f64 {
    let Some((base, mean_long_shots)) = base_for(&player.natural_position) else {
        return 0.0;
    };
    let age = crate::player_rating::player_age(&player.date_of_birth, current_year);
    let wonderkid =
        crate::player_rating::qualifies_for_wonderkid(age, player.potential, player.ovr);
    let logit = base
        + LONG_SHOTS_SLOPE * (f64::from(player.attributes.long_shots) - mean_long_shots) / 10.0
        + OVR_SLOPE * (f64::from(player.ovr) - 65.0) / 10.0
        + if wonderkid { WONDERKID_BONUS } else { 0.0 };
    (1.0 / (1.0 + (-logit).exp())).min(MAX_PROBABILITY)
}

/// The player's fixed draw in [0, 1).
///
/// FNV-1a mixes its high bits poorly for short, similar ids ("st-1", "st-2"),
/// and the draw reads the high bits, so the hash goes through the splitmix64
/// finaliser first. Without it 20,000 sequential ids landed 9 standard errors
/// off the chance they were given.
fn draw(player: &Player) -> f64 {
    let mut z = crate::stable_hash::stable_hash(player.id.as_bytes(), ASSIGNED_TRAIT_SEED);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// Give `player` the habits his draw earns. Call once his attributes, OVR and
/// potential are set (after `refresh_player_derived`).
pub fn assign_traits(player: &mut Player, current_year: u32) {
    if draw(player) < shoots_from_distance_chance(player, current_year)
        && !player.traits.contains(&PlayerTrait::ShootsFromDistance)
    {
        player.traits.push(PlayerTrait::ShootsFromDistance);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::uniform_attributes;

    fn player(id: &str, position: Position, long_shots: u8, ovr: u8) -> Player {
        let mut attributes = uniform_attributes(60);
        attributes.long_shots = long_shots;
        let mut p = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "1998-01-01".to_string(),
            "ENG".to_string(),
            position.clone(),
            attributes,
        );
        p.natural_position = position;
        p.ovr = ovr;
        p.potential = ovr;
        p
    }

    /// Given a keeper with outstanding long shots,
    /// when habits are assigned,
    /// then he never shoots from distance.
    #[test]
    fn a_keeper_never_shoots_from_distance() {
        let keeper = player("gk", Position::Goalkeeper, 99, 85);
        assert_eq!(shoots_from_distance_chance(&keeper, 2026), 0.0);
    }

    /// Given an attacking midfielder and a centre-back, each with his
    /// position's usual long shots,
    /// when their chances are read,
    /// then the midfielder's is far higher: the base follows the position.
    #[test]
    fn the_chance_follows_the_position() {
        let am =
            shoots_from_distance_chance(&player("am", Position::AttackingMidfielder, 63, 70), 2026);
        let cb = shoots_from_distance_chance(&player("cb", Position::CenterBack, 38, 70), 2026);
        assert!(am > 10.0 * cb, "am {am} cb {cb}");
    }

    /// Given players with ever better long shots,
    /// when their chances are read,
    /// then the chance rises, and never passes 60%.
    #[test]
    fn the_chance_rises_with_long_shots_and_is_capped() {
        let chances: Vec<f64> = [40u8, 60, 80, 99]
            .iter()
            .map(|&ls| shoots_from_distance_chance(&player("st", Position::Striker, ls, 88), 2026))
            .collect();
        assert!(chances.windows(2).all(|w| w[0] <= w[1]), "{chances:?}");
        assert!(chances.iter().all(|&c| c <= MAX_PROBABILITY));
        assert_eq!(chances[3], MAX_PROBABILITY);
    }

    /// Given the same player assigned twice, and a copy of him,
    /// when habits are assigned,
    /// then all three agree: the draw is his id, not the moment.
    #[test]
    fn the_same_player_always_gets_the_same_answer() {
        let mut once = player("p-123", Position::AttackingMidfielder, 85, 80);
        let mut copy = once.clone();
        assign_traits(&mut once, 2026);
        let first = once.traits.clone();
        assign_traits(&mut once, 2026);
        assign_traits(&mut copy, 2026);
        assert_eq!(once.traits, first);
        assert_eq!(copy.traits, first);
    }

    /// Given a large population of strikers at the position's norm,
    /// when habits are assigned,
    /// then the share with the habit is close to the chance each was given.
    #[test]
    fn the_assigned_share_matches_the_chance() {
        let chance = shoots_from_distance_chance(&player("x", Position::Striker, 64, 65), 2026);
        let mut with = 0;
        for i in 0..20_000 {
            let mut p = player(&format!("st-{i}"), Position::Striker, 64, 65);
            assign_traits(&mut p, 2026);
            with += usize::from(p.traits.contains(&PlayerTrait::ShootsFromDistance));
        }
        let share = with as f64 / 20_000.0;
        assert!(
            (share - chance).abs() < 0.01,
            "share {share} chance {chance}"
        );
    }
}
