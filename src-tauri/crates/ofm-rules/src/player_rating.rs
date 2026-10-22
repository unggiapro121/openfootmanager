use domain::player::{
    Footedness, Player, PlayerAttributes, PlayerTrait, Position, WEAK_FOOT_MAX, WEAK_FOOT_MIN,
};
use rand::{RngExt, SeedableRng};

const WONDERKID_MAX_AGE: u32 = 20;
const WONDERKID_MIN_POTENTIAL: u8 = 90;
const WONDERKID_MIN_GROWTH_ROOM: u8 = 14;
// Wonderkid rebalance for v0.2.1: tightened from age <= 21, potential >= 85,
// and growth room >= 10 to reduce how often the tag appears in playtesting.

pub fn formation_slots(formation: &str) -> Vec<Position> {
    formation_slot_rows(formation)
        .into_iter()
        .flatten()
        .collect()
}

/// The granular field position a player is deployed in for `team`, derived from
/// the team's formation and starting XI order.
///
/// Returns `None` when the player is not in the starting XI (e.g. on the bench);
/// such players have no deployed slot and callers should fall back to the
/// player's natural position. This is the single source of truth for "where the
/// player is currently playing", since `player.position` is no longer mutated to
/// encode the deployed slot.
pub fn deployed_position(team: &domain::team::Team, player_id: &str) -> Option<Position> {
    let slot_index = team.starting_xi_ids.iter().position(|id| id == player_id)?;
    formation_slots(&team.formation).get(slot_index).cloned()
}

/// Refresh a player's derived fields: `ovr`, `potential`, and `traits`.
///
/// - `ovr` is recomputed from the player's natural position using position-weighted attributes.
/// - `potential` is set only if it is currently 0 (unset), using a random bonus based on age.
///   Once set it is preserved so training gains can grow OVR toward the ceiling naturally.
/// - `traits` are recomputed from current attributes, and the `Wonderkid` trait is applied only
///   after the v0.2.1 rebalance for age <= 20, potential >= 90, and growth room >= 14.
///
/// Pass `current_year` for accurate age calculation (use the game clock year).
pub fn refresh_player_derived(player: &mut Player, current_year: u32) {
    // 1. Compute position-weighted OVR
    let ovr_f = natural_ovr(player);
    let ovr = ovr_f.round() as u8;

    // 2. Compute potential if not yet set (initial generation or legacy saves)
    let age = player_age(&player.date_of_birth, current_year);
    let potential = if player.potential == 0 {
        generate_potential_for(&player.id, ovr, age)
    } else {
        // Keep existing potential; clamp so it is always >= ovr
        player.potential.max(ovr)
    };

    // 3. Recompute attribute-based traits, keeping the habits a player was
    //    given once (they are not read off attributes and must not be lost).
    let mut traits = domain::player::compute_traits(&player.attributes, &player.natural_position);
    traits.extend(player.traits.iter().filter(|t| t.is_assigned()).cloned());

    // 4. Award Wonderkid trait: young player whose ceiling far exceeds current ability
    if qualifies_for_wonderkid(age, potential, ovr) && !traits.contains(&PlayerTrait::Wonderkid) {
        traits.push(PlayerTrait::Wonderkid);
    }

    player.ovr = ovr;
    player.potential = potential;
    player.traits = traits;
}

/// Returns `true` when a player qualifies as a wonderkid: they are at or below
/// `WONDERKID_MAX_AGE`, have at least `WONDERKID_MIN_POTENTIAL`, and their
/// remaining growth (`potential - ovr`) meets `WONDERKID_MIN_GROWTH_ROOM`,
/// reducing the number of qualifying players after playtesting.
pub fn qualifies_for_wonderkid(age: u32, potential: u8, ovr: u8) -> bool {
    age <= WONDERKID_MAX_AGE
        && potential >= WONDERKID_MIN_POTENTIAL
        && potential.saturating_sub(ovr) >= WONDERKID_MIN_GROWTH_ROOM
}

/// Keeps the potential stream apart from every other draw keyed on a player's id.
const POTENTIAL_SEED: u64 = 0x504f_5445_4e54_4931;

/// Generate a potential rating for a newly-created player based on current OVR and age.
/// Returns a value in [1, 99] that is always >= `ovr`.
/// The lower bound of 1 (via `ovr.max(1)`) ensures potential is never 0 even when `ovr` is 0.
///
/// Drawn from a stream keyed on `player_id`, so the same player always gets the same ceiling: a
/// world rebuilt from the same data, or the online server generating it, agrees with the game.
pub fn generate_potential_for(player_id: &str, ovr: u8, age: u32) -> u8 {
    let mut rng = rand_chacha::ChaCha12Rng::seed_from_u64(crate::stable_hash::stable_hash(
        player_id.as_bytes(),
        POTENTIAL_SEED,
    ));
    generate_potential_from(ovr, age, &mut rng)
}

/// As [`generate_potential_for`], drawn from `rng` so a seeded generation replays.
pub fn generate_potential_from(ovr: u8, age: u32, rng: &mut impl rand::Rng) -> u8 {
    let bonus: u8 = match age {
        ..=18 => rng.random_range(15u8..=30),
        19..=20 => rng.random_range(8u8..=22),
        21..=22 => rng.random_range(4u8..=14),
        23..=25 => rng.random_range(0u8..=7),
        _ => 0,
    };
    (ovr.saturating_add(bonus)).min(99).max(ovr.max(1))
}

/// The age a player reaches in `current_year`: the year of `date_of_birth` subtracted, as youth
/// categories count it. Deliberately not his age on a day — that is [`crate::age::age_on`]; the
/// derived ratings (potential, wonderkid, traits) are a season's, so they read the season's year.
pub fn player_age(date_of_birth: &str, current_year: u32) -> u32 {
    let birth_year: u32 = date_of_birth
        .split('-')
        .next()
        .and_then(|y| y.parse().ok())
        .unwrap_or(2000);
    current_year.saturating_sub(birth_year)
}

