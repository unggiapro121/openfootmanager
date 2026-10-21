//! The coach accounts, over IPC: the login screen and the account's progress.
//! Each command adapts one `application::coach` function.

use chrono::Utc;
use db::coach_store::CoachIdentity;
use domain::coach::CoachAccount;
use std::sync::Arc;
use tauri::State;

use crate::application::coach::{self, CoachContext, CoachProgressView};

#[tauri::command]
pub fn list_coach_accounts(
    coach: State<'_, Arc<CoachContext>>,
) -> Result<Vec<CoachAccount>, String> {
    coach::list_coach_accounts(&coach)
}

#[tauri::command]
pub fn create_coach_account(
    coach: State<'_, Arc<CoachContext>>,
    identity: CoachIdentity,
) -> Result<CoachAccount, String> {
    coach::create_coach_account(&coach, identity, &Utc::now().to_rfc3339())
}

#[tauri::command]
pub fn login_coach_account(
    coach: State<'_, Arc<CoachContext>>,
    id: String,
) -> Result<CoachAccount, String> {
    coach::login_coach_account(&coach, &id, &Utc::now().to_rfc3339())
}

#[tauri::command]
pub fn logout_coach_account(coach: State<'_, Arc<CoachContext>>) {
    coach::logout_coach_account(&coach);
}

#[tauri::command]
pub fn get_active_coach_account(coach: State<'_, Arc<CoachContext>>) -> Option<CoachAccount> {
    coach.active_account()
}

#[tauri::command]
pub fn update_coach_account(
    coach: State<'_, Arc<CoachContext>>,
    id: String,
    identity: CoachIdentity,
) -> Result<CoachAccount, String> {
    coach::update_coach_account(&coach, &id, identity)
}

#[tauri::command]
pub fn delete_coach_account(
    coach: State<'_, Arc<CoachContext>>,
    id: String,
) -> Result<bool, String> {
    coach::delete_coach_account(&coach, &id)
}

#[tauri::command]
pub fn get_coach_progress(
    coach: State<'_, Arc<CoachContext>>,
) -> Result<CoachProgressView, String> {
    coach::coach_progress_view(&coach, Utc::now().timestamp())
}
