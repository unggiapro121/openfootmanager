//! E3-11: how often bots bid on the online market, and what they pay, under the rules of
//! analysis-bot-auction-bids.md (B1–B4), so `participationPermille` and the price range can be
//! chosen from numbers. Run by hand:
//! `cargo test --release -p ofm-rules --test online_bot_bid_measure -- --ignored --nocapture`.
//!
//! The world is the 560 starter clubs of E3-10, each a bot at the start of a season: opening cash,
//! nothing bought, no auction held. Tables 2–4 hold the rules but one value, the alternatives the
//! measure decided between: lines counted by seniors only, the upgrade margin, the budget. Every player of the first 42 clubs is listed in turn, alone,
//! at the floor of the price band, at his value and at 130% of it; the other 559 clubs are the
//! region's bots. Each listing samples its bots, keeps the ones wanting the player, rolls who
//! takes part and plays the auction out: bots in the order of their first bid, each bidding the
//! least the auction takes while that is within its price, until none bids. No person bids, so
//! the price printed is what bots alone pay.

use domain::player::{Position, SquadRole};
use ofm_rules::economy::{DEFAULT_BID_STEPS, online_market_value, price_band};
use ofm_rules::market_ai::{
    AuctionRolls, BotBidRules, BotInterest, Need, UPGRADE_MARGIN, bot_ceiling,
    bot_first_bid_permille, bot_interest, bot_line_counts, bot_next_bid, bot_sample,
    bots_taking_part, club_needs, line_needs,
};
use ofm_rules::player_rating::player_age;
use ofm_rules::squad::{first_choice_eleven, group_index};
use ofm_rules::worldgen::online::{GeneratedClub, Generator, OnlineContentPack};

const SEASON_YEAR: u32 = 2026;
const OPENING_CASH: u64 = 3_000_000;
const CLUBS: u64 = 560;
const SELLING_CLUBS: usize = 42;
const WORLD_SEED: u64 = 2026;

struct Bot {
    id: String,
    needs: Vec<Need>,
}

struct Listing {
    auction_id: String,
    value: u64,
    age: i32,
    first_choice: bool,
    seller: usize,
    player: domain::player::Player,
}

#[derive(Default)]
struct Tally {
    listings: usize,
    wanted: usize,
    wanting_bots: usize,
    with_bots: usize,
    bots: usize,
    sold: usize,
    held_by_money: usize,
    price_shares: Vec<f64>,
}

