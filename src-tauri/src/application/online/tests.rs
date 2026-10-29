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
/// when the webview reads the coach's career, the licence table, and dismisses the licence notice
/// (S-9),
/// then each goes out to its route with its method, and no other method of them is let through.
#[test]
fn the_licence_routes_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let table = ["v1", "licences"];
    let notice = ["v1", "clubs", "mine", "licence-notice"];
    let career = ["v1", "me", "career"];
    send(&session, &request("GET", &career), 0).expect("an answer");
    send(&session, &request("GET", &table), 0).expect("an answer");
    send(&session, &request("DELETE", &notice), 0).expect("an answer");
    assert_eq!(
        refused(send(&session, &request("POST", &table), 0)),
        "be.error.online.routeNotAllowed"
    );
    assert_eq!(
        refused(send(&session, &request("GET", &notice), 0)),
        "be.error.online.routeNotAllowed"
    );
    let paths: Vec<(String, String)> = sent(&server)
        .into_iter()
        .map(|r| (r.method, r.path))
        .collect();
    assert_eq!(
        paths,
        vec![
            ("GET".to_string(), "/v1/me/career".to_string()),
            ("GET".to_string(), "/v1/licences".to_string()),
            (
                "DELETE".to_string(),
                "/v1/clubs/mine/licence-notice".to_string()
            ),
        ]
    );
}

/// Given a signed-in coach,
/// when the webview renames one of his players (S-14) and tries the route with another method
/// or with a segment that is not an id,
/// then the rename goes out to `/v1/players/{id}/name` as a PATCH, and the others are refused.
#[test]
fn a_player_s_rename_is_one_route() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let id = "01a16f79-3126-72e0-b2d1-325f38ddce33";
    let path = ["v1", "players", id, "name"];
    send(&session, &request("PATCH", &path), 0).expect("an answer");
    assert_eq!(
        refused(send(&session, &request("POST", &path), 0)),
        "be.error.online.routeNotAllowed"
    );
    assert_eq!(
        refused(send(
            &session,
            &request("PATCH", &["v1", "players", "mine", "name"]),
            0
        )),
        "be.error.online.routeNotAllowed"
    );
    let requests = sent(&server);
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "PATCH");
    assert_eq!(requests[0].path, format!("/v1/players/{id}/name"));
}

/// Given a signed-in coach,
/// when the webview renames his stadium and tries the route with another method,
/// then it goes out to `/v1/clubs/mine/stadium` as a PATCH, and the other method is refused.
#[test]
fn the_stadium_rename_is_one_route() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let path = ["v1", "clubs", "mine", "stadium"];
    send(&session, &request("PATCH", &path), 0).expect("an answer");
    assert_eq!(
        refused(send(&session, &request("PUT", &path), 0)),
        "be.error.online.routeNotAllowed"
    );
    let requests = sent(&server);
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "PATCH");
    assert_eq!(requests[0].path, "/v1/clubs/mine/stadium");
}

/// Given a signed-in coach,
/// when the webview draws his club's crest and tries the route with another method,
/// then it goes out to `/v1/clubs/mine/crest` as a PATCH, and the other method is refused.
#[test]
fn the_club_crest_is_one_route() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let path = ["v1", "clubs", "mine", "crest"];
    send(&session, &request("PATCH", &path), 0).expect("an answer");
    assert_eq!(
        refused(send(&session, &request("PUT", &path), 0)),
        "be.error.online.routeNotAllowed"
    );
    let requests = sent(&server);
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "PATCH");
    assert_eq!(requests[0].path, "/v1/clubs/mine/crest");
}

/// Given a signed-in coach,
/// when the webview sends, reads and removes his own picture and tries another method,
/// then each goes out to `/v1/me/avatar-image` with its method, and the other method is refused.
#[test]
fn the_coach_s_picture_is_one_route() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let path = ["v1", "me", "avatar-image"];
    for method in ["GET", "PUT", "DELETE"] {
        send(&session, &request(method, &path), 0).expect("an answer");
    }
    assert_eq!(
        refused(send(&session, &request("POST", &path), 0)),
        "be.error.online.routeNotAllowed"
    );
    let methods: Vec<String> = sent(&server).into_iter().map(|r| r.method).collect();
    assert_eq!(methods, ["GET", "PUT", "DELETE"]);
}

