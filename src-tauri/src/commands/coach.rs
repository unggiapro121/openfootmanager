//! The coach accounts, over IPC: the login screen and the account's progress.
//! Each command adapts one `application::coach` or `application::coach_server`
//! function. Those that reach the account server run off the webview thread.

use chrono::Utc;
use db::coach_store::CoachIdentity;
use domain::coach::CoachAccount;
use std::sync::Arc;
use tauri::State;

use super::time::run_off_thread;
use crate::application::coach::{self, CoachContext, CoachProgressView};
use crate::application::coach_server::{self, CoachAccountMode, CoachRegistration, DeletionView};

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
pub async fn logout_coach_account(coach: State<'_, Arc<CoachContext>>) -> Result<(), String> {
    let coach = coach.inner().clone();
    run_off_thread(move || {
        coach::logout_coach_account(&coach, Utc::now().timestamp());
        Ok(())
    })
    .await
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
pub async fn get_coach_progress(
    coach: State<'_, Arc<CoachContext>>,
) -> Result<CoachProgressView, String> {
    let coach = coach.inner().clone();
    run_off_thread(move || coach::coach_progress_view(&coach, Utc::now().timestamp())).await
}

/// Whether the login screen asks for email and password (server) or lists the
/// accounts on this machine (local).
#[tauri::command]
pub fn get_coach_account_mode(coach: State<'_, Arc<CoachContext>>) -> CoachAccountMode {
    coach_server::coach_account_mode(&coach)
}

#[tauri::command]
pub async fn register_coach_account(
    coach: State<'_, Arc<CoachContext>>,
    registration: CoachRegistration,
) -> Result<(), String> {
    let coach = coach.inner().clone();
    run_off_thread(move || coach_server::register_coach(&coach, registration)).await
}

#[tauri::command]
pub async fn verify_coach_email(
    coach: State<'_, Arc<CoachContext>>,
    code: String,
) -> Result<(), String> {
    let coach = coach.inner().clone();
    run_off_thread(move || coach_server::verify_coach_email(&coach, &code)).await
}

#[tauri::command]
pub async fn resend_coach_verification(
    coach: State<'_, Arc<CoachContext>>,
    email: String,
) -> Result<(), String> {
    let coach = coach.inner().clone();
    run_off_thread(move || coach_server::resend_coach_verification(&coach, &email)).await
}

#[tauri::command]
pub async fn login_coach_with_email(
    coach: State<'_, Arc<CoachContext>>,
    email: String,
    password: String,
) -> Result<CoachAccount, String> {
    let coach = coach.inner().clone();
    run_off_thread(move || {
        coach_server::login_coach(&coach, &email, &password, &Utc::now().to_rfc3339())
    })
    .await
}

/// Log back in with the session kept from the last run; `None` when the player
/// has to log in.
#[tauri::command]
pub async fn resume_coach_session(
    coach: State<'_, Arc<CoachContext>>,
) -> Result<Option<CoachAccount>, String> {
    let coach = coach.inner().clone();
    run_off_thread(move || coach_server::resume_coach_session(&coach, &Utc::now().to_rfc3339()))
        .await
}

#[tauri::command]
pub async fn request_coach_password_reset(
    coach: State<'_, Arc<CoachContext>>,
    email: String,
) -> Result<(), String> {
    let coach = coach.inner().clone();
    run_off_thread(move || coach_server::request_coach_password_reset(&coach, &email)).await
}

#[tauri::command]
pub async fn reset_coach_password(
    coach: State<'_, Arc<CoachContext>>,
    code: String,
    new_password: String,
) -> Result<(), String> {
    let coach = coach.inner().clone();
    run_off_thread(move || coach_server::reset_coach_password(&coach, &code, &new_password)).await
}

/// Ask for the playing account to be deleted (M3c1): the day it goes unless cancelled at login.
/// The webview's `idempotencyKey` is the same on a retry after no answer.
#[tauri::command]
pub async fn request_coach_account_deletion(
    coach: State<'_, Arc<CoachContext>>,
    password: String,
    idempotency_key: String,
) -> Result<DeletionView, String> {
    let coach = coach.inner().clone();
    run_off_thread(move || {
        coach_server::request_coach_account_deletion(
            &coach,
            &password,
            &idempotency_key,
            Utc::now().timestamp(),
        )
    })
    .await
}

/// Cancel the deletion of an account waiting for it, from the login screen (M3c1).
#[tauri::command]
pub async fn cancel_coach_account_deletion(
    coach: State<'_, Arc<CoachContext>>,
    email: String,
    password: String,
) -> Result<(), String> {
    let coach = coach.inner().clone();
    run_off_thread(move || coach_server::cancel_coach_account_deletion(&coach, &email, &password))
        .await
}
