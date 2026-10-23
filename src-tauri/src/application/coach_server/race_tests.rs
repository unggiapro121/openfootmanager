//! Refreshing without ending the session by mistake (E3-6-tech-spec.md §3.4, E6-14, E6-20): one
//! refresh at a time in a process, the refresh token only in the keychain, and a second copy of
//! the app racing the first kept signed in.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use super::client::ApiClient;
use super::test_server::{Recorded, TestServer};
use super::vault::MemoryVault;
use super::ServerSession;

fn pair(access: &str, refresh: &str) -> Value {
    json!({
        "accessToken": access,
        "accessTokenExpiresAt": "2099-01-01T00:00:00Z",
        "refreshToken": refresh,
        "refreshTokenExpiresAt": "2099-01-01T00:00:00Z",
        "account": {
            "id": "0192f0c4-0000-7000-8000-000000000001", "email": "coach@example.test",
            "firstName": "Dung", "lastName": "Ung", "dateOfBirth": "1990-05-01",
            "nationality": "VN", "region": "AsiaSoutheast", "status": "active", "capabilities": []
        }
    })
}

fn me() -> Value {
    json!({ "id": "0192f0c4-0000-7000-8000-000000000001" })
}

fn refused(code: &str) -> (u16, Value) {
    (401, json!({ "status": 401, "code": code }))
}

fn vault_with(token: &str) -> MemoryVault {
    let vault = MemoryVault::default();
    *vault.0.lock().expect("vault") = Some(token.to_string());
    vault
}

fn kept(vault: &Arc<Mutex<Option<String>>>) -> Option<String> {
    vault.lock().expect("vault").clone()
}

fn bearer(request: &Recorded) -> Option<&str> {
    request
        .headers
        .get("authorization")
        .and_then(|value| value.strip_prefix("Bearer "))
}

/// Given a session whose access token the server now refuses,
/// when ten calls meet that 401 at once,
/// then the token is refreshed exactly once, and all ten succeed with the new one.
#[test]
fn ten_calls_that_meet_a_401_refresh_once() {
    let refreshes = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&refreshes);
    let server = TestServer::start(move |request| match request.path.as_str() {
        "/v1/auth/login" => (200, pair("access-old", "refresh-1")),
        "/v1/auth/refresh" => {
            counted.fetch_add(1, Ordering::SeqCst);
            // Slow, so the other calls are waiting while it runs.
            std::thread::sleep(Duration::from_millis(100));
            (200, pair("access-new", "refresh-2"))
        }
        _ if bearer(request) == Some("access-new") => (200, me()),
        _ => refused("be.error.auth.unauthorized"),
    });
    let session = Arc::new(ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(MemoryVault::default()),
    ));
    session
        .login("coach@example.test", "a long password")
        .expect("logged in");
    let calls: Vec<_> = (0..10)
        .map(|_| {
            let session = Arc::clone(&session);
            std::thread::spawn(move || session.get_authorized::<Value>("/v1/me", 0))
        })
        .collect();
    for call in calls {
        call.join().expect("a call").expect("answered");
    }
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
}

/// Given a session whose refresh cannot reach the server,
/// when a call needs a fresh token,
/// then it reports the server unreachable and the keychain still holds the token.
#[test]
fn a_refresh_lost_on_the_way_leaves_the_keychain() {
    let server = TestServer::start(|_| (0, Value::Null));
    let vault = vault_with("refresh-0");
    let slot = Arc::clone(&vault.0);
    let session = ServerSession::new(ApiClient::new(&server.url), Box::new(vault));
    let outcome = session.get_authorized::<Value>("/v1/me", 0);
    assert_eq!(outcome, Err(super::ApiError::Unreachable));
    assert_eq!(kept(&slot).as_deref(), Some("refresh-0"));
}

/// The server's refresh rules (ofm-server, Z3 with the race window of E6-20): a fresh token is
/// exchanged; the one just before the live token, presented again, is a race; any other reuse
/// revokes the family.
#[derive(Default)]
struct Family {
    /// Every token issued, in order, with whether it was used.
    tokens: Vec<(String, bool)>,
    revoked: bool,
}

