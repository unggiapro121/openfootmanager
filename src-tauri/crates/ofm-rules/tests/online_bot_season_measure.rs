//! E3-12: one online season of a bot's money once it sells what it can spare, under the rules of
//! analysis-bot-auction-bids.md B8–B10 and S-10, so the sale values can be judged from numbers.
//! Run by hand:
//! `cargo test --release -p ofm-rules --test online_bot_season_measure -- --ignored --nocapture`.
//!
//! The world is the 560 starter clubs of E3-10, each a bot of a level-1 league. A season is 28
//! days: a match on days 1–26, where the first eleven play 90 minutes and no one else plays; the
//! wages of each day; the gates of 13 home games; the reward of a place dealt as in E3-10. A bot
//! that buys spends its season's budget on day 0 on a copy of the best player of the line it
//! needs most, which upgrades that line. Each day a bot with no sale open may list the player its
//! sale rule spares; an auction runs a day. Who buys is the scenario:
//! - "at value": a person buys every listing at its starting price;
//! - "at 80%": a person buys only once the price is down to the floor;
//! - "no one": nothing a bot lists is sold.

use domain::player::Player;
use ofm_rules::economy::{
    online_market_value, online_ticket_income, online_wage, rank_reward, transfer_tax, wage_due,
};
use ofm_rules::market_ai::{
    BotBidRules, BotSaleRules, SquadMember, bot_line_counts, bot_lists_today, bot_surplus,
    club_needs,
};
use ofm_rules::player_rating::player_age;
use ofm_rules::playing_time::record_club_match;
use ofm_rules::squad::{first_choice_eleven, group_index};
use ofm_rules::worldgen::online::{GeneratedClub, Generator, OnlineContentPack};
use std::collections::BTreeMap;

const SEASON_DAYS: u32 = 28;
const MATCH_DAYS: std::ops::RangeInclusive<u32> = 1..=26;
const HOME_GAMES: u64 = 13;
const OPENING_CASH: u64 = 3_000_000;
const TICKET_PERMILLE: u32 = 400;
const TAX_PERMILLE: u32 = 100;
const SEASON_YEAR: u32 = 2026;
const WORLD_SEED: u64 = 2026;
const LEVEL_ONE_REWARDS: [u64; 14] = [
    1_500_000, 1_150_000, 900_000, 750_000, 620_000, 520_000, 440_000, 370_000, 310_000, 260_000,
    220_000, 180_000, 150_000, 120_000,
];

#[derive(Clone, Copy, PartialEq)]
enum Buyers {
    AtValue,
    AtFloor,
    NoOne,
}

struct Season {
    cash: i64,
    next_spendable: u64,
    listings: u32,
    sales: u32,
    sale_money: u64,
    squad: usize,
}

/// Given the 560 starter clubs of the builtin pack as bots,
/// when each plays a season of matches, wages and sales, buying or not, under three kinds of
/// buyer,
/// then each bot's cash at the season's end, what it may spend in the next, and its sales are
/// printed.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure_e3_12_bot_season() {
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(2026, &pack).unwrap();
    let clubs: Vec<GeneratedClub> = (0..560)
        .map(|ordinal| generator.club("Europe", ordinal, 0, 2026, None).unwrap())
        .collect();
    let sales = BotSaleRules::default();
    let bids = BotBidRules::default();
    println!(
        "E3-12 — {} starter clubs (pack {}, Europe, seed 2026) as level-1 bots, one season of {SEASON_DAYS} days",
        clubs.len(),
        pack.version
    );
    println!(
        "sale rules: list {}‰ a day, ≤{} sales, keep {}, price {}‰ −{}‰ a time unsold, floor {}‰; buying: budget {} above a reserve of {}",
        sales.list_chance_permille,
        sales.max_sales_per_season,
        sales.keep_squad,
        sales.start_permille,
        sales.unsold_step_permille,
        sales.floor_permille,
        bids.season_spend,
        bids.cash_reserve
    );
    println!();
    println!(
        "buys     | buyers   | cash at end p10 p50 p90       | next season spendable p10 p50 p90 | listings | sales | sold for (avg) | squad at end"
    );
    for buys in [false, true] {
        for (label, buyers) in [
            ("at value", Buyers::AtValue),
            ("at 80%", Buyers::AtFloor),
            ("no one", Buyers::NoOne),
        ] {
            let seasons: Vec<Season> = clubs
                .iter()
                .enumerate()
                .map(|(index, club)| season_of(club, index, buys, buyers, &sales, &bids))
                .collect();
            print_row(if buys { "2.0M" } else { "none" }, label, &seasons);
        }
    }
}