/// Given a signed-in coach,
/// when the webview picks a player's face, sends, reads and removes his picture and changes his
/// nationality, and tries other methods,
/// then each goes out to its own route with its method, and the other methods are refused.
#[test]
fn a_player_s_look_is_five_routes() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let id = "01a16f79-3126-72e0-b2d1-325f38ddce33";
    for (method, last) in [
        ("PATCH", "avatar"),
        ("GET", "avatar-image"),
        ("PUT", "avatar-image"),
        ("DELETE", "avatar-image"),
        ("PATCH", "nationality"),
    ] {
        send(&session, &request(method, &["v1", "players", id, last]), 0).expect("an answer");
    }
    for (method, last) in [
        ("PUT", "avatar"),
        ("POST", "avatar-image"),
        ("GET", "nationality"),
    ] {
        assert_eq!(
            refused(send(
                &session,
                &request(method, &["v1", "players", id, last]),
                0
            )),
            "be.error.online.routeNotAllowed",
            "{method} {last}"
        );
    }
    let sent: Vec<(String, String)> = sent(&server)
        .into_iter()
        .map(|r| (r.method, r.path))
        .collect();
    assert_eq!(sent.len(), 5);
    assert_eq!(
        sent[4],
        ("PATCH".to_string(), format!("/v1/players/{id}/nationality"))
    );
}

/// Given a signed-in coach,
/// when the webview reads the inbox, marks a message and all read, and deletes a message and the
/// read ones, and tries other methods,
/// then each goes out to its own route, and the other methods are refused.
#[test]
fn the_inbox_routes_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let id = "01a16f79-3126-72e0-b2d1-325f38ddce33";
    for (method, segments) in [
        ("GET", vec!["v1", "inbox"]),
        ("POST", vec!["v1", "inbox", "read"]),
        ("POST", vec!["v1", "inbox", id, "read"]),
        ("DELETE", vec!["v1", "inbox", id]),
        ("DELETE", vec!["v1", "inbox"]),
    ] {
        send(&session, &request(method, &segments), 0).expect("an answer");
    }
    for (method, segments) in [
        ("PUT", vec!["v1", "inbox"]),
        ("GET", vec!["v1", "inbox", "read"]),
        ("PATCH", vec!["v1", "inbox", id]),
    ] {
        assert_eq!(
            refused(send(&session, &request(method, &segments), 0)),
            "be.error.online.routeNotAllowed",
            "{method} {segments:?}"
        );
    }
    let sent: Vec<(String, String)> = sent(&server)
        .into_iter()
        .map(|r| (r.method, r.path))
        .collect();
    assert_eq!(sent.len(), 5);
    assert_eq!(
        sent[2],
        ("POST".to_string(), format!("/v1/inbox/{id}/read"))
    );
}

/// Given a signed-in coach,
/// when the webview sets a player's own training session and tries the route with another method,
/// then it goes out to `/v1/players/{id}/training-focus` as a PATCH, and the other method is
/// refused.
#[test]
fn a_player_s_own_training_session_is_one_route() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let id = "01a16f79-3126-72e0-b2d1-325f38ddce33";
    send(
        &session,
        &request("PATCH", &["v1", "players", id, "training-focus"]),
        0,
    )
    .expect("an answer");
    assert_eq!(
        refused(send(
            &session,
            &request("PUT", &["v1", "players", id, "training-focus"]),
            0
        )),
        "be.error.online.routeNotAllowed"
    );
    let sent: Vec<(String, String)> = sent(&server)
        .into_iter()
        .map(|r| (r.method, r.path))
        .collect();
    assert_eq!(
        sent,
        [(
            "PATCH".to_string(),
            format!("/v1/players/{id}/training-focus")
        )]
    );
}

