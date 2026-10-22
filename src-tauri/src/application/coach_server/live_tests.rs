//! The whole account flow against a real `ofm-server` and its Mailpit, for a developer to run by
//! hand: `ofm-server/server-run.sh` (api) and `server-run.sh worker` (sends the emails), then
//! `OFM_SERVER_URL=http://localhost:8080 cargo test --lib live_ -- --ignored`.
//! `OFM_MAILPIT_URL` defaults to Mailpit's local web port.

use std::sync::Arc;
use std::time::Duration;

use db::coach_store::CoachIdentity;
use domain::coach::CoachRegion;
use domain::league::FixtureCompetition;
use domain::team::PlayStyle;
use ofm_core::coach_progress::{CoachMatchRecord, CoachRecord};
use serde_json::Value;

use super::vault::MemoryVault;
use super::*;
use crate::application::coach::{self, CoachContext};

fn mailpit_url() -> String {
    std::env::var("OFM_MAILPIT_URL").unwrap_or_else(|_| "http://localhost:8025".to_string())
}

/// The code in the latest email of `subject_word` to `email`: the paragraph after the first.
fn emailed_code(email: &str, subject_word: &str) -> String {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(5)))
        .build()
        .into();
    for _ in 0..50 {
        let search = json_at(
            agent
                .get(format!("{}/api/v1/search", mailpit_url()))
                .query(
                    "query",
                    format!("to:\"{email}\" subject:\"{subject_word}\""),
                )
                .call(),
        );
        if let Some(id) = search["messages"][0]["ID"].as_str() {
            let message = json_at(
                agent
                    .get(format!("{}/api/v1/message/{id}", mailpit_url()))
                    .call(),
            );
            let text = message["Text"].as_str().expect("a text body");
            let text = text.replace("\r\n", "\n");
            return text
                .split("\n\n")
                .nth(1)
                .expect("a code paragraph")
                .trim()
                .to_string();
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    panic!("no email to {email} about {subject_word}");
}

fn json_at(response: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> Value {
    let text = response
        .expect("Mailpit answers")
        .body_mut()
        .read_to_string()
        .expect("a body");
    serde_json::from_str(&text).expect("JSON from Mailpit")
}

fn win(fixture: usize) -> CoachRecord {
    CoachRecord::Match(CoachMatchRecord {
        save_id: "live-save".into(),
        fixture_id: format!("live-fixture-{fixture}"),
        competition: FixtureCompetition::League,
        own_goals: 2,
        opponent_goals: 1,
        own_strength: 70.0,
        opponent_strength: 70.0,
        style: PlayStyle::Possession,
        earns_xp: true,
    })
}

/// Given a running server with its worker and Mailpit,
/// when a new coach registers, verifies, logs in, reports matches, forgets the password, resets it
/// and logs in again,
/// then each step succeeds, the server counts the matches, and the session resumes from the vault.
#[test]
#[ignore = "needs a running ofm-server (api + worker) and Mailpit"]
fn live_account_flow_against_the_local_server() {
    let url = configured_server_url().expect("OFM_SERVER_URL names the server");
    let dir = tempfile::tempdir().expect("a directory");
    let vault = MemoryVault::default();
    let kept = Arc::clone(&vault.0);
    let session = ServerSession::new(ApiClient::new(&url), Box::new(vault));
    let coach = CoachContext::with_server(dir.path(), Arc::new(session));
    let stamp = chrono::Utc::now().timestamp_millis();
    let email = format!("c1-live-{stamp}@example.test");
    let identity = CoachIdentity {
        first_name: "Live".into(),
        last_name: "Coach".into(),
        date_of_birth: "1985-03-04".into(),
        nationality: "VN".into(),
        region: CoachRegion::AsiaSoutheast,
    };
    let registration = CoachRegistration {
        email: email.clone(),
        password: "mot mat khau dai".into(),
        identity,
    };

    register_coach(&coach, registration).expect("registered");
    assert_eq!(
        login_coach(&coach, &email, "mot mat khau dai", "t"),
        Err("be.error.auth.emailNotVerified".to_string())
    );
    verify_coach_email(&coach, &emailed_code(&email, "Verify")).expect("verified");
    let account = login_coach(&coach, &email, "mot mat khau dai", "t").expect("logged in");

    let report = coach
        .progress_store()
        .report(&account, &[win(1), win(2)], 0)
        .expect("counted by the server");
    assert_eq!(report.progress.totals.matches, 2);
    assert_eq!(report.progress.totals.wins, 2);
    assert!(report.mastery_gain.is_some_and(|gain| gain.xp > 0));
    let view = coach::coach_progress_view(&coach, chrono::Utc::now().timestamp()).expect("view");
    assert_eq!(view.progress.totals.matches, 2);
    assert!(!view.is_offline);

    coach::logout_coach_account(&coach);
    assert_eq!(kept.lock().expect("vault").clone(), None);
    request_coach_password_reset(&coach, &email).expect("asked");
    reset_coach_password(
        &coach,
        &emailed_code(&email, "Reset"),
        "mot mat khau moi dai",
    )
    .expect("reset");
    assert_eq!(
        login_coach(&coach, &email, "mot mat khau dai", "t"),
        Err("be.error.auth.invalidCredentials".to_string())
    );
    login_coach(&coach, &email, "mot mat khau moi dai", "t").expect("logged in again");

    let restarted = ServerSession::new(
        ApiClient::new(&url),
        Box::new(MemoryVault(Arc::clone(&kept))),
    );
    let next_run = CoachContext::with_server(dir.path(), Arc::new(restarted));
    let resumed = resume_coach_session(&next_run, "t").expect("resumed");
    assert_eq!(resumed.map(|account| account.id), Some(account.id));
}

/// Given the operating system's keychain,
/// when a token is kept, read back, and cleared,
/// then it reads back as kept and is gone after the clear.
#[test]
#[ignore = "touches the real keychain of the machine"]
fn live_keychain_keeps_and_forgets_a_token() {
    let vault = KeyringVault::for_server("http://keychain-test.invalid");

    vault.store("a-refresh-token");
    let read = vault.load();
    vault.clear();

    assert_eq!(read.as_deref(), Some("a-refresh-token"));
    assert_eq!(vault.load(), None);
}
