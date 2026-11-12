//! Deleting the account from the game (M3c1, m3-tech-spec §5.1, §5.2): the request goes through the
//! session, which forgets the token on this machine; a request with no answer is sent again with the
//! same key and the same token; an account waiting to be deleted is told when at login, and can be
//! cancelled by email and password.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::client::ApiClient;
use super::test_server::{Recorded, TestServer};
use super::vault::{FileVault, MemoryVault};
use super::*;
use crate::application::coach::CoachContext;

const LATER: &str = "2099-01-01T00:00:00Z";
const DELETE_AT: &str = "2026-11-19T10:00:00Z";
const PASSWORD: &str = "mot mat khau dai";

fn token_pair(access: &str, refresh: &str) -> Value {
    json!({
        "accessToken": access,
        "accessTokenExpiresAt": LATER,
        "refreshToken": refresh,
        "refreshTokenExpiresAt": LATER,
        "account": {
            "id": "0192f0c4-0000-7000-8000-000000000001",
            "email": "coach@example.test",
            "firstName": "Dung",
            "lastName": "Ung",
            "dateOfBirth": "1990-05-01",
            "nationality": "VN",
            "region": "AsiaSoutheast",
            "status": "active",
            "capabilities": []
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

fn key(request: &Recorded) -> Option<&str> {
    request.headers.get("idempotency-key").map(String::as_str)
}

fn progress() -> Value {
    json!({
        "progress": serde_json::to_value(domain::coach::CoachProgress::default()).expect("progress"),
        "allowance": {
            "regionDay": 1, "countedToday": 0, "dailyLimit": 50,
            "nextResetAt": "2026-10-22T21:00:00Z"
        }
    })
}

/// A server that logs in, reads progress, and answers the deletion with `deletion`.
fn server(deletion: impl Fn(&Recorded) -> (u16, Value) + Send + Sync + 'static) -> TestServer {
    TestServer::start(move |request| match request.path.as_str() {
        "/v1/auth/login" => (200, token_pair("access-1", "refresh-1")),
        "/v1/auth/refresh" => (200, token_pair("access-2", "refresh-2")),
        "/v1/auth/logout" => (204, Value::Null),
        "/v1/coach/progress" => (200, progress()),
        "/v1/me/deletion" => deletion(request),
        _ => error(404, "be.error.notFound"),
    })
}

struct Fixture {
    _dir: tempfile::TempDir,
    coach: CoachContext,
    vault: Arc<Mutex<Option<String>>>,
}

fn logged_in(server: &TestServer) -> Fixture {
    let dir = tempfile::tempdir().expect("a directory");
    let vault = Arc::new(Mutex::new(None));
    let session = ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(MemoryVault(Arc::clone(&vault))),
    );
    let coach = CoachContext::with_server(dir.path(), Arc::new(session));
    login_coach(&coach, "coach@example.test", PASSWORD, "t1").expect("login");
    Fixture {
        _dir: dir,
        coach,
        vault,
    }
}

fn kept(fixture: &Fixture) -> Option<String> {
    fixture.vault.lock().expect("vault").clone()
}

fn deletions(server: &TestServer) -> Vec<Recorded> {
    server
        .requests()
        .into_iter()
        .filter(|request| request.path == "/v1/me/deletion")
        .collect()
}

/// Given a logged-in coach,
/// when he asks for his account to be deleted with his password,
/// then the request carries his token, a key and the password; the day of deletion comes back;
/// the token is forgotten here and nobody plays; the server is not asked to log out (it already
/// revoked every token).
#[test]
fn a_deletion_forgets_the_session_here() {
    let server = server(|_| (202, json!({ "deleteAt": DELETE_AT })));
    let fixture = logged_in(&server);

    let view = request_coach_account_deletion(&fixture.coach, PASSWORD, "key-1", 0).expect("asked");

    assert_eq!(view.delete_at, DELETE_AT);
    let sent = deletions(&server);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].method, "POST");
    assert_eq!(bearer(&sent[0]), Some("access-1"));
    assert_eq!(key(&sent[0]), Some("key-1"));
    assert_eq!(sent[0].body, json!({ "password": PASSWORD }));
    assert_eq!(kept(&fixture), None, "the refresh token is gone");
    assert_eq!(fixture.coach.active_account(), None, "nobody plays");
    assert!(!server.paths().contains(&"/v1/auth/logout".to_string()));
    // The session is over: a later call has no token to send.
    let after = request_coach_account_deletion(&fixture.coach, PASSWORD, "key-2", 0);
    assert_eq!(after.err().as_deref(), Some("be.error.coach.notLoggedIn"));
}

/// Given a deletion whose answer never came back (the server may have done it),
/// when the coach sends it again with the same key,
/// then it goes with the same key and the same token as the first, though the token has run out
/// meanwhile; the server's stored answer is taken.
#[test]
fn a_deletion_with_no_answer_is_sent_again_with_the_same_key_and_token() {
    let tries = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&tries);
    let server = server(move |_| {
        if counted.fetch_add(1, Ordering::SeqCst) == 0 {
            (0, Value::Null)
        } else {
            (202, json!({ "deleteAt": DELETE_AT }))
        }
    });
    let fixture = logged_in(&server);

    let first = request_coach_account_deletion(&fixture.coach, PASSWORD, "key-1", 0);
    assert_eq!(first.err().as_deref(), Some("be.error.coach.offline"));
    assert_eq!(
        kept(&fixture).as_deref(),
        Some("refresh-1"),
        "still logged in"
    );

    // Past the access token's end: a fresh request would refresh first, a retry must not.
    let view = request_coach_account_deletion(&fixture.coach, PASSWORD, "key-1", i64::MAX / 2)
        .expect("the stored answer");

    assert_eq!(view.delete_at, DELETE_AT);
    let sent = deletions(&server);
    assert_eq!(sent.len(), 2);
    assert_eq!(
        (key(&sent[0]), key(&sent[1])),
        (Some("key-1"), Some("key-1"))
    );
    assert_eq!(
        (bearer(&sent[0]), bearer(&sent[1])),
        (Some("access-1"), Some("access-1"))
    );
    assert!(!server.paths().contains(&"/v1/auth/refresh".to_string()));
    assert_eq!(kept(&fixture), None);
}

