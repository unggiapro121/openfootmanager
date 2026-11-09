//! What a home league match draws and earns online (E5-14, analysis-facilities-rework §3.5,
//! §3.6, §3.8): demand by league level, form and the opponent's pull, the four ticket prices,
//! attendance and the fans left outside, ticket and commerce income, the crowd's home advantage
//! `h(c)` and the atmosphere label, and the stands a bot keeps.
//!
//! Online only: nothing in the game calls this module, and `ofm_core` does not re-export it; the
//! game's home advantage stays the engine's 1,10 (Dfac-13). The server reads the `matchday` block
//! of a season's ruleset. Whole numbers only (E514-2); the one `f64` is
//! [`home_advantage_f64`], for the match configuration.
//!
//! Hidden (AC-5): the reference demand `D_ref`, the raw demand, the crowd ratio `c` and the
//! advantage's parameters are private to this module or held only in the ruleset. No public
//! function returns them.

use serde::{Deserialize, Serialize};

use crate::facility_works::{FacilitiesRules, capacity};

/// A season's `matchday` block (E514-12).
///
/// A field added later needs `#[serde(default)]`: the block denies unknown fields, and a ruleset
/// already published must still read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MatchdayRules {
    /// Fans an ordinary home match of league level 1, 2, … draws (`D_ref`, hidden).
    pub demand_by_level: Vec<u32>,
    /// A level past the table grows the last by this, in ‰, each step rounded down.
    pub demand_beyond_permille: u32,
    /// Ticket income a spectator at level 1, in thousandths of a euro; `ticketIncomePermille`
    /// folded in.
    pub ticket_first_milli: u64,
    /// Each level up grows it by this, in ‰, each step rounded down.
    pub ticket_growth_permille: u32,
    pub form: FormRules,
    pub pull: PullRules,
    pub prices: PriceTable,
    /// Demand a car-park level adds, in ‰.
    pub park_demand_permille_per_level: u16,
    /// Income a spectator a commerce level adds, in ‰ of the level's ticket income.
    pub commerce_permille_per_level: CommerceShares,
    /// Fans locked out are shown rounded to this.
    pub locked_out_rounding: u32,
    /// `c` in ‰ where Normal, Lively, Electric start (Dfac-3). Hidden.
    pub atmosphere_bands: [u16; 3],
    /// Whether matches carry an atmosphere label at all (Dfac-3).
    pub atmosphere_label: bool,
    /// The crowd's home advantage (Dfac-2). None: no league match changes its home advantage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crowd_advantage: Option<CrowdAdvantage>,
}

/// How the home side's recent league results move demand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormRules {
    /// League matches counted, the last ones of this season.
    pub window: u8,
    /// Demand in ‰ with no points from a full window; all points add `span_permille`.
    pub low_permille: u16,
    pub span_permille: u16,
}

/// How the opponent moves demand: the larger of the two applies, never both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PullRules {
    /// An opponent this high in the table or higher is a top side.
    pub top_places: u32,
    pub top_permille: u16,
    /// An opponent a human coach runs.
    pub human_permille: u16,
}

/// The four ticket prices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PriceTable {
    pub low: PriceRule,
    pub medium: PriceRule,
    pub high: PriceRule,
    pub very_high: PriceRule,
}

/// One ticket price: what a ticket brings and what it does to demand, both in ‰ of Medium's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PriceRule {
    pub price_permille: u16,
    pub demand_permille: u16,
}

/// Income a spectator each commerce level adds, in ‰ of the match's ticket income a spectator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommerceShares {
    pub shop: u16,
    pub food: u16,
    pub park: u16,
}

/// The crowd's home advantage, `h = 1 + h0 + hc × min(c, c_max)`. Hidden.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CrowdAdvantage {
    /// `h0` in ‰.
    pub base_permille: u16,
    /// `hc` in ‰ a full crowd (`c` = 1.000).
    pub crowd_permille: u16,
    /// `c_max` in ‰ of `D_ref`.
    pub cap_permille: u16,
}

impl CrowdAdvantage {
    /// The analysis' numbers (§3.6): 1,09 with a full crowd, as E5-7a measured.
    pub const PROPOSED: Self = Self {
        base_permille: 45,
        crowd_permille: 45,
        cap_permille: 1150,
    };
}

/// The highest home advantage a crowd may give, in millionths: the top of
/// `matchConfig.home_advantage`'s range on the server.
const MAX_HOME_ADVANTAGE_MICROS: u64 = 1_300_000;

/// Why a [`MatchdayRules`] cannot be run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchdayIssue {
    /// Empty, a level with no fans, or fewer fans at a higher level.
    DemandByLevel,
    /// `demandBeyondPermille` outside 1.000–2.000.
    DemandBeyond,
    /// `ticketFirstMilli` 0.
    TicketFirst,
    /// `ticketGrowthPermille` outside 1.000–1.500.
    TicketGrowth,
    /// `form.window` 0 or above 10, or `lowPermille + spanPermille` above 2.000.
    Form,
    /// `pull.topPlaces` 0, or a factor outside 1.000–2.000.
    Pull,
    /// A price outside 1–5.000 or its demand outside 1–2.000.
    Prices(TicketPrice),
    /// `parkDemandPermillePerLevel` above 200.
    ParkDemand,
    /// A commerce share above 200.
    CommerceShare,
    /// `lockedOutRounding` 0.
    LockedOutRounding,
    /// A band at 0, or bands not rising.
    AtmosphereBands,
    /// With a crowd advantage, "Electric" starting at or above `c_max` (Dfac-3).
    AtmosphereAboveCap,
    /// `capPermille` 0, or a full crowd's advantage above 1,3.
    CrowdAdvantage,
}