fn formation_slot_rows(formation: &str) -> Vec<Vec<Position>> {
    let parts: Vec<usize> = formation
        .split('-')
        .filter_map(|part| part.parse::<usize>().ok())
        .collect();

    match parts.as_slice() {
        [defenders, midfielders, forwards] => vec![
            vec![Position::Goalkeeper],
            defender_line(*defenders),
            midfield_line(*midfielders),
            forward_line(*forwards),
        ],
        [defenders, deep_midfielders, attacking_midfielders, forwards] => vec![
            vec![Position::Goalkeeper],
            defender_line(*defenders),
            if *defenders == 3 && *deep_midfielders == 4 {
                wing_back_line()
            } else {
                deep_midfield_line(*deep_midfielders)
            },
            // 4-1-4-1: a flat four with a wide man on each flank in front of
            // the holding midfielder, not four attacking midfielders (phase 2,
            // GĐ3, X51).
            if *deep_midfielders == 1 && *attacking_midfielders == 4 {
                midfield_line(4)
            } else {
                attacking_midfield_line(*attacking_midfielders)
            },
            forward_line(*forwards),
        ],
        _ => formation_slot_rows("4-4-2"),
    }
}

pub fn natural_ovr(player: &Player) -> f64 {
    let natural_position = primary_position(player);
    ovr_for_position(player, &natural_position)
}

pub fn ovr_for_position(player: &Player, position: &Position) -> f64 {
    ovr_from_attributes(&player.attributes, position)
}

/// Position-weighted rating for a bare attribute block.
///
/// The same maths as [`ovr_for_position`], reachable before a [`Player`] has
/// been assembled — world generation needs it to size market value and wage,
/// which previously used a flat average of eleven outfield attributes. That
/// average excluded `handling`, `reflexes` and `aerial` entirely, so keepers
/// were priced as if their actual craft did not exist.
///
/// `position` may be a legacy bucket (`Defender`/`Midfielder`/`Forward`); it is
/// canonicalised before scoring.
pub fn ovr_from_attributes(attributes: &PlayerAttributes, position: &Position) -> f64 {
    let canonical = canonical_position(position);
    let base = weighted_score(attributes, &canonical);
    let penalty = critical_penalty(attributes, &canonical);
    (base - penalty).clamp(1.0, 99.0)
}

/// Condition-free positional fit for a formation slot: ovr-for-position minus
/// compatibility and footedness penalties, floored at 1.0. This is the
/// `effective_rating_for_assignment` value BEFORE the condition multiplier —
/// used by AI load-management so a tired starter and a fresh alternative are
/// compared on quality alone (condition is weighed separately by the caller).
pub fn positional_fit_for_assignment(player: &Player, slot_position: &Position) -> f64 {
    let canonical_slot = canonical_position(slot_position);
    let base = ovr_for_position(player, &canonical_slot);
    let compatibility_penalty = compatibility_penalty(player, &canonical_slot);
    let foot_penalty = footedness_penalty(player, &canonical_slot);
    (base - compatibility_penalty - foot_penalty).max(1.0)
}

pub fn effective_rating_for_assignment(player: &Player, slot_position: &Position) -> f64 {
    positional_fit_for_assignment(player, slot_position) * (player.condition as f64 / 100.0)
}

fn defender_line(count: usize) -> Vec<Position> {
    match count {
        3 => vec![
            Position::CenterBack,
            Position::CenterBack,
            Position::CenterBack,
        ],
        4 => vec![
            Position::LeftBack,
            Position::CenterBack,
            Position::CenterBack,
            Position::RightBack,
        ],
        5 => vec![
            Position::LeftWingBack,
            Position::CenterBack,
            Position::CenterBack,
            Position::CenterBack,
            Position::RightWingBack,
        ],
        _ => vec![Position::CenterBack; count],
    }
}

fn midfield_line(count: usize) -> Vec<Position> {
    match count {
        2 => vec![Position::CentralMidfielder, Position::CentralMidfielder],
        3 => vec![
            Position::DefensiveMidfielder,
            Position::CentralMidfielder,
            Position::AttackingMidfielder,
        ],
        4 => vec![
            Position::LeftMidfielder,
            Position::CentralMidfielder,
            Position::CentralMidfielder,
            Position::RightMidfielder,
        ],
        5 => vec![
            Position::LeftMidfielder,
            Position::DefensiveMidfielder,
            Position::CentralMidfielder,
            Position::AttackingMidfielder,
            Position::RightMidfielder,
        ],
        _ => vec![Position::CentralMidfielder; count],
    }
}

/// The second row of 3-4-2-1: with three centre-backs the flanks are the
/// wing-backs', either side of two central midfielders (phase 2, P2.7, X43).
/// The engine (`pitch_position.rs`) and the squad screen (`buildPitchRows`)
/// keep copies.
fn wing_back_line() -> Vec<Position> {
    vec![
        Position::LeftWingBack,
        Position::CentralMidfielder,
        Position::CentralMidfielder,
        Position::RightWingBack,
    ]
}

fn deep_midfield_line(count: usize) -> Vec<Position> {
    match count {
        1 => vec![Position::DefensiveMidfielder],
        2 => vec![Position::DefensiveMidfielder, Position::CentralMidfielder],
        _ => vec![Position::DefensiveMidfielder; count],
    }
}

fn attacking_midfield_line(count: usize) -> Vec<Position> {
    match count {
        1 => vec![Position::AttackingMidfielder],
        2 => vec![Position::AttackingMidfielder, Position::AttackingMidfielder],
        3 => vec![
            Position::LeftMidfielder,
            Position::AttackingMidfielder,
            Position::RightMidfielder,
        ],
        _ => vec![Position::AttackingMidfielder; count],
    }
}

