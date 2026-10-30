//! Money rules the game and the online server share (phase 3, E3-10; S-10/S-11 tech-spec).
//!
//! The gate formulas and the facility price moved here from `ofm_core` unchanged, so the desktop
//! plays by the very numbers it did. The rest is the online economy: wages paid by the season day
//! on the football-year scale, the price band and bid steps of the auction market, the transfer
//! tax and the rank rewards. Every amount is whole euros, as everywhere in the game; a rule that
//! divides rounds down, so the server and a client asking the same question get the same euro.

use domain::player::Player;
use serde::{Deserialize, Serialize};

use crate::facilities::MAX_FACILITY_LEVEL;
use crate::valuation::{
    MINIMUM_DEFAULT_WAGE, TOP_REPUTATION, VALUE_GROWTH_PER_POINT, current_rating,
    market_value_at_age, market_wage,
};

/// Weeks of wages a club pays in one football year. One online season is one football year (Q5),
/// so an online club pays these weeks over the days of a season (S10-6).
pub const WEEKS_PER_FOOTBALL_YEAR: u64 = 52;

/// What the first upgrade of a facility costs; each level up costs one more of these (S10-14).
pub const BASE_FACILITY_UPGRADE_COST: u64 = 2_500_000;

fn reputation_share(reputation: u32) -> f64 {
    f64::from(reputation) / TOP_REPUTATION
}

/// Average ticket price: about €25 in the lowest tiers, near €100 at the top.
pub fn ticket_price(reputation: u32) -> f64 {
    15.0 + 85.0 * reputation_share(reputation).min(1.1)
}

/// How many fans want a ticket for an ordinary home game. A big club fills a
/// big stadium; a small one does not, however large its ground.
pub fn matchday_demand(reputation: u32) -> u32 {
    let reputation = f64::from(reputation);
    (3_000.0 + reputation * reputation * 0.08) as u32
}

/// Gate receipts for one home game. `turnout` scales the usual demand (1.0 is
/// an ordinary game) and attendance is capped by the stadium.
pub fn matchday_gate(reputation: u32, stadium_capacity: u32, turnout: f64) -> i64 {
    let attendance =
        (f64::from(matchday_demand(reputation)) * turnout).min(f64::from(stadium_capacity));
    (attendance * ticket_price(reputation)) as i64
}

/// What the home club of an online league match takes at the gate: an ordinary turnout, scaled
/// by the season's `ticket_income_permille` (S10-9).
pub fn online_ticket_income(reputation: u32, stadium_capacity: u32, permille: u32) -> u64 {
    let gate = matchday_gate(reputation, stadium_capacity, 1.0).max(0) as u64;
    scale(gate, permille)
}

/// What the next upgrade of a facility at `level` costs, or `None` once it is at the top.
pub fn facility_upgrade_cost(level: u8, base: u64) -> Option<u64> {
    (level < MAX_FACILITY_LEVEL).then(|| u64::from(level) * base)
}

/// How online wages climb with ability when a season flattens them (S-29, S29-1). From `from_ovr`
/// to `knee_ovr` a rating point raises the wage by `growth_milli`‰ of e instead of the market's
/// 0.17, so an ordinary squad is no longer paid like a star's fee; below `from_ovr` and above the
/// knee wages climb as the market's do. Without one the online wage is the market wage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WageCurve {
    /// Below this rating the online wage is the market wage, as before.
    pub from_ovr: u8,
    /// From `from_ovr` up to this rating each point adds `growth_milli`‰ of e.
    pub knee_ovr: u8,
    /// The flat slope, thousandths per rating point (80 = 0.08).
    pub growth_milli: u32,
}

/// The highest knee a wage curve may have: where the value curve itself bends (S29-5). A knee past
/// it would flatten a stretch where the market already grows at its elite rate.
pub const WAGE_CURVE_MAX_KNEE: u8 = 85;
/// The steepest slope a wage curve may have: the market's own growth per point (S29-5), so a curve
/// never makes a player dearer than the market pays him.
pub const WAGE_CURVE_MAX_GROWTH_MILLI: u32 = 170;

/// The share of the market wage a player of `rating` keeps on `curve`: e^(−(0.17 − k) × the
/// points he has on the flat stretch). One for a rating at or below the curve's start.
fn wage_curve_discount(curve: &WageCurve, rating: u8) -> f64 {
    let flat_points = rating
        .saturating_sub(curve.from_ovr)
        .min(curve.knee_ovr.saturating_sub(curve.from_ovr));
    let slope = f64::from(curve.growth_milli) / 1000.0;
    (-(VALUE_GROWTH_PER_POINT - slope) * f64::from(flat_points)).exp()
}

