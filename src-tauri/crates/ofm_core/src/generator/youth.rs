//! Youngsters joining a club's academy: the one youth-recruit generator,
//! behind both a youth scout's prospects and the annual intake.

use super::*;
use domain::player::{Player, Position};
use domain::team::Team;

/// Generate a youth prospect who is joining **now**.
///
/// `current_year` is the year the recruit arrives, not the year the world opened:
/// a prospect scouted five seasons into a career is fifteen in *that* season. The
/// two coincide only for the opening intake, which is why the distinction is
/// worth naming — a call site that passed the world's opening year here would
/// quietly produce a squad of players five years too old.
pub fn generate_youth_academy_recruit(
    team: &Team,
    target_position: Option<&Position>,
    current_year: u32,
) -> Player {
    generate_youth_academy_recruit_with_nationality(team, target_position, None, current_year)
}

/// As [`generate_youth_academy_recruit`], with the prospect's nationality forced
/// rather than drawn from the club's country. See there for `current_year`.
pub fn generate_youth_academy_recruit_with_nationality(
    team: &Team,
    target_position: Option<&Position>,
    nationality_override: Option<&str>,
    current_year: u32,
) -> Player {
    youth_recruit(
        team,
        target_position,
        nationality_override,
        current_year,
        None,
        &mut rand::rng(),
    )
}

/// A youngster joining `team`'s academy in its annual intake: of `group`, aged
/// `age`, drawn from `rng`. The same recruit a youth scout finds, at the age a
/// club takes one in rather than the age it scouts one.
pub(crate) fn generate_youth_intake_recruit(
    team: &Team,
    group: &Position,
    age: u32,
    current_year: u32,
    rng: &mut impl rand::Rng,
) -> Player {
    youth_recruit(team, Some(group), None, current_year, Some(age), rng)
}

/// A youngster for a nation's season youth pool: of `group`, aged `age`, of
/// `nation`. `template` is a club of that nation, which the shared generator
/// draws names and squad slots for; he joins no club here.
pub(crate) fn generate_youth_pool_member(
    template: &Team,
    group: &Position,
    nation: &str,
    age: u32,
    current_year: u32,
    rng: &mut impl rand::Rng,
) -> Player {
    let mut player = youth_recruit(
        template,
        Some(group),
        Some(nation),
        current_year,
        Some(age),
        rng,
    );
    player.team_id = None;
    player
}

fn youth_recruit(
    team: &Team,
    target_position: Option<&Position>,
    nationality_override: Option<&str>,
    current_year: u32,
    age: Option<u32>,
    rng: &mut impl rand::Rng,
) -> Player {
    use domain::player::SquadRole;

    let names_def = default_names_definition();
    let country_codes = generation::nationality_distribution();
    let nationality = nationality_override
        .map(generation::canonicalize_generated_nationality)
        .unwrap_or_else(|| {
            // `team_local_nationality`, not `team.country`: a club carries both a
            // location and a football identity, and where they differ the
            // football identity is the one a youth intake should draw on.
            pick_nationality_from_def(team_local_nationality(team), country_codes, rng)
        });
    let youth_slots = youth_slots_for_target(target_position.map(Position::to_group_position));
    let slot_index = youth_slots[rng.random_range(0..youth_slots.len())];
    let mut player = generate_random_player_from_def(
        &team.id,
        slot_index,
        &nationality,
        current_year,
        age,
        &names_def,
        rng,
    );
    player.squad_role = SquadRole::Youth;
    player.transfer_listed = false;
    player.loan_listed = false;
    grow_into_age(&mut player, current_year, rng);
    player
}

/// The best overall a youngster may have when he is found, by age. The squad
/// generator draws attributes on a senior's scale whatever the age, which made
/// a fifteen-year-old as good as a first-team regular.
fn youth_ovr_ceiling(age: u32) -> u8 {
    match age {
        ..=15 => 64,
        16 => 69,
        17 => 74,
        18 => 77,
        19 => 80,
        20 => 83,
        _ => 86,
    }
}

/// How much of a grown player's attributes a youngster of `age` has: a
/// fifteen-year-old has three quarters of what the same profile reaches at peak.
fn youth_maturity(age: u32) -> f64 {
    match age {
        ..=15 => 0.75,
        16 => 0.79,
        17 => 0.83,
        18 => 0.87,
        19 => 0.90,
        20 => 0.93,
        _ => 0.96,
    }
}

/// The least room to grow a youngster is given over his overall, by age.
fn youth_min_growth(age: u32) -> u8 {
    match age {
        ..=15 => 8,
        16 => 7,
        17 => 5,
        18 => 4,
        19 => 3,
        _ => 1,
    }
}

/// Chance in a hundred that a youngster is a gem, whose ceiling is lifted.
const GEM_CHANCE_PERCENT: u32 = 5;

/// A youngster's potential, drawn on its own rather than as his overall plus a
/// bonus: around 70 for most, above 80 for one in ten, 85 and up for about
/// one in twenty. Never less than his overall plus the room his age leaves.
fn draw_youth_potential(ovr: u8, age: u32, rng: &mut impl rand::Rng) -> u8 {
    let mut potential = 52 + rng.random_range(0u8..=18) + rng.random_range(0u8..=18);
    if rng.random_range(0..100) < GEM_CHANCE_PERCENT {
        potential = potential.saturating_add(rng.random_range(5u8..=12));
    }
    potential
        .max(ovr.saturating_add(youth_min_growth(age)))
        .min(99)
}

