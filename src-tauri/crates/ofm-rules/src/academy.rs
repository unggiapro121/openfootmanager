//! The online youth academy's rules (phase 4, E4-1-tech-spec.md §4; PRD mục 7): how rare each
//! potential is, how much of a youngster a coach is shown, and when he graduates. Pure. The
//! candidates themselves come from the online generator
//! ([`crate::worldgen::online::Generator::scout_report`]), because only the world seed may decide
//! them.
//!
//! What a coach sees is a range, never a number. Each candidate carries two secret offsets drawn
//! from the world seed when he is scouted; a range of width `w` around value `v` starts at
//! `v − ⌊offset·w/1000⌋`. With the offsets fixed, a narrower range always lies inside a wider one,
//! so looking again and again shows nothing narrower than the narrowest range already seen.

use std::ops::RangeInclusive;

use domain::player::{Player, Position};
use serde::{Deserialize, Serialize};

use crate::player_rating::{player_age, potential_stars};

/// A band of potential and how often a candidate falls in it, in thousandths.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PotentialBand {
    pub min: u8,
    pub max: u8,
    pub per_mille: u32,
}

/// How wide the ranges shown at one level of knowledge are; 0 shows the value itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealWidth {
    pub ovr: u8,
    pub potential: u8,
}

/// The academy of a season (§4.1). The defaults are a starting point for the measurement E4-2b.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademyRules {
    /// Candidates a scouting trip finds, before the extra one of an elite ticket.
    pub candidates: RangeInclusive<u8>,
    pub ages: RangeInclusive<u8>,
    /// How rare each potential is (§4.4): the table that may be published.
    pub potential_bands: Vec<PotentialBand>,
    /// An elite ticket's candidate comes from the bands at or above this.
    pub elite_min_potential: u8,
    /// How far a scouting focus tilts the physical against the technical attributes, in
    /// thousandths (§4.3).
    pub focus_tilt_permille: u32,
    /// The width of the ranges shown at each level of knowledge, widest first (P4-D26).
    pub reveal_widths: Vec<RevealWidth>,
    pub graduation_age: u8,
    /// Days a youngster spends in the academy at least before he may graduate (P4-D24).
    pub min_academy_days: u32,
}

impl Default for AcademyRules {
    fn default() -> Self {
        let band = |min, max, per_mille| PotentialBand {
            min,
            max,
            per_mille,
        };
        let width = |ovr, potential| RevealWidth { ovr, potential };
        Self {
            candidates: 3..=5,
            ages: 15..=16,
            // OPEN(Qe41-2): E4-2b measures them.
            potential_bands: vec![
                band(50, 64, 450),
                band(65, 74, 330),
                band(75, 84, 170),
                band(85, 89, 40),
                band(90, 95, 10),
            ],
            elite_min_potential: 85,
            focus_tilt_permille: 80,
            // When scouted, after 7 days in the academy, after a season, at graduation (P4-D26).
            reveal_widths: vec![width(10, 20), width(6, 12), width(3, 6), width(0, 0)],
            graduation_age: 17,
            min_academy_days: 14,
        }
    }
}

/// Something wrong with an [`AcademyRules`]: the field and what is wrong with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AcademyIssue {
    pub path: &'static str,
    pub code: &'static str,
}

impl AcademyRules {
    /// What is wrong with these rules; empty when they are sound.
    pub fn validate(&self) -> Vec<AcademyIssue> {
        let mut issues = Vec::new();
        let mut issue = |path, code| issues.push(AcademyIssue { path, code });
        if *self.candidates.start() == 0 || self.candidates.is_empty() {
            issue("candidates", "invalid");
        }
        if self.ages.is_empty() || *self.ages.start() < 14 {
            issue("ages", "invalid");
        }
        let total: u32 = self.potential_bands.iter().map(|band| band.per_mille).sum();
        if total != 1_000 {
            issue("potentialBands", "notAThousand");
        }
        let mut sorted = self.potential_bands.clone();
        sorted.sort_by_key(|band| band.min);
        if sorted
            .iter()
            .any(|band| band.min > band.max || band.min < 40 || band.max > 99)
        {
            issue("potentialBands", "outOfRange");
        }
        if sorted.windows(2).any(|pair| pair[1].min <= pair[0].max) {
            issue("potentialBands", "overlap");
        }
        if self.elite_bands().is_empty() {
            issue("eliteMinPotential", "noEliteBand");
        }
        if self.reveal_widths.is_empty() {
            issue("revealWidths", "empty");
        }
        if self
            .reveal_widths
            .windows(2)
            .any(|pair| pair[1].ovr > pair[0].ovr || pair[1].potential > pair[0].potential)
        {
            issue("revealWidths", "widens");
        }
        issues
    }