/// Given a signed-in coach,
/// when he holds today's session, and when anything else is asked of the same path,
/// then the session goes out as a POST with his token and its idempotency key, and a GET or a
/// PUT of the path is refused by the proxy.
#[test]
fn today_s_training_session_is_one_route() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let path = ["v1", "clubs", "mine", "training", "sessions"];
    let mut hold = request("POST", &path);
    hold.idempotency_key = Some("press-1".to_string());
    hold.body = Some(json!({ "intensity": "High" }));
    send(&session, &hold, 0).expect("an answer");
    for method in ["GET", "PUT"] {
        assert_eq!(
            refused(send(&session, &request(method, &path), 0)),
            "be.error.online.routeNotAllowed"
        );
    }
    let sent = sent(&server);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].method, "POST");
    assert_eq!(sent[0].path, "/v1/clubs/mine/training/sessions");
    assert_eq!(
        sent[0].headers.get("authorization").map(String::as_str),
        Some("Bearer access-1")
    );
    assert_eq!(
        sent[0].headers.get("idempotency-key").map(String::as_str),
        Some("press-1")
    );
    assert_eq!(sent[0].body, json!({ "intensity": "High" }));
}

/// Given a signed-in coach,
/// when the webview sets a player's shirt number and tries the route with another method,
/// then it goes out to `/v1/players/{id}/shirt` as a PATCH, and the other method is refused.
#[test]
fn a_player_s_shirt_is_one_route() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let id = "01a16f79-3126-72e0-b2d1-325f38ddce33";
    let path = ["v1", "players", id, "shirt"];
    send(&session, &request("PATCH", &path), 0).expect("an answer");
    assert_eq!(
        refused(send(&session, &request("PUT", &path), 0)),
        "be.error.online.routeNotAllowed"
    );
    let requests = sent(&server);
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "PATCH");
    assert_eq!(requests[0].path, format!("/v1/players/{id}/shirt"));
}

/// Given a signed-in coach,
/// when the webview asks what letting a player go would cost and then lets him go, and tries each
/// route with another method,
/// then they go out to `/v1/clubs/mine/players/{id}/release-quote` as a GET and
/// `/v1/clubs/mine/players/{id}/release` as a POST, and the other methods are refused.
#[test]
fn a_player_s_release_is_two_routes() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let id = "01a16f79-3126-72e0-b2d1-325f38ddce33";
    let quote = ["v1", "clubs", "mine", "players", id, "release-quote"];
    let release = ["v1", "clubs", "mine", "players", id, "release"];
    send(&session, &request("GET", &quote), 0).expect("an answer");
    send(&session, &request("POST", &release), 0).expect("an answer");
    assert_eq!(
        refused(send(&session, &request("POST", &quote), 0)),
        "be.error.online.routeNotAllowed"
    );
    assert_eq!(
        refused(send(&session, &request("GET", &release), 0)),
        "be.error.online.routeNotAllowed"
    );
    let requests = sent(&server);
    assert_eq!(requests.len(), 2);
    assert_eq!(
        (requests[0].method.as_str(), requests[0].path.as_str()),
        (
            "GET",
            format!("/v1/clubs/mine/players/{id}/release-quote").as_str()
        )
    );
    assert_eq!(
        (requests[1].method.as_str(), requests[1].path.as_str()),
        (
            "POST",
            format!("/v1/clubs/mine/players/{id}/release").as_str()
        )
    );
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

const PLAYER: &str = "0192f0c4-0000-7000-8000-0000000000bb";
const AUCTION: &str = "0192f0c4-0000-7000-8000-0000000000cc";

/// A request as a test names it: its method, its segments and its query.
type Asked<'a> = (&'a str, Vec<&'a str>, Vec<(&'a str, &'a str)>);

