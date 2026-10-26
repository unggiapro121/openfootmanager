//! Buying capped by coach level, and forced promotion (phase 4, E4-1-tech-spec.md §3; PRD mục 3,
//! mục 4). Pure: the online server asks these rules at a bid, at an auction's close, on the squad
//! floor, at a takeover and at a season's close, and the balance measurement (E4-2) asks the same.
//!
//! Every threshold is in **tenths of OVR** and every comparison is between whole numbers: a
//! purchase accepted or refused on the last digit of a float is a bug nobody can reproduce
//! (E41-1). Two measures of a squad, each for one job:
//! - [`buy_strength`] fills 18 places, an empty place or a player below `emptySlotOvr` counting as
//!   `emptySlotOvr`. It never rises when a player leaves, so selling and buying in turns cannot
//!   climb past the team cap. Purchases are judged by it.
//! - [`avg_strength`] is the club's `strength_top18`: the average of its best 18, or of all it has.
//!   It cannot be lowered by keeping the squad small. Forced promotion is judged by it.

use serde::{Deserialize, Serialize};

/// Places a squad's strength is taken over.
pub const TOP_PLACES: u32 = 18;

/// The highest level a search for a level goes to: a ruleset that slipped past [`LevelCapRules::validate`]
/// still never hangs a worker.
pub const MAX_LEVEL_SEARCH: u32 = 1_000;

/// One stretch of the typical-strength curve: each level up to `up_to_level` adds `step_tenths`;
/// the last stretch (`None`) goes on for ever.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurveSegment {
    pub up_to_level: Option<u32>,
    pub step_tenths: u32,
}

/// The level caps of a season (§3.2). The defaults are the PRD's curve and margins; the
/// measurement E4-2 sets the real ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LevelCapRules {
    /// S(1), the typical strength of a level-1 club.
    pub base_tenths: u32,
    pub segments: Vec<CurveSegment>,
    /// The player cap is S(L+1) plus this.
    pub buy_cap_margin_tenths: u32,
    /// The team cap is S(L+1) plus this.
    pub squad_buy_margin_tenths: u32,
    /// The forced-promotion threshold is the team cap plus this. Above zero, so buying alone never
    /// forces a club up.
    pub forced_promotion_margin_tenths: u32,
    /// The most levels one season end may force a coach up.
    pub max_forced_jump: u32,
    /// From this OVR the player cap is no cap at all.
    pub uncapped_from_ovr: u8,
    /// What an empty place, or a player below it, counts for in [`buy_strength`].
    pub empty_slot_ovr: u8,
}

impl Default for LevelCapRules {
    fn default() -> Self {
        let segment = |up_to_level, step_tenths| CurveSegment {
            up_to_level,
            step_tenths,
        };
        Self {
            base_tenths: 600,
            segments: vec![
                segment(Some(5), 20),
                segment(Some(10), 15),
                segment(Some(20), 10),
                segment(None, 5),
            ],
            buy_cap_margin_tenths: 80,
            squad_buy_margin_tenths: 10,
            forced_promotion_margin_tenths: 20,
            max_forced_jump: 3,
            uncapped_from_ovr: 95,
            // OPEN(Qe41-7): E4-2a measures it.
            empty_slot_ovr: 45,
        }
    }
}

/// Something wrong with a [`LevelCapRules`]: the field and what is wrong with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LevelCapIssue {
    pub path: &'static str,
    pub code: &'static str,
}

/// Why a purchase is refused, with the lowest level that would allow it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapRefusal {
    /// A player above the player cap.
    Player {
        ovr: u8,
        cap: u8,
        required_level: u32,
    },
    /// The squad after the purchase above the team cap, both as an average in tenths.
    Squad {
        after_tenths: u32,
        cap_tenths: u32,
        required_level: u32,
    },
}