/// Given the 560 starter clubs of the builtin pack as bots,
/// when every player of 42 of them is listed at three starting prices and at three chances to
/// take part,
/// then how often bots want, join and buy, and at what share of the value, is printed.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure_e3_11_bot_bids() {
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(2026, &pack).unwrap();
    let clubs: Vec<GeneratedClub> = (0..CLUBS)
        .map(|ordinal| generator.club("Europe", ordinal, 0, 2026, None).unwrap())
        .collect();
    let bots: Vec<Bot> = clubs.iter().map(|club| bot_of(club, true)).collect();
    let by_seniors: Vec<Bot> = clubs.iter().map(|club| bot_of(club, false)).collect();
    let listings = listings_of(&clubs[..SELLING_CLUBS]);

    let mut values: Vec<u64> = listings.iter().map(|l| l.value).collect();
    values.sort_unstable();
    let pick = |q: usize| values[(values.len() - 1) * q / 100];
    let keepers = |role: SquadRole| {
        clubs[0]
            .players
            .iter()
            .filter(|p| p.position == Position::Goalkeeper && p.squad_role == role)
            .count()
    };
    let short_of = |bots: &[Bot]| {
        bots.iter()
            .filter(|bot| bot.needs.first().is_some_and(|need| need.short))
            .count()
    };
    println!(
        "E3-11 — {} starter clubs (pack {}, Europe, seed 2026) as bots; {} listings from {} clubs",
        clubs.len(),
        pack.version,
        listings.len(),
        SELLING_CLUBS
    );
    println!(
        "listed value: p10 {} median {} p90 {} max {}; squad {}–{}; goalkeepers {} senior + {} youth, a line's need {}",
        pick(10),
        pick(50),
        pick(90),
        values[values.len() - 1],
        clubs.iter().map(|c| c.players.len()).min().unwrap_or(0),
        clubs.iter().map(|c| c.players.len()).max().unwrap_or(0),
        keepers(SquadRole::Senior),
        keepers(SquadRole::Youth),
        line_needs(&clubs[0].team.formation)[0],
    );
    println!(
        "bots short of a line: {}/{} counting youth players (the rule); {}/{} counting seniors only",
        short_of(&bots),
        bots.len(),
        short_of(&by_seniors),
        by_seniors.len()
    );
    let rules = BotBidRules::default();
    println!(
        "bot rules: join {}‰, ≤{} bots, sample {}, price {}–{}‰ (+{}‰ short), reserve {}, budget {}/season",
        rules.participation_permille,
        rules.max_bots_per_auction,
        rules.sample_size,
        rules.ceiling_min_permille,
        rules.ceiling_max_permille,
        rules.short_line_bonus_permille,
        rules.cash_reserve,
        rules.season_spend
    );

    println!();
    println!("1. The rules, at three starting prices and three chances to take part.");
    println!("{HEADER}");
    for start_permille in [600, 1000, 1300] {
        for participation in [250, 350, 500] {
            let rules = BotBidRules {
                participation_permille: participation,
                ..BotBidRules::default()
            };
            for (label, first_choice) in SPLITS {
                let tally = run(&rules, &bots, &listings, start_permille, first_choice);
                print_row(
                    &format!("{:>4}% {participation:>4}‰", start_permille / 10),
                    label,
                    &tally,
                );
            }
        }
    }

    println!();
    println!("2. Lines counted by seniors only (the rule first proposed), at the value.");
    println!("{HEADER}");
    for (label, first_choice) in SPLITS {
        let tally = run(&rules, &by_seniors, &listings, 1000, first_choice);
        print_row("seniors   ", label, &tally);
    }

    println!();
    println!("3. The margin an upgrade must clear (the rule: 3), at the value.");
    println!("{HEADER}");
    for margin in [3.0, 1.0, 0.0, -2.0] {
        let shifted = with_upgrade_margin(&bots, margin);
        for (label, first_choice) in SPLITS {
            let tally = run(&rules, &shifted, &listings, 1000, first_choice);
            print_row(&format!("margin {margin:>+3.0}"), label, &tally);
        }
    }

    println!();
    println!("4. The season's budget and the reserve (the rule: 2.0M and 1.0M), at the value.");
    println!("{HEADER}");
    for (budget, reserve) in [
        (1_200_000, 1_500_000),
        (2_000_000, 1_000_000),
        (3_000_000, 0),
    ] {
        let rules = BotBidRules {
            season_spend: budget,
            cash_reserve: reserve,
            ..BotBidRules::default()
        };
        for (label, first_choice) in SPLITS {
            let tally = run(&rules, &bots, &listings, 1000, first_choice);
            print_row(
                &format!("{:.1}M/{:.1}M", budget as f64 / 1e6, reserve as f64 / 1e6),
                label,
                &tally,
            );
        }
    }
}

const SPLITS: [(&str, Option<bool>); 3] = [
    ("eleven", Some(true)),
    ("others", Some(false)),
    ("all", None),
];

const HEADER: &str = "case       | players | listings | wanted by ≥1 | bots wanting | with a bot | bots/listing | sold | price/value p50 p90 | bots short of money/listing";

/// The same bots asking less of an upgrade: `margin` over the weak slot instead of the rule's 3.
fn with_upgrade_margin(bots: &[Bot], margin: f64) -> Vec<Bot> {
    bots.iter()
        .map(|bot| Bot {
            id: bot.id.clone(),
            needs: bot
                .needs
                .iter()
                .map(|need| Need {
                    bar: if need.short {
                        need.bar
                    } else {
                        need.bar - UPGRADE_MARGIN + margin
                    },
                    ..need.clone()
                })
                .collect(),
        })
        .collect()
}

/// A bot of `club`. With `youth_cover` (the rule), its youth players count toward each line's
/// cover; without, its seniors alone, as the game's AI clubs count.
fn bot_of(club: &GeneratedClub, youth_cover: bool) -> Bot {
    let available: Vec<&domain::player::Player> =
        club.players.iter().filter(|p| p.injury.is_none()).collect();
    let seniors = if youth_cover {
        bot_line_counts(&club.players)
    } else {
        let mut seniors = [0; 4];
        for player in club
            .players
            .iter()
            .filter(|p| p.squad_role == SquadRole::Senior)
        {
            seniors[group_index(&player.position)] += 1;
        }
        seniors
    };
    Bot {
        id: club.team.id.clone(),
        needs: club_needs(&club.team.formation, seniors, &available),
    }
}

