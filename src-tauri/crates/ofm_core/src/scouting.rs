use crate::game::{
    Game, ScoutingAssignment, YouthScoutingAssignment, YouthScoutingObjective, YouthScoutingRegion,
};
use domain::contract_ledger::ContractSource;
use domain::message::*;
use domain::player::{Player, PlayerMovementKind, Position, SquadRole};
use domain::staff::StaffRole;
use rand::RngExt;
use std::collections::HashMap;
use uuid::Uuid;

const ERR_SCOUT_NOT_FOUND: &str = "be.error.scouting.scoutNotFound";
const ERR_STAFF_MEMBER_NOT_SCOUT: &str = "be.error.scouting.staffMemberNotScout";
const ERR_SCOUT_NOT_IN_TEAM: &str = "be.error.scouting.scoutNotInTeam";
const ERR_CANNOT_SCOUT_OWN_PLAYER: &str = "be.error.scouting.cannotScoutOwnPlayer";
const ERR_PLAYER_ALREADY_SCOUTED: &str = "be.error.scouting.playerAlreadyScouted";
const ERR_YOUTH_SEARCH_ALREADY_ACTIVE: &str = "be.error.scouting.youthSearchAlreadyActive";
const ERR_YOUTH_ASSIGNMENT_NOT_FOUND: &str = "be.error.scouting.youthAssignmentNotFound";
const ERR_SCOUT_ALREADY_ASSIGNED_TO_SEARCH: &str = "be.error.scouting.scoutAlreadyAssignedToSearch";
const ERR_SCOUT_RESTING: &str = "be.error.scouting.scoutResting";
const ERR_SCOUTING_INSUFFICIENT_FUNDS: &str = "be.error.scouting.insufficientFunds";
const ERR_SCOUTING_WAGE_POLICY: &str = "be.error.scouting.wagePolicy";

fn scouting_error_with_params(key: &str, params: &[(&str, String)]) -> String {
    if params.is_empty() {
        return key.to_string();
    }

    let query = params
        .iter()
        .map(|(name, value)| format!("{}={}", name, value))
        .collect::<Vec<_>>()
        .join("&");

    format!("{}?{}", key, query)
}

fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// Scouts can only handle one assignment at a time across player and youth scouting.
pub fn scout_max_assignments(judging_ability: u8) -> usize {
    let _ = judging_ability;
    1
}

fn scout_assignment_count(game: &Game, scout_id: &str) -> usize {
    game.scouting_assignments
        .iter()
        .filter(|assignment| assignment.scout_id == scout_id)
        .count()
        + game
            .youth_scouting_assignments
            .iter()
            .filter(|assignment| assignment.scout_id == scout_id)
            .count()
}

pub(crate) fn resolve_user_scout<'a>(
    game: &'a Game,
    scout_id: &str,
) -> Result<&'a domain::staff::Staff, String> {
    let user_team_id = game
        .manager
        .team_id
        .as_ref()
        .ok_or("be.error.noTeamAssigned")?;

    let scout = game
        .staff
        .iter()
        .find(|staff_member| staff_member.id == scout_id)
        .ok_or(ERR_SCOUT_NOT_FOUND)?;
    if scout.role != StaffRole::Scout {
        return Err(ERR_STAFF_MEMBER_NOT_SCOUT.to_string());
    }
    if scout.team_id.as_ref() != Some(user_team_id) {
        return Err(ERR_SCOUT_NOT_IN_TEAM.to_string());
    }

    Ok(scout)
}

fn assignment_days_for_player_scouting(judging_ability: u8) -> u32 {
    if judging_ability >= 80 {
        2
    } else if judging_ability >= 60 {
        3
    } else if judging_ability >= 40 {
        4
    } else {
        5
    }
}

/// What a youth search costs up front: 15,000 at home, 50,000 abroad, and half
/// as much again when the brief is high potential.
pub fn youth_search_fee(region: YouthScoutingRegion, objective: YouthScoutingObjective) -> i64 {
    let base = match region {
        YouthScoutingRegion::Domestic => 15_000,
        YouthScoutingRegion::International => 50_000,
    };
    match objective {
        YouthScoutingObjective::HighPotential => base * 3 / 2,
        YouthScoutingObjective::Balanced | YouthScoutingObjective::ReadySoon => base,
    }
}

/// What starting a youth search would mean: its fee, how many days it takes,
/// and how many days the scout has left to rest first.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct YouthSearchQuote {
    pub fee: i64,
    pub days: u32,
    pub rest_days_left: i64,
}

pub fn quote_youth_search(
    game: &Game,
    scout_id: &str,
    region: YouthScoutingRegion,
    objective: YouthScoutingObjective,
) -> Result<YouthSearchQuote, String> {
    let scout = resolve_user_scout(game, scout_id)?;
    Ok(YouthSearchQuote {
        fee: youth_search_fee(region, objective),
        days: assignment_days_for_youth_scouting(
            scout.attributes.judging_potential,
            region,
            objective,
        ),
        rest_days_left: youth_search_rest_days_left(game, scout_id),
    })
}

/// Days a scout rests after finishing a youth search before he can start another.
const YOUTH_SEARCH_REST_DAYS: i64 = 7;

/// Days until `scout_id` may go on another youth search; 0 when he is free.
pub fn youth_search_rest_days_left(game: &Game, scout_id: &str) -> i64 {
    let today = game.clock.current_date.date_naive();
    game.scout_youth_rest_until
        .get(scout_id)
        .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        .map(|until| (until - today).num_days().max(0))
        .unwrap_or(0)
}

fn assignment_days_for_youth_scouting(
    judging_potential: u8,
    region: YouthScoutingRegion,
    objective: YouthScoutingObjective,
) -> u32 {
    let base = if judging_potential >= 80 {
        4
    } else if judging_potential >= 60 {
        5
    } else if judging_potential >= 40 {
        6
    } else {
        7
    };

    let region_modifier = match region {
        YouthScoutingRegion::Domestic => 0,
        YouthScoutingRegion::International => 1,
    };
    let objective_modifier = match objective {
        YouthScoutingObjective::Balanced => 0,
        YouthScoutingObjective::HighPotential => 1,
        YouthScoutingObjective::ReadySoon => 0,
    };

    base + region_modifier + objective_modifier
}

