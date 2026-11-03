//! What a club looks for on the transfer market, what it can spare, and how an online bot bids
//! and sells.
//!
//! The needs are the game's AI clubs' (`ofm_core::transfers::ai_market`), moved here unchanged so
//! a bot on the online market wants what an AI club of the game wants (phase 3, E3-11), and the
//! sale rules share their veteran and playing-time thresholds (E3-12). The rest is the online
//! bot's own (analysis-bot-auction-bids.md): whether it takes part in an auction, the price it
//! goes to and when it bids (B1–B6), and which player it lists, when and at what price (B8–B10). Every roll comes from the world's seed, the
//! auction and the club, so the same bot decides the same way each time the server asks, and no
//! one who knows only the auction can work out its price.

use domain::player::{Player, Position, SquadRole};
use rand::RngExt;
use serde::{Deserialize, Serialize};

use crate::economy::{BidStep, minimum_next_bid};
use crate::player_rating::{formation_slots, positional_fit_for_assignment};
use crate::seed::rng_for_seed;
use crate::squad::{first_choice_eleven, group_index};

/// A line needs its formation slots and this many more as cover.
pub const COVER_PER_LINE: usize = 2;
/// A line is overloaded beyond its need by more than this; no club buys there.
pub const SURPLUS_MARGIN: usize = 2;
/// An upgrade has to be at least this much better in the slot.
pub const UPGRADE_MARGIN: f64 = 3.0;
/// The oldest player a club buys as an upgrade.
pub const MAX_UPGRADE_AGE: i32 = 32;
/// How many of its weakest slots a club looks to upgrade in one review: the
/// weakest may have no one on the market it can buy, the next may.
pub const SLOTS_LOOKED_AT: usize = 3;
/// A player this old is sold once he is below the squad's median overall.
pub const VETERAN_AGE: i32 = 31;
/// A player whose playing time (0–100) is under this hardly plays and is sold.
pub const UNUSED_PLAYING_TIME: u8 = 20;
/// How far under the bar a player's overall may sit and his fit in the slot still be worth
/// working out: a player's best slot rates him up to about this much above his overall.
const OVERALL_SLACK: f64 = 6.0;

/// Seniors each line needs under `formation`: its slots and two to cover them.
pub fn line_needs(formation: &str) -> [usize; 4] {
    let mut needs = [COVER_PER_LINE; 4];
    for slot in formation_slots(formation) {
        needs[group_index(&slot)] += 1;
    }
    needs
}

/// A line holding more than it needs and its surplus margin: no buying there.
pub fn line_is_overloaded(seniors: usize, need: usize) -> bool {
    seniors > need + SURPLUS_MARGIN
}

/// The squad's median overall, the upper one of an even squad; 0 for an empty squad.
pub fn median_ovr<'a>(squad: impl IntoIterator<Item = &'a Player>) -> u8 {
    let mut ratings: Vec<u8> = squad.into_iter().map(|player| player.ovr).collect();
    if ratings.is_empty() {
        return 0;
    }
    ratings.sort_unstable();
    ratings[ratings.len() / 2]
}

/// A bot's players per line, its youth players among them (E3-11). An online starter squad keeps
/// its third goalkeeper in the youth squad, so counted by seniors alone every bot is short of a
/// keeper and wants nothing else; a bot fields its youth players, so they cover a line for it.
pub fn bot_line_counts<'a>(squad: impl IntoIterator<Item = &'a Player>) -> [usize; 4] {
    let mut counts = [0; 4];
    for player in squad.into_iter().filter(|player| !player.retired) {
        counts[group_index(&player.position)] += 1;
    }
    counts
}

/// What a club is shopping for: a slot to fill, and how good a player must be
/// there to be worth buying.
#[derive(Debug, Clone, PartialEq)]
pub struct Need {
    pub slot: Position,
    /// The rating in the slot a signing has to reach.
    pub bar: f64,
    /// The club is short in the slot's line, so anyone adequate will do.
    pub short: bool,
}

/// The club's needs, most pressing first: a body for a line under its needs,
/// otherwise upgrades on the [`SLOTS_LOOKED_AT`] weakest players of its first
/// eleven — none in a line already overloaded. `seniors` counts the club's
/// players per line, injured or not (the game counts its seniors, a bot its
/// youth players too); `available` are the ones fit to play.
pub fn club_needs(formation: &str, seniors: [usize; 4], available: &[&Player]) -> Vec<Need> {
    let needs = line_needs(formation);
    let slots = formation_slots(formation);
    if let Some(slot) = slots.iter().find(|slot| {
        let line = group_index(slot);
        seniors[line] < needs[line]
    }) {
        return vec![Need {
            slot: slot.clone(),
            bar: 0.0,
            short: true,
        }];
    }

    let eleven = first_choice_eleven(available, formation);
    let mut rated: Vec<(&Position, f64)> = slots
        .iter()
        .zip(eleven.iter())
        .map(|(slot, starter)| (slot, positional_fit_for_assignment(starter, slot)))
        .collect();
    rated.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    rated
        .into_iter()
        .filter(|(slot, _)| {
            let line = group_index(slot);
            !line_is_overloaded(seniors[line], needs[line])
        })
        .take(SLOTS_LOOKED_AT)
        .map(|(slot, rating)| Need {
            slot: slot.clone(),
            bar: rating + UPGRADE_MARGIN,
            short: false,
        })
        .collect()
}

/// What `player`, `age` years old, is worth to a club for `need`, if he answers it at all: a fit,
/// senior player of the need's line who reaches its bar in the slot, and for an upgrade no older
/// than [`MAX_UPGRADE_AGE`]. For a short line the worth is his rating in the slot; for an upgrade,
/// how far he clears the bar plus [`UPGRADE_MARGIN`].
pub fn answers_need(need: &Need, player: &Player, age: i32) -> Option<f64> {
    if player.retired
        || player.injury.is_some()
        || player.squad_role != SquadRole::Senior
        || group_index(&player.position) != group_index(&need.slot)
        || f64::from(player.ovr) + OVERALL_SLACK < need.bar
        || (!need.short && age > MAX_UPGRADE_AGE)
    {
        return None;
    }
    let rating = positional_fit_for_assignment(player, &need.slot);
    if rating < need.bar {
        return None;
    }
    Some(if need.short {
        rating
    } else {
        rating - need.bar + UPGRADE_MARGIN
    })
}

/// How a bot wants a player on the market (B1): for a line it is short in, or as an upgrade, and
/// how much it is worth to it. Bots short of a line come first, then the larger worth.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BotInterest {
    pub short: bool,
    pub worth: f64,
}

/// The first of a bot's `needs` that `player` answers, if any.
pub fn bot_interest(needs: &[Need], player: &Player, age: i32) -> Option<BotInterest> {
    needs.iter().find_map(|need| {
        answers_need(need, player, age).map(|worth| BotInterest {
            short: need.short,
            worth,
        })
    })
}

