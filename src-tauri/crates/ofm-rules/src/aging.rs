//! A season of age (phase 3, E3-5b): what a year does to a player's attributes, and whether a
//! veteran retires. Shared with the online server's season end; `ofm_core::aging` applies it to a
//! save. Ages and contract expiry are worked out by the caller.

use crate::attribute_split::Blend;
use domain::player::{Player, Position};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

const MIN_ATTRIBUTE: u8 = 1;
const MAX_ATTRIBUTE: u8 = 99;

fn seeded_value(player_id: &str, season: u32, salt: &str) -> u32 {
    let mut hasher = DefaultHasher::new();
    player_id.hash(&mut hasher);
    season.hash(&mut hasher);
    salt.hash(&mut hasher);
    (hasher.finish() % u32::MAX as u64) as u32
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

    if player.contract_end().is_none() || contract_expired {
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
