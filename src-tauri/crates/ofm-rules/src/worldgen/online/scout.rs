//! A youth scout's trip online (phase 4, E4-1-tech-spec.md §4.2–§4.4): 15- and 16-year-old
//! candidates drawn from the world seed by the key `scout/<account>/<trip>`, named from the online
//! pack like every online person. Their potential is drawn from the academy's bands and is final:
//! the attributes are brought down to fit it, so the published table is the true one.
//!
//! The draws come in a fixed order; changing it changes the candidates and needs a new
//! `WORLD_RULES_VERSION` (`tests/scout_rules.rs` pins it).

use domain::player::{Player, PlayerAttributes, Position, SquadRole};
use rand::RngExt;
use serde::{Deserialize, Serialize};

use super::{GenError, Generator};
use crate::academy::{AcademyRules, RevealOffsets, draw_potential};
use crate::player_rating::natural_ovr;
use crate::seed::rng_for_seed;
use crate::worldgen::calibration::scale_attributes;
use crate::worldgen::generation::{generate_random_player_from_def, youth_slots_for_target};
use crate::worldgen::youth::{
    mature_for_age, settle_youngster, youth_min_growth, youth_ovr_ceiling,
};

/// Whose trip and which: the stream `scout/<account>/<trip>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutKey {
    pub account_id: String,
    pub trip: u64,
}

/// Where a scout looks, and how.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScoutFocus {
    Physical,
    Technical,
    Balanced,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutRequest {
    pub region: String,
    pub focus: ScoutFocus,
    /// An elite ticket: one more candidate, from the bands at or above `eliteMinPotential`.
    pub elite: bool,
}

/// A candidate, and the secret offsets of the ranges a coach is shown of him.
#[derive(Debug, Clone)]
pub struct ScoutCandidate {
    pub player: Player,
    pub reveal: RevealOffsets,
}

const GROUPS: [Position; 4] = [
    Position::Goalkeeper,
    Position::Defender,
    Position::Midfielder,
    Position::Forward,
];

/// The attributes a physical focus favours: those physical training raises.
fn physical(attributes: &mut PlayerAttributes) -> [&mut u8; 4] {
    [
        &mut attributes.pace,
        &mut attributes.stamina,
        &mut attributes.strength,
        &mut attributes.agility,
    ]
}

/// The attributes a technical focus favours: those technical training raises.
fn technical(attributes: &mut PlayerAttributes) -> [&mut u8; 9] {
    [
        &mut attributes.passing,
        &mut attributes.shooting,
        &mut attributes.dribbling,
        &mut attributes.long_passing,
        &mut attributes.crossing,
        &mut attributes.curve,
        &mut attributes.free_kick,
        &mut attributes.long_shots,
        &mut attributes.first_touch,
    ]
}

/// Each attribute times `factor`, kept within 1–99; a split attribute never declared (0) stays 0.
fn tilt<const N: usize>(attributes: [&mut u8; N], factor: f64) {
    for attribute in attributes {
        if *attribute > 0 {
            *attribute = (f64::from(*attribute) * factor).round().clamp(1.0, 99.0) as u8;
        }
    }
}

/// Lean `player`'s attributes towards `focus` (§4.3), then bring his overall back to what it was:
/// a focus shapes how he is made up, never how good he is.
fn lean(player: &mut Player, focus: ScoutFocus, tilt_permille: u32) {
    let share = f64::from(tilt_permille) / 1_000.0;
    let (physical_factor, technical_factor) = match focus {
        ScoutFocus::Physical => (1.0 + share, 1.0 - share),
        ScoutFocus::Technical => (1.0 - share, 1.0 + share),
        ScoutFocus::Balanced => return,
    };
    let before = natural_ovr(player);
    tilt(physical(&mut player.attributes), physical_factor);
    tilt(technical(&mut player.attributes), technical_factor);
    // Rounding each attribute swallows a small correction, so a few more passes than the age
    // cap's; what is left is a fraction of a point either way.
    for _ in 0..10 {
        let now = natural_ovr(player);
        if now <= 0.0 || (now - before).abs() < 0.5 {
            break;
        }
        scale_attributes(&mut player.attributes, before / now);
    }
}