/// Send a scout to evaluate a player. Returns an error string if invalid.
pub fn send_scout(game: &mut Game, scout_id: &str, player_id: &str) -> Result<(), String> {
    let user_team_id = game
        .manager
        .team_id
        .as_ref()
        .ok_or("be.error.noTeamAssigned")?;
    let scout = resolve_user_scout(game, scout_id)?;

    // Validate player exists and is not on user's team
    let player = game
        .players
        .iter()
        .find(|p| p.id == player_id)
        .ok_or("be.error.playerNotFound")?;
    if player.team_id.as_deref() == Some(user_team_id.as_str()) {
        return Err(ERR_CANNOT_SCOUT_OWN_PLAYER.to_string());
    }

    // Check scout capacity across both player and youth scouting.
    let max_slots = scout_max_assignments(scout.attributes.judging_ability);
    let current_count = scout_assignment_count(game, scout_id);
    if current_count >= max_slots {
        return Err(scouting_error_with_params(
            "be.error.scouting.scoutAssignmentFull",
            &[
                ("currentCount", current_count.to_string()),
                ("maxSlots", max_slots.to_string()),
            ],
        ));
    }

    // Check if player is already being scouted
    if game
        .scouting_assignments
        .iter()
        .any(|a| a.player_id == player_id)
    {
        return Err(ERR_PLAYER_ALREADY_SCOUTED.to_string());
    }

    // Create assignment (2-5 days depending on scout quality)
    let days = assignment_days_for_player_scouting(scout.attributes.judging_ability);

    game.scouting_assignments.push(ScoutingAssignment {
        id: Uuid::new_v4().to_string(),
        scout_id: scout_id.to_string(),
        player_id: player_id.to_string(),
        days_remaining: days,
    });

    Ok(())
}

pub fn start_youth_scouting(
    game: &mut Game,
    scout_id: &str,
    region: YouthScoutingRegion,
    objective: YouthScoutingObjective,
    target_position: Option<Position>,
) -> Result<(), String> {
    let scout = resolve_user_scout(game, scout_id)?;
    let max_slots = scout_max_assignments(scout.attributes.judging_ability);
    let current_count = scout_assignment_count(game, scout_id);
    if current_count >= max_slots {
        return Err(scouting_error_with_params(
            "be.error.scouting.scoutAssignmentFull",
            &[
                ("currentCount", current_count.to_string()),
                ("maxSlots", max_slots.to_string()),
            ],
        ));
    }

    let target_position = target_position.map(|position| position.to_group_position());
    if game.youth_scouting_assignments.iter().any(|assignment| {
        assignment.region == region
            && assignment.objective == objective
            && assignment.target_position == target_position
    }) {
        return Err(ERR_YOUTH_SEARCH_ALREADY_ACTIVE.to_string());
    }

    let rest_days = youth_search_rest_days_left(game, scout_id);
    if rest_days > 0 {
        return Err(scouting_error_with_params(
            ERR_SCOUT_RESTING,
            &[("days", rest_days.to_string())],
        ));
    }

    let days =
        assignment_days_for_youth_scouting(scout.attributes.judging_potential, region, objective);
    let fee = youth_search_fee(region, objective);
    let team_id = game
        .manager
        .team_id
        .clone()
        .ok_or("be.error.noTeamAssigned")?;
    let cash = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .map(|team| team.finance)
        .ok_or("be.error.teamNotFound")?;
    if cash < fee {
        return Err(scouting_error_with_params(
            ERR_SCOUTING_INSUFFICIENT_FUNDS,
            &[("fee", fee.to_string())],
        ));
    }
    let today = game.clock.current_date.date_naive();
    crate::finances::post(
        game,
        &team_id,
        -fee,
        crate::finances::CashKind::ScoutingExpenses,
        today,
    )?;
    game.youth_scouting_assignments
        .push(YouthScoutingAssignment {
            id: Uuid::new_v4().to_string(),
            scout_id: scout_id.to_string(),
            region,
            objective,
            target_position,
            days_remaining: days,
        });

    Ok(())
}

/// Call off everything `scout_id` is working on: he has left the club, so his
/// reports would come from nobody.
pub(crate) fn call_off_assignments_of(game: &mut Game, scout_id: &str) {
    game.scouting_assignments
        .retain(|assignment| assignment.scout_id != scout_id);
    game.youth_scouting_assignments
        .retain(|assignment| assignment.scout_id != scout_id);
}

pub fn cancel_youth_scouting(game: &mut Game, assignment_id: &str) -> Result<(), String> {
    let original_len = game.youth_scouting_assignments.len();
    game.youth_scouting_assignments
        .retain(|assignment| assignment.id != assignment_id);

    if game.youth_scouting_assignments.len() == original_len {
        return Err(ERR_YOUTH_ASSIGNMENT_NOT_FOUND.to_string());
    }

    Ok(())
}

pub fn reassign_youth_scouting(
    game: &mut Game,
    assignment_id: &str,
    scout_id: &str,
) -> Result<(), String> {
    let assignment_index = game
        .youth_scouting_assignments
        .iter()
        .position(|assignment| assignment.id == assignment_id)
        .ok_or(ERR_YOUTH_ASSIGNMENT_NOT_FOUND)?;
    let current_scout_id = game.youth_scouting_assignments[assignment_index]
        .scout_id
        .clone();
    if current_scout_id == scout_id {
        return Err(ERR_SCOUT_ALREADY_ASSIGNED_TO_SEARCH.to_string());
    }

    let scout = resolve_user_scout(game, scout_id)?;
    let max_slots = scout_max_assignments(scout.attributes.judging_ability);
    let current_count = scout_assignment_count(game, scout_id);
    if current_count >= max_slots {
        return Err(scouting_error_with_params(
            "be.error.scouting.scoutAssignmentFull",
            &[
                ("currentCount", current_count.to_string()),
                ("maxSlots", max_slots.to_string()),
            ],
        ));
    }

    game.youth_scouting_assignments[assignment_index].scout_id = scout_id.to_string();
    Ok(())
}

