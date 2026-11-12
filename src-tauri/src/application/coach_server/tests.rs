//! Accounts and progress on the server, against a stand-in that answers as `ofm-server` does: the
//! token rules (Z3), the reports and their keys (Z12), the outage warning (Y12), and the accounts
//! on this machine giving way to the server's (Z7).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use db::coach_store::{CoachIdentity, CoachStore};
use domain::coach::{CoachProgress, CoachRegion};
use domain::league::FixtureCompetition;
use domain::team::PlayStyle;
use ofm_core::coach_progress::{CoachMatchRecord, CoachRecord};
use serde_json::{json, Value};

use super::client::ApiClient;
use super::test_server::{Recorded, TestServer};
use super::vault::MemoryVault;
use super::*;
use crate::application::coach::{self, CoachContext, CoachStoreError};

const LATER: &str = "2099-01-01T00:00:00Z";
/// After the real clock at login, before the clock a report is sent at (`REPORTED_AT`).
const SOON: &str = "2050-01-01T00:00:00Z";
/// 2096: past `SOON`.
const REPORTED_AT: i64 = 4_000_000_000;

fn account_json() -> Value {
    json!({
        "id": "0192f0c4-0000-7000-8000-000000000001",
        "email": "coach@example.test",
        "firstName": "Dung",
        "lastName": "Ung",
        "dateOfBirth": "1990-05-01",
        "nationality": "VN",
        "region": "AsiaSoutheast",
        "status": "active",
        "capabilities": []
    })
}

fn token_pair(access: &str, refresh: &str, access_expires_at: &str) -> Value {
    json!({
        "accessToken": access,
        "accessTokenExpiresAt": access_expires_at,
        "refreshToken": refresh,
        "refreshTokenExpiresAt": LATER,
        "account": account_json()
    })
}

fn progress_with_matches(matches: u32) -> Value {
    let mut progress = CoachProgress::default();
    progress.totals.matches = matches;
    serde_json::to_value(progress).expect("progress")
}

fn progress_response(matches: u32) -> Value {
    json!({
        "progress": progress_with_matches(matches),
        "allowance": {
            "regionDay": 1, "countedToday": 0, "dailyLimit": 50,
            "nextResetAt": "2026-10-22T21:00:00Z"
        }
    })
}

fn error(status: u16, code: &str) -> (u16, Value) {
    (status, json!({ "status": status, "code": code }))
}

fn bearer(request: &Recorded) -> Option<&str> {
    request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
}

/// A server that logs in with `access`/`refresh-1`, refreshes to `access-2`/`refresh-2`, reads
/// progress and counts each report's records into `matches`.
fn account_server(access_expires_at: &'static str) -> TestServer {
    let matches = Arc::new(AtomicUsize::new(0));
    TestServer::start(move |request| match request.path.as_str() {
        "/v1/auth/login" => (200, token_pair("access-1", "refresh-1", access_expires_at)),
        "/v1/auth/refresh" => (200, token_pair("access-2", "refresh-2", LATER)),
        "/v1/auth/logout" => (204, Value::Null),
        "/v1/coach/progress" => (
            200,
            progress_response(matches.load(Ordering::SeqCst) as u32),
        ),
        "/v1/coach/reports" => {
            let added = request.body["records"].as_array().map_or(0, Vec::len);
            let total = matches.fetch_add(added, Ordering::SeqCst) + added;
            (
                200,
                json!({
                    "progress": progress_with_matches(total as u32),
                    "masteryGain": { "style": "Counter", "xp": 15, "mastery_before": 0, "mastery_after": 1 }
                }),
            )
        }
        _ => error(404, "be.error.notFound"),
    })
}

struct Fixture {
    _dir: tempfile::TempDir,
    coach: CoachContext,
    vault: Arc<Mutex<Option<String>>>,
}

fn connect(url: &str) -> Fixture {
    connect_with(ApiClient::new(url), None)
}