impl Generator<'_> {
    /// The candidates a scout finds on trip `key` (§4.2), at `football_year`. Only the server's
    /// worker calls it: it reads the world seed. The offsets go to the server, never to a client.
    pub fn scout_report(
        &self,
        key: &ScoutKey,
        request: &ScoutRequest,
        rules: &AcademyRules,
        football_year: u32,
    ) -> Result<Vec<ScoutCandidate>, GenError> {
        let mut rng = rng_for_seed(
            self.seed,
            &format!("scout/{}/{}", key.account_id, key.trip),
            &self.pack.version,
        );
        let ordinary = rng.random_range(rules.candidates.clone());
        let elite_bands = rules.elite_bands();
        let mut candidates = Vec::new();
        for index in 0..u32::from(ordinary) + u32::from(request.elite) {
            let bands = if index == u32::from(ordinary) {
                &elite_bands
            } else {
                &rules.potential_bands
            };
            // 1. nationality, by the free agents' path
            let (local, _) = self.nation_of(&request.region, rng.random_range(0..10_000))?;
            let nation = self.nationality(&request.region, &local)?.draw(&mut rng);
            // 2. a youth slot of an evenly drawn group
            let group = &GROUPS[rng.random_range(0..GROUPS.len())];
            let slots = youth_slots_for_target(Some(group.clone()));
            let slot = slots[rng.random_range(0..slots.len())];
            // 3. age
            let age = u32::from(rng.random_range(rules.ages.clone()));
            // 4. the raw player (his id from the stream)
            let mut player = generate_random_player_from_def(
                "",
                slot,
                &nation,
                football_year,
                Some(age),
                &self.names_def,
                &mut rng,
            );
            player.team_id = None;
            player.squad_role = SquadRole::Youth;
            crate::player_identity::upgrade_player_identity(&mut player, None);
            // 5. the scout's focus
            lean(&mut player, request.focus, rules.focus_tilt_permille);
            // 6. the potential, final
            let potential = draw_potential(bands, &mut rng).unwrap_or(rules.elite_min_potential);
            // 7. grown to his age, under his potential less the room his age leaves
            let ceiling =
                youth_ovr_ceiling(age).min(potential.saturating_sub(youth_min_growth(age)));
            mature_for_age(&mut player, age, ceiling);
            player.potential = potential;
            // 8. the secret offsets of what a coach is shown
            let reveal = RevealOffsets {
                ovr_permille: rng.random_range(0..1_000),
                potential_permille: rng.random_range(0..1_000),
            };
            settle_youngster(&mut player, football_year);
            candidates.push(ScoutCandidate { player, reveal });
        }
        let mut players: Vec<Player> = candidates.iter().map(|c| c.player.clone()).collect();
        self.name_people(&mut players, &mut [])?;
        for (candidate, named) in candidates.iter_mut().zip(players) {
            candidate.player = named;
        }
        Ok(candidates)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player_rating::potential_stars;
    use crate::worldgen::online::OnlineContentPack;
    use crate::worldgen::online::names::is_protected_person;

    const REGION: &str = "AsiaSoutheast";

    fn request(focus: ScoutFocus, elite: bool) -> ScoutRequest {
        ScoutRequest {
            region: REGION.into(),
            focus,
            elite,
        }
    }

    fn trips(
        generator: &Generator<'_>,
        rules: &AcademyRules,
        focus: ScoutFocus,
        count: u64,
    ) -> Vec<ScoutCandidate> {
        (0..count)
            .flat_map(|trip| {
                let key = ScoutKey {
                    account_id: "acc".into(),
                    trip,
                };
                generator
                    .scout_report(&key, &request(focus, false), rules, 2026)
                    .expect("a report")
            })
            .collect()
    }

    fn persisted(candidates: &[ScoutCandidate]) -> serde_json::Value {
        let rows: Vec<_> = candidates
            .iter()
            .map(|c| (domain::persisted::Persisted(&c.player), c.reveal))
            .collect();
        serde_json::to_value(rows).expect("json")
    }

    /// Given one world and one trip key,
    /// when the trip is drawn twice, and another trip once,
    /// then the same key gives the same candidates (ids, names, potentials, offsets), and the
    /// other trip gives others.
    #[test]
    fn the_same_trip_finds_the_same_candidates() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(7, &pack).expect("a generator");
        let rules = AcademyRules::default();
        let key = ScoutKey {
            account_id: "acc".into(),
            trip: 3,
        };
        let ask = || {
            generator
                .scout_report(&key, &request(ScoutFocus::Balanced, true), &rules, 2026)
                .expect("a report")
        };
        let other = generator
            .scout_report(
                &ScoutKey {
                    account_id: "acc".into(),
                    trip: 4,
                },
                &request(ScoutFocus::Balanced, true),
                &rules,
                2026,
            )
            .expect("a report");

        assert_eq!(persisted(&ask()), persisted(&ask()));
        assert_ne!(
            ask()
                .iter()
                .map(|c| c.player.id.clone())
                .collect::<Vec<_>>(),
            other
                .iter()
                .map(|c| c.player.id.clone())
                .collect::<Vec<_>>()
        );
    }

    /// Given 300 trips, some with an elite ticket,
    /// when their candidates are read,
    /// then each trip finds 3–5 (one more with a ticket, always 85 or more); every candidate is
    /// 15 or 16, of a nation the pack names, never named as a protected person, no better than
    /// his age allows nor than his potential less the room his age leaves, and his potential lies
    /// in a band.
    #[test]
    fn every_candidate_keeps_the_academy_s_rules() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(11, &pack).expect("a generator");
        let rules = AcademyRules::default();
        for trip in 0..300u64 {
            let elite = trip % 3 == 0;
            let key = ScoutKey {
                account_id: "acc".into(),
                trip,
            };
            let found = generator
                .scout_report(&key, &request(ScoutFocus::Balanced, elite), &rules, 2026)
                .expect("a report");
            let ordinary = found.len() - usize::from(elite);
            assert!((3..=5).contains(&ordinary), "trip {trip}: {}", found.len());
            if elite {
                let last = &found[found.len() - 1].player;
                assert!(
                    last.potential >= rules.elite_min_potential,
                    "{}",
                    last.potential
                );
            }
            for candidate in &found {
                let player = &candidate.player;
                let age = crate::player_rating::player_age(&player.date_of_birth, 2026);
                assert!((15..=16).contains(&age), "age {age}");
                assert!(pack.names.contains_key(&player.nationality));
                assert!(!is_protected_person(
                    &player.full_name,
                    &pack.blocklist_extra.people
                ));
                assert!(player.ovr <= youth_ovr_ceiling(age));
                assert!(
                    player.ovr + youth_min_growth(age) <= player.potential,
                    "{} / {}",
                    player.ovr,
                    player.potential
                );
                assert!(
                    rules
                        .potential_bands
                        .iter()
                        .any(|band| (band.min..=band.max).contains(&player.potential))
                );
                assert!(player.team_id.is_none());
                assert!(candidate.reveal.ovr_permille < 1_000);
            }
        }
    }

    /// Given 800 trips with each focus,
    /// when the candidates' physical and technical attributes and overalls are averaged,
    /// then a physical focus leans physical, a technical one technical, and the overalls agree
    /// within a point: a focus shapes a youngster, it does not make him better.
    #[test]
    fn a_focus_shapes_the_attributes_not_the_quality() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(5, &pack).expect("a generator");
        let rules = AcademyRules::default();
        let profile = |focus| {
            let found = trips(&generator, &rules, focus, 800);
            let n = found.len() as f64;
            let mean = |pick: &dyn Fn(&Player) -> f64| {
                found.iter().map(|c| pick(&c.player)).sum::<f64>() / n
            };
            (
                mean(&|p| {
                    f64::from(
                        u32::from(p.attributes.pace)
                            + u32::from(p.attributes.stamina)
                            + u32::from(p.attributes.strength)
                            + u32::from(p.attributes.agility),
                    ) / 4.0
                }),
                mean(&|p| {
                    f64::from(
                        u32::from(p.attributes.passing)
                            + u32::from(p.attributes.shooting)
                            + u32::from(p.attributes.dribbling),
                    ) / 3.0
                }),
                mean(&|p| f64::from(p.ovr)),
            )
        };
        let (physical_body, physical_skill, physical_ovr) = profile(ScoutFocus::Physical);
        let (technical_body, technical_skill, technical_ovr) = profile(ScoutFocus::Technical);
        let (_, _, balanced_ovr) = profile(ScoutFocus::Balanced);
        assert!(
            physical_body > technical_body + 2.0,
            "{physical_body} {technical_body}"
        );
        assert!(
            technical_skill > physical_skill + 2.0,
            "{technical_skill} {physical_skill}"
        );
        for ovr in [physical_ovr, technical_ovr] {
            assert!(
                (ovr - balanced_ovr).abs() < 1.0,
                "{ovr} against {balanced_ovr}"
            );
        }
    }

    /// Given 2,000 raw youngsters of every group,
    /// when each is leaned physical and technical,
    /// then his overall moves less than a point (rounding each attribute keeps it from landing
    /// exactly), a fifth of a point on average, with no lean up or down; and pace rises with a
    /// physical focus and falls with a technical one.
    #[test]
    fn leaning_keeps_the_overall() {
        use rand::SeedableRng;

        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(3, &pack).expect("a generator");
        let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(17);
        let mut moves = Vec::new();
        for index in 0..2_000usize {
            let group = GROUPS[index % GROUPS.len()].clone();
            let slots = youth_slots_for_target(Some(group));
            let raw = generate_random_player_from_def(
                "",
                slots[index % slots.len()],
                "VN",
                2026,
                Some(15),
                &generator.names_def,
                &mut rng,
            );
            for focus in [ScoutFocus::Physical, ScoutFocus::Technical] {
                let mut leaned = raw.clone();
                lean(&mut leaned, focus, 80);
                let moved = natural_ovr(&leaned) - natural_ovr(&raw);
                assert!(
                    moved.abs() < 1.0,
                    "{focus:?} moved the overall by {moved:.2}"
                );
                moves.push(moved);
                let pace_up = leaned.attributes.pace >= raw.attributes.pace;
                assert_eq!(
                    pace_up,
                    focus == ScoutFocus::Physical || leaned.attributes.pace == 99
                );
            }
        }
        let n = moves.len() as f64;
        let mean = moves.iter().sum::<f64>() / n;
        let spread = moves.iter().map(|moved| moved.abs()).sum::<f64>() / n;
        assert!(
            mean.abs() < 0.1,
            "the overall leans by {mean:.3} on average"
        );
        assert!(spread < 0.25, "the overall moves {spread:.3} on average");
    }

    /// Given 1,000 trips,
    /// when the candidates' potentials are counted by band,
    /// then each band holds its share within a few percent: nothing after the draw moves a
    /// candidate out of his band, so the table is the true one.
    #[test]
    fn candidates_fall_in_the_bands_the_table_says() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(9, &pack).expect("a generator");
        let rules = AcademyRules::default();
        let found = trips(&generator, &rules, ScoutFocus::Balanced, 1_000);
        let n = found.len() as f64;
        for band in &rules.potential_bands {
            let share = found
                .iter()
                .filter(|c| (band.min..=band.max).contains(&c.player.potential))
                .count() as f64
                / n;
            let expected = f64::from(band.per_mille) / 1_000.0;
            assert!((share - expected).abs() < 0.03, "{band:?}: {share:.3}");
        }
        assert!(
            found
                .iter()
                .all(|c| potential_stars(c.player.potential) >= 1)
        );
    }
}