/// The weekly wage an online club pays the player: his market wage at the club's reputation,
/// discounted by the season's wage curve if it has one, scaled by `wage_scale_permille`, never
/// below the game's minimum wage (S10-6, S29-1). Without a curve it is the euro it always was.
pub fn online_wage(
    player: &Player,
    club_reputation: u32,
    wage_scale_permille: u32,
    curve: Option<&WageCurve>,
) -> u64 {
    let market = u64::from(market_wage(player, Some(club_reputation)));
    let on_curve = match curve {
        None => market,
        Some(curve) => (market as f64 * wage_curve_discount(curve, current_rating(player))) as u64,
    };
    scale(on_curve, wage_scale_permille).max(MINIMUM_DEFAULT_WAGE)
}

/// Wages paid by the end of `days` of a season of `season_days`: the year's wages of a weekly
/// bill, spread evenly and rounded down. The share of one day is the difference of two of these,
/// so a whole season pays exactly `weekly_bill × 52`, not a euro more or less.
fn wages_paid_by(weekly_bill: u64, days: u32, season_days: u32) -> u64 {
    let year = u128::from(weekly_bill) * u128::from(WEEKS_PER_FOOTBALL_YEAR);
    (year * u128::from(days.min(season_days)) / u128::from(season_days)) as u64
}

/// The wages due on day `day` (0-based) of a season of `season_days`, for a weekly bill of
/// `weekly_bill` (S10-6). Zero outside the season, and for a season of no days.
pub fn wage_due(weekly_bill: u64, day: u32, season_days: u32) -> u64 {
    if season_days == 0 || day >= season_days {
        return 0;
    }
    wages_paid_by(weekly_bill, day + 1, season_days) - wages_paid_by(weekly_bill, day, season_days)
}

/// What `days` days of a weekly bill cost on the season scale, rounded up: the cash a club must
/// keep after a bid to carry its wages that long (S11-4).
pub fn wages_for_days(weekly_bill: u64, days: u32, season_days: u32) -> u64 {
    if season_days == 0 {
        return 0;
    }
    let cost = u128::from(weekly_bill) * u128::from(WEEKS_PER_FOOTBALL_YEAR) * u128::from(days);
    cost.div_ceil(u128::from(season_days)) as u64
}

/// The player's value on the online market: his market value at his club's reputation (S11-3).
pub fn online_market_value(player: &Player, club_reputation: u32, age: i32) -> u64 {
    market_value_at_age(player, Some(club_reputation), age)
}

/// The prices a player may be listed at and bid up to, from his value (S11-3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PriceBand {
    /// The lowest starting price: `value × min_permille / 1000`, rounded up.
    pub min: u64,
    /// The highest bid, the cap: `value × max_permille / 1000`, rounded down.
    pub max: u64,
}

pub fn price_band(value: u64, min_permille: u32, max_permille: u32) -> PriceBand {
    let of = |permille: u32| u128::from(value) * u128::from(permille);
    PriceBand {
        min: of(min_permille).div_ceil(1000) as u64,
        max: (of(max_permille) / 1000) as u64,
    }
}

/// One tier of bid steps: from `from` (inclusive) up to the next tier, a bid must beat the
/// leading price by at least `step`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BidStep {
    pub from: u64,
    pub step: u64,
}

/// The tiers of the requirement (under €1M: €50k; €1M to €10M: €100k; above €10M: €500k) with
/// one tier added under €250k, where a €50k step would leave the cheapest player a single bid
/// (S11-5).
pub const DEFAULT_BID_STEPS: [BidStep; 4] = [
    BidStep {
        from: 0,
        step: 10_000,
    },
    BidStep {
        from: 250_000,
        step: 50_000,
    },
    BidStep {
        from: 1_000_000,
        step: 100_000,
    },
    BidStep {
        from: 10_000_001,
        step: 500_000,
    },
];

/// The least a bid must add to a leading price of `price`: the step of the highest tier the price
/// has reached. With no tier at all, a bid need only add €1.
pub fn bid_step(price: u64, steps: &[BidStep]) -> u64 {
    steps
        .iter()
        .filter(|tier| tier.from <= price)
        .max_by_key(|tier| tier.from)
        .map_or(1, |tier| tier.step.max(1))
}