/// The values of the bots' bidding, a season's ruleset (analysis-bot-auction-bids.md B6). Times
/// are seconds of a full day; the server scales them with the season's day as every market time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct BotBidRules {
    /// The chance, in thousandths, that a bot wanting the player takes part in the auction.
    pub participation_permille: u32,
    /// The most bots taking part in one auction.
    pub max_bots_per_auction: u32,
    /// The most bots of a region looked at for one auction.
    pub sample_size: u32,
    /// The range a bot's price is drawn from, in thousandths of the player's value.
    pub ceiling_min_permille: u32,
    pub ceiling_max_permille: u32,
    /// Added to the price of a bot short of the player's line, in thousandths of his value.
    pub short_line_bonus_permille: u32,
    /// The cash a bot keeps whatever it buys, in euros.
    pub cash_reserve: u64,
    /// The most a bot spends in a season, in euros.
    pub season_spend: u64,
    /// The most players a bot buys in a season.
    pub max_buys_per_season: u32,
    /// A bot with this many players buys no more.
    pub squad_cap: u32,
    /// When a bot first bids, in thousandths of the auction's length after the listing.
    pub first_bid_from_permille: u32,
    pub first_bid_to_permille: u32,
    /// How long a bot outbid takes to answer.
    pub reply_delay_min_seconds: u32,
    pub reply_delay_max_seconds: u32,
    /// What a bot does for a player's own listing, which it is to buy before another bot's sale
    /// (S-11g): it joins more often, more of them join, each pays more and keeps less cash back.
    pub person_participation_permille: u32,
    pub person_max_bots_per_auction: u32,
    /// Added to both ends of the price range, in thousandths of the player's value.
    pub person_ceiling_bonus_permille: u32,
    pub person_cash_reserve: u64,
    /// What it does for another bot's sale: it joins less often, and buys at most this many
    /// players of bots in a season, so what it has left goes to people's listings.
    pub bot_sale_participation_permille: u32,
    pub bot_sale_max_buys_per_season: u32,
}

/// Who sells an auction's player, as a bot reads it (S-11g).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SellerKind {
    /// A club a person runs: the listing a bot is to buy first.
    Person,
    /// A club the server runs.
    Bot,
    /// The world, for a free agent.
    World,
}

impl Default for BotBidRules {
    /// The values of analysis-bot-auction-bids.md B1–B6 as E3-11 measured them
    /// (e3-11-bot-bids.txt), raised in S-11g: a bot held about 1.65M and kept 1.0M back, so it
    /// could pay 0.65M while the listings of people started at 1.55M and over, and only 4 of 65
    /// of them sold. The reserve falls to 0.4M, the budget and the buys of a season rise, and a
    /// person's listing is bought before a bot's (`for_seller`).
    fn default() -> Self {
        Self {
            participation_permille: 500,
            max_bots_per_auction: 3,
            sample_size: 40,
            ceiling_min_permille: 850,
            ceiling_max_permille: 1_250,
            short_line_bonus_permille: 100,
            cash_reserve: 400_000,
            season_spend: 3_500_000,
            max_buys_per_season: 3,
            squad_cap: 25,
            first_bid_from_permille: 100,
            first_bid_to_permille: 700,
            reply_delay_min_seconds: 20,
            reply_delay_max_seconds: 120,
            person_participation_permille: 900,
            person_max_bots_per_auction: 4,
            person_ceiling_bonus_permille: 150,
            person_cash_reserve: 150_000,
            bot_sale_participation_permille: 300,
            bot_sale_max_buys_per_season: 1,
        }
    }
}

impl BotBidRules {
    /// Whether these values work with the market's: a bot must be able to answer inside the soft
    /// close, or a bid in the last seconds would beat it whatever its price (B4), and its price
    /// must stay under the cap, so a tie at the cap never needs a bot's coach level (B3).
    pub fn fits_market(&self, soft_close_seconds: u32, price_band_max_permille: u32) -> bool {
        self.ceiling_min_permille <= self.ceiling_max_permille
            && self.first_bid_from_permille <= self.first_bid_to_permille
            && self.first_bid_to_permille <= 1_000
            && self.reply_delay_min_seconds <= self.reply_delay_max_seconds
            && self.reply_delay_max_seconds < soft_close_seconds
            && self.ceiling_max_permille
                + self.short_line_bonus_permille
                + self.person_ceiling_bonus_permille
                < price_band_max_permille
    }

    /// These rules as a bot applies them to an auction of `seller` (S-11g): a person's listing is
    /// wanted more, another bot's less, and the world's free agent as the base says.
    pub fn for_seller(&self, seller: SellerKind) -> Self {
        match seller {
            SellerKind::Person => Self {
                participation_permille: self.person_participation_permille,
                max_bots_per_auction: self.person_max_bots_per_auction,
                ceiling_min_permille: self.ceiling_min_permille
                    + self.person_ceiling_bonus_permille,
                ceiling_max_permille: self.ceiling_max_permille
                    + self.person_ceiling_bonus_permille,
                cash_reserve: self.person_cash_reserve,
                ..*self
            },
            SellerKind::Bot => Self {
                participation_permille: self.bot_sale_participation_permille,
                ..*self
            },
            SellerKind::World => *self,
        }
    }

    /// Whether a bot that bought `from_bots` players of bots this season may buy another of
    /// `seller`: another bot's sale only up to [`Self::bot_sale_max_buys_per_season`].
    pub fn may_buy_from(&self, seller: SellerKind, from_bots: u32) -> bool {
        seller != SellerKind::Bot || from_bots < self.bot_sale_max_buys_per_season
    }

    /// What a bot may still spend (B3): its cash above the reserve, and no more than what is left
    /// of the season's budget. Amounts are whole euros.
    pub fn spendable(&self, cash: u64, spent_this_season: u64) -> u64 {
        cash.saturating_sub(self.cash_reserve)
            .min(self.season_spend.saturating_sub(spent_this_season))
    }
}

/// The bots of a region looked at for one auction (B1): all of them while they are no more than
/// [`BotBidRules::sample_size`], otherwise that many drawn for the auction, in the order given.
pub fn bot_sample<'a>(rules: &BotBidRules, rolls: &AuctionRolls, bots: &[&'a str]) -> Vec<&'a str> {
    let size = rules.sample_size as usize;
    if bots.len() <= size {
        return bots.to_vec();
    }
    let mut rng = rolls.roll("sample", "");
    let mut picked = rand::seq::index::sample(&mut rng, bots.len(), size).into_vec();
    picked.sort_unstable();
    picked.into_iter().map(|index| bots[index]).collect()
}