fn listings_of(sellers: &[GeneratedClub]) -> Vec<Listing> {
    let mut listings = Vec::new();
    for (seller, club) in sellers.iter().enumerate() {
        let squad: Vec<&domain::player::Player> = club.players.iter().collect();
        let eleven: Vec<&str> = first_choice_eleven(&squad, &club.team.formation)
            .iter()
            .map(|p| p.id.as_str())
            .collect();
        for player in &club.players {
            let age = player_age(&player.date_of_birth, SEASON_YEAR) as i32;
            listings.push(Listing {
                auction_id: format!("auction-{}", player.id),
                value: online_market_value(player, club.team.reputation, age),
                age,
                first_choice: eleven.contains(&player.id.as_str()),
                seller,
                player: player.clone(),
            });
        }
    }
    listings
}

fn run(
    rules: &BotBidRules,
    bots: &[Bot],
    listings: &[Listing],
    start_permille: u32,
    first_choice: Option<bool>,
) -> Tally {
    let spendable = rules.spendable(OPENING_CASH, 0);
    let mut tally = Tally::default();
    for listing in listings
        .iter()
        .filter(|l| first_choice.is_none_or(|wanted| l.first_choice == wanted))
    {
        tally.listings += 1;
        let band = price_band(listing.value, 600, 2_500);
        let start = (u128::from(listing.value) * u128::from(start_permille) / 1000) as u64;
        let start = start.clamp(band.min, band.max);
        let rolls = AuctionRolls::new(WORLD_SEED, &listing.auction_id);
        let region: Vec<&str> = bots
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != listing.seller)
            .map(|(_, bot)| bot.id.as_str())
            .collect();
        let sample = bot_sample(rules, &rolls, &region);
        let wanting: Vec<(&str, BotInterest)> = sample
            .iter()
            .filter_map(|id| {
                let bot = bots.iter().find(|b| b.id == *id)?;
                bot_interest(&bot.needs, &listing.player, listing.age).map(|i| (*id, i))
            })
            .collect();
        if !wanting.is_empty() {
            tally.wanted += 1;
        }
        tally.wanting_bots += wanting.len();
        let mut bidders: Vec<(u32, &str, u64)> = Vec::new();
        for (club, interest) in bots_taking_part(rules, &rolls, &wanting) {
            let wanted = bot_ceiling(
                rules,
                &rolls,
                club,
                interest,
                listing.value,
                u64::MAX,
                band.max,
            );
            let ceiling = wanted.min(spendable);
            if ceiling < start {
                if wanted >= start {
                    tally.held_by_money += 1;
                }
                continue;
            }
            bidders.push((bot_first_bid_permille(rules, &rolls, club), club, ceiling));
        }
        if bidders.is_empty() {
            continue;
        }
        tally.with_bots += 1;
        tally.bots += bidders.len();
        bidders.sort_unstable();
        if let Some(price) = auction(&bidders, start) {
            tally.sold += 1;
            tally.price_shares.push(price as f64 / listing.value as f64);
        }
    }
    tally
}

/// The auction played out by bots alone: in the order of their first bids, each not leading bids
/// the least the auction takes while that is within its price, until a full round passes with no
/// bid. The leading price at the end, if any bot bid.
fn auction(bidders: &[(u32, &str, u64)], start: u64) -> Option<u64> {
    let mut leading: Option<(u64, &str)> = None;
    loop {
        let mut bid_this_round = false;
        for (_, club, ceiling) in bidders {
            if leading.is_some_and(|(_, leader)| leader == *club) {
                continue;
            }
            if let Some(bid) =
                bot_next_bid(leading.map(|l| l.0), start, &DEFAULT_BID_STEPS, *ceiling)
            {
                leading = Some((bid, club));
                bid_this_round = true;
            }
        }
        if !bid_this_round {
            return leading.map(|(price, _)| price);
        }
    }
}

fn print_row(case: &str, label: &str, tally: &Tally) {
    let share = |part: usize| part as f64 / tally.listings.max(1) as f64 * 100.0;
    let mut shares = tally.price_shares.clone();
    shares.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let quantile = |q: usize| {
        shares
            .get(shares.len().saturating_sub(1) * q / 100)
            .copied()
            .unwrap_or(0.0)
    };
    println!(
        "{case:<10} | {label:<7} | {:>8} | {:>11.1}% | {:>12.2} | {:>9.1}% | {:>12.2} | {:>3.0}% | {:>9.2} {:>5.2} | {:>5.2}",
        tally.listings,
        share(tally.wanted),
        tally.wanting_bots as f64 / tally.listings.max(1) as f64,
        share(tally.with_bots),
        tally.bots as f64 / tally.listings.max(1) as f64,
        share(tally.sold),
        quantile(50),
        quantile(90),
        tally.held_by_money as f64 / tally.listings.max(1) as f64,
    );
}
