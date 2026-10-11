//! The AI clubs' own business in the window: what they put up for sale and
//! whom they go out and buy, each on its weekly review day.
//!
//! The daily sweep in `market` answers to sellers — players listed or running
//! out of contract — and AI clubs never listed anyone and renewed every
//! contract worth keeping, so the clubs of the world bought almost nothing.
//! Here a club sells what it does not need ([`list_unwanted`]) and buys for
//! what it lacks ([`buy_for_need`]): first a body for a line below its needs,
//! otherwise an upgrade on the weakest player of its first eleven. Every AI
//! club takes part, inside the simulated scope or not, and each keeps to a
//! number of deals per window drawn when the window opens.

use super::*;

use crate::player_rating::{formation_slots, positional_fit_for_assignment};
use crate::squad_floor::{can_spare_one, group_index};
use rand::RngExt;
use std::collections::HashMap;

/// Deals — signings, and separately sales — a club makes in a window.
const DEALS_PER_WINDOW: std::ops::RangeInclusive<usize> = 3..=7;
/// A line needs its formation slots and this many more as cover.
const COVER_PER_LINE: usize = 2;
/// A line is overloaded beyond its need by more than this; no club buys there.
const SURPLUS_MARGIN: usize = 2;
/// An upgrade has to be at least this much better in the slot.
const UPGRADE_MARGIN: f64 = 3.0;
/// The oldest player a club buys as an upgrade.
const MAX_UPGRADE_AGE: i32 = 32;
/// How much less often an unlisted player is chased than a listed one.
const UNLISTED_WEIGHT: f64 = 0.3;
/// The listed-for-age rule: this old, and below the squad's median.
const VETERAN_AGE: i32 = 31;
/// The listed-for-unhappiness rule.
const UNHAPPY_MORALE: u8 = 40;
/// The listed-for-lack-of-football rule (`playing_time`, 0–100).
const UNUSED_PLAYING_TIME: u8 = 20;
/// A contract this close to its end that the club would not renew is sold now.
const SELL_BEFORE_EXPIRY_DAYS: i64 = 365;
/// The best few candidates a club chooses among, by weight.
const SHORTLIST: usize = 8;
/// How far below a player's club a buyer may stand before the player starts
/// to hesitate, and over how many more points he hesitates down to the floor.
const STATURE_GAP_FREE: f64 = 100.0;
const STATURE_GAP_RANGE: f64 = 300.0;
const STATURE_MIN_CHANCE: f64 = 0.1;

/// Seniors each line needs under `formation`: its slots and two to cover them.
pub(crate) fn line_needs(formation: &str) -> [usize; 4] {
    let mut needs = [COVER_PER_LINE; 4];
    for slot in formation_slots(formation) {
        needs[group_index(&slot)] += 1;
    }
    needs
}

/// A line holding more than it needs and its surplus margin: no buying there.
pub(crate) fn line_is_overloaded(seniors: usize, need: usize) -> bool {
    seniors > need + SURPLUS_MARGIN
}

/// The chance a player talks to a club `owner_reputation - buyer_reputation`
/// below his own: certain within 100 points, falling to one in ten across the
/// next 300, never nil. A player who is `open_to_offers` — listed, not a first
/// choice, or in his thirties — talks to anyone.
pub(crate) fn approach_chance(
    buyer_reputation: u32,
    owner_reputation: u32,
    open_to_offers: bool,
) -> f64 {
    if open_to_offers {
        return 1.0;
    }
    let gap = f64::from(owner_reputation) - f64::from(buyer_reputation);
    (1.0 - (gap - STATURE_GAP_FREE) / STATURE_GAP_RANGE).clamp(STATURE_MIN_CHANCE, 1.0)
}

/// Each club's eleven best seniors by overall: its first choices, whom it does
/// not sell lightly and who do not lightly drop to a smaller club.
pub(crate) fn first_choice_ids(game: &Game) -> HashSet<String> {
    let mut by_club: HashMap<&str, Vec<&Player>> = HashMap::new();
    for player in &game.players {
        if let Some(team_id) = player.team_id.as_deref()
            && !player.retired
            && player.squad_role == domain::player::SquadRole::Senior
        {
            by_club.entry(team_id).or_default().push(player);
        }
    }
    by_club
        .into_values()
        .flat_map(|mut squad| {
            squad.sort_by(|a, b| b.ovr.cmp(&a.ovr).then_with(|| a.id.cmp(&b.id)));
            squad
                .into_iter()
                .take(11)
                .map(|p| p.id.clone())
                .collect::<Vec<_>>()
        })
        .collect()
}

