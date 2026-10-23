//! A season of age (phase 3, E3-5b): what a year does to a player's attributes, and whether a
//! veteran retires. Shared with the online server's season end; `ofm_core::aging` applies it to a
//! save. Ages and contract expiry are worked out by the caller.

use crate::attribute_split::Blend;
use crate::stable_hash::stable_hash;
use domain::player::{Player, Position};

const MIN_ATTRIBUTE: u8 = 1;
const MAX_ATTRIBUTE: u8 = 99;

/// Keeps the aging rolls apart from every other use of `stable_hash`.
const AGING_SALT: u64 = 0x6167_696e_6700_0001; // "aging"

/// A number fixed by the player, the season and what it is for. `stable_hash`, not std's
/// `DefaultHasher`, which promises nothing across Rust releases: the game and the online server,
/// built apart, must retire the same players (E3-5b, E6).
fn seeded_value(player_id: &str, season: u32, salt: &str) -> u32 {
    let key = format!("{player_id}/{season}/{salt}");
    (stable_hash(key.as_bytes(), AGING_SALT) % u32::MAX as u64) as u32
}

pub fn veteran_pace_loss(player_id: &str, age: i32, season: u32) -> u8 {
    if age < 30 {
        return 0;
    }

    1 + (seeded_value(player_id, season, "pace-loss") % 3) as u8
}

pub fn technical_growth(player_id: &str, age: i32, season: u32) -> u8 {
    if age > 32 {
        return 0;
    }

    (seeded_value(player_id, season, "technical-growth") % 2) as u8
}

fn increase_attribute(value: &mut u8, delta: u8) {
    *value = value.saturating_add(delta).min(MAX_ATTRIBUTE);
}

fn decrease_attribute(value: &mut u8, delta: u8) {
    *value = value.saturating_sub(delta).max(MIN_ATTRIBUTE);
}

/// A season of age on `player`'s attributes: a veteran loses pace, a player up to 32 may grow in
/// the techniques that mature late.
pub fn apply_attribute_curve(player: &mut Player, age: i32, season: u32) {
    let pace_loss = veteran_pace_loss(&player.id, age, season);
    if pace_loss > 0 {
        decrease_attribute(&mut player.attributes.pace, pace_loss);
    }

    let growth = technical_growth(&player.id, age, season);
    if growth > 0 {
        // Passing grows with age as a family (short and long passing, crossing,
        // curve), so the pre-split blend grows exactly as it did; free kicks,
        // the other late-maturing technique, grow with it.
        let is_gk = player.natural_position.to_group_position() == Position::Goalkeeper;
        crate::attribute_split::raise_blend(&mut player.attributes, Blend::Passing, growth, is_gk);
        if player.attributes.free_kick != 0 {
            increase_attribute(&mut player.attributes.free_kick, growth);
        }
        increase_attribute(&mut player.attributes.vision, growth);
        increase_attribute(&mut player.attributes.decisions, growth);
        increase_attribute(&mut player.attributes.composure, growth);
    }
}

/// The chance, in percent, that `player`, aged `age`, retires at this season's end.
/// `contract_expired` is whether his contract has run out by then.
pub fn retirement_chance(player: &Player, age: i32, contract_expired: bool) -> u32 {
    let out_of_contract = player.contract_end().is_none() || contract_expired;
    chance_given_contract(player, age, out_of_contract)
}

/// [`retirement_chance`] in the online world (phase 3, E3-7), where no player has a contract
/// before the economy (S-10): without one every veteran would be the +18% of a player released,
/// and retire sooner than his twin offline only for the missing data. Everything else is the same.
pub fn retirement_chance_online(player: &Player, age: i32) -> u32 {
    chance_given_contract(player, age, false)
}

/// Whether `player` retires at the end of `season` online: [`retirement_chance_online`] against
/// the same roll as [`should_retire`].
pub fn should_retire_online(player: &Player, age: i32, season: u32) -> bool {
    let chance = retirement_chance_online(player, age);
    chance != 0 && seeded_value(&player.id, season, "retirement-roll") % 100 < chance
}

fn chance_given_contract(player: &Player, age: i32, out_of_contract: bool) -> u32 {
    if player.retired || age < 33 {
        return 0;
    }

    let mut chance: u32 = match age {
        33 => 12,
        34 => 24,
        35 => 42,
        36 => 60,
        37 => 78,
        _ => 100,
    };

    if out_of_contract {
        chance += 18;
    }
    if player.team_id.is_none() {
        chance += 10;
    }
    if player.stats.appearances < 10 {
        chance += 8;
    }
    if player.stats.avg_rating <= 6.4 {
        chance += 8;
    }
    if player.stats.avg_rating >= 7.4 {
        chance = chance.saturating_sub(10);
    }
    if player.ovr >= 80 {
        chance = chance.saturating_sub(15);
    }

    chance.min(100)
}

/// Whether `player` retires at the end of `season`: his chance, against a roll derived from him
/// and the season.
pub fn should_retire(player: &Player, age: i32, contract_expired: bool, season: u32) -> bool {
    let chance = retirement_chance(player, age, contract_expired);
    if chance == 0 {
        return false;
    }

    let roll = seeded_value(&player.id, season, "retirement-roll") % 100;
    roll < chance
}

#[cfg(test)]
mod tests {
    use domain::player::{PlayerSeasonStats, Position};

    use super::*;
    use crate::test_support::uniform_attributes;

    fn veteran(contract_end: Option<&str>) -> Player {
        let mut player = Player::new(
            "veteran".to_string(),
            "A. Veteran".to_string(),
            "Veteran".to_string(),
            "1990-01-01".to_string(),
            "England".to_string(),
            Position::Defender,
            uniform_attributes(60),
        );
        player.team_id = Some("club".to_string());
        player.stage_contract_end(contract_end.map(str::to_string));
        player.stats = PlayerSeasonStats {
            appearances: 20,
            avg_rating: 6.8,
            ..PlayerSeasonStats::default()
        };
        player
    }

    /// Given a 34-year-old regular with no contract,
    /// when his chance is asked offline and online,
    /// then offline adds the 18 points of a player without a contract and online does not; with
    /// a running contract the two agree.
    #[test]
    fn online_a_missing_contract_does_not_push_a_veteran_out() {
        let without = veteran(None);
        assert_eq!(retirement_chance(&without, 34, false), 24 + 18);
        assert_eq!(retirement_chance_online(&without, 34), 24);
        let contracted = veteran(Some("2040-06-30"));
        assert_eq!(
            retirement_chance(&contracted, 34, false),
            retirement_chance_online(&contracted, 34)
        );
    }

    /// Given veterans of every age from 30 to 40,
    /// when each one's retirement is decided online,
    /// then it matches the offline decision for a player under contract, roll for roll.
    #[test]
    fn online_retirement_rolls_the_offline_dice() {
        for age in 30..=40 {
            for season in 1..=5 {
                let contracted = veteran(Some("2040-06-30"));
                let mut online = veteran(None);
                online.id = contracted.id.clone();
                assert_eq!(
                    should_retire_online(&online, age, season),
                    should_retire(&contracted, age, false, season),
                    "age {age}, season {season}"
                );
            }
        }
    }
}
