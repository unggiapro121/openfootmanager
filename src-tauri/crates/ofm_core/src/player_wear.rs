//! Shared post-match physical wear applied to individual players.
//!
//! Used by both club matches and national-team friendlies so that a call-up
//! carries fatigue, fitness sharpening, and injury risk back to the player's
//! club (the same [`Player`] record is mutated in either context).

use domain::player::{Injury, Player};
use rand::{Rng, RngExt};

/// i18n keys for minor match injuries. These mirror the training-ground injury
/// pool so the UI renders them with existing translations.
pub const MATCH_INJURY_NAMES: [&str; 5] = [
    "common.injuries.minorMuscleStrain",
    "common.injuries.twistedAnkle",
    "common.injuries.kneeBruise",
    "common.injuries.hamstringTightness",
    "common.injuries.calfStrain",
];

/// Deplete a player's short-term condition based on minutes played and stamina,
/// and gradually sharpen match fitness for players with significant minutes.
///
/// A no-op for players who did not feature (`minutes == 0`).
pub fn apply_match_wear(player: &mut Player, minutes: u8, rng: &mut impl Rng) {
    if minutes == 0 {
        return; // Did not play, no wear.
    }

    let minutes_factor = minutes as f64 / 90.0;
    let stamina_factor = player.attributes.stamina as f64 / 100.0;
    let base_depletion = 40.0 * (1.0 - stamina_factor * 0.4);
    let depletion = (base_depletion * minutes_factor) as u8;
    player.condition = player.condition.saturating_sub(depletion);

    // 60+ minutes builds sharpness; probabilistic to keep changes gradual.
    if minutes >= 60 && player.fitness < 100 && rng.random_bool(0.3) {
        player.fitness = player.fitness.saturating_add(1);
    }
}

/// Injury-risk multiplier scaled by match fitness: less fit players are more
/// prone to picking up a knock.
fn injury_multiplier_from_fitness(fitness: u8) -> f64 {
    if fitness < 30 {
        3.0
    } else if fitness < 50 {
        2.0
    } else if fitness < 70 {
        1.5
    } else if fitness >= 90 {
        0.7
    } else {
        1.0
    }
}

/// Roll for a match-day injury. On a hit, sets the player's injury and returns
/// `true`. Already-injured players are skipped (returns `false`).
pub fn roll_match_injury(player: &mut Player, rng: &mut impl Rng) -> bool {
    if player.injury.is_some() {
        return false;
    }

    // Base match-day risk, slightly higher than the training-ground rate to
    // reflect competitive intensity.
    let base_prob = 1.0_f64 / 40.0;
    let prob = (base_prob * injury_multiplier_from_fitness(player.fitness)).min(1.0);
    if !rng.random_bool(prob) {
        return false;
    }

    let days = rng.random_range(5..=21);
    let name = MATCH_INJURY_NAMES[rng.random_range(0..MATCH_INJURY_NAMES.len())];
    player.injury = Some(Injury {
        name: name.to_string(),
        days_remaining: days,
    });
    true
}

/// The three kinds of match injury, light to serious: share of injuries for a
/// match-fit player, the days out, and what it might be.
const MATCH_INJURY_TIERS: [(u32, std::ops::RangeInclusive<u32>, &[&str]); 3] = [
    (60, 3..=10, &MATCH_INJURY_NAMES),
    (
        30,
        11..=35,
        &[
            "common.injuries.hamstringTear",
            "common.injuries.ankleSprain",
            "common.injuries.groinStrain",
        ],
    ),
    (
        10,
        36..=120,
        &[
            "common.injuries.kneeLigament",
            "common.injuries.brokenFoot",
            "common.injuries.achillesInjury",
        ],
    ),
];

