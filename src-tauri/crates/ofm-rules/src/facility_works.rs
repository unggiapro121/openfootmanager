//! What an online club builds and keeps up (E5-14, analysis-facilities-rework §3.4): the
//! catalogue of facilities, what each level costs and how long it takes to build, the coach level
//! a level of Training or Medical needs, upkeep, downgrades, cancelled builds and time skips.
//!
//! Online only: nothing in the game calls this module, and `ofm_core` does not re-export it. The
//! server reads the `facilities` block of a season's ruleset and calls these functions; with the
//! block absent nothing here runs. Whole numbers only (E514-2), so the server and a simulation
//! agree to the euro.

use domain::team::FacilityType;
use serde::{Deserialize, Serialize};

use crate::economy::facility_upgrade_cost;
use crate::facilities::MAX_FACILITY_LEVEL;

/// The facilities an online club builds (analysis-facilities-rework §3.4). No scouting: online it
/// has no effect and is refused (Dfac-10, S-49a).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub enum FacilityKind {
    Stands,
    Shop,
    Food,
    Park,
    Training,
    Medical,
    Academy,
}

impl FacilityKind {
    /// Every kind, in the order the facilities view lists them.
    pub const ALL: [Self; 7] = [
        Self::Stands,
        Self::Shop,
        Self::Food,
        Self::Park,
        Self::Training,
        Self::Medical,
        Self::Academy,
    ];

    /// Training and Medical as the game's `FacilityType`, for `facilities::effects`; None
    /// otherwise.
    pub fn as_sport(self) -> Option<FacilityType> {
        match self {
            Self::Training => Some(FacilityType::Training),
            Self::Medical => Some(FacilityType::Medical),
            _ => None,
        }
    }

    /// The JSON and path name: "stands" … "academy", the same strings serde writes (R514-2).
    pub fn code(self) -> &'static str {
        match self {
            Self::Stands => "stands",
            Self::Shop => "shop",
            Self::Food => "food",
            Self::Park => "park",
            Self::Training => "training",
            Self::Medical => "medical",
            Self::Academy => "academy",
        }
    }

    /// The kind of a `code`; None for any other string, "scouting" included (R514-2).
    pub fn from_code(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.code() == code)
    }

    fn is_sport(self) -> bool {
        matches!(self, Self::Training | Self::Medical)
    }
}

/// A club's level of each facility. 0 = not built (commerce only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilityLevels {
    pub stands: u8,
    pub shop: u8,
    pub food: u8,
    pub park: u8,
    pub training: u8,
    pub medical: u8,
    pub academy: u8,
}

impl FacilityLevels {
    /// A new online club: stands 1 (10.000 seats, Dfac-14), no commerce, the rest at 1.
    pub const OPENING: Self = Self {
        stands: 1,
        shop: 0,
        food: 0,
        park: 0,
        training: 1,
        medical: 1,
        academy: 1,
    };

    /// The level of `kind`.
    pub fn get(&self, kind: FacilityKind) -> u8 {
        match kind {
            FacilityKind::Stands => self.stands,
            FacilityKind::Shop => self.shop,
            FacilityKind::Food => self.food,
            FacilityKind::Park => self.park,
            FacilityKind::Training => self.training,
            FacilityKind::Medical => self.medical,
            FacilityKind::Academy => self.academy,
        }
    }

    /// These levels with `kind` at `level`.
    pub fn with(mut self, kind: FacilityKind, level: u8) -> Self {
        let slot = match kind {
            FacilityKind::Stands => &mut self.stands,
            FacilityKind::Shop => &mut self.shop,
            FacilityKind::Food => &mut self.food,
            FacilityKind::Park => &mut self.park,
            FacilityKind::Training => &mut self.training,
            FacilityKind::Medical => &mut self.medical,
            FacilityKind::Academy => &mut self.academy,
        };
        *slot = level;
        self
    }
}

/// A season's `facilities` block (E514-5). Training and Medical prices stay
/// `economy.facilityUpgradeBase` × level and the academy's stay `academy.slotCosts`: the caller
/// passes them in, so no number is held in two places.
///
/// A field added later needs `#[serde(default)]`: the block denies unknown fields, and a ruleset
/// already published must still read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FacilitiesRules {
    pub stands: StandsRules,
    pub commerce: CommerceRules,
    /// Training, Medical, and the academy's build time.
    pub sports: SportsRules,
    /// Of what was paid, given back when a build is cancelled, in ‰ (BR-5).
    pub cancel_refund_permille: u16,
    /// Season days one `timeSkip` takes off a build (BR-4).
    pub time_skip_days: u8,
}

/// The stands: seats by level, their price and upkeep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StandsRules {
    /// Seats at stands level 1, 2, …; its length is the top level. Level 1's seats carry no
    /// upkeep.
    pub capacities: Vec<u32>,
    /// € a seat added by the step to level 2; each later level adds `seat_cost_step`.
    pub seat_cost_at_level2: u32,
    pub seat_cost_step: u32,
    /// € a seat above level 1's, each home league match (paid by the day, BR-6).
    pub seat_upkeep_per_match: u32,
    /// Days to build from level n: this × n.
    pub build_days_per_level: u8,
}

/// The shop, the food court and the car park.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommerceRules {
    pub max_level: u8,
    /// € of level 1; each next level costs twice the one before.
    pub shop_first_cost: u64,
    pub food_first_cost: u64,
    pub park_first_cost: u64,
    /// Days to build level k: this × k.
    pub build_days_per_level: u8,
}

