//! Which face a generated player gets: an appearance group drawn from his
//! nationality, an age band from his age, then one face of that kind.

use super::catalog::FACES;
use super::{AgeBand, AppearanceGroup, PortraitFace};
use AppearanceGroup::{
    Black, EastAsian, EuropeanNorth, EuropeanSouth, Latin, MiddleEastern, Polynesian, SouthAsian,
    SoutheastAsian,
};

/// Fewer faces than this in one group and age band and the pick widens, first
/// to the group's other bands, then to a neighbouring group. Below it the same
/// handful of faces would repeat across a whole squad.
const MIN_CANDIDATES: usize = 6;

type Mix = &'static [(AppearanceGroup, u8)];

/// How the players of a nation look, as weights. Mixed nations draw from
/// several groups so a French or English squad is not one look repeated.
fn nation_mix(nationality: &str) -> Mix {
    let code = nationality.trim().to_ascii_uppercase();
    let code = code.strip_prefix("GB-").unwrap_or(&code);
    match code {
        "ENG" => &[
            (EuropeanNorth, 72),
            (Black, 20),
            (EuropeanSouth, 4),
            (SouthAsian, 4),
        ],
        "SCO" | "NIR" | "IE" | "WAL" => &[(EuropeanNorth, 92), (Black, 8)],
        "FR" => &[
            (EuropeanNorth, 30),
            (EuropeanSouth, 25),
            (Black, 35),
            (MiddleEastern, 10),
        ],
        "DE" => &[
            (EuropeanNorth, 75),
            (Black, 10),
            (MiddleEastern, 10),
            (EuropeanSouth, 5),
        ],
        "NL" => &[(EuropeanNorth, 65), (Black, 28), (MiddleEastern, 7)],
        "BE" => &[(EuropeanNorth, 55), (Black, 32), (MiddleEastern, 13)],
        "CH" => &[
            (EuropeanNorth, 70),
            (Black, 12),
            (EuropeanSouth, 10),
            (MiddleEastern, 8),
        ],
        "AT" => &[
            (EuropeanNorth, 80),
            (EuropeanSouth, 8),
            (Black, 6),
            (MiddleEastern, 6),
        ],
        "DK" | "SE" | "NO" => &[(EuropeanNorth, 82), (Black, 12), (MiddleEastern, 6)],
        "LU" => &[(EuropeanNorth, 60), (EuropeanSouth, 25), (Black, 15)],
        "FI" | "IS" | "FO" | "EE" | "LV" | "LT" | "BY" | "RU" | "UA" | "PL" | "CZ" | "SK"
        | "HU" | "SI" => &[(EuropeanNorth, 95), (EuropeanSouth, 5)],
        "HR" | "RS" | "BA" | "ME" | "MK" | "RO" | "BG" | "MD" => {
            &[(EuropeanSouth, 65), (EuropeanNorth, 35)]
        }
        "ES" => &[(EuropeanSouth, 88), (Black, 7), (MiddleEastern, 5)],
        "IT" => &[(EuropeanSouth, 92), (Black, 8)],
        "PT" => &[(EuropeanSouth, 78), (Black, 22)],
        "GR" | "CY" | "MT" | "AD" | "SM" | "AL" | "XK" => &[(EuropeanSouth, 100)],
        "TR" => &[(EuropeanSouth, 50), (MiddleEastern, 50)],
        "IL" => &[(EuropeanSouth, 65), (MiddleEastern, 35)],
        "GE" | "AM" | "AZ" => &[(EuropeanSouth, 70), (MiddleEastern, 30)],
        "MA" | "DZ" | "TN" | "LY" | "EG" => &[(MiddleEastern, 88), (Black, 12)],
        "MR" | "SD" => &[(MiddleEastern, 50), (Black, 50)],
        "SA" | "AE" | "QA" | "IQ" | "SY" | "JO" | "LB" | "PS" | "YE" | "KW" | "OM" | "BH" => {
            &[(MiddleEastern, 92), (Black, 8)]
        }
        "IR" | "AF" => &[(MiddleEastern, 100)],
        "IN" | "PK" | "BD" | "LK" | "NP" => &[(SouthAsian, 100)],
        "CN" | "JP" | "KR" | "KP" | "TW" | "HK" | "MO" | "MN" => &[(EastAsian, 100)],
        "VN" | "TH" | "ID" | "MY" | "PH" | "SG" | "MM" | "KH" | "LA" | "BN" | "TL" => {
            &[(SoutheastAsian, 100)]
        }
        "UZ" | "KZ" | "KG" | "TJ" | "TM" => {
            &[(MiddleEastern, 40), (EastAsian, 30), (EuropeanNorth, 30)]
        }
        "AU" => &[
            (EuropeanNorth, 78),
            (EuropeanSouth, 8),
            (EastAsian, 6),
            (Black, 5),
            (Polynesian, 3),
        ],
        "NZ" => &[(EuropeanNorth, 62), (Polynesian, 30), (Black, 8)],
        "FJ" | "VU" | "NC" | "WS" | "TO" | "PG" | "SB" | "PF" => &[(Polynesian, 100)],
        "US" => &[(EuropeanNorth, 50), (Black, 30), (Latin, 20)],
        "CA" => &[
            (EuropeanNorth, 60),
            (Black, 22),
            (EuropeanSouth, 8),
            (EastAsian, 5),
            (SouthAsian, 5),
        ],
        "BR" => &[(Latin, 35), (Black, 35), (EuropeanSouth, 30)],
        "AR" => &[(EuropeanSouth, 88), (Latin, 12)],
        "UY" => &[(EuropeanSouth, 85), (Latin, 8), (Black, 7)],
        "CL" => &[(EuropeanSouth, 50), (Latin, 50)],
        "PY" => &[(Latin, 60), (EuropeanSouth, 40)],
        "BO" | "PE" | "MX" | "GT" | "HN" | "SV" | "NI" => &[(Latin, 80), (EuropeanSouth, 20)],
        "EC" => &[(Latin, 60), (Black, 40)],
        "CO" => &[(Latin, 55), (Black, 25), (EuropeanSouth, 20)],
        "VE" => &[(Latin, 55), (EuropeanSouth, 30), (Black, 15)],
        "CR" => &[(Latin, 50), (EuropeanSouth, 40), (Black, 10)],
        "PA" => &[(Black, 55), (Latin, 45)],
        "CU" => &[(Black, 45), (EuropeanSouth, 35), (Latin, 20)],
        "DO" => &[(Black, 60), (Latin, 40)],
        "PR" => &[(Latin, 60), (Black, 25), (EuropeanSouth, 15)],
        "TT" => &[(Black, 60), (SouthAsian, 40)],
        "GY" => &[(Black, 50), (SouthAsian, 50)],
        "SR" => &[(Black, 75), (SouthAsian, 25)],
        "CV" => &[(Black, 85), (Latin, 15)],
        "ZA" => &[(Black, 85), (EuropeanNorth, 15)],
        "JM" | "HT" | "GD" | "LC" | "KN" | "AG" | "BB" | "MS" | "BM" | "CW" | "VC" | "DM"
        | "BS" | "KY" | "AW" | "SN" | "NG" | "CI" | "GH" | "CM" | "ML" | "CD" | "GN" | "GM"
        | "AO" | "GW" | "BF" | "KM" | "SL" | "TG" | "CG" | "ZW" | "GA" | "KE" | "GQ" | "BJ"
        | "ZM" | "CF" | "LR" | "UG" | "TZ" | "BI" | "MZ" | "TD" | "RW" | "NE" | "NA" | "MW"
        | "MG" | "ET" | "SO" | "SS" | "ER" | "DJ" | "SZ" | "LS" | "BW" | "ST" => &[(Black, 100)],
        // An unknown or missing nationality: the mix of the game's own world,
        // which is mostly European club football.
        _ => &[
            (EuropeanNorth, 35),
            (EuropeanSouth, 30),
            (Black, 25),
            (MiddleEastern, 10),
        ],
    }
}

