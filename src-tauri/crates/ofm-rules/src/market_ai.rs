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
    club_needs_with(formation, seniors, available, &NeedRules::default())
}

/// How far a club looks for an upgrade (E5-11, analysis-bot-transfer-demand Dtd-4): its weakest
/// slots looked at, how much better a signing must be there, and how old he may be. The default is
/// the game's AI club's, [`SLOTS_LOOKED_AT`], [`UPGRADE_MARGIN`] and [`MAX_UPGRADE_AGE`]; an online
/// bot reads its own from the season's ruleset ([`BotBidRules::need_rules`]).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NeedRules {
    pub slots_looked_at: usize,
    pub upgrade_margin: f64,
    pub max_upgrade_age: i32,
}

impl Default for NeedRules {
    fn default() -> Self {
        Self {
            slots_looked_at: SLOTS_LOOKED_AT,
            upgrade_margin: UPGRADE_MARGIN,
            max_upgrade_age: MAX_UPGRADE_AGE,
        }
    }
}

/// [`club_needs`] with the upgrade looked for by `rules`.
pub fn club_needs_with(
    formation: &str,
    seniors: [usize; 4],
    available: &[&Player],
    rules: &NeedRules,
) -> Vec<Need> {
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
        .take(rules.slots_looked_at)
        .map(|(slot, rating)| Need {
            slot: slot.clone(),
            bar: rating + rules.upgrade_margin,
            short: false,
        })
        .collect()
}

/// What `player`, `age` years old, is worth to a club for `need`, if he answers it at all: a fit,
/// senior player of the need's line who reaches its bar in the slot, and for an upgrade no older
/// than [`MAX_UPGRADE_AGE`]. For a short line the worth is his rating in the slot; for an upgrade,
/// how far he clears the bar plus [`UPGRADE_MARGIN`].
pub fn answers_need(need: &Need, player: &Player, age: i32) -> Option<f64> {
    answers_need_with(need, player, age, &NeedRules::default())
}

/// [`answers_need`] with the oldest upgrade and the margin of `rules`.
pub fn answers_need_with(need: &Need, player: &Player, age: i32, rules: &NeedRules) -> Option<f64> {
    if player.retired
        || player.injury.is_some()
        || player.squad_role != SquadRole::Senior
        || group_index(&player.position) != group_index(&need.slot)
        || f64::from(player.ovr) + OVERALL_SLACK < need.bar
        || (!need.short && age > rules.max_upgrade_age)
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
        rating - need.bar + rules.upgrade_margin
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
    bot_interest_with(needs, player, age, &NeedRules::default())
}