/// Process scouting assignments daily. Called from process_day().
/// Decrements days, delivers reports when complete.
pub fn process_scouting(game: &mut Game) {
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let mut completed: Vec<ScoutingAssignment> = Vec::new();
    let mut completed_youth: Vec<YouthScoutingAssignment> = Vec::new();

    for assignment in game.scouting_assignments.iter_mut() {
        if assignment.days_remaining > 0 {
            assignment.days_remaining -= 1;
        }
        if assignment.days_remaining == 0 {
            completed.push(assignment.clone());
        }
    }

    for assignment in game.youth_scouting_assignments.iter_mut() {
        if assignment.days_remaining > 0 {
            assignment.days_remaining -= 1;
        }
        if assignment.days_remaining == 0 {
            completed_youth.push(assignment.clone());
        }
    }

    // Remove completed assignments
    game.scouting_assignments.retain(|a| a.days_remaining > 0);
    game.youth_scouting_assignments
        .retain(|assignment| assignment.days_remaining > 0);

    // Generate reports for completed assignments
    for assignment in &completed {
        let scout = game.staff.iter().find(|s| s.id == assignment.scout_id);
        let player = game.players.iter().find(|p| p.id == assignment.player_id);

        if let (Some(scout), Some(player)) = (scout, player) {
            let scout_name = format!("{} {}", scout.first_name, scout.last_name);
            let judging_ability = scout.attributes.judging_ability;
            let judging_potential = scout.attributes.judging_potential;
            let team_name = player
                .team_id
                .as_ref()
                .and_then(|tid| game.teams.iter().find(|t| &t.id == tid))
                .map(|t| t.name.clone());

            let msg = build_scout_report(
                &assignment.id,
                &scout_name,
                &player.id,
                &player.match_name,
                &player.nationality,
                &player.date_of_birth,
                &format!("{:?}", player.position),
                &player.attributes,
                player.morale,
                player.condition,
                player.ovr,
                player.potential,
                judging_ability,
                judging_potential,
                team_name.as_deref(),
                &today,
            );
            game.messages.push(msg);
        }
    }

    for assignment in &completed_youth {
        complete_youth_scouting_assignment(game, assignment, &today);
    }
}

fn complete_youth_scouting_assignment(
    game: &mut Game,
    assignment: &YouthScoutingAssignment,
    date: &str,
) {
    let Some(scout) = game
        .staff
        .iter()
        .find(|staff_member| staff_member.id == assignment.scout_id)
        .cloned()
    else {
        return;
    };
    let Some(user_team_id) = game.manager.team_id.clone() else {
        return;
    };
    let Some(team) = game
        .teams
        .iter()
        .find(|candidate| candidate.id == user_team_id)
        .cloned()
    else {
        return;
    };
    let rest_until =
        game.clock.current_date.date_naive() + chrono::Duration::days(YOUTH_SEARCH_REST_DAYS);
    game.scout_youth_rest_until
        .insert(scout.id.clone(), rest_until.format("%Y-%m-%d").to_string());

    // Seeded by the search, so a replayed day picks the same youngsters.
    let mut rng = game.rng_for(&format!("youth-scout/{}", assignment.id), date);
    crate::youth_pool::ensure_pool(game);
    let recommended =
        generate_youth_recruitment_candidates(game, &team, &scout, assignment, &mut rng);

    let scout_name = format!("{} {}", scout.first_name, scout.last_name);
    game.messages.push(build_youth_recruitment_report(
        &assignment.id,
        &scout_name,
        &team.id,
        &team.name,
        &recommended,
        assignment.region,
        assignment.objective,
        assignment.target_position.as_ref(),
        date,
    ));
}

#[allow(clippy::too_many_arguments)]
fn build_youth_recruitment_report(
    assignment_id: &str,
    scout_name: &str,
    team_id: &str,
    team_name: &str,
    recommended: &[(Player, domain::message::ProspectEstimate)],
    region: YouthScoutingRegion,
    objective: YouthScoutingObjective,
    target_position: Option<&Position>,
    date: &str,
) -> InboxMessage {
    let target_position = target_position.map(|position| position.to_group_position());
    let message = InboxMessage::new(
        format!("youth-scout-{}", assignment_id),
        String::new(),
        String::new(),
        scout_name.to_string(),
        date.to_string(),
    )
    .with_category(MessageCategory::ScoutReport)
    .with_sender_role("");

    let prospects: Vec<Player> = recommended
        .iter()
        .map(|(prospect, _)| prospect.clone())
        .collect();
    let message = prospects.iter().fold(message, |message, prospect| {
        message.with_action(MessageAction {
            id: format!("prospect:{}", prospect.id),
            label: prospect.full_name.clone(),
            action_type: ActionType::ChooseOption {
                options: youth_prospect_options(),
            },
            resolved: false,
            label_key: None,
        })
    });

    let message = message.with_context(MessageContext {
        team_id: Some(team_id.to_string()),
        youth_target_position: target_position
            .as_ref()
            .map(|position| format!("{:?}", position)),
        youth_search_region: Some(format!("{:?}", region)),
        youth_search_objective: Some(format!("{:?}", objective)),
        youth_prospects: Some(prospects.clone()),
        youth_prospect_estimates: recommended
            .iter()
            .map(|(_, estimate)| estimate.clone())
            .collect(),
        youth_prospect_reports: recommended
            .iter()
            .map(|(prospect, estimate)| prospect_report(prospect, estimate))
            .collect(),
        ..MessageContext::default()
    });

    let mut i18n_params = params(&[
        ("scout", scout_name),
        ("count", &prospects.len().to_string()),
        ("team", team_name),
        ("regionLabel", region_i18n_key(region)),
        ("objectiveLabel", objective_i18n_key(objective)),
    ]);
    let body_key = if prospects.is_empty() {
        "be.msg.youthRecruitmentReport.bodyEmpty"
    } else if let Some(target_position) = target_position.as_ref() {
        i18n_params.insert(
            "targetLabel".to_string(),
            youth_target_position_i18n_key(target_position).to_string(),
        );
        "be.msg.youthRecruitmentReport.bodyTargeted"
    } else {
        "be.msg.youthRecruitmentReport.bodyAny"
    };

    let mut message = message.with_i18n(
        "be.msg.youthRecruitmentReport.subject",
        body_key,
        i18n_params,
    );
    message.sender_role_key = Some("be.role.scout".to_string());
    message
}

fn youth_prospect_options() -> Vec<ActionOption> {
    vec![
        ActionOption {
            id: "sign".to_string(),
            label: String::new(),
            description: String::new(),
            label_key: Some("be.msg.youthRecruitment.option.sign.label".to_string()),
            description_key: Some("be.msg.youthRecruitment.option.sign.description".to_string()),
        },
        ActionOption {
            id: "watch".to_string(),
            label: String::new(),
            description: String::new(),
            label_key: Some("be.msg.youthRecruitment.option.watch.label".to_string()),
            description_key: Some("be.msg.youthRecruitment.option.watch.description".to_string()),
        },
        ActionOption {
            id: "discard".to_string(),
            label: String::new(),
            description: String::new(),
            label_key: Some("be.msg.youthRecruitment.option.discard.label".to_string()),
            description_key: Some("be.msg.youthRecruitment.option.discard.description".to_string()),
        },
    ]
}

pub(crate) fn rank_by_objective(
    ovr: u8,
    potential: u8,
    objective: YouthScoutingObjective,
) -> (u8, u8) {
    match objective {
        YouthScoutingObjective::Balanced => (ovr.saturating_add(potential / 2), potential),
        YouthScoutingObjective::HighPotential => (potential, ovr),
        YouthScoutingObjective::ReadySoon => (ovr, potential),
    }
}