/// Training and Medical, and the academy's build time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SportsRules {
    /// Upkeep a season, in ‰ of the catalogue price of every level built (Training, Medical).
    pub upkeep_permille: u16,
    /// A level of Training or Medical may be built up to the coach's level plus this (BR-7).
    pub coach_level_lead: u8,
    /// Days to build from level n: this × n (Training, Medical, Academy).
    pub build_days_per_level: u8,
}

/// The part of the block a build time belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildArea {
    Stands,
    Commerce,
    Sports,
}

/// Why a [`FacilitiesRules`] cannot be run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FacilitiesIssue {
    /// Fewer than 2 or more than 30 levels, no seats at level 1, or seats not rising each level.
    StandsCapacities,
    /// No price for a seat.
    StandsSeatCost,
    /// `commerce.maxLevel` 0 or above 10.
    CommerceMaxLevel,
    /// A commerce building's first level costs nothing (Shop, Food or Park).
    CommerceCost(FacilityKind),
    /// `sports.upkeepPermille` above 1.000.
    SportsUpkeep,
    /// `sports.coachLevelLead` above 20.
    CoachLevelLead,
    /// A `buildDaysPerLevel` of 0 or above 10.
    BuildDays(BuildArea),
    /// `cancelRefundPermille` above 1.000.
    CancelRefund,
    /// `timeSkipDays` 0 or above 7.
    TimeSkipDays,
}

impl FacilitiesIssue {
    /// The camelCase path of the field at fault, for the server's ruleset issue.
    pub fn field(&self) -> &'static str {
        match self {
            Self::StandsCapacities => "facilities.stands.capacities",
            Self::StandsSeatCost => "facilities.stands.seatCostAtLevel2",
            Self::CommerceMaxLevel => "facilities.commerce.maxLevel",
            Self::CommerceCost(FacilityKind::Food) => "facilities.commerce.foodFirstCost",
            Self::CommerceCost(FacilityKind::Park) => "facilities.commerce.parkFirstCost",
            Self::CommerceCost(_) => "facilities.commerce.shopFirstCost",
            Self::SportsUpkeep => "facilities.sports.upkeepPermille",
            Self::CoachLevelLead => "facilities.sports.coachLevelLead",
            Self::BuildDays(BuildArea::Stands) => "facilities.stands.buildDaysPerLevel",
            Self::BuildDays(BuildArea::Commerce) => "facilities.commerce.buildDaysPerLevel",
            Self::BuildDays(BuildArea::Sports) => "facilities.sports.buildDaysPerLevel",
            Self::CancelRefund => "facilities.cancelRefundPermille",
            Self::TimeSkipDays => "facilities.timeSkipDays",
        }
    }
}

impl FacilitiesRules {
    /// The analysis' numbers (bản 3, §3.4.1, §3.4.2). Kept as the tests' reference; the
    /// published rulesets carry their own block (D-P5-9).
    pub fn proposed() -> Self {
        Self {
            stands: StandsRules {
                capacities: vec![
                    10_000, 12_000, 14_000, 16_500, 19_500, 23_000, 27_000, 31_000, 36_000, 42_000,
                    50_000, 58_000, 66_000, 75_000, 85_000, 99_000,
                ],
                seat_cost_at_level2: 300,
                seat_cost_step: 20,
                seat_upkeep_per_match: 2,
                build_days_per_level: 2,
            },
            commerce: CommerceRules {
                max_level: 5,
                shop_first_cost: 100_000,
                food_first_cost: 60_000,
                park_first_cost: 40_000,
                build_days_per_level: 1,
            },
            sports: SportsRules {
                upkeep_permille: 30,
                coach_level_lead: 2,
                build_days_per_level: 1,
            },
            cancel_refund_permille: 500,
            time_skip_days: 1,
        }
    }

    /// Whether a season can run this block, checked in the order of the issues.
    pub fn validate(&self) -> Result<(), FacilitiesIssue> {
        let seats = &self.stands.capacities;
        if !(2..=30).contains(&seats.len())
            || seats[0] == 0
            || seats.windows(2).any(|pair| pair[1] <= pair[0])
        {
            return Err(FacilitiesIssue::StandsCapacities);
        }
        if self.stands.seat_cost_at_level2 == 0 {
            return Err(FacilitiesIssue::StandsSeatCost);
        }
        if !(1..=10).contains(&self.commerce.max_level) {
            return Err(FacilitiesIssue::CommerceMaxLevel);
        }
        for kind in [FacilityKind::Shop, FacilityKind::Food, FacilityKind::Park] {
            if self.commerce_first_cost(kind) == 0 {
                return Err(FacilitiesIssue::CommerceCost(kind));
            }
        }
        if self.sports.upkeep_permille > 1000 {
            return Err(FacilitiesIssue::SportsUpkeep);
        }
        if self.sports.coach_level_lead > 20 {
            return Err(FacilitiesIssue::CoachLevelLead);
        }
        for (area, days) in [
            (BuildArea::Stands, self.stands.build_days_per_level),
            (BuildArea::Commerce, self.commerce.build_days_per_level),
            (BuildArea::Sports, self.sports.build_days_per_level),
        ] {
            if !(1..=10).contains(&days) {
                return Err(FacilitiesIssue::BuildDays(area));
            }
        }
        if self.cancel_refund_permille > 1000 {
            return Err(FacilitiesIssue::CancelRefund);
        }
        if !(1..=7).contains(&self.time_skip_days) {
            return Err(FacilitiesIssue::TimeSkipDays);
        }
        Ok(())
    }

