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

use super::vault::{KeyringVault, MemoryVault};
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

/// Given a running `ofm-server` with its world, and a new coach logged in,
/// when the online proxy takes a club, reads the club, the season and the league at once, and
/// sets the training plan twice under one key,
/// then every answer names contract revision 1, the club is the coach's, and the retried plan
/// gets the first answer back (phase 3 E3-6c).
#[test]
#[ignore = "needs a running ofm-server (api + worker), its world, and Mailpit"]
fn live_online_proxy_against_the_local_server() {
    use crate::application::online::{send, OnlineRequest};

    let url = configured_server_url().expect("OFM_SERVER_URL names the server");
    let dir = tempfile::tempdir().expect("a directory");
    let session = Arc::new(ServerSession::new(
        ApiClient::new(&url),
        Box::new(MemoryVault::default()),
    ));
    let coach = CoachContext::with_server(dir.path(), Arc::clone(&session));
    let email = format!(
        "e36c-live-{}@example.test",
        chrono::Utc::now().timestamp_millis()
    );
    let registration = CoachRegistration {
        email: email.clone(),
        password: "mot mat khau dai".into(),
        identity: CoachIdentity {
            first_name: "Online".into(),
            last_name: "Coach".into(),
            date_of_birth: "1988-08-08".into(),
            nationality: "VN".into(),
            region: CoachRegion::AsiaSoutheast,
        },
    };
    register_coach(&coach, registration).expect("registered");
    verify_coach_email(&coach, &emailed_code(&email, "Verify")).expect("verified");
    login_coach(&coach, &email, "mot mat khau dai", "t").expect("logged in");

    let request =
        |method: &str, segments: &[&str], key: Option<&str>, body: Option<Value>| OnlineRequest {
            method: method.to_string(),
            segments: segments.iter().map(|s| s.to_string()).collect(),
            query: Vec::new(),
            body,
            if_match: None,
            idempotency_key: key.map(str::to_string),
        };
    let now = chrono::Utc::now().timestamp();
    let taken = send(
        &session,
        &request(
            "POST",
            &["v1", "clubs", "takeover"],
            Some("live-takeover"),
            None,
        ),
        now,
    )
    .expect("a club taken");
    assert_eq!(taken.contract_revision, Some(1));
    std::thread::sleep(Duration::from_secs(3)); // the worker makes the fresh squad

    let reads: Vec<_> = [
        vec!["v1", "clubs", "mine"],
        vec!["v1", "season"],
        vec!["v1", "leagues", "mine"],
    ]
    .into_iter()
    .map(|segments| {
        let session = Arc::clone(&session);
        let read = request("GET", &segments, None, None);
        std::thread::spawn(move || send(&session, &read, now))
    })
    .collect();
    let answers: Vec<_> = reads
        .into_iter()
        .map(|read| read.join().expect("a read"))
        .collect();
    let club = answers[0].as_ref().expect("the coach's club");
    assert_eq!(club.body["club"]["id"], taken.body["club"]["id"]);
    for answer in &answers {
        // The season and the league may not exist yet (404); every answer still names revision 1.
        let revision = match answer {
            Ok(answer) => answer.contract_revision,
            Err(error) => error.contract_revision,
        };
        assert_eq!(revision, Some(1), "{answer:?}");
    }

    let plan =
        serde_json::json!({"focus": "Physical", "intensity": "Medium", "schedule": "Balanced"});
    let set = request(
        "PUT",
        &["v1", "clubs", "mine", "training"],
        Some("live-plan"),
        Some(plan),
    );
    let first = send(&session, &set, now).expect("the plan is set");
    let again = send(&session, &set, now).expect("the retry is answered");
    assert_eq!(again.body, first.body);
    eprintln!(
        "live online proxy: club {} taken ({}), plan kept",
        taken.body["club"]["name"], taken.body["kind"]
    );
}