/// [`bot_interest`] with the needs answered by `rules`.
pub fn bot_interest_with(
    needs: &[Need],
    player: &Player,
    age: i32,
    rules: &NeedRules,
) -> Option<BotInterest> {
    needs.iter().find_map(|need| {
        answers_need_with(need, player, age, rules).map(|worth| BotInterest {
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
    // E5-11 (analysis-bot-transfer-demand Dtd-1, Dtd-2). Each is absent from every ruleset
    // published before it, and written back absent, so a published ruleset reads and writes as
    // it is and its bots buy as they did.
    /// The club's own graduates younger than this take no squad slot (R3); absent, every player
    /// does.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub academy_exempt_under_age: Option<u8>,
    /// The most free agents a bot buys in a season, within `max_buys_per_season`; absent, a free
    /// agent is a buy like any other.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_agent_max_buys_per_season: Option<u32>,
    /// The most a bot spends on free agents in a season, in euros, apart from `season_spend`,
    /// which is then left to the clubs' listings; absent, both draw on `season_spend`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub free_agent_season_spend: Option<u64>,
    /// The bot's own [`NeedRules`]; each absent one is the game AI's.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slots_looked_at: Option<u32>,
    /// In tenths of a rating point: 30 is the game's 3.0.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upgrade_margin_tenths: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_upgrade_age: Option<u8>,
    // S-38 (s-38-tech-spec §3.1), absent from every ruleset before it like E5-11's.
    /// A bot whose slots after a signing are at least `squad_cap` less this drops one player of
    /// the signing's line (S38-C2); absent, it drops no one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drop_after_buy_within: Option<u32>,
    /// The most players the bots of a region buy of one person's club in a season, those a bot
    /// leads now counted (S38-C4, Qtd-6); absent, no such limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person_seller_max_buys_per_season: Option<u32>,
}

/// What a bot bought at auction this season, by seller (E5-11): every buy, those of bots' sales,
/// those of free agents, and the money spent on clubs' listings and on free agents.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SeasonBuys {
    pub all: u32,
    pub from_bots: u32,
    pub free_agents: u32,
    pub spent_on_clubs: u64,
    pub spent_on_free_agents: u64,
}

/// One player as a club's squad slots read him (E5-11, R3): retired or not, his age on the club's
/// day, and whether he is one of the club's own graduates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlotMember {
    pub retired: bool,
    pub age: i32,
    pub own_graduate: bool,
}

/// A club's squad slots (analysis-bot-transfer-demand Dtd-1): its players not retired, less its own
/// graduates younger than `exempt_under_age`. `None` counts every player not retired, as every rule
/// did before E5-11.
pub fn squad_slots(
    members: impl IntoIterator<Item = SlotMember>,
    exempt_under_age: Option<u8>,
) -> usize {
    members
        .into_iter()
        .filter(|member| !member.retired)
        .filter(|member| {
            !(member.own_graduate
                && exempt_under_age.is_some_and(|under| member.age < i32::from(under)))
        })
        .count()
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
            academy_exempt_under_age: None,
            free_agent_max_buys_per_season: None,
            free_agent_season_spend: None,
            slots_looked_at: None,
            upgrade_margin_tenths: None,
            max_upgrade_age: None,
            drop_after_buy_within: None,
            person_seller_max_buys_per_season: None,
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
            && self.e5_11_fits()
            && self.s38_fits()
    }

    /// The S-38 fields, each absent or in its range (s-38-tech-spec §3.2).
    fn s38_fits(&self) -> bool {
        self.drop_after_buy_within
            .is_none_or(|within| within <= 5 && within < self.squad_cap)
            && self
                .person_seller_max_buys_per_season
                .is_none_or(|most| (1..=20).contains(&most))
    }

    /// Whether a bot with `slots` after a signing drops a player (S38-C2): `dropAfterBuyWithin`
    /// set and `slots` at least `squad_cap` less it.
    pub fn drops_after_buy(&self, slots: usize) -> bool {
        self.drop_after_buy_within
            .is_some_and(|within| slots >= self.squad_cap.saturating_sub(within) as usize)
    }

    /// Whether the bots of a region may buy another player of a club of `seller` that has sold
    /// `sold_or_led` to bots this season, those a bot leads now counted (S38-C4). Always for a
    /// bot's sale or a free agent, and when `personSellerMaxBuysPerSeason` is absent.
    pub fn may_buy_of_seller(&self, seller: SellerKind, sold_or_led: u32) -> bool {
        seller != SellerKind::Person
            || self
                .person_seller_max_buys_per_season
                .is_none_or(|most| sold_or_led < most)
    }

    /// The E5-11 fields, each absent or in its range (e5-11-s-37-tech-spec §3.5).
    fn e5_11_fits(&self) -> bool {
        self.academy_exempt_under_age
            .is_none_or(|age| (16..=21).contains(&age))
            && self
                .free_agent_max_buys_per_season
                .is_none_or(|buys| buys <= self.max_buys_per_season)
            && self
                .free_agent_season_spend
                .is_none_or(|spend| spend <= self.season_spend)
            && self
                .slots_looked_at
                .is_none_or(|slots| (1..=11).contains(&slots))
            && self
                .upgrade_margin_tenths
                .is_none_or(|tenths| tenths <= 100)
            && self
                .max_upgrade_age
                .is_none_or(|age| (28..=36).contains(&age))
    }

    /// How this bot looks for an upgrade: the ruleset's values, the game AI's where absent.
    pub fn need_rules(&self) -> NeedRules {
        let game = NeedRules::default();
        NeedRules {
            slots_looked_at: self
                .slots_looked_at
                .map_or(game.slots_looked_at, |slots| slots as usize),
            upgrade_margin: self
                .upgrade_margin_tenths
                .map_or(game.upgrade_margin, |tenths| f64::from(tenths) / 10.0),
            max_upgrade_age: self.max_upgrade_age.map_or(game.max_upgrade_age, i32::from),
        }
    }

    /// Whether a bot that bought `buys` this season may buy another of `seller` (B1, Dtd-2): under
    /// the season's buys, under its buys of bots' sales ([`Self::may_buy_from`]), and for a free
    /// agent under `free_agent_max_buys_per_season` when the ruleset sets it.
    pub fn may_buy(&self, seller: SellerKind, buys: &SeasonBuys) -> bool {
        buys.all < self.max_buys_per_season
            && self.may_buy_from(seller, buys.from_bots)
            && (seller != SellerKind::World
                || self
                    .free_agent_max_buys_per_season
                    .is_none_or(|most| buys.free_agents < most))
    }

    /// What a bot may spend on `seller`'s auction (B3, Qtd-3): its cash above the reserve, within
    /// what is left of the budget the auction draws on. With `free_agent_season_spend` set, a free
    /// agent draws on it and a club's listing on `season_spend`, each less its own spending; unset,
    /// every auction draws on `season_spend` less all of it ([`Self::spendable`]).
    pub fn spendable_for(&self, seller: SellerKind, cash: u64, buys: &SeasonBuys) -> u64 {
        let left = match (self.free_agent_season_spend, seller) {
            (None, _) => self
                .season_spend
                .saturating_sub(buys.spent_on_clubs + buys.spent_on_free_agents),
            (Some(free), SellerKind::World) => free.saturating_sub(buys.spent_on_free_agents),
            (Some(_), _) => self.season_spend.saturating_sub(buys.spent_on_clubs),
        };
        cash.saturating_sub(self.cash_reserve).min(left)
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
    /// A bot's season-end trim (S-38, S38-C3); none when absent, as in every ruleset before v16.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub season_end_trim: Option<SeasonEndTrim>,
    /// A player a bot put up for S-38 (a drop after a signing or a season-end trim) that goes
    /// unsold this many times in a season is let go, whatever his age (PO-S38-1); absent, he is
    /// put up again as any other (B10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trim_release_after_unsold: Option<u32>,
}

/// A bot's season-end trim (S-38, S38-C3): at most `most` players let go or put up per cleanup,
/// the put-ups on the first `list_days` days of the next season.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeasonEndTrim {
    pub most: u32,
    pub list_days: u32,
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
            season_end_trim: None,
            trim_release_after_unsold: None,
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
            && self.season_end_trim.is_none_or(|trim| {
                (1..=10).contains(&trim.most) && (1..=14).contains(&trim.list_days)
            })
            && self
                .trim_release_after_unsold
                .is_none_or(|times| (1..=5).contains(&times))
    }

    /// Whether a bot lets go, instead of putting up again, a player it put up for S-38 that has
    /// now gone unsold `unsold` times this season, the last one counted (PO-S38-1). Never when
    /// `trimReleaseAfterUnsold` is absent.
    pub fn releases_unsold(&self, unsold: u32) -> bool {
        self.trim_release_after_unsold
            .is_some_and(|times| unsold >= times)
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

/// One of a bot's players as its trims read him (S-38): his age on the club's day; whether he is
/// never let go nor put up (`kept`: one of its own graduates up to `homegrownHoldAge`, one bought
/// this season); whether he is up for sale now (`listed`: never picked, and off his line's count
/// and the squad's, PO-S38-3).
#[derive(Debug, Clone, Copy)]
pub struct TrimMember<'a> {
    pub player: &'a Player,
    pub age: i32,
    pub kept: bool,
    pub listed: bool,
}

/// What a bot does with the player it trims: lets him go to the free agents, or puts him up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrimAction {
    Release,
    List,
}

