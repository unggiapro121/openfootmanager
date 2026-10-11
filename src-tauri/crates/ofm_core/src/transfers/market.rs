//! The daily sweep: who wants whom, and which of them gets to ask.
//!
//! This is the top of the call graph. It scores every player once, sorts the attractive ones,
//! then walks the buying clubs and lets each open at most one approach — subject to the
//! budget in `lifecycle`, which is what keeps a listed player from being buried in offers.

use super::*;

use rand::RngExt;

use crate::squad_floor::group_index as position_group_index;

/// Current squad depth per club and broad position group, computed once so the
/// market sweep doesn't re-scan every roster. The same count the squad floor
/// keeps, owned so the sweep can go on to move players.
pub(crate) fn squad_position_depths(game: &Game) -> std::collections::HashMap<String, [usize; 4]> {
    crate::squad_floor::registered_by_club(game)
        .into_iter()
        .map(|(team_id, depths)| (team_id.to_string(), depths))
        .collect()
}
pub(crate) fn contract_days_remaining(
    current_date: NaiveDate,
    contract_end: Option<&str>,
) -> Option<i64> {
    let contract_end = contract_end?;
    let contract_end_date = NaiveDate::parse_from_str(contract_end, "%Y-%m-%d").ok()?;
    Some((contract_end_date - current_date).num_days())
}
pub(crate) fn infer_player_importance(
    player: &domain::player::Player,
    owner_team: &domain::team::Team,
) -> PlayerImportance {
    if owner_team.starting_xi_ids.iter().any(|id| id == &player.id) {
        return PlayerImportance::Key;
    }

    if player.market_value >= crate::economy::valuation::REGULAR_VALUE {
        return PlayerImportance::Regular;
    }

    PlayerImportance::Fringe
}
pub(crate) fn minimum_acceptable_fee(
    current_date: NaiveDate,
    player: &domain::player::Player,
    owner_team: &domain::team::Team,
    buyer_team: &domain::team::Team,
) -> u64 {
    let mut multiplier: f64 = if player.transfer_listed { 0.8 } else { 1.2 };

    match infer_player_importance(player, owner_team) {
        PlayerImportance::Key => multiplier += 0.2,
        PlayerImportance::Regular => multiplier += 0.1,
        PlayerImportance::Fringe => {}
    }

    if player.morale <= 40 {
        multiplier -= 0.05;
    }

    let openness_score = player_move_openness_score(current_date, player, owner_team, buyer_team);
    if openness_score >= 60 {
        multiplier -= 0.20;
    } else if openness_score >= 40 {
        multiplier -= 0.10;
    }

    let multiplier = multiplier.clamp(0.55, 1.6) * contract_fee_factor(current_date, player);
    ((player.market_value as f64) * multiplier).round() as u64
}

