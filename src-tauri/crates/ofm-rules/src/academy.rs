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

/// A detailed position and how often a scouted candidate plays it, in thousandths (E5-10).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionWeight {
    pub position: Position,
    pub per_mille: u32,
}

/// The line a scout looks for (E5-10 §16.2): one of the four, or any.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ScoutLine {
    Goalkeeper,
    Defender,
    Midfielder,
    Forward,
    Any,
}

impl ScoutLine {
    /// The four lines a player can be of, in the order a tie between them is broken.
    pub const LINES: [ScoutLine; 4] = [
        ScoutLine::Goalkeeper,
        ScoutLine::Defender,
        ScoutLine::Midfielder,
        ScoutLine::Forward,
    ];

    /// The line `position` belongs to.
    pub fn of(position: &Position) -> ScoutLine {
        match position.to_group_position() {
            Position::Goalkeeper => ScoutLine::Goalkeeper,
            Position::Defender => ScoutLine::Defender,
            Position::Midfielder => ScoutLine::Midfielder,
            _ => ScoutLine::Forward,
        }
    }

    /// Whether a player at `position` is what this line looks for.
    pub fn admits(self, position: &Position) -> bool {
        self == ScoutLine::Any || ScoutLine::of(position) == self
    }
}

/// How often each detailed position is scouted when a ruleset says nothing (E5-10 §3.2), in
/// thousandths: the shares an eleven needs, the wide midfielders a little over. Wing-backs come
/// as full-backs. The free agents' pool is drawn from the same table
/// ([`crate::worldgen::online::FREE_AGENT_POSITION_WEIGHTS`]).
pub const DEFAULT_POSITION_WEIGHTS: [(Position, u32); 14] = [
    (Position::Goalkeeper, 90),
    (Position::CenterBack, 190),
    (Position::LeftBack, 80),
    (Position::RightBack, 80),
    (Position::DefensiveMidfielder, 80),
    (Position::CentralMidfielder, 110),
    (Position::AttackingMidfielder, 70),
    (Position::LeftMidfielder, 40),
    (Position::RightMidfielder, 40),
    (Position::LeftWinger, 60),
    (Position::RightWinger, 60),
    (Position::Striker, 100),
    (Position::LeftWingBack, 0),
    (Position::RightWingBack, 0),
];

fn default_position_weights() -> Vec<PositionWeight> {
    DEFAULT_POSITION_WEIGHTS
        .iter()
        .map(|(position, per_mille)| PositionWeight {
            position: position.clone(),
            per_mille: *per_mille,
        })
        .collect()
}

fn default_foreign_permille() -> u32 {
    200
}