/// The player a bot trims and how.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrimPick {
    pub id: String,
    pub action: TrimAction,
}

/// Up to `most` of `squad` a bot may spare, weakest first, then the oldest, then by id
/// (s-38-tech-spec §3.3): neither retired, kept nor listed, passing `fits`, of `line` when given;
/// each leaving his line above `formation`'s needs and the squad at `keep_squad` or more, its
/// players up for sale counted off both.
fn spare<'a>(
    formation: &str,
    squad: &[TrimMember<'a>],
    line: Option<usize>,
    keep_squad: u32,
    most: usize,
    fits: impl Fn(&TrimMember<'a>) -> bool,
) -> Vec<TrimMember<'a>> {
    let playing: Vec<&TrimMember<'a>> = squad.iter().filter(|m| !m.player.retired).collect();
    let needs = line_needs(formation);
    let mut left = bot_line_counts(playing.iter().map(|m| m.player));
    let mut size = playing.len();
    for member in playing.iter().filter(|m| m.listed) {
        let at = group_index(&member.player.position);
        left[at] = left[at].saturating_sub(1);
        size = size.saturating_sub(1);
    }
    let mut candidates: Vec<&TrimMember<'a>> = playing
        .iter()
        .copied()
        .filter(|m| !m.kept && !m.listed && fits(m))
        .filter(|m| line.is_none_or(|line| group_index(&m.player.position) == line))
        .collect();
    candidates.sort_by(|a, b| {
        a.player
            .ovr
            .cmp(&b.player.ovr)
            .then(b.age.cmp(&a.age))
            .then(a.player.id.cmp(&b.player.id))
    });
    let mut picked = Vec::new();
    for member in candidates {
        if picked.len() >= most {
            break;
        }
        let at = group_index(&member.player.position);
        if left[at] > needs[at] && size > keep_squad as usize {
            left[at] -= 1;
            size -= 1;
            picked.push(*member);
        }
    }
    picked
}

/// Whether a player may be put up: the market takes no one injured.
fn listable(member: &TrimMember<'_>) -> bool {
    member.player.injury.is_none()
}