impl MatchdayIssue {
    /// The camelCase path of the field at fault, for the server's ruleset issue.
    pub fn field(&self) -> &'static str {
        match self {
            Self::DemandByLevel => "matchday.demandByLevel",
            Self::DemandBeyond => "matchday.demandBeyondPermille",
            Self::TicketFirst => "matchday.ticketFirstMilli",
            Self::TicketGrowth => "matchday.ticketGrowthPermille",
            Self::Form => "matchday.form",
            Self::Pull => "matchday.pull",
            Self::Prices(TicketPrice::Low) => "matchday.prices.low",
            Self::Prices(TicketPrice::Medium) => "matchday.prices.medium",
            Self::Prices(TicketPrice::High) => "matchday.prices.high",
            Self::Prices(TicketPrice::VeryHigh) => "matchday.prices.veryHigh",
            Self::ParkDemand => "matchday.parkDemandPermillePerLevel",
            Self::CommerceShare => "matchday.commercePermillePerLevel",
            Self::LockedOutRounding => "matchday.lockedOutRounding",
            Self::AtmosphereBands | Self::AtmosphereAboveCap => "matchday.atmosphereBands",
            Self::CrowdAdvantage => "matchday.crowdAdvantage",
        }
    }
}

impl MatchdayRules {
    /// The analysis' numbers of bản 3, the tests' reference; `crowd_advantage` None (Dfac-2: off
    /// until E5-15b, D-P5-5). No ruleset is published from these: they fail E5-15's step 0, and
    /// the published blocks carry analysis bản 4's (D-P5-9, D-P5-24).
    pub fn proposed() -> Self {
        let price = |price_permille, demand_permille| PriceRule {
            price_permille,
            demand_permille,
        };
        Self {
            demand_by_level: vec![
                9_500, 10_000, 10_800, 11_700, 12_700, 13_800, 15_200, 17_000, 19_500, 23_000,
                27_000, 32_000, 38_500, 46_000, 55_000,
            ],
            demand_beyond_permille: 1100,
            ticket_first_milli: 23_000,
            ticket_growth_permille: 1015,
            form: FormRules {
                window: 5,
                low_permille: 850,
                span_permille: 300,
            },
            pull: PullRules {
                top_places: 4,
                top_permille: 1100,
                human_permille: 1150,
            },
            prices: PriceTable {
                low: price(850, 1120),
                medium: price(1000, 1000),
                high: price(1200, 860),
                very_high: price(1400, 720),
            },
            park_demand_permille_per_level: 20,
            commerce_permille_per_level: CommerceShares {
                shop: 20,
                food: 12,
                park: 8,
            },
            locked_out_rounding: 100,
            atmosphere_bands: [700, 950, 1080],
            atmosphere_label: true,
            crowd_advantage: None,
        }
    }

    /// Whether a season can run this block, checked in the order of the issues; the crowd
    /// advantage's own range before its bands.
    pub fn validate(&self) -> Result<(), MatchdayIssue> {
        let demand = &self.demand_by_level;
        if demand.is_empty() || demand.contains(&0) || demand.windows(2).any(|p| p[1] < p[0]) {
            return Err(MatchdayIssue::DemandByLevel);
        }
        if !(1000..=2000).contains(&self.demand_beyond_permille) {
            return Err(MatchdayIssue::DemandBeyond);
        }
        if self.ticket_first_milli == 0 {
            return Err(MatchdayIssue::TicketFirst);
        }
        if !(1000..=1500).contains(&self.ticket_growth_permille) {
            return Err(MatchdayIssue::TicketGrowth);
        }
        let form = self.form;
        if !(1..=10).contains(&form.window)
            || u32::from(form.low_permille) + u32::from(form.span_permille) > 2000
        {
            return Err(MatchdayIssue::Form);
        }
        let pull = self.pull;
        let factor = 1000..=2000;
        if pull.top_places == 0
            || !factor.contains(&pull.top_permille)
            || !factor.contains(&pull.human_permille)
        {
            return Err(MatchdayIssue::Pull);
        }
        for price in TicketPrice::ALL {
            let rule = self.price(price);
            if !(1..=5000).contains(&rule.price_permille)
                || !(1..=2000).contains(&rule.demand_permille)
            {
                return Err(MatchdayIssue::Prices(price));
            }
        }
        if self.park_demand_permille_per_level > 200 {
            return Err(MatchdayIssue::ParkDemand);
        }
        let shares = self.commerce_permille_per_level;
        if [shares.shop, shares.food, shares.park]
            .iter()
            .any(|&share| share > 200)
        {
            return Err(MatchdayIssue::CommerceShare);
        }
        if self.locked_out_rounding == 0 {
            return Err(MatchdayIssue::LockedOutRounding);
        }
        let bands = self.atmosphere_bands;
        if bands.contains(&0) || bands.windows(2).any(|pair| pair[1] <= pair[0]) {
            return Err(MatchdayIssue::AtmosphereBands);
        }
        if let Some(crowd) = self.crowd_advantage {
            if crowd.cap_permille == 0
                || home_advantage_micros(crowd, u32::from(crowd.cap_permille))
                    > MAX_HOME_ADVANTAGE_MICROS
            {
                return Err(MatchdayIssue::CrowdAdvantage);
            }
            if bands[2] >= crowd.cap_permille {
                return Err(MatchdayIssue::AtmosphereAboveCap);
            }
        }
        Ok(())
    }

    fn price(&self, price: TicketPrice) -> PriceRule {
        match price {
            TicketPrice::Low => self.prices.low,
            TicketPrice::Medium => self.prices.medium,
            TicketPrice::High => self.prices.high,
            TicketPrice::VeryHigh => self.prices.very_high,
        }
    }
}