    fn commerce_first_cost(&self, kind: FacilityKind) -> u64 {
        match kind {
            FacilityKind::Shop => self.commerce.shop_first_cost,
            FacilityKind::Food => self.commerce.food_first_cost,
            FacilityKind::Park => self.commerce.park_first_cost,
            _ => 0,
        }
    }

    /// The top stands level.
    fn stands_top(&self) -> u8 {
        u8::try_from(self.stands.capacities.len()).unwrap_or(u8::MAX)
    }
}

/// `amount × permille / 1000`, rounded down, without overflow.
fn scale(amount: u64, permille: u64) -> u64 {
    clamp_u64(u128::from(amount) * u128::from(permille) / 1000)
}

fn clamp_u64(value: u128) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

/// The top level of `kind`; `academy_max` is the server's (`academy::rules::max_level`).
pub fn max_level(rules: &FacilitiesRules, kind: FacilityKind, academy_max: u8) -> u8 {
    match kind {
        FacilityKind::Stands => rules.stands_top(),
        FacilityKind::Shop | FacilityKind::Food | FacilityKind::Park => rules.commerce.max_level,
        FacilityKind::Training | FacilityKind::Medical => MAX_FACILITY_LEVEL,
        FacilityKind::Academy => academy_max,
    }
}

/// Seats at stands `level` (held to 1..=top); 0 for a block without levels.
pub fn capacity(rules: &FacilitiesRules, level: u8) -> u32 {
    let seats = &rules.stands.capacities;
    let index = usize::from(level.max(1)).min(seats.len()).saturating_sub(1);
    seats.get(index).copied().unwrap_or(0)
}

/// What the next level of `kind` at `level` costs; None at the top. Training and Medical cost
/// `level × upgrade_base` (`economy::facility_upgrade_cost`); the academy's next level costs
/// `academy_next`, the server's (None at its top).
pub fn next_cost(
    rules: &FacilitiesRules,
    kind: FacilityKind,
    level: u8,
    upgrade_base: u64,
    academy_next: Option<u64>,
) -> Option<u64> {
    match kind {
        FacilityKind::Stands => {
            let level = level.max(1);
            if level >= rules.stands_top() {
                return None;
            }
            let added = capacity(rules, level + 1).saturating_sub(capacity(rules, level));
            // The step to level n + 1 costs `seat_cost_at_level2 + seat_cost_step × (n − 1)` a seat.
            let per_seat = u64::from(rules.stands.seat_cost_at_level2)
                + u64::from(rules.stands.seat_cost_step) * u64::from(level - 1);
            Some(u64::from(added).saturating_mul(per_seat))
        }
        FacilityKind::Shop | FacilityKind::Food | FacilityKind::Park => {
            if level >= rules.commerce.max_level {
                return None;
            }
            let doubled = 1u64.checked_shl(u32::from(level)).unwrap_or(u64::MAX);
            Some(rules.commerce_first_cost(kind).saturating_mul(doubled))
        }
        FacilityKind::Training | FacilityKind::Medical => {
            facility_upgrade_cost(level, upgrade_base)
        }
        FacilityKind::Academy => academy_next,
    }
}

/// Season days to build `kind` from `level` to `level + 1`: stands `buildDaysPerLevel × n`,
/// commerce `buildDaysPerLevel × (n + 1)`, Training, Medical and the academy
/// `buildDaysPerLevel × n`. A level under 1 of stands or a sport counts as 1.
pub fn build_days(rules: &FacilitiesRules, kind: FacilityKind, level: u8) -> u32 {
    let (per_level, steps) = match kind {
        FacilityKind::Stands => (rules.stands.build_days_per_level, level.max(1)),
        FacilityKind::Shop | FacilityKind::Food | FacilityKind::Park => {
            (rules.commerce.build_days_per_level, level.saturating_add(1))
        }
        FacilityKind::Training | FacilityKind::Medical | FacilityKind::Academy => {
            (rules.sports.build_days_per_level, level.max(1))
        }
    };
    u32::from(per_level) * u32::from(steps)
}

/// The coach level `kind`'s level `to_level` needs, when the coach's `coach_level` is short of
/// it. Only Training and Medical are ever locked: `to_level > coach_level + lead` →
/// `Some(to_level − lead)` (BR-7). The lead itself never leaves the server.
pub fn locked_until(
    rules: &FacilitiesRules,
    kind: FacilityKind,
    to_level: u8,
    coach_level: u16,
) -> Option<u16> {
    let lead = u16::from(rules.sports.coach_level_lead);
    let to_level = u16::from(to_level);
    (kind.is_sport() && to_level > coach_level.saturating_add(lead)).then(|| to_level - lead)
}

