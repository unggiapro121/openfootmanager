//! What makes an online content pack usable (E3-5q §4.1, F1, F14). The server refuses a pack
//! with any issue; each issue has a translation key and the path of the value at fault.

use std::collections::BTreeMap;

use serde::Serialize;

use super::names::effective_combinations;
use super::naming::valid_club_names;
use super::pack::{OnlineContentPack, PACK_FORMAT_VERSION, REGIONS};
use super::schedule::NationSchedule;
use super::starter::group_of;

/// One thing wrong with a pack.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackIssue {
    /// `be.error.contentPack.<reason>`.
    pub code: &'static str,
    /// Where in the pack, e.g. `regions.AsiaSoutheast.nations.VN`.
    pub path: String,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
}

fn issue(code: &'static str, path: impl Into<String>) -> PackIssue {
    PackIssue {
        code,
        path: path.into(),
        params: BTreeMap::new(),
    }
}

fn issue_with(code: &'static str, path: impl Into<String>, params: &[(&str, String)]) -> PackIssue {
    PackIssue {
        code,
        path: path.into(),
        params: params
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect(),
    }
}

/// Every issue of `pack`; empty when it can grow a world.
pub fn validate_pack(pack: &OnlineContentPack) -> Vec<PackIssue> {
    let mut issues = Vec::new();
    if pack.format_version != PACK_FORMAT_VERSION {
        issues.push(issue("be.error.contentPack.formatVersion", "formatVersion"));
    }
    if pack.id.trim().is_empty() || pack.version.trim().is_empty() {
        issues.push(issue("be.error.contentPack.missingVersion", "version"));
    }
    check_names(pack, &mut issues);
    check_nations(pack, &mut issues);
    check_regions(pack, &mut issues);
    check_kits(pack, &mut issues);
    check_profile(pack, &mut issues);
    if issues.is_empty() {
        check_capacity(pack, &mut issues);
    }
    issues
}

fn check_names(pack: &OnlineContentPack, issues: &mut Vec<PackIssue>) {
    for (code, pool) in &pack.names {
        let path = format!("names.{code}");
        if pool.given.is_empty() || pool.family.is_empty() {
            issues.push(issue("be.error.contentPack.emptyNamePool", &path));
        }
        if pool
            .given
            .iter()
            .chain(&pool.family)
            .chain(&pool.middle)
            .any(|(name, weight)| name.trim().is_empty() || *weight == 0)
        {
            issues.push(issue("be.error.contentPack.badNameEntry", &path));
        }
        if !(pool.flatten > 0.0 && pool.flatten <= 1.0) {
            issues.push(issue(
                "be.error.contentPack.badFlatten",
                format!("{path}.flatten"),
            ));
        }
    }
}

fn check_nations(pack: &OnlineContentPack, issues: &mut Vec<PackIssue>) {
    for (code, nation) in &pack.nations {
        let path = format!("nations.{code}");
        if nation.cities.is_empty() {
            issues.push(issue(
                "be.error.contentPack.noCities",
                format!("{path}.cities"),
            ));
        }
        if !pack.names.contains_key(code) {
            issues.push(issue("be.error.contentPack.noNamePool", &path));
        }
        match pack.club_styles.get(&nation.club_style) {
            None => issues.push(issue(
                "be.error.contentPack.unknownStyle",
                format!("{path}.clubStyle"),
            )),
            Some(style) => {
                if style.patterns.is_empty()
                    || style
                        .patterns
                        .iter()
                        .any(|pattern| !pattern.contains("{city}"))
                {
                    issues.push(issue(
                        "be.error.contentPack.badPattern",
                        format!("clubStyles.{}", nation.club_style),
                    ));
                }
                if style
                    .patterns
                    .iter()
                    .any(|pattern| pattern.contains("{word}"))
                    && style.words.is_empty()
                {
                    issues.push(issue(
                        "be.error.contentPack.noWords",
                        format!("clubStyles.{}", nation.club_style),
                    ));
                }
            }
        }
        if !pack.stadium_styles.contains_key(&nation.stadium_style) {
            issues.push(issue(
                "be.error.contentPack.unknownStyle",
                format!("{path}.stadiumStyle"),
            ));
        }
    }
}

