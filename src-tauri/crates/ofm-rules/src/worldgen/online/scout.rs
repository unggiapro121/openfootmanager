//! A youth scout's trip online (phase 4, E4-1-tech-spec.md §4.2–§4.4): 15- and 16-year-old
//! candidates drawn from the world seed by the key `scout/<account>/<trip>`, named from the online
//! pack like every online person. Their potential is drawn from the academy's bands and is final:
//! the attributes are brought down to fit it, so the published table is the true one.
//!
//! The draws come in a fixed order; changing it changes the candidates and needs a new
//! `WORLD_RULES_VERSION` (`tests/scout_rules.rs` pins it).

use domain::player::{Player, SquadRole};
use rand::RngExt;
use serde::{Deserialize, Serialize};

use super::{GenError, Generator};
pub use crate::academy::ScoutLine;
use crate::academy::{AcademyRules, RevealOffsets, draw_potential};
use crate::player_rating::natural_ovr;
use crate::seed::rng_for_seed;
use crate::worldgen::attribute_shape::{REFERENCE_OVR, shift_to_level};
use crate::worldgen::calibration::calibrate_to_ovr;
use crate::worldgen::generation::{generate_player_at, youth_slots_for_target};
use crate::worldgen::youth::{settle_youngster, youth_level, youth_min_growth};

/// Whose trip and which: the stream `scout/<account>/<trip>`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutKey {
    pub account_id: String,
    pub trip: u64,
}

/// What a scout looks for, and from where.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoutRequest {
    /// The club's own region: most candidates come from it, the rest (`foreignPermille`) from
    /// the others (E5-10 §16.2).
    pub region: String,
    /// The line the trip looks for; every candidate, the elite one too, plays in it.
    pub line: ScoutLine,
    /// An elite ticket: one more candidate, from the bands at or above `eliteMinPotential`.
    pub elite: bool,
}

/// A candidate, and the secret offsets of the ranges a coach is shown of him.
#[derive(Debug, Clone)]
pub struct ScoutCandidate {
    pub player: Player,
    pub reveal: RevealOffsets,
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
            // 1. nationality: from the club's region, or now and then from another one, then by
            //    the free agents' path
            let region = if rng.random_range(0..1_000) < rules.foreign_permille {
                self.draw_region_except(&request.region, &mut rng)
            } else {
                request.region.clone()
            };
            let (local, _) = self.nation_of(&region, rng.random_range(0..10_000))?;
            let nation = self.nationality(&region, &local)?.draw(&mut rng);
            // 2. his position, of the line the trip looks for, and a youth slot of its group
            let position = rules
                .draw_position(request.line, &mut rng)
                .ok_or(GenError::NoPosition { line: request.line })?;
            let slot = youth_slots_for_target(Some(position.to_group_position()))[0];
            // 3. age
            let age = u32::from(rng.random_range(rules.ages.clone()));
            // 4. the raw player at that position (his id from the stream)
            let mut player = generate_player_at(
                "",
                slot,
                Some(position),
                &nation,
                football_year,
                Some(age),
                &self.names_def,
                &mut rng,
            );
            player.team_id = None;
            player.squad_role = SquadRole::Youth;
            // 5. the potential, final
            let potential = draw_potential(bands, &mut rng).unwrap_or(rules.elite_min_potential);
            // 6. brought to the level of his age, as the desktop's youngsters are, and under his
            //    potential less the room his age leaves
            let room = f64::from(potential.saturating_sub(youth_min_growth(age))) - 0.5;
            let target = youth_level(age, &mut rng).min(room);
            calibrate_to_ovr(&mut player, target);
            // The calibration's last fit adds by the weights of his primary position while his
            // overall is read at his natural one, so it can stop over the target. The potential
            // is final: the excess comes off every attribute by his natural position's slopes.
            for _ in 0..6 {
                let excess = natural_ovr(&player) - target;
                if excess < 0.5 {
                    break;
                }
                shift_to_level(&mut player, REFERENCE_OVR - excess);
            }
            player.potential = potential;
            // 7. the secret offsets of what a coach is shown
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
    use std::collections::BTreeMap;

    use domain::player::Position;

    use super::*;
    use crate::academy::PositionWeight;
    use crate::player_rating::potential_stars;
    use crate::worldgen::online::OnlineContentPack;
    use crate::worldgen::online::names::is_protected_person;

    const REGION: &str = "AsiaSoutheast";