fn season_of(
    club: &GeneratedClub,
    index: usize,
    buys: bool,
    buyers: Buyers,
    sales: &BotSaleRules,
    bids: &BotBidRules,
) -> Season {
    let reputation = club.team.reputation;
    let formation = club.team.formation.as_str();
    let mut squad: Vec<Player> = club.players.clone();
    let mut cash = OPENING_CASH as i64;
    let mut upgraded_line = None;
    if buys {
        let available: Vec<&Player> = squad.iter().collect();
        let needs = club_needs(formation, bot_line_counts(&squad), &available);
        if let Some(need) = needs.first() {
            let line = group_index(&need.slot);
            if let Some(best) = squad
                .iter()
                .filter(|p| group_index(&p.position) == line)
                .max_by_key(|p| p.ovr)
                .cloned()
            {
                let mut signing = best;
                signing.id = format!("{}-signing", signing.id);
                squad.push(signing);
                cash -= bids.season_spend as i64;
                upgraded_line = Some(line);
            }
        }
    }

    let mut open: Option<(String, u64)> = None;
    let mut unsold: BTreeMap<String, u32> = BTreeMap::new();
    let (mut listings, mut sold, mut sale_money) = (0, 0, 0);
    for day in 0..SEASON_DAYS {
        if let Some((id, price)) = open.take() {
            let times_unsold = unsold.get(&id).copied().unwrap_or(0);
            let buys_now = match buyers {
                Buyers::AtValue => true,
                Buyers::AtFloor => {
                    sales.start_permille - sales.unsold_step_permille * times_unsold
                        <= sales.floor_permille
                }
                Buyers::NoOne => false,
            };
            if buys_now {
                let gone = squad.iter().position(|p| p.id == id).unwrap();
                let player = squad.remove(gone);
                if upgraded_line == Some(group_index(&player.position)) {
                    upgraded_line = None;
                }
                let net = price - transfer_tax(price, TAX_PERMILLE);
                cash += net as i64;
                sale_money += net;
                sold += 1;
            } else {
                *unsold.entry(id).or_default() += 1;
            }
        }
        // An auction must end inside the season (S11-3): a day for it and one to spare.
        if open.is_none() && sold < sales.max_sales_per_season && day + 2 <= SEASON_DAYS {
            let members: Vec<SquadMember<'_>> = squad
                .iter()
                .map(|player| SquadMember {
                    player,
                    age: player_age(&player.date_of_birth, SEASON_YEAR) as i32,
                })
                .collect();
            if let Some(player) = bot_surplus(sales, formation, &members, day, upgraded_line, 0)
                && bot_lists_today(sales, WORLD_SEED, &club.team.id, day)
            {
                let age = player_age(&player.date_of_birth, SEASON_YEAR) as i32;
                let value = online_market_value(player, reputation, age);
                let times = unsold.get(&player.id).copied().unwrap_or(0);
                open = Some((player.id.clone(), sales.listing_price(value, times)));
                listings += 1;
            }
        }
        let bill: u64 = squad.iter().map(|p| online_wage(p, reputation, 1000)).sum();
        cash -= wage_due(bill, day, SEASON_DAYS) as i64;
        if MATCH_DAYS.contains(&day) {
            play_a_match(&mut squad, formation);
        }
    }
    cash += (online_ticket_income(reputation, club.team.stadium_capacity, TICKET_PERMILLE)
        * HOME_GAMES) as i64;
    cash += rank_reward(&LEVEL_ONE_REWARDS, shuffled_rank(index), 1, 1250) as i64;
    Season {
        cash,
        next_spendable: bids.spendable(u64::try_from(cash).unwrap_or(0), 0),
        listings,
        sales: sold,
        sale_money,
        squad: squad.len(),
    }
}

/// The first eleven play the whole match; everyone else sits it out.
fn play_a_match(squad: &mut [Player], formation: &str) {
    let eleven: Vec<String> = {
        let available: Vec<&Player> = squad.iter().collect();
        first_choice_eleven(&available, formation)
            .iter()
            .map(|p| p.id.clone())
            .collect()
    };
    for player in squad.iter_mut() {
        let minutes = if eleven.contains(&player.id) { 90 } else { 0 };
        record_club_match(player, minutes);
    }
}

/// The finishing place of the club at `index`, as E3-10 deals it.
fn shuffled_rank(index: usize) -> usize {
    let league = index / 14;
    let seat = index % 14;
    (seat * 5 + league * 3) % 14 + 1
}

fn print_row(buys: &str, buyers: &str, seasons: &[Season]) {
    let quantiles = |mut values: Vec<i64>| {
        values.sort_unstable();
        let at = |q: usize| values[(values.len() - 1) * q / 100];
        (at(10), at(50), at(90))
    };
    let (c10, c50, c90) = quantiles(seasons.iter().map(|s| s.cash).collect());
    let (s10, s50, s90) = quantiles(seasons.iter().map(|s| s.next_spendable as i64).collect());
    let count = seasons.len() as f64;
    let sales: u32 = seasons.iter().map(|s| s.sales).sum();
    let money: u64 = seasons.iter().map(|s| s.sale_money).sum();
    println!(
        "{buys:<8} | {buyers:<8} | {:>9} {:>9} {:>9} | {:>11} {:>9} {:>9} | {:>8.2} | {:>5.2} | {:>14} | {:>5.1}",
        c10,
        c50,
        c90,
        s10,
        s50,
        s90,
        f64::from(seasons.iter().map(|s| s.listings).sum::<u32>()) / count,
        f64::from(sales) / count,
        if sales == 0 {
            0
        } else {
            money / u64::from(sales)
        },
        seasons.iter().map(|s| s.squad as f64).sum::<f64>() / count,
    );
}