/// The ticket price a club sets for its home matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub enum TicketPrice {
    Low,
    #[default]
    Medium,
    High,
    VeryHigh,
}

impl TicketPrice {
    /// Every price, cheapest first: the order of [`projections`].
    pub const ALL: [Self; 4] = [Self::Low, Self::Medium, Self::High, Self::VeryHigh];
}

/// What the crowd of a league match sounds like (R49-5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub enum Atmosphere {
    Quiet,
    Normal,
    Lively,
    Electric,
}

/// The home side's last league results of this season: `points` won in its last `matches` (at
/// most the form window; 0 matches at a season's start).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Form {
    pub points: u8,
    pub matches: u8,
}

/// A club's commerce levels; 0 = not built.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CommerceLevels {
    pub shop: u8,
    pub food: u8,
    pub park: u8,
}

/// A home league match, as the server knows it when it prepares the match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MatchdayInput {
    /// 0 counts as 1.
    pub league_level: u32,
    pub capacity: u32,
    pub price: TicketPrice,
    pub form: Form,
    /// The opponent's place in the table, 1-based; None before it means anything (Qe514-4).
    pub opponent_rank: Option<u32>,
    pub opponent_human: bool,
    pub commerce: CommerceLevels,
}

/// What a home league match draws and earns. Nothing in it is hidden (AC-5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchdayOutcome {
    pub attendance: u32,
    pub capacity: u32,
    /// `attendance × 1000 / capacity`, rounded down; 0 for no seats.
    pub fill_permille: u16,
    /// Demand above the seats (Qe514-2).
    pub sold_out: bool,
    /// Fans left outside, rounded (Qe514-2); 0 when not sold out.
    pub locked_out: u32,
    pub ticket_revenue: u64,
    pub commerce_revenue: u64,
}

fn clamp_u64(value: u128) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

fn clamp_u32(value: u128) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

/// `value` grown by `permille` / 1000 for each of `steps`, rounded down each step. Stops early
/// once a step changes nothing, so a level far past the table does not loop for ever.
fn grow(mut value: u128, permille: u32, steps: u32, ceiling: u128) -> u128 {
    for _ in 0..steps {
        let next = (value * u128::from(permille) / 1000).min(ceiling);
        if next == value {
            break;
        }
        value = next;
    }
    value
}

/// Fans an ordinary home match of `league_level` draws, `D_ref` (hidden).
fn demand_ref(rules: &MatchdayRules, league_level: u32) -> u32 {
    let table = &rules.demand_by_level;
    let level = league_level.max(1);
    let last = u32::try_from(table.len()).unwrap_or(u32::MAX);
    if level <= last {
        return table[(level - 1) as usize];
    }
    let top = u128::from(table.last().copied().unwrap_or(0));
    clamp_u32(grow(
        top,
        rules.demand_beyond_permille,
        level - last,
        u128::from(u32::MAX),
    ))
}

/// Ticket income a spectator at `league_level` at the Medium price, in thousandths of a euro.
pub fn ticket_milli(rules: &MatchdayRules, league_level: u32) -> u64 {
    let steps = league_level.max(1) - 1;
    let first = u128::from(rules.ticket_first_milli);
    clamp_u64(grow(
        first,
        rules.ticket_growth_permille,
        steps,
        u128::from(u64::MAX),
    ))
}

/// The home side's form, in ‰ of demand: 1.000 with no league match yet, else
/// `low + span × points / (3 × n)` over its last `n` = min(matches, window) matches.
pub fn form_permille(rules: &MatchdayRules, form: Form) -> u16 {
    let counted = u32::from(form.matches.min(rules.form.window));
    if counted == 0 {
        return 1000;
    }
    let most = 3 * counted;
    let points = u32::from(form.points).min(most);
    let permille =
        u32::from(rules.form.low_permille) + u32::from(rules.form.span_permille) * points / most;
    u16::try_from(permille).unwrap_or(u16::MAX)
}

/// The opponent's pull, in ‰ of demand: the largest of 1.000, the top sides' factor and the
/// human coaches' factor, never multiplied together.
pub fn pull_permille(
    rules: &MatchdayRules,
    opponent_rank: Option<u32>,
    opponent_human: bool,
) -> u16 {
    let top = opponent_rank
        .filter(|&rank| rank <= rules.pull.top_places)
        .map_or(1000, |_| rules.pull.top_permille);
    let human = if opponent_human {
        rules.pull.human_permille
    } else {
        1000
    };
    top.max(human).max(1000)
}

/// Fans who want a ticket (hidden): `D_ref × form × pull × price demand × (1.000 + park × level)`,
/// over 10¹², rounded down.
fn demand(rules: &MatchdayRules, input: &MatchdayInput) -> u32 {
    let park =
        1000 + u128::from(rules.park_demand_permille_per_level) * u128::from(input.commerce.park);
    let wanted = u128::from(demand_ref(rules, input.league_level))
        * u128::from(form_permille(rules, input.form))
        * u128::from(pull_permille(
            rules,
            input.opponent_rank,
            input.opponent_human,
        ))
        * u128::from(rules.price(input.price).demand_permille)
        * park;
    clamp_u32(wanted / 1_000_000_000_000)
}

/// Fans left outside: the excess rounded half up to the rounding, at least one rounding.
fn locked_out(rules: &MatchdayRules, wanted: u32, seats: u32) -> u32 {
    if wanted <= seats {
        return 0;
    }
    let rounding = rules.locked_out_rounding.max(1);
    let excess = wanted - seats;
    let rounded = (excess.saturating_add(rounding / 2) / rounding).saturating_mul(rounding);
    rounded.max(rounding)
}