impl LevelCapRules {
    /// What is wrong with these rules; empty when they are sound. The curve must keep rising (its
    /// last stretch open-ended with a step above zero, the others in rising order), or a search
    /// for a level would never end.
    pub fn validate(&self) -> Vec<LevelCapIssue> {
        let mut issues = Vec::new();
        let issue = |path, code| LevelCapIssue { path, code };
        match self.segments.split_last() {
            None => issues.push(issue("segments", "empty")),
            Some((last, rest)) => {
                if last.up_to_level.is_some() {
                    issues.push(issue("segments", "lastBounded"));
                }
                if last.step_tenths == 0 {
                    issues.push(issue("segments", "lastFlat"));
                }
                let mut previous = 1;
                for segment in rest {
                    match segment.up_to_level {
                        Some(up_to) if up_to > previous => previous = up_to,
                        Some(_) => issues.push(issue("segments", "notRising")),
                        None => issues.push(issue("segments", "unboundedBeforeLast")),
                    }
                }
            }
        }
        if self.forced_promotion_margin_tenths == 0 {
            issues.push(issue("forcedPromotionMarginTenths", "notPositive"));
        }
        if self.uncapped_from_ovr > 99 {
            issues.push(issue("uncappedFromOvr", "aboveRange"));
        }
        if self.empty_slot_ovr > 99 {
            issues.push(issue("emptySlotOvr", "aboveRange"));
        }
        issues
    }

    /// What one level up to `level` adds: the step of the first stretch that reaches it.
    fn step_into(&self, level: u32) -> u32 {
        self.segments
            .iter()
            .find(|segment| segment.up_to_level.is_none_or(|up_to| level <= up_to))
            .or(self.segments.last())
            .map_or(0, |segment| segment.step_tenths)
    }

    /// S(L): the typical strength of a level-`level` club, in tenths. Level 0 counts as 1.
    pub fn typical_strength(&self, level: u32) -> u32 {
        (2..=level.max(1)).fold(self.base_tenths, |strength, next| {
            strength.saturating_add(self.step_into(next))
        })
    }

    /// The highest OVR a level-`level` coach may buy: S(L+1) + `buyCapMargin`, rounded down;
    /// `None` once that reaches `uncappedFromOvr` (no cap).
    pub fn player_cap(&self, level: u32) -> Option<u8> {
        let cap =
            (self.typical_strength(level.saturating_add(1)) + self.buy_cap_margin_tenths) / 10;
        if cap >= u32::from(self.uncapped_from_ovr) {
            None
        } else {
            u8::try_from(cap).ok()
        }
    }

    /// The team cap of a level-`level` coach, in tenths: S(L+1) + `squadBuyMargin`.
    pub fn squad_cap(&self, level: u32) -> u32 {
        self.typical_strength(level.saturating_add(1)) + self.squad_buy_margin_tenths
    }

    /// Above this average (tenths) a level-`level` coach's club is forced up: the team cap +
    /// `forcedPromotionMargin`.
    pub fn forced_threshold(&self, level: u32) -> u32 {
        self.squad_cap(level) + self.forced_promotion_margin_tenths
    }

    /// The lowest level that may buy a player of `ovr`.
    pub fn required_level_for_player(&self, ovr: u8) -> u32 {
        (1..MAX_LEVEL_SEARCH)
            .find(|level| self.player_cap(*level).is_none_or(|cap| ovr <= cap))
            .unwrap_or(MAX_LEVEL_SEARCH)
    }

    /// The lowest level whose team cap a squad of [`buy_strength`] `buy_sum` fits.
    pub fn required_level_for_squad(&self, buy_sum: u32) -> u32 {
        (1..MAX_LEVEL_SEARCH)
            .find(|level| fits(buy_sum, TOP_PLACES, self.squad_cap(*level)))
            .unwrap_or(MAX_LEVEL_SEARCH)
    }
}

/// Whether a sum of OVRs over `places` places averages at most `cap_tenths`, in whole numbers.
fn fits(sum: u32, places: u32, cap_tenths: u32) -> bool {
    u64::from(sum) * 10 <= u64::from(cap_tenths) * u64::from(places)
}