fn check_regions(pack: &OnlineContentPack, issues: &mut Vec<PackIssue>) {
    for (region, content) in &pack.regions {
        let path = format!("regions.{region}");
        if !REGIONS.contains(&region.as_str()) {
            issues.push(issue("be.error.contentPack.unknownRegion", &path));
        }
        if content.nations.is_empty() || content.nations.iter().all(|(_, weight)| *weight == 0) {
            issues.push(issue(
                "be.error.contentPack.noNations",
                format!("{path}.nations"),
            ));
        }
        for (code, _) in &content.nations {
            if !pack.nations.contains_key(code) {
                issues.push(issue(
                    "be.error.contentPack.unknownNation",
                    format!("{path}.nations.{code}"),
                ));
            }
            if !pack.names.contains_key(code) {
                issues.push(issue(
                    "be.error.contentPack.noNamePool",
                    format!("{path}.nations.{code}"),
                ));
            }
        }
        let shares = [content.local_share, content.foreign_from_region_share];
        if shares.iter().any(|share| !(0.0..=1.0).contains(share))
            || shares.iter().sum::<f64>() > 1.0
        {
            issues.push(issue("be.error.contentPack.badShares", &path));
        }
    }
    for region in pack.scale.region_share.keys() {
        if !pack.regions.contains_key(region) {
            issues.push(issue(
                "be.error.contentPack.unknownRegion",
                format!("scale.regionShare.{region}"),
            ));
        }
    }
}

fn check_kits(pack: &OnlineContentPack, issues: &mut Vec<PackIssue>) {
    if pack.kits.colors.is_empty() {
        issues.push(issue("be.error.contentPack.noKits", "kits.colors"));
    }
    for pattern in &pack.kits.patterns {
        if pattern.parse::<domain::team::KitPattern>().is_err() {
            issues.push(issue(
                "be.error.contentPack.unknownKitPattern",
                format!("kits.patterns.{pattern}"),
            ));
        }
    }
}

fn check_profile(pack: &OnlineContentPack, issues: &mut Vec<PackIssue>) {
    let starter = &pack.profile.starter;
    for (name, band) in [
        ("strength", starter.strength),
        ("firstEleven", starter.first_eleven),
        ("goalkeeper", starter.goalkeeper),
    ] {
        if !(40.0..=85.0).contains(&band.target) || band.tolerance <= 0.0 {
            issues.push(issue(
                "be.error.contentPack.badStrength",
                format!("profile.starter.{name}"),
            ));
        }
    }
    // The generator's squad layout: two keepers, seven defenders, seven midfielders, six forwards.
    let mut seniors = [0usize; 4];
    for (index, row) in starter.template.iter().enumerate() {
        let path = format!("profile.starter.template.{index}");
        let Some(group) = group_of(row) else {
            issues.push(issue("be.error.contentPack.unknownGroup", &path));
            continue;
        };
        if row.ages.0 > row.ages.1 || row.ages.0 < 15 || row.ages.1 > 40 {
            issues.push(issue("be.error.contentPack.badAges", &path));
        }
        if row.potential.0 > row.potential.1 || row.potential.1 > 99 {
            issues.push(issue("be.error.contentPack.badPotential", &path));
        }
        if !row.academy {
            let at = match group {
                domain::player::Position::Goalkeeper => 0,
                domain::player::Position::Defender => 1,
                domain::player::Position::Midfielder => 2,
                _ => 3,
            };
            seniors[at] += 1;
        }
    }
    if seniors != [2, 7, 7, 6] {
        issues.push(issue_with(
            "be.error.contentPack.badTemplate",
            "profile.starter.template",
            &[("seniors", format!("{seniors:?}"))],
        ));
    }
    if pack.profile.staff_roles.is_empty() {
        issues.push(issue("be.error.contentPack.noStaff", "profile.staffRoles"));
    }
    if pack.scale.clubs == 0 || pack.scale.people_per_club == 0 {
        issues.push(issue("be.error.contentPack.badScale", "scale"));
    }
}

/// Room for the world `scale` asks for: valid club names per nation, and a predicted share of
/// people sharing a full name within the limit (E3-5q F14).
fn check_capacity(pack: &OnlineContentPack, issues: &mut Vec<PackIssue>) {
    let mut people: BTreeMap<String, f64> = BTreeMap::new();
    for (region, content) in &pack.regions {
        let Some(schedule) = NationSchedule::new(&content.nations) else {
            continue;
        };
        let share = pack.scale.region_share.get(region).copied().unwrap_or(0.0);
        let clubs = (f64::from(pack.scale.clubs) * share).round() as u64;
        let total_weight: f64 = content
            .nations
            .iter()
            .map(|(_, weight)| f64::from(*weight))
            .sum();
        for (code, expected) in schedule.clubs_per_nation(clubs) {
            let capacity = valid_club_names(&code, pack).len() as f64;
            let needed = expected as f64 * pack.limits.club_name_capacity_factor;
            if capacity < needed {
                issues.push(issue_with(
                    "be.error.contentPack.clubNameCapacity",
                    format!("nations.{code}"),
                    &[
                        ("capacity", format!("{capacity:.0}")),
                        ("needed", format!("{needed:.0}")),
                    ],
                ));
            }
            let weight = content
                .nations
                .iter()
                .find(|(other, _)| *other == code)
                .map_or(0.0, |(_, weight)| f64::from(*weight));
            let region_people = clubs as f64 * f64::from(pack.scale.people_per_club);
            *people.entry(code.clone()).or_default() +=
                expected as f64 * f64::from(pack.scale.people_per_club) * content.local_share
                    + region_people * content.foreign_from_region_share * weight
                        / total_weight.max(1.0);
        }
    }
    for (code, count) in people {
        let Some(pool) = pack.names.get(&code) else {
            continue;
        };
        let combinations = effective_combinations(pool).max(1.0);
        // Each of `count` people shares a full name with someone with chance 1 − e^(−(n−1)/N).
        let share = 1.0 - (-(count - 1.0).max(0.0) / combinations).exp();
        if share > pack.limits.max_world_name_share {
            issues.push(issue_with(
                "be.error.contentPack.nameCapacity",
                format!("names.{code}"),
                &[
                    ("predictedShare", format!("{share:.3}")),
                    ("combinations", format!("{combinations:.0}")),
                ],
            ));
        }
    }
}