/// The least the next bid may be: the starting price before anyone bids, else the leading price
/// plus its step.
pub fn minimum_next_bid(leading: Option<u64>, start_price: u64, steps: &[BidStep]) -> u64 {
    match leading {
        None => start_price,
        Some(price) => price.saturating_add(bid_step(price, steps)),
    }
}

/// When an auction ends after a bid at `bid_at` (S11-4). A bid inside the last `window` before
/// `ends_at` moves the end to `bid_at + window`, counted from the bid and never from the old end,
/// and never past `hard_end`. Any unit of time, as long as all four share it.
pub fn soft_close(ends_at: i64, bid_at: i64, window: i64, hard_end: i64) -> i64 {
    if ends_at - bid_at < window {
        ends_at.max(bid_at + window).min(hard_end)
    } else {
        ends_at
    }
}

/// The tax burnt on a transfer at `price`, rounded down (S11-7). The seller receives the rest.
pub fn transfer_tax(price: u64, permille: u32) -> u64 {
    scale(price, permille)
}

/// A slower growth of rank rewards above a level (S-29, S29-8): the rewards of the high levels are
/// cut without touching the low ones, where clubs barely break even.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RewardHighGrowth {
    /// The last level reached at the ordinary growth.
    pub from_level: u32,
    /// The growth of each level above `from_level`, in thousandths.
    pub permille: u32,
}

/// The reward for finishing `rank` (1 is first) in a league of coach level `level` (S10-10): the
/// level-1 amount of that rank, grown once per level above the first, each step rounded down. The
/// step up to a level grows by `growth_permille`, or by `high`'s own growth for a level above its
/// `from_level` (S29-8). Zero for a rank the table has no amount for.
pub fn rank_reward(
    level_one: &[u64],
    rank: usize,
    level: u32,
    growth_permille: u32,
    high: Option<&RewardHighGrowth>,
) -> u64 {
    let Some(&amount) = rank.checked_sub(1).and_then(|index| level_one.get(index)) else {
        return 0;
    };
    let growth_up_to = |level: u32| match high {
        Some(high) if level > high.from_level => high.permille,
        _ => growth_permille,
    };
    (2..=level.max(1)).fold(amount, |reward, level| scale(reward, growth_up_to(level)))
}