fn connect_with(client: ApiClient, kept_refresh: Option<&str>) -> Fixture {
    let dir = tempfile::tempdir().expect("a directory");
    let vault = Arc::new(Mutex::new(kept_refresh.map(str::to_string)));
    let session = ServerSession::new(client, Box::new(MemoryVault(Arc::clone(&vault))));
    let coach = CoachContext::with_server(dir.path(), Arc::new(session));
    Fixture {
        _dir: dir,
        coach,
        vault,
    }
}

fn kept(fixture: &Fixture) -> Option<String> {
    fixture.vault.lock().expect("vault").clone()
}

fn win(fixture: usize) -> CoachRecord {
    CoachRecord::Match(CoachMatchRecord {
        save_id: "save-1".into(),
        fixture_id: format!("fixture-{fixture}"),
        competition: FixtureCompetition::League,
        own_goals: 1,
        opponent_goals: 0,
        own_strength: 70.0,
        opponent_strength: 70.0,
        style: PlayStyle::Counter,
        earns_xp: true,
    })
}

fn identity() -> CoachIdentity {
    CoachIdentity {
        first_name: " Dung ".to_string(),
        last_name: "Ung".to_string(),
        date_of_birth: "1990-05-01".to_string(),
        nationality: "VN".to_string(),
        region: CoachRegion::Europe,
    }
}

fn logged_in(server: &TestServer) -> Fixture {
    let fixture = connect(&server.url);
    login_coach(
        &fixture.coach,
        "coach@example.test",
        "mot mat khau dai",
        "t1",
    )
    .expect("login");
    fixture
}

/// Given a server that knows the account,
/// when the player logs in with email and password,
/// then the account plays, the refresh token is kept in the vault, and its progress is read once
/// with the access token.
#[test]
fn logging_in_keeps_the_session_and_reads_the_progress() {
    let server = account_server(LATER);
    let fixture = connect(&server.url);

    let account = login_coach(
        &fixture.coach,
        " coach@example.test ",
        "mot mat khau dai",
        "t1",
    )
    .expect("login");

    assert_eq!(account.id, "0192f0c4-0000-7000-8000-000000000001");
    assert_eq!(account.region, CoachRegion::AsiaSoutheast);
    assert_eq!(fixture.coach.active_account(), Some(account));
    assert_eq!(kept(&fixture).as_deref(), Some("refresh-1"));
    let requests = server.requests();
    assert_eq!(
        requests[0].body["email"], "coach@example.test",
        "the email is trimmed"
    );
    assert_eq!(
        (requests[0].method.as_str(), requests[1].method.as_str()),
        ("POST", "GET")
    );
    assert_eq!(requests[1].path, "/v1/coach/progress");
    assert_eq!(bearer(&requests[1]), Some("access-1"));
}

/// Given a logged-in account,
/// when two matches are reported,
/// then they go to the server with the access token and an idempotency key, the body carries the
/// records alone (no client clock), and the server's progress and gain come back.
#[test]
fn a_report_is_counted_by_the_server() {
    let server = account_server(LATER);
    let fixture = logged_in(&server);
    let account = fixture.coach.active_account().expect("logged in");

    let report = fixture
        .coach
        .progress_store()
        .report(&account, &[win(1), win(2)], 0)
        .expect("counted");

    assert_eq!(report.progress.totals.matches, 2);
    assert_eq!(report.mastery_gain.map(|gain| gain.xp), Some(15));
    let sent = server.requests().pop().expect("a report");
    assert_eq!(sent.path, "/v1/coach/reports");
    assert_eq!(bearer(&sent), Some("access-1"));
    assert!(sent
        .headers
        .get("idempotency-key")
        .is_some_and(|key| key.len() > 16));
    assert_eq!(
        sent.body.as_object().map(|body| body.len()),
        Some(1),
        "only records"
    );
    assert_eq!(sent.body["records"][0]["Match"]["fixture_id"], "fixture-1");
    assert!(fixture.coach.progress_store().is_reachable());
}