/// Who a youth search turns up: `viewed` youngsters still in the season's pool
/// of the search's region, each read by `scout`, of whom he recommends three on
/// what he saw. Fewer when the pool has fewer left, none when it has nobody.
fn generate_youth_recruitment_candidates(
    game: &Game,
    team: &domain::team::Team,
    scout: &domain::staff::Staff,
    search: &YouthScoutingAssignment,
    rng: &mut impl rand::Rng,
) -> Vec<(Player, domain::message::ProspectEstimate)> {
    use rand::seq::SliceRandom;
    let viewed = youth_candidates_viewed(
        search.objective,
        scout.attributes.judging_ability,
        team.facilities.scouting,
    );
    let home = crate::youth_pool::nation_of(team);
    let wanted_group = search
        .target_position
        .as_ref()
        .map(Position::to_group_position);
    let mut candidates: Vec<&Player> = game
        .youth_pool
        .iter()
        .flat_map(|pool| pool.nations.iter())
        .filter(|(nation, _)| match search.region {
            YouthScoutingRegion::Domestic => nation.as_str() == home,
            YouthScoutingRegion::International => nation.as_str() != home,
        })
        .flat_map(|(_, players)| players)
        .filter(|player| {
            wanted_group
                .as_ref()
                .is_none_or(|group| player.position.to_group_position() == *group)
        })
        .collect();
    candidates.shuffle(rng);
    candidates.truncate(viewed);

    let candidates = candidates
        .into_iter()
        .map(|prospect| {
            let estimate = estimate_prospect(
                prospect,
                scout.attributes.judging_ability,
                scout.attributes.judging_potential,
                rng,
            );
            (prospect.clone(), estimate)
        })
        .collect();

    recommend_by_estimate(candidates, search.objective)
}

/// Sign a scouted youngster from the season's pool into the user's academy and
/// return him as signed. He leaves the pool only once he has signed: a board
/// that refuses his wage leaves him there for another club.
///
/// He signs on the terms he was generated with when those are still in the
/// future, and on the club's standard terms when they are not; the board judges
/// the wage as it judges every academy recruit, at what the club would pay him
/// there. Signing him is a contract made mid-career, so it goes in his history.
pub(crate) fn sign_youth_prospect(game: &mut Game, prospect_id: &str) -> Result<Player, String> {
    let prospect = crate::youth_pool::locate(game, prospect_id)?.clone();
    let team_id = game
        .manager
        .team_id
        .clone()
        .ok_or("be.error.noTeamAssigned")?;
    let team = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .ok_or("be.error.teamNotFound")?;

    let mut signed = prospect;
    signed.team_id = Some(team_id);
    signed.squad_role = SquadRole::Youth;
    let today = game.clock.current_date.date_naive();
    let own_terms = signed
        .contract_end()
        .and_then(crate::contracts::parse_contract_date)
        .filter(|end| *end > today)
        .map(|end| (signed.wage(), end))
        .filter(|(wage, _)| *wage > 0);
    let terms =
        own_terms.or_else(|| crate::contracts::standard_contract_terms(&signed, team, today, 0));
    if let Some((wage, _)) = terms
        && !crate::contract_wage_policy::joining_wage_policy_verdict(game, team, &signed, wage)
            .permits()
    {
        return Err(ERR_SCOUTING_WAGE_POLICY.to_string());
    }
    if let Some((wage, end)) = terms {
        crate::contracts::record_movement(
            &mut signed,
            crate::contracts::contract_entry(
                PlayerMovementKind::FreeAgentSigning,
                today,
                team,
                crate::contracts::contract_record(today, end, wage, ContractSource::FreeAgent),
            ),
        );
    }
    signed.jersey_number = crate::roster::resolve_jersey_for(game, &signed, team);
    crate::youth_pool::take(game, prospect_id);
    game.players.push(signed.clone());
    Ok(signed)
}

pub struct YouthRecruitmentEffect {
    pub message: String,
    pub i18n_key: String,
    pub i18n_params: HashMap<String, String>,
}

pub fn apply_youth_recruitment_response(
    game: &mut Game,
    message_id: &str,
    action_id: &str,
    option_id: &str,
) -> Option<YouthRecruitmentEffect> {
    let message_index = game
        .messages
        .iter()
        .position(|message| message.id == message_id)?;
    let action_index = game.messages[message_index]
        .actions
        .iter()
        .position(|action| action.id == action_id)?;
    let prospect_id = action_id.strip_prefix("prospect:")?.to_string();

    let prospects = game.messages[message_index]
        .context
        .youth_prospects
        .clone()?;
    let prospect_index = prospects
        .iter()
        .position(|prospect| prospect.id == prospect_id)?;
    let prospect = prospects[prospect_index].clone();
    let prospect_name = prospect.full_name.clone();

    // Signing or watching needs him still in the pool; tell the manager where
    // he went if he is not, and close the choice.
    if matches!(option_id, "sign" | "watch") {
        let gone = match crate::youth_pool::whereabouts(game, &prospect_id) {
            crate::youth_pool::Whereabouts::Pool(_) => None,
            crate::youth_pool::Whereabouts::Club(team) => Some((
                "be.msg.youthRecruitment.effect.joinedClub",
                params(&[("player", &prospect_name), ("team", &team)]),
            )),
            crate::youth_pool::Whereabouts::Gone => Some((
                "be.msg.youthRecruitment.effect.offMarket",
                params(&[("player", &prospect_name)]),
            )),
        };
        if let Some((key, i18n_params)) = gone {
            resolve_action(game, message_index, action_index);
            return Some(YouthRecruitmentEffect {
                message: String::new(),
                i18n_key: key.to_string(),
                i18n_params,
            });
        }
    }

    match option_id {
        "discard" => {
            let mut remaining = prospects;
            remaining.remove(prospect_index);
            let message = &mut game.messages[message_index];
            message.context.youth_prospects = Some(remaining);
            message.actions.remove(action_index);

            Some(YouthRecruitmentEffect {
                message: String::new(),
                i18n_key: "be.msg.youthRecruitment.effect.discard".to_string(),
                i18n_params: params(&[("player", &prospect.full_name)]),
            })
        }
        "sign" => {
            let signed = match sign_youth_prospect(game, &prospect_id) {
                Ok(signed) => signed,
                Err(error) if error == ERR_SCOUTING_WAGE_POLICY => {
                    return Some(YouthRecruitmentEffect {
                        message: String::new(),
                        i18n_key: "be.msg.youthRecruitment.effect.wagePolicy".to_string(),
                        i18n_params: params(&[("player", &prospect_name)]),
                    });
                }
                Err(_) => return None,
            };

            crate::youth_watchlist::forget(game, &signed.id);
            let message = &mut game.messages[message_index];
            message.context.player_id = Some(signed.id.clone());
            if let Some(prospects) = message.context.youth_prospects.as_mut()
                && let Some(updated_prospect) = prospects
                    .iter_mut()
                    .find(|candidate| candidate.id == prospect_id)
            {
                updated_prospect.team_id = signed.team_id.clone();
                updated_prospect.squad_role = SquadRole::Youth;
                updated_prospect.jersey_number = signed.jersey_number;
            }
            if let Some(action) = message.actions.get_mut(action_index) {
                action.resolved = true;
            }

            Some(YouthRecruitmentEffect {
                message: String::new(),
                i18n_key: "be.msg.youthRecruitment.effect.sign".to_string(),
                i18n_params: params(&[("player", &signed.full_name)]),
            })
        }
        "watch" => {
            let estimate = game.messages[message_index]
                .context
                .youth_prospect_estimates
                .iter()
                .find(|estimate| estimate.prospect_id == prospect_id)
                .cloned()?;
            crate::youth_watchlist::watch(game, prospect, estimate).ok()?;
            resolve_action(game, message_index, action_index);
            Some(YouthRecruitmentEffect {
                message: String::new(),
                i18n_key: "be.msg.youthRecruitment.effect.watch".to_string(),
                i18n_params: params(&[("player", &prospect_name)]),
            })
        }
        "unwatch" => {
            crate::youth_watchlist::unwatch(game, &prospect_id).ok()?;
            resolve_action(game, message_index, action_index);
            Some(YouthRecruitmentEffect {
                message: String::new(),
                i18n_key: "be.msg.youthRecruitment.effect.unwatch".to_string(),
                i18n_params: params(&[("player", &prospect_name)]),
            })
        }
        _ => None,
    }
}