/// `amount × permille / 1000`, rounded down, without overflow.
fn scale(amount: u64, permille: u32) -> u64 {
    (u128::from(amount) * u128::from(permille) / 1000).min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given any weekly bill and a season of 28 days,
    /// when the wages of every day are added up,
    /// then they come to exactly 52 weeks of the bill.
    #[test]
    fn a_season_pays_exactly_a_football_year_of_wages() {
        for weekly in [0, 1, 7, 27, 55_000, 61_234, 999_999_999, 1_000_000_000] {
            let season: u64 = (0..28).map(|day| wage_due(weekly, day, 28)).sum();
            assert_eq!(season, weekly * 52, "weekly {weekly}");
        }
    }

    /// Given a weekly bill that does not divide evenly,
    /// when each day's wages are taken,
    /// then no two days differ by more than a euro.
    #[test]
    fn wages_are_spread_evenly_over_the_season() {
        let days: Vec<u64> = (0..28).map(|day| wage_due(55_001, day, 28)).collect();
        let (min, max) = (days.iter().min().unwrap(), days.iter().max().unwrap());
        assert!(max - min <= 1, "{days:?}");
    }

    /// Given a day outside the season, or a season of no days,
    /// when the wages due are asked,
    /// then nothing is due.
    #[test]
    fn nothing_is_due_outside_the_season() {
        assert_eq!(wage_due(55_000, 28, 28), 0);
        assert_eq!(wage_due(55_000, 0, 0), 0);
        assert_eq!(wages_for_days(55_000, 7, 0), 0);
    }

    /// Given a weekly bill,
    /// when the cash for seven season days is asked,
    /// then it is at least what those seven days actually charge.
    #[test]
    fn the_runway_covers_the_days_it_names() {
        let charged: u64 = (0..7).map(|day| wage_due(55_001, day, 28)).sum();
        assert!(wages_for_days(55_001, 7, 28) >= charged);
        assert_eq!(wages_for_days(56_000, 7, 28), 728_000);
    }

    /// Given a price band of 60% to 250%,
    /// when it is taken of a value that does not divide evenly,
    /// then the floor rounds up and the cap rounds down, so both stay inside the band.
    #[test]
    fn the_price_band_stays_inside_its_percentages() {
        assert_eq!(
            price_band(1_100_000, 600, 2500),
            PriceBand {
                min: 660_000,
                max: 2_750_000
            }
        );
        assert_eq!(
            price_band(25_001, 600, 2500),
            PriceBand {
                min: 15_001,
                max: 62_502
            }
        );
    }

    /// Given the default bid steps,
    /// when the step is asked at each tier's edges,
    /// then €1M and €10M take €100k, just above €10M takes €500k, and the cheapest €10k.
    #[test]
    fn bid_steps_follow_the_tiers() {
        let step = |price| bid_step(price, &DEFAULT_BID_STEPS);
        assert_eq!(step(15_000), 10_000);
        assert_eq!(step(249_999), 10_000);
        assert_eq!(step(250_000), 50_000);
        assert_eq!(step(999_999), 50_000);
        assert_eq!(step(1_000_000), 100_000);
        assert_eq!(step(10_000_000), 100_000);
        assert_eq!(step(10_000_001), 500_000);
        assert_eq!(bid_step(5, &[]), 1);
    }

    /// Given an auction with and without a leading bid,
    /// when the least next bid is asked,
    /// then it is the starting price, or the leading price plus its step.
    #[test]
    fn the_next_bid_starts_at_the_start_price() {
        assert_eq!(minimum_next_bid(None, 660_000, &DEFAULT_BID_STEPS), 660_000);
        assert_eq!(
            minimum_next_bid(Some(660_000), 660_000, &DEFAULT_BID_STEPS),
            710_000
        );
    }

    /// Given an auction ending at 1,000 with a 180 window and a hard end at 1,300,
    /// when bids come early, inside the window, and near the hard end,
    /// then only bids inside the window move the end, from the bid, never past the hard end.
    #[test]
    fn a_late_bid_extends_from_its_own_time() {
        assert_eq!(soft_close(1_000, 500, 180, 1_300), 1_000);
        assert_eq!(soft_close(1_000, 820, 180, 1_300), 1_000);
        assert_eq!(soft_close(1_000, 900, 180, 1_300), 1_080);
        assert_eq!(soft_close(1_080, 1_079, 180, 1_300), 1_259);
        assert_eq!(soft_close(1_259, 1_250, 180, 1_300), 1_300);
    }

    /// Given a 10% tax,
    /// when a transfer settles,
    /// then the tax rounds down and tax plus the seller's share is the price.
    #[test]
    fn the_tax_and_the_seller_share_make_the_price() {
        let price = 1_234_567;
        let tax = transfer_tax(price, 100);
        assert_eq!(tax, 123_456);
        assert_eq!(tax + (price - tax), price);
    }

    /// Given the level-one reward table,
    /// when rewards are asked at levels 1 to 3 and outside the table,
    /// then they grow 25% a level, rounding down each step, and are zero off the table.
    #[test]
    fn rank_rewards_grow_with_the_level() {
        let table = [1_500_000, 120_000];
        assert_eq!(rank_reward(&table, 1, 1, 1250, None), 1_500_000);
        assert_eq!(rank_reward(&table, 1, 2, 1250, None), 1_875_000);
        assert_eq!(rank_reward(&table, 1, 3, 1250, None), 2_343_750);
        assert_eq!(rank_reward(&table, 2, 0, 1250, None), 120_000);
        assert_eq!(rank_reward(&table, 0, 1, 1250, None), 0);
        assert_eq!(rank_reward(&table, 3, 1, 1250, None), 0);
    }

    /// Given rewards that grow 25% a level up to level 6 and 10% a level above it,
    /// when they are asked at levels 1 to 9 and outside the table,
    /// then levels 1 to 6 pay what one growth of 25% pays, each later level adds 10% of the one
    /// below rounded down, and a rank off the table still earns nothing.
    #[test]
    fn rewards_above_the_high_level_grow_at_their_own_rate() {
        let table = [4_500_000, 1_320_000];
        let high = RewardHighGrowth {
            from_level: 6,
            permille: 1100,
        };
        for level in 1..=6 {
            assert_eq!(
                rank_reward(&table, 1, level, 1250, Some(&high)),
                rank_reward(&table, 1, level, 1250, None),
                "level {level}"
            );
        }
        let mut below = rank_reward(&table, 2, 6, 1250, Some(&high));
        for level in 7..=9 {
            let reward = rank_reward(&table, 2, level, 1250, Some(&high));
            assert_eq!(reward, below * 1100 / 1000, "level {level}");
            below = reward;
        }
        assert_eq!(rank_reward(&table, 3, 9, 1250, Some(&high)), 0);
    }

    fn midfielder(ovr: u8) -> Player {
        player_at(domain::player::Position::CentralMidfielder, ovr)
    }

    fn player_at(position: domain::player::Position, ovr: u8) -> Player {
        let mut player = Player::new(
            "p1".to_string(),
            "P. One".to_string(),
            "Player One".to_string(),
            "2000-01-01".to_string(),
            "GB".to_string(),
            position.clone(),
            crate::test_support::uniform_attributes(60),
        );
        player.natural_position = position;
        player.ovr = ovr;
        player.potential = ovr;
        player
    }

    /// The online wage as it was before the wage curve (S10-6).
    fn wage_before_the_curve(player: &Player, reputation: u32, permille: u32) -> u64 {
        scale(u64::from(market_wage(player, Some(reputation))), permille).max(MINIMUM_DEFAULT_WAGE)
    }

    const CURVE_68: WageCurve = WageCurve {
        from_ovr: 60,
        knee_ovr: 68,
        growth_milli: 80,
    };

    /// The market wage, discounted by `factor` and rounded down, at a scale of 1000‰.
    fn discounted(player: &Player, reputation: u32, factor: f64) -> u64 {
        let market = f64::from(market_wage(player, Some(reputation)));
        ((market * factor) as u64).max(MINIMUM_DEFAULT_WAGE)
    }

    /// Given no wage curve on the season,
    /// when wages are asked for ratings 40 to 99 at two reputations, two positions and two scales,
    /// then every one is the euro the online wage paid before the curve existed.
    #[test]
    fn without_a_curve_the_online_wage_is_what_it_was() {
        use domain::player::Position;
        for position in [Position::CentralMidfielder, Position::Goalkeeper] {
            for ovr in 40..=99 {
                let player = player_at(position.clone(), ovr);
                for reputation in [300, 800] {
                    for permille in [1000, 700] {
                        assert_eq!(
                            online_wage(&player, reputation, permille, None),
                            wage_before_the_curve(&player, reputation, permille),
                            "{position:?} {ovr} at {reputation}, {permille}‰"
                        );
                    }
                }
            }
        }
    }

    /// Given the curve that flattens from 60 to a knee at 68 with a slope of 0.08,
    /// when wages are asked below, inside and above the flat stretch,
    /// then up to 60 nothing changes, at 64 the wage is cut by e^(−0.36) ≈ 0.698, and from 68 on,
    /// past the value curve's own bend at 85 too, by the whole stretch's e^(−0.72) ≈ 0.487.
    #[test]
    fn the_curve_cuts_wages_only_from_its_start() {
        for ovr in [45, 55, 60] {
            let player = midfielder(ovr);
            assert_eq!(
                online_wage(&player, 300, 1000, Some(&CURVE_68)),
                wage_before_the_curve(&player, 300, 1000),
                "ovr {ovr}"
            );
        }
        assert!(((-0.36_f64).exp() - 0.698).abs() < 0.001);
        assert!(((-0.72_f64).exp() - 0.487).abs() < 0.001);
        for (ovr, cut) in [(64, -0.36_f64), (68, -0.72), (75, -0.72), (90, -0.72)] {
            let player = midfielder(ovr);
            let wage = online_wage(&player, 300, 1000, Some(&CURVE_68));
            let expected = discounted(&player, 300, cut.exp());
            assert!(
                wage.abs_diff(expected) <= 1,
                "ovr {ovr}: {wage} vs {expected}"
            );
        }
    }

    /// Given the curve with its knee at 72,
    /// when a 75 is paid,
    /// then his wage is cut by e^(−0.09 × 12) ≈ 0.340.
    #[test]
    fn a_later_knee_cuts_deeper() {
        let curve = WageCurve {
            knee_ovr: 72,
            ..CURVE_68
        };
        assert!(((-1.08_f64).exp() - 0.340).abs() < 0.001);
        let player = midfielder(75);
        let wage = online_wage(&player, 300, 1000, Some(&curve));
        let expected = discounted(&player, 300, (-1.08_f64).exp());
        assert!(wage.abs_diff(expected) <= 1, "{wage} vs {expected}");
    }

    /// Given the curve with its knee at 68,
    /// when a 67 and a 60 of the same club and position are paid,
    /// then the 67 costs e^(0.08 × 7) ≈ 1.75 times the 60, where it cost 3.29 times before.
    #[test]
    fn a_rating_point_on_the_flat_stretch_costs_eight_percent() {
        let (good, ordinary) = (midfielder(67), midfielder(60));
        let ratio = |curve: Option<&WageCurve>| {
            online_wage(&good, 300, 1000, curve) as f64
                / online_wage(&ordinary, 300, 1000, curve) as f64
        };
        assert!(
            (ratio(Some(&CURVE_68)) - 1.75).abs() < 0.01,
            "{}",
            ratio(Some(&CURVE_68))
        );
        assert!((ratio(None) - 3.29).abs() < 0.01, "{}", ratio(None));
    }

    /// Given a low scale on the season,
    /// when a 45 is paid on the curve,
    /// then he still earns the game's minimum wage.
    #[test]
    fn the_curve_keeps_the_minimum_wage() {
        let player = midfielder(45);
        assert_eq!(
            online_wage(&player, 300, 700, Some(&CURVE_68)),
            MINIMUM_DEFAULT_WAGE
        );
    }

    /// Given every knee from 61 to the value curve's bend at 85 and every slope up to the market's,
    /// when ratings 40 to 99 are paid in order,
    /// then no player earns less than one rated below him, and none more than before the curve.
    #[test]
    fn a_better_player_never_earns_less_on_any_curve() {
        for knee_ovr in 61..=WAGE_CURVE_MAX_KNEE {
            for growth_milli in [0, 80, 120, WAGE_CURVE_MAX_GROWTH_MILLI] {
                let curve = WageCurve {
                    from_ovr: 60,
                    knee_ovr,
                    growth_milli,
                };
                let mut last = 0;
                for ovr in 40..=99 {
                    let player = midfielder(ovr);
                    let wage = online_wage(&player, 300, 1000, Some(&curve));
                    assert!(
                        wage >= last,
                        "knee {knee_ovr}, {growth_milli}: {ovr} pays {wage} < {last}"
                    );
                    assert!(wage <= wage_before_the_curve(&player, 300, 1000));
                    last = wage;
                }
            }
        }
    }

    /// Given the limits the server checks a wage curve against,
    /// when they are compared with the value curve,
    /// then the knee ends at the value curve's bend and the slope at its growth per point.
    #[test]
    fn the_curve_limits_are_the_value_curve_s_own() {
        assert_eq!(f64::from(WAGE_CURVE_MAX_KNEE), crate::valuation::ELITE_OVR);
        assert_eq!(
            f64::from(WAGE_CURVE_MAX_GROWTH_MILLI) / 1000.0,
            crate::valuation::VALUE_GROWTH_PER_POINT
        );
    }

    /// Given a wage curve and a high-level reward growth in a ruleset,
    /// when they are written and read back,
    /// then the fields are camelCase and unknown ones are refused.
    #[test]
    fn the_curve_and_the_high_growth_read_as_the_ruleset_writes_them() {
        let curve: WageCurve =
            serde_json::from_str(r#"{"fromOvr":60,"kneeOvr":68,"growthMilli":80}"#).unwrap();
        assert_eq!(curve, CURVE_68);
        let high: RewardHighGrowth =
            serde_json::from_str(r#"{"fromLevel":6,"permille":1100}"#).unwrap();
        assert_eq!(
            high,
            RewardHighGrowth {
                from_level: 6,
                permille: 1100
            }
        );
        assert!(
            serde_json::from_str::<WageCurve>(
                r#"{"fromOvr":60,"kneeOvr":68,"growthMilli":80,"x":1}"#
            )
            .is_err()
        );
    }

    /// Given a facility at levels 1, 9 and 10,
    /// when the upgrade is priced,
    /// then it costs the level times the base, and nothing is offered at the top.
    #[test]
    fn a_facility_costs_its_level_times_the_base() {
        assert_eq!(
            facility_upgrade_cost(1, BASE_FACILITY_UPGRADE_COST),
            Some(2_500_000)
        );
        assert_eq!(
            facility_upgrade_cost(9, BASE_FACILITY_UPGRADE_COST),
            Some(22_500_000)
        );
        assert_eq!(facility_upgrade_cost(10, BASE_FACILITY_UPGRADE_COST), None);
    }

    /// Given a starter club's reputation and ground,
    /// when its online gate is taken at 1000‰ and 450‰,
    /// then it is the desktop's ordinary gate, and that gate scaled.
    #[test]
    fn the_online_gate_is_the_desktop_gate_scaled() {
        let gate = matchday_gate(300, 12_000, 1.0) as u64;
        assert_eq!(online_ticket_income(300, 12_000, 1000), gate);
        assert_eq!(online_ticket_income(300, 12_000, 450), gate * 450 / 1000);
    }
}