/// Which bots take part in an auction (B2): of the bots wanting the player, by `(club, interest)`,
/// each joins on its own roll, and of those the [`BotBidRules::max_bots_per_auction`] wanting him
/// most — short of his line first, then the larger worth, then the club id.
pub fn bots_taking_part<'a>(
    rules: &BotBidRules,
    rolls: &AuctionRolls,
    wanting: &[(&'a str, BotInterest)],
) -> Vec<(&'a str, BotInterest)> {
    let mut joining: Vec<(&'a str, BotInterest)> = wanting
        .iter()
        .copied()
        .filter(|(club, _)| {
            rolls.roll("join", club).random_range(0..1000) < rules.participation_permille
        })
        .collect();
    joining.sort_by(|(a_club, a), (b_club, b)| {
        b.short
            .cmp(&a.short)
            .then(
                b.worth
                    .partial_cmp(&a.worth)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
            .then(a_club.cmp(b_club))
    });
    joining.truncate(rules.max_bots_per_auction as usize);
    joining
}

/// The price a bot goes to for a player of `value` (B3): the value times a share drawn for this
/// auction and club, more when it is short of his line, held under what it may spend and the cap.
pub fn bot_ceiling(
    rules: &BotBidRules,
    rolls: &AuctionRolls,
    club_id: &str,
    interest: BotInterest,
    value: u64,
    spendable: u64,
    price_cap: u64,
) -> u64 {
    let drawn = rolls
        .roll("ceiling", club_id)
        .random_range(rules.ceiling_min_permille..=rules.ceiling_max_permille);
    let share = if interest.short {
        drawn + rules.short_line_bonus_permille
    } else {
        drawn
    };
    permille_of(value, share).min(spendable).min(price_cap)
}

/// When a bot first bids (B4), in thousandths of the auction's length after it was listed.
pub fn bot_first_bid_permille(rules: &BotBidRules, rolls: &AuctionRolls, club_id: &str) -> u32 {
    rolls
        .roll("first-bid", club_id)
        .random_range(rules.first_bid_from_permille..=rules.first_bid_to_permille)
}

/// How long a bot takes to answer being outbid (B4), in seconds of a full day. `bids` is the
/// auction's count of bids when it was outbid, so each answer is its own roll.
pub fn bot_reply_delay_seconds(
    rules: &BotBidRules,
    rolls: &AuctionRolls,
    club_id: &str,
    bids: u32,
) -> u32 {
    rolls
        .roll(&format!("reply/{bids}"), club_id)
        .random_range(rules.reply_delay_min_seconds..=rules.reply_delay_max_seconds)
}

/// A bot's next bid (B4): the least the auction takes, if that is within its `ceiling`. A bot bids
/// the minimum each time, as a proxy would; it never bids while it leads.
pub fn bot_next_bid(
    leading: Option<u64>,
    start_price: u64,
    steps: &[BidStep],
    ceiling: u64,
) -> Option<u64> {
    Some(minimum_next_bid(leading, start_price, steps)).filter(|bid| *bid <= ceiling)
}

/// The bots' dice for one auction (B5). The world's seed keeps a bot's price from anyone who knows
/// only the auction and the club; each roll is named, so the rolls stay apart and asking one again
/// gives the same answer.
#[derive(Debug, Clone, Copy)]
pub struct AuctionRolls<'a> {
    world_seed: u64,
    auction_id: &'a str,
}

impl<'a> AuctionRolls<'a> {
    pub fn new(world_seed: u64, auction_id: &'a str) -> Self {
        Self {
            world_seed,
            auction_id,
        }
    }

    fn roll(&self, what: &str, club_id: &str) -> rand_chacha::ChaCha12Rng {
        rng_for_seed(
            self.world_seed,
            &format!("market-bot/{what}"),
            &format!("{}/{club_id}", self.auction_id),
        )
    }
}

/// The values of the bots' sales, a season's ruleset (analysis-bot-auction-bids.md B8–B10).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BotSaleRules {
    /// The chance, in thousandths, that a bot with a player to spare lists him on a season day.
    pub list_chance_permille: u32,
    /// The most players a bot sells in a season, forced sales apart.
    pub max_sales_per_season: u32,
    /// The players a bot keeps beside its open sales. Above the season's squad floor, or a bot
    /// selling down to it is handed free agents at the season's end.
    pub keep_squad: u32,
    /// The first starting price, in thousandths of the player's value.
    pub start_permille: u32,
    /// Taken off the starting price for each time the player went unsold this season.
    pub unsold_step_permille: u32,
    /// The lowest starting price, in thousandths of the player's value.
    pub floor_permille: u32,
    /// A player this old below the squad's median overall is sold.
    pub veteran_age: i32,
    /// A player whose playing time is under this is sold, from `unused_from_day` on.
    pub unused_playing_time: u8,
    /// The season day from which playing time has had matches enough to say who is unused.
    pub unused_from_day: u32,
    /// A bot's sale of one of its best players a season (phase 4, S-34 S34-8); none when absent,
    /// as in every ruleset before v12.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub star: Option<StarSaleRules>,
}

impl Default for BotSaleRules {
    /// The values of analysis-bot-auction-bids.md B8–B10.
    fn default() -> Self {
        Self {
            list_chance_permille: 250,
            max_sales_per_season: 3,
            keep_squad: 20,
            start_permille: 1_000,
            unsold_step_permille: 100,
            floor_permille: 800,
            veteran_age: VETERAN_AGE,
            unused_playing_time: UNUSED_PLAYING_TIME,
            unused_from_day: 8,
            star: None,
        }
    }
}

impl BotSaleRules {
    /// Whether these values work with the season's: a bot's price never under the market's
    /// floor, and a bot never sold down to the squad floor the season's end tops clubs up to.
    pub fn fits_season(&self, price_band_min_permille: u32, squad_floor: u32) -> bool {
        self.floor_permille >= price_band_min_permille
            && self.start_permille >= self.floor_permille
            && self.keep_squad > squad_floor
            && self
                .star
                .is_none_or(|star| star.fits_season(price_band_min_permille))
    }

    /// The starting price of a player of `value` the bot listed `unsold` times this season with
    /// no one bidding (B10): the value, a step less for each time, never under the floor.
    pub fn listing_price(&self, value: u64, unsold: u32) -> u64 {
        stepped_price(
            value,
            unsold,
            self.start_permille,
            self.unsold_step_permille,
            self.floor_permille,
        )
    }
}

/// The values of a bot's star sale (phase 4, S-34 S34-8): once a season a levelled bot lists one
/// of its eleven best, in his prime and up to its level, above his value, so its rebuilding feeds
/// the market with players worth buying.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StarSaleRules {
    /// The most star sales a bot lists in a season.
    pub max_per_season: u32,
    /// The youngest a star sold is.
    pub youngest: i32,
    /// The oldest a star sold is.
    pub oldest: i32,
    /// How far, in tenths, under the bot's level target a star's overall may be.
    pub ovr_below_target_tenths: u32,
    /// The season day from which a bot lists a star.
    pub from_day: u32,
    /// The chance, in thousandths, that a bot with a star to sell lists him on a season day.
    pub list_chance_permille: u32,
    /// The first starting price, in thousandths of the player's value.
    pub start_permille: u32,
    /// Taken off the starting price for each time the star went unsold this season.
    pub unsold_step_permille: u32,
    /// The lowest starting price, in thousandths of the player's value.
    pub floor_permille: u32,
}

impl Default for StarSaleRules {
    /// The values of S-34 S34-8.
    fn default() -> Self {
        Self {
            max_per_season: 1,
            youngest: 24,
            oldest: 29,
            ovr_below_target_tenths: 20,
            from_day: 3,
            list_chance_permille: 250,
            start_permille: 1_200,
            unsold_step_permille: 100,
            floor_permille: 1_000,
        }
    }
}

