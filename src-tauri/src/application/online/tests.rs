//! The online proxy against a stand-in server (E3-6-tech-spec.md §3.4, §5): what it lets through,
//! what it refuses before sending anything, the headers both ways, and when it tries again.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};

use super::{send, OnlineError, OnlineRequest};
use crate::application::coach_server::test_server::{Answer, Recorded, TestServer};
use crate::application::coach_server::{ApiClient, MemoryVault, ServerSession};

const CLUB: &str = "0192f0c4-0000-7000-8000-0000000000aa";

fn pair() -> Value {
    json!({
        "accessToken": "access-1",
        "accessTokenExpiresAt": "2099-01-01T00:00:00Z",
        "refreshToken": "refresh-1",
        "refreshTokenExpiresAt": "2099-01-01T00:00:00Z",
        "account": {
            "id": "0192f0c4-0000-7000-8000-000000000001", "email": "coach@example.test",
            "firstName": "Dung", "lastName": "Ung", "dateOfBirth": "1990-05-01",
            "nationality": "VN", "region": "AsiaSoutheast", "status": "active", "capabilities": []
        }
    })
}

/// A coach whose keychain holds a refresh token, and a server that refreshes it and answers every
/// other request with `answer`.
fn signed_in(
    answer: impl Fn(&Recorded) -> Answer + Send + Sync + 'static,
) -> (TestServer, ServerSession) {
    let server = TestServer::start_with_headers(move |request| {
        if request.path == "/v1/auth/refresh" {
            (200, pair(), Vec::new())
        } else {
            answer(request)
        }
    });
    let vault = MemoryVault::default();
    *vault.0.lock().expect("vault") = Some(String::from("refresh-0"));
    let session = ServerSession::new(ApiClient::new(&server.url), Box::new(vault));
    (server, session)
}

fn ok(body: Value) -> Answer {
    (
        200,
        body,
        vec![(String::from("ofm-contract-revision"), String::from("1"))],
    )
}

fn request(method: &str, segments: &[&str]) -> OnlineRequest {
    OnlineRequest {
        method: method.to_string(),
        segments: segments.iter().map(|segment| segment.to_string()).collect(),
        query: Vec::new(),
        body: None,
        if_match: None,
        idempotency_key: None,
    }
}

/// The requests that reached the server, the refresh left out.
fn sent(server: &TestServer) -> Vec<Recorded> {
    server
        .requests()
        .into_iter()
        .filter(|request| request.path != "/v1/auth/refresh")
        .collect()
}

fn refused(outcome: Result<super::OnlineResponse, OnlineError>) -> String {
    outcome.expect_err("refused").code
}

/// Given a signed-in coach,
/// when the webview reads its club,
/// then the request goes out to `/v1/clubs/mine` with the session's token, and the answer and the
/// server's contract revision come back.
#[test]
fn a_route_the_table_allows_goes_out_with_the_token() {
    let (server, session) = signed_in(|_| ok(json!({ "club": { "name": "Saigon" } })));
    let answer = send(&session, &request("GET", &["v1", "clubs", "mine"]), 0).expect("an answer");
    assert_eq!(answer.status, 200);
    assert_eq!(answer.body["club"]["name"], "Saigon");
    assert_eq!(answer.contract_revision, Some(1));
    let requests = sent(&server);
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].path, "/v1/clubs/mine");
    assert_eq!(
        requests[0].headers.get("authorization").map(String::as_str),
        Some("Bearer access-1")
    );
}

/// Given a signed-in coach,
/// when the webview reads its club's season (C-2s),
/// then it goes out to `/v1/clubs/mine/fixtures`, and no other method of it is let through.
#[test]
fn a_club_s_season_is_one_route() {
    let (server, session) = signed_in(|_| ok(json!({ "fixtures": [] })));
    let path = ["v1", "clubs", "mine", "fixtures"];
    send(&session, &request("GET", &path), 0).expect("an answer");
    let refusal = refused(send(&session, &request("POST", &path), 0));
    assert_eq!(refusal, "be.error.online.routeNotAllowed");
    let requests = sent(&server);
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].path, "/v1/clubs/mine/fixtures");
}