fn resolve_action(game: &mut Game, message_index: usize, action_index: usize) {
    if let Some(action) = game.messages[message_index].actions.get_mut(action_index) {
        action.resolved = true;
    }
}

fn region_i18n_key(region: YouthScoutingRegion) -> &'static str {
    match region {
        YouthScoutingRegion::Domestic => "scouting.regionDomestic",
        YouthScoutingRegion::International => "scouting.regionInternational",
    }
}

fn objective_i18n_key(objective: YouthScoutingObjective) -> &'static str {
    match objective {
        YouthScoutingObjective::Balanced => "scouting.objectiveBalanced",
        YouthScoutingObjective::HighPotential => "scouting.objectiveHighPotential",
        YouthScoutingObjective::ReadySoon => "scouting.objectiveReadySoon",
    }
}

fn youth_target_position_i18n_key(position: &Position) -> &'static str {
    match position {
        Position::Goalkeeper => "common.positions.Goalkeeper",
        Position::Defender => "common.positions.Defender",
        Position::Midfielder => "common.positions.Midfielder",
        Position::Forward => "common.positions.Forward",
        _ => "scouting.youthAnyPosition",
    }
}

#[allow(clippy::too_many_arguments)]
fn build_scout_report(
    assignment_id: &str,
    scout_name: &str,
    player_id: &str,
    player_name: &str,
    nationality: &str,
    dob: &str,
    position: &str,
    attrs: &domain::player::PlayerAttributes,
    morale: u8,
    condition: u8,
    player_ovr: u8,
    player_potential: u8,
    judging_ability: u8,
    judging_potential: u8,
    team_name: Option<&str>,
    date: &str,
) -> InboxMessage {
    // What the scout sees is part of the assignment, so two replays of the day agree.
    let mut rng = crate::seed::rng_from_key(&format!("scout-report/{assignment_id}/{date}"));

    // Accuracy: higher judging = less noise on reported attributes
    let noise_range = judgement_band(judging_ability);

    let mut fuzz = |val: u8| -> u8 {
        let delta: i16 = rng.random_range(-(noise_range as i16)..=(noise_range as i16));
        ((val as i16) + delta).clamp(1, 99) as u8
    };

    // Build fuzzed attribute values
    let all_fuzzed: [(u8, &str); 6] = [
        (fuzz(attrs.pace), "Pace"),
        (fuzz(attrs.shooting), "Shooting"),
        (fuzz(attrs.passing), "Passing"),
        (fuzz(attrs.dribbling), "Dribbling"),
        (fuzz(attrs.defending), "Defending"),
        (fuzz(attrs.strength), "Physical"),
    ];

    // Discovery mechanic: scout ability determines how many attrs are revealed
    // 80+: all 6 attrs + condition + morale
    // 60-79: 5 attrs + condition
    // 40-59: 3 attrs
    // <40: 2 attrs
    let reveal_count = revealed_attribute_count(judging_ability);

    // Shuffle indices to determine which attrs are hidden
    let mut indices: Vec<usize> = (0..6).collect();
    for i in (1..indices.len()).rev() {
        let j = rng.random_range(0..=i);
        indices.swap(i, j);
    }
    let revealed: std::collections::HashSet<usize> =
        indices[..reveal_count].iter().cloned().collect();

    let to_opt = |idx: usize| -> Option<u8> {
        if revealed.contains(&idx) {
            Some(all_fuzzed[idx].0)
        } else {
            None
        }
    };

    let pace = to_opt(0);
    let shooting = to_opt(1);
    let passing = to_opt(2);
    let dribbling = to_opt(3);
    let defending = to_opt(4);
    let physical = to_opt(5);

    let reported_condition = if judging_ability >= 60 {
        Some(condition)
    } else {
        None
    };
    let reported_morale = if judging_ability >= 80 {
        Some(morale)
    } else {
        None
    };

    // Overall rating assessment based on the player's position-weighted OVR (fuzzed by scout ability).
    // Fall back to attribute average if OVR is unavailable (legacy players).
    let rating_base = if player_ovr > 0 {
        let delta: i16 = rng.random_range(-(noise_range as i16)..=(noise_range as i16));
        ((player_ovr as i16) + delta).clamp(1, 99) as u32
    } else {
        let revealed_vals: Vec<u32> = (0..6).filter_map(|i| to_opt(i).map(|v| v as u32)).collect();
        if revealed_vals.is_empty() {
            0
        } else {
            revealed_vals.iter().sum::<u32>() / revealed_vals.len() as u32
        }
    };

    let rating_key = rating_key_for(rating_base);

    // Potential assessment: use the player's actual potential (fuzzed) when the scout
    // has sufficient judging_potential skill.  High-potential scouts can also spot
    // Wonderkid-level talent accurately.
    let potential_key = if judging_potential >= 70 {
        let fuzzed_potential = if player_potential > 0 {
            let delta: i16 = rng.random_range(-(noise_range as i16)..=(noise_range as i16));
            ((player_potential as i16) + delta).clamp(1, 99) as u32
        } else {
            rating_base // fallback to fuzzed OVR if no potential stored
        };
        potential_key_for(fuzzed_potential)
    } else {
        "common.scoutPotential.unclear"
    };

    // Confidence level
    let confidence_key = if judging_ability >= 80 {
        "common.scoutConfidence.high"
    } else if judging_ability >= 60 {
        "common.scoutConfidence.moderate"
    } else {
        "common.scoutConfidence.low"
    };

    // Build structured report data for the player card
    let report_data = ScoutReportData {
        player_id: player_id.to_string(),
        player_name: player_name.to_string(),
        position: position.to_string(),
        nationality: nationality.to_string(),
        dob: dob.to_string(),
        team_name: team_name.map(|s| s.to_string()),
        pace,
        shooting,
        passing,
        dribbling,
        defending,
        physical,
        condition: reported_condition,
        morale: reported_morale,
        avg_rating: Some(rating_base),
        rating_key: rating_key.to_string(),
        potential_key: potential_key.to_string(),
        confidence_key: confidence_key.to_string(),
        height_cm: None,
        weight_kg: None,
        footedness: None,
        weak_foot: None,
        attribute_reads: Vec::new(),
    };

    let msg_id = format!("scout_report_{}", assignment_id);

    InboxMessage::new(
        msg_id,
        String::new(),
        String::new(),
        scout_name.to_string(),
        date.to_string(),
    )
    .with_category(MessageCategory::ScoutReport)
    .with_priority(MessagePriority::Normal)
    .with_sender_role("Scout")
    .with_action(MessageAction {
        id: "ack".to_string(),
        label: "Noted".to_string(),
        action_type: ActionType::Acknowledge,
        resolved: false,
        label_key: Some("be.msg.event.ack".to_string()),
    })
    .with_context(MessageContext {
        player_id: Some(player_id.to_string()),
        scout_report: Some(report_data),
        ..Default::default()
    })
    .with_i18n("be.msg.scoutReport.subject", "be.msg.scoutReport.body", {
        let mut p = params(&[("player", player_name), ("scout", scout_name)]);
        p.insert("ratingDesc".to_string(), rating_key.to_string());
        p.insert("potentialDesc".to_string(), potential_key.to_string());
        p.insert("confidence".to_string(), confidence_key.to_string());
        p
    })
    .with_sender_i18n("be.sender.scout", "be.role.scout")
}