/// Each `(method, segments, query)` sent through `session`; the paths and queries that reached the
/// server, in order.
fn went_out(
    server: &TestServer,
    session: &ServerSession,
    routes: &[Asked<'_>],
) -> Vec<(String, String)> {
    for (method, segments, query) in routes {
        let mut asked = request(method, segments);
        asked.query = query
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        send(session, &asked, 0).expect("an answer");
    }
    sent(server)
        .iter()
        .map(|request| (request.method.clone(), request.path.clone()))
        .collect()
}

/// Given a signed-in coach,
/// when the webview reads the club's money (C-5): its finance, a page of its ledger from a cursor,
/// its facilities, and upgrades each of the three,
/// then each goes out to its own route; a facility the game does not have, and a ledger key the
/// route does not take, are refused.
#[test]
fn a_club_s_money_routes_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let routes = vec![
        ("GET", vec!["v1", "clubs", "mine", "finance"], vec![]),
        (
            "GET",
            vec!["v1", "clubs", "mine", "ledger"],
            vec![("cursor", "41"), ("limit", "30")],
        ),
        ("GET", vec!["v1", "clubs", "mine", "facilities"], vec![]),
        (
            "POST",
            vec!["v1", "clubs", "mine", "facilities", "training", "upgrade"],
            vec![],
        ),
        (
            "POST",
            vec!["v1", "clubs", "mine", "facilities", "medical", "upgrade"],
            vec![],
        ),
        (
            "POST",
            vec!["v1", "clubs", "mine", "facilities", "scouting", "upgrade"],
            vec![],
        ),
    ];
    let went = went_out(&server, &session, &routes);
    assert_eq!(went.len(), routes.len());
    assert_eq!(went[1].1, "/v1/clubs/mine/ledger?cursor=41&limit=30");

    let stadium = request(
        "POST",
        &["v1", "clubs", "mine", "facilities", "stadium", "upgrade"],
    );
    assert_eq!(
        refused(send(&session, &stadium, 0)),
        "be.error.online.routeNotAllowed"
    );
    let mut by_kind = request("GET", &["v1", "clubs", "mine", "ledger"]);
    by_kind.query = vec![(String::from("kind"), String::from("wage"))];
    assert_eq!(
        refused(send(&session, &by_kind, 0)),
        "be.error.online.routeNotAllowed"
    );
}

/// Given a signed-in coach,
/// when the webview reads its academy, a trip's quote, sends a trip, brings it back sooner,
/// chooses from it, sets a youngster's focus, lets one go and upgrades the academy (C-7c),
/// then each goes out to its own route; a region with a space, a quote key the route does not
/// take, and a youngster that is not an id are refused.
#[test]
fn the_academy_routes_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let routes = vec![
        ("GET", vec!["v1", "clubs", "mine", "academy"], vec![]),
        (
            "GET",
            vec!["v1", "clubs", "mine", "academy", "scout-quote"],
            vec![("region", "Europe"), ("focus", "Balanced")],
        ),
        (
            "POST",
            vec!["v1", "clubs", "mine", "academy", "scouts"],
            vec![],
        ),
        (
            "POST",
            vec![
                "v1",
                "clubs",
                "mine",
                "academy",
                "scouts",
                CLUB,
                "time-skip",
            ],
            vec![],
        ),
        (
            "POST",
            vec!["v1", "clubs", "mine", "academy", "scouts", CLUB, "recruit"],
            vec![],
        ),
        (
            "PUT",
            vec!["v1", "clubs", "mine", "academy", "players", PLAYER, "focus"],
            vec![],
        ),
        (
            "POST",
            vec![
                "v1", "clubs", "mine", "academy", "players", PLAYER, "release",
            ],
            vec![],
        ),
        (
            "POST",
            vec!["v1", "clubs", "mine", "facilities", "academy", "upgrade"],
            vec![],
        ),
    ];
    let went = went_out(&server, &session, &routes);
    assert_eq!(went.len(), routes.len());
    assert_eq!(
        went[1].1,
        "/v1/clubs/mine/academy/scout-quote?region=Europe&focus=Balanced"
    );
    assert_eq!(
        went[3],
        (
            String::from("POST"),
            format!("/v1/clubs/mine/academy/scouts/{CLUB}/time-skip")
        )
    );

    let mut spaced = request("GET", &["v1", "clubs", "mine", "academy", "scout-quote"]);
    spaced.query = vec![(String::from("region"), String::from("Asia East"))];
    assert_eq!(
        refused(send(&session, &spaced, 0)),
        "be.error.online.routeNotAllowed"
    );
    let mut priced = request("GET", &["v1", "clubs", "mine", "academy", "scout-quote"]);
    priced.query = vec![(String::from("cost"), String::from("1"))];
    assert_eq!(
        refused(send(&session, &priced, 0)),
        "be.error.online.routeNotAllowed"
    );
    let not_an_id = request(
        "PUT",
        &[
            "v1",
            "clubs",
            "mine",
            "academy",
            "players",
            "not-a-uuid",
            "focus",
        ],
    );
    assert_eq!(
        refused(send(&session, &not_an_id, 0)),
        "be.error.online.routeNotAllowed"
    );
}