/// A player who would hear any club out.
pub(crate) fn open_to_offers(
    player: &Player,
    first_choices: &HashSet<String>,
    today: NaiveDate,
) -> bool {
    player.transfer_listed
        || !first_choices.contains(&player.id)
        || crate::aging::player_age_on(today, &player.date_of_birth) >= 30
}

/// How many signings, or sales, `team_id` makes in the window opening on
/// `opens_on`: drawn once per club and window, stable across the days of it.
pub(crate) fn window_quota(team_id: &str, opens_on: &str, purpose: &str) -> usize {
    let span = (DEALS_PER_WINDOW.end() - DEALS_PER_WINDOW.start() + 1) as u64;
    let key = format!("{team_id}/{opens_on}/{purpose}");
    DEALS_PER_WINDOW.start()
        + (crate::stable_hash::stable_hash(key.as_bytes(), 0x7a5f) % span) as usize
}

/// Signings and sales so far this window, by club.
#[derive(Default, Clone, Copy)]
pub(crate) struct WindowDeals {
    pub(crate) bought: usize,
    pub(crate) sold: usize,
}

pub(crate) fn window_deals(game: &Game, opens_on: &str) -> HashMap<String, WindowDeals> {
    let mut seen = HashSet::new();
    let mut deals: HashMap<String, WindowDeals> = HashMap::new();
    // Deals are filed under a competition, or under the legacy league a world
    // without competitions still keeps; a deal is counted once either way.
    let logs = game
        .competitions
        .iter()
        .chain(game.league.iter())
        .flat_map(|competition| competition.transfer_log.iter());
    for transfer in logs.filter(|transfer| transfer.date.as_str() >= opens_on) {
        if !seen.insert((transfer.date.clone(), transfer.player_id.clone())) {
            continue;
        }
        deals.entry(transfer.to_team_id.clone()).or_default().bought += 1;
        deals.entry(transfer.from_team_id.clone()).or_default().sold += 1;
    }
    deals
}

/// Run the AI clubs' window business for the clubs reviewing today.
pub fn run_ai_transfer_reviews(game: &mut Game, weekday_num: u32) {
    if !transfer_window_is_open(game) {
        return;
    }
    // No opening date known: count every deal on record as this window's.
    let opens_on = game
        .season_context
        .transfer_window
        .opens_on
        .clone()
        .unwrap_or_default();
    let first_choices = first_choice_ids(game);
    for team_id in crate::ai_tactics::ai_clubs_reviewing_on(game, weekday_num) {
        list_unwanted(game, &team_id, &opens_on);
        buy_for_need(game, &team_id, &opens_on, &first_choices);
    }
}

/// Why a club would sell a player, if it would.
fn reason_to_sell(
    game: &Game,
    team: &Team,
    player: &Player,
    median_ovr: u8,
    today: NaiveDate,
) -> bool {
    let age = crate::aging::player_age_on(today, &player.date_of_birth);
    let expiring_unwanted = contract_days_remaining(today, player.contract_end())
        .is_some_and(|days| days <= SELL_BEFORE_EXPIRY_DAYS)
        && !crate::ai_contracts::keeps(game, team, player, today);
    (age >= VETERAN_AGE && player.ovr < median_ovr)
        || player.morale <= UNHAPPY_MORALE
        || player.playing_time < UNUSED_PLAYING_TIME
        || expiring_unwanted
}