/// `attendance × ticket milli × permille / 10⁶`, rounded down.
fn income(attendance: u32, milli: u64, permille: u64) -> u64 {
    clamp_u64(u128::from(attendance) * u128::from(milli) * u128::from(permille) / 1_000_000)
}

/// The commerce rate of the levels built, in ‰ of the ticket a spectator: a sum of
/// `share × level`.
fn commerce_rates(rules: &MatchdayRules, commerce: CommerceLevels) -> [u64; 3] {
    let shares = rules.commerce_permille_per_level;
    [
        u64::from(shares.shop) * u64::from(commerce.shop),
        u64::from(shares.food) * u64::from(commerce.food),
        u64::from(shares.park) * u64::from(commerce.park),
    ]
}

/// What a home league match draws and earns (§3.5). Attendance never passes the seats nor the
/// demand: money buys seats, not fans. Commerce does not follow the ticket price.
pub fn matchday(rules: &MatchdayRules, input: &MatchdayInput) -> MatchdayOutcome {
    let wanted = demand(rules, input);
    let attendance = wanted.min(input.capacity);
    let milli = ticket_milli(rules, input.league_level);
    let fill_permille = if input.capacity == 0 {
        0
    } else {
        u16::try_from(u64::from(attendance) * 1000 / u64::from(input.capacity)).unwrap_or(u16::MAX)
    };
    let commerce_rate: u64 = commerce_rates(rules, input.commerce).iter().sum();
    MatchdayOutcome {
        attendance,
        capacity: input.capacity,
        fill_permille,
        sold_out: wanted > input.capacity,
        locked_out: locked_out(rules, wanted, input.capacity),
        ticket_revenue: income(
            attendance,
            milli,
            u64::from(rules.price(input.price).price_permille),
        ),
        commerce_revenue: income(attendance, milli, commerce_rate),
    }
}

/// Each building's share of a match's commerce, `[shop, food, park]`, each
/// `attendance × p(L) milli × share × level / 10⁶` rounded down (R514-1). For the cards' "this
/// season" only: the ledger posts [`MatchdayOutcome::commerce_revenue`], rounded once, so the
/// three may sum to up to 2 € less a match.
pub fn commerce_parts(
    rules: &MatchdayRules,
    league_level: u32,
    attendance: u32,
    commerce: CommerceLevels,
) -> [u64; 3] {
    let milli = ticket_milli(rules, league_level);
    commerce_rates(rules, commerce).map(|rate| income(attendance, milli, rate))
}

/// [`matchday`] at each price, in the order low, medium, high, veryHigh; `input.price` is
/// ignored. No atmosphere: a label must not be probed price by price (R49-4).
pub fn projections(
    rules: &MatchdayRules,
    input: &MatchdayInput,
) -> [(TicketPrice, MatchdayOutcome); 4] {
    TicketPrice::ALL.map(|price| (price, matchday(rules, &MatchdayInput { price, ..*input })))
}

/// What a league match's crowd does: the home advantage in millionths when the season has a
/// crowd advantage (else None: the match keeps its configuration's), and the atmosphere label
/// when labels are on (else None). Deliberately not `Serialize`: the server takes the label for
/// views and the advantage for the match configuration, never the struct.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrowdEffect {
    pub home_advantage_micros: Option<u32>,
    pub atmosphere: Option<Atmosphere>,
}

/// The crowd ratio `c`, in ‰ of `D_ref` (hidden).
fn crowd_permille(rules: &MatchdayRules, league_level: u32, attendance: u32) -> u32 {
    let reference = u64::from(demand_ref(rules, league_level).max(1));
    u32::try_from(u64::from(attendance) * 1000 / reference).unwrap_or(u32::MAX)
}

/// `1.000.000 + 1.000 × h0 + hc × min(c, c_max)` millionths: no division, so no rounding.
fn home_advantage_micros(crowd: CrowdAdvantage, crowd_permille: u32) -> u64 {
    1_000_000
        + 1000 * u64::from(crowd.base_permille)
        + u64::from(crowd.crowd_permille)
            * u64::from(crowd_permille.min(u32::from(crowd.cap_permille)))
}

fn atmosphere_of(bands: [u16; 3], crowd_permille: u32) -> Atmosphere {
    let [normal, lively, electric] = bands.map(u32::from);
    if crowd_permille < normal {
        Atmosphere::Quiet
    } else if crowd_permille < lively {
        Atmosphere::Normal
    } else if crowd_permille < electric {
        Atmosphere::Lively
    } else {
        Atmosphere::Electric
    }
}

/// The crowd's effect on a league match of `league_level` with `attendance` (§3.6). The label
/// follows `atmosphereLabel` only, never the crowd advantage's switch (Qe514-3).
pub fn crowd_effect(rules: &MatchdayRules, league_level: u32, attendance: u32) -> CrowdEffect {
    let crowd = crowd_permille(rules, league_level, attendance);
    CrowdEffect {
        home_advantage_micros: rules.crowd_advantage.map(|advantage| {
            u32::try_from(home_advantage_micros(advantage, crowd)).unwrap_or(u32::MAX)
        }),
        atmosphere: rules
            .atmosphere_label
            .then(|| atmosphere_of(rules.atmosphere_bands, crowd)),
    }
}

/// `micros / 1.000.000` for `MatchConfig.home_advantage`: one correctly rounded division, stored
/// in the match setup so a replay never recomputes it.
pub fn home_advantage_f64(micros: u32) -> f64 {
    f64::from(micros) / 1_000_000.0
}

