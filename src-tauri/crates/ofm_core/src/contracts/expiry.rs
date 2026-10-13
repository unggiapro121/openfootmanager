//! Contract expiry: the daily sweep that warns on approaching expiries and
//! releases players whose deals have run out, plus the shared release routine
//! that both expiry and manager-termination funnel through. Byte-faithful
//! extraction from the original contracts.rs.

use super::*;

/// How long a deal the club has just agreed counts as settled. A renewal runs
/// from the day it is signed, so a one-year deal starts inside the final-year
/// warning; without this grace it would be flagged as at risk the day it was done.
const FRESH_CONTRACT_DAYS: i64 = 180;

/// Whether the club should be renewing this player now: his contract is in its
/// final year, and it is not one the club agreed in the last six months. The
/// contract a career opened with is never fresh, since nobody at the club agreed it.
pub fn contract_needs_renewal(player: &Player, current_date: NaiveDate) -> bool {
    contract_warning_stage(player.contract_end(), current_date).is_some()
        && !is_freshly_agreed(player, current_date)
}

fn is_freshly_agreed(player: &Player, current_date: NaiveDate) -> bool {
    let Some(contract) = player.current_contract() else {
        return false;
    };
    if matches!(
        contract.source,
        ContractSource::Initial | ContractSource::LegacyMigrated
    ) {
        return false;
    }
    contract
        .start
        .as_deref()
        .and_then(|start| NaiveDate::parse_from_str(start, "%Y-%m-%d").ok())
        .is_some_and(|start| (current_date - start).num_days() < FRESH_CONTRACT_DAYS)
}

pub fn contract_warning_stage(
    contract_end: Option<&str>,
    current_date: NaiveDate,
) -> Option<ContractWarningStage> {
    let days_remaining = contract_days_remaining(contract_end, current_date)?;

    if days_remaining <= 0 {
        return None;
    }

    if days_remaining <= 30 {
        return Some(ContractWarningStage::FinalWeeks);
    }

    if days_remaining <= 90 {
        return Some(ContractWarningStage::ThreeMonths);
    }

    if days_remaining <= 180 {
        return Some(ContractWarningStage::SixMonths);
    }

    if days_remaining <= 365 {
        return Some(ContractWarningStage::TwelveMonths);
    }

    None
}

pub fn process_contract_expiries(game: &mut Game) {
    let current_date = game.clock.current_date.date_naive();

    let expired_player_indices: Vec<usize> = game
        .players
        .iter()
        .enumerate()
        .filter_map(|(index, player)| {
            let days_remaining = contract_days_remaining(player.contract_end(), current_date)?;
            if player.team_id.is_some() && days_remaining <= 0 {
                Some(index)
            } else {
                None
            }
        })
        .collect();

    for player_index in expired_player_indices {
        release_player_contract(game, player_index, ContractReleaseReason::Expired);
    }
}

pub(crate) fn remove_player_from_team_references(team: &mut Team, player_id: &str) {
    team.remove_player_references(player_id);
}

pub(crate) fn release_player_contract(
    game: &mut Game,
    player_index: usize,
    reason: ContractReleaseReason,
) {
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let player_id = game.players[player_index].id.clone();
    let player_name = game.players[player_index].match_name.clone();
    let team_id = game.players[player_index]
        .contract_club_id()
        .map(str::to_string);

    let Some(team_id) = team_id.as_deref() else {
        return;
    };
    let Some(team_name) = game
        .teams
        .iter()
        .find(|candidate| candidate.id == team_id)
        .map(|team| team.name.clone())
    else {
        return;
    };

    for team in &mut game.teams {
        remove_player_from_team_references(team, &player_id);
    }

    let player = &mut game.players[player_index];
    player.team_id = None;
    player.active_loan = None;
    player.transfer_listed = false;
    player.loan_listed = false;
    player.transfer_offers.clear();
    player.loan_offers.clear();
    player.morale_core.renewal_state = None;
    // Recording the release is what ends the contract: the dates and the wage follow it.
    record_movement(
        player,
        PlayerMovementEntry {
            from_team_id: Some(team_id.to_string()),
            from_team_name: Some(team_name.clone()),
            release_reason: Some(match reason {
                ContractReleaseReason::Expired => ReleaseReason::Expired,
                ContractReleaseReason::ManagerTermination { .. } => ReleaseReason::Terminated,
            }),
            ..PlayerMovementEntry::new(today.clone(), PlayerMovementKind::Released)
        },
    );

    let message = match reason {
        ContractReleaseReason::Expired => {
            contract_expired_message(&player_id, &player_name, &team_name, &today)
        }
        ContractReleaseReason::ManagerTermination { severance_cost } => {
            contract_terminated_message(
                &player_id,
                &player_name,
                &team_name,
                severance_cost,
                &today,
            )
        }
    };

    game.messages.push(message);
}