/// Given 150 records waiting after a long advance,
/// when they are reported,
/// then they go in two parts of at most 100, each under its own key, and all are counted.
#[test]
fn a_long_report_is_sent_in_parts() {
    let server = account_server(LATER);
    let fixture = logged_in(&server);
    let account = fixture.coach.active_account().expect("logged in");
    let records: Vec<CoachRecord> = (0..150).map(win).collect();

    let report = fixture
        .coach
        .progress_store()
        .report(&account, &records, 0)
        .expect("counted");

    assert_eq!(report.progress.totals.matches, 150);
    let parts: Vec<Recorded> = server
        .requests()
        .into_iter()
        .filter(|request| request.path == "/v1/coach/reports")
        .collect();
    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0].body["records"].as_array().map(Vec::len), Some(100));
    assert_ne!(
        parts[0].headers["idempotency-key"],
        parts[1].headers["idempotency-key"]
    );
}

/// Given an access token that has expired,
/// when a match is reported,
/// then the session refreshes first, keeps the rotated refresh token, and reports with the new
/// access token.
#[test]
fn an_expired_access_token_is_refreshed_first() {
    let server = account_server(SOON);
    let fixture = connect(&server.url);
    let account = fixture_login(&fixture);

    fixture
        .coach
        .progress_store()
        .report(&account, &[win(1)], REPORTED_AT)
        .expect("counted");

    let paths = server.paths();
    let refresh = paths.iter().position(|path| path == "/v1/auth/refresh");
    let report = paths.iter().position(|path| path == "/v1/coach/reports");
    assert!(refresh.is_some() && refresh < report, "{paths:?}");
    assert_eq!(
        server.requests()[refresh.unwrap_or(0)].body["refreshToken"],
        "refresh-1"
    );
    assert_eq!(
        bearer(&server.requests().pop().expect("report")),
        Some("access-2")
    );
    assert_eq!(kept(&fixture).as_deref(), Some("refresh-2"));
}

fn fixture_login(fixture: &Fixture) -> domain::coach::CoachAccount {
    login_coach(
        &fixture.coach,
        "coach@example.test",
        "mot mat khau dai",
        "t1",
    )
    .expect("login")
}

/// Given a server that refuses the first access token on a report,
/// when a match is reported,
/// then the session refreshes once and the report goes through with the new token.
#[test]
fn a_refused_access_token_is_refreshed_once() {
    let server = TestServer::start(|request| match (request.path.as_str(), bearer(request)) {
        ("/v1/auth/login", _) => (200, token_pair("access-1", "refresh-1", LATER)),
        ("/v1/auth/refresh", _) => (200, token_pair("access-2", "refresh-2", LATER)),
        ("/v1/coach/progress", _) => (200, progress_response(0)),
        ("/v1/coach/reports", Some("access-1")) => error(401, "be.error.auth.unauthorized"),
        ("/v1/coach/reports", _) => (
            200,
            json!({ "progress": progress_with_matches(1), "masteryGain": null }),
        ),
        _ => error(404, "be.error.notFound"),
    });
    let fixture = connect(&server.url);
    let account = fixture_login(&fixture);

    let report = fixture
        .coach
        .progress_store()
        .report(&account, &[win(1)], 0);

    assert_eq!(report.map(|report| report.progress.totals.matches), Ok(1));
    let reports = server
        .requests()
        .into_iter()
        .filter(|request| request.path == "/v1/coach/reports")
        .count();
    assert_eq!(reports, 2);
}