/// Given a running `ofm-server` with its gateway (`server-run.sh gateway`), Mailpit, and a
/// match it has played (`ofm-server schedule-test-matches`, its id in `OFM_LIVE_MATCH_ID`),
/// when a fresh coach reads the match through the proxy and follows it from kick-off through the
/// realtime client (`OFM_REALTIME_URL`, `ws://localhost:8090/v1/realtime` locally), and sends an
/// order for it,
/// then the view names its last step, the client hands over every frame from 1 to that step once
/// and in order, and the order reaches the server, which refuses it for a match of no fixture
/// (404) — the routes and the gateway of S-8 end to end. Run:
/// `OFM_SERVER_URL=http://localhost:8080 OFM_REALTIME_URL=ws://localhost:8090/v1/realtime
/// OFM_LIVE_MATCH_ID=<id> cargo test --lib live_realtime -- --ignored --nocapture`.
#[test]
#[ignore = "needs a running ofm-server (api, worker, gateway), a played match, and Mailpit"]
fn live_realtime_against_the_local_server() {
    use crate::application::online::{send, OnlineRequest};
    use crate::application::realtime::{
        configured_realtime_url, Realtime, RealtimeMessage, Settings, TokenSource,
    };

    let url = configured_server_url().expect("OFM_SERVER_URL names the server");
    let match_id = std::env::var("OFM_LIVE_MATCH_ID").expect("OFM_LIVE_MATCH_ID names a match");
    let dir = tempfile::tempdir().expect("a directory");
    let session = Arc::new(ServerSession::new(
        ApiClient::new(&url),
        Box::new(MemoryVault::default()),
    ));
    let coach = Arc::new(CoachContext::with_server(dir.path(), Arc::clone(&session)));
    let email = format!(
        "s8e-live-{}@example.test",
        chrono::Utc::now().timestamp_millis()
    );
    let registration = CoachRegistration {
        email: email.clone(),
        password: "mot mat khau dai".into(),
        identity: CoachIdentity {
            first_name: "Live".into(),
            last_name: "Watcher".into(),
            date_of_birth: "1988-08-08".into(),
            nationality: "VN".into(),
            region: CoachRegion::AsiaSoutheast,
        },
    };
    register_coach(&coach, registration).expect("registered");
    verify_coach_email(&coach, &emailed_code(&email, "Verify")).expect("verified");
    login_coach(&coach, &email, "mot mat khau dai", "t").expect("logged in");
    let request =
        |method: &str, segments: &[&str], key: Option<&str>, body: Option<Value>| OnlineRequest {
            method: method.to_string(),
            segments: segments.iter().map(|s| s.to_string()).collect(),
            query: Vec::new(),
            body,
            if_match: None,
            idempotency_key: key.map(str::to_string),
        };
    let now = chrono::Utc::now().timestamp();

    let view = send(
        &session,
        &request("GET", &["v1", "matches", &match_id], None, None),
        now,
    )
    .expect("the match");
    let last = u32::try_from(view.body["lastSeq"].as_u64().expect("a last step")).expect("a step");
    assert!(
        last > 0,
        "the match has been played: {}",
        view.body["status"]
    );

    let realtime = Arc::new(Realtime::new(
        configured_realtime_url(),
        Arc::clone(&coach) as Arc<dyn TokenSource>,
        Settings::default(),
    ));
    let (tx, rx) = std::sync::mpsc::channel();
    let watch = realtime
        .watch(
            &format!("match:{match_id}"),
            Some(0),
            Arc::new(move |message| {
                let _ = tx.send(message);
            }),
        )
        .expect("a watch");
    let mut seqs = Vec::new();
    while seqs.last().copied() != Some(last) {
        match rx
            .recv_timeout(Duration::from_secs(10))
            .expect("a message in time")
        {
            RealtimeMessage::Frame { seq, .. } => seqs.push(seq),
            RealtimeMessage::Status { state, code } => eprintln!("realtime: {state:?} {code:?}"),
            other => panic!("{other:?}"),
        }
    }
    realtime.unwatch(watch);
    assert_eq!(seqs, (1..=last).collect::<Vec<_>>());

    let order =
        serde_json::json!({"command": {"ChangeFormation": {"side": "Home", "formation": "4-3-3"}}});
    let refused = send(
        &session,
        &request(
            "POST",
            &["v1", "matches", &match_id, "commands"],
            Some("s8e-live-order"),
            Some(order),
        ),
        now,
    )
    .expect_err("a match of no fixture takes no order");
    assert_eq!(
        (refused.status, refused.code.as_str()),
        (404, "be.error.notFound")
    );
    eprintln!("live realtime: {last} frames of match {match_id}, in order, once");
}