/// The squad's strength for buying (§3.1): the sum of the 18 largest of its OVRs together with 18
/// empty places, an empty place or a player below `empty_slot_ovr` counting as `empty_slot_ovr`.
/// Adding a player never lowers it; taking one away never raises it.
pub fn buy_strength(ovrs: &[u8], empty_slot_ovr: u8) -> u32 {
    let mut best: Vec<u8> = ovrs.iter().map(|ovr| (*ovr).max(empty_slot_ovr)).collect();
    best.sort_unstable_by(|a, b| b.cmp(a));
    best.resize(TOP_PLACES as usize, empty_slot_ovr);
    best.iter().map(|ovr| u32::from(*ovr)).sum()
}

/// The squad's strength as the club's `strength_top18`: the sum of its best 18 OVRs (or of all it
/// has) and how many that is.
pub fn avg_strength(ovrs: &[u8]) -> (u32, u32) {
    let mut best = ovrs.to_vec();
    best.sort_unstable_by(|a, b| b.cmp(a));
    best.truncate(TOP_PLACES as usize);
    (
        best.iter().map(|ovr| u32::from(*ovr)).sum(),
        u32::try_from(best.len()).unwrap_or(TOP_PLACES),
    )
}

/// Whether a level-`level` coach's club with `squad` may add `incoming` (§3.3): every newcomer
/// within the player cap, and the squad after it within the team cap, or no stronger for buying
/// than before (a player who does not make the 18 places is always allowed).
pub fn buy_allowed(
    level: u32,
    rules: &LevelCapRules,
    squad: &[u8],
    incoming: &[u8],
) -> Result<(), CapRefusal> {
    if let Some(cap) = rules.player_cap(level)
        && let Some(ovr) = incoming.iter().copied().filter(|ovr| *ovr > cap).max()
    {
        return Err(CapRefusal::Player {
            ovr,
            cap,
            required_level: rules.required_level_for_player(ovr),
        });
    }
    let mut after_squad = squad.to_vec();
    after_squad.extend_from_slice(incoming);
    let before = buy_strength(squad, rules.empty_slot_ovr);
    let after = buy_strength(&after_squad, rules.empty_slot_ovr);
    let cap = rules.squad_cap(level);
    if fits(after, TOP_PLACES, cap) || after <= before {
        return Ok(());
    }
    Err(CapRefusal::Squad {
        after_tenths: after * 10 / TOP_PLACES,
        cap_tenths: cap,
        required_level: rules.required_level_for_squad(after),
    })
}

/// The level a coach of level `level_at_season_start` (his level before this season end's
/// promotion) is forced up to by his club's `squad` (§3.4): his own level while its
/// [`avg_strength`] is within the forced threshold, else the lowest higher level whose threshold it
/// fits, at most `maxForcedJump` above. The server takes the higher of this and the level his
/// promotion gave him.
pub fn forced_level(level_at_season_start: u32, rules: &LevelCapRules, squad: &[u8]) -> u32 {
    let (sum, count) = avg_strength(squad);
    let start = level_at_season_start.max(1);
    if count == 0 {
        return start;
    }
    let top = start.saturating_add(rules.max_forced_jump);
    (start..=top)
        .find(|level| fits(sum, count, rules.forced_threshold(*level)))
        .unwrap_or(top)
}

#[cfg(test)]
mod tests {
    use rand::{RngExt, SeedableRng};
    use rand_chacha::ChaCha8Rng;

    use super::*;

    fn rules() -> LevelCapRules {
        LevelCapRules::default()
    }