    /// The bands an elite ticket's candidate is drawn from.
    pub(crate) fn elite_bands(&self) -> Vec<PotentialBand> {
        self.potential_bands
            .iter()
            .copied()
            .filter(|band| band.min >= self.elite_min_potential && band.per_mille > 0)
            .collect()
    }
}

/// A potential from `bands`, each chosen as often as its share of their total, then a value
/// evenly within it. `None` when no band has a share.
pub(crate) fn draw_potential(bands: &[PotentialBand], rng: &mut impl rand::Rng) -> Option<u8> {
    use rand::RngExt;

    let total: u32 = bands.iter().map(|band| band.per_mille).sum();
    if total == 0 {
        return None;
    }
    let mut pick = rng.random_range(0..total);
    for band in bands {
        if pick < band.per_mille {
            return Some(rng.random_range(band.min..=band.max.max(band.min)));
        }
        pick -= band.per_mille;
    }
    None
}

/// A candidate's two secret offsets, each in 0..1000, drawn when he is scouted and kept by the
/// server beside him. Never sent to a client: with them a range gives the value away.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevealOffsets {
    pub ovr_permille: u16,
    pub potential_permille: u16,
}

/// What a coach is shown of a youngster at one level of knowledge.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Revealed {
    /// Lowest and highest overall it may be.
    pub ovr: (u8, u8),
    /// Lowest and highest potential stars it may be.
    pub stars: (u8, u8),
    /// His grown height, shown as it is.
    pub height_cm: u16,
    pub nationality: String,
    pub position: Position,
}

/// The range of width `width` shown for `value`, cut (never shifted) to 1–99 so ranges stay nested.
fn range_of(value: u8, offset_permille: u16, width: u8) -> (u8, u8) {
    let below = u32::from(offset_permille.min(999)) * u32::from(width) / 1_000;
    let low = i32::from(value) - i32::try_from(below).unwrap_or(0);
    let high = low + i32::from(width);
    let cut = |bound: i32| u8::try_from(bound.clamp(1, 99)).unwrap_or(1);
    (cut(low), cut(high))
}

/// What a coach sees of `player` at knowledge `level` (§4.5): his overall and potential stars as
/// ranges, his height, nationality and position as they are. A level past the last width shows
/// the last.
pub fn reveal(
    player: &Player,
    offsets: &RevealOffsets,
    level: u8,
    rules: &AcademyRules,
) -> Revealed {
    let width = rules
        .reveal_widths
        .get(usize::from(level))
        .or(rules.reveal_widths.last())
        .copied()
        .unwrap_or(RevealWidth {
            ovr: 0,
            potential: 0,
        });
    let potential = range_of(
        player.potential,
        offsets.potential_permille,
        width.potential,
    );
    Revealed {
        ovr: range_of(player.ovr, offsets.ovr_permille, width.ovr),
        stars: (potential_stars(potential.0), potential_stars(potential.1)),
        height_cm: player.height_cm,
        nationality: player.nationality.clone(),
        position: player.natural_position.clone(),
    }
}

/// A date of birth whose year cannot be read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BadBirthDate;