fn forward_line(count: usize) -> Vec<Position> {
    match count {
        1 => vec![Position::Striker],
        2 => vec![Position::Striker, Position::Striker],
        3 => vec![
            Position::LeftWinger,
            Position::Striker,
            Position::RightWinger,
        ],
        _ => vec![Position::Striker; count],
    }
}

pub fn primary_position(player: &Player) -> Position {
    let preferred = if player.natural_position.is_legacy_bucket() {
        player.position.clone()
    } else {
        player.natural_position.clone()
    };

    canonical_position(&preferred)
}

fn canonical_position(position: &Position) -> Position {
    match position {
        Position::Goalkeeper => Position::Goalkeeper,
        Position::Defender => Position::CenterBack,
        Position::Midfielder => Position::CentralMidfielder,
        Position::Forward => Position::Striker,
        granular => granular.clone(),
    }
}

/// How familiar a slot's position is to a player, from most to least.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotFamiliarity {
    /// His natural position.
    Natural,
    /// A full-back or wide midfielder at the wing-back slot on his own flank:
    /// the position wing-backs are made from, so it costs nothing on top of
    /// what the wing-back weights already ask of him (phase 2, P2.7, X45).
    /// Not `Natural`: each player keeps exactly one natural slot, which the
    /// engine measures every other slot against.
    WingBackConversion,
    /// One of his alternate positions.
    Alternate,
    /// Another position in his natural group.
    SameGroup,
    /// Another group altogether.
    OtherGroup,
}

/// How familiar `slot_position` is to `player`.
pub fn slot_familiarity(player: &Player, slot_position: &Position) -> SlotFamiliarity {
    let slot = canonical_position(slot_position);
    let primary = primary_position(player);
    if primary == slot {
        return SlotFamiliarity::Natural;
    }
    if is_wing_back_conversion(&primary, &slot) {
        return SlotFamiliarity::WingBackConversion;
    }
    if player
        .alternate_positions
        .iter()
        .any(|position| canonical_position(position) == slot)
    {
        SlotFamiliarity::Alternate
    } else if primary.to_group_position() == slot.to_group_position() {
        SlotFamiliarity::SameGroup
    } else {
        SlotFamiliarity::OtherGroup
    }
}

/// Whether a player whose natural position is `primary` becomes a wing-back at
/// `slot` without penalty: a full-back or wide midfielder on his own flank.
/// Wingers and the other flank keep the old rules (Q2, Q6).
fn is_wing_back_conversion(primary: &Position, slot: &Position) -> bool {
    matches!(
        (primary, slot),
        (
            Position::LeftBack | Position::LeftMidfielder,
            Position::LeftWingBack
        ) | (
            Position::RightBack | Position::RightMidfielder,
            Position::RightWingBack
        )
    )
}

fn compatibility_penalty(player: &Player, slot_position: &Position) -> f64 {
    match slot_familiarity(player, slot_position) {
        SlotFamiliarity::Natural | SlotFamiliarity::WingBackConversion => 0.0,
        SlotFamiliarity::Alternate => 4.0,
        SlotFamiliarity::SameGroup => 8.0,
        SlotFamiliarity::OtherGroup => 14.0,
    }
}

fn footedness_penalty(player: &Player, slot_position: &Position) -> f64 {
    let Some(required_side) = slot_side(slot_position) else {
        return 0.0;
    };

    match (player.footedness, required_side) {
        (Footedness::Both, _) => 0.0,
        (Footedness::Left, Side::Left) | (Footedness::Right, Side::Right) => 0.0,
        _ => (10_i32 - (player.weak_foot.clamp(WEAK_FOOT_MIN, WEAK_FOOT_MAX) as i32 * 2)).max(0)
            as f64,
    }
}

/// Each attribute's weight in `position`'s overall, by its `PlayerAttributes`
/// field name. The one table behind every position-weighted rating, and the
/// order a following scout reads a youngster's attributes in.
pub fn attribute_weights(position: &Position) -> &'static [(&'static str, i32)] {
    // Phase 2 table B (GĐ1-tech-spec.md §5): the pre-split table with each
    // blend's weight shared among the attributes split out of it, inside the
    // same training focus, so every position develops at the speed it did.
    match canonical_position(position) {
        Position::Goalkeeper => &[
            ("handling", 28),
            ("reflexes", 28),
            ("aerial", 8),
            ("long_passing", 6),
            ("positioning", 10),
            ("decisions", 10),
            ("composure", 5),
            ("strength", 5),
        ],
        Position::RightBack | Position::LeftBack => &[
            ("pace", 18),
            ("stamina", 16),
            ("tackling", 17),
            ("defending", 16),
            ("positioning", 12),
            ("passing", 4),
            ("crossing", 6),
            ("dribbling", 6),
            ("decisions", 5),
        ],
        Position::CenterBack => &[
            ("defending", 24),
            ("tackling", 18),
            ("positioning", 18),
            ("strength", 14),
            ("aerial", 6),
            ("heading", 6),
            ("decisions", 8),
            ("composure", 4),
            ("long_passing", 2),
        ],
        Position::RightWingBack | Position::LeftWingBack => &[
            ("pace", 18),
            ("stamina", 18),
            ("tackling", 14),
            ("passing", 5),
            ("crossing", 6),
            ("curve", 2),
            ("defending", 12),
            ("dribbling", 11),
            ("vision", 7),
            ("decisions", 7),
        ],
        Position::DefensiveMidfielder => &[
            ("tackling", 18),
            ("positioning", 18),
            ("decisions", 16),
            ("passing", 8),
            ("long_passing", 6),
            ("defending", 12),
            ("stamina", 10),
            ("vision", 7),
            ("strength", 5),
        ],
        Position::CentralMidfielder => &[
            ("passing", 11),
            ("long_passing", 7),
            ("free_kick", 2),
            ("vision", 16),
            ("decisions", 16),
            ("stamina", 12),
            ("dribbling", 6),
            ("first_touch", 4),
            ("positioning", 9),
            ("teamwork", 9),
            ("tackling", 8),
        ],
        Position::AttackingMidfielder => &[
            ("vision", 20),
            ("passing", 13),
            ("curve", 3),
            ("free_kick", 2),
            ("dribbling", 10),
            ("first_touch", 6),
            ("decisions", 14),
            ("shooting", 7),
            ("long_shots", 3),
            ("positioning", 8),
            ("composure", 8),
            ("pace", 6),
        ],
        Position::RightMidfielder | Position::LeftMidfielder => &[
            ("pace", 17),
            ("stamina", 16),
            ("passing", 6),
            ("crossing", 7),
            ("curve", 2),
            ("dribbling", 9),
            ("first_touch", 5),
            ("vision", 10),
            ("decisions", 10),
            ("positioning", 10),
            ("tackling", 8),
        ],
        Position::RightWinger | Position::LeftWinger => &[
            ("pace", 22),
            ("dribbling", 15),
            ("first_touch", 7),
            ("passing", 6),
            ("crossing", 5),
            ("curve", 3),
            ("shooting", 8),
            ("long_shots", 4),
            ("vision", 10),
            ("decisions", 8),
            ("positioning", 6),
            ("stamina", 6),
        ],
        Position::Striker => &[
            ("shooting", 24),
            ("long_shots", 2),
            ("positioning", 18),
            ("decisions", 14),
            ("pace", 12),
            ("dribbling", 6),
            ("first_touch", 4),
            ("strength", 8),
            ("composure", 8),
            ("aerial", 2),
            ("heading", 2),
        ],
        Position::Defender | Position::Midfielder | Position::Forward => unreachable!(),
    }
}

