//! What each level of a club's facilities does, in one place: the game reads
//! its effects from here, and the upgrade dialog shows the same numbers.
//!
//! `k` below is the level above the first (`level − 1`), 0 to 9.

use domain::team::{Facilities, FacilityType, Team};
use serde::Serialize;

/// No facility goes past this level.
pub const MAX_FACILITY_LEVEL: u8 = 10;

fn steps(level: u8) -> u32 {
    u32::from(level.clamp(1, MAX_FACILITY_LEVEL) - 1)
}

/// The level of one of a club's facilities.
pub fn level_of(facilities: &Facilities, facility: &FacilityType) -> u8 {
    match facility {
        FacilityType::Training => facilities.training,
        FacilityType::Medical => facilities.medical,
        FacilityType::Scouting => facilities.scouting,
    }
}

// --- Medical -----------------------------------------------------------------

/// The medical level that looks after a player of `team_id`: the club he trains
/// and plays with, so a loanee is treated by the club borrowing him. A player
/// without a club gets level 1.
pub fn medical_level_at(teams: &[Team], team_id: Option<&str>) -> u8 {
    team_id
        .and_then(|id| teams.iter().find(|team| team.id == id))
        .map_or(1, |team| team.facilities.medical)
}

/// How much faster players get their condition back each day: ×(1 + 0.1·k).
pub fn condition_recovery_mult(level: u8) -> f64 {
    1.0 + f64::from(steps(level)) * 0.1
}

/// Percent taken off the days out of a new injury: 4 per level above the first.
pub fn injury_days_cut_percent(level: u8) -> u32 {
    4 * steps(level)
}

/// The days an injury of `days` keeps a player out at a club with medical
/// `level`: shortened by [`injury_days_cut_percent`], rounded up, at least one.
pub fn injury_days(days: u32, level: u8) -> u32 {
    let keep = 100 - injury_days_cut_percent(level);
    (days * keep).div_ceil(100).max(1)
}

/// The light / medium / serious shares of match injuries, in percent, at
/// medical `level`: medium ×(1 − 0.03·k), serious ×(1 − 0.05·k), the rest light.
/// A player short of match fitness has his medium and serious shares raised
/// half as much again, out of the light one.
pub fn match_injury_tier_shares(level: u8, unfit: bool) -> [f64; 3] {
    let k = f64::from(steps(level));
    let unfit_mult = if unfit { 1.5 } else { 1.0 };
    let medium = 30.0 * (1.0 - 0.03 * k) * unfit_mult;
    let serious = 10.0 * (1.0 - 0.05 * k) * unfit_mult;
    [100.0 - medium - serious, medium, serious]
}

/// Percent taken off the chance of a training-ground injury: 3 per level above
/// the first.
pub fn training_injury_cut_percent(level: u8) -> u32 {
    3 * steps(level)
}

/// The chance of a training-ground injury at medical `level`, as a multiplier.
pub fn training_injury_mult(level: u8) -> f64 {
    1.0 - f64::from(training_injury_cut_percent(level)) / 100.0
}

// --- Training ----------------------------------------------------------------

/// Percent added to what players gain from each session: 2 per level above the first.
pub fn development_bonus_percent(level: u8) -> u32 {
    2 * steps(level)
}

/// What players gain from a session at training `level`, as a multiplier.
pub fn development_mult(level: u8) -> f64 {
    1.0 + f64::from(development_bonus_percent(level)) / 100.0
}

// --- Scouting ----------------------------------------------------------------

/// Youngsters a youth search looks at beyond the scout's own: one per level
/// above the first.
pub fn youth_search_extra(level: u8) -> u32 {
    steps(level)
}

/// The highest potential a club's scouting network reliably turns up.
pub fn potential_reach(level: u8) -> u8 {
    match level {
        ..=1 => 75,
        2 => 80,
        3 => 85,
        4 => 90,
        _ => 99,
    }
}

