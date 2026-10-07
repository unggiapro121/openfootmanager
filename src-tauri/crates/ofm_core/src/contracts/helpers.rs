//! Leaf helpers shared across the contract clusters: owned-player lookups,
//! wage/tenure maths, and contract-date arithmetic. Byte-faithful extraction
//! from the original contracts.rs.

use super::*;

pub(crate) fn owned_player<'a>(game: &'a Game, player_id: &str) -> Result<&'a Player, String> {
    let manager_team_id = game
        .manager
        .team_id
        .as_deref()
        .ok_or(ERR_NO_TEAM_ASSIGNED.to_string())?;
    let player = game
        .players
        .iter()
        .find(|candidate| candidate.id == player_id)
        .ok_or(ERR_PLAYER_NOT_FOUND.to_string())?;

    if player.contract_club_id() != Some(manager_team_id) {
        return Err(ERR_PLAYER_NOT_OWNED_BY_CLUB.to_string());
    }

    Ok(player)
}

pub(crate) fn owned_player_index(game: &Game, player_id: &str) -> Result<usize, String> {
    let manager_team_id = game
        .manager
        .team_id
        .as_deref()
        .ok_or(ERR_NO_TEAM_ASSIGNED.to_string())?;
    let player_index = game
        .players
        .iter()
        .position(|candidate| candidate.id == player_id)
        .ok_or(ERR_PLAYER_NOT_FOUND.to_string())?;

    if game.players[player_index].contract_club_id() != Some(manager_team_id) {
        return Err(ERR_PLAYER_NOT_OWNED_BY_CLUB.to_string());
    }

    Ok(player_index)
}

pub(crate) fn backend_text_with_param(key: &str, param_name: &str, param_value: &str) -> String {
    let mut message = String::with_capacity(key.len() + param_name.len() + param_value.len() + 2);
    message.push_str(key);
    message.push('?');
    message.push_str(param_name);
    message.push('=');
    message.push_str(param_value);
    message
}

/// What the player asks `team` to pay him a week.
///
/// The target is the club's rate for a player of his ability, raised or lowered
/// by his circumstances: his age, his mood, his standing and how little time is
/// left on his deal. A free agent asks the target. A player under contract moves
/// half the way from his current wage toward it, the way terms are won at the
/// table, in either direction: a player who has outgrown his deal asks for a
/// raise, one paid above what his club can now afford accepts a cut, but never
/// below the least he would take. A raise is won a contract at a time, at most
/// [`MAX_RAISE_PERCENT`] on one deal: an academy graduate on a youth wage does
/// not ask a star's wage the first time he signs again, which no club's budget
/// could absorb in one go.
pub(crate) fn expected_wage(player: &Player, team: &Team, current_date: NaiveDate) -> u32 {
    const MAX_RAISE_PERCENT: i64 = 30;
    let target = target_wage_at(player, team, current_date);
    let current = player.wage();
    let asked = if current == 0 {
        target
    } else {
        let current = i64::from(current);
        let moved = (current + (i64::from(target) - current) / 2)
            .min(current * (100 + MAX_RAISE_PERCENT) / 100)
            .max(i64::from(minimum_acceptable_wage(player.wage())));
        u32::try_from(moved).unwrap_or(u32::MAX)
    };
    round_up_to_nearest_thousand(asked.max(MINIMUM_DEFAULT_WAGE as u32))
}

/// The club's rate for the player's ability, with his circumstances weighed in.
fn target_wage_at(player: &Player, team: &Team, current_date: NaiveDate) -> u32 {
    let club_rate = crate::economy::scaled_wage(
        crate::economy::valuation::market_wage(player, Some(team.reputation)),
        team.pay_level,
    );
    let mut wage = club_rate as f32;
    let age = player_age_on(current_date, &player.date_of_birth);
    let remaining_days = remaining_contract_days(player, current_date);

    if age <= 27 {
        wage *= 1.05;
    } else if age >= 32 {
        wage *= 0.95;
    }

    if player.morale <= 50 {
        wage *= 1.10;
    }

    wage *= importance_wage_multiplier(player);

    if team.reputation < 40 {
        wage *= 1.05;
    }

    if remaining_days <= 180 {
        wage *= 1.10;
    } else if remaining_days <= 365 {
        wage *= 1.05;
    }

    wage.ceil() as u32
}

/// The wage the player is on now. A free agent is on nothing, so the club's own
/// rate is all he measures an offer against: a small club can sign him on a small
/// club's wage, which is how unattached players find work.
pub(crate) fn reference_player_wage(player: &Player) -> u32 {
    if player.wage() > 0 {
        return player.wage();
    }

    MINIMUM_DEFAULT_WAGE as u32
}

pub(crate) fn importance_wage_multiplier(player: &Player) -> f32 {
    use crate::economy::valuation::{LOW_VALUE, NOTABLE_VALUE, STAR_VALUE};
    if player.market_value >= STAR_VALUE {
        return 1.18;
    }

    if player.market_value >= NOTABLE_VALUE {
        return 1.10;
    }

    if player.market_value <= LOW_VALUE {
        return 0.95;
    }

    1.0
}

pub(crate) fn expected_contract_years(player: &Player, current_date: NaiveDate) -> u32 {
    let age = player_age_on(current_date, &player.date_of_birth);

    if age <= 28 {
        return 3;
    }

    if age <= 32 {
        return 2;
    }

    1
}

pub(crate) fn minimum_acceptable_wage(current_wage: u32) -> u32 {
    ((current_wage as f32) * 0.85).floor() as u32
}

pub(crate) fn is_insulting_wage_offer(
    reference_wage: u32,
    expected_wage: u32,
    offered_wage: u32,
) -> bool {
    let anchor_wage = reference_wage.max(expected_wage);
    let insulting_floor = ((anchor_wage as f32) * 0.65).floor() as u32;

    offered_wage < insulting_floor
}

pub(crate) fn player_age_on(current_date: NaiveDate, date_of_birth: &str) -> i32 {
    let Ok(dob) = NaiveDate::parse_from_str(date_of_birth, "%Y-%m-%d") else {
        return 30;
    };

    let mut age = current_date.year() - dob.year();
    if current_date.ordinal() < dob.ordinal() {
        age -= 1;
    }
    age
}

pub(crate) fn remaining_contract_days(player: &Player, current_date: NaiveDate) -> i64 {
    contract_days_remaining(player.contract_end(), current_date)
        .unwrap_or(0)
        .max(0)
}

pub(crate) fn round_up_to_nearest_thousand(value: u32) -> u32 {
    if value == 0 {
        return 0;
    }

    value.div_ceil(1000) * 1000
}

/// A contract date as stored: `"YYYY-MM-DD"`, or nothing if it is not one.
///
/// Dates are plain strings on the wire and in saves, so every reader parses them;
/// this is the one place that says how.
pub(crate) fn parse_contract_date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

pub(crate) fn contract_days_remaining(
    contract_end: Option<&str>,
    current_date: NaiveDate,
) -> Option<i64> {
    let contract_end_date = parse_contract_date(contract_end?)?;
    Some((contract_end_date - current_date).num_days())
}