/// Put up for sale what the club does not need: the weakest of an overloaded
/// line, then veterans below the squad's standard, the unhappy, the unused and
/// contracts it will not renew — as many as it still means to sell this window,
/// never so many that a line would fall under the squad floor.
fn list_unwanted(game: &mut Game, team_id: &str, opens_on: &str) {
    let Some(team) = game.teams.iter().find(|team| team.id == team_id).cloned() else {
        return;
    };
    let today = game.clock.current_date.date_naive();
    let sold = window_deals(game, opens_on)
        .get(team_id)
        .map_or(0, |deals| deals.sold);
    let already_listed = squad_of(game, team_id)
        .filter(|p| p.transfer_listed)
        .count();
    let mut room = window_quota(team_id, opens_on, "sell").saturating_sub(sold + already_listed);
    if room == 0 {
        return;
    }

    let mut seniors = crate::squad_floor::senior_counts(game, team_id);
    let needs = line_needs(&team.formation);
    let median = median_ovr(game, team_id);
    let mut squad: Vec<&Player> = squad_of(game, team_id)
        .filter(|p| !p.transfer_listed && !player_has_active_or_pending_loan(p))
        .collect();
    squad.sort_by(|a, b| a.ovr.cmp(&b.ovr).then_with(|| a.id.cmp(&b.id)));

    let mut chosen = Vec::new();
    for player in &squad {
        if room == 0 {
            break;
        }
        let line = group_index(&player.position);
        let overloaded = line_is_overloaded(seniors[line], needs[line]);
        if (overloaded || reason_to_sell(game, &team, player, median, today))
            && can_spare_one(seniors, &player.position)
        {
            chosen.push(player.id.clone());
            seniors[line] -= 1;
            room -= 1;
        }
    }
    for player in game.players.iter_mut().filter(|p| chosen.contains(&p.id)) {
        player.transfer_listed = true;
    }
}

fn squad_of<'a>(game: &'a Game, team_id: &'a str) -> impl Iterator<Item = &'a Player> + 'a {
    game.players.iter().filter(move |player| {
        player.team_id.as_deref() == Some(team_id)
            && !player.retired
            && player.squad_role == domain::player::SquadRole::Senior
    })
}

fn median_ovr(game: &Game, team_id: &str) -> u8 {
    let mut ratings: Vec<u8> = squad_of(game, team_id).map(|p| p.ovr).collect();
    if ratings.is_empty() {
        return 0;
    }
    ratings.sort_unstable();
    ratings[ratings.len() / 2]
}

/// What a club is shopping for: a slot to fill, and how good a player must be
/// there to be worth buying.
struct Need {
    slot: Position,
    /// The rating in the slot a signing has to reach.
    bar: f64,
    /// The club is short in the slot's line, so anyone adequate will do.
    short: bool,
}

/// How many of its weakest slots a club looks to upgrade in one review: the
/// weakest may have no one on the market it can buy, the next may.
const SLOTS_LOOKED_AT: usize = 3;