/// How many points narrower every estimate the club's scouts make is: one per
/// level from the sixth.
pub fn estimate_band_narrowing(level: u8) -> u8 {
    level.min(MAX_FACILITY_LEVEL).saturating_sub(5)
}

/// Points added to the potential of each youngster in the club's season-end
/// intake: ⌈k / 2⌉.
pub fn intake_potential_bonus(level: u8) -> u8 {
    steps(level).div_ceil(2) as u8
}

/// Chance in a thousand that a youngster in the intake is a gem: 50 + 5·k.
pub fn intake_gem_per_mille(level: u8) -> u32 {
    50 + 5 * steps(level)
}

/// Chance in a thousand that the intake brings one top talent (potential
/// 90–95): 5·k.
pub fn intake_top_talent_per_mille(level: u8) -> u32 {
    5 * steps(level)
}

// --- Opening levels ----------------------------------------------------------

/// The level a club opens a career with, by its reputation. The same for all
/// three facilities; AI clubs keep it, the player's club builds on it.
pub fn opening_level(reputation: u32) -> u8 {
    match reputation {
        850.. => 6,
        700..=849 => 5,
        550..=699 => 4,
        400..=549 => 3,
        250..=399 => 2,
        _ => 1,
    }
}

/// Give every club the facilities its reputation earns as a new world opens.
pub fn assign_opening_levels(teams: &mut [Team]) {
    for team in teams {
        let level = opening_level(team.reputation);
        team.facilities = Facilities {
            training: level,
            medical: level,
            scouting: level,
        };
    }
}

// --- Effects shown to the player ---------------------------------------------

/// How the upgrade dialog writes an effect's numbers.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EffectFormat {
    /// `×1.4`
    Multiplier,
    /// `−16%` / `+8%`, signed by the effect
    PercentChange,
    /// `7.5%`
    Percent,
    /// `+3`
    Count,
    /// a plain number, such as a potential reach
    Value,
    /// light / medium / serious percentages
    Split,
}

/// One line of the upgrade dialog: what a facility does at a level.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilityEffect {
    /// i18n key of the line's label.
    pub key: &'static str,
    pub format: EffectFormat,
    /// One number, or three for a split.
    pub values: Vec<f64>,
}