/// Whether a youngster born on `date_of_birth`, `days_in_academy` days in the academy, graduates at
/// the season end that starts `football_year` (§4.7): old enough by the same measure he was
/// generated with ([`player_age`], the year subtracted), and long enough in the academy. A year
/// that cannot be read is an error, never guessed.
pub fn graduates(
    date_of_birth: &str,
    football_year: u32,
    days_in_academy: u32,
    rules: &AcademyRules,
) -> Result<bool, BadBirthDate> {
    let year = date_of_birth.split('-').next().unwrap_or_default();
    if year.len() != 4 || year.parse::<u32>().is_err() {
        return Err(BadBirthDate);
    }
    Ok(
        player_age(date_of_birth, football_year) >= u32::from(rules.graduation_age)
            && days_in_academy >= rules.min_academy_days,
    )
}

#[cfg(test)]
mod tests {
    use rand::SeedableRng;
    use rand_chacha::ChaCha8Rng;

    use super::*;

    /// Given the default rules and rules wrong in each way validation knows,
    /// when they are validated,
    /// then the defaults are sound and each fault is named.
    #[test]
    fn validation_names_each_unsound_rule() {
        assert!(AcademyRules::default().validate().is_empty());
        let codes = |rules: AcademyRules| -> Vec<&'static str> {
            rules.validate().iter().map(|issue| issue.code).collect()
        };
        let base = AcademyRules::default;
        let mut bands = base().potential_bands;
        bands[0].per_mille += 1;
        assert_eq!(
            codes(AcademyRules {
                potential_bands: bands,
                ..base()
            }),
            vec!["notAThousand"]
        );
        let mut overlap = base().potential_bands;
        overlap[1].min = 60;
        assert_eq!(
            codes(AcademyRules {
                potential_bands: overlap,
                ..base()
            }),
            vec!["overlap"]
        );
        assert_eq!(
            codes(AcademyRules {
                elite_min_potential: 96,
                ..base()
            }),
            vec!["noEliteBand"]
        );
        let widens = vec![
            RevealWidth {
                ovr: 4,
                potential: 8,
            },
            RevealWidth {
                ovr: 6,
                potential: 8,
            },
        ];
        assert_eq!(
            codes(AcademyRules {
                reveal_widths: widens,
                ..base()
            }),
            vec!["widens"]
        );
        assert_eq!(
            codes(AcademyRules {
                candidates: 0..=3,
                ..base()
            }),
            vec!["invalid"]
        );
    }

    /// Given the default bands and 100,000 draws,
    /// when the draws are counted by band, and 100,000 elite draws likewise,
    /// then each band holds its share within a few thousandths, every value lies in a band, and
    /// elite draws are all 85 or more, split 800 to 200.
    #[test]
    fn potentials_fall_in_the_bands_as_often_as_the_table_says() {
        let rules = AcademyRules::default();
        let mut rng = ChaCha8Rng::seed_from_u64(41);
        let count = |bands: &[PotentialBand], rng: &mut ChaCha8Rng| -> Vec<u32> {
            let mut counts = vec![0u32; bands.len()];
            for _ in 0..100_000 {
                let potential = draw_potential(bands, rng).expect("a potential");
                let band = bands
                    .iter()
                    .position(|band| (band.min..=band.max).contains(&potential))
                    .expect("in a band");
                counts[band] += 1;
            }
            counts
        };
        let counts = count(&rules.potential_bands, &mut rng);
        for (band, counted) in rules.potential_bands.iter().zip(counts) {
            let expected = f64::from(band.per_mille) * 100.0;
            assert!(
                (f64::from(counted) - expected).abs() < 600.0,
                "{band:?}: {counted}"
            );
        }
        let elite = rules.elite_bands();
        let counts = count(&elite, &mut rng);
        assert!(
            (f64::from(counts[0]) - 80_000.0).abs() < 1_000.0,
            "{counts:?}"
        );
        assert!(
            (f64::from(counts[1]) - 20_000.0).abs() < 1_000.0,
            "{counts:?}"
        );
    }

    fn youngster(ovr: u8, potential: u8) -> Player {
        let attributes = domain::player::PlayerAttributes {
            pace: 50,
            stamina: 50,
            strength: 50,
            agility: 50,
            passing: 50,
            shooting: 50,
            tackling: 50,
            dribbling: 50,
            defending: 50,
            positioning: 50,
            vision: 50,
            decisions: 50,
            composure: 50,
            aggression: 50,
            teamwork: 50,
            leadership: 50,
            handling: 20,
            reflexes: 20,
            aerial: 50,
            long_passing: 0,
            crossing: 0,
            curve: 0,
            free_kick: 0,
            long_shots: 0,
            first_touch: 0,
            heading: 0,
        };
        let mut player = Player::new(
            "y1".to_string(),
            "A".to_string(),
            "A B".to_string(),
            "2010-03-01".to_string(),
            "VN".to_string(),
            Position::Midfielder,
            attributes,
        );
        player.ovr = ovr;
        player.potential = potential;
        player.height_cm = 181;
        player
    }

    /// Given youngsters with values near 1, in the middle and near 99, and every offset,
    /// when their ranges are shown at each level,
    /// then every range holds the true value, each narrower range lies inside the wider one, the
    /// same offsets give the same range, a level past the last shows the last, and width 0 shows
    /// the value itself.
    #[test]
    fn ranges_hold_the_value_and_nest_level_by_level() {
        let rules = AcademyRules::default();
        for value in [1u8, 3, 42, 70, 97, 99] {
            for offset in (0..1_000).step_by(37) {
                let offsets = RevealOffsets {
                    ovr_permille: offset,
                    potential_permille: 999 - offset,
                };
                let player = youngster(value, value);
                let shown: Vec<Revealed> = (0..=4)
                    .map(|level| reveal(&player, &offsets, level, &rules))
                    .collect();
                for revealed in &shown {
                    assert!(
                        revealed.ovr.0 <= value && value <= revealed.ovr.1,
                        "{value} {offset}"
                    );
                }
                for pair in shown.windows(2) {
                    assert!(pair[0].ovr.0 <= pair[1].ovr.0 && pair[1].ovr.1 <= pair[0].ovr.1);
                    assert!(
                        pair[0].stars.0 <= pair[1].stars.0 && pair[1].stars.1 <= pair[0].stars.1
                    );
                }
                assert_eq!(shown[3].ovr, (value, value));
                assert_eq!(shown[4], shown[3]);
                assert_eq!(reveal(&player, &offsets, 1, &rules), shown[1]);
            }
        }
        let shown = reveal(
            &youngster(48, 82),
            &RevealOffsets {
                ovr_permille: 500,
                potential_permille: 500,
            },
            0,
            &rules,
        );
        assert_eq!(shown.ovr, (43, 53));
        assert_eq!(shown.stars, (3, 5));
        assert_eq!(shown.height_cm, 181);
    }

    /// Given youngsters born in 2010 and 2011 and a broken date,
    /// when the season end starting 2027 asks who graduates,
    /// then the 2010-born (17) with 14 days does, with 13 days does not, the 2011-born (16) does
    /// not, and the broken date is an error, not a guess.
    #[test]
    fn a_youngster_graduates_at_seventeen_after_his_days_in_the_academy() {
        let rules = AcademyRules::default();
        assert_eq!(graduates("2010-11-30", 2027, 14, &rules), Ok(true));
        assert_eq!(graduates("2010-11-30", 2027, 13, &rules), Ok(false));
        assert_eq!(graduates("2011-01-01", 2027, 40, &rules), Ok(false));
        assert_eq!(graduates("2011-01-01", 2028, 40, &rules), Ok(true));
        assert_eq!(graduates("born", 2027, 40, &rules), Err(BadBirthDate));
    }

    /// Given the default rules,
    /// when they go to JSON and back,
    /// then they are the same, in camelCase.
    #[test]
    fn the_rules_travel_as_camel_case_json() {
        let json = serde_json::to_value(AcademyRules::default()).expect("serialises");
        assert_eq!(json["graduationAge"], 17);
        assert_eq!(json["potentialBands"][4]["perMille"], 10);
        let back: AcademyRules = serde_json::from_value(json).expect("deserialises");
        assert_eq!(back, AcademyRules::default());
    }
}