/// How far either side of the truth a scout's read of a rating can land.
pub(crate) fn judgement_band(rating: u8) -> u8 {
    if rating >= 80 {
        2
    } else if rating >= 60 {
        5
    } else if rating >= 40 {
        8
    } else {
        12
    }
}

/// How many of a report's six headline attributes a scout gets to see.
pub(crate) fn revealed_attribute_count(rating: u8) -> usize {
    if rating >= 80 {
        6
    } else if rating >= 60 {
        5
    } else if rating >= 40 {
        3
    } else {
        2
    }
}

/// Youngsters a search looks at for each objective, before judging ability and
/// facilities add more.
fn youth_candidates_base(objective: YouthScoutingObjective) -> usize {
    match objective {
        YouthScoutingObjective::Balanced => 4,
        YouthScoutingObjective::HighPotential | YouthScoutingObjective::ReadySoon => 6,
    }
}

/// How many youngsters a youth search looks at before the scout picks three:
/// the objective's base, one more for every 25 points of judging ability, and
/// one more for every scouting facility level above the first.
pub(crate) fn youth_candidates_viewed(
    objective: YouthScoutingObjective,
    judging_ability: u8,
    scouting_facility_level: u8,
) -> usize {
    youth_candidates_base(objective)
        + usize::from(judging_ability / 25)
        + usize::from(scouting_facility_level.saturating_sub(1))
}

/// A youth search recommends this many of the youngsters it looks at.
const YOUTH_PROSPECTS_RECOMMENDED: usize = 3;

/// The scout's read of one rating: his estimate lands within `band` of the
/// truth, and the range is `band` either side of the estimate, so the truth is
/// always inside it.
pub(crate) fn read_rating(truth: u8, band: u8, rng: &mut impl rand::Rng) -> (u8, u8) {
    let band = i16::from(band);
    let estimate = i16::from(truth) + rng.random_range(-band..=band);
    let low = (estimate - band).clamp(1, 99) as u8;
    let high = (estimate + band).clamp(1, 99) as u8;
    (low.min(truth), high.max(truth))
}

/// What a scout of `judging_ability` / `judging_potential` makes of `prospect`.
pub(crate) fn estimate_prospect(
    prospect: &Player,
    judging_ability: u8,
    judging_potential: u8,
    rng: &mut impl rand::Rng,
) -> domain::message::ProspectEstimate {
    let ovr_band = judgement_band(judging_ability);
    let potential_band = judgement_band(judging_potential);
    let (ovr_low, ovr_high) = read_rating(prospect.ovr, ovr_band, rng);
    let (potential_low, potential_high) = read_rating(prospect.potential, potential_band, rng);
    domain::message::ProspectEstimate {
        prospect_id: prospect.id.clone(),
        ovr_low,
        ovr_high,
        ovr_band,
        potential_low,
        potential_high,
        potential_band,
        attributes: Vec::new(),
    }
}

/// The midpoint of a range: what the scout believes the rating is.
pub(crate) fn believed(low: u8, high: u8) -> u8 {
    ((u16::from(low) + u16::from(high)) / 2) as u8
}

/// The three a scout recommends, ranked on his estimates rather than the truth.
fn recommend_by_estimate(
    mut candidates: Vec<(Player, domain::message::ProspectEstimate)>,
    objective: YouthScoutingObjective,
) -> Vec<(Player, domain::message::ProspectEstimate)> {
    let score = |estimate: &domain::message::ProspectEstimate| {
        rank_by_objective(
            believed(estimate.ovr_low, estimate.ovr_high),
            believed(estimate.potential_low, estimate.potential_high),
            objective,
        )
    };
    candidates.sort_by_key(|candidate| std::cmp::Reverse(score(&candidate.1)));
    candidates.truncate(YOUTH_PROSPECTS_RECOMMENDED);
    candidates
}

/// The words a report puts on an overall rating it believes.
fn rating_key_for(rating: u32) -> &'static str {
    if rating >= 80 {
        "common.scoutRatings.excellent"
    } else if rating >= 70 {
        "common.scoutRatings.veryGood"
    } else if rating >= 60 {
        "common.scoutRatings.good"
    } else if rating >= 50 {
        "common.scoutRatings.average"
    } else {
        "common.scoutRatings.belowAverage"
    }
}