/// Given a session whose refresh token the server no longer takes,
/// when a match is reported with an expired access token,
/// then the report fails with the server's key, not as an outage, and the vault is emptied.
#[test]
fn a_refused_refresh_token_ends_the_session() {
    let server = TestServer::start(|request| match request.path.as_str() {
        "/v1/auth/login" => (200, token_pair("access-1", "refresh-1", SOON)),
        "/v1/auth/refresh" => error(401, "be.error.auth.refreshInvalid"),
        _ => error(404, "be.error.notFound"),
    });
    let fixture = connect(&server.url);
    let account = fixture_login(&fixture);

    let error = fixture
        .coach
        .progress_store()
        .report(&account, &[win(1)], REPORTED_AT)
        .expect_err("refused");

    assert_eq!(
        error,
        CoachStoreError::Failed("be.error.auth.refreshInvalid".into())
    );
    assert_eq!(kept(&fixture), None);
    assert!(fixture.coach.progress_store().is_reachable());
}

/// Given a logged-in account whose progress was read, and then a server in outage (503),
/// when a match is reported and the progress read again,
/// then the report fails as unreachable, the warning shows, and the last confirmed progress is
/// what the player sees.
#[test]
fn an_outage_warns_and_keeps_the_last_progress() {
    let down = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let is_down = Arc::clone(&down);
    let server = TestServer::start(move |request| {
        if is_down.load(Ordering::SeqCst) {
            return error(503, "be.error.unavailable");
        }
        match request.path.as_str() {
            "/v1/auth/login" => (200, token_pair("access-1", "refresh-1", LATER)),
            "/v1/coach/progress" => (200, progress_response(7)),
            _ => error(404, "be.error.notFound"),
        }
    });
    let fixture = connect(&server.url);
    let account = fixture_login(&fixture);
    down.store(true, Ordering::SeqCst);

    let error = fixture
        .coach
        .progress_store()
        .report(&account, &[win(1)], 0)
        .expect_err("down");
    let view = coach::coach_progress_view(&fixture.coach, 0).expect("view");

    assert_eq!(error, CoachStoreError::Unreachable);
    assert!(view.is_offline);
    assert_eq!(view.progress.totals.matches, 7);
}

/// Given a server that answers the first report only after the client stopped waiting,
/// when a match is reported,
/// then it is sent once more under the same key, which the server counts once (Z12).
#[test]
fn an_unanswered_report_is_sent_again_under_the_same_key() {
    let reports = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&reports);
    let server = TestServer::start(move |request| match request.path.as_str() {
        "/v1/auth/login" => (200, token_pair("access-1", "refresh-1", LATER)),
        "/v1/coach/progress" => (200, progress_response(0)),
        "/v1/coach/reports" => {
            if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                std::thread::sleep(Duration::from_millis(600));
            }
            (
                200,
                json!({ "progress": progress_with_matches(1), "masteryGain": null }),
            )
        }
        _ => error(404, "be.error.notFound"),
    });
    let fixture = connect_with(
        ApiClient::with_timeout(&server.url, Duration::from_millis(300)),
        None,
    );
    let account = fixture_login(&fixture);

    let report = fixture
        .coach
        .progress_store()
        .report(&account, &[win(1)], 0);

    assert_eq!(report.map(|report| report.progress.totals.matches), Ok(1));
    let keys: Vec<String> = server
        .requests()
        .into_iter()
        .filter(|request| request.path == "/v1/coach/reports")
        .map(|request| request.headers["idempotency-key"].clone())
        .collect();
    assert_eq!(keys.len(), 2);
    assert_eq!(keys[0], keys[1]);
}

/// Given nothing listening at the server's address,
/// when the player logs in,
/// then the login fails with the offline key.
#[test]
fn no_server_means_offline() {
    let address = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .expect("a free port");
    let fixture = connect(&format!("http://{address}"));

    let error = fixture_login_error(&fixture);

    assert_eq!(error, "be.error.coach.offline");
}

fn fixture_login_error(fixture: &Fixture) -> String {
    login_coach(&fixture.coach, "coach@example.test", "wrong password", "t1").expect_err("refused")
}