/// The value of the attribute called `key` (a `PlayerAttributes` field name).
pub fn attribute_value(attrs: &PlayerAttributes, key: &str) -> u8 {
    match key {
        "pace" => attrs.pace,
        "stamina" => attrs.stamina,
        "strength" => attrs.strength,
        "agility" => attrs.agility,
        "passing" => attrs.passing,
        "shooting" => attrs.shooting,
        "tackling" => attrs.tackling,
        "dribbling" => attrs.dribbling,
        "defending" => attrs.defending,
        "positioning" => attrs.positioning,
        "vision" => attrs.vision,
        "decisions" => attrs.decisions,
        "composure" => attrs.composure,
        "aggression" => attrs.aggression,
        "teamwork" => attrs.teamwork,
        "leadership" => attrs.leadership,
        "handling" => attrs.handling,
        "reflexes" => attrs.reflexes,
        "aerial" => attrs.aerial,
        "long_passing" => attrs.long_passing,
        "crossing" => attrs.crossing,
        "curve" => attrs.curve,
        "free_kick" => attrs.free_kick,
        "long_shots" => attrs.long_shots,
        "first_touch" => attrs.first_touch,
        "heading" => attrs.heading,
        _ => 0,
    }
}

/// Every attribute a player has, by field name, in the profile's order.
pub const ATTRIBUTE_KEYS: [&str; 26] = [
    "pace",
    "stamina",
    "strength",
    "agility",
    "aerial",
    "passing",
    "long_passing",
    "crossing",
    "curve",
    "free_kick",
    "shooting",
    "long_shots",
    "tackling",
    "dribbling",
    "first_touch",
    "heading",
    "defending",
    "positioning",
    "vision",
    "decisions",
    "composure",
    "aggression",
    "teamwork",
    "leadership",
    "handling",
    "reflexes",
];

fn weighted_score(attrs: &PlayerAttributes, position: &Position) -> f64 {
    let values: Vec<(u8, i32)> = attribute_weights(position)
        .iter()
        .map(|(key, weight)| (attribute_value(attrs, key), *weight))
        .collect();
    weighted_average(&values)
}

fn critical_penalty(attrs: &PlayerAttributes, position: &Position) -> f64 {
    let (passing, dribbling, shooting) = (attrs.passing, attrs.dribbling, attrs.shooting);
    let critical_min = match position {
        Position::Goalkeeper => attrs.handling.min(attrs.reflexes).min(attrs.positioning),
        Position::RightBack | Position::LeftBack => {
            attrs.tackling.min(attrs.defending).min(attrs.positioning)
        }
        Position::CenterBack => attrs.defending.min(attrs.tackling).min(attrs.positioning),
        Position::RightWingBack | Position::LeftWingBack => {
            attrs.pace.min(attrs.stamina).min(attrs.tackling)
        }
        Position::DefensiveMidfielder => attrs.tackling.min(attrs.positioning).min(passing),
        Position::CentralMidfielder => passing.min(attrs.vision).min(attrs.decisions),
        Position::AttackingMidfielder => attrs.vision.min(passing).min(dribbling),
        Position::RightMidfielder | Position::LeftMidfielder => {
            attrs.pace.min(passing).min(attrs.stamina)
        }
        Position::RightWinger | Position::LeftWinger => attrs.pace.min(dribbling).min(passing),
        Position::Striker => shooting.min(attrs.positioning).min(attrs.decisions),
        Position::Defender | Position::Midfielder | Position::Forward => 50,
    };

    if critical_min >= 45 {
        0.0
    } else {
        (45 - critical_min) as f64 * 0.6
    }
}

