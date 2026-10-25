//! What a club looks for on the transfer market, and how far an online bot bids for it.
//!
//! The needs are the game's AI clubs' (`ofm_core::transfers::ai_market`), moved here unchanged so
//! a bot on the online market wants what an AI club of the game wants (phase 3, E3-11). The rest
//! is the online bot's bidding (analysis-bot-auction-bids.md B1–B6): whether it takes part in an
//! auction, the price it goes to, and when it bids. Every roll comes from the world's seed, the
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
}

impl Default for BotBidRules {
    /// The values of analysis-bot-auction-bids.md B1–B6 as E3-11 measured them
    /// (e3-11-bot-bids.txt): the budget and reserve were raised from 1.2M and 1.5M, under which
    /// most bots could not afford the player they wanted, and the chance to take part from 350‰,
    /// so a first-team player listed at his value finds a bot more often than not.
    fn default() -> Self {
        Self {
            participation_permille: 500,
            max_bots_per_auction: 3,
            sample_size: 40,
            ceiling_min_permille: 850,
            ceiling_max_permille: 1_250,
            short_line_bonus_permille: 100,
            cash_reserve: 1_000_000,
            season_spend: 2_000_000,
            max_buys_per_season: 2,
            squad_cap: 25,
            first_bid_from_permille: 100,
            first_bid_to_permille: 700,
            reply_delay_min_seconds: 20,
            reply_delay_max_seconds: 120,
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
            && self.ceiling_max_permille + self.short_line_bonus_permille < price_band_max_permille
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

    /// Given a reserve of 1,000,000 and a season's budget of 2,000,000,
    /// when a bot's spendable money is asked for at several cash and spending levels,
    /// then it is the cash above the reserve, never more than the budget left, never below nil.
    #[test]
    fn a_bot_spends_above_its_reserve_within_its_seasons_budget() {
        let rules = BotBidRules::default();

        assert_eq!(rules.spendable(3_000_000, 0), 2_000_000);
        assert_eq!(rules.spendable(3_000_000, 1_500_000), 500_000);
        assert_eq!(rules.spendable(1_600_000, 0), 600_000);
        assert_eq!(rules.spendable(900_000, 0), 0);
        assert_eq!(rules.spendable(3_000_000, 2_500_000), 0);
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
}