/// Given a signed-in coach,
/// when the webview reads its coins, a page of their lines from a cursor, and exchanges some with
/// no idempotency key (C-7a1),
/// then each goes out to its own route, the keyless exchange too (the server, not the proxy,
/// answers `keyRequired`); a line key the route does not take is refused.
#[test]
fn the_coin_routes_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let routes = vec![
        ("GET", vec!["v1", "me", "coins"], vec![]),
        (
            "GET",
            vec!["v1", "me", "coins", "ledger"],
            vec![("cursor", "17"), ("limit", "50")],
        ),
        ("POST", vec!["v1", "me", "coins", "exchange"], vec![]),
    ];
    let went = went_out(&server, &session, &routes);
    assert_eq!(went.len(), routes.len());
    assert_eq!(went[1].1, "/v1/me/coins/ledger?cursor=17&limit=50");

    let mut by_kind = request("GET", &["v1", "me", "coins", "ledger"]);
    by_kind.query = vec![(String::from("kind"), String::from("coin_exchange"))];
    assert_eq!(
        refused(send(&session, &by_kind, 0)),
        "be.error.online.routeNotAllowed"
    );
}

/// Given a signed-in coach,
/// when the webview reads its items, a page of their entries, previews an item on a player, a
/// style, the club and the account, uses one, reads the shop and buys (C-7b),
/// then each goes out to its own route, a target's `:` sent encoded as `%3A`.
#[test]
fn the_item_routes_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let player = format!("player:{CLUB}");
    let routes = vec![
        ("GET", vec!["v1", "me", "items"], vec![]),
        (
            "GET",
            vec!["v1", "me", "items", "entries"],
            vec![("cursor", CLUB), ("limit", "50")],
        ),
        (
            "GET",
            vec!["v1", "me", "items", "energyDrinkSmall", "preview"],
            vec![("target", player.as_str())],
        ),
        (
            "GET",
            vec!["v1", "me", "items", "tacticalNoteBasic", "preview"],
            vec![("target", "style:Balanced")],
        ),
        (
            "GET",
            vec!["v1", "me", "items", "teamRecoveryPack", "preview"],
            vec![("target", "club")],
        ),
        (
            "GET",
            vec!["v1", "me", "items", "xpBoosterX2", "preview"],
            vec![("target", "account")],
        ),
        (
            "POST",
            vec!["v1", "me", "items", "energyDrinkSmall", "use"],
            vec![],
        ),
        ("GET", vec!["v1", "shop"], vec![]),
        ("POST", vec!["v1", "shop", "purchases"], vec![]),
    ];
    let went = went_out(&server, &session, &routes);
    assert_eq!(went.len(), routes.len());
    assert_eq!(
        went[2].1,
        format!("/v1/me/items/energyDrinkSmall/preview?target=player%3A{CLUB}")
    );
    assert_eq!(
        went[3].1,
        "/v1/me/items/tacticalNoteBasic/preview?target=style%3ABalanced"
    );
    assert_eq!(
        went[6],
        (
            String::from("POST"),
            String::from("/v1/me/items/energyDrinkSmall/use")
        )
    );
}