fn weighted_average(values: &[(u8, i32)]) -> f64 {
    values
        .iter()
        .map(|(value, weight)| *value as f64 * *weight as f64)
        .sum::<f64>()
        / 100.0
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

/// The foot a slot asks for. Full-backs and wing-backs overlap and cross from
/// the touchline, so the foot on that side matters. Wide midfielders and wingers
/// are left out: one on his weaker side cuts inside to shoot or combine, a way of
/// playing the position rather than a flaw in it.
fn slot_side(position: &Position) -> Option<Side> {
    match position {
        Position::LeftBack | Position::LeftWingBack => Some(Side::Left),
        Position::RightBack | Position::RightWingBack => Some(Side::Right),
        _ => None,
    }
}

/// How many players start a match: the likely XI a club's strength is read from.
const LIKELY_XI: usize = 11;

/// The average OVR of the eleven best of `ovrs` — the side a club would most
/// likely start — or `None` for a club with nobody. Reserves who would not
/// start say nothing about how strong the club is on a matchday.
pub fn likely_xi_average_ovr(ovrs: impl IntoIterator<Item = u8>) -> Option<f64> {
    let mut ovrs: Vec<u8> = ovrs.into_iter().collect();
    if ovrs.is_empty() {
        return None;
    }
    ovrs.sort_unstable_by(|a, b| b.cmp(a));
    let starters = ovrs.len().min(LIKELY_XI);
    let total: u32 = ovrs.iter().take(starters).map(|&ovr| u32::from(ovr)).sum();
    Some(f64::from(total) / starters as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANONICAL: [Position; 10] = [
        Position::Goalkeeper,
        Position::RightBack,
        Position::CenterBack,
        Position::RightWingBack,
        Position::DefensiveMidfielder,
        Position::CentralMidfielder,
        Position::AttackingMidfielder,
        Position::RightMidfielder,
        Position::RightWinger,
        Position::Striker,
    ];

    /// The OVR table before the 26-attribute split, kept to pin rule R1: a
    /// position's OVR must grow at the speed it did under each training focus.
    fn pre_split_weights(position: &Position) -> &'static [(&'static str, i32)] {
        match position {
            Position::Goalkeeper => &[
                ("handling", 28),
                ("reflexes", 28),
                ("aerial", 14),
                ("positioning", 10),
                ("decisions", 10),
                ("composure", 5),
                ("strength", 5),
            ],
            Position::RightBack => &[
                ("pace", 18),
                ("stamina", 16),
                ("tackling", 17),
                ("defending", 16),
                ("positioning", 12),
                ("passing", 10),
                ("dribbling", 6),
                ("decisions", 5),
            ],
            Position::CenterBack => &[
                ("defending", 24),
                ("tackling", 18),
                ("positioning", 18),
                ("strength", 14),
                ("aerial", 12),
                ("decisions", 8),
                ("composure", 6),
            ],
            Position::RightWingBack => &[
                ("pace", 18),
                ("stamina", 18),
                ("tackling", 14),
                ("passing", 13),
                ("defending", 12),
                ("dribbling", 11),
                ("vision", 7),
                ("decisions", 7),
            ],
            Position::DefensiveMidfielder => &[
                ("tackling", 18),
                ("positioning", 18),
                ("decisions", 16),
                ("passing", 14),
                ("defending", 12),
                ("stamina", 10),
                ("vision", 7),
                ("strength", 5),
            ],
            Position::CentralMidfielder => &[
                ("passing", 20),
                ("vision", 16),
                ("decisions", 16),
                ("stamina", 12),
                ("dribbling", 10),
                ("positioning", 9),
                ("teamwork", 9),
                ("tackling", 8),
            ],
            Position::AttackingMidfielder => &[
                ("vision", 20),
                ("passing", 18),
                ("dribbling", 16),
                ("decisions", 14),
                ("shooting", 10),
                ("positioning", 8),
                ("composure", 8),
                ("pace", 6),
            ],
            Position::RightMidfielder => &[
                ("pace", 17),
                ("stamina", 16),
                ("passing", 15),
                ("dribbling", 14),
                ("vision", 10),
                ("decisions", 10),
                ("positioning", 10),
                ("tackling", 8),
            ],
            Position::RightWinger => &[
                ("pace", 22),
                ("dribbling", 22),
                ("passing", 14),
                ("shooting", 12),
                ("vision", 10),
                ("decisions", 8),
                ("positioning", 6),
                ("stamina", 6),
            ],
            _ => &[
                ("shooting", 26),
                ("positioning", 18),
                ("decisions", 14),
                ("pace", 12),
                ("dribbling", 10),
                ("strength", 8),
                ("composure", 8),
                ("aerial", 4),
            ],
        }
    }

    /// What each training focus trains, and at what share of the gain, as
    /// `training::apply_focus_gains` does it.
    const FOCUS_GROUPS: [(&str, &[(&str, f64)]); 5] = [
        (
            "Physical",
            &[
                ("pace", 1.0),
                ("stamina", 1.0),
                ("strength", 1.0),
                ("agility", 1.0),
            ],
        ),
        (
            "Technical",
            &[
                ("passing", 1.0),
                ("long_passing", 1.0),
                ("crossing", 1.0),
                ("curve", 1.0),
                ("free_kick", 1.0),
                ("shooting", 1.0),
                ("long_shots", 1.0),
                ("dribbling", 1.0),
                ("first_touch", 1.0),
            ],
        ),
        (
            "Tactical",
            &[
                ("positioning", 1.0),
                ("vision", 1.0),
                ("decisions", 1.0),
                ("composure", 1.0),
            ],
        ),
        (
            "Defending",
            &[
                ("tackling", 1.0),
                ("defending", 1.0),
                ("strength", 0.5),
                ("positioning", 0.5),
                ("heading", 0.5),
            ],
        ),
        (
            "Attacking",
            &[
                ("shooting", 1.0),
                ("long_shots", 1.0),
                ("dribbling", 1.0),
                ("first_touch", 1.0),
                ("pace", 0.5),
                ("heading", 0.5),
            ],
        ),
    ];

    fn coverage(weights: &[(&str, i32)], group: &[(&str, f64)]) -> f64 {
        weights
            .iter()
            .map(|(key, weight)| {
                group
                    .iter()
                    .find(|(trained, _)| trained == key)
                    .map_or(0.0, |(_, share)| share * f64::from(*weight))
            })
            .sum()
    }

    /// Given the OVR table of every position,
    /// when its weights are added up,
    /// then each comes to exactly 100 and names only real attributes.
    #[test]
    fn every_ovr_table_sums_to_100_over_real_attributes() {
        for position in &CANONICAL {
            let weights = attribute_weights(position);
            assert_eq!(
                weights.iter().map(|(_, w)| w).sum::<i32>(),
                100,
                "{position:?}"
            );
            for (key, _) in weights {
                assert!(ATTRIBUTE_KEYS.contains(key), "{position:?}: {key}");
            }
        }
    }

    /// Given every position and training focus,
    /// when the share of its OVR the focus trains is compared with the
    /// pre-split table,
    /// then it is within 10%: the split did not speed up or slow down any
    /// position's development (rule R1 of the phase-2 design).
    #[test]
    fn each_focus_trains_the_same_share_of_ovr_as_before_the_split() {
        for position in &CANONICAL {
            for (focus, group) in FOCUS_GROUPS {
                let before = coverage(pre_split_weights(position), group);
                let after = coverage(attribute_weights(position), group);
                if before == 0.0 {
                    assert!(after <= 6.0, "{position:?} {focus}: {after} from nothing");
                } else {
                    let change = (after / before - 1.0).abs();
                    assert!(change <= 0.10, "{position:?} {focus}: {before} -> {after}");
                }
            }
        }
    }

    /// Given the keeper's table,
    /// when it is read,
    /// then his kicking counts (long passing 6) and free kicks do not (X3).
    #[test]
    fn a_keepers_ovr_counts_his_kicking_not_free_kicks() {
        let weights = attribute_weights(&Position::Goalkeeper);
        assert!(weights.contains(&("long_passing", 6)));
        assert!(!weights.iter().any(|(key, _)| *key == "free_kick"));
    }

    /// Given more than eleven players, then only the eleven best count.
    #[test]
    fn the_likely_xi_average_reads_only_the_eleven_best() {
        let mut ovrs = vec![80_u8; 11];
        ovrs.extend([40, 45, 50]);

        assert_eq!(likely_xi_average_ovr(ovrs), Some(80.0));
    }

    /// Given fewer than eleven players, then all of them count.
    #[test]
    fn a_short_squad_averages_everyone_it_has() {
        assert_eq!(likely_xi_average_ovr([70, 80]), Some(75.0));
    }

    /// Given nobody, then there is no average.
    #[test]
    fn nobody_has_no_likely_xi_average() {
        assert_eq!(likely_xi_average_ovr([]), None);
    }

    /// A specialist keeper: elite at keeping, poor at everything an outfielder
    /// does. The flat attribute average buries him; the weighted OVR does not.
    fn make_specialist_keeper() -> Player {
        let mut player = make_player(Position::Goalkeeper);
        player.natural_position = Position::Goalkeeper;
        let a = &mut player.attributes;
        a.handling = 87;
        a.reflexes = 90;
        a.aerial = 83;
        a.positioning = 88;
        a.decisions = 84;
        a.composure = 88;
        a.strength = 74;
        // Irrelevant to keeping, and low — exactly what a flat average punishes.
        a.shooting = 20;
        a.tackling = 30;
        a.dribbling = 30;
        a.defending = 55;
        a.pace = 58;
        a.passing = 58;
        a.stamina = 70;
        a.vision = 68;
        player
    }

    #[test]
    fn ovr_from_attributes_matches_the_player_level_rating() {
        let keeper = make_specialist_keeper();

        let direct = ovr_from_attributes(&keeper.attributes, &Position::Goalkeeper);

        assert_eq!(
            direct.round() as u8,
            natural_ovr(&keeper).round() as u8,
            "the attribute-level entry point must agree with the player-level one",
        );
    }

    #[test]
    fn ovr_from_attributes_resolves_legacy_position_buckets() {
        let keeper = make_specialist_keeper();

        // `Defender`/`Midfielder`/`Forward` are legacy buckets that
        // `weighted_score` cannot score directly; they must be canonicalised.
        for bucket in [Position::Defender, Position::Midfielder, Position::Forward] {
            let score = ovr_from_attributes(&keeper.attributes, &bucket);
            assert!(
                (1.0..=99.0).contains(&score),
                "{bucket:?} must resolve to a canonical position, got {score}",
            );
        }
    }

    #[test]
    fn keeper_rating_ignores_outfield_attributes() {
        // The bug this guards: market value and wage were sized from a flat
        // average of eleven outfield attributes that excluded handling,
        // reflexes and aerial entirely, so an elite keeper priced like a
        // journeyman. The rating must not collapse when outfield attributes do.
        let keeper = make_specialist_keeper();

        let rating = ovr_from_attributes(&keeper.attributes, &Position::Goalkeeper);

        assert!(
            rating >= 80.0,
            "an elite keeper must rate as elite, got {rating}",
        );
    }

    fn make_player(position: Position) -> Player {
        Player::new(
            "p-1".to_string(),
            "Test".to_string(),
            "Test Player".to_string(),
            "2000-01-01".to_string(),
            "GB".to_string(),
            position,
            PlayerAttributes {
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
                long_passing: 0,
                crossing: 0,
                curve: 0,
                free_kick: 0,
                long_shots: 0,
                first_touch: 0,
                heading: 0,
            },
        )
    }

    #[test]
    fn formation_slots_return_exact_role_layout() {
        assert_eq!(
            formation_slots("4-4-2"),
            vec![
                Position::Goalkeeper,
                Position::LeftBack,
                Position::CenterBack,
                Position::CenterBack,
                Position::RightBack,
                Position::LeftMidfielder,
                Position::CentralMidfielder,
                Position::CentralMidfielder,
                Position::RightMidfielder,
                Position::Striker,
                Position::Striker,
            ]
        );
    }

    #[test]
    fn deployed_position_maps_starting_xi_index_to_formation_slot() {
        use domain::team::Team;

        let mut team = Team::new(
            "t1".to_string(),
            "Test FC".to_string(),
            "TFC".to_string(),
            "England".to_string(),
            "London".to_string(),
            "Ground".to_string(),
            25_000,
        );
        team.formation = "4-4-2".to_string();
        team.starting_xi_ids = vec![
            "gk".to_string(),
            "lb".to_string(),
            "cb1".to_string(),
            "cb2".to_string(),
            "rb".to_string(),
        ];

        assert_eq!(deployed_position(&team, "gk"), Some(Position::Goalkeeper));
        assert_eq!(deployed_position(&team, "lb"), Some(Position::LeftBack));
        assert_eq!(deployed_position(&team, "rb"), Some(Position::RightBack));
        // Not in the starting XI -> no deployed slot.
        assert_eq!(deployed_position(&team, "bench"), None);
    }

    #[test]
    fn role_specific_rating_favors_matching_profile() {
        let mut player = make_player(Position::CenterBack);
        player.natural_position = Position::CenterBack;
        player.attributes.defending = 88;
        player.attributes.tackling = 84;
        player.attributes.positioning = 82;
        player.attributes.strength = 80;
        player.attributes.passing = 55;
        player.attributes.vision = 50;
        player.attributes.shooting = 40;
        player.attributes.dribbling = 44;

        assert!(
            ovr_for_position(&player, &Position::CenterBack)
                > ovr_for_position(&player, &Position::Striker)
        );
    }

    #[test]
    fn assignment_penalty_drops_wrong_side_fullback_more_with_poor_weak_foot() {
        let mut player = make_player(Position::RightBack);
        player.natural_position = Position::RightBack;
        player.footedness = Footedness::Right;
        player.weak_foot = 1;
        player.attributes.tackling = 82;
        player.attributes.defending = 80;
        player.attributes.positioning = 78;
        player.attributes.pace = 81;
        player.attributes.stamina = 79;

        let same_side = effective_rating_for_assignment(&player, &Position::RightBack);
        let wrong_side = effective_rating_for_assignment(&player, &Position::LeftBack);

        assert!(same_side > wrong_side);
    }

    /// A player whose natural position is `natural`, with the given foot.
    fn wide_player(natural: Position, foot: Footedness, weak_foot: u8) -> Player {
        let mut player = make_player(natural.clone());
        player.natural_position = natural;
        player.footedness = foot;
        player.weak_foot = weak_foot;
        player
    }

    /// Spec 1.1, 1.2: given a left-footed left-back and a left-footed left
    /// midfielder at left wing-back,
    /// when they are rated there,
    /// then neither pays a compatibility penalty: wing-backs are made from
    /// them (phase 2, P2.7, X45). The wing-back weights still apply.
    #[test]
    fn a_full_back_or_wide_midfielder_converts_to_wing_back_on_his_flank() {
        for natural in [Position::LeftBack, Position::LeftMidfielder] {
            let player = wide_player(natural.clone(), Footedness::Left, 3);
            assert_eq!(
                slot_familiarity(&player, &Position::LeftWingBack),
                SlotFamiliarity::WingBackConversion,
                "{natural:?}"
            );
            assert_eq!(
                positional_fit_for_assignment(&player, &Position::LeftWingBack),
                ovr_for_position(&player, &Position::LeftWingBack).max(1.0),
                "{natural:?}"
            );
        }
    }

    /// Spec 1.3, 1.6: given a right-footed right-back (weak foot 2) at left
    /// wing-back, and a right-footed left-back (weak foot 1) there,
    /// when they are rated,
    /// then the right-back pays the old same-group 8 and his foot (6), and the
    /// left-back his foot alone (8): the conversion is for the own flank only,
    /// and the foot is never waived.
    #[test]
    fn the_wrong_flank_and_the_wrong_foot_still_cost() {
        let right_back = wide_player(Position::RightBack, Footedness::Right, 2);
        assert_eq!(
            slot_familiarity(&right_back, &Position::LeftWingBack),
            SlotFamiliarity::SameGroup
        );
        let base = ovr_for_position(&right_back, &Position::LeftWingBack);
        assert_eq!(
            positional_fit_for_assignment(&right_back, &Position::LeftWingBack),
            (base - 8.0 - 6.0).max(1.0)
        );

        let left_back = wide_player(Position::LeftBack, Footedness::Right, 1);
        let base = ovr_for_position(&left_back, &Position::LeftWingBack);
        assert_eq!(
            positional_fit_for_assignment(&left_back, &Position::LeftWingBack),
            (base - 8.0).max(1.0)
        );
    }

    /// Spec 1.4, 1.5: given a centre-back and a left winger at left wing-back,
    /// when they are rated,
    /// then the old rules hold: same group for the centre-back, another group
    /// for the winger (Q2).
    #[test]
    fn a_centre_back_or_a_winger_is_no_wing_back_conversion() {
        let centre_back = wide_player(Position::CenterBack, Footedness::Left, 3);
        assert_eq!(
            slot_familiarity(&centre_back, &Position::LeftWingBack),
            SlotFamiliarity::SameGroup
        );
        let winger = wide_player(Position::LeftWinger, Footedness::Left, 3);
        assert_eq!(
            slot_familiarity(&winger, &Position::LeftWingBack),
            SlotFamiliarity::OtherGroup
        );
    }

    fn right_footed_left_winger() -> Player {
        let mut player = make_player(Position::LeftWinger);
        player.natural_position = Position::LeftWinger;
        player.alternate_positions = vec![Position::LeftMidfielder];
        player.footedness = Footedness::Right;
        player.weak_foot = 3;
        player
    }

    /// Given a right-footed left winger (an inverted winger, cutting inside to
    /// shoot), when he is rated on the left wing, then his foot costs him
    /// nothing: on the wing either foot is a way to play.
    #[test]
    fn an_inverted_winger_is_not_penalised_for_his_foot() {
        let player = right_footed_left_winger();

        assert_eq!(
            positional_fit_for_assignment(&player, &Position::LeftWinger),
            ovr_for_position(&player, &Position::LeftWinger)
        );
    }

    /// Given the same right-footed player, when he is rated at left midfield (one
    /// of his positions), then only the alternate position costs him, not his
    /// foot: a wide midfielder on his weaker side cuts inside just the same.
    #[test]
    fn an_inverted_wide_midfielder_is_not_penalised_for_his_foot() {
        let player = right_footed_left_winger();
        let alternate_position_cost = 4.0;

        assert_eq!(
            positional_fit_for_assignment(&player, &Position::LeftMidfielder),
            ovr_for_position(&player, &Position::LeftMidfielder) - alternate_position_cost
        );
    }

    /// Given a right-footed player, when he is rated at left back, then his foot
    /// still costs him: a full-back overlaps and crosses from the touchline.
    #[test]
    fn a_full_back_on_his_weaker_side_is_still_penalised() {
        let mut player = make_player(Position::LeftBack);
        player.natural_position = Position::LeftBack;
        player.footedness = Footedness::Right;
        player.weak_foot = 3;

        assert!(
            positional_fit_for_assignment(&player, &Position::LeftBack)
                < ovr_for_position(&player, &Position::LeftBack)
        );
    }

    #[test]
    fn alternate_positions_reduce_assignment_penalty() {
        let mut player = make_player(Position::CentralMidfielder);
        player.natural_position = Position::CentralMidfielder;
        player.alternate_positions = vec![Position::AttackingMidfielder];
        player.attributes.passing = 82;
        player.attributes.vision = 84;
        player.attributes.decisions = 78;
        player.attributes.dribbling = 76;

        let alternate_role =
            effective_rating_for_assignment(&player, &Position::AttackingMidfielder);
        let out_of_group_role = effective_rating_for_assignment(&player, &Position::RightBack);

        assert!(alternate_role > out_of_group_role);
    }

    /// Spec 2.1 (phase 2, P2.7, X43): given 3-4-2-1, and a 4-4-1-1 that has a
    /// four-man second row behind a back four,
    /// when their slots are laid out,
    /// then 3-4-2-1's second row is a wing-back either side of two central
    /// midfielders, and 4-4-1-1's stays the defensive-midfield row it was:
    /// wing-backs only where three centre-backs leave the flanks to them.
    #[test]
    fn three_four_two_one_puts_wing_backs_in_its_second_row() {
        use Position::*;
        assert_eq!(
            formation_slots("3-4-2-1"),
            vec![
                Goalkeeper,
                CenterBack,
                CenterBack,
                CenterBack,
                LeftWingBack,
                CentralMidfielder,
                CentralMidfielder,
                RightWingBack,
                AttackingMidfielder,
                AttackingMidfielder,
                Striker,
            ]
        );
        assert_eq!(
            formation_slots("4-4-1-1")[5..9].to_vec(),
            vec![DefensiveMidfielder; 4]
        );
    }

    #[test]
    fn formation_slots_532_yields_11_granular_positions() {
        let slots = formation_slots("5-3-2");
        assert_eq!(slots.len(), 11);
        assert_eq!(slots[0], Position::Goalkeeper);
        // 5 defenders
        assert_eq!(
            &slots[1..6],
            &[
                Position::LeftWingBack,
                Position::CenterBack,
                Position::CenterBack,
                Position::CenterBack,
                Position::RightWingBack,
            ]
        );
        // 3 midfielders
        assert_eq!(
            &slots[6..9],
            &[
                Position::DefensiveMidfielder,
                Position::CentralMidfielder,
                Position::AttackingMidfielder,
            ]
        );
        // 2 forwards
        assert_eq!(&slots[9..11], &[Position::Striker, Position::Striker]);
    }

    #[test]
    fn formation_slots_4141_yields_11_granular_positions() {
        let slots = formation_slots("4-1-4-1");
        assert_eq!(slots.len(), 11);
        assert_eq!(slots[0], Position::Goalkeeper);
        // 4 defenders
        assert_eq!(
            &slots[1..5],
            &[
                Position::LeftBack,
                Position::CenterBack,
                Position::CenterBack,
                Position::RightBack,
            ]
        );
        // 1 deep midfielder
        assert_eq!(slots[5], Position::DefensiveMidfielder);
        // a flat four with a wide man on each flank (phase 2, GĐ3, X51)
        assert_eq!(
            &slots[6..10],
            &[
                Position::LeftMidfielder,
                Position::CentralMidfielder,
                Position::CentralMidfielder,
                Position::RightMidfielder,
            ]
        );
        // 1 forward
        assert_eq!(slots[10], Position::Striker);
    }

    #[test]
    fn refresh_does_not_award_wonderkid_below_elite_potential_threshold() {
        let mut player = make_player(Position::Striker);
        player.date_of_birth = "2007-01-01".to_string();
        player.natural_position = Position::Striker;
        player.attributes.shooting = 70;
        player.attributes.positioning = 70;
        player.attributes.decisions = 70;
        player.attributes.pace = 70;
        player.attributes.dribbling = 70;
        player.attributes.strength = 70;
        player.attributes.composure = 70;
        player.attributes.aerial = 70;
        player.potential = 84;

        refresh_player_derived(&mut player, 2026);

        assert!(player.potential >= player.ovr.saturating_add(10));
        assert!(!player.traits.contains(&PlayerTrait::Wonderkid));
    }
}