/// A position from `weights`, those of `line` only, each as often as its share of their total.
/// `None` when none of them has a share.
pub(crate) fn draw_position<'a>(
    weights: impl Iterator<Item = (&'a Position, u32)> + Clone,
    line: ScoutLine,
    rng: &mut impl rand::Rng,
) -> Option<Position> {
    use rand::RngExt;

    let of_line = weights.filter(|(position, _)| line.admits(position));
    let total: u32 = of_line.clone().map(|(_, per_mille)| per_mille).sum();
    if total == 0 {
        return None;
    }
    let mut pick = rng.random_range(0..total);
    for (position, per_mille) in of_line {
        if pick < per_mille {
            return Some(position.clone());
        }
        pick -= per_mille;
    }
    None
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
    /// How often each detailed position is scouted (E5-10), filtered by the line a trip looks
    /// for. Missing: [`DEFAULT_POSITION_WEIGHTS`].
    #[serde(default = "default_position_weights")]
    pub position_weights: Vec<PositionWeight>,
    /// How many candidates in a thousand come from a region other than the club's (E5-10 §16.2).
    #[serde(default = "default_foreign_permille")]
    pub foreign_permille: u32,
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
            position_weights: default_position_weights(),
            foreign_permille: default_foreign_permille(),
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
        self.validate_positions(&mut issue);
        if self.foreign_permille > 1_000 {
            issue("foreignPermille", "outOfRange");
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

    /// What is wrong with `positionWeights` (E5-10 §3.3, §16.2).
    fn validate_positions(&self, issue: &mut impl FnMut(&'static str, &'static str)) {
        let weights = &self.position_weights;
        let path = "positionWeights";
        if weights.iter().map(|weight| weight.per_mille).sum::<u32>() != 1_000 {
            issue(path, "notAThousand");
        }
        if weights.iter().any(|weight| {
            weight.position.is_legacy_bucket() && weight.position != Position::Goalkeeper
        }) {
            issue(path, "notDetailed");
        }
        if weights.iter().enumerate().any(|(at, weight)| {
            weights[..at]
                .iter()
                .any(|earlier| earlier.position == weight.position)
        }) {
            issue(path, "duplicate");
        }
        let line_total = |line: ScoutLine| -> u32 {
            weights
                .iter()
                .filter(|weight| line.admits(&weight.position))
                .map(|weight| weight.per_mille)
                .sum()
        };
        if line_total(ScoutLine::Goalkeeper) == 0 {
            issue(path, "noGoalkeeper");
        }
        if ScoutLine::LINES[1..]
            .iter()
            .any(|line| line_total(*line) == 0)
        {
            issue(path, "emptyLine");
        }
    }

    /// The positions a trip looking for `line` finds and how often, in thousandths of that
    /// line (E5-10 §16.2), for a coach to be shown: those with a share, in the table's order,
    /// summing to 1,000 with the rounding's remainder on the largest. Empty when the line has
    /// none.
    pub fn line_shares(&self, line: ScoutLine) -> Vec<(Position, u32)> {
        let of_line: Vec<&PositionWeight> = self
            .position_weights
            .iter()
            .filter(|weight| weight.per_mille > 0 && line.admits(&weight.position))
            .collect();
        let total: u32 = of_line.iter().map(|weight| weight.per_mille).sum();
        if total == 0 {
            return Vec::new();
        }
        let mut shares: Vec<(Position, u32)> = of_line
            .iter()
            .map(|weight| {
                let share =
                    (u64::from(weight.per_mille) * 1_000 + u64::from(total) / 2) / u64::from(total);
                (
                    weight.position.clone(),
                    u32::try_from(share).unwrap_or(1_000),
                )
            })
            .collect();
        let sum: i64 = shares.iter().map(|(_, share)| i64::from(*share)).sum();
        if let Some(largest) = (0..shares.len()).max_by_key(|at| (shares[*at].1, usize::MAX - at)) {
            let fixed = i64::from(shares[largest].1) + 1_000 - sum;
            shares[largest].1 = u32::try_from(fixed.max(0)).unwrap_or(0);
        }
        shares
    }

    /// A detailed position for a candidate of a trip looking for `line`, from
    /// `positionWeights`. `None` when the line has no share (rules that fail validation).
    pub(crate) fn draw_position(
        &self,
        line: ScoutLine,
        rng: &mut impl rand::Rng,
    ) -> Option<Position> {
        draw_position(
            self.position_weights
                .iter()
                .map(|weight| (&weight.position, weight.per_mille)),
            line,
            rng,
        )
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
        assert_eq!(
            codes(AcademyRules {
                foreign_permille: 1_001,
                ..base()
            }),
            vec!["outOfRange"]
        );
    }

    fn weights(table: &[(Position, u32)]) -> Vec<PositionWeight> {
        table
            .iter()
            .map(|(position, per_mille)| PositionWeight {
                position: position.clone(),
                per_mille: *per_mille,
            })
            .collect()
    }

    /// Given the default table and tables wrong in each way (E5-10 §3.3, §16.2),
    /// when the rules are validated,
    /// then the defaults are sound, a wing-back at 0 is allowed, and each fault is named on
    /// `positionWeights`.
    #[test]
    fn validation_names_each_unsound_position_table() {
        let issues = |table: Vec<PositionWeight>| -> Vec<(&'static str, &'static str)> {
            AcademyRules {
                position_weights: table,
                ..AcademyRules::default()
            }
            .validate()
            .iter()
            .map(|issue| (issue.path, issue.code))
            .collect()
        };
        let path = "positionWeights";
        let mut table = DEFAULT_POSITION_WEIGHTS.to_vec();
        assert!(issues(weights(&table)).is_empty());
        assert_eq!(table[12], (Position::LeftWingBack, 0));

        table[0].1 -= 1;
        assert_eq!(issues(weights(&table)), vec![(path, "notAThousand")]);

        let mut grouped = DEFAULT_POSITION_WEIGHTS.to_vec();
        grouped[5].0 = Position::Midfielder;
        assert_eq!(issues(weights(&grouped)), vec![(path, "notDetailed")]);

        let mut twice = DEFAULT_POSITION_WEIGHTS.to_vec();
        twice[2] = (Position::CenterBack, 80);
        assert_eq!(issues(weights(&twice)), vec![(path, "duplicate")]);

        let mut keeperless = DEFAULT_POSITION_WEIGHTS.to_vec();
        keeperless[1].1 += keeperless[0].1;
        keeperless[0].1 = 0;
        assert_eq!(issues(weights(&keeperless)), vec![(path, "noGoalkeeper")]);

        let no_forwards = weights(&[
            (Position::Goalkeeper, 300),
            (Position::CenterBack, 400),
            (Position::CentralMidfielder, 300),
            (Position::Striker, 0),
        ]);
        assert_eq!(issues(no_forwards), vec![(path, "emptyLine")]);
    }

    /// Given the default table,
    /// when each line's shares are asked for,
    /// then they hold the line's positions with a share, in the table's order, and sum to
    /// 1,000; defenders are 542/229/229 (190, 80, 80 of 350, the rounding's extra thousandth off
    /// the centre-backs), and any line is the whole table.
    #[test]
    fn a_line_s_shares_sum_to_a_thousand() {
        let rules = AcademyRules::default();
        for line in ScoutLine::LINES.into_iter().chain([ScoutLine::Any]) {
            let shares = rules.line_shares(line);
            assert_eq!(
                shares.iter().map(|(_, s)| s).sum::<u32>(),
                1_000,
                "{line:?}"
            );
            assert!(
                shares
                    .iter()
                    .all(|(position, share)| { *share > 0 && line.admits(position) })
            );
        }
        assert_eq!(
            rules.line_shares(ScoutLine::Defender),
            vec![
                (Position::CenterBack, 542),
                (Position::LeftBack, 229),
                (Position::RightBack, 229),
            ]
        );
        assert_eq!(
            rules.line_shares(ScoutLine::Goalkeeper),
            vec![(Position::Goalkeeper, 1_000)]
        );
        assert_eq!(rules.line_shares(ScoutLine::Any).len(), 12);
        assert_eq!(ScoutLine::of(&Position::LeftWingBack), ScoutLine::Defender);
        assert_eq!(ScoutLine::of(&Position::RightWinger), ScoutLine::Forward);
        assert!(ScoutLine::Any.admits(&Position::Goalkeeper));
        assert!(!ScoutLine::Midfielder.admits(&Position::Striker));
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
        assert_eq!(json["positionWeights"][1]["position"], "CenterBack");
        assert_eq!(json["positionWeights"][1]["perMille"], 190);
        assert_eq!(json["foreignPermille"], 200);
        let back: AcademyRules = serde_json::from_value(json).expect("deserialises");
        assert_eq!(back, AcademyRules::default());
    }

    /// Given the academy of the play world's ruleset v11, written before E5-10 (no
    /// `positionWeights` nor `foreignPermille`, and the old `focusTiltPermille`),
    /// when it is read,
    /// then it reads, with the default table and 200 in a thousand from elsewhere.
    #[test]
    fn an_academy_written_before_e5_10_reads_with_the_defaults() {
        let v11 = serde_json::json!({
            "ages": {"end": 16, "start": 15}, "candidates": {"end": 5, "start": 3},
            "eliteMinPotential": 85, "focusTiltPermille": 80, "graduationAge": 17,
            "minAcademyDays": 14,
            "potentialBands": [
                {"max": 64, "min": 50, "perMille": 450}, {"max": 74, "min": 65, "perMille": 330},
                {"max": 84, "min": 75, "perMille": 170}, {"max": 89, "min": 85, "perMille": 40},
                {"max": 95, "min": 90, "perMille": 10}],
            "revealWidths": [{"ovr": 10, "potential": 20}, {"ovr": 6, "potential": 12},
                {"ovr": 3, "potential": 6}, {"ovr": 0, "potential": 0}]
        });
        let rules: AcademyRules = serde_json::from_value(v11).expect("reads");
        assert_eq!(rules, AcademyRules::default());
    }
}
