//! The squad a new online club starts with: the same frame for every club, anchored on three
//! numbers (E3-5q §4.3, F3).

use domain::player::{Player, Position, SquadRole};
use rand::{Rng, RngExt};

use super::pack::{Band, StarterProfile, TemplateRow};
use crate::worldgen::calibration::{calibrate_to_ovr, min_headroom, scale_to_ovr};
use crate::worldgen::generation::{generate_random_player_from_def, reprice_generated_player};

/// The three numbers a starter squad is anchored on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SquadStrength {
    /// Average OVR of the best 18 players.
    pub top18: f64,
    /// Average OVR of the strongest 1-4-4-2 by position group.
    pub first_eleven: f64,
    /// OVR of the best goalkeeper.
    pub goalkeeper: f64,
}

impl SquadStrength {
    pub fn of(players: &[Player]) -> Self {
        let mut all: Vec<u8> = players.iter().map(|player| player.ovr).collect();
        all.sort_unstable_by(|a, b| b.cmp(a));
        let top18 = mean(all.iter().take(18).copied());
        let best = |group: Position, count: usize| -> Vec<u8> {
            let mut ovrs: Vec<u8> = players
                .iter()
                .filter(|player| player.position.to_group_position() == group)
                .map(|player| player.ovr)
                .collect();
            ovrs.sort_unstable_by(|a, b| b.cmp(a));
            ovrs.truncate(count);
            ovrs
        };
        let keepers = best(Position::Goalkeeper, 1);
        let eleven = keepers
            .iter()
            .chain(&best(Position::Defender, 4))
            .chain(&best(Position::Midfielder, 4))
            .chain(&best(Position::Forward, 2))
            .copied()
            .collect::<Vec<u8>>();
        Self {
            top18,
            first_eleven: mean(eleven.iter().copied()),
            goalkeeper: keepers.first().copied().map_or(0.0, f64::from),
        }
    }

    /// Whether every number is within its band.
    pub fn within(&self, profile: &StarterProfile) -> bool {
        let inside = |value: f64, band: &Band| (value - band.target).abs() <= band.tolerance;
        inside(self.top18, &profile.strength)
            && inside(self.first_eleven, &profile.first_eleven)
            && inside(self.goalkeeper, &profile.goalkeeper)
    }
}

fn mean(values: impl Iterator<Item = u8>) -> f64 {
    let (sum, count) = values.fold((0.0, 0usize), |(sum, count), value| {
        (sum + f64::from(value), count + 1)
    });
    if count == 0 { 0.0 } else { sum / count as f64 }
}

/// The position group a template row names.
pub fn group_of(row: &TemplateRow) -> Option<Position> {
    match row.group.as_str() {
        "Goalkeeper" => Some(Position::Goalkeeper),
        "Defender" => Some(Position::Defender),
        "Midfielder" => Some(Position::Midfielder),
        "Forward" => Some(Position::Forward),
        _ => None,
    }
}

/// The first squad slot of each group in the generator's layout (GK 0-1, DEF 2-8, MID 9-15, FWD
/// 16-21), and how many slots it has.
fn group_slots(group: &Position) -> (usize, usize) {
    match group {
        Position::Goalkeeper => (0, 2),
        Position::Defender => (2, 7),
        Position::Midfielder => (9, 7),
        _ => (16, 6),
    }
}

/// What a squad member is drawn as: the generator's player, his row, and his target OVR.
struct Drawn {
    player: Player,
    row: usize,
    target: f64,
}

/// Everything a squad draw needs besides the stream.
pub(super) struct SquadInputs<'a> {
    pub team_id: &'a str,
    pub football_year: u32,
    pub profile: &'a StarterProfile,
    pub names: &'a crate::worldgen::definitions::NamesDefinition,
}