fn scale_attributes(attributes: &mut domain::player::PlayerAttributes, factor: f64) {
    let scale = |value: &mut u8| {
        *value = (f64::from(*value) * factor).round().clamp(1.0, 99.0) as u8;
    };
    for value in [
        &mut attributes.pace,
        &mut attributes.stamina,
        &mut attributes.strength,
        &mut attributes.agility,
        &mut attributes.passing,
        &mut attributes.shooting,
        &mut attributes.tackling,
        &mut attributes.dribbling,
        &mut attributes.defending,
        &mut attributes.positioning,
        &mut attributes.vision,
        &mut attributes.decisions,
        &mut attributes.composure,
        &mut attributes.aggression,
        &mut attributes.teamwork,
        &mut attributes.leadership,
        &mut attributes.handling,
        &mut attributes.reflexes,
        &mut attributes.aerial,
    ] {
        scale(value);
    }
}

/// Bring a freshly generated youngster down to what his age allows: attributes
/// scaled by [`youth_maturity`], then capped at [`youth_ovr_ceiling`]; his
/// potential, rating-derived traits, value and wage settled on the result.
fn grow_into_age(player: &mut Player, current_year: u32, rng: &mut impl rand::Rng) {
    use crate::player_rating::natural_ovr;

    let age = crate::player_rating::player_age(&player.date_of_birth, current_year);
    scale_attributes(&mut player.attributes, youth_maturity(age));
    let ceiling = f64::from(youth_ovr_ceiling(age));
    // Rounding each attribute can leave the overall a point over; a few passes settle it.
    for _ in 0..4 {
        let ovr = natural_ovr(player);
        if ovr.round() <= ceiling {
            break;
        }
        scale_attributes(&mut player.attributes, (ceiling - 0.5) / ovr);
    }

    let ovr = natural_ovr(player).round() as u8;
    player.potential = draw_youth_potential(ovr, age, rng);
    crate::player_rating::refresh_player_derived(player, current_year);
    reprice_generated_player(player, current_year);
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::SeedableRng;

    fn club() -> Team {
        Team::new(
            "como".into(),
            "Como".into(),
            "COM".into(),
            "IT".into(),
            "Como".into(),
            "Sinigaglia".into(),
            13_000,
        )
    }

    const GROUPS: [Position; 4] = [
        Position::Goalkeeper,
        Position::Defender,
        Position::Midfielder,
        Position::Forward,
    ];

    fn draw(age: u32, count: usize) -> Vec<Player> {
        let mut rng = rand::rngs::StdRng::seed_from_u64(u64::from(age));
        (0..count)
            .map(|index| {
                generate_youth_pool_member(&club(), &GROUPS[index % 4], "IT", age, 2026, &mut rng)
            })
            .collect()
    }

    fn percentile(values: &mut [u8], share: f64) -> u8 {
        values.sort_unstable();
        values[((values.len() - 1) as f64 * share) as usize]
    }

    /// Given youngsters drawn at each pool age, when their overall is read,
    /// then none reaches the ceiling for his age (15 < 65, 16 < 70, 17 < 75 …).
    #[test]
    fn no_youngster_is_better_than_his_age_allows() {
        for (age, below) in [
            (15, 65),
            (16, 70),
            (17, 75),
            (18, 78),
            (19, 81),
            (20, 84),
            (21, 87),
        ] {
            let best = draw(age, 2_000)
                .iter()
                .map(|player| player.ovr)
                .max()
                .unwrap_or(0);
            assert!(
                best < below,
                "age {age}: best overall {best}, must stay under {below}"
            );
        }
    }

    /// Given fifteen-year-olds, when their overall is read, then the typical one
    /// is an academy player, not a first-team regular.
    #[test]
    fn a_typical_fifteen_year_old_is_far_from_the_first_team() {
        let mut overalls: Vec<u8> = draw(15, 2_000).iter().map(|player| player.ovr).collect();
        let median = percentile(&mut overalls, 0.5);
        assert!(
            (45..=55).contains(&median),
            "median overall at 15 was {median}"
        );
    }

    /// Given a season's youngsters, when their potential is read, then most sit
    /// around 70, one in ten reaches 80, and 85-plus stays rare.
    #[test]
    fn high_potential_is_rare() {
        let players: Vec<Player> = [15, 16, 17, 18]
            .iter()
            .flat_map(|age| draw(*age, 1_000))
            .collect();
        let mut potentials: Vec<u8> = players.iter().map(|player| player.potential).collect();
        let median = percentile(&mut potentials, 0.5);
        let top_tenth = percentile(&mut potentials, 0.9);
        let gems = potentials
            .iter()
            .filter(|potential| **potential >= 85)
            .count();
        let gem_share = gems as f64 / potentials.len() as f64;
        assert!((67..=73).contains(&median), "median potential {median}");
        assert!(
            (78..=84).contains(&top_tenth),
            "90th-percentile potential {top_tenth}"
        );
        assert!(
            (0.02..=0.08).contains(&gem_share),
            "share at 85+ was {gem_share:.3}"
        );
    }

    /// Given any youngster, then his potential leaves him room to grow.
    #[test]
    fn potential_always_leaves_room_to_grow() {
        for player in draw(15, 1_000) {
            assert!(
                player.potential >= player.ovr + 8,
                "{} / {}",
                player.ovr,
                player.potential
            );
        }
    }
}