/// Given a signed-in coach,
/// when an item route is asked with a target of two `:` or an empty half, a `:` in another key,
/// an item code outside its alphabet, or a code where an id belongs,
/// then each is refused without being sent.
#[test]
fn item_codes_and_targets_keep_their_alphabet() {
    let (server, session) = signed_in(|_| ok(json!({})));
    for target in [
        "a:b:c",
        "player:",
        ":x",
        "player:a%2Fb",
        "player:a/b",
        "player:a b",
    ] {
        let mut preview = request("GET", &["v1", "me", "items", "energyDrinkSmall", "preview"]);
        preview.query = vec![(String::from("target"), target.to_string())];
        assert_eq!(
            refused(send(&session, &preview, 0)),
            "be.error.online.routeNotAllowed",
            "{target:?}"
        );
    }
    let mut cursor = request("GET", &["v1", "me", "items", "entries"]);
    cursor.query = vec![(String::from("cursor"), String::from("a:b"))];
    assert_eq!(
        refused(send(&session, &cursor, 0)),
        "be.error.online.routeNotAllowed"
    );
    let long = "a".repeat(41);
    for code in ["EnergyDrink", "energy-drink", "1drink", long.as_str()] {
        assert_eq!(
            refused(send(
                &session,
                &request("POST", &["v1", "me", "items", code, "use"]),
                0
            )),
            "be.error.online.routeNotAllowed",
            "{code:?}"
        );
    }
    assert_eq!(
        refused(send(
            &session,
            &request("GET", &["v1", "clubs", "energyDrinkSmall"]),
            0
        )),
        "be.error.online.routeNotAllowed"
    );
    assert!(server.requests().is_empty(), "nothing was sent");
}

/// Given a signed-in coach,
/// when the webview uses the market (C-5): the open auctions with every filter and a cursor, one
/// auction, a bid, a withdrawal, the club's own market, a listing quote and a listing,
/// then each goes out to its own route; another method on an auction, an id that is not one and a
/// filter the route does not take are refused.
#[test]
fn the_market_routes_go_out() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let routes = vec![
        (
            "GET",
            vec!["v1", "auctions"],
            vec![
                ("position", "Defender"),
                ("naturalPosition", "CenterBack"),
                ("minOvr", "55"),
                ("maxOvr", "70"),
                ("maxPrice", "1500000"),
                ("maxAge", "28"),
                // Only what the level caps let the coach bid on (S-16 R16-8, C-7a2).
                ("biddable", "true"),
                (
                    "cursor",
                    "1729850000000000_0192f0c4-0000-7000-8000-0000000000cc",
                ),
                ("limit", "50"),
            ],
        ),
        ("GET", vec!["v1", "auctions", AUCTION], vec![]),
        ("POST", vec!["v1", "auctions", AUCTION, "bids"], vec![]),
        ("DELETE", vec!["v1", "auctions", AUCTION], vec![]),
        ("GET", vec!["v1", "clubs", "mine", "market"], vec![]),
        (
            "GET",
            vec!["v1", "clubs", "mine", "players", PLAYER, "listing-quote"],
            vec![],
        ),
        ("POST", vec!["v1", "clubs", "mine", "listings"], vec![]),
    ];
    let went = went_out(&server, &session, &routes);
    assert_eq!(went.len(), routes.len());
    assert_eq!(
        went[2],
        (String::from("POST"), format!("/v1/auctions/{AUCTION}/bids"))
    );

    for (method, segments) in [
        ("PUT", vec!["v1", "auctions", AUCTION]),
        ("GET", vec!["v1", "auctions", "latest"]),
        (
            "GET",
            vec!["v1", "clubs", "mine", "players", "p1", "listing-quote"],
        ),
    ] {
        assert_eq!(
            refused(send(&session, &request(method, &segments), 0)),
            "be.error.online.routeNotAllowed",
            "{method} {segments:?}"
        );
    }
    let mut by_seller = request("GET", &["v1", "auctions"]);
    by_seller.query = vec![(String::from("seller"), String::from(CLUB))];
    assert_eq!(
        refused(send(&session, &by_seller, 0)),
        "be.error.online.routeNotAllowed"
    );
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

/// Given a signed-in coach,
/// when the webview asks for a league's leaders and tries another method,
/// then it goes out to `/v1/leagues/{id}/leaders` as a GET, and the other method is refused.
#[test]
fn a_league_s_leaders_are_one_route() {
    let (server, session) = signed_in(|_| ok(json!({})));
    let path = ["v1", "leagues", CLUB, "leaders"];
    send(&session, &request("GET", &path), 0).expect("an answer");
    assert_eq!(
        refused(send(&session, &request("POST", &path), 0)),
        "be.error.online.routeNotAllowed"
    );
    let paths: Vec<String> = sent(&server).into_iter().map(|r| r.path).collect();
    assert_eq!(paths, vec![format!("/v1/leagues/{CLUB}/leaders")]);
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
