//! Coach accounts on the account server (`ofm-server`, phase 3 package C-1): register, verify the
//! email with the code sent there, log in, reset a forgotten password, and keep the progress there
//! (`RemoteCoachProgressStore`). The game uses the server when `OFM_SERVER_URL` names one, at run
//! time or when it was built; without it, accounts stay on this machine as before.

mod client;
#[cfg(test)]
mod live_tests;
mod remote_store;
mod session;
#[cfg(test)]
mod test_server;
#[cfg(test)]
mod tests;
mod vault;

use db::coach_store::CoachIdentity;
use domain::coach::CoachAccount;
use serde::{Deserialize, Serialize};

pub use client::ApiClient;
pub use remote_store::RemoteCoachProgressStore;
pub use session::ServerSession;
pub use vault::{KeyringVault, RefreshTokenVault};

use super::coach::{validated_identity, CoachContext};
use session::RegisterRequest;

pub const SERVER_URL_ENV: &str = "OFM_SERVER_URL";
const NOT_ON_SERVER: &str = "be.error.coach.serverNotConfigured";

/// The account server to use: the run-time setting first, then the one the game was built with.
pub fn configured_server_url() -> Option<String> {
    std::env::var(SERVER_URL_ENV)
        .ok()
        .or_else(|| option_env!("OFM_SERVER_URL").map(str::to_string))
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
}

/// Where the login screen sends the player.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CoachAccountMode {
    /// Accounts on this machine: pick one or make one.
    Local,
    /// Accounts on the server: email and password.
    Server,
}

/// What the registration form sends.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct CoachRegistration {
    pub email: String,
    pub password: String,
    pub identity: CoachIdentity,
}

fn session(coach: &CoachContext) -> Result<&ServerSession, String> {
    coach
        .server_session()
        .ok_or_else(|| NOT_ON_SERVER.to_string())
}

pub fn coach_account_mode(coach: &CoachContext) -> CoachAccountMode {
    if coach.server_session().is_some() {
        CoachAccountMode::Server
    } else {
        CoachAccountMode::Local
    }
}

/// Make the account on the server; a code to verify its email is on its way there.
pub fn register_coach(coach: &CoachContext, registration: CoachRegistration) -> Result<(), String> {
    let session = session(coach)?;
    let identity = validated_identity(registration.identity)?;
    let request = RegisterRequest {
        email: registration.email.trim().to_string(),
        password: registration.password,
        first_name: identity.first_name,
        last_name: identity.last_name,
        date_of_birth: identity.date_of_birth,
        nationality: identity.nationality,
        region: identity.region,
    };
    session.register(&request).map_err(|error| error.key())
}

pub fn verify_coach_email(coach: &CoachContext, code: &str) -> Result<(), String> {
    session(coach)?
        .verify_email(code.trim())
        .map_err(|error| error.key())
}

pub fn resend_coach_verification(coach: &CoachContext, email: &str) -> Result<(), String> {
    session(coach)?
        .resend_verification(email.trim())
        .map_err(|error| error.key())
}

pub fn request_coach_password_reset(coach: &CoachContext, email: &str) -> Result<(), String> {
    session(coach)?
        .forgot_password(email.trim())
        .map_err(|error| error.key())
}

pub fn reset_coach_password(
    coach: &CoachContext,
    code: &str,
    new_password: &str,
) -> Result<(), String> {
    session(coach)?
        .reset_password(code.trim(), new_password)
        .map_err(|error| error.key())
}

/// Log in with email and password; the account becomes the one playing, and its progress is read
/// once so that it can be shown even if the server goes quiet later.
pub fn login_coach(
    coach: &CoachContext,
    email: &str,
    password: &str,
    now: &str,
) -> Result<CoachAccount, String> {
    let account = session(coach)?
        .login(email.trim(), password)
        .map_err(|error| error.key())?
        .into_coach_account(now);
    Ok(log_in(coach, account))
}

/// Log back in with the refresh token kept from the last run, if the server still takes it.
pub fn resume_coach_session(
    coach: &CoachContext,
    now: &str,
) -> Result<Option<CoachAccount>, String> {
    let Some(session) = coach.server_session() else {
        return Ok(None);
    };
    let account = session.resume().map_err(|error| error.key())?;
    Ok(account.map(|account| log_in(coach, account.into_coach_account(now))))
}

fn log_in(coach: &CoachContext, account: CoachAccount) -> CoachAccount {
    coach.set_active_account(Some(account.clone()));
    if let Err(error) = coach.progress_store().load(&account) {
        log::warn!("[coach-server] progress not read at login: {}", error.key());
    }
    account
}