/// Given a wrong password,
/// when the coach asks for the deletion,
/// then the server's refusal comes back as it is, he stays logged in, and the next press is a new
/// request (a new key, a token taken afresh).
#[test]
fn a_wrong_password_keeps_the_session() {
    let server = server(|request| {
        if request.body["password"] == PASSWORD {
            (202, json!({ "deleteAt": DELETE_AT }))
        } else {
            error(401, "be.error.auth.invalidCredentials")
        }
    });
    let fixture = logged_in(&server);

    let refused = request_coach_account_deletion(&fixture.coach, "sai mat khau", "key-1", 0);

    assert_eq!(
        refused.err().as_deref(),
        Some("be.error.auth.invalidCredentials")
    );
    assert_eq!(kept(&fixture).as_deref(), Some("refresh-1"));
    assert!(fixture.coach.active_account().is_some());
    // Only once: a wrong password is not a stale token to refresh and send again.
    assert_eq!(deletions(&server).len(), 1);

    request_coach_account_deletion(&fixture.coach, PASSWORD, "key-2", 0).expect("asked");
    assert_eq!(key(&deletions(&server)[1]), Some("key-2"));
}

/// Given an access token the server refuses (it ran out on the server's clock first),
/// when the coach asks for the deletion,
/// then the session refreshes and sends it once more, with the same key.
#[test]
fn a_refused_token_is_refreshed_once() {
    let server = server(|request| match bearer(request) {
        Some("access-1") => error(401, "be.error.auth.tokenInvalid"),
        _ => (202, json!({ "deleteAt": DELETE_AT })),
    });
    let fixture = logged_in(&server);

    request_coach_account_deletion(&fixture.coach, PASSWORD, "key-1", 0).expect("asked");

    let sent = deletions(&server);
    assert_eq!(sent.len(), 2);
    assert_eq!(bearer(&sent[1]), Some("access-2"));
    assert_eq!(key(&sent[1]), Some("key-1"));
    assert_eq!(kept(&fixture), None);
}