fn rotating_server(first_answer_delay: Duration) -> (TestServer, Arc<Mutex<Family>>) {
    let family = Arc::new(Mutex::new(Family {
        tokens: vec![(String::from("refresh-0"), false)],
        revoked: false,
    }));
    let state = Arc::clone(&family);
    let server = TestServer::start(move |request| {
        if request.path != "/v1/auth/refresh" {
            return if state.lock().expect("family").revoked {
                refused("be.error.auth.unauthorized")
            } else {
                (200, me())
            };
        }
        let presented = request.body["refreshToken"].as_str().unwrap_or_default();
        let (answer, delay) = {
            let mut family = state.lock().expect("family");
            let index = family
                .tokens
                .iter()
                .position(|(token, _)| token == presented);
            match index {
                _ if family.revoked => (refused("be.error.auth.refreshInvalid"), Duration::ZERO),
                Some(index) if !family.tokens[index].1 => {
                    family.tokens[index].1 = true;
                    let next = format!("refresh-{}", family.tokens.len());
                    family.tokens.push((next.clone(), false));
                    let delay = if index == 0 {
                        first_answer_delay
                    } else {
                        Duration::ZERO
                    };
                    ((200, pair(&format!("access-{index}"), &next)), delay)
                }
                Some(index) if family.tokens.get(index + 1).is_some_and(|(_, used)| !used) => {
                    (refused("be.error.auth.refreshRaced"), Duration::ZERO)
                }
                _ => {
                    family.revoked = true;
                    (refused("be.error.auth.refreshInvalid"), Duration::ZERO)
                }
            }
        };
        std::thread::sleep(delay);
        answer
    });
    (server, family)
}

/// Given two copies of the app sharing one keychain, and a server that rotates refresh tokens
/// and answers a race with `refreshRaced`,
/// when the second copy refreshes with the token the first is exchanging at that moment,
/// then the second waits, reads the keychain again, refreshes with the first's new token, and
/// both stay signed in; nothing is revoked (E6-20).
#[test]
fn two_copies_sharing_the_keychain_both_stay_signed_in() {
    let (server, family) = rotating_server(Duration::from_millis(200));
    let vault = vault_with("refresh-0");
    let shared = Arc::clone(&vault.0);
    let first = Arc::new(ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(vault),
    ));
    let second = Arc::new(ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(MemoryVault(Arc::clone(&shared))),
    ));
    let a = std::thread::spawn({
        let first = Arc::clone(&first);
        move || first.get_authorized::<Value>("/v1/me", 0)
    });
    std::thread::sleep(Duration::from_millis(50));
    let b = std::thread::spawn({
        let second = Arc::clone(&second);
        move || second.get_authorized::<Value>("/v1/me", 0)
    });
    a.join()
        .expect("first")
        .expect("the first copy is answered");
    b.join()
        .expect("second")
        .expect("the second copy is answered");
    let family = family.lock().expect("family");
    assert!(!family.revoked, "a race must not end the session");
    assert_eq!(
        family.tokens.len(),
        3,
        "two exchanges: refresh-0 and refresh-1"
    );
    assert_eq!(kept(&shared).as_deref(), Some("refresh-2"));
}

/// Given a server that answers every refresh with `refreshRaced`,
/// when a call needs a fresh token,
/// then it is tried twice, this copy is signed out, and the keychain is left to the other copy.
#[test]
fn raced_twice_signs_out_here_and_leaves_the_keychain() {
    let server = TestServer::start(|_| refused("be.error.auth.refreshRaced"));
    let vault = vault_with("refresh-0");
    let slot = Arc::clone(&vault.0);
    let session = ServerSession::new(ApiClient::new(&server.url), Box::new(vault));
    let outcome = session.get_authorized::<Value>("/v1/me", 0);
    assert_eq!(outcome, Err(super::ApiError::NoSession));
    assert_eq!(server.paths(), vec!["/v1/auth/refresh"; 2]);
    assert_eq!(kept(&slot).as_deref(), Some("refresh-0"));
}

/// Given a session that refreshed once,
/// when the keychain is changed behind its back (another copy rotated the token),
/// then its next refresh presents what the keychain holds now: no copy is kept in memory.
#[test]
fn every_refresh_reads_the_keychain() {
    let server = TestServer::start(|request| {
        if request.path == "/v1/auth/refresh" {
            (200, pair("access-x", "refresh-mine"))
        } else {
            refused("be.error.auth.unauthorized")
        }
    });
    let vault = vault_with("refresh-0");
    let slot = Arc::clone(&vault.0);
    let session = ServerSession::new(ApiClient::new(&server.url), Box::new(vault));
    session.resume().expect("resumed");
    *slot.lock().expect("vault") = Some(String::from("refresh-from-the-other-copy"));
    let _ = session.get_authorized::<Value>("/v1/me", 0);
    let presented: Vec<Value> = server
        .requests()
        .into_iter()
        .filter(|request| request.path == "/v1/auth/refresh")
        .map(|request| request.body["refreshToken"].clone())
        .collect();
    assert_eq!(
        presented,
        vec![json!("refresh-0"), json!("refresh-from-the-other-copy")]
    );
}