/// How much of a player's value his club can still ask for, given the time left
/// on his contract. A club whose player can walk away for nothing next summer
/// has little to sell, so a deal in its last months fetches a third of the price.
pub(crate) fn contract_fee_factor(current_date: NaiveDate, player: &domain::player::Player) -> f64 {
    match contract_days_remaining(current_date, player.contract_end()) {
        Some(..=60) => 0.35,
        Some(61..=180) => 0.5,
        Some(181..=365) => 0.7,
        Some(366..=730) => 0.9,
        _ => 1.0,
    }
}
pub(crate) fn player_move_openness_score(
    current_date: NaiveDate,
    player: &domain::player::Player,
    owner_team: &domain::team::Team,
    buyer_team: &domain::team::Team,
) -> i32 {
    let mut score = 0;

    if player.morale <= 45 {
        score += 20;
    } else if player.morale <= 60 {
        score += 10;
    }

    if player.stats.appearances <= 2 {
        score += 15;
    } else if player.stats.appearances <= 5 {
        score += 8;
    }

    if let Some(days_remaining) = contract_days_remaining(current_date, player.contract_end()) {
        if days_remaining <= 180 {
            score += 20;
        } else if days_remaining <= 365 {
            score += 10;
        }
    }

    let reputation_gap = buyer_team.reputation as i32 - owner_team.reputation as i32;
    if reputation_gap >= 200 {
        score += 25;
    } else if reputation_gap >= 75 {
        score += 15;
    }

    if player.transfer_listed {
        score += 10;
    }

    score
}
pub(crate) fn apply_blocked_move_consequences(
    player: &mut domain::player::Player,
    openness_score: i32,
) {
    if openness_score < 40 {
        return;
    }

    let morale_drop = if openness_score >= 60 { 10 } else { 6 };
    player.morale = (i16::from(player.morale) - morale_drop).clamp(0, 100) as u8;
    player.morale_core.manager_trust =
        (i16::from(player.morale_core.manager_trust) - 5).clamp(0, 100) as u8;
    player.morale_core.unresolved_issue = Some(domain::player::PlayerIssue {
        category: domain::player::PlayerIssueCategory::Contract,
        severity: if openness_score >= 60 { 75 } else { 60 },
    });
}
pub(crate) fn award_leaderboard_player_ids(game: &Game) -> HashSet<String> {
    let awards = crate::season_awards::compute_season_awards(game);

    awards
        .golden_boot
        .iter()
        .chain(awards.assist_king.iter())
        .chain(awards.player_of_year.iter())
        .chain(awards.clean_sheet_king.iter())
        .chain(awards.most_appearances.iter())
        .chain(awards.young_player.iter())
        .map(|entry| entry.player_id.clone())
        .collect()
}
pub fn evaluate_transfer_market(game: &mut Game) {
    expire_stale_transfer_offers(game);
    expire_stale_loan_offers(game);
    prune_closed_offers(game);

    if !transfer_window_is_open(game) {
        return;
    }

    let user_team_id = game.manager.team_id.clone();

    let current_date = game.clock.current_date.date_naive();
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let award_leaderboards = award_leaderboard_player_ids(game);
    let team_reputation: std::collections::HashMap<String, u32> = game
        .teams
        .iter()
        .map(|team| (team.id.clone(), team.reputation))
        .collect();
    let position_depths = squad_position_depths(game);
    // Where each target sits in `game.players`, so the buyer's wage check need not search.
    // The sweep moves players between clubs but never adds or removes one.
    let player_index: std::collections::HashMap<String, usize> = game
        .players
        .iter()
        .enumerate()
        .map(|(index, player)| (player.id.clone(), index))
        .collect();

    // Every AI club, inside the simulated scope or not: the whole world is a
    // market. The shortlist below holds only the manager's players — the AI
    // clubs' business with each other is their weekly review
    // (`run_ai_transfer_reviews`) — so this stays cheap.
    let buyer_ids = crate::ai_tactics::ai_clubs(game);
    let first_choices = first_choice_ids(game);
    let mut talks_rng = game.rng_for("transfer-market/talks", &today);
    // New incoming offers opened to user players today, tracked to throttle the
    // inbox: at most one new club per player and a hard squad-wide ceiling.
    let mut new_offers_per_player: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut new_loan_offers_per_player: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut new_user_offers_today = 0_usize;
    let mut new_user_loan_offers_today = 0_usize;
    // Clubs already in talks for each user player, kept live rather than snapshotted so offers
    // opened earlier in today's sweep count against the ceiling too. One club is one approach,
    // so this both caps the queue and stops a club holding two approaches on the same player.
    let mut approach_clubs: std::collections::HashMap<String, HashSet<String>> = game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == user_team_id.as_deref())
        .map(|player| (player.id.clone(), pending_approach_clubs(player)))
        .collect();
    // Clubs turned away recently. Unlike the queue above this is fixed for the day: a rejection
    // made today already carries its closure date, so it is in here from the next sweep onwards.
    let cooled_clubs: std::collections::HashMap<String, HashSet<String>> = game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == user_team_id.as_deref())
        .map(|player| {
            (
                player.id.clone(),
                clubs_in_rebid_cooldown(player, current_date),
            )
        })
        .collect();

    // A player's transfer appeal and asking fee don't depend on who's buying, so
    // score every player once and keep only the genuinely attractive targets.
    // Each club then scans this short, score-sorted list instead of the whole
    // world, turning an O(clubs × players) sweep into O(players + clubs × shortlist).
    let mut shortlist: Vec<MarketTarget> = Vec::new();
    for player in &game.players {
        let Some(owner_team_id) = player.team_id.as_deref() else {
            continue;
        };
        if player_has_pending_registration(player) {
            continue;
        }
        // Only the manager's players: AI clubs deal with each other on their
        // review day, where a buyer that cannot or will not buy a player never
        // spends its turn on him.
        let is_user_owned = Some(owner_team_id) == user_team_id.as_deref();
        if !is_user_owned {
            continue;
        }
        let mut score = incoming_interest_score(current_date, player);
        if award_leaderboards.contains(&player.id) {
            score += AWARD_LEADERBOARD_INTEREST_BONUS;
        }
        if score < 35 {
            continue;
        }
        shortlist.push(MarketTarget {
            player_id: player.id.clone(),
            owner_team_id: owner_team_id.to_string(),
            score,
            fee: suggested_incoming_fee(current_date, player),
            position_group_index: position_group_index(&player.position),
            owner_reputation: team_reputation.get(owner_team_id).copied().unwrap_or(0),
        });
    }
    // Highest appeal first; a stable sort preserves the original ordering among
    // equally appealing targets, so selection is unchanged.
    shortlist.sort_by_key(|candidate| std::cmp::Reverse(candidate.score));

    for buyer_id in buyer_ids {
        let Some(buyer_team) = game.teams.iter().find(|team| team.id == buyer_id).cloned() else {
            continue;
        };
        let buyer_depths = position_depths.get(&buyer_id).copied().unwrap_or([0; 4]);

        let loan_offer_player_id = if let Some(user_team_id) = user_team_id.as_deref() {
            if new_user_loan_offers_today < MAX_NEW_INCOMING_USER_OFFERS_PER_DAY {
                create_incoming_user_loan_offer_if_any(
                    game,
                    user_team_id,
                    &buyer_id,
                    &buyer_team.name,
                    &today,
                    current_date,
                    IncomingOfferBudget {
                        new_today: &new_loan_offers_per_player,
                        approach_clubs: &approach_clubs,
                        cooled_clubs: &cooled_clubs,
                    },
                )
            } else {
                None
            }
        } else {
            None
        };
        if let Some(player_id) = loan_offer_player_id.as_ref() {
            *new_loan_offers_per_player
                .entry(player_id.clone())
                .or_insert(0) += 1;
            approach_clubs
                .entry(player_id.clone())
                .or_default()
                .insert(buyer_id.clone());
            new_user_loan_offers_today += 1;
        }

        // The list is score-sorted, so the first target clearing this club's
        // filters is its highest-appeal eligible signing.
        // Worked out once for this buyer, and only if a target gets as far as needing it.
        let mut buyer_wage_facts: Option<BuyerWageFacts> = None;
        let buyer_needs = line_needs(&buyer_team.formation);
        let chosen = shortlist.iter().find(|target| {
            if target.owner_team_id == buyer_id {
                return false;
            }
            if loan_offer_player_id.as_deref() == Some(target.player_id.as_str()) {
                return false;
            }
            {
                let budget = IncomingOfferBudget {
                    new_today: &new_offers_per_player,
                    approach_clubs: &approach_clubs,
                    cooled_clubs: &cooled_clubs,
                };
                if !budget.accepts(
                    &target.player_id,
                    &buyer_id,
                    MAX_NEW_INCOMING_OFFERS_PER_USER_PLAYER_PER_DAY,
                ) || new_user_offers_today >= MAX_NEW_INCOMING_USER_OFFERS_PER_DAY
                {
                    return false;
                }
            }
            // No club buys into a line it is already overloaded in.
            if line_is_overloaded(
                buyer_depths[target.position_group_index],
                buyer_needs[target.position_group_index],
            ) {
                return false;
            }
            // A player hesitates to drop to a much smaller club, more the
            // bigger the drop, unless he is open to any offer.
            let open = player_index.get(&target.player_id).is_some_and(|&index| {
                open_to_offers(&game.players[index], &first_choices, current_date)
            });
            let chance = approach_chance(buyer_team.reputation, target.owner_reputation, open);
            if talks_rng.random_range(0.0..1.0) >= chance {
                return false;
            }
            buyer_team.transfer_budget >= target.fee as i64
                && buyer_team.finance >= target.fee as i64
                && player_index.get(&target.player_id).is_some_and(|&index| {
                    let facts = buyer_wage_facts.get_or_insert_with(|| {
                        BuyerWageFacts::new(calc_wages(game, &buyer_id), buyer_depths)
                    });
                    buyer_can_pay_standard_wage(
                        &game.players[index],
                        &buyer_team,
                        facts,
                        current_date,
                    )
                })
        });

        let Some(target) = chosen else {
            continue;
        };
        let candidate = MarketCandidate {
            player_id: target.player_id.clone(),
            owner_team_id: target.owner_team_id.clone(),
            fee: target.fee,
        };

        if Some(candidate.owner_team_id.as_str()) == user_team_id.as_deref() {
            create_incoming_user_offer(game, &candidate, &buyer_id, &buyer_team.name, &today);
            *new_offers_per_player
                .entry(candidate.player_id.clone())
                .or_insert(0) += 1;
            approach_clubs
                .entry(candidate.player_id.clone())
                .or_default()
                .insert(buyer_id.clone());
            new_user_offers_today += 1;
        }
    }
}
pub fn generate_incoming_transfer_offers(game: &mut Game) {
    evaluate_transfer_market(game);
}