    /// Given the default rules,
    /// when the PRD's table is read off them,
    /// then every row matches: S(L), the player cap, the team cap and the forced threshold, the
    /// level-22 row being 88.0 and 90.0 (S(23) = 85.5 + 3 × 0.5), and the player cap gone from
    /// level 22.
    #[test]
    fn the_default_curve_gives_the_prd_table() {
        // level, S(L), player cap, team cap, forced threshold (tenths)
        let rows: [(u32, u32, Option<u8>, u32, u32); 12] = [
            (1, 600, Some(70), 630, 650),
            (2, 620, Some(72), 650, 670),
            (3, 640, Some(74), 670, 690),
            (4, 660, Some(76), 690, 710),
            (5, 680, Some(77), 705, 725),
            (7, 710, Some(80), 735, 755),
            (10, 755, Some(84), 775, 795),
            (11, 765, Some(85), 785, 805),
            (15, 805, Some(89), 825, 845),
            (16, 815, Some(90), 835, 855),
            (20, 855, Some(94), 870, 890),
            (22, 865, None, 880, 900),
        ];
        let rules = rules();
        for (level, strength, player, squad, forced) in rows {
            assert_eq!(rules.typical_strength(level), strength, "S({level})");
            assert_eq!(rules.player_cap(level), player, "player cap at {level}");
            assert_eq!(rules.squad_cap(level), squad, "team cap at {level}");
            assert_eq!(
                rules.forced_threshold(level),
                forced,
                "threshold at {level}"
            );
        }
        assert_eq!(rules.player_cap(21), Some(94));
        assert!(rules.validate().is_empty());
    }