/// Given a signed-in coach,
/// when the webview reads and changes its friendly (S-12): its seat, a room made, joined, readied,
/// left and rematched, the queue joined and left,
/// then each goes out to its own route with its method, and the routes take no other method.
#[test]
fn a_coach_s_friendly_routes_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let routes: [(&str, &[&str]); 8] = [
        ("GET", &["v1", "friendlies", "mine"]),
        ("POST", &["v1", "friendlies", "rooms"]),
        ("POST", &["v1", "friendlies", "rooms", "join"]),
        ("POST", &["v1", "friendlies", "rooms", "mine", "ready"]),
        ("POST", &["v1", "friendlies", "rooms", "mine", "leave"]),
        ("POST", &["v1", "friendlies", "rooms", "mine", "rematch"]),
        ("POST", &["v1", "friendlies", "queue"]),
        ("DELETE", &["v1", "friendlies", "queue"]),
    ];
    for (method, segments) in routes {
        send(&session, &request(method, segments), 0).expect("an answer");
    }
    for (method, segments) in [
        ("DELETE", &["v1", "friendlies", "rooms"][..]),
        ("PUT", &["v1", "friendlies", "queue"][..]),
        ("GET", &["v1", "friendlies", "rooms", "mine"][..]),
    ] {
        let refusal = refused(send(&session, &request(method, segments), 0));
        assert_eq!(
            refusal, "be.error.online.routeNotAllowed",
            "{method} {segments:?}"
        );
    }
    let requests = sent(&server);
    let went: Vec<(String, String)> = requests
        .iter()
        .map(|request| (request.method.clone(), request.path.clone()))
        .collect();
    let expected: Vec<(String, String)> = routes
        .iter()
        .map(|(method, segments)| (method.to_string(), format!("/{}", segments.join("/"))))
        .collect();
    assert_eq!(went, expected);
}

/// Given a signed-in coach,
/// when a segment could name another path once decoded or joined (dots, slashes, backslashes,
/// percent-encodings, a semicolon, a space, a full-width letter, an empty segment),
/// then each is refused as `routeNotAllowed` and nothing at all is sent.
#[test]
fn segments_that_could_smuggle_a_path_are_refused_before_sending() {
    let (server, session) = signed_in(|_| ok(json!({})));
    for segment in [
        "..", ".", "", "%2e%2e", "%2F", "%5c", "a\\b", "..;", "a b", "ｍine", "mine/..", "v1?x",
    ] {
        let code = refused(send(
            &session,
            &request("GET", &["v1", "clubs", segment]),
            0,
        ));
        assert_eq!(code, "be.error.online.routeNotAllowed", "{segment:?}");
    }
    assert!(server.requests().is_empty(), "nothing was sent");
}

/// Given a signed-in coach,
/// when a request names a route with another method, an id that is not one, or a path the table
/// leaves out (admin, auth, coach progress),
/// then each is refused without being sent.
#[test]
fn only_the_routes_of_the_table_and_their_methods_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let attempts: [(&str, &[&str]); 6] = [
        ("DELETE", &["v1", "fixtures", CLUB]),
        ("GET", &["v1", "fixtures", "not-an-id"]),
        ("GET", &["v1", "admin", "world"]),
        ("POST", &["v1", "auth", "login"]),
        ("GET", &["v1", "coach", "progress"]),
        ("PUT", &["v1", "clubs", "mine"]),
    ];
    for (method, segments) in attempts {
        let code = refused(send(&session, &request(method, segments), 0));
        assert_eq!(
            code, "be.error.online.routeNotAllowed",
            "{method} {segments:?}"
        );
    }
    assert!(server.requests().is_empty());
}

/// Given the fixtures of a round,
/// when they are asked for with `round`, with an unknown key, the key twice, or a value outside
/// the query alphabet,
/// then only the first goes out, as `?round=3`.
#[test]
fn query_keys_and_values_are_the_routes_own() {
    let (server, session) = signed_in(|_| ok(json!({ "fixtures": [] })));
    let mut round = request("GET", &["v1", "leagues", CLUB, "fixtures"]);
    round.query = vec![(String::from("round"), String::from("3"))];
    send(&session, &round, 0).expect("an answer");
    for query in [
        vec![("limit", "3")],
        vec![("round", "3"), ("round", "4")],
        vec![("round", "3;drop")],
    ] {
        let mut attempt = round.clone();
        attempt.query = query
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        assert_eq!(
            refused(send(&session, &attempt, 0)),
            "be.error.online.routeNotAllowed",
            "{query:?}"
        );
    }
    let paths: Vec<String> = sent(&server).into_iter().map(|r| r.path).collect();
    assert_eq!(paths, vec![format!("/v1/leagues/{CLUB}/fixtures?round=3")]);
}