/// The club's needs this week, most pressing first: a body for a line under
/// its needs, otherwise upgrades on the [`SLOTS_LOOKED_AT`] weakest players of
/// its first eleven — none in a line already overloaded.
fn current_needs(game: &Game, team: &Team) -> Vec<Need> {
    let seniors = crate::squad_floor::senior_counts(game, &team.id);
    let needs = line_needs(&team.formation);
    let slots = formation_slots(&team.formation);
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

    let available: Vec<&Player> = squad_of(game, &team.id)
        .filter(|p| p.injury.is_none())
        .collect();
    let eleven = crate::turn::squad::first_choice_eleven(&available, &team.formation);
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

/// One player a club could buy, and what he costs and is worth to it.
#[derive(Clone)]
struct Prospect {
    player_id: String,
    owner_id: String,
    fee: u64,
    weight: f64,
}

/// Go and buy for the club's need, if it still means to sign anyone this
/// window: listed players first in weight, unlisted ones at
/// [`UNLISTED_WEIGHT`] and at the price their club asks. A target at the
/// player's club is an offer for the manager to answer; anywhere else the deal
/// is done when the selling club's price is met.
fn buy_for_need(game: &mut Game, team_id: &str, opens_on: &str, first_choices: &HashSet<String>) {
    let Some(team) = game.teams.iter().find(|team| team.id == team_id).cloned() else {
        return;
    };
    let deals = window_deals(game, opens_on);
    if deals.get(team_id).map_or(0, |d| d.bought) >= window_quota(team_id, opens_on, "buy") {
        return;
    }
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let mut rng = game.rng_for(&format!("ai-transfer/{team_id}"), &today);
    // The first need the market can answer this week; one deal a week at most.
    let Some((need, choice)) = current_needs(game, &team).into_iter().find_map(|need| {
        let prospects = prospects_for(game, &team, &need, &deals, opens_on, first_choices);
        pick_weighted(&prospects, &mut rng).map(|choice| (need, choice.clone()))
    }) else {
        return;
    };
    let choice = &choice;

    if game.manager.team_id.as_deref() == Some(choice.owner_id.as_str()) {
        offer_to_the_manager(game, &team, choice, &today);
        return;
    }
    let bought = execute_transfer(
        game,
        &choice.player_id,
        team_id,
        &choice.owner_id,
        choice.fee,
    )
    .is_ok();
    if bought && !need.short {
        // An upgrade into a full line: the club sells the weakest of it on.
        list_weakest_of_line(game, team_id, &need.slot);
    }
}

fn prospects_for(
    game: &Game,
    team: &Team,
    need: &Need,
    deals: &HashMap<String, WindowDeals>,
    opens_on: &str,
    first_choices: &HashSet<String>,
) -> Vec<Prospect> {
    let today = game.clock.current_date.date_naive();
    let user_team = game.manager.team_id.as_deref();
    let depths = super::squad_position_depths(game);
    let wage_facts = BuyerWageFacts::of(game, &team.id);
    let line = group_index(&need.slot);
    let mut rng = game.rng_for(&format!("ai-transfer-talks/{}", team.id), opens_on);
    let mut prospects = Vec::new();

    for player in &game.players {
        let Some(owner_id) = player.team_id.as_deref() else {
            continue;
        };
        if owner_id == team.id
            || player.retired
            || player.injury.is_some()
            || player.squad_role != domain::player::SquadRole::Senior
            || group_index(&player.position) != line
            || f64::from(player.ovr) + 6.0 < need.bar
            || player_has_pending_registration(player)
            || player_has_active_or_pending_loan(player)
        {
            continue;
        }
        let age = crate::aging::player_age_on(today, &player.date_of_birth);
        if !need.short && age > MAX_UPGRADE_AGE {
            continue;
        }
        let rating = positional_fit_for_assignment(player, &need.slot);
        if rating < need.bar {
            continue;
        }
        let Some(owner) = game.teams.iter().find(|t| t.id == owner_id) else {
            continue;
        };
        let is_users = user_team == Some(owner_id);
        if !is_users {
            let owner_sold = deals.get(owner_id).map_or(0, |d| d.sold);
            let spare = depths
                .get(owner_id)
                .is_none_or(|seniors| can_spare_one(*seniors, &player.position));
            if !spare || owner_sold >= window_quota(owner_id, opens_on, "sell") {
                continue;
            }
        }
        let fee = if player.transfer_listed {
            suggested_incoming_fee(today, player)
        } else {
            minimum_acceptable_fee(today, player, owner, team)
        };
        if fee as i64 > team.transfer_budget
            || fee as i64 > team.finance
            || !buyer_can_pay_standard_wage(player, team, &wage_facts, today)
        {
            continue;
        }
        let open = open_to_offers(player, first_choices, today);
        if rng.random_range(0.0..1.0) >= approach_chance(team.reputation, owner.reputation, open) {
            continue;
        }
        let worth = if need.short {
            rating
        } else {
            rating - need.bar + UPGRADE_MARGIN
        };
        let weight = worth.max(1.0)
            * if player.transfer_listed {
                1.0
            } else {
                UNLISTED_WEIGHT
            };
        prospects.push(Prospect {
            player_id: player.id.clone(),
            owner_id: owner_id.to_string(),
            fee,
            weight,
        });
    }
    prospects
}

/// One of the best [`SHORTLIST`] prospects, chosen with chance in proportion
/// to its weight.
fn pick_weighted<'a>(prospects: &'a [Prospect], rng: &mut impl rand::Rng) -> Option<&'a Prospect> {
    let mut best: Vec<&Prospect> = prospects.iter().collect();
    best.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.player_id.cmp(&b.player_id))
    });
    best.truncate(SHORTLIST);
    let total: f64 = best.iter().map(|p| p.weight).sum();
    if total <= 0.0 {
        return None;
    }
    let mut draw = rng.random_range(0.0..total);
    for prospect in &best {
        if draw < prospect.weight {
            return Some(prospect);
        }
        draw -= prospect.weight;
    }
    best.last().copied()
}