/// The one player a bot drops after a signing into `line` (S38-C2): the weakest of that line it
/// may spare, let go from `release_min_age`, put up below it. None when none qualifies.
pub fn drop_after_buy(
    formation: &str,
    squad: &[TrimMember<'_>],
    line: usize,
    keep_squad: u32,
    release_min_age: i32,
) -> Option<TrimPick> {
    spare(formation, squad, Some(line), keep_squad, 1, |m| {
        m.age >= release_min_age || listable(m)
    })
    .first()
    .map(|member| TrimPick {
        id: member.player.id.clone(),
        action: if member.age >= release_min_age {
            TrimAction::Release
        } else {
            TrimAction::List
        },
    })
}

/// The veterans a bot lets go at the season's end (S38-C3): while its `slots` are over `cap`, up
/// to `most`, from `release_min_age` on, the weakest across the lines it may spare. Each one let
/// go takes a slot off.
pub fn season_end_releases(
    formation: &str,
    squad: &[TrimMember<'_>],
    slots: usize,
    cap: usize,
    keep_squad: u32,
    release_min_age: i32,
    most: u32,
) -> Vec<String> {
    let over = slots.saturating_sub(cap).min(most as usize);
    if over == 0 {
        return Vec::new();
    }
    spare(formation, squad, None, keep_squad, over, |m| {
        m.age >= release_min_age
    })
    .into_iter()
    .map(|member| member.player.id.clone())
    .collect()
}

/// The player a bot puts up on a day of its cleanup (S38-C3): when `slots` less its players up
/// (`listed`) are still over `cap`, the weakest under `release_min_age` it may spare. None
/// otherwise.
pub fn trim_listing(
    formation: &str,
    squad: &[TrimMember<'_>],
    slots: usize,
    cap: usize,
    keep_squad: u32,
    release_min_age: i32,
) -> Option<String> {
    let listed = squad
        .iter()
        .filter(|m| m.listed && !m.player.retired)
        .count();
    if slots.saturating_sub(listed) <= cap {
        return None;
    }
    spare(formation, squad, None, keep_squad, 1, |m| {
        m.age < release_min_age && listable(m)
    })
    .first()
    .map(|member| member.player.id.clone())
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

    fn member(age: i32, own_graduate: bool) -> SlotMember {
        SlotMember {
            retired: false,
            age,
            own_graduate,
        }
    }

    /// Given 20 senior players, three of the club's own graduates aged 18, 19 and 19, one aged
    /// exactly 20, another club's graduate aged 18 and a retired player,
    /// when the squad's slots are counted with graduates under 20 exempt, and with no exemption,
    /// then the three young graduates take no slot and everyone else not retired does (22, then 25).
    #[test]
    fn a_clubs_own_graduates_under_the_exempt_age_take_no_slot() {
        let mut squad: Vec<SlotMember> = (0..20).map(|_| member(26, false)).collect();
        squad.extend([member(18, true), member(19, true), member(19, true)]);
        squad.push(member(20, true));
        squad.push(member(18, false));
        squad.push(SlotMember {
            retired: true,
            ..member(34, false)
        });

        assert_eq!(squad_slots(squad.iter().copied(), Some(20)), 22);
        assert_eq!(squad_slots(squad.iter().copied(), None), 25);
    }

    /// Given a full 4-4-2 squad, and a crowded one,
    /// when its needs are worked out by the default need rules and by the game's AI rule,
    /// then they are the same needs.
    #[test]
    fn the_default_need_rules_are_the_game_ais() {
        let squad = full_squad(60);
        let mut crowded = full_squad(60);
        crowded.extend((0..3).map(|n| player(&format!("extra-{n}"), Position::Striker, 60)));
        for squad in [squad, crowded] {
            let available: Vec<&Player> = squad.iter().collect();
            let seniors = bot_line_counts(&squad);
            assert_eq!(
                club_needs_with("4-4-2", seniors, &available, &NeedRules::default()),
                club_needs("4-4-2", seniors, &available)
            );
        }
    }

    /// Given a full 4-4-2 squad and need rules looking at five slots with a margin of 1.0,
    /// when its needs are worked out,
    /// then it looks to upgrade five slots, each bar its starter's rating plus 1.0.
    #[test]
    fn need_rules_set_how_many_slots_a_club_looks_at_and_its_margin() {
        let squad = full_squad(60);
        let available: Vec<&Player> = squad.iter().collect();
        let rules = NeedRules {
            slots_looked_at: 5,
            upgrade_margin: 1.0,
            max_upgrade_age: MAX_UPGRADE_AGE,
        };

        let wider = club_needs_with("4-4-2", bot_line_counts(&squad), &available, &rules);
        let narrow = club_needs("4-4-2", bot_line_counts(&squad), &available);

        assert_eq!(wider.len(), 5);
        assert!((wider[0].bar - (narrow[0].bar - UPGRADE_MARGIN + 1.0)).abs() < 1e-9);
    }

    /// Given an upgrade need a defender clears by 2.0, and need rules taking players up to 33
    /// with a margin of 1.0,
    /// when he is offered at 33 and at 34, and by the default rules at 33,
    /// then the rules take him at 33, worth 2.0 plus their margin, and refuse him at 34; the
    /// default refuses him at 33.
    #[test]
    fn need_rules_set_the_oldest_upgrade_and_its_worth() {
        let good = player("cb", Position::CenterBack, 70);
        let rating = positional_fit_for_assignment(&good, &Position::CenterBack);
        let need = Need {
            slot: Position::CenterBack,
            bar: rating - 2.0,
            short: false,
        };
        let rules = NeedRules {
            slots_looked_at: SLOTS_LOOKED_AT,
            upgrade_margin: 1.0,
            max_upgrade_age: 33,
        };

        let worth = answers_need_with(&need, &good, 33, &rules).expect("wanted at 33");
        assert!((worth - 3.0).abs() < 1e-9);
        assert_eq!(answers_need_with(&need, &good, 34, &rules), None);
        assert_eq!(answers_need(&need, &good, 33), None);
        assert!(bot_interest_with(&[need], &good, 33, &rules).is_some());
    }

    /// Given the bots' rules of a ruleset without the E5-11 fields, and of one with them,
    /// when their need rules are read,
    /// then the first are the game AI's and the second the ruleset's (5 slots, 3.0, 33).
    #[test]
    fn a_bots_need_rules_come_from_its_ruleset_or_the_games_ai() {
        assert_eq!(BotBidRules::default().need_rules(), NeedRules::default());
        let wider = BotBidRules {
            slots_looked_at: Some(5),
            upgrade_margin_tenths: Some(30),
            max_upgrade_age: Some(33),
            ..BotBidRules::default()
        };

        assert_eq!(
            wider.need_rules(),
            NeedRules {
                slots_looked_at: 5,
                upgrade_margin: 3.0,
                max_upgrade_age: 33,
            }
        );
    }

    fn bought(all: u32, from_bots: u32, free_agents: u32) -> SeasonBuys {
        SeasonBuys {
            all,
            from_bots,
            free_agents,
            ..SeasonBuys::default()
        }
    }

    /// Given the bots' rules without a free-agent quota (3 buys a season, one of a bot's sales),
    /// when a bot that bought 2, then 3, players asks to buy a free agent, a person's and a bot's,
    /// then it may buy any of them at 2 (a bot's only before its first bot buy) and none at 3, as
    /// before E5-11.
    #[test]
    fn without_a_free_agent_quota_a_bot_counts_every_buy_alike() {
        let rules = BotBidRules::default();

        assert!(rules.may_buy(SellerKind::World, &bought(2, 0, 2)));
        assert!(rules.may_buy(SellerKind::Person, &bought(2, 0, 2)));
        assert!(rules.may_buy(SellerKind::Bot, &bought(2, 0, 2)));
        assert!(!rules.may_buy(SellerKind::Bot, &bought(2, 1, 1)));
        assert!(!rules.may_buy(SellerKind::World, &bought(3, 0, 0)));
        assert!(!rules.may_buy(SellerKind::Person, &bought(3, 0, 3)));
    }

    /// Given 5 buys a season, at most 2 of them free agents,
    /// when a bot that bought 2 free agents asks for a third, and for a person's player, and a
    /// bot that bought 5 asks for a person's,
    /// then the third free agent is refused, the person's player is not, and the sixth buy is.
    #[test]
    fn a_free_agent_quota_keeps_buys_for_the_clubs_listings() {
        let rules = BotBidRules {
            max_buys_per_season: 5,
            free_agent_max_buys_per_season: Some(2),
            ..BotBidRules::default()
        };

        assert!(rules.may_buy(SellerKind::World, &bought(1, 0, 1)));
        assert!(!rules.may_buy(SellerKind::World, &bought(2, 0, 2)));
        assert!(rules.may_buy(SellerKind::Person, &bought(2, 0, 2)));
        assert!(!rules.may_buy(SellerKind::Person, &bought(5, 0, 2)));
    }

    fn spent(on_clubs: u64, on_free_agents: u64) -> SeasonBuys {
        SeasonBuys {
            spent_on_clubs: on_clubs,
            spent_on_free_agents: on_free_agents,
            ..SeasonBuys::default()
        }
    }

    /// Given a bot of 4.32M that spent 2.7M on free agents this season (the E5-11 example, cash
    /// 5.22M before), on a person's listing (reserve 0.15M),
    /// when it asks what it may spend without a free-agent budget, and with one,
    /// then without it the season's 3.5M is down to 0.8M; with it the person's listing has the
    /// whole 3.5M.
    #[test]
    fn a_free_agent_budget_leaves_the_seasons_for_the_clubs_listings() {
        let shared = BotBidRules::default().for_seller(SellerKind::Person);
        let split = BotBidRules {
            free_agent_season_spend: Some(1_000_000),
            ..BotBidRules::default()
        }
        .for_seller(SellerKind::Person);

        assert_eq!(
            shared.spendable_for(SellerKind::Person, 2_520_000, &spent(0, 2_700_000)),
            800_000
        );
        assert_eq!(
            split.spendable_for(SellerKind::Person, 4_320_000, &spent(0, 2_700_000)),
            3_500_000
        );
    }

    /// Given a free-agent budget of 1.0M,
    /// when a bot with 5M that spent 0.9M on free agents and 3M on clubs' listings asks what it may
    /// spend on a free agent, and a bot with 0.5M on one,
    /// then the first may spend the 0.1M left of the free-agent budget, whatever it spent on clubs;
    /// the second its cash above the reserve; and the shared rule (no budget) is unchanged.
    #[test]
    fn a_free_agent_draws_on_its_own_budget() {
        let rules = BotBidRules {
            free_agent_season_spend: Some(1_000_000),
            ..BotBidRules::default()
        };

        assert_eq!(
            rules.spendable_for(SellerKind::World, 5_000_000, &spent(3_000_000, 900_000)),
            100_000
        );
        assert_eq!(
            rules.spendable_for(SellerKind::World, 500_000, &spent(0, 0)),
            100_000
        );
        let shared = BotBidRules::default();
        assert_eq!(
            shared.spendable_for(SellerKind::World, 5_000_000, &spent(3_000_000, 400_000)),
            shared.spendable(5_000_000, 3_400_000)
        );
    }

    /// Given the proposed bot values, each E5-11 field at the edge of its range and one past it,
    /// when they are checked with the market,
    /// then the edges fit and every value past one does not.
    #[test]
    fn the_e5_11_fields_must_stay_in_their_ranges() {
        let base = BotBidRules {
            max_buys_per_season: 5,
            ..BotBidRules::default()
        };
        let fits = |rules: BotBidRules| rules.fits_market(180, 2_500);
        let with = |change: fn(&mut BotBidRules)| {
            let mut rules = base;
            change(&mut rules);
            rules
        };

        assert!(fits(with(|r| r.academy_exempt_under_age = Some(16))));
        assert!(fits(with(|r| r.academy_exempt_under_age = Some(21))));
        assert!(!fits(with(|r| r.academy_exempt_under_age = Some(15))));
        assert!(!fits(with(|r| r.academy_exempt_under_age = Some(22))));
        assert!(fits(with(|r| r.free_agent_max_buys_per_season = Some(5))));
        assert!(!fits(with(|r| r.free_agent_max_buys_per_season = Some(6))));
        assert!(fits(with(|r| r.free_agent_season_spend = Some(3_500_000))));
        assert!(!fits(with(|r| r.free_agent_season_spend = Some(3_500_001))));
        assert!(fits(with(|r| r.slots_looked_at = Some(1))));
        assert!(fits(with(|r| r.slots_looked_at = Some(11))));
        assert!(!fits(with(|r| r.slots_looked_at = Some(0))));
        assert!(!fits(with(|r| r.slots_looked_at = Some(12))));
        assert!(fits(with(|r| r.upgrade_margin_tenths = Some(100))));
        assert!(!fits(with(|r| r.upgrade_margin_tenths = Some(101))));
        assert!(fits(with(|r| r.max_upgrade_age = Some(28))));
        assert!(fits(with(|r| r.max_upgrade_age = Some(36))));
        assert!(!fits(with(|r| r.max_upgrade_age = Some(27))));
        assert!(!fits(with(|r| r.max_upgrade_age = Some(37))));
    }

    /// Given the bots' rules of a ruleset written before E5-11, and of one naming the new fields,
    /// when they are read and written back,
    /// then the old ones have none of the fields and write none of them back (so no published
    /// ruleset changes), the new ones keep theirs, and an unknown field is still refused.
    #[test]
    fn the_e5_11_fields_are_absent_from_a_ruleset_that_does_not_name_them() {
        let old: BotBidRules = serde_json::from_str(r#"{"squadCap": 25}"#).expect("old");
        assert_eq!(old, BotBidRules::default());
        let written = serde_json::to_value(old).expect("written");
        for field in [
            "academyExemptUnderAge",
            "freeAgentMaxBuysPerSeason",
            "freeAgentSeasonSpend",
            "slotsLookedAt",
            "upgradeMarginTenths",
            "maxUpgradeAge",
        ] {
            assert!(written.get(field).is_none(), "{field} written");
        }

        let new: BotBidRules = serde_json::from_str(
            r#"{"academyExemptUnderAge": 20, "freeAgentMaxBuysPerSeason": 2,
                "freeAgentSeasonSpend": 1000000}"#,
        )
        .expect("new");
        assert_eq!(new.academy_exempt_under_age, Some(20));
        assert_eq!(new.free_agent_max_buys_per_season, Some(2));
        assert_eq!(new.free_agent_season_spend, Some(1_000_000));
        assert!(serde_json::from_str::<BotBidRules>(r#"{"squadSlots": 30}"#).is_err());
    }

    // ---- S-38 (s-38-tech-spec §3, §10) ----

    /// A bot's squad for the trims: players by line (keepers, defenders, midfielders, forwards),
    /// each 25 years old at 60, ids `g1…`, `d1…`, `m1…`, `f1…`.
    struct TrimSquad {
        players: Vec<Player>,
        ages: Vec<i32>,
        kept: Vec<bool>,
        listed: Vec<bool>,
    }

    impl TrimSquad {
        fn new(keepers: usize, defenders: usize, midfielders: usize, forwards: usize) -> Self {
            let mut players = Vec::new();
            for (prefix, position, count) in [
                ("g", Position::Goalkeeper, keepers),
                ("d", Position::Defender, defenders),
                ("m", Position::Midfielder, midfielders),
                ("f", Position::Forward, forwards),
            ] {
                for n in 1..=count {
                    players.push(player(&format!("{prefix}{n}"), position.clone(), 60));
                }
            }
            let size = players.len();
            Self {
                players,
                ages: vec![25; size],
                kept: vec![false; size],
                listed: vec![false; size],
            }
        }

        fn at(&self, id: &str) -> usize {
            self.players
                .iter()
                .position(|p| p.id == id)
                .expect("a player of the squad")
        }

        fn set(&mut self, id: &str, ovr: u8, age: i32) -> &mut Self {
            let at = self.at(id);
            self.players[at].ovr = ovr;
            self.ages[at] = age;
            self
        }

        fn members(&self) -> Vec<TrimMember<'_>> {
            self.players
                .iter()
                .enumerate()
                .map(|(i, player)| TrimMember {
                    player,
                    age: self.ages[i],
                    kept: self.kept[i],
                    listed: self.listed[i],
                })
                .collect()
        }
    }

    fn mid_line() -> usize {
        group_index(&Position::Midfielder)
    }

    fn drop_of(squad: &TrimSquad) -> Option<TrimPick> {
        drop_after_buy("4-3-3", &squad.members(), mid_line(), 20, 30)
    }

    fn released(id: &str) -> Option<TrimPick> {
        Some(TrimPick {
            id: id.to_string(),
            action: TrimAction::Release,
        })
    }

    fn listed_pick(id: &str) -> Option<TrimPick> {
        Some(TrimPick {
            id: id.to_string(),
            action: TrimAction::List,
        })
    }

    /// Given a squad cap of 30 and a drop within 1 of it, and the same rules without the field,
    /// when a bot holds 28, 29 or 30 slots after a signing,
    /// then it drops someone from 29 slots on, and never without the field.
    #[test]
    fn a_bot_drops_a_player_from_one_under_its_cap() {
        let rules = BotBidRules {
            squad_cap: 30,
            drop_after_buy_within: Some(1),
            ..BotBidRules::default()
        };
        assert!(!rules.drops_after_buy(28));
        assert!(rules.drops_after_buy(29));
        assert!(rules.drops_after_buy(30));
        let absent = BotBidRules {
            squad_cap: 30,
            ..BotBidRules::default()
        };
        assert!(!absent.drops_after_buy(30));
    }

    /// Given S-38's four fields at the ends of their ranges and one past them,
    /// when the bids' rules are checked against the market and the sales' against the season,
    /// then only the values in range fit.
    #[test]
    fn s38_fields_fit_only_in_their_ranges() {
        let bids = |within: Option<u32>, seller: Option<u32>, cap: u32| {
            BotBidRules {
                squad_cap: cap,
                drop_after_buy_within: within,
                person_seller_max_buys_per_season: seller,
                ..BotBidRules::default()
            }
            .fits_market(600, 2_000)
        };
        assert!(bids(None, None, 30));
        assert!(bids(Some(5), None, 30));
        assert!(!bids(Some(6), None, 30));
        assert!(!bids(Some(4), None, 4), "never the whole cap");
        assert!(!bids(None, Some(0), 30));
        assert!(bids(None, Some(1), 30));
        assert!(bids(None, Some(20), 30));
        assert!(!bids(None, Some(21), 30));

        let sales = |trim: Option<SeasonEndTrim>, unsold: Option<u32>| {
            BotSaleRules {
                season_end_trim: trim,
                trim_release_after_unsold: unsold,
                ..BotSaleRules::default()
            }
            .fits_season(600, 18)
        };
        let trim = |most, list_days| Some(SeasonEndTrim { most, list_days });
        assert!(sales(None, None));
        assert!(sales(trim(1, 1), Some(1)));
        assert!(sales(trim(10, 14), Some(5)));
        assert!(!sales(trim(0, 7), None));
        assert!(!sales(trim(11, 7), None));
        assert!(!sales(trim(3, 0), None));
        assert!(!sales(trim(3, 15), None));
        assert!(!sales(None, Some(0)));
        assert!(!sales(None, Some(6)));
    }

    /// Given the sales' rules of a ruleset before S-38, one with a trim missing its days, and one
    /// with a key no one knows,
    /// when they are read and written,
    /// then the first reads with both fields absent and writes back without them; the others fail.
    #[test]
    fn s38_sale_fields_read_absent_and_refuse_a_half_trim() {
        let before = serde_json::to_value(BotSaleRules::default()).expect("written");
        assert!(before.get("seasonEndTrim").is_none());
        assert!(before.get("trimReleaseAfterUnsold").is_none());
        let read: BotSaleRules = serde_json::from_value(before.clone()).expect("read");
        assert_eq!(read.season_end_trim, None);
        assert_eq!(read.trim_release_after_unsold, None);
        assert_eq!(serde_json::to_value(read).expect("written"), before);

        let mut half = before.clone();
        half["seasonEndTrim"] = serde_json::json!({"most": 3});
        assert!(serde_json::from_value::<BotSaleRules>(half).is_err());
        let mut whole = before.clone();
        whole["seasonEndTrim"] = serde_json::json!({"most": 3, "listDays": 7});
        whole["trimReleaseAfterUnsold"] = serde_json::json!(3);
        let read: BotSaleRules = serde_json::from_value(whole).expect("read");
        assert_eq!(
            read.season_end_trim,
            Some(SeasonEndTrim {
                most: 3,
                list_days: 7
            })
        );
        let mut unknown = before;
        unknown["seasonEndTrims"] = serde_json::json!(1);
        assert!(serde_json::from_value::<BotSaleRules>(unknown).is_err());

        let bids = serde_json::to_value(BotBidRules::default()).expect("written");
        assert!(bids.get("dropAfterBuyWithin").is_none());
        assert!(bids.get("personSellerMaxBuysPerSeason").is_none());
    }

    /// Given a 4-3-3 bot of 20 with six midfielders (it needs five), the weakest of them 31, then
    /// 24,
    /// when it drops a player after signing a midfielder,
    /// then it lets the veteran go, and puts the younger one up.
    #[test]
    fn a_bot_lets_a_veteran_go_and_puts_a_younger_one_up() {
        let mut squad = TrimSquad::new(3, 6, 6, 5);
        squad.set("m6", 50, 31);
        let mut bigger = TrimSquad::new(3, 6, 6, 6);
        bigger.set("m6", 50, 31);
        assert_eq!(drop_of(&bigger), released("m6"));
        bigger.set("m6", 50, 24);
        assert_eq!(drop_of(&bigger), listed_pick("m6"));
        assert_eq!(drop_of(&squad), None, "a squad of 20 keeps every one");
    }

    /// Given a 4-3-3 bot of 21 with six midfielders,
    /// when the weakest is kept, injured, tied with another, or the line has only five,
    /// then the next one goes, an injured veteran still goes, the older of a tie goes first, and a
    /// line at its needs gives no one, however full another line is.
    #[test]
    fn a_bot_drops_the_weakest_it_may_spare_of_the_signing_s_line() {
        let base = || {
            let mut squad = TrimSquad::new(3, 6, 6, 6);
            squad.set("m1", 50, 24).set("m2", 55, 24);
            squad
        };
        let mut kept = base();
        let m1 = kept.at("m1");
        kept.kept[m1] = true;
        assert_eq!(drop_of(&kept), listed_pick("m2"), "an own graduate is kept");

        let mut injured = base();
        injured.players[m1].injury = Some(Injury {
            name: "knock".to_string(),
            days_remaining: 3,
        });
        assert_eq!(
            drop_of(&injured),
            listed_pick("m2"),
            "no one injured is put up"
        );
        injured.set("m1", 50, 32);
        assert_eq!(
            drop_of(&injured),
            released("m1"),
            "an injured veteran still goes"
        );

        let mut tie = base();
        tie.set("m2", 50, 27);
        assert_eq!(drop_of(&tie), listed_pick("m2"), "the older of a tie");
        tie.set("m2", 50, 24);
        assert_eq!(drop_of(&tie), listed_pick("m1"), "then the id");

        let mut short = TrimSquad::new(3, 6, 5, 10);
        short.set("m1", 40, 33);
        assert_eq!(drop_of(&short), None, "a line at its needs");
    }

    /// Given a 4-3-3 bot with one midfielder up for sale (PO-S38-3), and one of 21 with someone
    /// of another line up and a squad kept at 20,
    /// when it drops a player after signing a midfielder,
    /// then with six midfielders it drops no one; with seven, the weakest not up for sale; and the
    /// squad of 21 less the one up drops no one.
    #[test]
    fn a_player_up_for_sale_counts_off_his_line_and_the_squad() {
        let mut six = TrimSquad::new(3, 6, 6, 6);
        six.set("m1", 40, 24);
        let m1 = six.at("m1");
        six.listed[m1] = true;
        assert_eq!(drop_of(&six), None);

        let mut seven = TrimSquad::new(3, 6, 7, 6);
        seven.set("m1", 40, 24).set("m2", 45, 24);
        let m1 = seven.at("m1");
        seven.listed[m1] = true;
        assert_eq!(drop_of(&seven), listed_pick("m2"));

        let mut small = TrimSquad::new(3, 6, 6, 6);
        let f1 = small.at("f1");
        small.listed[f1] = true;
        assert_eq!(small.players.len(), 21);
        assert_eq!(drop_of(&small), None, "21 less one up is the squad kept");
    }

    /// A 4-3-3 squad of 25 with five veterans: two defenders, two midfielders, a forward, and a
    /// keeper of 40 in a line at its needs.
    fn veterans() -> TrimSquad {
        let mut squad = TrimSquad::new(3, 8, 7, 7);
        squad
            .set("d1", 50, 31)
            .set("d2", 51, 32)
            .set("m1", 52, 30)
            .set("m2", 53, 33)
            .set("f1", 54, 34)
            .set("g1", 40, 35);
        squad
    }

    fn releases(squad: &TrimSquad, slots: usize, most: u32) -> Vec<String> {
        season_end_releases("4-3-3", &squad.members(), slots, 28, 20, 30, most)
    }

    /// Given a bot of 25 with veterans in its lines to spare, and a keeper of 40 in a line at its
    /// needs,
    /// when the season's end trims it to 28 slots at most 3 a time,
    /// then 31 slots let the three weakest veterans go across the lines, 29 slots one, 28 none, a
    /// trim of 0 none, and the keeper never.
    #[test]
    fn the_season_s_end_lets_the_weakest_veterans_go_down_to_the_cap() {
        let squad = veterans();
        assert_eq!(releases(&squad, 31, 3), vec!["d1", "d2", "m1"]);
        assert_eq!(releases(&squad, 29, 3), vec!["d1"]);
        assert!(releases(&squad, 28, 3).is_empty());
        assert!(releases(&squad, 31, 0).is_empty());
        assert!(!releases(&squad, 40, 10).contains(&"g1".to_string()));
    }

    /// Given a bot of 25 with only two veterans, and one whose midfield has one up for sale,
    /// when the season's end needs three let go,
    /// then it lets the two go, and no veteran of a line left at its needs by the one up.
    #[test]
    fn the_season_s_end_lets_go_only_the_veterans_it_has_and_may_spare() {
        let mut two = TrimSquad::new(3, 8, 7, 7);
        two.set("d1", 50, 31).set("m1", 52, 30);
        assert_eq!(releases(&two, 31, 3), vec!["d1", "m1"]);

        let mut held = TrimSquad::new(3, 6, 6, 7);
        held.set("m1", 52, 30).set("m2", 60, 24);
        let m2 = held.at("m2");
        held.listed[m2] = true;
        assert!(releases(&held, 31, 3).is_empty());
    }

    /// Given a bot with spare lines and one up for sale,
    /// when a day of its cleanup looks for someone to put up,
    /// then 30 slots less the one up (29, over 28) put up the weakest under 30; 29 slots less one
    /// put up no one; and a line whose only spare player is the one up gives no one.
    #[test]
    fn a_cleanup_day_puts_up_the_weakest_younger_one_while_over_the_cap() {
        let mut squad = TrimSquad::new(3, 8, 7, 7);
        squad.set("d1", 50, 31).set("m1", 52, 24).set("f1", 58, 26);
        let f1 = squad.at("f1");
        squad.listed[f1] = true;
        let pick =
            |squad: &TrimSquad, slots| trim_listing("4-3-3", &squad.members(), slots, 28, 20, 30);
        assert_eq!(pick(&squad, 30), Some("m1".to_string()));
        assert_eq!(pick(&squad, 29), None);

        let mut tight = TrimSquad::new(3, 6, 6, 5);
        tight.set("m1", 40, 24);
        let m1 = tight.at("m1");
        tight.listed[m1] = true;
        assert_eq!(pick(&tight, 31), None);
    }

    /// Given no limit, then a limit of three,
    /// when a player put up for S-38 goes unsold one to four times,
    /// then without the limit he is never let go; with it, from the third time.
    #[test]
    fn a_trim_left_unsold_three_times_is_let_go() {
        let absent = BotSaleRules::default();
        assert!((1..=5).all(|unsold| !absent.releases_unsold(unsold)));
        let three = BotSaleRules {
            trim_release_after_unsold: Some(3),
            ..BotSaleRules::default()
        };
        assert!(!three.releases_unsold(1));
        assert!(!three.releases_unsold(2));
        assert!(three.releases_unsold(3));
        assert!(three.releases_unsold(4));
    }

    /// Given no limit, then four a person's club a season,
    /// when the bots look at a sale of a person's club that sold or is selling 3 or 4 to them, and
    /// at a bot's sale and a free agent,
    /// then without the limit they may; with it, at 3 but not at 4, and always for the others.
    #[test]
    fn the_bots_buy_at_most_four_of_one_person_s_club() {
        let absent = BotBidRules::default();
        assert!(absent.may_buy_of_seller(SellerKind::Person, 100));
        let four = BotBidRules {
            person_seller_max_buys_per_season: Some(4),
            ..BotBidRules::default()
        };
        assert!(four.may_buy_of_seller(SellerKind::Person, 3));
        assert!(!four.may_buy_of_seller(SellerKind::Person, 4));
        assert!(four.may_buy_of_seller(SellerKind::Bot, 10));
        assert!(four.may_buy_of_seller(SellerKind::World, 10));
    }
}