/// The predicted share of each nation's people sharing a full name with someone, at `scale`: what
/// [`validate_pack`] compares with the limit, for a report.
pub fn predicted_name_shares(pack: &OnlineContentPack) -> BTreeMap<String, f64> {
    let mut probe = pack.clone();
    probe.limits.max_world_name_share = -1.0;
    let mut issues = Vec::new();
    check_capacity(&probe, &mut issues);
    issues
        .into_iter()
        .filter(|issue| issue.code == "be.error.contentPack.nameCapacity")
        .filter_map(|issue| {
            let nation = issue.path.strip_prefix("names.")?.to_string();
            let share = issue.params.get("predictedShare")?.parse().ok()?;
            Some((nation, share))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given the shipped pack,
    /// when it is validated,
    /// then it has no issue.
    #[test]
    fn the_builtin_pack_is_valid() {
        let issues = validate_pack(&OnlineContentPack::builtin());
        assert!(issues.is_empty(), "{issues:#?}");
    }

    /// Given the shipped pack broken one way at a time,
    /// when each is validated,
    /// then the issue names the fault and where it is.
    #[test]
    fn each_kind_of_fault_is_reported_where_it_is() {
        let broken = |change: fn(&mut OnlineContentPack)| {
            let mut pack = OnlineContentPack::builtin();
            change(&mut pack);
            validate_pack(&pack)
        };
        let has = |issues: &[PackIssue], code: &str, path: &str| {
            issues
                .iter()
                .any(|issue| issue.code == code && issue.path == path)
        };
        let issues = broken(|pack| {
            pack.names.remove("VN");
        });
        assert!(
            has(
                &issues,
                "be.error.contentPack.noNamePool",
                "regions.AsiaSoutheast.nations.VN"
            ),
            "{issues:?}"
        );
        let issues = broken(|pack| pack.profile.starter.strength.target = 99.0);
        assert!(has(
            &issues,
            "be.error.contentPack.badStrength",
            "profile.starter.strength"
        ));
        let issues = broken(|pack| {
            pack.profile.starter.template.pop();
            pack.profile.starter.template.pop();
        });
        assert!(has(
            &issues,
            "be.error.contentPack.badTemplate",
            "profile.starter.template"
        ));
        let issues = broken(|pack| {
            if let Some(region) = pack.regions.get_mut("Europe") {
                region.local_share = 0.95;
            }
        });
        assert!(has(
            &issues,
            "be.error.contentPack.badShares",
            "regions.Europe"
        ));
        let issues = broken(|pack| pack.kits.patterns.push("Plaid".into()));
        assert!(has(
            &issues,
            "be.error.contentPack.unknownKitPattern",
            "kits.patterns.Plaid"
        ));
        let issues = broken(|pack| pack.format_version = 9);
        assert!(has(
            &issues,
            "be.error.contentPack.formatVersion",
            "formatVersion"
        ));
        let issues = broken(|pack| {
            if let Some(nation) = pack.nations.get_mut("SG") {
                nation.cities.truncate(1);
            }
            pack.scale.clubs = 50_000;
        });
        assert!(
            has(
                &issues,
                "be.error.contentPack.clubNameCapacity",
                "nations.SG"
            ),
            "{issues:?}"
        );
        let issues = broken(|pack| {
            if let Some(pool) = pack.names.get_mut("VN") {
                pool.given.truncate(5);
                pool.middle.truncate(2);
            }
        });
        assert!(
            has(&issues, "be.error.contentPack.nameCapacity", "names.VN"),
            "{issues:?}"
        );
    }
}