/// The words a report puts on a potential it believes.
fn potential_key_for(potential: u32) -> &'static str {
    if potential >= 85 {
        "common.scoutPotential.worldClass"
    } else if potential >= 70 {
        "common.scoutPotential.strong"
    } else {
        "common.scoutPotential.moderate"
    }
}

/// How sure a read of a youngster is, by how wide its overall range still is:
/// exact once a scout has followed him down to nothing.
fn prospect_confidence_key(ovr_band: u8) -> &'static str {
    match ovr_band {
        0 => "common.scoutConfidence.exact",
        1..=2 => "common.scoutConfidence.high",
        3..=5 => "common.scoutConfidence.moderate",
        _ => "common.scoutConfidence.low",
    }
}

/// A youngster as the club's scouts read him, drawn as the player card a scout
/// report uses: one figure per rating, the middle of the range he is believed to
/// lie in, and only the headline attributes a scout has read.
pub fn prospect_report(prospect: &Player, estimate: &ProspectEstimate) -> ScoutReportData {
    let attribute = |key: &str| {
        estimate
            .attributes
            .iter()
            .find(|read| read.key == key)
            .map(|read| believed(read.low, read.high))
    };
    let ovr = u32::from(believed(estimate.ovr_low, estimate.ovr_high));
    let potential = u32::from(believed(estimate.potential_low, estimate.potential_high));
    ScoutReportData {
        player_id: prospect.id.clone(),
        player_name: prospect.full_name.clone(),
        position: format!("{:?}", prospect.position),
        nationality: prospect.nationality.clone(),
        dob: prospect.date_of_birth.clone(),
        team_name: None,
        pace: attribute("pace"),
        shooting: attribute("shooting"),
        passing: attribute("passing"),
        dribbling: attribute("dribbling"),
        defending: attribute("defending"),
        physical: attribute("strength"),
        condition: None,
        morale: None,
        avg_rating: Some(ovr),
        rating_key: rating_key_for(ovr).to_string(),
        potential_key: potential_key_for(potential).to_string(),
        confidence_key: prospect_confidence_key(estimate.ovr_band).to_string(),
        height_cm: Some(prospect.height_cm),
        weight_kg: Some(prospect.weight_kg),
        footedness: Some(prospect.footedness),
        weak_foot: Some(prospect.weak_foot),
        attribute_reads: estimate.attributes.clone(),
    }
}

#[cfg(test)]
mod prospect_card_tests {
    use super::prospect_report;
    use domain::message::{AttributeRead, ProspectEstimate};
    use domain::player::{Player, PlayerAttributes, Position};

    fn kid() -> Player {
        let attributes: PlayerAttributes = serde_json::from_value(serde_json::json!({
            "pace": 60, "stamina": 60, "strength": 60, "agility": 60, "passing": 60,
            "shooting": 60, "tackling": 60, "dribbling": 60, "defending": 60,
            "positioning": 60, "vision": 60, "decisions": 60, "composure": 60,
            "aggression": 60, "teamwork": 60, "leadership": 60, "handling": 20,
            "reflexes": 20, "aerial": 60
        }))
        .unwrap();
        Player::new(
            "kid".to_string(),
            "Kid".to_string(),
            "Kid One".to_string(),
            "2009-01-01".to_string(),
            "ENG".to_string(),
            Position::Goalkeeper,
            attributes,
        )
    }

    fn read(ovr: (u8, u8), potential: (u8, u8), ovr_band: u8) -> ProspectEstimate {
        ProspectEstimate {
            prospect_id: "kid".to_string(),
            ovr_low: ovr.0,
            ovr_high: ovr.1,
            ovr_band,
            potential_low: potential.0,
            potential_high: potential.1,
            potential_band: 5,
            attributes: Vec::new(),
        }
    }

    /// Given a scout's read of a youngster,
    /// When it is drawn as a player card,
    /// Then each rating is the middle of its range, labelled as a player report
    /// labels it, and nothing he has not read is shown.
    #[test]
    fn a_prospect_card_shows_the_middle_of_each_range() {
        let card = prospect_report(&kid(), &read((88, 98), (90, 99), 5));

        assert_eq!(card.player_id, "kid");
        assert_eq!(card.player_name, "Kid One");
        assert_eq!(card.position, "Goalkeeper");
        assert_eq!(card.avg_rating, Some(93));
        assert_eq!(card.rating_key, "common.scoutRatings.excellent");
        assert_eq!(card.potential_key, "common.scoutPotential.worldClass");
        assert_eq!(card.confidence_key, "common.scoutConfidence.moderate");
        assert_eq!(card.team_name, None);
        assert_eq!(card.condition, None);
        for value in [
            card.pace,
            card.shooting,
            card.passing,
            card.dribbling,
            card.defending,
            card.physical,
        ] {
            assert_eq!(value, None);
        }
    }

    /// Given reads of headline attributes,
    /// When the card is drawn,
    /// Then those show the middle of their ranges and the rest stay unread.
    #[test]
    fn a_prospect_card_shows_the_attributes_the_scout_read() {
        let mut estimate = read((60, 64), (70, 74), 2);
        estimate.attributes = vec![
            AttributeRead {
                key: "pace".to_string(),
                low: 60,
                high: 68,
                band: 5,
            },
            AttributeRead {
                key: "strength".to_string(),
                low: 79,
                high: 79,
                band: 0,
            },
        ];

        let card = prospect_report(&kid(), &estimate);

        assert_eq!(card.pace, Some(64));
        assert_eq!(card.physical, Some(79));
        assert_eq!(card.shooting, None);
        assert_eq!(card.attribute_reads.len(), 2);
        assert_eq!(card.height_cm, Some(kid().height_cm));
        assert_eq!(card.potential_key, "common.scoutPotential.strong");
    }

    /// Given the overall band narrowing week by week,
    /// When the card is drawn at each step,
    /// Then its confidence rises from low to exact.
    #[test]
    fn a_prospect_cards_confidence_follows_the_overall_band() {
        let confidence =
            |band| prospect_report(&kid(), &read((60, 64), (70, 74), band)).confidence_key;

        assert_eq!(confidence(12), "common.scoutConfidence.low");
        assert_eq!(confidence(8), "common.scoutConfidence.low");
        assert_eq!(confidence(5), "common.scoutConfidence.moderate");
        assert_eq!(confidence(2), "common.scoutConfidence.high");
        assert_eq!(confidence(0), "common.scoutConfidence.exact");
    }
}