    fn request(line: ScoutLine, elite: bool) -> ScoutRequest {
        ScoutRequest {
            region: REGION.into(),
            line,
            elite,
        }
    }

    fn trips(
        generator: &Generator<'_>,
        rules: &AcademyRules,
        line: ScoutLine,
        count: u64,
    ) -> Vec<ScoutCandidate> {
        (0..count)
            .flat_map(|trip| {
                let key = ScoutKey {
                    account_id: "acc".into(),
                    trip,
                };
                generator
                    .scout_report(&key, &request(line, trip % 4 == 0), rules, 2026)
                    .expect("a report")
            })
            .collect()
    }

    /// Each position's share of `found`.
    fn shares(found: &[ScoutCandidate]) -> BTreeMap<String, f64> {
        let mut counts = BTreeMap::new();
        for candidate in found {
            *counts
                .entry(format!("{:?}", candidate.player.natural_position))
                .or_insert(0.0) += 1.0;
        }
        let n = found.len() as f64;
        counts.values_mut().for_each(|count| *count /= n);
        counts
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
    /// then the same key gives the same candidates (ids, names, positions, potentials, offsets),
    /// and the other trip gives others.
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
                .scout_report(&key, &request(ScoutLine::Any, true), &rules, 2026)
                .expect("a report")
        };
        let other = generator
            .scout_report(
                &ScoutKey {
                    account_id: "acc".into(),
                    trip: 4,
                },
                &request(ScoutLine::Any, true),
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

    /// Given 300 trips, some with an elite ticket, each line in turn,
    /// when their candidates are read,
    /// then each trip finds 3–5 (one more with a ticket, always 85 or more); every candidate is
    /// 15 or 16, of a nation the pack names, never named as a protected person, no better than
    /// his age allows nor than his potential less the room his age leaves, his potential lies
    /// in a band, and he plays a detailed position of the trip's line from the start, with no
    /// group among the others he can play.
    #[test]
    fn every_candidate_keeps_the_academy_s_rules() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(11, &pack).expect("a generator");
        let rules = AcademyRules::default();
        let lines = [
            ScoutLine::Any,
            ScoutLine::Goalkeeper,
            ScoutLine::Defender,
            ScoutLine::Midfielder,
            ScoutLine::Forward,
        ];
        for trip in 0..300u64 {
            let elite = trip % 3 == 0;
            let line = lines[(trip % 5) as usize];
            let key = ScoutKey {
                account_id: "acc".into(),
                trip,
            };
            let found = generator
                .scout_report(&key, &request(line, elite), &rules, 2026)
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
                assert!(player.ovr <= crate::worldgen::youth::youth_ovr_ceiling(age));
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
                assert!(
                    line.admits(&player.natural_position),
                    "{line:?}: {player:?}"
                );
                assert!(
                    !player.natural_position.is_legacy_bucket()
                        || player.natural_position == Position::Goalkeeper
                );
                assert_eq!(player.position, player.natural_position.to_group_position());
                assert!(
                    player
                        .alternate_positions
                        .iter()
                        .all(|p| !p.is_legacy_bucket() || *p == Position::Goalkeeper),
                    "{:?}",
                    player.alternate_positions
                );
                match player.natural_position {
                    Position::LeftBack | Position::LeftMidfielder | Position::LeftWinger => {
                        assert_eq!(player.footedness, domain::player::Footedness::Left)
                    }
                    Position::RightBack | Position::RightMidfielder | Position::RightWinger => {
                        assert_eq!(player.footedness, domain::player::Footedness::Right)
                    }
                    _ => {}
                }
            }
        }
    }

    /// Given 1,000 trips looking for any line (over 4,000 candidates),
    /// when their positions are counted,
    /// then each position holds its share of the default table within 2 points, keepers no more
    /// than 11 %, every position with a share turns up, and no wing-back does (E5-10 §3.2).
    #[test]
    fn positions_follow_the_table() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(7, &pack).expect("a generator");
        let rules = AcademyRules::default();
        let found = trips(&generator, &rules, ScoutLine::Any, 1_000);
        assert!(found.len() >= 4_000, "{}", found.len());
        let shares = shares(&found);
        for weight in &rules.position_weights {
            let share = shares
                .get(&format!("{:?}", weight.position))
                .copied()
                .unwrap_or(0.0);
            let expected = f64::from(weight.per_mille) / 1_000.0;
            assert!(
                (share - expected).abs() < 0.02,
                "{:?}: {share:.3} against {expected:.3}",
                weight.position
            );
            assert_eq!(share > 0.0, weight.per_mille > 0, "{:?}", weight.position);
        }
        assert!(shares["Goalkeeper"] <= 0.11);
    }

    /// Given 1,000 trips for each line, every fourth with an elite ticket,
    /// when their candidates are read,
    /// then every one, the elite one too, plays in the line, and each position holds its share
    /// of the line (`line_shares`) within 2.5 points.
    #[test]
    fn a_trip_finds_only_the_line_it_looks_for() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(13, &pack).expect("a generator");
        let rules = AcademyRules::default();
        for line in ScoutLine::LINES {
            let found = trips(&generator, &rules, line, 1_000);
            assert!(
                found
                    .iter()
                    .all(|c| line.admits(&c.player.natural_position))
            );
            let shares = shares(&found);
            for (position, per_mille) in rules.line_shares(line) {
                let share = shares.get(&format!("{position:?}")).copied().unwrap_or(0.0);
                let expected = f64::from(per_mille) / 1_000.0;
                assert!(
                    (share - expected).abs() < 0.025,
                    "{line:?} {position:?}: {share:.3} against {expected:.3}"
                );
            }
        }
    }

    /// Given tables of keepers only, of centre-backs and strikers only, and one whose forwards
    /// have no share,
    /// when trips look for any line, and for forwards,
    /// then only those positions come, and a line without a share is an error, not a guess.
    #[test]
    fn a_custom_table_decides_the_positions() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(3, &pack).expect("a generator");
        let table = |weights: &[(Position, u32)]| AcademyRules {
            position_weights: weights
                .iter()
                .map(|(position, per_mille)| PositionWeight {
                    position: position.clone(),
                    per_mille: *per_mille,
                })
                .collect(),
            ..AcademyRules::default()
        };
        let keepers = table(&[(Position::Goalkeeper, 1_000)]);
        assert!(
            trips(&generator, &keepers, ScoutLine::Any, 50)
                .iter()
                .all(|c| c.player.natural_position == Position::Goalkeeper)
        );
        let two = table(&[(Position::CenterBack, 500), (Position::Striker, 500)]);
        let found = trips(&generator, &two, ScoutLine::Any, 100);
        assert!(found.iter().all(|c| matches!(
            c.player.natural_position,
            Position::CenterBack | Position::Striker
        )));
        let shares = shares(&found);
        assert!(shares["CenterBack"] > 0.35 && shares["Striker"] > 0.35);
        let key = ScoutKey {
            account_id: "acc".into(),
            trip: 0,
        };
        assert_eq!(
            generator
                .scout_report(&key, &request(ScoutLine::Forward, false), &keepers, 2026)
                .map(|found| found.len()),
            Err(GenError::NoPosition {
                line: ScoutLine::Forward
            })
        );
    }

    /// Given a club in South-East Asia and trips with no candidate from elsewhere, all from
    /// elsewhere, and the default 200 in a thousand,
    /// when the candidates' nations are counted against the region's own,
    /// then with none from elsewhere they are the region's people as a club of it draws them,
    /// with all from elsewhere none is of the club's region by that path, and the default lies
    /// 80/20 between the two within 2 points.
    #[test]
    fn most_candidates_come_from_the_club_s_region() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(17, &pack).expect("a generator");
        let own: Vec<&String> = pack.regions[REGION]
            .nations
            .iter()
            .map(|(code, _)| code)
            .collect();
        let local_share = |foreign_permille: u32| {
            let rules = AcademyRules {
                foreign_permille,
                ..AcademyRules::default()
            };
            let found = trips(&generator, &rules, ScoutLine::Any, 1_000);
            found
                .iter()
                .filter(|c| own.contains(&&c.player.nationality))
                .count() as f64
                / found.len() as f64
        };
        let home = local_share(0);
        let away = local_share(1_000);
        let default = local_share(AcademyRules::default().foreign_permille);
        assert!(home > 0.85, "{home}");
        assert!(away < 0.10, "{away}");
        let expected = 0.8 * home + 0.2 * away;
        assert!(
            (default - expected).abs() < 0.02,
            "{default:.3} against {expected:.3}"
        );
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
        let found: Vec<ScoutCandidate> = (0..1_000u64)
            .flat_map(|trip| {
                let key = ScoutKey {
                    account_id: "acc".into(),
                    trip,
                };
                generator
                    .scout_report(&key, &request(ScoutLine::Any, false), &rules, 2026)
                    .expect("a report")
            })
            .collect();
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
