//! MCP tool implementations: club

use crate::mcp_server::context::McpContext;
use crate::mcp_server::tools_impl::helpers::require_game;
use std::sync::Arc;

// ─── club_upgrade_facility ──────────────────────────────────────────────────

pub fn club_upgrade_facility(ctx: Arc<McpContext>, facility: String) -> Result<String, String> {
    crate::commands::club::upgrade_facility_internal(&ctx.state_manager, &facility)?;

    {
        use tauri::Emitter;
        let _ = ctx.app_handle.emit("game-state-changed", ());
    }

    let preview = crate::commands::club::get_facility_upgrade_preview_internal(
        &ctx.state_manager,
        &facility,
    )?;
    let mut output = format!(
        "## Facility Upgraded\n\n**{}** is now level {} of {}.\n\n| Effect | Value |\n|--------|-------|\n",
        facility, preview.level, preview.max_level
    );
    for effect in &preview.effects {
        let values: Vec<String> = effect
            .current
            .iter()
            .map(|value| value.to_string())
            .collect();
        output.push_str(&format!(
            "| {} | {} ({:?}) |\n",
            effect.key.trim_start_matches("finances.facilityEffects."),
            values.join(" / "),
            effect.format
        ));
    }
    Ok(output)
}

// ─── staff_get ──────────────────────────────────────────────────────────────

// ─── staff_get ──────────────────────────────────────────────────────────────

pub fn staff_get(ctx: Arc<McpContext>) -> Result<String, String> {
    let game = require_game(&ctx.state_manager)?;

    let mut output =
        String::from("## Staff\n\n| ID | Name | Role | Team |\n|----|------|------|------|\n");

    for s in &game.staff {
        let team = s
            .team_id
            .as_deref()
            .and_then(|tid| game.teams.iter().find(|t| t.id == tid))
            .map(|t| t.name.clone())
            .unwrap_or_else(|| "Unattached".to_string());
        output.push_str(&format!(
            "| {} | {} {} | {:?} | {} |\n",
            s.id, s.first_name, s.last_name, s.role, team
        ));
    }

    Ok(output)
}

// ─── staff_hire ──────────────────────────────────────────────────────────────

// ─── staff_hire ──────────────────────────────────────────────────────────────

pub fn staff_hire(ctx: Arc<McpContext>, staff_id: String) -> Result<String, String> {
    crate::commands::staff::hire_staff_internal(
        &ctx.state_manager,
        &staff_id,
        ofm_core::staff_contracts::DEFAULT_STAFF_CONTRACT_YEARS,
    )?;

    {
        use tauri::Emitter;
        let _ = ctx.app_handle.emit("game-state-changed", ());
    }

    Ok(format!(
        "## Staff Hired\n\nStaff member {} hired.",
        staff_id
    ))
}

// ─── staff_release ───────────────────────────────────────────────────────────

// ─── staff_release ───────────────────────────────────────────────────────────

pub fn staff_release(ctx: Arc<McpContext>, staff_id: String) -> Result<String, String> {
    crate::commands::staff::release_staff_internal(&ctx.state_manager, &staff_id)?;

    {
        use tauri::Emitter;
        let _ = ctx.app_handle.emit("game-state-changed", ());
    }

    Ok(format!(
        "## Staff Released\n\nStaff member {} released.",
        staff_id
    ))
}

// ─── season_check_complete ──────────────────────────────────────────────────

// ─── club_request_board_support ─────────────────────────────────────────────

pub fn club_request_board_support(ctx: Arc<McpContext>) -> Result<String, String> {
    let response = crate::commands::finances::request_board_support_internal(&ctx.state_manager)?;

    {
        use tauri::Emitter;
        let _ = ctx.app_handle.emit("game-state-changed", ());
    }

    Ok(format!("## Board Support\n\n**Amount**: {}\n**Transfer Budget Reduction**: {}\n**Satisfaction Penalty**: {}", response.result.support_amount, response.result.transfer_budget_reduction, response.result.satisfaction_penalty))
}

// ─── club_rebalance_budgets ─────────────────────────────────────────────────

pub fn club_rebalance_budgets(ctx: Arc<McpContext>, wage_budget: u64) -> Result<String, String> {
    let wage_budget =
        i64::try_from(wage_budget).map_err(|_| "be.error.budgetRebalanceOutOfRange".to_string())?;
    let game =
        crate::commands::finances::rebalance_budgets_internal(&ctx.state_manager, wage_budget)?;

    {
        use tauri::Emitter;
        let _ = ctx.app_handle.emit("game-state-changed", ());
    }

    let team = game
        .manager
        .team_id
        .as_deref()
        .and_then(|team_id| game.teams.iter().find(|team| team.id == team_id))
        .ok_or("be.error.managedTeamNotFound".to_string())?;
    Ok(format!(
        "## Budgets Rebalanced\n\n**Weekly Wage Budget**: {}\n**Transfer Budget**: {}",
        team.wage_budget, team.transfer_budget
    ))
}

// ─── club_request_marketing ─────────────────────────────────────────────────

// ─── club_request_marketing ─────────────────────────────────────────────────

pub fn club_request_marketing(ctx: Arc<McpContext>) -> Result<String, String> {
    let response =
        crate::commands::finances::request_marketing_campaign_internal(&ctx.state_manager)?;

    {
        use tauri::Emitter;
        let _ = ctx.app_handle.emit("game-state-changed", ());
    }

    Ok(format!(
        "## Marketing Campaign\n\n**Gross Revenue**: {}",
        response.result.gross_revenue
    ))
}

// ─── club_request_sponsor_pitch ─────────────────────────────────────────────

// ─── club_request_sponsor_pitch ─────────────────────────────────────────────

pub fn club_request_sponsor_pitch(ctx: Arc<McpContext>) -> Result<String, String> {
    let response = crate::commands::finances::request_sponsor_pitch_internal(&ctx.state_manager)?;

    {
        use tauri::Emitter;
        let _ = ctx.app_handle.emit("game-state-changed", ());
    }

    Ok(format!(
        "## Sponsor Pitch\n\n**Sponsor**: {}\n**Weekly Amount**: {}\n**Duration**: {} weeks",
        response.result.sponsor_name, response.result.weekly_amount, response.result.duration_weeks
    ))
}

// ─── scout_send ─────────────────────────────────────────────────────────────