/// One facility's upkeep a season (BR-6), by the catalogue rather than what was paid, so after a
/// downgrade it is the new level's. Stands: `(cap(level) − cap(1)) × seatUpkeepPerMatch ×
/// home_matches`. Training, Medical: `upkeepPermille` of the catalogue price of levels
/// `2..=level` (= `base × level × (level − 1) / 2`). Commerce, Academy: 0.
pub fn upkeep_of(
    rules: &FacilitiesRules,
    kind: FacilityKind,
    level: u8,
    upgrade_base: u64,
    home_matches: u32,
) -> u64 {
    match kind {
        FacilityKind::Stands => {
            let extra_seats = capacity(rules, level).saturating_sub(capacity(rules, 1));
            u64::from(extra_seats)
                .saturating_mul(u64::from(rules.stands.seat_upkeep_per_match))
                .saturating_mul(u64::from(home_matches))
        }
        FacilityKind::Training | FacilityKind::Medical => {
            let level = u128::from(level.clamp(1, MAX_FACILITY_LEVEL));
            let catalogue = u128::from(upgrade_base) * level * (level - 1) / 2;
            clamp_u64(catalogue * u128::from(rules.sports.upkeep_permille) / 1000)
        }
        FacilityKind::Shop | FacilityKind::Food | FacilityKind::Park | FacilityKind::Academy => 0,
    }
}

/// A club's upkeep a season: the sum over its levels.
pub fn upkeep_per_season(
    rules: &FacilitiesRules,
    levels: &FacilityLevels,
    upgrade_base: u64,
    home_matches: u32,
) -> u64 {
    FacilityKind::ALL.into_iter().fold(0u64, |total, kind| {
        total.saturating_add(upkeep_of(
            rules,
            kind,
            levels.get(kind),
            upgrade_base,
            home_matches,
        ))
    })
}

/// Day `day`'s share (0-based) of `per_season` over `season_days`:
/// `amount × (d + 1) / days − amount × d / days`, so a season of unchanged levels pays exactly
/// `per_season`. 0 outside the season.
pub fn upkeep_due(per_season: u64, day: u32, season_days: u32) -> u64 {
    if day >= season_days {
        return 0;
    }
    let amount = u128::from(per_season);
    let days = u128::from(season_days);
    let day = u128::from(day);
    clamp_u64(amount * (day + 1) / days - amount * day / days)
}

/// What the caller knows of a club when it asks for a build or a downgrade.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuildContext {
    pub levels: FacilityLevels,
    pub coach_level: u16,
    /// What the one builder is building, if anything (BR-1).
    pub building: Option<FacilityKind>,
    /// `economy.facilityUpgradeBase`: Training and Medical prices and upkeep.
    pub upgrade_base: u64,
    /// Home league matches a season (`leagueSize − 1`), for the stands' upkeep.
    pub home_matches: u32,
    /// The academy's top level and its next level's price, the server's.
    pub academy_max: u8,
    pub academy_next: Option<u64>,
}

/// The next level of a facility, for the facilities view (R49-1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NextStep {
    pub to_level: u8,
    pub cost: u64,
    pub build_days: u32,
    /// Upkeep a season this level adds (0 for commerce, academy).
    pub upkeep_delta: u64,
    /// Some(coach level needed) when locked.
    pub lock: Option<u16>,
}

/// The next level of `kind`; None at the top.
pub fn next_step(
    rules: &FacilitiesRules,
    ctx: &BuildContext,
    kind: FacilityKind,
) -> Option<NextStep> {
    let level = ctx.levels.get(kind);
    if level >= max_level(rules, kind, ctx.academy_max) {
        return None;
    }
    let cost = next_cost(rules, kind, level, ctx.upgrade_base, ctx.academy_next)?;
    let to_level = level + 1;
    let upkeep = |level| upkeep_of(rules, kind, level, ctx.upgrade_base, ctx.home_matches);
    Some(NextStep {
        to_level,
        cost,
        build_days: build_days(rules, kind, level),
        upkeep_delta: upkeep(to_level).saturating_sub(upkeep(level)),
        lock: locked_until(rules, kind, to_level, ctx.coach_level),
    })
}

/// Why a build cannot start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildRefusal {
    AtTop,
    Locked { coach_level: u16 },
    BuilderBusy,
}

/// Whether a build of `kind` may start now, checked in the order of the card states of c-27 §5.4:
/// at the top, locked, builder busy (also when it is building `kind` itself). Cash, a locked
/// economy, a locked club are the server's, checked after.
pub fn quote_build(
    rules: &FacilitiesRules,
    ctx: &BuildContext,
    kind: FacilityKind,
) -> Result<NextStep, BuildRefusal> {
    let step = next_step(rules, ctx, kind).ok_or(BuildRefusal::AtTop)?;
    if let Some(coach_level) = step.lock {
        return Err(BuildRefusal::Locked { coach_level });
    }
    if ctx.building.is_some() {
        return Err(BuildRefusal::BuilderBusy);
    }
    Ok(step)
}

/// What a downgrade leaves and saves (BR-9).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DowngradeQuote {
    pub to_level: u8,
    /// Upkeep a season the downgrade saves.
    pub upkeep_saving: u64,
}

/// Why a facility cannot be downgraded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DowngradeRefusal {
    /// The academy is never downgraded (Qe514-1).
    NotDowngradable,
    /// Level 1 or under: nothing goes below level 1, commerce included (BR-9).
    AtBottom,
    /// It is the facility being built.
    Building,
}

/// Checked in this order: academy, level ≤ 1, `kind` is the one being built. No refund, no
/// builder: another build running does not stop it.
pub fn quote_downgrade(
    rules: &FacilitiesRules,
    ctx: &BuildContext,
    kind: FacilityKind,
) -> Result<DowngradeQuote, DowngradeRefusal> {
    if kind == FacilityKind::Academy {
        return Err(DowngradeRefusal::NotDowngradable);
    }
    let level = ctx.levels.get(kind);
    if level <= 1 {
        return Err(DowngradeRefusal::AtBottom);
    }
    if ctx.building == Some(kind) {
        return Err(DowngradeRefusal::Building);
    }
    let upkeep = |level| upkeep_of(rules, kind, level, ctx.upgrade_base, ctx.home_matches);
    Ok(DowngradeQuote {
        to_level: level - 1,
        upkeep_saving: upkeep(level).saturating_sub(upkeep(level - 1)),
    })
}