/// A player hurt in a match: how bad, and for how long. A light knock is the
/// usual outcome; a player short of match fitness (under 50) is half as likely
/// again to suffer a medium or serious one. Returns the injury, or `None` when
/// he is already injured, which is left as it is.
pub fn assign_match_injury(player: &mut Player, rng: &mut impl Rng) -> Option<Injury> {
    if player.injury.is_some() {
        return None;
    }
    let unfit = player.fitness < 50;
    let weights: Vec<u32> = MATCH_INJURY_TIERS
        .iter()
        .enumerate()
        .map(|(tier, (share, _, _))| match (tier, unfit) {
            (0, true) => share - 20,
            (_, true) => share * 3 / 2,
            _ => *share,
        })
        .collect();
    let mut roll = rng.random_range(0..weights.iter().sum::<u32>());
    let tier = weights
        .iter()
        .position(|weight| {
            if roll < *weight {
                true
            } else {
                roll -= weight;
                false
            }
        })
        .unwrap_or(0);
    let (_, days, names) = &MATCH_INJURY_TIERS[tier];
    let injury = Injury {
        name: names[rng.random_range(0..names.len())].to_string(),
        days_remaining: rng.random_range(days.clone()),
    };
    player.injury = Some(injury.clone());
    Some(injury)
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::player::{Player, PlayerAttributes, Position};
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn attrs(stamina: u8) -> PlayerAttributes {
        PlayerAttributes {
            pace: 70,
            stamina,
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
            handling: 50,
            reflexes: 50,
            aerial: 60,
        }
    }

    fn make_player(stamina: u8) -> Player {
        Player::new(
            "p1".to_string(),
            "J. Doe".to_string(),
            "John Doe".to_string(),
            "2000-01-01".to_string(),
            "ENG".to_string(),
            Position::Midfielder,
            attrs(stamina),
        )
    }

    #[test]
    fn apply_match_wear_depletes_condition_by_minutes_and_stamina() {
        let mut player = make_player(100); // stamina 100 -> base depletion 24 over 90'
        player.condition = 100;
        let mut rng = StdRng::seed_from_u64(1);

        apply_match_wear(&mut player, 90, &mut rng);

        assert_eq!(player.condition, 76);
    }

    #[test]
    fn apply_match_wear_is_noop_for_unused_player() {
        let mut player = make_player(70);
        player.condition = 88;
        player.fitness = 90;
        let mut rng = StdRng::seed_from_u64(2);

        apply_match_wear(&mut player, 0, &mut rng);

        assert_eq!(player.condition, 88);
        assert_eq!(player.fitness, 90);
    }

    #[test]
    fn apply_match_wear_never_lowers_fitness() {
        let mut player = make_player(70);
        player.fitness = 80;
        let mut rng = StdRng::seed_from_u64(3);

        apply_match_wear(&mut player, 90, &mut rng);

        assert!(player.fitness >= 80);
    }

    fn tiers(fitness: u8) -> [usize; 3] {
        let mut rng = StdRng::seed_from_u64(11);
        let mut counts = [0; 3];
        for _ in 0..4000 {
            let mut player = make_player(70);
            player.fitness = fitness;
            let injury = assign_match_injury(&mut player, &mut rng).expect("injured");
            let tier = match injury.days_remaining {
                3..=10 => 0,
                11..=35 => 1,
                36..=120 => 2,
                other => panic!("{other} days is in no tier"),
            };
            counts[tier] += 1;
        }
        counts
    }

    /// Given a match-fit player hurt in a match, many times over,
    /// Then about 60% of injuries are light, 30% medium and 10% serious.
    #[test]
    fn match_injuries_are_mostly_light() {
        let [light, medium, serious] = tiers(80);
        assert!((2200..=2600).contains(&light), "{light}");
        assert!((1000..=1400).contains(&medium), "{medium}");
        assert!((280..=520).contains(&serious), "{serious}");
    }

    /// Given a player short of match fitness,
    /// Then his injuries run more often medium or serious.
    #[test]
    fn an_unfit_player_is_hurt_worse() {
        let fit = tiers(80);
        let unfit = tiers(30);
        assert!(unfit[2] > fit[2] && unfit[1] > fit[1], "{fit:?} {unfit:?}");
    }

    /// Given a player already injured,
    /// Then a match injury leaves his injury as it is.
    #[test]
    fn a_match_injury_does_not_replace_one_he_has() {
        let mut player = make_player(70);
        player.injury = Some(Injury {
            name: "x".to_string(),
            days_remaining: 4,
        });
        let mut rng = StdRng::seed_from_u64(1);

        assert!(assign_match_injury(&mut player, &mut rng).is_none());
        assert_eq!(player.injury.as_ref().unwrap().days_remaining, 4);
    }

    #[test]
    fn roll_match_injury_skips_already_injured_player() {
        let mut player = make_player(40);
        player.injury = Some(Injury {
            name: "existing".to_string(),
            days_remaining: 10,
        });
        let mut rng = StdRng::seed_from_u64(4);

        assert!(!roll_match_injury(&mut player, &mut rng));
        assert_eq!(player.injury.as_ref().unwrap().name, "existing");
    }

    #[test]
    fn roll_match_injury_eventually_injures_a_low_fitness_player() {
        let mut rng = StdRng::seed_from_u64(5);
        let mut injured = false;
        for _ in 0..500 {
            let mut player = make_player(70);
            player.fitness = 20; // 3x multiplier
            if roll_match_injury(&mut player, &mut rng) {
                assert!(player.injury.is_some());
                let injury = player.injury.unwrap();
                assert!(MATCH_INJURY_NAMES.contains(&injury.name.as_str()));
                assert!((5..=21).contains(&injury.days_remaining));
                injured = true;
                break;
            }
        }
        assert!(
            injured,
            "a low-fitness player should be injured within 500 rolls"
        );
    }
}
