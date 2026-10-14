use crate::facilities::{EffectFormat, MAX_FACILITY_LEVEL, effects, level_of};
use crate::finances::{CashKind, post};
use crate::game::Game;
use domain::team::{FacilityType, Team};

pub const BASE_FACILITY_UPGRADE_COST: i64 = 2_500_000;

fn facility_upgrade_insufficient_funds_error(amount: i64) -> String {
    let amount = amount.to_string();
    let key = "be.error.finance.facilityUpgradeInsufficientFunds";
    let param_name = "amount";
    let mut message = String::with_capacity(key.len() + param_name.len() + amount.len() + 2);
    message.push_str(key);
    message.push('?');
    message.push_str(param_name);
    message.push('=');
    message.push_str(&amount);
    message
}

/// What the next level of `facility_type` costs, or `None` once it is at the top.
pub fn next_upgrade_cost(team: &Team, facility_type: &FacilityType) -> Option<i64> {
    let level = level_of(&team.facilities, facility_type);
    (level < MAX_FACILITY_LEVEL).then(|| i64::from(level) * BASE_FACILITY_UPGRADE_COST)
}

/// One line of an upgrade's before → after: what the facility does now, and
/// after the upgrade (`None` at the top level).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectChange {
    pub key: &'static str,
    pub format: EffectFormat,
    pub current: Vec<f64>,
    pub next: Option<Vec<f64>>,
}

/// What upgrading one of a club's facilities would cost and change.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacilityUpgradePreview {
    pub facility: FacilityType,
    pub level: u8,
    pub max_level: u8,
    /// `None` once the facility is at the top level.
    pub cost: Option<i64>,
    pub effects: Vec<EffectChange>,
}

/// What upgrading `facility_type` at `team` would cost, and every effect before
/// and after: the numbers the game itself plays by.
pub fn upgrade_preview(team: &Team, facility_type: FacilityType) -> FacilityUpgradePreview {
    let level = level_of(&team.facilities, &facility_type);
    let cost = next_upgrade_cost(team, &facility_type);
    let next = cost.map(|_| effects(&facility_type, level + 1));
    let effects = effects(&facility_type, level)
        .into_iter()
        .enumerate()
        .map(|(index, effect)| EffectChange {
            key: effect.key,
            format: effect.format,
            current: effect.values,
            next: next.as_ref().map(|next| next[index].values.clone()),
        })
        .collect();
    FacilityUpgradePreview {
        facility: facility_type,
        level,
        max_level: MAX_FACILITY_LEVEL,
        cost,
        effects,
    }
}

pub fn upgrade_facility(
    game: &mut Game,
    team_id: &str,
    facility_type: FacilityType,
) -> Result<i64, String> {
    let cost = {
        let team = game
            .teams
            .iter()
            .find(|team| team.id == team_id)
            .ok_or_else(|| "be.error.managedTeamNotFound".to_string())?;
        let cost = next_upgrade_cost(team, &facility_type)
            .ok_or_else(|| "be.error.finance.facilityUpgradeMaxLevel".to_string())?;
        if team.finance < cost {
            return Err(facility_upgrade_insufficient_funds_error(cost));
        }
        cost
    };

    let date = game.clock.current_date.date_naive();
    post(game, team_id, -cost, CashKind::Facilities, date)?;

    let team = game
        .teams
        .iter_mut()
        .find(|team| team.id == team_id)
        .ok_or_else(|| "be.error.managedTeamNotFound".to_string())?;
    // An upgrade spends the same money a signing would. Left out of the budget,
    // it kept advertising cash the club no longer had.
    team.transfer_budget = (team.transfer_budget - cost).max(0);
    match facility_type {
        FacilityType::Training => {
            team.facilities.training += 1;
        }
        FacilityType::Medical => {
            team.facilities.medical += 1;
        }
        FacilityType::Scouting => {
            team.facilities.scouting += 1;
        }
    }

    Ok(cost)
}