/// A bid for one of the manager's players, if the player can take another
/// approach and this club has not been turned away from him lately.
fn offer_to_the_manager(game: &mut Game, buyer: &Team, choice: &Prospect, today: &str) {
    let current_date = game.clock.current_date.date_naive();
    let Some(player) = game.players.iter().find(|p| p.id == choice.player_id) else {
        return;
    };
    let approaching = pending_approach_clubs(player);
    if !club_may_approach(&approaching, &buyer.id)
        || clubs_in_rebid_cooldown(player, current_date).contains(&buyer.id)
    {
        return;
    }
    let candidate = MarketCandidate {
        player_id: choice.player_id.clone(),
        owner_team_id: choice.owner_id.clone(),
        fee: choice.fee,
    };
    create_incoming_user_offer(game, &candidate, &buyer.id, &buyer.name, today);
}

/// After an upgrade into a full line, put the weakest of that line up for sale
/// — if the squad floor lets the club spare him.
fn list_weakest_of_line(game: &mut Game, team_id: &str, slot: &Position) {
    let seniors = crate::squad_floor::senior_counts(game, team_id);
    if !can_spare_one(seniors, slot) {
        return;
    }
    let line = group_index(slot);
    let weakest = squad_of(game, team_id)
        .filter(|p| group_index(&p.position) == line && !p.transfer_listed)
        .min_by(|a, b| a.ovr.cmp(&b.ovr).then_with(|| a.id.cmp(&b.id)))
        .map(|p| p.id.clone());
    if let Some(id) = weakest
        && let Some(player) = game.players.iter_mut().find(|p| p.id == id)
    {
        player.transfer_listed = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::test_support::uniform_attributes;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;

    fn club(id: &str, reputation: u32) -> Team {
        let mut team = Team::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "England".to_string(),
            "City".to_string(),
            "Ground".to_string(),
            20_000,
        );
        team.reputation = reputation;
        team.finance = 50_000_000;
        team.transfer_budget = 30_000_000;
        team.wage_budget = 50_000_000;
        team
    }

    fn player(id: &str, team_id: &str, position: Position, skill: u8, born: &str) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            born.to_string(),
            "GB".to_string(),
            position,
            uniform_attributes(skill),
        );
        player.team_id = Some(team_id.to_string());
        player.ovr = skill;
        player.morale = 70;
        // Either foot, so no slot of the fixture costs a wrong-foot penalty.
        player.footedness = domain::player::Footedness::Both;
        player.market_value = 2_000_000;
        player.stage_contract_end(Some("2030-06-30".to_string()));
        player
    }

    /// A 4-4-2 squad at exactly its needs — 3 keepers, 6 defenders, 6
    /// midfielders, 4 forwards — each at a position its slots ask for, all
    /// rated `skill`.
    fn full_squad(team_id: &str, skill: u8) -> Vec<Player> {
        let lines = [
            (Position::Goalkeeper, 3),
            (Position::LeftBack, 1),
            (Position::RightBack, 1),
            (Position::CenterBack, 4),
            (Position::LeftMidfielder, 1),
            (Position::RightMidfielder, 1),
            (Position::CentralMidfielder, 4),
            (Position::Striker, 4),
        ];
        lines
            .into_iter()
            .flat_map(|(position, count)| {
                (0..count).map(move |index| {
                    player(
                        &format!("{team_id}-{position:?}-{index}"),
                        team_id,
                        position.clone(),
                        skill,
                        "1998-01-01",
                    )
                })
            })
            .collect()
    }

    fn game(teams: Vec<Team>, players: Vec<Player>, user_team: &str) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire(user_team.to_string());
        let mut game = Game::new(clock, manager, teams, players, vec![], vec![]);
        game.season_context.transfer_window.status = TransferWindowStatus::Open;
        game.season_context.transfer_window.opens_on = Some("2026-06-15".to_string());
        game.league = Some(domain::league::League::new(
            "league".to_string(),
            "League".to_string(),
            2026,
            &game.teams.iter().map(|t| t.id.clone()).collect::<Vec<_>>(),
        ));
        game
    }

    fn a_week(game: &mut Game) {
        for weekday in 0..7 {
            run_ai_transfer_reviews(game, weekday);
        }
    }

    fn team_of<'a>(game: &'a Game, id: &str) -> Option<&'a str> {
        game.players
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| p.team_id.as_deref())
    }

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

    /// Given a buyer well below a player's club, then he hesitates in step with
    /// the gap and never refuses outright; given a player open to offers, then
    /// he talks to anyone.
    #[test]
    fn a_player_hesitates_to_drop_to_a_smaller_club() {
        assert_eq!(approach_chance(600, 700, false), 1.0);
        assert!((approach_chance(450, 700, false) - 0.5).abs() < 1e-9);
        assert_eq!(approach_chance(100, 900, false), 0.1);
        assert_eq!(approach_chance(100, 900, true), 1.0);
    }

    /// Given many clubs and one window, then each club's quota is between three
    /// and seven, the same every time it is asked, and not the same for all.
    #[test]
    fn window_quotas_are_three_to_seven_and_stable() {
        let quotas: Vec<usize> = (0..200)
            .map(|index| window_quota(&format!("club-{index}"), "2026-06-15", "buy"))
            .collect();
        assert!(quotas.iter().all(|q| (3..=7).contains(q)));
        assert_eq!(quotas[0], window_quota("club-0", "2026-06-15", "buy"));
        assert!(quotas.iter().any(|q| *q != quotas[0]));
    }

    /// Given a 33-year-old below his squad's median and an otherwise content
    /// squad at its needs, when the club reviews, then it lists the veteran and
    /// nobody else.
    #[test]
    fn a_club_lists_a_veteran_below_its_standard() {
        let mut players = full_squad("ai", 70);
        players.push(player(
            "veteran",
            "ai",
            Position::CentralMidfielder,
            60,
            "1993-01-01",
        ));
        let mut game = game(vec![club("user", 600), club("ai", 600)], players, "user");

        a_week(&mut game);

        let listed: Vec<&str> = game
            .players
            .iter()
            .filter(|p| p.transfer_listed)
            .map(|p| p.id.as_str())
            .collect();
        assert_eq!(listed, ["veteran"]);
    }

    /// Given a club already at the floor in forwards whose forwards are all
    /// unhappy, when it reviews, then it lists none of them: the floor holds.
    #[test]
    fn a_club_never_lists_below_the_squad_floor() {
        let mut players = full_squad("ai", 70);
        players.retain(|p| {
            p.position != Position::Striker || !(p.id.ends_with("-2") || p.id.ends_with("-3"))
        });
        for p in players
            .iter_mut()
            .filter(|p| p.position == Position::Striker)
        {
            p.morale = 20;
        }
        let mut game = game(vec![club("user", 600), club("ai", 600)], players, "user");

        list_unwanted(&mut game, "ai", "2026-06-15");

        assert!(game.players.iter().all(|p| !p.transfer_listed));
    }

    /// Given an AI club a forward short and the only forward it could want an
    /// unlisted one of the manager's, when it reviews, then it bids for him —
    /// an offer the manager answers — and he does not move.
    #[test]
    fn a_club_bids_for_the_managers_unlisted_player_it_needs() {
        let mut players = full_squad("ai", 70);
        players.retain(|p| p.id != "ai-Striker-3");
        players.push(player("star", "user", Position::Striker, 80, "1999-01-01"));
        let mut game = game(vec![club("user", 600), club("ai", 650)], players, "user");

        a_week(&mut game);

        let star = game.players.iter().find(|p| p.id == "star").unwrap();
        assert_eq!(star.team_id.as_deref(), Some("user"));
        assert!(
            star.transfer_offers
                .iter()
                .any(|offer| offer.from_team_id == "ai")
        );
    }

    /// Given an AI club with every line full and one weak starter, and a
    /// listed player at another club far better in that slot, when it reviews,
    /// then it signs him and lists the weakest of that line.
    #[test]
    fn a_club_upgrades_its_weakest_starter_and_lists_the_weakest_of_the_line() {
        let mut players = full_squad("buyer", 72);
        for p in players
            .iter_mut()
            .filter(|p| p.position == Position::Striker)
        {
            *p = player(&p.id, "buyer", Position::Striker, 60, "1998-01-01");
        }
        players.extend(full_squad("seller", 70));
        let mut upgrade = player("upgrade", "seller", Position::Striker, 82, "1999-01-01");
        upgrade.transfer_listed = true;
        players.push(upgrade);
        let mut game = game(
            vec![club("user", 600), club("buyer", 650), club("seller", 650)],
            players,
            "user",
        );

        a_week(&mut game);

        assert_eq!(team_of(&game, "upgrade"), Some("buyer"));
        let listed_buyer_strikers = game
            .players
            .iter()
            .filter(|p| p.team_id.as_deref() == Some("buyer") && p.transfer_listed)
            .count();
        assert_eq!(listed_buyer_strikers, 1);
    }
}