/// Given a coach who sets his eleven,
/// when the server refuses with 409, a Retry-After and parameters,
/// then If-Match and the Idempotency-Key went out, and the error comes back with its code,
/// details, the seconds to wait and the revision.
#[test]
fn allowed_headers_go_out_and_come_back() {
    let (server, session) = signed_in(|_| {
        (
            409,
            json!({ "status": 409, "code": "be.error.club.matchUnderway",
                    "details": { "params": { "kickoffAt": "2026-10-23T18:00:00Z" } } }),
            vec![
                (String::from("Retry-After"), String::from("600")),
                (String::from("ofm-contract-revision"), String::from("1")),
            ],
        )
    });
    let mut setup = request("PUT", &["v1", "clubs", "mine", "setup"]);
    setup.body = Some(json!({ "formation": "4-4-2" }));
    setup.if_match = Some(String::from("5"));
    setup.idempotency_key = Some(String::from("0192f0c4-0000-7000-8000-0000000000bb"));
    let error = send(&session, &setup, 0).expect_err("a conflict");
    assert_eq!(
        (error.status, error.code.as_str()),
        (409, "be.error.club.matchUnderway")
    );
    assert_eq!(
        error.details,
        Some(json!({ "params": { "kickoffAt": "2026-10-23T18:00:00Z" } }))
    );
    assert_eq!(
        (error.retry_after_seconds, error.contract_revision),
        (Some(600), Some(1))
    );
    let request = &sent(&server)[0];
    assert_eq!(
        request.headers.get("if-match").map(String::as_str),
        Some("5")
    );
    assert_eq!(
        request.headers.get("idempotency-key").map(String::as_str),
        Some("0192f0c4-0000-7000-8000-0000000000bb")
    );
    assert_eq!(request.body, json!({ "formation": "4-4-2" }));
}

/// Given header values that are not a version or a key the webview makes,
/// when they are sent,
/// then the request is refused before it leaves.
#[test]
fn header_values_outside_their_alphabet_are_refused() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let mut setup = request("PUT", &["v1", "clubs", "mine", "setup"]);
    setup.if_match = Some(String::from("5\r\nX-Evil: 1"));
    assert_eq!(
        refused(send(&session, &setup, 0)),
        "be.error.online.routeNotAllowed"
    );
    setup.if_match = None;
    setup.idempotency_key = Some(String::from("a key"));
    assert_eq!(
        refused(send(&session, &setup, 0)),
        "be.error.online.routeNotAllowed"
    );
    assert!(server.requests().is_empty());
}

/// A server that drops the first request it gets and answers the next ones.
fn drops_first() -> impl Fn(&Recorded) -> Answer + Send + Sync + 'static {
    let calls = Arc::new(AtomicUsize::new(0));
    move |_| {
        if calls.fetch_add(1, Ordering::SeqCst) == 0 {
            (0, Value::Null, Vec::new())
        } else {
            ok(json!({ "ok": true }))
        }
    }
}

/// Given a server whose first answer is lost,
/// when a read, a keyed write and an unkeyed write are sent,
/// then the read and the keyed write (with the same key) are sent once more and answered; the
/// unkeyed write is not repeated and reports the server unreachable.
#[test]
fn only_a_request_safe_to_repeat_is_tried_once_more() {
    let (server, session) = signed_in(drops_first());
    send(&session, &request("GET", &["v1", "season"]), 0).expect("answered the second time");
    assert_eq!(sent(&server).len(), 2);

    let (server, session) = signed_in(drops_first());
    let mut keyed = request("POST", &["v1", "clubs", "takeover"]);
    keyed.idempotency_key = Some(String::from("k-1"));
    send(&session, &keyed, 0).expect("answered the second time");
    let keys: Vec<Option<String>> = sent(&server)
        .into_iter()
        .map(|r| r.headers.get("idempotency-key").cloned())
        .collect();
    assert_eq!(keys, vec![Some(String::from("k-1")); 2]);

    let (server, session) = signed_in(drops_first());
    let code = refused(send(
        &session,
        &request("POST", &["v1", "clubs", "takeover"]),
        0,
    ));
    assert_eq!(code, "be.error.online.unreachable");
    assert_eq!(sent(&server).len(), 1);
}