/// Where to look when a group has too few faces of its own.
fn neighbour_group(group: AppearanceGroup) -> AppearanceGroup {
    match group {
        Polynesian => Latin,
        Latin | MiddleEastern | EuropeanNorth => EuropeanSouth,
        SoutheastAsian => EastAsian,
        EastAsian => SoutheastAsian,
        SouthAsian => MiddleEastern,
        EuropeanSouth => EuropeanNorth,
        Black => Latin,
    }
}

pub(super) fn age_band(age_years: Option<i32>) -> AgeBand {
    match age_years {
        Some(age) if age <= 22 => AgeBand::Young,
        Some(age) if age >= 30 => AgeBand::Veteran,
        _ => AgeBand::Prime,
    }
}

pub(super) fn pick_group(nationality: Option<&str>, roll: u64) -> AppearanceGroup {
    let mix = nation_mix(nationality.unwrap_or_default());
    let total: u64 = mix.iter().map(|(_, weight)| u64::from(*weight)).sum();
    let mut ticket = roll % total.max(1);
    for (group, weight) in mix {
        let weight = u64::from(*weight);
        if ticket < weight {
            return *group;
        }
        ticket -= weight;
    }
    mix[0].0
}

fn bands_near(band: AgeBand) -> &'static [AgeBand] {
    match band {
        AgeBand::Young => &[AgeBand::Young, AgeBand::Prime],
        AgeBand::Prime => &[AgeBand::Prime, AgeBand::Young, AgeBand::Veteran],
        AgeBand::Veteran => &[AgeBand::Veteran, AgeBand::Prime],
    }
}