/// The stands a bot keeps at `league_level` (§3.8, AC-9): the smallest level whose seats reach
/// `D_ref`, the top level when none does.
pub fn bot_stands_level(
    facilities: &FacilitiesRules,
    rules: &MatchdayRules,
    league_level: u32,
) -> u8 {
    let reference = demand_ref(rules, league_level);
    let top = u8::try_from(facilities.stands.capacities.len()).unwrap_or(u8::MAX);
    (1..=top)
        .find(|&level| capacity(facilities, level) >= reference)
        .unwrap_or(top)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> MatchdayRules {
        MatchdayRules::proposed()
    }

    /// An ordinary home match: no commerce, form (7, 5), a mid-table bot, Medium.
    fn input(league_level: u32, capacity: u32) -> MatchdayInput {
        MatchdayInput {
            league_level,
            capacity,
            price: TicketPrice::Medium,
            form: Form {
                points: 7,
                matches: 5,
            },
            opponent_rank: None,
            opponent_human: false,
            commerce: CommerceLevels::default(),
        }
    }

    const SPEC_JSON: &str = r#"{
      "demandByLevel": [9500, 10000, 10800, 11700, 12700, 13800, 15200, 17000, 19500, 23000, 27000, 32000, 38500, 46000, 55000],
      "demandBeyondPermille": 1100,
      "ticketFirstMilli": 23000,
      "ticketGrowthPermille": 1015,
      "form": { "window": 5, "lowPermille": 850, "spanPermille": 300 },
      "pull": { "topPlaces": 4, "topPermille": 1100, "humanPermille": 1150 },
      "prices": {
        "low": { "pricePermille": 850, "demandPermille": 1120 },
        "medium": { "pricePermille": 1000, "demandPermille": 1000 },
        "high": { "pricePermille": 1200, "demandPermille": 860 },
        "veryHigh": { "pricePermille": 1400, "demandPermille": 720 }
      },
      "parkDemandPermillePerLevel": 20,
      "commercePermillePerLevel": { "shop": 20, "food": 12, "park": 8 },
      "lockedOutRounding": 100,
      "atmosphereBands": [700, 950, 1080],
      "atmosphereLabel": true
    }"#;

    /// M-1, AC-2. Given a level-1 home match at 10.000 seats, when it is played at Medium, then
    /// 9.405 come and pay 216.315 €.
    #[test]
    fn a_level_one_match_draws_the_analysis_crowd() {
        assert_eq!(
            matchday(&rules(), &input(1, 10_000)),
            MatchdayOutcome {
                attendance: 9_405,
                capacity: 10_000,
                fill_permille: 940,
                sold_out: false,
                locked_out: 0,
                ticket_revenue: 216_315,
                commerce_revenue: 0,
            }
        );
    }

    /// M-2, AC-3. Given the same match at 99.000 seats, then seats do not buy fans.
    #[test]
    fn seats_do_not_buy_fans() {
        let outcome = matchday(&rules(), &input(1, 99_000));
        assert_eq!(outcome.attendance, 9_405);
        assert_eq!(outcome.fill_permille, 95);
        assert!(!outcome.sold_out);
    }

    /// M-3. Given demand above the seats, then the match sells out and the rest wait outside.
    #[test]
    fn a_full_house_leaves_fans_outside() {
        let r = rules();
        let outcome = matchday(&r, &input(10, 10_000));
        assert_eq!((outcome.attendance, outcome.sold_out), (10_000, true));
        assert_eq!(
            (outcome.locked_out, outcome.ticket_revenue),
            (12_800, 262_940)
        );
        let top = matchday(
            &r,
            &MatchdayInput {
                opponent_rank: Some(2),
                ..input(1, 10_000)
            },
        );
        assert_eq!(
            (top.attendance, top.locked_out, top.ticket_revenue),
            (10_000, 300, 230_000)
        );
        let human = matchday(
            &r,
            &MatchdayInput {
                opponent_human: true,
                ..input(1, 10_000)
            },
        );
        assert_eq!(human.locked_out, 800);
        // Demand 9.405 at exactly 9.405 seats: full, nobody outside, not sold out.
        let exact = matchday(&r, &input(1, 9_405));
        assert_eq!(
            (exact.attendance, exact.sold_out, exact.locked_out),
            (9_405, false, 0)
        );
        assert_eq!(exact.fill_permille, 1000);
    }

    /// M-4, Qe514-2. Fans outside are rounded half up to a hundred, at least a hundred.
    #[test]
    fn fans_outside_are_rounded_to_a_hundred() {
        let r = rules();
        for (excess, shown) in [
            (1, 100),
            (49, 100),
            (149, 100),
            (150, 200),
            (2_149, 2_100),
            (2_150, 2_200),
        ] {
            assert_eq!(locked_out(&r, 10_000 + excess, 10_000), shown, "{excess}");
        }
        assert_eq!(locked_out(&r, 10_000, 10_000), 0);
    }

    /// M-5. Form over the window.
    #[test]
    fn form_moves_demand_over_the_window() {
        let r = rules();
        let form = |points, matches| form_permille(&r, Form { points, matches });
        assert_eq!(form(7, 5), 990);
        assert_eq!(form(15, 5), 1150);
        assert_eq!(form(0, 5), 850);
        assert_eq!(form(0, 0), 1000);
        assert_eq!(form(4, 3), 983);
        assert_eq!(form(1, 2), 900);
        assert_eq!(form(9, 2), 1150);
        assert_eq!(form(7, 7), form(7, 5));
    }

    /// M-6. The opponent's pull: the larger, never both.
    #[test]
    fn the_opponent_pulls_by_the_larger_factor() {
        let r = rules();
        assert_eq!(pull_permille(&r, None, false), 1000);
        assert_eq!(pull_permille(&r, Some(4), false), 1100);
        assert_eq!(pull_permille(&r, Some(5), false), 1000);
        assert_eq!(pull_permille(&r, Some(1), true), 1150);
        assert_eq!(pull_permille(&r, None, true), 1150);
    }

    /// M-7. The ticket by level, and `D_ref` read through a match with nothing else moving it.
    #[test]
    fn tickets_and_reference_demand_grow_by_level() {
        let r = rules();
        let tickets: Vec<u64> = [1, 2, 10, 15, 0]
            .iter()
            .map(|&level| ticket_milli(&r, level))
            .collect();
        assert_eq!(tickets, vec![23_000, 23_345, 26_294, 28_324, 23_000]);
        let reference = |league_level| {
            let flat = MatchdayInput {
                form: Form::default(),
                ..input(league_level, 99_000)
            };
            matchday(&r, &flat).attendance
        };
        assert_eq!(reference(0), 9_500);
        assert_eq!(reference(15), 55_000);
        assert_eq!(reference(16), 60_500);
        assert_eq!(reference(17), 66_550);
        assert_eq!(reference(18), 73_205);
        assert_eq!(demand_ref(&r, 18), 73_205);
    }

    /// M-8, R49-4. The four prices of the table 5.4 match, in a fixed order.
    #[test]
    fn projections_cover_the_four_prices_in_order() {
        let r = rules();
        let expected = [
            (TicketPrice::Low, 23_000, true, 2_500, 514_047, 1000),
            (TicketPrice::Medium, 22_770, false, 0, 598_714, 990),
            (TicketPrice::High, 19_582, false, 0, 617_866, 851),
            (TicketPrice::VeryHigh, 16_394, false, 0, 603_489, 712),
        ];
        for price in TicketPrice::ALL {
            let rows = projections(
                &r,
                &MatchdayInput {
                    price,
                    ..input(10, 23_000)
                },
            );
            for ((price, outcome), row) in rows.iter().zip(expected) {
                assert_eq!(*price, row.0);
                assert_eq!(
                    (
                        outcome.attendance,
                        outcome.sold_out,
                        outcome.locked_out,
                        outcome.ticket_revenue,
                        outcome.fill_permille
                    ),
                    (row.1, row.2, row.3, row.4, row.5),
                    "{price:?}"
                );
            }
        }
        let small = projections(&r, &input(10, 10_000));
        let outside: Vec<u32> = small.iter().map(|(_, o)| o.locked_out).collect();
        let tickets: Vec<u64> = small.iter().map(|(_, o)| o.ticket_revenue).collect();
        assert!(small.iter().all(|(_, o)| o.sold_out));
        assert_eq!(outside, vec![15_500, 12_800, 9_600, 6_400]);
        assert_eq!(tickets, vec![223_499, 262_940, 315_528, 368_116]);
    }

    /// M-9. Commerce follows the crowd; the car park lifts demand under bản 3.
    #[test]
    fn commerce_follows_the_crowd() {
        let r = rules();
        let shop = MatchdayInput {
            commerce: CommerceLevels {
                shop: 1,
                food: 0,
                park: 0,
            },
            ..input(1, 10_000)
        };
        assert_eq!(matchday(&r, &shop).commerce_revenue, 4_326);
        let all = CommerceLevels {
            shop: 5,
            food: 5,
            park: 5,
        };
        let built = matchday(
            &r,
            &MatchdayInput {
                commerce: all,
                ..input(5, 14_000)
            },
        );
        assert_eq!(
            (
                built.attendance,
                built.ticket_revenue,
                built.commerce_revenue
            ),
            (13_830, 337_590, 67_518)
        );
    }

    /// M-10, AC-9. A bot's stands reach its league's reference demand.
    #[test]
    fn a_bot_keeps_stands_for_its_league() {
        let facilities = FacilitiesRules::proposed();
        let r = rules();
        let levels: Vec<u8> = [1, 3, 10, 12, 15, 18, 25]
            .iter()
            .map(|&league| bot_stands_level(&facilities, &r, league))
            .collect();
        assert_eq!(levels, vec![1, 2, 6, 9, 12, 14, 16]);
        let table: Vec<u8> = (1..=18)
            .map(|league| bot_stands_level(&facilities, &r, league))
            .collect();
        assert_eq!(
            table,
            vec![1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 7, 9, 10, 11, 12, 13, 14, 14]
        );
    }

    /// M-11. The crowd's advantage and label at the table 5.5's crowds.
    #[test]
    fn the_crowd_gives_its_advantage_and_label() {
        let mut r = rules();
        r.crowd_advantage = Some(CrowdAdvantage::PROPOSED);
        // League 10's D_ref is 23.000, so 23 fans are one ‰ of c.
        let effect = |r: &MatchdayRules, c: u32| crowd_effect(r, 10, c * 23);
        let table = [
            (0, 1_045_000),
            (180, 1_053_100),
            (434, 1_064_530),
            (850, 1_083_250),
            (990, 1_089_550),
            (1000, 1_090_000),
            (1100, 1_094_500),
            (1150, 1_096_750),
            (1300, 1_096_750),
        ];
        for (c, micros) in table {
            assert_eq!(effect(&r, c).home_advantage_micros, Some(micros), "{c}");
        }
        let labels = [
            (699, Atmosphere::Quiet),
            (700, Atmosphere::Normal),
            (949, Atmosphere::Normal),
            (950, Atmosphere::Lively),
            (1079, Atmosphere::Lively),
            (1080, Atmosphere::Electric),
        ];
        for (c, label) in labels {
            assert_eq!(effect(&r, c).atmosphere, Some(label), "{c}");
        }
        r.crowd_advantage = None;
        assert_eq!(
            effect(&r, 990),
            CrowdEffect {
                home_advantage_micros: None,
                atmosphere: Some(Atmosphere::Lively)
            }
        );
        r.atmosphere_label = false;
        assert_eq!(effect(&r, 990).atmosphere, None);
        assert_eq!(
            home_advantage_f64(1_089_550).to_bits(),
            1.08955_f64.to_bits()
        );
    }

    /// M-12, AC-5. The outcome's JSON carries nothing hidden; the enums write their codes.
    #[test]
    fn the_outcome_shows_nothing_hidden() {
        let value = serde_json::to_value(matchday(&rules(), &input(1, 10_000))).expect("writes");
        let mut keys: Vec<&str> = value
            .as_object()
            .expect("an object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "attendance",
                "capacity",
                "commerceRevenue",
                "fillPermille",
                "lockedOut",
                "soldOut",
                "ticketRevenue"
            ]
        );
        let labels: Vec<serde_json::Value> = [
            Atmosphere::Quiet,
            Atmosphere::Normal,
            Atmosphere::Lively,
            Atmosphere::Electric,
        ]
        .iter()
        .map(|label| serde_json::to_value(label).expect("writes"))
        .collect();
        assert_eq!(labels, vec!["quiet", "normal", "lively", "electric"]);
        let prices: Vec<serde_json::Value> = TicketPrice::ALL
            .iter()
            .map(|price| serde_json::to_value(price).expect("writes"))
            .collect();
        assert_eq!(prices, vec!["low", "medium", "high", "veryHigh"]);
        assert_eq!(TicketPrice::default(), TicketPrice::Medium);
    }

    /// M-13. The proposed block, read from the tech-spec's JSON, and each validate line.
    #[test]
    fn the_proposed_block_is_valid_and_is_the_spec_json() {
        let proposed = rules();
        assert_eq!(proposed.validate(), Ok(()));
        assert_eq!(proposed.crowd_advantage, None);
        let spec: MatchdayRules = serde_json::from_str(SPEC_JSON).expect("the spec JSON reads");
        assert_eq!(spec, proposed);
        let written = serde_json::to_string(&proposed).expect("writes");
        assert!(!written.contains("crowdAdvantage"));
        let mut value: serde_json::Value = serde_json::from_str(SPEC_JSON).expect("JSON");
        value["dRef"] = serde_json::json!(1);
        assert!(serde_json::from_value::<MatchdayRules>(value).is_err());
        let mut on: serde_json::Value = serde_json::from_str(SPEC_JSON).expect("JSON");
        on["crowdAdvantage"] =
            serde_json::json!({ "basePermille": 45, "crowdPermille": 45, "capPermille": 1150 });
        let on: MatchdayRules = serde_json::from_value(on).expect("the switch reads");
        assert_eq!(on.crowd_advantage, Some(CrowdAdvantage::PROPOSED));
        assert_eq!(on.validate(), Ok(()));
    }

    /// M-13. Each line of the validate table broken in turn gives its issue and field.
    #[test]
    fn each_validate_line_gives_its_issue_and_field() {
        type Breaker = fn(&mut MatchdayRules);
        let with_crowd = |r: &mut MatchdayRules, crowd| r.crowd_advantage = Some(crowd);
        let cases: Vec<(Breaker, MatchdayIssue, &str)> = vec![
            (
                |r| r.demand_by_level.clear(),
                MatchdayIssue::DemandByLevel,
                "matchday.demandByLevel",
            ),
            (
                |r| r.demand_by_level[3] = 0,
                MatchdayIssue::DemandByLevel,
                "matchday.demandByLevel",
            ),
            (
                |r| r.demand_by_level[3] = 9_000,
                MatchdayIssue::DemandByLevel,
                "matchday.demandByLevel",
            ),
            (
                |r| r.demand_beyond_permille = 999,
                MatchdayIssue::DemandBeyond,
                "matchday.demandBeyondPermille",
            ),
            (
                |r| r.demand_beyond_permille = 2001,
                MatchdayIssue::DemandBeyond,
                "matchday.demandBeyondPermille",
            ),
            (
                |r| r.ticket_first_milli = 0,
                MatchdayIssue::TicketFirst,
                "matchday.ticketFirstMilli",
            ),
            (
                |r| r.ticket_growth_permille = 999,
                MatchdayIssue::TicketGrowth,
                "matchday.ticketGrowthPermille",
            ),
            (
                |r| r.ticket_growth_permille = 1501,
                MatchdayIssue::TicketGrowth,
                "matchday.ticketGrowthPermille",
            ),
            (|r| r.form.window = 0, MatchdayIssue::Form, "matchday.form"),
            (|r| r.form.window = 11, MatchdayIssue::Form, "matchday.form"),
            (
                |r| r.form.span_permille = 1151,
                MatchdayIssue::Form,
                "matchday.form",
            ),
            (
                |r| r.pull.top_places = 0,
                MatchdayIssue::Pull,
                "matchday.pull",
            ),
            (
                |r| r.pull.top_permille = 999,
                MatchdayIssue::Pull,
                "matchday.pull",
            ),
            (
                |r| r.pull.human_permille = 2001,
                MatchdayIssue::Pull,
                "matchday.pull",
            ),
            (
                |r| r.prices.low.price_permille = 0,
                MatchdayIssue::Prices(TicketPrice::Low),
                "matchday.prices.low",
            ),
            (
                |r| r.prices.medium.demand_permille = 2001,
                MatchdayIssue::Prices(TicketPrice::Medium),
                "matchday.prices.medium",
            ),
            (
                |r| r.prices.high.price_permille = 5001,
                MatchdayIssue::Prices(TicketPrice::High),
                "matchday.prices.high",
            ),
            (
                |r| r.prices.very_high.demand_permille = 0,
                MatchdayIssue::Prices(TicketPrice::VeryHigh),
                "matchday.prices.veryHigh",
            ),
            (
                |r| r.park_demand_permille_per_level = 201,
                MatchdayIssue::ParkDemand,
                "matchday.parkDemandPermillePerLevel",
            ),
            (
                |r| r.commerce_permille_per_level.food = 201,
                MatchdayIssue::CommerceShare,
                "matchday.commercePermillePerLevel",
            ),
            (
                |r| r.locked_out_rounding = 0,
                MatchdayIssue::LockedOutRounding,
                "matchday.lockedOutRounding",
            ),
            (
                |r| r.atmosphere_bands = [0, 950, 1080],
                MatchdayIssue::AtmosphereBands,
                "matchday.atmosphereBands",
            ),
            (
                |r| r.atmosphere_bands = [700, 700, 1080],
                MatchdayIssue::AtmosphereBands,
                "matchday.atmosphereBands",
            ),
            (
                |r| {
                    r.atmosphere_bands = [700, 950, 1150];
                    r.crowd_advantage = Some(CrowdAdvantage::PROPOSED);
                },
                MatchdayIssue::AtmosphereAboveCap,
                "matchday.atmosphereBands",
            ),
            (
                |r| {
                    r.crowd_advantage = Some(CrowdAdvantage {
                        base_permille: 200,
                        crowd_permille: 100,
                        cap_permille: 1150,
                    })
                },
                MatchdayIssue::CrowdAdvantage,
                "matchday.crowdAdvantage",
            ),
            (
                |r| {
                    r.crowd_advantage = Some(CrowdAdvantage {
                        cap_permille: 0,
                        ..CrowdAdvantage::PROPOSED
                    })
                },
                MatchdayIssue::CrowdAdvantage,
                "matchday.crowdAdvantage",
            ),
        ];
        for (index, (breaker, issue, field)) in cases.into_iter().enumerate() {
            let mut broken = rules();
            breaker(&mut broken);
            assert_eq!(broken.validate(), Err(issue), "case {index}");
            assert_eq!(issue.field(), field, "case {index}");
        }
        // The same high band without a crowd advantage is fine; so are the ranges' edges.
        let mut edge = rules();
        edge.atmosphere_bands = [700, 950, 1150];
        edge.demand_beyond_permille = 2000;
        edge.ticket_growth_permille = 1500;
        edge.form.window = 10;
        edge.form.span_permille = 1150;
        edge.pull.human_permille = 1000;
        edge.park_demand_permille_per_level = 0;
        edge.commerce_permille_per_level.shop = 200;
        assert_eq!(edge.validate(), Ok(()));
        // A full crowd's advantage just above 1,3 is refused; exactly 1,3 is allowed.
        with_crowd(
            &mut edge,
            CrowdAdvantage {
                base_permille: 150,
                crowd_permille: 130,
                cap_permille: 1155,
            },
        );
        edge.atmosphere_bands = [700, 950, 1080];
        assert_eq!(edge.validate(), Err(MatchdayIssue::CrowdAdvantage));
        with_crowd(
            &mut edge,
            CrowdAdvantage {
                base_permille: 150,
                crowd_permille: 125,
                cap_permille: 1200,
            },
        );
        assert_eq!(edge.validate(), Ok(()));
    }

    /// M-14, R514-1. Each building's share, and how far they fall below the posted total.
    #[test]
    fn commerce_parts_split_the_posted_total() {
        let r = rules();
        let shop = CommerceLevels {
            shop: 1,
            food: 0,
            park: 0,
        };
        assert_eq!(commerce_parts(&r, 1, 9_405, shop), [4_326, 0, 0]);
        let all = CommerceLevels {
            shop: 5,
            food: 5,
            park: 5,
        };
        assert_eq!(commerce_parts(&r, 5, 13_830, all), [33_759, 20_255, 13_503]);
        assert_eq!(
            commerce_parts(&r, 10, 23_000, all),
            [60_476, 36_285, 24_190]
        );
        for league in 1..=30 {
            for attendance in (0..=99_000).step_by(997).chain([99_000]) {
                for level in 0..=5 {
                    let levels = CommerceLevels {
                        shop: level,
                        food: 5 - level,
                        park: level,
                    };
                    let parts: u64 = commerce_parts(&r, league, attendance, levels).iter().sum();
                    let posted = matchday(
                        &r,
                        &MatchdayInput {
                            league_level: league,
                            capacity: attendance,
                            form: Form::default(),
                            commerce: levels,
                            ..input(league, attendance)
                        },
                    );
                    // Demand must reach the seats for the attendance to be the one asked for.
                    if posted.attendance != attendance {
                        continue;
                    }
                    assert!(
                        parts <= posted.commerce_revenue && posted.commerce_revenue <= parts + 2
                    );
                }
            }
        }
    }

    /// No overflow at the far end: a huge level, the top stands, every commerce level.
    #[test]
    fn far_levels_do_not_overflow() {
        let r = rules();
        let far = MatchdayInput {
            commerce: CommerceLevels {
                shop: u8::MAX,
                food: u8::MAX,
                park: u8::MAX,
            },
            ..input(u32::MAX, u32::MAX)
        };
        let outcome = matchday(&r, &far);
        assert!(outcome.attendance > 0);
        assert!(ticket_milli(&r, 30) > ticket_milli(&r, 29));
        assert!(matchday(&r, &input(30, 99_000)).ticket_revenue > 0);
        assert_eq!(matchday(&r, &input(1, 0)).fill_permille, 0);
    }
}