/// Given the refresh token kept in a file (Android, D-P5-16),
/// when the deletion is asked,
/// then the file is gone.
#[test]
fn a_deletion_removes_the_token_file() {
    let server = server(|_| (202, json!({ "deleteAt": DELETE_AT })));
    let dir = tempfile::tempdir().expect("a directory");
    let vaults = tempfile::tempdir().expect("a directory");
    let session = ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(FileVault::for_server(vaults.path(), &server.url)),
    );
    let coach = CoachContext::with_server(dir.path(), Arc::new(session));
    login_coach(&coach, "coach@example.test", PASSWORD, "t1").expect("login");
    let tokens = || {
        std::fs::read_dir(vaults.path().join("coach-server"))
            .expect("the vault's folder")
            .count()
    };
    assert_eq!(tokens(), 1);

    request_coach_account_deletion(&coach, PASSWORD, "key-1", 0).expect("asked");

    assert_eq!(tokens(), 0);
}

/// Given an account waiting to be deleted,
/// when the coach logs in,
/// then he is refused with the day of deletion in the message, as `code?deleteAt=…`.
#[test]
fn a_login_while_waiting_says_when() {
    let server = TestServer::start(|request| match request.path.as_str() {
        "/v1/auth/login" => (
            403,
            json!({
                "status": 403,
                "code": "be.error.auth.deletionPending",
                "details": { "params": { "deleteAt": DELETE_AT } }
            }),
        ),
        _ => error(404, "be.error.notFound"),
    });
    let dir = tempfile::tempdir().expect("a directory");
    let vault = Arc::new(Mutex::new(None));
    let session = ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(MemoryVault(Arc::clone(&vault))),
    );
    let coach = CoachContext::with_server(dir.path(), Arc::new(session));

    let refused = login_coach(&coach, "coach@example.test", PASSWORD, "t1");

    assert_eq!(
        refused.err().as_deref(),
        Some("be.error.auth.deletionPending?deleteAt=2026-11-19T10%3A00%3A00Z")
    );
    assert_eq!(*vault.lock().expect("vault"), None);
}

/// Given an account waiting to be deleted,
/// when the coach cancels with his email and password,
/// then they go to the public cancel route, trimmed email, no token; a 204 is a success.
#[test]
fn a_deletion_is_cancelled_by_email_and_password() {
    let server = TestServer::start(|request| match request.path.as_str() {
        "/v1/auth/cancel-deletion" => (204, Value::Null),
        _ => error(404, "be.error.notFound"),
    });
    let dir = tempfile::tempdir().expect("a directory");
    let session = ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(MemoryVault(Arc::new(Mutex::new(None)))),
    );
    let coach = CoachContext::with_server(dir.path(), Arc::new(session));

    cancel_coach_account_deletion(&coach, " coach@example.test ", PASSWORD).expect("cancelled");

    let sent = server.requests();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].method, "POST");
    assert_eq!(
        sent[0].body,
        json!({ "email": "coach@example.test", "password": PASSWORD })
    );
    assert_eq!(bearer(&sent[0]), None);
}

/// Given a wrong password,
/// when the coach cancels,
/// then the server's refusal comes back.
#[test]
fn a_cancel_with_a_wrong_password_is_refused() {
    let server = TestServer::start(|_| error(401, "be.error.auth.invalidCredentials"));
    let dir = tempfile::tempdir().expect("a directory");
    let session = ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(MemoryVault(Arc::new(Mutex::new(None)))),
    );
    let coach = CoachContext::with_server(dir.path(), Arc::new(session));

    let refused = cancel_coach_account_deletion(&coach, "coach@example.test", "sai");

    assert_eq!(
        refused.err().as_deref(),
        Some("be.error.auth.invalidCredentials")
    );
}