pub(crate) fn contract_expired_message(
    player_id: &str,
    player_name: &str,
    team_name: &str,
    date: &str,
) -> InboxMessage {
    let mut i18n_params = std::collections::HashMap::new();
    i18n_params.insert("player".to_string(), player_name.to_string());
    i18n_params.insert("team".to_string(), team_name.to_string());

    InboxMessage::new(
        format!("contract_expired_{}", player_id),
        String::new(),
        String::new(),
        String::new(),
        date.to_string(),
    )
    .with_category(MessageCategory::Contract)
    .with_priority(MessagePriority::Urgent)
    .with_sender_role("")
    .with_i18n(
        "be.msg.contractExpired.subject",
        "be.msg.contractExpired.body",
        i18n_params,
    )
    .with_sender_i18n("be.sender.assistantManager", "be.role.assistantManager")
}

#[cfg(test)]
mod needs_renewal_tests {
    use super::*;
    use crate::test_support::uniform_attributes;
    use domain::contract_ledger::ContractRecord;
    use domain::player::{PlayerMovementEntry, PlayerMovementKind, Position};

    fn day(year: i32, month: u32, date: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, date).unwrap()
    }

    fn player_on(
        kind: PlayerMovementKind,
        source: ContractSource,
        start: &str,
        end: &str,
    ) -> Player {
        let mut player = Player::new(
            "p".to_string(),
            "P".to_string(),
            "Player".to_string(),
            "1991-07-08".to_string(),
            "Netherlands".to_string(),
            Position::CenterBack,
            uniform_attributes(80),
        );
        player.team_id = Some("club".to_string());
        player
            .record_movement(PlayerMovementEntry {
                to_team_id: Some("club".to_string()),
                contract: Some(ContractRecord {
                    start: Some(start.to_string()),
                    end: Some(end.to_string()),
                    weekly_wage: 248_000,
                    source,
                }),
                ..PlayerMovementEntry::new(start, kind)
            })
            .unwrap();
        player
    }

    /// Given a one-year renewal signed today,
    /// When the club asks whether he needs renewing,
    /// Then he does not: the deal was just done, though it has under a year left.
    #[test]
    fn a_contract_just_renewed_does_not_need_renewing() {
        let player = player_on(
            PlayerMovementKind::Renewal,
            ContractSource::Renewal,
            "2026-08-31",
            "2027-08-31",
        );

        assert!(contract_warning_stage(player.contract_end(), day(2026, 8, 31)).is_some());
        assert!(!contract_needs_renewal(&player, day(2026, 8, 31)));
    }

    /// Given that one-year renewal seven months on,
    /// When the club asks again,
    /// Then he needs renewing, as any expiring contract does.
    #[test]
    fn a_renewal_needs_renewing_again_once_it_is_no_longer_fresh() {
        let player = player_on(
            PlayerMovementKind::Renewal,
            ContractSource::Renewal,
            "2026-08-31",
            "2027-08-31",
        );

        assert!(contract_needs_renewal(&player, day(2027, 4, 1)));
    }

    /// Given the contract a player had when the career opened, now in its final
    /// year a few weeks into the career, then he needs renewing: it was not
    /// agreed by this club, so it is never fresh.
    #[test]
    fn an_opening_contract_ending_soon_needs_renewing_at_once() {
        let player = player_on(
            PlayerMovementKind::InitialContract,
            ContractSource::Initial,
            "2026-06-01",
            "2027-06-30",
        );

        assert!(contract_needs_renewal(&player, day(2026, 7, 15)));
    }

    /// Given a contract with more than a year left, then it needs no renewal.
    #[test]
    fn a_long_contract_needs_no_renewal() {
        let player = player_on(
            PlayerMovementKind::InitialContract,
            ContractSource::Initial,
            "2026-06-01",
            "2028-06-30",
        );

        assert!(!contract_needs_renewal(&player, day(2026, 8, 31)));
    }
}