impl StarSaleRules {
    /// Whether these values work with the season's: never under the market's floor, the first
    /// price not under the last, and a sound age range.
    pub fn fits_season(&self, price_band_min_permille: u32) -> bool {
        self.floor_permille >= price_band_min_permille
            && self.start_permille >= self.floor_permille
            && self.youngest <= self.oldest
    }

    /// The starting price of a star of `value` listed `unsold` times this season with no one
    /// bidding: as [`BotSaleRules::listing_price`], on the star's own values.
    pub fn listing_price(&self, value: u64, unsold: u32) -> u64 {
        stepped_price(
            value,
            unsold,
            self.start_permille,
            self.unsold_step_permille,
            self.floor_permille,
        )
    }
}

/// `start` thousandths of `value`, `step` less for each of `unsold` times, never under `floor`.
fn stepped_price(value: u64, unsold: u32, start: u32, step: u32, floor: u32) -> u64 {
    let off = u64::from(step) * u64::from(unsold);
    let share = u64::from(start).saturating_sub(off).max(u64::from(floor));
    permille_of(value, u32::try_from(share).unwrap_or(u32::MAX))
}

/// One of a bot's players with his age, as its sale rule reads him.
#[derive(Debug, Clone, Copy)]
pub struct SquadMember<'a> {
    pub player: &'a Player,
    pub age: i32,
}

/// The player a bot would list today, if any (B8): the lowest-rated of its players it can spare,
/// by overall then id. A player is spared when his line holds more than it needs, or his line
/// just took a signing that upgrades it (`upgraded_line`, a line index), or he is a veteran
/// below the squad's median, or, from `unused_from_day`, he hardly plays.
///
/// Whatever the reason, the sale leaves his line its need, so a bot never sells into a shortage
/// it would then buy for, and leaves the squad `keep_squad` players beside its `open_sales`.
/// An injured player is not listed: the market refuses him.
pub fn bot_surplus<'a>(
    rules: &BotSaleRules,
    formation: &str,
    squad: &[SquadMember<'a>],
    season_day: u32,
    upgraded_line: Option<usize>,
    open_sales: u32,
) -> Option<&'a Player> {
    if (squad.len() as u64) < u64::from(rules.keep_squad) + u64::from(open_sales) + 1 {
        return None;
    }
    let counts = bot_line_counts(squad.iter().map(|member| member.player));
    let needs = line_needs(formation);
    let median = median_ovr(squad.iter().map(|member| member.player));
    let mut candidates: Vec<&SquadMember<'a>> = squad
        .iter()
        .filter(|member| !member.player.retired && member.player.injury.is_none())
        .collect();
    candidates.sort_by(|a, b| {
        a.player
            .ovr
            .cmp(&b.player.ovr)
            .then_with(|| a.player.id.cmp(&b.player.id))
    });
    candidates
        .into_iter()
        .find(|member| {
            let line = group_index(&member.player.position);
            let spare = counts[line] > needs[line];
            let reason = line_is_overloaded(counts[line], needs[line])
                || upgraded_line == Some(line)
                || (member.age >= rules.veteran_age && member.player.ovr < median)
                || (season_day >= rules.unused_from_day
                    && member.player.playing_time < rules.unused_playing_time);
            spare && reason
        })
        .map(|member| member.player)
}

/// Whether a bot with a player to spare lists him on `season_day` (B9): its own roll of the
/// world's seed, the club and the day.
pub fn bot_lists_today(
    rules: &BotSaleRules,
    world_seed: u64,
    club_id: &str,
    season_day: u32,
) -> bool {
    rng_for_seed(
        world_seed,
        "market-bot/list",
        &format!("{club_id}/{season_day}"),
    )
    .random_range(0..1000)
        < rules.list_chance_permille
}

/// The star a levelled bot would list today, if any (S34-8): of its eleven best by overall, the
/// best one aged `youngest`–`oldest`, fit, rated at least `target_tenths` less
/// `ovr_below_target_tenths`, whose line keeps its need without him; ties by id. None before
/// `from_day` or once the bot listed `max_per_season` stars this season.
pub fn bot_star_sale<'a>(
    rules: &StarSaleRules,
    formation: &str,
    squad: &[SquadMember<'a>],
    target_tenths: u32,
    season_day: u32,
    listed_this_season: u32,
) -> Option<&'a Player> {
    if season_day < rules.from_day || listed_this_season >= rules.max_per_season {
        return None;
    }
    let counts = bot_line_counts(squad.iter().map(|member| member.player));
    let needs = line_needs(formation);
    let floor = target_tenths.saturating_sub(rules.ovr_below_target_tenths);
    let mut best: Vec<&SquadMember<'a>> = squad
        .iter()
        .filter(|member| !member.player.retired)
        .collect();
    best.sort_by(|a, b| {
        b.player
            .ovr
            .cmp(&a.player.ovr)
            .then_with(|| a.player.id.cmp(&b.player.id))
    });
    best.into_iter()
        .take(STAR_PLACES)
        .find(|member| {
            let line = group_index(&member.player.position);
            member.player.injury.is_none()
                && (rules.youngest..=rules.oldest).contains(&member.age)
                && u32::from(member.player.ovr) * 10 >= floor
                && counts[line] > needs[line]
        })
        .map(|member| member.player)
}

/// The places a star is drawn from: a bot's first eleven by overall.
const STAR_PLACES: usize = 11;

/// Whether a bot with a star to sell lists him on `season_day`: its own roll of the world's
/// seed, the club and the day, apart from its ordinary sales' roll.
pub fn bot_star_lists_today(
    rules: &StarSaleRules,
    world_seed: u64,
    club_id: &str,
    season_day: u32,
) -> bool {
    rng_for_seed(
        world_seed,
        "market-bot/star",
        &format!("{club_id}/{season_day}"),
    )
    .random_range(0..1000)
        < rules.list_chance_permille
}