/// Given a server that refuses the login (wrong password, then an unverified email, then a body
/// that is not its envelope),
/// when the player logs in,
/// then each error is the server's translation key, or the unexpected-answer key.
#[test]
fn a_refused_login_returns_the_servers_key() {
    let answers = Arc::new(Mutex::new(vec![
        (500, json!("not an envelope")),
        error(403, "be.error.auth.emailNotVerified"),
        error(401, "be.error.auth.invalidCredentials"),
    ]));
    let server =
        TestServer::start(move |_| answers.lock().expect("answers").pop().expect("an answer"));
    let fixture = connect(&server.url);

    assert_eq!(
        fixture_login_error(&fixture),
        "be.error.auth.invalidCredentials"
    );
    assert_eq!(
        fixture_login_error(&fixture),
        "be.error.auth.emailNotVerified"
    );
    assert_eq!(
        fixture_login_error(&fixture),
        "be.error.coach.serverUnexpected"
    );
    assert_eq!(fixture.coach.active_account(), None);
}

/// Given the registration form filled in,
/// when it is sent,
/// then the server gets the camelCase request with the identity trimmed; a nameless identity is
/// refused before anything is sent.
#[test]
fn registering_sends_the_account_to_the_server() {
    let server = TestServer::start(|_| {
        (
            201,
            json!({ "accountId": "0192f0c4-0000-7000-8000-000000000001" }),
        )
    });
    let fixture = connect(&server.url);
    let registration = CoachRegistration {
        email: " coach@example.test".into(),
        password: "mot mat khau dai".into(),
        identity: identity(),
    };

    register_coach(&fixture.coach, registration.clone()).expect("registered");
    let nameless = CoachRegistration {
        identity: CoachIdentity {
            first_name: " ".into(),
            ..identity()
        },
        ..registration
    };

    assert_eq!(
        register_coach(&fixture.coach, nameless).unwrap_err(),
        "be.error.createManager.nameRequired"
    );
    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].path, "/v1/auth/register");
    assert_eq!(
        requests[0].body,
        json!({
            "email": "coach@example.test",
            "password": "mot mat khau dai",
            "firstName": "Dung",
            "lastName": "Ung",
            "dateOfBirth": "1990-05-01",
            "nationality": "VN",
            "region": "Europe"
        })
    );
}

/// Given a code from the verification email, and one from the password reset email,
/// when each is entered, and fresh codes asked for,
/// then each goes to its route with the trimmed code or email.
#[test]
fn codes_and_emails_reach_their_routes() {
    let server = TestServer::start(|request| match request.path.as_str() {
        "/v1/auth/reset-password" => (204, Value::Null),
        _ => (202, json!({ "status": "accepted" })),
    });
    let fixture = connect(&server.url);

    verify_coach_email(&fixture.coach, " ABC123 ").expect("verified");
    resend_coach_verification(&fixture.coach, "coach@example.test ").expect("resent");
    request_coach_password_reset(&fixture.coach, "coach@example.test").expect("asked");
    reset_coach_password(&fixture.coach, "XYZ789", "mot mat khau moi dai").expect("reset");

    let sent: Vec<(String, Value)> = server
        .requests()
        .into_iter()
        .map(|request| (request.path, request.body))
        .collect();
    assert_eq!(
        sent,
        vec![
            (
                "/v1/auth/verify-email".to_string(),
                json!({ "token": "ABC123" })
            ),
            (
                "/v1/auth/resend-verification".to_string(),
                json!({ "email": "coach@example.test" })
            ),
            (
                "/v1/auth/forgot-password".to_string(),
                json!({ "email": "coach@example.test" })
            ),
            (
                "/v1/auth/reset-password".to_string(),
                json!({ "token": "XYZ789", "newPassword": "mot mat khau moi dai" })
            ),
        ]
    );
}