/// Given a server that answers an error without a code, and one whose code is not a
/// translation key,
/// when a request gets either,
/// then the player is told the server misbehaved (`serverUnexpected`), with its status.
#[test]
fn an_error_without_a_code_is_unexpected() {
    for body in [json!("Bad Gateway"), json!({ "code": "oops" })] {
        let (_server, session) = signed_in(move |_| (502, body.clone(), Vec::new()));
        let error = send(&session, &request("GET", &["v1", "season"]), 0).expect_err("refused");
        assert_eq!(
            (error.status, error.code.as_str()),
            (502, "be.error.online.serverUnexpected")
        );
    }
}

/// Given a coach with no refresh token kept,
/// when the webview calls a route,
/// then it is told to sign in and nothing is sent.
#[test]
fn without_a_session_the_webview_is_told_to_sign_in() {
    let server = TestServer::start(|_| (200, json!({})));
    let session = ServerSession::new(
        ApiClient::new(&server.url),
        Box::new(MemoryVault::default()),
    );
    let code = refused(send(&session, &request("GET", &["v1", "season"]), 0));
    assert_eq!(code, "be.error.online.notSignedIn");
    assert!(server.requests().is_empty());
}

/// Given a coach watching a live match (S-8e),
/// when they read it, their own side, its frames after step 30 by fifty, and send an order with
/// a key, and then ask for the frames with a key the route does not take,
/// then the four go out as the server's match routes, and the last is refused unsent.
#[test]
fn the_match_routes_go_out_and_the_frames_take_their_own_keys() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let match_path = ["v1", "matches", CLUB];
    send(&session, &request("GET", &match_path), 0).expect("the match");
    send(
        &session,
        &request("GET", &[&match_path[..], &["mine"]].concat()),
        0,
    )
    .expect("mine");
    let mut frames = request("GET", &[&match_path[..], &["frames"]].concat());
    frames.query = vec![
        (String::from("afterSeq"), String::from("30")),
        (String::from("limit"), String::from("50")),
    ];
    send(&session, &frames, 0).expect("the frames");
    let mut order = request("POST", &[&match_path[..], &["commands"]].concat());
    order.idempotency_key = Some(String::from("0192f0c4-0000-7000-8000-0000000000bb"));
    order.body =
        Some(json!({"command": {"ChangeFormation": {"side": "Home", "formation": "4-3-3"}}}));
    send(&session, &order, 0).expect("the order");
    let mut wrong = frames.clone();
    wrong.query = vec![(String::from("round"), String::from("1"))];
    assert_eq!(
        refused(send(&session, &wrong, 0)),
        "be.error.online.routeNotAllowed"
    );

    let paths: Vec<String> = sent(&server).into_iter().map(|r| r.path).collect();
    assert_eq!(
        paths,
        vec![
            format!("/v1/matches/{CLUB}"),
            format!("/v1/matches/{CLUB}/mine"),
            format!("/v1/matches/{CLUB}/frames?afterSeq=30&limit=50"),
            format!("/v1/matches/{CLUB}/commands"),
        ]
    );
}

/// Given a coach replaying a finished match (C-2e),
/// when they read it as it kicked off and after step 40,
/// then both go out to the match route with their `atSeq`.
#[test]
fn a_match_is_read_at_a_step() {
    let (server, session) = signed_in(|_| ok(json!({})));
    for step in ["0", "40"] {
        let mut view = request("GET", &["v1", "matches", CLUB]);
        view.query = vec![(String::from("atSeq"), String::from(step))];
        send(&session, &view, 0).expect("the match at a step");
    }
    let paths: Vec<String> = sent(&server).into_iter().map(|r| r.path).collect();
    assert_eq!(
        paths,
        vec![
            format!("/v1/matches/{CLUB}?atSeq=0"),
            format!("/v1/matches/{CLUB}?atSeq=40"),
        ]
    );
}