/// Draw one squad from `rng`: the template's players, calibrated and anchored. `None` when the
/// three numbers do not settle within their bands; the caller draws again on a fresh stream.
pub(super) fn draw_squad(
    inputs: &SquadInputs<'_>,
    nationality: &super::NationalityDraw<'_>,
    rng: &mut impl Rng,
) -> Option<Vec<Player>> {
    let profile = inputs.profile;
    let mut used_slots = [0usize; 4];
    let mut drawn = Vec::with_capacity(profile.template.len());
    for (index, row) in profile.template.iter().enumerate() {
        let group = group_of(row)?;
        let slot = if row.academy {
            crate::worldgen::generation::youth_slots_for_target(Some(group.clone()))[0]
        } else {
            let (first, count) = group_slots(&group);
            let at = &mut used_slots[group_index(&group)];
            let slot = first + (*at).min(count - 1);
            *at += 1;
            slot
        };
        let age = rng.random_range(row.ages.0..=row.ages.1.max(row.ages.0));
        let nation = nationality.draw(rng);
        let mut player = generate_random_player_from_def(
            inputs.team_id,
            slot,
            &nation,
            inputs.football_year,
            Some(age),
            inputs.names,
            rng,
        );
        // His own position before he is calibrated, so his overall is the one at it.
        crate::player_identity::upgrade_player_identity(&mut player, None);
        let jitter = profile.ovr_jitter.max(0.0);
        let target = profile.strength.target
            + row.ovr_offset
            + if jitter > 0.0 {
                rng.random_range(-jitter..=jitter)
            } else {
                0.0
            };
        calibrate_to_ovr(&mut player, target);
        player.ovr = crate::player_rating::natural_ovr(&player).round() as u8;
        if row.academy {
            player.squad_role = SquadRole::Youth;
        }
        drawn.push(Drawn {
            player,
            row: index,
            target,
        });
    }

    anchor(&mut drawn, profile);

    for member in &mut drawn {
        settle(member, profile, inputs.football_year, rng);
    }
    let players: Vec<Player> = drawn.into_iter().map(|member| member.player).collect();
    SquadStrength::of(&players)
        .within(profile)
        .then_some(players)
}

fn group_index(group: &Position) -> usize {
    match group {
        Position::Goalkeeper => 0,
        Position::Defender => 1,
        Position::Midfielder => 2,
        _ => 3,
    }
}

/// Move the squad's three numbers onto their targets: the keepers by the goalkeeper's gap, the
/// outfield by the 18's, then the outfield again by the XI's half-way (the two outfield numbers
/// share players, so the XI is nudged, not forced). Academy players are left where they are.
fn anchor(drawn: &mut [Drawn], profile: &StarterProfile) {
    for _ in 0..3 {
        let players: Vec<Player> = drawn.iter().map(|member| member.player.clone()).collect();
        let strength = SquadStrength::of(&players);
        if strength.within(profile) {
            return;
        }
        let keeper_gap = profile.goalkeeper.target - strength.goalkeeper;
        let outfield_gap = profile.strength.target - strength.top18
            + 0.5 * (profile.first_eleven.target - strength.first_eleven);
        for member in drawn.iter_mut() {
            if profile.template[member.row].academy {
                continue;
            }
            let keeper = member.player.position.to_group_position() == Position::Goalkeeper;
            member.target += if keeper { keeper_gap } else { outfield_gap };
            scale_to_ovr(&mut member.player, member.target);
            member.player.ovr = crate::player_rating::natural_ovr(&member.player).round() as u8;
        }
    }
}

/// A squad member's potential drawn within his row's band (never below his OVR plus the least
/// room his age leaves), then his derived ratings, traits, value and wage.
fn settle(member: &mut Drawn, profile: &StarterProfile, football_year: u32, rng: &mut impl Rng) {
    let row = &profile.template[member.row];
    let player = &mut member.player;
    let age = crate::player_rating::player_age(&player.date_of_birth, football_year);
    let floor = player.ovr.saturating_add(min_headroom(age)).min(99);
    let low = row.potential.0.max(floor);
    let high = row.potential.1.max(low);
    player.potential = rng.random_range(low..=high);
    crate::player_rating::refresh_player_derived(player, football_year);
    crate::assigned_traits::assign_traits(player, football_year);
    reprice_generated_player(player, football_year);
}