/// The faces a player of this group and band may get. Widens one step at a
/// time — the same band, the neighbouring bands, the neighbouring group — and
/// stops as soon as there are enough to keep a squad from looking cloned.
pub(super) fn candidates(group: AppearanceGroup, band: AgeBand) -> Vec<&'static PortraitFace> {
    let of = |g: AppearanceGroup, bands: &[AgeBand]| {
        FACES
            .iter()
            .filter(move |face| face.group == g && bands.contains(&face.band))
            .collect::<Vec<_>>()
    };

    let exact = of(group, &[band]);
    if exact.len() >= MIN_CANDIDATES {
        return exact;
    }
    let mut widened = of(group, bands_near(band));
    if widened.len() >= MIN_CANDIDATES {
        return widened;
    }
    widened.extend(of(neighbour_group(group), &[band]));
    if widened.is_empty() {
        return FACES.iter().collect();
    }
    widened
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given every group and age band,
    /// when the candidates are listed,
    /// then there are always faces to pick from.
    #[test]
    fn every_group_and_band_has_candidates() {
        for group in [
            Black,
            EastAsian,
            EuropeanNorth,
            EuropeanSouth,
            Latin,
            MiddleEastern,
            Polynesian,
            SouthAsian,
            SoutheastAsian,
        ] {
            for band in [AgeBand::Young, AgeBand::Prime, AgeBand::Veteran] {
                assert!(
                    !candidates(group, band).is_empty(),
                    "{group:?} {band:?} has no faces"
                );
            }
        }
    }

    /// Given a group whose band is well stocked,
    /// when the candidates are listed,
    /// then only faces of that group and band come back.
    #[test]
    fn well_stocked_band_is_not_widened() {
        let faces = candidates(EastAsian, AgeBand::Young);
        assert!(faces.len() >= MIN_CANDIDATES);
        assert!(faces
            .iter()
            .all(|face| face.group == EastAsian && face.band == AgeBand::Young));
    }

    /// Given a veteran from a group with no veteran faces (South-East Asia),
    /// when the candidates are listed,
    /// then they come from his own group first, never a teenager's face.
    #[test]
    fn thin_band_widens_to_neighbouring_band_before_other_groups() {
        let faces = candidates(SoutheastAsian, AgeBand::Veteran);
        assert!(faces.iter().all(|face| face.band != AgeBand::Young));
        assert!(faces.iter().any(|face| face.group == SoutheastAsian));
    }

    /// Given single-group nations,
    /// when their group is drawn with any roll,
    /// then it is always that group.
    #[test]
    fn single_group_nations_always_map_to_their_group() {
        for roll in 0..200 {
            assert_eq!(pick_group(Some("JP"), roll), EastAsian);
            assert_eq!(pick_group(Some("vn"), roll), SoutheastAsian);
            assert_eq!(pick_group(Some("SN"), roll), Black);
            assert_eq!(pick_group(Some("IN"), roll), SouthAsian);
        }
    }

    /// Given a mixed nation (France),
    /// when the group is drawn over many rolls,
    /// then more than one group appears.
    #[test]
    fn mixed_nations_draw_from_several_groups() {
        let groups: std::collections::HashSet<_> =
            (0..100).map(|roll| pick_group(Some("FR"), roll)).collect();
        assert!(groups.len() >= 3);
    }

    /// Given the home-nation codes the packages use (ENG and GB-ENG),
    /// when the group is drawn,
    /// then both spellings resolve to the same mix.
    #[test]
    fn gb_prefixed_codes_match_bare_codes() {
        for roll in 0..100 {
            assert_eq!(
                pick_group(Some("GB-ENG"), roll),
                pick_group(Some("ENG"), roll)
            );
        }
    }

    /// Given ages either side of the band edges,
    /// when the band is taken,
    /// then 22 is young, 23 and 29 are prime, 30 is a veteran, unknown is prime.
    #[test]
    fn age_bands_split_at_23_and_30() {
        assert_eq!(age_band(Some(17)), AgeBand::Young);
        assert_eq!(age_band(Some(22)), AgeBand::Young);
        assert_eq!(age_band(Some(23)), AgeBand::Prime);
        assert_eq!(age_band(Some(29)), AgeBand::Prime);
        assert_eq!(age_band(Some(30)), AgeBand::Veteran);
        assert_eq!(age_band(None), AgeBand::Prime);
    }
}