/// Given a refresh token kept from the last run,
/// when the game starts and resumes the session,
/// then the account plays without a login and the rotated token is kept.
#[test]
fn a_kept_refresh_token_resumes_the_session() {
    let server = account_server(LATER);
    let fixture = connect_with(ApiClient::new(&server.url), Some("refresh-1"));

    let account = resume_coach_session(&fixture.coach, "t2").expect("resumed");

    assert_eq!(
        account.as_ref().map(|account| account.first_name.as_str()),
        Some("Dung")
    );
    assert_eq!(fixture.coach.active_account(), account);
    assert_eq!(kept(&fixture).as_deref(), Some("refresh-2"));
}

/// Given no kept token, and then a kept token the server refuses,
/// when the session is resumed,
/// then nobody is logged in and the refused token is forgotten.
#[test]
fn without_a_valid_kept_token_the_player_logs_in() {
    let server = TestServer::start(|_| error(401, "be.error.auth.refreshInvalid"));
    let empty = connect(&server.url);
    let stale = connect_with(ApiClient::new(&server.url), Some("stale"));

    assert_eq!(resume_coach_session(&empty.coach, "t"), Ok(None));
    assert!(
        server.requests().is_empty(),
        "nothing to send without a token"
    );
    assert_eq!(resume_coach_session(&stale.coach, "t"), Ok(None));
    assert_eq!(kept(&stale), None);
    assert_eq!(stale.coach.active_account(), None);
}

/// Given a logged-in account,
/// when the player logs out,
/// then the refresh token is revoked on the server and forgotten here, and nobody plays.
#[test]
fn logging_out_ends_the_session_on_the_server() {
    let server = account_server(LATER);
    let fixture = logged_in(&server);

    coach::logout_coach_account(&fixture.coach, REPORTED_AT);

    let last = server.requests().pop().expect("a logout");
    assert_eq!(last.path, "/v1/auth/logout");
    assert_eq!(
        bearer(&last),
        Some("access-1"),
        "the server revokes only for its account"
    );
    assert_eq!(last.body, json!({ "refreshToken": "refresh-1" }));
    assert_eq!(kept(&fixture), None);
    assert_eq!(fixture.coach.active_account(), None);
}

/// Given accounts made on this machine,
/// when the game starts with the server,
/// then they are deleted (Z7) and the screens for local accounts are refused.
#[test]
fn the_server_replaces_the_accounts_on_this_machine() {
    let dir = tempfile::tempdir().expect("a directory");
    let local = CoachStore::new(dir.path().join("coach"));
    let made = local.create(identity(), "t0").expect("a local account");
    let server = account_server(LATER);
    let session = ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(MemoryVault::default()),
    );

    let coach = CoachContext::with_server(dir.path(), Arc::new(session));

    assert!(!dir.path().join("coach").exists());
    assert_eq!(coach_account_mode(&coach), CoachAccountMode::Server);
    let refused = "be.error.coach.managedByServer".to_string();
    assert_eq!(coach::list_coach_accounts(&coach), Err(refused.clone()));
    assert_eq!(
        coach::create_coach_account(&coach, identity(), "t"),
        Err(refused.clone())
    );
    assert_eq!(
        coach::login_coach_account(&coach, &made.id, "t"),
        Err(refused.clone())
    );
    assert_eq!(coach::delete_coach_account(&coach, &made.id), Err(refused));
}

/// Given the accounts on this machine,
/// when the server flows are called,
/// then the mode is local and each says no server is configured.
#[test]
fn without_a_server_the_flows_are_refused() {
    let (_dir, coach, _) = coach::logged_in_test_coach(false);

    assert_eq!(coach_account_mode(&coach), CoachAccountMode::Local);
    assert_eq!(
        verify_coach_email(&coach, "code"),
        Err("be.error.coach.serverNotConfigured".to_string())
    );
    assert_eq!(resume_coach_session(&coach, "t"), Ok(None));
}