#[cfg(test)]
mod tests {
    use super::build_scout_report;
    use domain::message::{ActionType, MessageCategory, MessagePriority};
    use domain::player::PlayerAttributes;

    fn sample_attrs() -> PlayerAttributes {
        PlayerAttributes {
            pace: 70,
            stamina: 68,
            strength: 66,
            agility: 69,
            passing: 72,
            shooting: 64,
            tackling: 58,
            dribbling: 71,
            defending: 57,
            positioning: 65,
            vision: 70,
            decisions: 67,
            composure: 68,
            aggression: 52,
            teamwork: 73,
            leadership: 48,
            handling: 18,
            reflexes: 20,
            aerial: 55,
        }
    }

    fn report_for(assignment: &str) -> String {
        let message = build_scout_report(
            assignment,
            "Alex Scout",
            "player-1",
            "Jamie Prospect",
            "ENG",
            "2004-03-12",
            "Midfielder",
            &sample_attrs(),
            74,
            89,
            67,
            79,
            50,
            50,
            Some("London FC"),
            "2026-08-01",
        );
        serde_json::to_value(message).unwrap().to_string()
    }

    /// Given a scout assigned to a player,
    /// When the report is written twice, for each of thirty assignments,
    /// Then it reads the same both times — the scout's noise is part of the report, so a
    ///      replayed day must not see different numbers — and the noise is not the same
    ///      for every assignment.
    #[test]
    fn a_scout_report_reads_the_same_each_time() {
        let ids: Vec<String> = (0..30).map(|n| format!("assignment-{n}")).collect();
        for id in &ids {
            assert_eq!(report_for(id), report_for(id), "{id}");
        }
        let distinct: std::collections::BTreeSet<String> = ids
            .iter()
            .map(|id| report_for(id).replace(id.as_str(), ""))
            .collect();
        assert!(distinct.len() > 1, "the scout's noise never varied");
    }

    #[test]
    fn build_scout_report_uses_i18n_keys_without_raw_fallbacks() {
        let message = build_scout_report(
            "assignment-1",
            "Alex Scout",
            "player-1",
            "Jamie Prospect",
            "ENG",
            "2004-03-12",
            "Midfielder",
            &sample_attrs(),
            74,
            89,
            67,
            79,
            85,
            83,
            Some("London FC"),
            "2026-08-01",
        );

        assert_eq!(message.subject, "");
        assert_eq!(message.body, "");
        assert_eq!(message.sender, "Alex Scout");
        assert_eq!(message.sender_role, "Scout");
        assert_eq!(message.category, MessageCategory::ScoutReport);
        assert_eq!(message.priority, MessagePriority::Normal);
        assert_eq!(
            message.subject_key.as_deref(),
            Some("be.msg.scoutReport.subject")
        );
        assert_eq!(message.body_key.as_deref(), Some("be.msg.scoutReport.body"));
        assert_eq!(message.sender_key.as_deref(), Some("be.sender.scout"));
        assert_eq!(message.sender_role_key.as_deref(), Some("be.role.scout"));
        assert_eq!(
            message.i18n_params.get("player"),
            Some(&"Jamie Prospect".to_string())
        );
        assert_eq!(
            message.i18n_params.get("scout"),
            Some(&"Alex Scout".to_string())
        );
        assert!(
            matches!(message.actions.as_slice(), [action] if matches!(action.action_type, ActionType::Acknowledge))
        );
        let report = message
            .context
            .scout_report
            .expect("scout report context should be attached");
        assert_eq!(report.player_id, "player-1");
        assert_eq!(report.player_name, "Jamie Prospect");
        assert_eq!(report.team_name.as_deref(), Some("London FC"));
    }

    mod youth_judgement {
        use super::super::*;
        use domain::message::ProspectEstimate;

        /// Given scouts across the judging scale,
        /// When their bands and revealed attributes are read,
        /// Then they follow the thresholds the player scout report has always used.
        #[test]
        fn bands_and_reveals_follow_the_judging_thresholds() {
            assert_eq!(
                [95, 80, 79, 60, 59, 40, 39, 0].map(judgement_band),
                [2, 2, 5, 5, 8, 8, 12, 12]
            );
            assert_eq!([80, 60, 40, 39].map(revealed_attribute_count), [6, 5, 3, 2]);
        }

        /// Given searches by scouts of different judging ability and clubs of
        /// different scouting facility,
        /// When the number of youngsters looked at is worked out,
        /// Then it is the objective's base, +1 for every 25 points of judging
        /// ability, +1 for every facility level above the first.
        #[test]
        fn a_better_scout_and_facility_look_at_more_youngsters() {
            use YouthScoutingObjective::*;
            assert_eq!(youth_candidates_viewed(Balanced, 30, 1), 5);
            assert_eq!(youth_candidates_viewed(Balanced, 80, 1), 7);
            assert_eq!(youth_candidates_viewed(HighPotential, 100, 3), 12);
            assert_eq!(youth_candidates_viewed(ReadySoon, 0, 0), 6);
        }

        fn candidate(
            id: &str,
            ovr: u8,
            potential: u8,
            read: (u8, u8),
        ) -> (Player, ProspectEstimate) {
            let mut player = Player::new(
                id.to_string(),
                id.to_string(),
                id.to_string(),
                "2009-01-01".to_string(),
                "GB".to_string(),
                Position::Midfielder,
                crate::test_support::uniform_attributes(60),
            );
            player.ovr = ovr;
            player.potential = potential;
            let estimate = ProspectEstimate {
                prospect_id: id.to_string(),
                ovr_low: read.0 - 5,
                ovr_high: read.0 + 5,
                ovr_band: 5,
                potential_low: read.1 - 5,
                potential_high: read.1 + 5,
                potential_band: 5,
                attributes: Vec::new(),
            };
            (player, estimate)
        }

        /// Given four youngsters, the truly best of whom the scout misreads as
        /// the weakest,
        /// When the scout picks three for a high-potential search,
        /// Then he picks on what he saw: the truly best is left out.
        #[test]
        fn the_scout_recommends_on_his_estimates_not_the_truth() {
            let candidates = vec![
                candidate("hidden-gem", 60, 90, (55, 62)),
                candidate("a", 58, 75, (58, 80)),
                candidate("b", 57, 72, (57, 78)),
                candidate("c", 56, 70, (56, 76)),
            ];

            let picked: Vec<String> =
                recommend_by_estimate(candidates, YouthScoutingObjective::HighPotential)
                    .into_iter()
                    .map(|(player, _)| player.id)
                    .collect();

            assert_eq!(picked, vec!["a", "b", "c"]);
        }
    }
}