/// What a cancelled build gives back: `paid × cancelRefundPermille / 1000`, rounded down (BR-5).
pub fn cancel_refund(rules: &FacilitiesRules, paid: u64) -> u64 {
    scale(paid, u64::from(rules.cancel_refund_permille))
}

/// A build's length in real seconds: `days × day_seconds` (BR-2).
pub fn build_seconds(days: u32, day_seconds: u32) -> u64 {
    u64::from(days) * u64::from(day_seconds)
}

/// `timeSkip`s that finish a build with `remaining_seconds` left:
/// `⌈remaining / (timeSkipDays × day_seconds)⌉`, 0 when done (BR-4).
pub fn skips_to_finish(rules: &FacilitiesRules, remaining_seconds: u64, day_seconds: u32) -> u32 {
    let per_skip = (u64::from(rules.time_skip_days) * u64::from(day_seconds)).max(1);
    u32::try_from(remaining_seconds.div_ceil(per_skip)).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: u64 = 2_500_000;
    const HOME: u32 = 13;

    fn rules() -> FacilitiesRules {
        FacilitiesRules::proposed()
    }

    fn ctx(
        levels: FacilityLevels,
        coach_level: u16,
        building: Option<FacilityKind>,
    ) -> BuildContext {
        BuildContext {
            levels,
            coach_level,
            building,
            upgrade_base: BASE,
            home_matches: HOME,
            academy_max: 5,
            academy_next: Some(1_000_000),
        }
    }

    const SPEC_JSON: &str = r#"{
      "stands": {
        "capacities": [10000, 12000, 14000, 16500, 19500, 23000, 27000, 31000, 36000, 42000, 50000, 58000, 66000, 75000, 85000, 99000],
        "seatCostAtLevel2": 300, "seatCostStep": 20, "seatUpkeepPerMatch": 2, "buildDaysPerLevel": 2
      },
      "commerce": { "maxLevel": 5, "shopFirstCost": 100000, "foodFirstCost": 60000, "parkFirstCost": 40000, "buildDaysPerLevel": 1 },
      "sports": { "upkeepPermille": 30, "coachLevelLead": 2, "buildDaysPerLevel": 1 },
      "cancelRefundPermille": 500,
      "timeSkipDays": 1
    }"#;

    /// W-1. Given the proposed block, when it is validated and written out, then it is valid,
    /// equals the tech-spec's JSON and reads back as itself.
    #[test]
    fn the_proposed_block_is_valid_and_is_the_spec_json() {
        let proposed = rules();
        assert_eq!(proposed.validate(), Ok(()));
        let spec: FacilitiesRules = serde_json::from_str(SPEC_JSON).expect("the spec JSON reads");
        assert_eq!(spec, proposed);
        let written = serde_json::to_string(&proposed).expect("the block writes");
        let read: FacilitiesRules = serde_json::from_str(&written).expect("the block reads back");
        assert_eq!(read, proposed);
    }

    /// W-1. Given the block with a field it does not know, when it is read, then it is refused,
    /// at the top and inside each part.
    #[test]
    fn an_unknown_field_is_refused() {
        let mut value: serde_json::Value = serde_json::from_str(SPEC_JSON).expect("JSON");
        value["crowd"] = serde_json::json!(1);
        assert!(serde_json::from_value::<FacilitiesRules>(value).is_err());
        for part in ["stands", "commerce", "sports"] {
            let mut value: serde_json::Value = serde_json::from_str(SPEC_JSON).expect("JSON");
            value[part]["extra"] = serde_json::json!(1);
            assert!(
                serde_json::from_value::<FacilitiesRules>(value).is_err(),
                "{part}"
            );
        }
    }

    /// W-1. Given each line of the validate table broken in turn, when the block is validated,
    /// then it gives that line's issue and field.
    #[test]
    fn each_validate_line_gives_its_issue_and_field() {
        type Breaker = fn(&mut FacilitiesRules);
        let cases: Vec<(Breaker, FacilitiesIssue, &str)> = vec![
            (
                |r| r.stands.capacities.truncate(1),
                FacilitiesIssue::StandsCapacities,
                "facilities.stands.capacities",
            ),
            (
                |r| r.stands.capacities = (1..=31).collect(),
                FacilitiesIssue::StandsCapacities,
                "facilities.stands.capacities",
            ),
            (
                |r| r.stands.capacities[0] = 0,
                FacilitiesIssue::StandsCapacities,
                "facilities.stands.capacities",
            ),
            (
                |r| r.stands.capacities[3] = 14_000,
                FacilitiesIssue::StandsCapacities,
                "facilities.stands.capacities",
            ),
            (
                |r| r.stands.seat_cost_at_level2 = 0,
                FacilitiesIssue::StandsSeatCost,
                "facilities.stands.seatCostAtLevel2",
            ),
            (
                |r| r.commerce.max_level = 0,
                FacilitiesIssue::CommerceMaxLevel,
                "facilities.commerce.maxLevel",
            ),
            (
                |r| r.commerce.max_level = 11,
                FacilitiesIssue::CommerceMaxLevel,
                "facilities.commerce.maxLevel",
            ),
            (
                |r| r.commerce.shop_first_cost = 0,
                FacilitiesIssue::CommerceCost(FacilityKind::Shop),
                "facilities.commerce.shopFirstCost",
            ),
            (
                |r| r.commerce.food_first_cost = 0,
                FacilitiesIssue::CommerceCost(FacilityKind::Food),
                "facilities.commerce.foodFirstCost",
            ),
            (
                |r| r.commerce.park_first_cost = 0,
                FacilitiesIssue::CommerceCost(FacilityKind::Park),
                "facilities.commerce.parkFirstCost",
            ),
            (
                |r| r.sports.upkeep_permille = 1001,
                FacilitiesIssue::SportsUpkeep,
                "facilities.sports.upkeepPermille",
            ),
            (
                |r| r.sports.coach_level_lead = 21,
                FacilitiesIssue::CoachLevelLead,
                "facilities.sports.coachLevelLead",
            ),
            (
                |r| r.stands.build_days_per_level = 0,
                FacilitiesIssue::BuildDays(BuildArea::Stands),
                "facilities.stands.buildDaysPerLevel",
            ),
            (
                |r| r.commerce.build_days_per_level = 11,
                FacilitiesIssue::BuildDays(BuildArea::Commerce),
                "facilities.commerce.buildDaysPerLevel",
            ),
            (
                |r| r.sports.build_days_per_level = 0,
                FacilitiesIssue::BuildDays(BuildArea::Sports),
                "facilities.sports.buildDaysPerLevel",
            ),
            (
                |r| r.cancel_refund_permille = 1001,
                FacilitiesIssue::CancelRefund,
                "facilities.cancelRefundPermille",
            ),
            (
                |r| r.time_skip_days = 0,
                FacilitiesIssue::TimeSkipDays,
                "facilities.timeSkipDays",
            ),
            (
                |r| r.time_skip_days = 8,
                FacilitiesIssue::TimeSkipDays,
                "facilities.timeSkipDays",
            ),
        ];
        for (index, (breaker, issue, field)) in cases.into_iter().enumerate() {
            let mut broken = rules();
            breaker(&mut broken);
            assert_eq!(broken.validate(), Err(issue), "case {index}");
            assert_eq!(issue.field(), field, "case {index}");
        }
        // The edges of each range are still valid.
        let mut edge = rules();
        edge.stands.capacities = (1..=30).collect();
        edge.commerce.max_level = 10;
        edge.sports.upkeep_permille = 1000;
        edge.sports.coach_level_lead = 20;
        edge.stands.build_days_per_level = 10;
        edge.cancel_refund_permille = 1000;
        edge.time_skip_days = 7;
        assert_eq!(edge.validate(), Ok(()));
    }

    /// W-2. Seats and the price of each next level.
    #[test]
    fn capacity_and_next_cost_follow_the_catalogue() {
        let r = rules();
        assert_eq!(capacity(&r, 1), 10_000);
        assert_eq!(capacity(&r, 16), 99_000);
        assert_eq!(capacity(&r, 0), 10_000);
        assert_eq!(capacity(&r, 17), 99_000);

        let stands = |level| next_cost(&r, FacilityKind::Stands, level, BASE, None);
        assert_eq!(stands(1), Some(600_000));
        assert_eq!(stands(3), Some(850_000));
        assert_eq!(stands(15), Some(8_120_000));
        assert_eq!(stands(16), None);
        let total: u64 = (1..16)
            .map(|level| stands(level).expect("below the top"))
            .sum();
        assert_eq!(total, 43_320_000);

        let shop: Vec<Option<u64>> = (0..=5)
            .map(|level| next_cost(&r, FacilityKind::Shop, level, BASE, None))
            .collect();
        assert_eq!(
            shop,
            vec![
                Some(100_000),
                Some(200_000),
                Some(400_000),
                Some(800_000),
                Some(1_600_000),
                None
            ]
        );
        let commerce_total = |kind| -> u64 {
            (0..5)
                .map(|level| next_cost(&r, kind, level, BASE, None).expect("below"))
                .sum()
        };
        assert_eq!(commerce_total(FacilityKind::Shop), 3_100_000);
        assert_eq!(commerce_total(FacilityKind::Food), 1_860_000);
        assert_eq!(commerce_total(FacilityKind::Park), 1_240_000);

        let training = |level| next_cost(&r, FacilityKind::Training, level, BASE, None);
        assert_eq!(training(1), Some(2_500_000));
        assert_eq!(training(9), Some(22_500_000));
        assert_eq!(training(10), None);
        assert_eq!(
            next_cost(&r, FacilityKind::Medical, 2, BASE, None),
            Some(5_000_000)
        );

        assert_eq!(
            next_cost(&r, FacilityKind::Academy, 2, BASE, Some(777)),
            Some(777)
        );
        assert_eq!(next_cost(&r, FacilityKind::Academy, 2, BASE, None), None);
    }

    /// W-2. The top level of each kind.
    #[test]
    fn each_kind_has_its_top_level() {
        let r = rules();
        assert_eq!(max_level(&r, FacilityKind::Stands, 5), 16);
        assert_eq!(max_level(&r, FacilityKind::Park, 5), 5);
        assert_eq!(max_level(&r, FacilityKind::Medical, 5), 10);
        assert_eq!(max_level(&r, FacilityKind::Academy, 4), 4);
    }

    /// W-3. Build times.
    #[test]
    fn build_days_follow_the_catalogue() {
        let r = rules();
        assert_eq!(build_days(&r, FacilityKind::Stands, 1), 2);
        assert_eq!(build_days(&r, FacilityKind::Stands, 15), 30);
        let total: u32 = (1..16)
            .map(|level| build_days(&r, FacilityKind::Stands, level))
            .sum();
        assert_eq!(total, 240);
        assert_eq!(build_days(&r, FacilityKind::Shop, 0), 1);
        assert_eq!(build_days(&r, FacilityKind::Food, 4), 5);
        assert_eq!(build_days(&r, FacilityKind::Training, 1), 1);
        assert_eq!(build_days(&r, FacilityKind::Training, 9), 9);
        assert_eq!(build_days(&r, FacilityKind::Academy, 1), 1);
    }

    /// W-4. BR-7: Training and Medical wait for the coach; nothing else does.
    #[test]
    fn only_training_and_medical_wait_for_the_coach() {
        let r = rules();
        for kind in [FacilityKind::Training, FacilityKind::Medical] {
            assert_eq!(locked_until(&r, kind, 3, 1), None);
            assert_eq!(locked_until(&r, kind, 4, 1), Some(2));
            assert_eq!(locked_until(&r, kind, 10, 8), None);
            assert_eq!(locked_until(&r, kind, 10, 7), Some(8));
        }
        for kind in [
            FacilityKind::Stands,
            FacilityKind::Shop,
            FacilityKind::Food,
            FacilityKind::Park,
            FacilityKind::Academy,
        ] {
            assert_eq!(locked_until(&r, kind, 16, 1), None, "{kind:?}");
        }
    }

    /// W-5. BR-1 and the order of refusals: top, locked, builder busy.
    #[test]
    fn a_build_is_refused_in_the_card_order() {
        let r = rules();
        let opening = FacilityLevels::OPENING;
        let busy = Some(FacilityKind::Shop);
        let at_ten = ctx(opening.with(FacilityKind::Training, 10), 20, busy);
        assert_eq!(
            quote_build(&r, &at_ten, FacilityKind::Training),
            Err(BuildRefusal::AtTop)
        );
        let three = ctx(opening.with(FacilityKind::Training, 3), 1, busy);
        assert_eq!(
            quote_build(&r, &three, FacilityKind::Training),
            Err(BuildRefusal::Locked { coach_level: 2 })
        );
        let stands = opening.with(FacilityKind::Stands, 3);
        assert_eq!(
            quote_build(&r, &ctx(stands, 1, busy), FacilityKind::Stands),
            Err(BuildRefusal::BuilderBusy)
        );
        assert_eq!(
            quote_build(
                &r,
                &ctx(stands, 1, Some(FacilityKind::Stands)),
                FacilityKind::Stands
            ),
            Err(BuildRefusal::BuilderBusy)
        );
        assert_eq!(
            quote_build(&r, &ctx(stands, 1, None), FacilityKind::Stands),
            Ok(NextStep {
                to_level: 4,
                cost: 850_000,
                build_days: 6,
                upkeep_delta: 65_000,
                lock: None
            })
        );
        let mut academy_top = ctx(opening.with(FacilityKind::Academy, 5), 1, None);
        assert_eq!(
            quote_build(&r, &academy_top, FacilityKind::Academy),
            Err(BuildRefusal::AtTop)
        );
        academy_top.academy_next = None;
        academy_top.levels = opening;
        assert_eq!(
            quote_build(&r, &academy_top, FacilityKind::Academy),
            Err(BuildRefusal::AtTop)
        );
    }

    /// W-5. The view's next step shows a lock without refusing.
    #[test]
    fn the_next_step_carries_its_lock_and_upkeep() {
        let r = rules();
        let levels = FacilityLevels::OPENING.with(FacilityKind::Training, 5);
        let step =
            next_step(&r, &ctx(levels, 1, None), FacilityKind::Training).expect("below the top");
        assert_eq!(
            step,
            NextStep {
                to_level: 6,
                cost: 12_500_000,
                build_days: 5,
                upkeep_delta: 375_000,
                lock: Some(4)
            }
        );
        let shop = next_step(
            &r,
            &ctx(FacilityLevels::OPENING, 1, None),
            FacilityKind::Shop,
        );
        assert_eq!(
            shop,
            Some(NextStep {
                to_level: 1,
                cost: 100_000,
                build_days: 1,
                upkeep_delta: 0,
                lock: None
            })
        );
    }

    /// W-6. BR-6: upkeep a season and by the day.
    #[test]
    fn upkeep_follows_the_catalogue_and_sums_by_the_day() {
        let r = rules();
        let stands = |level| upkeep_of(&r, FacilityKind::Stands, level, BASE, HOME);
        assert_eq!(
            [stands(1), stands(2), stands(4), stands(16)],
            [0, 52_000, 169_000, 2_314_000]
        );
        let training = |level| upkeep_of(&r, FacilityKind::Training, level, BASE, HOME);
        assert_eq!(
            [training(1), training(2), training(6), training(10)],
            [0, 75_000, 1_125_000, 3_375_000]
        );
        for kind in [
            FacilityKind::Shop,
            FacilityKind::Food,
            FacilityKind::Park,
            FacilityKind::Academy,
        ] {
            assert_eq!(upkeep_of(&r, kind, 5, BASE, HOME), 0, "{kind:?}");
        }
        let levels = FacilityLevels::OPENING
            .with(FacilityKind::Stands, 4)
            .with(FacilityKind::Training, 2)
            .with(FacilityKind::Medical, 2);
        assert_eq!(upkeep_per_season(&r, &levels, BASE, HOME), 319_000);

        assert_eq!(upkeep_due(169_000, 0, 28), 6_035);
        assert_eq!(upkeep_due(169_000, 1, 28), 6_036);
        for amount in [0, 1, 27, 52_000, 169_000, 2_314_000, 3_375_001] {
            let total: u64 = (0..28).map(|day| upkeep_due(amount, day, 28)).sum();
            assert_eq!(total, amount, "{amount}");
        }
        assert_eq!(upkeep_due(169_000, 28, 28), 0);
        assert_eq!(upkeep_due(169_000, 0, 0), 0);
    }

    /// W-7. BR-9: downgrades.
    #[test]
    fn a_downgrade_saves_upkeep_and_never_goes_under_one() {
        let r = rules();
        let opening = FacilityLevels::OPENING;
        let quote = |levels, building, kind| quote_downgrade(&r, &ctx(levels, 1, building), kind);
        assert_eq!(
            quote(
                opening.with(FacilityKind::Stands, 4),
                None,
                FacilityKind::Stands
            ),
            Ok(DowngradeQuote {
                to_level: 3,
                upkeep_saving: 65_000
            })
        );
        assert_eq!(
            quote(
                opening.with(FacilityKind::Training, 6),
                None,
                FacilityKind::Training
            ),
            Ok(DowngradeQuote {
                to_level: 5,
                upkeep_saving: 375_000
            })
        );
        assert_eq!(
            quote(opening, None, FacilityKind::Training),
            Err(DowngradeRefusal::AtBottom)
        );
        assert_eq!(
            quote(
                opening.with(FacilityKind::Shop, 1),
                None,
                FacilityKind::Shop
            ),
            Err(DowngradeRefusal::AtBottom)
        );
        assert_eq!(
            quote(
                opening.with(FacilityKind::Shop, 3),
                None,
                FacilityKind::Shop
            ),
            Ok(DowngradeQuote {
                to_level: 2,
                upkeep_saving: 0
            })
        );
        assert_eq!(
            quote(
                opening.with(FacilityKind::Academy, 4),
                None,
                FacilityKind::Academy
            ),
            Err(DowngradeRefusal::NotDowngradable)
        );
        let stands = opening.with(FacilityKind::Stands, 4);
        assert_eq!(
            quote(stands, Some(FacilityKind::Stands), FacilityKind::Stands),
            Err(DowngradeRefusal::Building)
        );
        assert_eq!(
            quote(stands, Some(FacilityKind::Shop), FacilityKind::Stands),
            Ok(DowngradeQuote {
                to_level: 3,
                upkeep_saving: 65_000
            })
        );
    }

    /// W-8. BR-5: half back, rounded down.
    #[test]
    fn a_cancelled_build_gives_half_back() {
        let r = rules();
        assert_eq!(cancel_refund(&r, 850_000), 425_000);
        assert_eq!(cancel_refund(&r, 1_080_001), 540_000);
        assert_eq!(cancel_refund(&r, 0), 0);
        assert_eq!(cancel_refund(&r, u64::MAX), u64::MAX / 2);
    }

    /// W-9. BR-2, BR-4: real seconds and time skips.
    #[test]
    fn build_seconds_and_skips() {
        let r = rules();
        assert_eq!(build_seconds(6, 3_600), 21_600);
        assert_eq!(build_seconds(30, 86_400), 2_592_000);
        assert_eq!(skips_to_finish(&r, 21_600, 3_600), 6);
        assert_eq!(skips_to_finish(&r, 19_800, 3_600), 6);
        assert_eq!(skips_to_finish(&r, 1, 3_600), 1);
        assert_eq!(skips_to_finish(&r, 0, 3_600), 0);
    }

    /// W-10. Codes go round and are serde's strings; anything else is no kind.
    #[test]
    fn codes_are_the_serde_strings() {
        for kind in FacilityKind::ALL {
            assert_eq!(FacilityKind::from_code(kind.code()), Some(kind));
            let serde = serde_json::to_value(kind).expect("a kind writes");
            assert_eq!(serde, serde_json::Value::String(kind.code().to_string()));
        }
        for other in ["scouting", "", "Stands"] {
            assert_eq!(FacilityKind::from_code(other), None, "{other}");
        }
    }

    /// E514-3. The opening levels, `with`, and the sports as the game's facility types.
    #[test]
    fn opening_levels_and_sports() {
        let opening = FacilityLevels::OPENING;
        let levels: Vec<u8> = FacilityKind::ALL
            .iter()
            .map(|&kind| opening.get(kind))
            .collect();
        assert_eq!(levels, vec![1, 0, 0, 0, 1, 1, 1]);
        for kind in FacilityKind::ALL {
            assert_eq!(opening.with(kind, 7).get(kind), 7);
        }
        assert_eq!(
            FacilityKind::Training.as_sport(),
            Some(FacilityType::Training)
        );
        assert_eq!(
            FacilityKind::Medical.as_sport(),
            Some(FacilityType::Medical)
        );
        assert_eq!(FacilityKind::Stands.as_sport(), None);
        assert_eq!(FacilityKind::Academy.as_sport(), None);
    }
}
