//! Logging out ends the session on the server too (PO P5-45 (2)): `/v1/auth/logout` revokes the
//! refresh token only for the account its access token names, so the logout goes with a live
//! access token, refreshed first when the one held has run out or was never held (the app opened
//! again hours later), and once more when the server refuses it. Afterwards the old refresh
//! token is refused.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::client::{ApiClient, Headers};
use super::test_server::{Recorded, TestServer};
use super::vault::MemoryVault;
use super::*;

const LATER: &str = "2099-01-01T00:00:00Z";
const PAST: &str = "2000-01-01T00:00:00Z";
const PASSWORD: &str = "mot mat khau dai";

fn token_pair(n: u32, access_expires_at: &str) -> Value {
    json!({
        "accessToken": format!("access-{n}"),
        "accessTokenExpiresAt": access_expires_at,
        "refreshToken": format!("refresh-{n}"),
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

struct Issued {
    /// The latest pair is `access-{latest}`/`refresh-{latest}`; every earlier one is spent.
    latest: u32,
    revoked: HashSet<String>,
    /// Refuse the next logout's access token, as the server does for an account locked since.
    refuse_bearer_once: bool,
}

/// `ofm-server`'s token rules as far as logout needs them (auth handlers `login`, `refresh`,
/// `logout`): login gives pair 1, whose access token runs out at `first_expires_at`; a refresh
/// rotates to the next pair and refuses a spent or revoked token; a logout needs the latest access
/// token and revokes the refresh token in its body.
fn token_server(first_expires_at: &'static str, refuse_bearer_once: bool) -> TestServer {
    let issued = Mutex::new(Issued {
        latest: 1,
        revoked: HashSet::new(),
        refuse_bearer_once,
    });
    TestServer::start(move |request| {
        let mut issued = issued.lock().expect("issued");
        match request.path.as_str() {
            "/v1/auth/login" => (200, token_pair(1, first_expires_at)),
            "/v1/auth/refresh" => {
                let presented = request.body["refreshToken"].as_str().unwrap_or_default();
                if presented != format!("refresh-{}", issued.latest)
                    || issued.revoked.contains(presented)
                {
                    return error(401, "be.error.auth.refreshInvalid");
                }
                issued.latest += 1;
                (200, token_pair(issued.latest, LATER))
            }
            "/v1/auth/logout" => {
                let live = format!("access-{}", issued.latest);
                if bearer(request) != Some(live.as_str())
                    || std::mem::take(&mut issued.refuse_bearer_once)
                {
                    return error(401, "be.error.auth.tokenInvalid");
                }
                if let Some(token) = request.body["refreshToken"].as_str() {
                    issued.revoked.insert(token.to_string());
                }
                (204, Value::Null)
            }
            _ => error(404, "be.error.notFound"),
        }
    })
}

fn session(url: &str, kept: Option<&str>) -> (ServerSession, Arc<Mutex<Option<String>>>) {
    let vault = Arc::new(Mutex::new(kept.map(str::to_string)));
    let session = ServerSession::new(
        ApiClient::new(url),
        Box::new(MemoryVault(Arc::clone(&vault))),
    );
    (session, vault)
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// Whether the server still exchanges `refresh` for a new pair.
fn exchanges(server: &TestServer, refresh: &str) -> bool {
    ApiClient::new(&server.url)
        .post::<_, Value>(
            "/v1/auth/refresh",
            &json!({ "refreshToken": refresh }),
            Headers::default(),
        )
        .is_ok()
}

/// What each request sent: its path, its bearer, and the refresh token in its body.
fn sent(server: &TestServer) -> Vec<(String, Option<String>, Option<String>)> {
    server
        .requests()
        .iter()
        .map(|request| {
            (
                request.path.clone(),
                bearer(request).map(str::to_string),
                request.body["refreshToken"].as_str().map(str::to_string),
            )
        })
        .collect()
}

fn call(
    path: &str,
    bearer: Option<&str>,
    refresh: Option<&str>,
) -> (String, Option<String>, Option<String>) {
    (
        path.to_string(),
        bearer.map(str::to_string),
        refresh.map(str::to_string),
    )
}

/// Given a coach logged in with a live access token,
/// when he logs out,
/// then the logout carries that access token and the refresh token, the server revokes it, and
/// it is forgotten here.
#[test]
fn logging_out_revokes_the_refresh_token() {
    let server = token_server(LATER, false);
    let (session, vault) = session(&server.url, None);
    session
        .login("coach@example.test", PASSWORD)
        .expect("login");

    session.logout(now());

    assert_eq!(
        sent(&server),
        vec![
            call("/v1/auth/login", None, None),
            call("/v1/auth/logout", Some("access-1"), Some("refresh-1")),
        ]
    );
    assert!(!exchanges(&server, "refresh-1"), "the old token is refused");
    assert_eq!(*vault.lock().expect("vault"), None);
}

/// Given a coach whose access token has run out,
/// when he logs out,
/// then the session is refreshed first and the new refresh token is the one revoked, so neither
/// the old token nor the new one is exchanged afterwards.
#[test]
fn logging_out_after_the_access_token_ran_out_refreshes_first() {
    let server = token_server(PAST, false);
    let (session, vault) = session(&server.url, None);
    session
        .login("coach@example.test", PASSWORD)
        .expect("login");

    session.logout(now());

    assert_eq!(
        sent(&server),
        vec![
            call("/v1/auth/login", None, None),
            call("/v1/auth/refresh", None, Some("refresh-1")),
            call("/v1/auth/logout", Some("access-2"), Some("refresh-2")),
        ]
    );
    assert!(!exchanges(&server, "refresh-1"));
    assert!(!exchanges(&server, "refresh-2"));
    assert_eq!(*vault.lock().expect("vault"), None);
}

/// Given the app opened again hours later, the session only in the keychain,
/// when the coach logs out,
/// then the session is refreshed for an access token and the refresh token is revoked.
#[test]
fn logging_out_of_a_session_kept_only_in_the_keychain() {
    let server = token_server(LATER, false);
    let (session, vault) = session(&server.url, Some("refresh-1"));

    session.logout(now());

    assert_eq!(
        sent(&server),
        vec![
            call("/v1/auth/refresh", None, Some("refresh-1")),
            call("/v1/auth/logout", Some("access-2"), Some("refresh-2")),
        ]
    );
    assert!(!exchanges(&server, "refresh-1"));
    assert!(!exchanges(&server, "refresh-2"));
    assert_eq!(*vault.lock().expect("vault"), None);
}

/// Given an access token the server refuses although it has not run out here,
/// when the coach logs out,
/// then the session is refreshed once and the logout sent again with the new pair.
#[test]
fn a_refused_access_token_is_refreshed_once_for_the_logout() {
    let server = token_server(LATER, true);
    let (session, vault) = session(&server.url, None);
    session
        .login("coach@example.test", PASSWORD)
        .expect("login");

    session.logout(now());

    assert_eq!(
        sent(&server),
        vec![
            call("/v1/auth/login", None, None),
            call("/v1/auth/logout", Some("access-1"), Some("refresh-1")),
            call("/v1/auth/refresh", None, Some("refresh-1")),
            call("/v1/auth/logout", Some("access-2"), Some("refresh-2")),
        ]
    );
    assert!(!exchanges(&server, "refresh-2"));
    assert_eq!(*vault.lock().expect("vault"), None);
}

/// Given a kept refresh token the server no longer takes,
/// when the coach logs out,
/// then there is nothing left to revoke: no logout is sent, and the token is forgotten here.
#[test]
fn a_session_the_server_already_ended_just_ends_here() {
    let server = token_server(LATER, false);
    let (session, vault) = session(&server.url, Some("refresh-0"));

    session.logout(now());

    assert_eq!(
        sent(&server),
        vec![call("/v1/auth/refresh", None, Some("refresh-0"))]
    );
    assert_eq!(*vault.lock().expect("vault"), None);
}

/// Given a server out of reach,
/// when the coach logs out,
/// then the session still ends here.
#[test]
fn logging_out_with_the_server_out_of_reach_ends_the_session_here() {
    let (session, vault) = session("http://127.0.0.1:9", Some("refresh-1"));

    session.logout(now());

    assert_eq!(*vault.lock().expect("vault"), None);
}