/// `amount × permille / 1000`, rounded down, without overflow.
fn permille_of(amount: u64, permille: u32) -> u64 {
    (u128::from(amount) * u128::from(permille) / 1000).min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::economy::DEFAULT_BID_STEPS;
    use crate::test_support::uniform_attributes;
    use domain::player::Injury;

    fn player(id: &str, position: Position, level: u8) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "ENG".to_string(),
            position,
            uniform_attributes(level),
        );
        player.ovr = level;
        player
    }

    /// A 4-4-2 squad holding exactly what each line needs (3, 6, 6, 4), every player at `level`.
    fn full_squad(level: u8) -> Vec<Player> {
        let lines = [
            (Position::Goalkeeper, 3),
            (Position::CenterBack, 6),
            (Position::CentralMidfielder, 6),
            (Position::Striker, 4),
        ];
        lines
            .iter()
            .flat_map(|(position, count)| {
                (0..*count)
                    .map(move |n| player(&format!("{position:?}-{n}"), position.clone(), level))
            })
            .collect()
    }

    fn needs_of(squad: &[Player]) -> Vec<Need> {
        let available: Vec<&Player> = squad.iter().collect();
        club_needs("4-4-2", bot_line_counts(squad), &available)
    }

    const WANTS: BotInterest = BotInterest {
        short: false,
        worth: 5.0,
    };

    /// Given a 4-4-2, then each line needs its slots and two to cover them;
    /// given a 3-5-2, the midfield needs more and the back line less.
    #[test]
    fn each_line_needs_its_slots_and_two_more() {
        assert_eq!(line_needs("4-4-2"), [3, 6, 6, 4]);
        assert_eq!(line_needs("3-5-2"), [3, 5, 7, 4]);
    }

    /// Given a line two over its need, then it is not overloaded yet; three
    /// over, then it is.
    #[test]
    fn a_line_is_overloaded_three_beyond_its_need() {
        assert!(!line_is_overloaded(8, 6));
        assert!(line_is_overloaded(9, 6));
    }

    /// Given a 4-4-2 squad one goalkeeper short of its three,
    /// when its needs are worked out,
    /// then it needs a body in goal, at no bar, and nothing else.
    #[test]
    fn a_club_short_of_a_line_needs_a_body_there() {
        let mut squad = full_squad(60);
        squad.remove(0);

        let needs = needs_of(&squad);

        assert_eq!(
            needs,
            vec![Need {
                slot: Position::Goalkeeper,
                bar: 0.0,
                short: true,
            }]
        );
    }

    /// Given a full 4-4-2 squad, and then the same squad with three forwards too many,
    /// when its needs are worked out,
    /// then it looks to upgrade three slots of its eleven, weakest first, and none in
    /// the overloaded attack.
    #[test]
    fn a_full_club_upgrades_its_weakest_slots_outside_overloaded_lines() {
        let squad = full_squad(60);
        let needs = needs_of(&squad);
        assert_eq!(needs.len(), SLOTS_LOOKED_AT);
        assert!(
            needs
                .iter()
                .all(|need| !need.short && need.bar > UPGRADE_MARGIN)
        );
        assert!(needs.windows(2).all(|pair| pair[0].bar <= pair[1].bar));

        let mut crowded = full_squad(60);
        crowded.extend((0..3).map(|n| player(&format!("extra-{n}"), Position::Striker, 60)));
        assert!(
            needs_of(&crowded)
                .iter()
                .all(|need| group_index(&need.slot) != group_index(&Position::Striker))
        );
    }

    /// Given an upgrade need at a defender's slot,
    /// when a fit senior defender clearing the bar, then one injured, one of the youth squad, one
    /// too old, one too weak and a midfielder are offered,
    /// then only the first answers it, worth how far he clears the bar plus the margin; a short
    /// line takes the old one, worth his rating.
    #[test]
    fn only_a_fit_senior_of_the_line_over_the_bar_answers_a_need() {
        let good = player("cb", Position::CenterBack, 70);
        let rating = positional_fit_for_assignment(&good, &Position::CenterBack);
        let need = Need {
            slot: Position::CenterBack,
            bar: rating - 2.0,
            short: false,
        };
        assert_eq!(answers_need(&need, &good, 25), Some(2.0 + UPGRADE_MARGIN));

        let mut injured = good.clone();
        injured.injury = Some(Injury {
            name: "knock".to_string(),
            days_remaining: 3,
        });
        let mut academy = good.clone();
        academy.squad_role = SquadRole::Youth;
        let weak = player("weak", Position::CenterBack, 40);
        let midfielder = player("cm", Position::CentralMidfielder, 70);
        assert_eq!(answers_need(&need, &injured, 25), None);
        assert_eq!(answers_need(&need, &academy, 25), None);
        assert_eq!(answers_need(&need, &good, MAX_UPGRADE_AGE + 1), None);
        assert_eq!(answers_need(&need, &weak, 25), None);
        assert_eq!(answers_need(&need, &midfielder, 25), None);

        let short = Need {
            bar: 0.0,
            short: true,
            ..need
        };
        assert_eq!(
            answers_need(&short, &good, MAX_UPGRADE_AGE + 1),
            Some(rating)
        );
    }

    /// Given a bot's needs, a forward first and then a defender,
    /// when a defender is offered,
    /// then the bot wants him for the second need.
    #[test]
    fn a_bot_wants_a_player_for_the_first_need_he_answers() {
        let defender = player("cb", Position::CenterBack, 70);
        let needs = [
            Need {
                slot: Position::Striker,
                bar: 50.0,
                short: false,
            },
            Need {
                slot: Position::CenterBack,
                bar: 0.0,
                short: true,
            },
        ];

        let interest = bot_interest(&needs, &defender, 25).unwrap();

        assert!(interest.short);
        assert_eq!(
            interest.worth,
            positional_fit_for_assignment(&defender, &Position::CenterBack)
        );
    }

    /// Given a region of 30 bots, and then of 100, and a sample of 40,
    /// when the bots looked at for an auction are drawn, twice, and for another auction,
    /// then the small region is looked at whole, the large one by 40 distinct bots in their given
    /// order, the same 40 each time for one auction and others for another.
    #[test]
    fn a_large_region_is_looked_at_by_a_sample_drawn_for_the_auction() {
        let rules = BotBidRules::default();
        let names: Vec<String> = (0..100).map(|n| format!("bot-{n:03}")).collect();
        let bots: Vec<&str> = names.iter().map(String::as_str).collect();
        let rolls = AuctionRolls::new(9, "auction-1");

        assert_eq!(bot_sample(&rules, &rolls, &bots[..30]), &bots[..30]);
        let sample = bot_sample(&rules, &rolls, &bots);
        assert_eq!(sample.len(), 40);
        assert!(sample.windows(2).all(|pair| pair[0] < pair[1]));
        assert_eq!(bot_sample(&rules, &rolls, &bots), sample);
        assert_ne!(
            bot_sample(&rules, &AuctionRolls::new(9, "auction-2"), &bots),
            sample
        );
    }

    /// Given four bots wanting a player, one short of his line,
    /// when every bot joins and at most three take part,
    /// then the short one comes first, then the larger worth, and the fourth is left out; when
    /// none joins, no bot takes part.
    #[test]
    fn the_bots_wanting_a_player_most_take_part() {
        let wanting = [
            ("a", WANTS),
            (
                "b",
                BotInterest {
                    short: false,
                    worth: 9.0,
                },
            ),
            (
                "c",
                BotInterest {
                    short: true,
                    worth: 1.0,
                },
            ),
            ("d", WANTS),
        ];
        let everyone = BotBidRules {
            participation_permille: 1_000,
            ..BotBidRules::default()
        };
        let rolls = AuctionRolls::new(7, "auction-1");

        let taking_part: Vec<&str> = bots_taking_part(&everyone, &rolls, &wanting)
            .iter()
            .map(|(club, _)| *club)
            .collect();
        assert_eq!(taking_part, ["c", "b", "a"]);

        let no_one = BotBidRules {
            participation_permille: 0,
            ..BotBidRules::default()
        };
        assert!(bots_taking_part(&no_one, &rolls, &wanting).is_empty());
    }

    /// Given a thousand bots wanting a player at a 35% chance each,
    /// when they roll for one auction, again, and in another world,
    /// then about a third join, the same ones each time in one world, other ones in another.
    #[test]
    fn a_bot_joins_by_its_own_roll_of_the_world_and_the_auction() {
        let clubs: Vec<String> = (0..1000).map(|n| format!("club-{n}")).collect();
        let wanting: Vec<(&str, BotInterest)> = clubs.iter().map(|c| (c.as_str(), WANTS)).collect();
        let rules = BotBidRules {
            participation_permille: 350,
            max_bots_per_auction: 1_000,
            ..BotBidRules::default()
        };
        let join = |seed: u64| -> Vec<&str> {
            bots_taking_part(&rules, &AuctionRolls::new(seed, "auction-1"), &wanting)
                .iter()
                .map(|(club, _)| *club)
                .collect()
        };

        let first = join(1);
        assert!((300..=400).contains(&first.len()), "{} joined", first.len());
        assert_eq!(join(1), first);
        assert_ne!(join(2), first);
    }

    /// Given a player worth 1,000,000 and a bot with money to spare,
    /// when its price is drawn for many auctions, short of his line or not,
    /// then it stays inside the ceiling range, a short bot's is the bonus higher, and the same
    /// auction gives the same price.
    #[test]
    fn a_bots_price_is_a_share_of_the_value_drawn_in_its_range() {
        let rules = BotBidRules::default();
        let short = BotInterest {
            short: true,
            worth: 1.0,
        };
        for n in 0..200 {
            let auction = format!("auction-{n}");
            let rolls = AuctionRolls::new(3, &auction);
            let price = bot_ceiling(&rules, &rolls, "bot", WANTS, 1_000_000, u64::MAX, u64::MAX);
            assert!((850_000..=1_250_000).contains(&price), "{price}");
            let price_short =
                bot_ceiling(&rules, &rolls, "bot", short, 1_000_000, u64::MAX, u64::MAX);
            assert_eq!(price_short, price + 100_000);
            assert_eq!(
                bot_ceiling(&rules, &rolls, "bot", WANTS, 1_000_000, u64::MAX, u64::MAX),
                price
            );
        }
    }

    /// Given a bot's price drawn above what it may spend, and then above the auction's cap,
    /// when the price is worked out,
    /// then it is held to the lower of the two.
    #[test]
    fn a_bots_price_never_passes_its_money_or_the_cap() {
        let rules = BotBidRules::default();
        let rolls = AuctionRolls::new(3, "auction-1");

        assert_eq!(
            bot_ceiling(&rules, &rolls, "bot", WANTS, 1_000_000, 400_000, u64::MAX),
            400_000
        );
        assert_eq!(
            bot_ceiling(&rules, &rolls, "bot", WANTS, 1_000_000, u64::MAX, 700_000),
            700_000
        );
    }

    /// Given a reserve of 400,000 and a season's budget of 3,500,000,
    /// when a bot's spendable money is asked for at several cash and spending levels,
    /// then it is the cash above the reserve, never more than the budget left, never below nil.
    #[test]
    fn a_bot_spends_above_its_reserve_within_its_seasons_budget() {
        let rules = BotBidRules::default();

        assert_eq!(rules.spendable(5_000_000, 0), 3_500_000);
        assert_eq!(rules.spendable(5_000_000, 3_000_000), 500_000);
        assert_eq!(rules.spendable(1_600_000, 0), 1_200_000);
        assert_eq!(rules.spendable(300_000, 0), 0);
        assert_eq!(rules.spendable(5_000_000, 3_500_000), 0);
    }

    /// Given the bots' rules,
    /// when they are read for a person's listing, another bot's sale and the world's free agent,
    /// then a person's is joined by more bots that pay more and keep less cash back, another bot's
    /// is joined less and bought only up to its few buys of a season, and the world's is as the
    /// base says; and a bot with 1.65M, the cash a bot holds, can pay for a person's listing.
    #[test]
    fn a_persons_listing_is_bought_before_a_bots_sale() {
        let base = BotBidRules::default();
        let person = base.for_seller(SellerKind::Person);
        let bot = base.for_seller(SellerKind::Bot);

        assert_eq!(base.for_seller(SellerKind::World), base);
        assert!(person.participation_permille > base.participation_permille);
        assert!(person.max_bots_per_auction > base.max_bots_per_auction);
        assert!(person.ceiling_max_permille > base.ceiling_max_permille);
        assert!(person.spendable(1_650_000, 0) > base.spendable(1_650_000, 0));
        assert_eq!(person.spendable(1_650_000, 0), 1_500_000);
        assert!(bot.participation_permille < base.participation_permille);
        assert_eq!(bot.cash_reserve, base.cash_reserve);

        assert!(base.may_buy_from(SellerKind::Person, 9));
        assert!(base.may_buy_from(SellerKind::World, 9));
        assert!(base.may_buy_from(SellerKind::Bot, 0));
        assert!(!base.may_buy_from(SellerKind::Bot, base.bot_sale_max_buys_per_season));
    }

    /// Given a ruleset written before S-11g, which has none of its fields,
    /// when it is read,
    /// then the missing ones take their defaults, and the ones it has are kept.
    #[test]
    fn a_ruleset_without_the_person_fields_reads_with_their_defaults() {
        let read: BotBidRules = serde_json::from_str(r#"{"cashReserve": 1000000}"#).expect("read");

        assert_eq!(read.cash_reserve, 1_000_000);
        assert_eq!(
            read.person_cash_reserve,
            BotBidRules::default().person_cash_reserve
        );
        assert_eq!(read.season_spend, BotBidRules::default().season_spend);
    }

    /// Given a squad with two senior goalkeepers, a youth one and a retired defender,
    /// when a bot counts its lines,
    /// then the youth keeper covers goal and the retired player counts nowhere.
    #[test]
    fn a_bot_counts_its_youth_players_toward_a_lines_cover() {
        let mut youth = player("gk-3", Position::Goalkeeper, 45);
        youth.squad_role = SquadRole::Youth;
        let mut retired = player("cb", Position::CenterBack, 60);
        retired.retired = true;
        let squad = [
            player("gk-1", Position::Goalkeeper, 60),
            player("gk-2", Position::Goalkeeper, 55),
            youth,
            retired,
        ];

        assert_eq!(bot_line_counts(&squad), [3, 0, 0, 0]);
    }

    /// Given the proposed bot values and the market's soft close of 180 s and cap of 250%,
    /// when they are checked together, and with a reply as long as the soft close, and with a
    /// price range reaching the cap,
    /// then only the first fits.
    #[test]
    fn a_bot_must_answer_inside_the_soft_close_and_stay_under_the_cap() {
        let rules = BotBidRules::default();
        assert!(rules.fits_market(180, 2_500));

        let slow = BotBidRules {
            reply_delay_max_seconds: 180,
            ..rules
        };
        assert!(!slow.fits_market(180, 2_500));
        assert!(!rules.fits_market(180, 1_350));
    }

    /// Given a bot whose price is 300,000 on an auction starting at 200,000,
    /// when it bids with no one leading, behind a lead of 280,000, and behind 260,000,
    /// then it bids the start, then gives up past its price, then bids the lead plus the step.
    #[test]
    fn a_bot_bids_the_least_the_auction_takes_within_its_price() {
        assert_eq!(
            bot_next_bid(None, 200_000, &DEFAULT_BID_STEPS, 300_000),
            Some(200_000)
        );
        assert_eq!(
            bot_next_bid(Some(280_000), 200_000, &DEFAULT_BID_STEPS, 300_000),
            None
        );
        assert_eq!(
            bot_next_bid(Some(240_000), 200_000, &DEFAULT_BID_STEPS, 300_000),
            Some(250_000)
        );
    }

    /// Given the proposed timing,
    /// when a bot's first bid and its answers are rolled for many auctions,
    /// then the first bid falls between 10% and 70% of the auction, an answer between 20 and
    /// 120 seconds, and the answers to different bids are rolled apart.
    #[test]
    fn a_bot_bids_first_inside_its_window_and_answers_inside_its_delay() {
        let rules = BotBidRules::default();
        let mut differ = false;
        for n in 0..200 {
            let auction = format!("auction-{n}");
            let rolls = AuctionRolls::new(5, &auction);
            assert!((100..=700).contains(&bot_first_bid_permille(&rules, &rolls, "bot")));
            let first = bot_reply_delay_seconds(&rules, &rolls, "bot", 1);
            let second = bot_reply_delay_seconds(&rules, &rolls, "bot", 2);
            assert!((20..=120).contains(&first) && (20..=120).contains(&second));
            differ |= first != second;
        }
        assert!(differ);
    }

    /// A 4-4-2 squad of exactly its needs at 60 and `strikers` more forwards at 50, all 25.
    fn squad_with_spare_strikers(strikers: usize) -> Vec<Player> {
        let mut squad = full_squad(60);
        squad.extend((0..strikers).map(|n| player(&format!("extra-{n}"), Position::Striker, 50)));
        squad
    }

    fn members(squad: &[Player], age: impl Fn(&Player) -> i32) -> Vec<SquadMember<'_>> {
        squad
            .iter()
            .map(|player| SquadMember {
                player,
                age: age(player),
            })
            .collect()
    }

    fn surplus_id(
        squad: &[SquadMember<'_>],
        day: u32,
        upgraded_line: Option<usize>,
        open_sales: u32,
    ) -> Option<String> {
        bot_surplus(
            &BotSaleRules::default(),
            "4-4-2",
            squad,
            day,
            upgraded_line,
            open_sales,
        )
        .map(|player| player.id.clone())
    }

    const ATTACK: usize = 3;

    /// Given squads of 50, 60, 70 and 80, and an empty one,
    /// when the median overall is asked for,
    /// then it is the upper middle one, and nil for no one.
    #[test]
    fn the_median_overall_is_the_upper_middle_one() {
        let squad: Vec<Player> = [50, 60, 70, 80]
            .iter()
            .map(|level| player(&format!("p{level}"), Position::CenterBack, *level))
            .collect();

        assert_eq!(median_ovr(&squad), 70);
        assert_eq!(median_ovr(&[]), 0);
    }

    /// Given a 4-4-2 squad three forwards over its need (an overloaded attack),
    /// when the bot looks for a player to spare,
    /// then it lists the weakest of the attack.
    #[test]
    fn a_bot_spares_the_weakest_of_an_overloaded_line() {
        let squad = squad_with_spare_strikers(3);

        assert_eq!(
            surplus_id(&members(&squad, |_| 25), 0, None, 0).as_deref(),
            Some("extra-0")
        );
    }

    /// Given a squad two forwards over its need, nobody old or unused,
    /// when the bot looks for a player to spare with no signing made, and then just after
    /// signing an upgrade into its attack,
    /// then it spares no one, and then the weakest forward.
    #[test]
    fn a_bot_spares_the_weakest_of_a_line_it_just_upgraded() {
        let squad = squad_with_spare_strikers(2);
        let squad = members(&squad, |_| 25);

        assert_eq!(surplus_id(&squad, 0, None, 0), None);
        assert_eq!(
            surplus_id(&squad, 0, Some(ATTACK), 0).as_deref(),
            Some("extra-0")
        );
    }

    /// Given a squad two forwards over its need, the spare forwards 31 and then 30 years old,
    /// below the squad's median,
    /// when the bot looks for a player to spare,
    /// then the veteran is spared and the 30-year-old is not.
    #[test]
    fn a_bot_spares_a_veteran_below_the_median() {
        let squad = squad_with_spare_strikers(2);
        let age_of =
            |years: i32| move |p: &Player| if p.id.starts_with("extra") { years } else { 25 };

        assert_eq!(
            surplus_id(&members(&squad, age_of(VETERAN_AGE)), 0, None, 0).as_deref(),
            Some("extra-0")
        );
        assert_eq!(
            surplus_id(&members(&squad, age_of(VETERAN_AGE - 1)), 0, None, 0),
            None
        );
    }

    /// Given a squad two forwards over its need, one of them hardly playing,
    /// when the bot looks for a player to spare on day 7 and on day 8,
    /// then he is spared only from day 8, once playing time has had matches to settle.
    #[test]
    fn a_bot_spares_an_unused_player_once_the_season_has_run_a_week() {
        let mut squad = squad_with_spare_strikers(2);
        squad[20].playing_time = UNUSED_PLAYING_TIME - 1;
        let squad = members(&squad, |_| 25);

        assert_eq!(surplus_id(&squad, 7, None, 0), None);
        assert_eq!(surplus_id(&squad, 8, None, 0).as_deref(), Some("extra-1"));
    }

    /// Given an overloaded attack and the weakest player of the squad a 34-year-old goalkeeper,
    /// and then the weakest spare forward injured,
    /// when the bot looks for a player to spare,
    /// then it keeps the keeper (his line holds only its need) and passes the injured forward.
    #[test]
    fn a_bot_never_sells_into_a_shortage_nor_lists_an_injured_player() {
        let mut squad = squad_with_spare_strikers(3);
        squad[0].ovr = 30;
        let age = |p: &Player| {
            if p.position == Position::Goalkeeper {
                34
            } else {
                25
            }
        };
        assert_eq!(
            surplus_id(&members(&squad, age), 0, None, 0).as_deref(),
            Some("extra-0")
        );

        squad[19].injury = Some(Injury {
            name: "knock".to_string(),
            days_remaining: 3,
        });
        assert_eq!(
            surplus_id(&members(&squad, age), 0, None, 0).as_deref(),
            Some("extra-1")
        );
    }

    /// Given an overloaded attack in a squad of 22, with one sale already open, and then with two,
    /// when the bot looks for a player to spare, keeping 20,
    /// then it still lists one with one open, and none with two.
    #[test]
    fn a_bot_keeps_its_squad_beside_its_open_sales() {
        let squad = squad_with_spare_strikers(3);
        let squad = members(&squad, |_| 25);

        assert!(surplus_id(&squad, 0, None, 1).is_some());
        assert_eq!(surplus_id(&squad, 0, None, 2), None);
    }

    /// Given a player worth 1,000,000,
    /// when a bot lists him first, after one unsold auction, after two and after five,
    /// then it starts at his value, 10% less, 20% less, and never under 80%.
    #[test]
    fn a_bot_lowers_its_price_after_each_unsold_auction_down_to_its_floor() {
        let rules = BotSaleRules::default();

        assert_eq!(rules.listing_price(1_000_000, 0), 1_000_000);
        assert_eq!(rules.listing_price(1_000_000, 1), 900_000);
        assert_eq!(rules.listing_price(1_000_000, 2), 800_000);
        assert_eq!(rules.listing_price(1_000_000, 5), 800_000);
    }

    /// Given the proposed sale values, a market floor of 60% and a season's squad floor of 18,
    /// when they are checked together, then with a squad kept at the floor, then with a price
    /// floor under the market's,
    /// then only the first fits.
    #[test]
    fn a_bot_sells_above_the_market_floor_and_the_squad_floor() {
        let rules = BotSaleRules::default();
        assert!(rules.fits_season(600, 18));

        let at_floor = BotSaleRules {
            keep_squad: 18,
            ..rules
        };
        assert!(!at_floor.fits_season(600, 18));
        let cheap = BotSaleRules {
            floor_permille: 500,
            ..rules
        };
        assert!(!cheap.fits_season(600, 18));
    }

    /// Members of `squad`, all aged `age`.
    fn aged(squad: &[Player], age: i32) -> Vec<SquadMember<'_>> {
        squad
            .iter()
            .map(|player| SquadMember { player, age })
            .collect()
    }

    /// A 4-4-2 squad of 22 at 70 (one more defender and midfielder and an extra striker than
    /// it needs) with one 78-rated midfielder `star`.
    fn squad_with_star() -> Vec<Player> {
        let mut squad = full_squad(70);
        squad.push(player("cb-extra", Position::CenterBack, 70));
        squad.push(player("cm-extra", Position::CentralMidfielder, 70));
        squad.push(player("star", Position::CentralMidfielder, 78));
        squad
    }

    /// Given a bot at level target 77.5 with a 26-year-old midfielder of 78 and a line to spare,
    /// when it looks for a star on day 3, then on day 2, then having listed one this season,
    /// then it picks him on day 3 only.
    #[test]
    fn a_levelled_bot_sells_its_star_from_day_three_once_a_season() {
        let rules = StarSaleRules::default();
        let squad = squad_with_star();
        let members = aged(&squad, 26);
        let pick = bot_star_sale(&rules, "4-4-2", &members, 775, 3, 0);
        assert_eq!(pick.map(|p| p.id.as_str()), Some("star"));
        assert!(bot_star_sale(&rules, "4-4-2", &members, 775, 2, 0).is_none());
        assert!(bot_star_sale(&rules, "4-4-2", &members, 775, 3, 1).is_none());
    }

    /// Given the same squad with everyone aged 30, or a target over his overall plus two, or his
    /// line down to its need of six, or him injured,
    /// when the bot looks for a star,
    /// then it finds none (the 70s are under 77.5 − 2 too).
    #[test]
    fn a_star_is_in_his_prime_up_to_the_level_and_spare() {
        let rules = StarSaleRules::default();
        let squad = squad_with_star();
        assert!(bot_star_sale(&rules, "4-4-2", &aged(&squad, 30), 775, 5, 0).is_none());
        assert!(bot_star_sale(&rules, "4-4-2", &aged(&squad, 26), 810, 5, 0).is_none());

        let mut short = squad.clone();
        short.retain(|p| p.id != "cm-extra" && p.id != "CentralMidfielder-0");
        assert!(bot_star_sale(&rules, "4-4-2", &aged(&short, 26), 775, 5, 0).is_none());

        let mut hurt = squad.clone();
        if let Some(star) = hurt.iter_mut().find(|p| p.id == "star") {
            star.injury = Some(Injury {
                name: "knock".into(),
                days_remaining: 3,
            });
        }
        assert!(bot_star_sale(&rules, "4-4-2", &aged(&hurt, 26), 775, 5, 0).is_none());
    }

    /// Given the star values, then a first listing asks 1.2× the value, 1.1× after one unsold
    /// listing and never under the value; they fit a market floor of 60%, and a star floor under
    /// it or an upside-down age range does not.
    #[test]
    fn a_star_is_priced_above_his_value_down_to_it() {
        let rules = StarSaleRules::default();
        assert_eq!(rules.listing_price(1_000_000, 0), 1_200_000);
        assert_eq!(rules.listing_price(1_000_000, 1), 1_100_000);
        assert_eq!(rules.listing_price(1_000_000, 3), 1_000_000);
        assert_eq!(rules.listing_price(1_000_000, 9), 1_000_000);

        let sales = BotSaleRules {
            star: Some(rules),
            ..BotSaleRules::default()
        };
        assert!(sales.fits_season(600, 18));
        let cheap = BotSaleRules {
            star: Some(StarSaleRules {
                floor_permille: 500,
                ..rules
            }),
            ..sales
        };
        assert!(!cheap.fits_season(600, 18));
        assert!(
            !StarSaleRules {
                youngest: 30,
                ..rules
            }
            .fits_season(600)
        );
    }

    /// Given sale rules without a star, then their JSON carries no `star` key and reads back;
    /// given them with one, the star reads back in camelCase.
    #[test]
    fn the_star_sale_is_left_out_of_a_ruleset_without_it() {
        let plain = BotSaleRules::default();
        let json = serde_json::to_string(&plain).expect("json");
        assert!(!json.contains(r#""star""#), "{json}");
        assert_eq!(
            serde_json::from_str::<BotSaleRules>(&json).ok(),
            Some(plain)
        );

        let with_star = BotSaleRules {
            star: Some(StarSaleRules::default()),
            ..plain
        };
        let json = serde_json::to_string(&with_star).expect("json");
        assert!(json.contains(r#""star":{"maxPerSeason":1"#), "{json}");
        assert_eq!(
            serde_json::from_str::<BotSaleRules>(&json).ok(),
            Some(with_star)
        );
    }

    /// Given a 25% chance to list a star a day,
    /// when a bot rolls for a thousand days,
    /// then it lists on about a quarter, on days of its own apart from its ordinary sales'.
    #[test]
    fn a_bot_rolls_for_its_star_apart_from_its_sales() {
        let star = StarSaleRules::default();
        let sales = BotSaleRules::default();
        let star_days: Vec<u32> = (0..1000)
            .filter(|day| bot_star_lists_today(&star, 1, "bot", *day))
            .collect();
        let sale_days: Vec<u32> = (0..1000)
            .filter(|day| bot_lists_today(&sales, 1, "bot", *day))
            .collect();
        assert!(
            (200..=300).contains(&star_days.len()),
            "{}",
            star_days.len()
        );
        assert_ne!(star_days, sale_days);
    }

    /// Given a 25% chance to list a day,
    /// when a bot rolls for a thousand days, twice, and in another world,
    /// then it lists on about a quarter of them, the same days each time in one world.
    #[test]
    fn a_bot_lists_on_its_own_roll_of_the_day() {
        let rules = BotSaleRules::default();
        let days = |seed: u64| -> Vec<u32> {
            (0..1000)
                .filter(|day| bot_lists_today(&rules, seed, "bot", *day))
                .collect()
        };

        let listed = days(1);
        assert!((200..=300).contains(&listed.len()), "{} days", listed.len());
        assert_eq!(days(1), listed);
        assert_ne!(days(2), listed);
    }
}