fn effect(key: &'static str, format: EffectFormat, values: Vec<f64>) -> FacilityEffect {
    FacilityEffect {
        key,
        format,
        values,
    }
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// Everything `facility` does at `level`, in the order the dialog lists it.
pub fn effects(facility: &FacilityType, level: u8) -> Vec<FacilityEffect> {
    use EffectFormat::*;
    match facility {
        FacilityType::Medical => vec![
            effect(
                "finances.facilityEffects.conditionRecovery",
                Multiplier,
                vec![round1(condition_recovery_mult(level))],
            ),
            effect(
                "finances.facilityEffects.injuryDays",
                PercentChange,
                vec![-f64::from(injury_days_cut_percent(level))],
            ),
            effect(
                "finances.facilityEffects.matchInjurySeverity",
                Split,
                match_injury_tier_shares(level, false).map(round1).to_vec(),
            ),
            effect(
                "finances.facilityEffects.trainingInjuries",
                PercentChange,
                vec![-f64::from(training_injury_cut_percent(level))],
            ),
        ],
        FacilityType::Training => vec![effect(
            "finances.facilityEffects.development",
            PercentChange,
            vec![f64::from(development_bonus_percent(level))],
        )],
        FacilityType::Scouting => vec![
            effect(
                "finances.facilityEffects.youthSearchExtra",
                Count,
                vec![f64::from(youth_search_extra(level))],
            ),
            effect(
                "finances.facilityEffects.potentialReach",
                Value,
                vec![f64::from(potential_reach(level))],
            ),
            effect(
                "finances.facilityEffects.estimateNarrowing",
                Count,
                vec![f64::from(estimate_band_narrowing(level))],
            ),
            effect(
                "finances.facilityEffects.intakePotential",
                Count,
                vec![f64::from(intake_potential_bonus(level))],
            ),
            effect(
                "finances.facilityEffects.intakeGems",
                Percent,
                vec![f64::from(intake_gem_per_mille(level)) / 10.0],
            ),
            effect(
                "finances.facilityEffects.intakeTopTalent",
                Percent,
                vec![f64::from(intake_top_talent_per_mille(level)) / 10.0],
            ),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn condition_recovery_rises_a_tenth_per_level() {
        assert!(close(condition_recovery_mult(1), 1.0));
        assert!(close(condition_recovery_mult(5), 1.4));
        assert!(close(condition_recovery_mult(10), 1.9));
    }

    #[test]
    fn injuries_are_shorter_at_a_better_medical_facility() {
        assert_eq!(injury_days(20, 1), 20);
        // 20 × 0.84 = 16.8 → 17
        assert_eq!(injury_days(20, 5), 17);
        // 20 × 0.64 = 12.8 → 13
        assert_eq!(injury_days(20, 10), 13);
        assert_eq!(injury_days(1, 10), 1);
    }

    #[test]
    fn match_injury_shares_follow_the_level_table() {
        let table = [
            (1, [60.0, 30.0, 10.0]),
            (2, [61.4, 29.1, 9.5]),
            (5, [65.6, 26.4, 8.0]),
            (10, [72.6, 21.9, 5.5]),
        ];
        for (level, expected) in table {
            let shares = match_injury_tier_shares(level, false).map(round1);
            assert_eq!(shares, expected, "level {level}");
        }
    }

    #[test]
    fn an_unfit_player_keeps_the_heavier_shares_at_level_one() {
        assert_eq!(match_injury_tier_shares(1, true), [40.0, 45.0, 15.0]);
    }

    #[test]
    fn training_injuries_and_development_scale_with_the_level() {
        assert_eq!(training_injury_cut_percent(10), 27);
        assert!(close(training_injury_mult(5), 0.88));
        assert_eq!(development_bonus_percent(10), 18);
        assert!(close(development_mult(1), 1.0));
    }

    #[test]
    fn scouting_effects_follow_the_level_table() {
        let reach = [75, 80, 85, 90, 99, 99, 99, 99, 99, 99];
        let narrowing = [0, 0, 0, 0, 0, 1, 2, 3, 4, 5];
        let bonus = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5];
        for level in 1..=10u8 {
            let i = usize::from(level - 1);
            assert_eq!(potential_reach(level), reach[i], "reach at {level}");
            assert_eq!(
                estimate_band_narrowing(level),
                narrowing[i],
                "band at {level}"
            );
            assert_eq!(intake_potential_bonus(level), bonus[i], "bonus at {level}");
            assert_eq!(youth_search_extra(level), u32::from(level) - 1);
        }
        assert_eq!(intake_gem_per_mille(10), 95);
        assert_eq!(intake_top_talent_per_mille(1), 0);
        assert_eq!(intake_top_talent_per_mille(10), 45);
    }

    #[test]
    fn opening_levels_follow_reputation() {
        for (reputation, level) in [
            (980, 6),
            (850, 6),
            (849, 5),
            (700, 5),
            (699, 4),
            (550, 4),
            (549, 3),
            (400, 3),
            (399, 2),
            (250, 2),
            (249, 1),
            (0, 1),
        ] {
            assert_eq!(opening_level(reputation), level, "reputation {reputation}");
        }
    }

    #[test]
    fn every_facility_lists_its_effects_at_every_level() {
        for facility in [
            FacilityType::Medical,
            FacilityType::Training,
            FacilityType::Scouting,
        ] {
            for level in 1..=MAX_FACILITY_LEVEL {
                assert!(!effects(&facility, level).is_empty());
            }
        }
        let medical = effects(&FacilityType::Medical, 4);
        assert_eq!(medical[0].values, vec![1.3]);
        assert_eq!(medical[1].values, vec![-12.0]);
        assert_eq!(medical[2].values, vec![64.2, 27.3, 8.5]);
        assert_eq!(medical[3].values, vec![-9.0]);
    }
}