    /// Given rules wrong in each way validation knows,
    /// when they are validated,
    /// then each is named; and a curve that stops rising still ends a level search.
    #[test]
    fn validation_names_each_unsound_rule_and_a_search_always_ends() {
        let flat_last = LevelCapRules {
            segments: vec![CurveSegment {
                up_to_level: None,
                step_tenths: 0,
            }],
            ..rules()
        };
        let bounded_last = LevelCapRules {
            segments: vec![CurveSegment {
                up_to_level: Some(5),
                step_tenths: 10,
            }],
            ..rules()
        };
        let falling = LevelCapRules {
            segments: vec![
                CurveSegment {
                    up_to_level: Some(10),
                    step_tenths: 10,
                },
                CurveSegment {
                    up_to_level: Some(4),
                    step_tenths: 10,
                },
                CurveSegment {
                    up_to_level: None,
                    step_tenths: 5,
                },
            ],
            ..rules()
        };
        let margins = LevelCapRules {
            forced_promotion_margin_tenths: 0,
            uncapped_from_ovr: 120,
            empty_slot_ovr: 100,
            segments: Vec::new(),
            ..rules()
        };
        let codes = |rules: &LevelCapRules| -> Vec<&'static str> {
            rules.validate().iter().map(|issue| issue.code).collect()
        };
        assert_eq!(codes(&flat_last), vec!["lastFlat"]);
        assert_eq!(codes(&bounded_last), vec!["lastBounded"]);
        assert_eq!(codes(&falling), vec!["notRising"]);
        assert_eq!(
            margins.validate(),
            vec![
                LevelCapIssue {
                    path: "segments",
                    code: "empty"
                },
                LevelCapIssue {
                    path: "forcedPromotionMarginTenths",
                    code: "notPositive"
                },
                LevelCapIssue {
                    path: "uncappedFromOvr",
                    code: "aboveRange"
                },
                LevelCapIssue {
                    path: "emptySlotOvr",
                    code: "aboveRange"
                },
            ]
        );
        assert_eq!(flat_last.required_level_for_player(99), MAX_LEVEL_SEARCH);
        assert_eq!(
            flat_last.required_level_for_squad(18 * 99),
            MAX_LEVEL_SEARCH
        );
    }

    /// Given squads of 18 or more players all at or above the empty-place OVR, a short squad, one
    /// with weak players and an empty one,
    /// when their buying strength is taken,
    /// then a full squad's is its best 18 (`strength_top18` × 18); places short or below the
    /// empty-place OVR count as it; and an empty squad is 18 empty places.
    #[test]
    fn buying_strength_fills_eighteen_places() {
        let full: Vec<u8> = (60..80).collect();
        assert_eq!(buy_strength(&full, 45), (62u32..80).sum::<u32>());
        let (sum, count) = avg_strength(&full);
        assert_eq!((sum, count), ((62u32..80).sum::<u32>(), 18));
        assert_eq!(buy_strength(&[70; 16], 45), 16 * 70 + 2 * 45);
        assert_eq!(buy_strength(&[70, 30, 20], 45), 70 + 17 * 45);
        assert_eq!(buy_strength(&[], 45), 18 * 45);
        assert_eq!(avg_strength(&[]), (0, 0));
    }

    /// Given random squads,
    /// when a player is added, or any one taken away,
    /// then the buying strength never falls on adding and never rises on taking away.
    #[test]
    fn buying_strength_never_rises_when_a_player_leaves() {
        let mut rng = ChaCha8Rng::seed_from_u64(0x4b11);
        for _ in 0..2_000 {
            let size = rng.random_range(0usize..30);
            let squad: Vec<u8> = (0..size).map(|_| rng.random_range(30u8..95)).collect();
            let strength = buy_strength(&squad, 45);
            let mut more = squad.clone();
            more.push(rng.random_range(30u8..95));
            assert!(buy_strength(&more, 45) >= strength);
            for gone in 0..squad.len() {
                let mut fewer = squad.clone();
                fewer.remove(gone);
                assert!(
                    buy_strength(&fewer, 45) <= strength,
                    "{squad:?} without {gone}"
                );
            }
        }
    }

    /// Given a level-1 club,
    /// when it bids for a player above the player cap, for one that takes the squad above the team
    /// cap, and for one within both,
    /// then the first is refused with the level that may buy him, the second with the squad's
    /// average and the level that may, and the third is allowed.
    #[test]
    fn a_purchase_is_refused_over_either_cap_with_the_level_needed() {
        let rules = rules();
        let squad = [60u8; 18];
        assert_eq!(
            buy_allowed(1, &rules, &squad, &[75]),
            Err(CapRefusal::Player {
                ovr: 75,
                cap: 70,
                required_level: 4
            })
        );
        let strong = [63u8; 18];
        assert_eq!(
            buy_allowed(1, &rules, &strong, &[70]),
            Err(CapRefusal::Squad {
                after_tenths: (17 * 63 + 70) * 10 / 18,
                cap_tenths: 630,
                required_level: 2,
            })
        );
        assert_eq!(buy_allowed(1, &rules, &squad, &[70]), Ok(()));
        assert_eq!(
            buy_allowed(22, &rules, &[80; 18], &[99]),
            Ok(()),
            "no player cap from 22"
        );
    }

    /// Given a club over its team cap through its own players, with 18 and with 16 players,
    /// when it buys a player who does not make its 18 places,
    /// then the full squad may buy anyone no better than its 18th, the short squad only someone
    /// at or below the empty-place OVR.
    #[test]
    fn a_club_over_its_cap_may_still_buy_what_does_not_make_its_eighteen() {
        let rules = rules();
        let mut full = vec![70u8; 17];
        full.push(55);
        assert_eq!(buy_allowed(1, &rules, &full, &[55]), Ok(()));
        assert!(buy_allowed(1, &rules, &full, &[56]).is_err());
        let short = [70u8; 16];
        assert_eq!(buy_allowed(1, &rules, &short, &[45]), Ok(()));
        assert!(buy_allowed(1, &rules, &short, &[46]).is_err());
    }

    /// Given a level-1 squad of 18 at the team cap with two 40s (§3.1),
    /// when it sells both 40s and buys at its new average,
    /// then the purchase is refused: selling never widens the cap.
    #[test]
    fn selling_the_weakest_does_not_open_the_cap() {
        let rules = rules();
        // 16 × 70.6 + 2 × 40 ≈ 63 × 18: at the cap.
        let mut squad = vec![70u8; 13];
        squad.extend([71, 71, 71, 40, 40]);
        let sold: Vec<u8> = squad.iter().copied().filter(|ovr| *ovr > 40).collect();
        assert_eq!(sold.len(), 16);
        assert!(buy_allowed(1, &rules, &sold, &[66]).is_err());
    }

    /// Given integer and floating comparisons of the team cap,
    /// when random squads well clear of the threshold are judged,
    /// then the two agree.
    #[test]
    fn the_whole_number_comparison_agrees_with_the_average() {
        let rules = rules();
        let mut rng = ChaCha8Rng::seed_from_u64(7);
        for _ in 0..5_000 {
            let squad: Vec<u8> = (0..18).map(|_| rng.random_range(50u8..80)).collect();
            let sum = buy_strength(&squad, 45);
            let average = f64::from(sum) / 18.0;
            let cap = f64::from(rules.squad_cap(1)) / 10.0;
            if (average - cap).abs() > 0.01 {
                assert_eq!(fits(sum, TOP_PLACES, rules.squad_cap(1)), average <= cap);
            }
        }
    }

    /// Given clubs at every level 1–60, squads of 16–30 including players below the empty-place
    /// OVR, and 200 random turns each of allowed purchases and sales (never below 16),
    /// when each turn is applied,
    /// then the buying strength never passes the larger of the team cap and where it began
    /// (selling never widens the cap); and a squad of 18 or more within the team cap that only
    /// buys is never forced up.
    #[test]
    fn selling_never_widens_the_cap_and_buying_alone_never_forces_a_club_up() {
        let rules = rules();
        let mut rng = ChaCha8Rng::seed_from_u64(0xE41);
        for level in 1..=60 {
            let cap = rules.squad_cap(level);
            let player_cap = rules.player_cap(level).unwrap_or(99);
            for _ in 0..200 {
                let size = rng.random_range(16usize..=30);
                let mut squad: Vec<u8> = (0..size).map(|_| rng.random_range(30u8..=99)).collect();
                let ceiling = buy_strength(&squad, rules.empty_slot_ovr)
                    .max((u64::from(cap) * 18 / 10) as u32);
                for _ in 0..20 {
                    if rng.random_bool(0.5) && squad.len() > 16 {
                        let gone = rng.random_range(0..squad.len());
                        squad.remove(gone);
                    } else {
                        let ovr = rng.random_range(30u8..=player_cap);
                        if buy_allowed(level, &rules, &squad, &[ovr]).is_ok() {
                            squad.push(ovr);
                        }
                    }
                    assert!(
                        buy_strength(&squad, rules.empty_slot_ovr) <= ceiling,
                        "level {level}: {squad:?}"
                    );
                }
            }
            for _ in 0..200 {
                let mut squad: Vec<u8> = vec![30; 18];
                for _ in 0..20 {
                    let ovr = rng.random_range(30u8..=player_cap);
                    if buy_allowed(level, &rules, &squad, &[ovr]).is_ok() {
                        squad.push(ovr);
                    }
                }
                assert_eq!(forced_level(level, &rules, &squad), level, "level {level}");
            }
        }
    }

    /// Given a level-1 coach whose own players lifted his squad to 75 and a level-1 coach at 66,
    /// when the forced level is taken from the level the season began at, and from level 2,
    /// then 75 from level 1 stops at 4 (three levels at most), from level 2 it reaches 5; 66 from
    /// level 1 is forced to level 2; and a squad within the threshold stays.
    #[test]
    fn forced_promotion_counts_from_the_season_start_and_jumps_at_most_three() {
        let rules = rules();
        assert_eq!(forced_level(1, &rules, &[75; 18]), 4);
        assert_eq!(forced_level(2, &rules, &[75; 18]), 5);
        assert_eq!(forced_level(1, &rules, &[66; 18]), 2);
        assert_eq!(forced_level(1, &rules, &[65; 18]), 1);
        assert_eq!(forced_level(3, &rules, &[]), 3);
    }

    /// Given the default rules,
    /// when they go to JSON and back,
    /// then they are the same, in camelCase.
    #[test]
    fn the_rules_travel_as_camel_case_json() {
        let json = serde_json::to_value(rules()).expect("serialises");
        assert_eq!(json["buyCapMarginTenths"], 80);
        assert_eq!(json["segments"][3]["upToLevel"], serde_json::Value::Null);
        let back: LevelCapRules = serde_json::from_value(json).expect("deserialises");
        assert_eq!(back, rules());
    }
}
