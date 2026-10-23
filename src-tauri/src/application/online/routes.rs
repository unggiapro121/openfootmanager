//! The routes of the online API the game's webview may call through the proxy (E3-6-tech-spec.md
//! §3.4, E6-13), and the checks a request passes before it is sent. Nothing here decodes: the
//! webview sends segments as they are, in a narrow alphabet, and the URL is built from them.

use std::time::Duration;

/// One piece of a route's path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Part {
    /// This exact segment.
    Literal(&'static str),
    /// A UUID (a club, a league, a fixture).
    Id,
}

/// A route a coach may call: its method, its path, the query keys it takes, how long to wait.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Route {
    pub method: &'static str,
    pub path: &'static [Part],
    pub query: &'static [&'static str],
    pub timeout: Duration,
}

impl Route {
    /// The path as logs show it, ids as `:id`: never the ids themselves.
    pub fn pattern(&self) -> String {
        let parts: Vec<&str> = self
            .path
            .iter()
            .map(|part| match part {
                Part::Literal(text) => text,
                Part::Id => ":id",
            })
            .collect();
        format!("{} /{}", self.method, parts.join("/"))
    }
}

/// The default wait (Qe6-3): longer than the 5 s of C-1, as taking a club locks the account in
/// a transaction. A route that needs another value says so in its row.
const WAIT: Duration = Duration::from_secs(10);

use Part::{Id, Literal as L};

/// Every route the proxy lets through. `/v1/auth/*` (the login commands own the tokens),
/// `/v1/coach/*` (the progress store) and `/v1/admin/*` are deliberately absent.
pub const ROUTES: &[Route] = &[
    route("GET", &[L("v1"), L("me")], &[]),
    route("PATCH", &[L("v1"), L("me")], &[]),
    route("GET", &[L("v1"), L("season")], &[]),
    route("POST", &[L("v1"), L("clubs"), L("takeover")], &[]),
    route("GET", &[L("v1"), L("clubs"), L("mine")], &[]),
    route("GET", &[L("v1"), L("clubs"), L("mine"), L("fixtures")], &[]),
    route("PATCH", &[L("v1"), L("clubs"), L("mine")], &[]),
    route("PUT", &[L("v1"), L("clubs"), L("mine"), L("setup")], &[]),
    route("PUT", &[L("v1"), L("clubs"), L("mine"), L("training")], &[]),
    route("GET", &[L("v1"), L("clubs"), Id], &[]),
    route("GET", &[L("v1"), L("leagues"), L("mine")], &[]),
    route("GET", &[L("v1"), L("leagues"), Id], &[]),
    route(
        "GET",
        &[L("v1"), L("leagues"), Id, L("fixtures")],
        &["round"],
    ),
    route("GET", &[L("v1"), L("fixtures"), Id], &[]),
    // A live match (S-8e): its view (at a step for a replay, C-2e), the coach's own side, its
    // frames, the coach's orders.
    route("GET", &[L("v1"), L("matches"), Id], &["atSeq"]),
    route("GET", &[L("v1"), L("matches"), Id, L("mine")], &[]),
    route(
        "GET",
        &[L("v1"), L("matches"), Id, L("frames")],
        &["afterSeq", "limit"],
    ),
    route("POST", &[L("v1"), L("matches"), Id, L("commands")], &[]),
    // Friendlies (S-12): the coach's seat and room, the room's actions, the queue. The room's code
    // goes in the body of a join, never in the path.
    route("GET", &[L("v1"), L("friendlies"), L("mine")], &[]),
    route("POST", &[L("v1"), L("friendlies"), L("rooms")], &[]),
    route(
        "POST",
        &[L("v1"), L("friendlies"), L("rooms"), L("join")],
        &[],
    ),
    route(
        "POST",
        &[L("v1"), L("friendlies"), L("rooms"), L("mine"), L("ready")],
        &[],
    ),
    route(
        "POST",
        &[L("v1"), L("friendlies"), L("rooms"), L("mine"), L("leave")],
        &[],
    ),
    route(
        "POST",
        &[
            L("v1"),
            L("friendlies"),
            L("rooms"),
            L("mine"),
            L("rematch"),
        ],
        &[],
    ),
    route("POST", &[L("v1"), L("friendlies"), L("queue")], &[]),
    route("DELETE", &[L("v1"), L("friendlies"), L("queue")], &[]),
];

const fn route(
    method: &'static str,
    path: &'static [Part],
    query: &'static [&'static str],
) -> Route {
    Route {
        method,
        path,
        query,
        timeout: WAIT,
    }
}

/// A segment as the proxy takes it: letters, digits and `-`, 1 to 64 of them. No `%`, `.`, `/`,
/// `\`, `;` or space can be in one, so no encoded or dotted trick reaches the URL.
fn is_plain_segment(segment: &str) -> bool {
    (1..=64).contains(&segment.len())
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// A query value: letters, digits, `.`, `_` and `-`, 1 to 200 of them.
fn is_plain_value(value: &str) -> bool {
    (1..=200).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn part_matches(part: Part, segment: &str) -> bool {
    match part {
        Part::Literal(text) => text == segment,
        Part::Id => is_uuid(segment),
    }
}

/// The hyphenated form the server's ids take: 8-4-4-4-12 hex digits.
fn is_uuid(segment: &str) -> bool {
    let groups: Vec<&str> = segment.split('-').collect();
    groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(group, length)| {
            group.len() == length && group.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

/// The route `method` and `segments` name, when every segment is plain and the query keys are
/// the route's own (each at most once, each value plain).
pub fn find(
    method: &str,
    segments: &[String],
    query: &[(String, String)],
) -> Option<&'static Route> {
    if !segments.iter().all(|segment| is_plain_segment(segment)) {
        return None;
    }
    let route = ROUTES.iter().find(|route| {
        route.method == method
            && route.path.len() == segments.len()
            && route
                .path
                .iter()
                .zip(segments)
                .all(|(part, segment)| part_matches(*part, segment))
    })?;
    let mut seen = Vec::new();
    for (key, value) in query {
        if !route.query.contains(&key.as_str()) || seen.contains(key) || !is_plain_value(value) {
            return None;
        }
        seen.push(key.clone());
    }
    Some(route)
}

/// `If-Match`: the club version a coach read, digits only.
pub fn is_plain_version(version: &str) -> bool {
    (1..=20).contains(&version.len()) && version.bytes().all(|byte| byte.is_ascii_digit())
}

/// `Idempotency-Key`: what the webview makes (a UUID), in the segment alphabet.
pub fn is_plain_key(key: &str) -> bool {
    is_plain_segment(key)
}

/// The URL of `segments` and `query` on `base`, built by the URL type, never by joining strings.
pub fn url_of(base: &str, segments: &[String], query: &[(String, String)]) -> Option<url::Url> {
    let mut url = url::Url::parse(base).ok()?;
    url.path_segments_mut()
        .ok()?
        .pop_if_empty()
        .extend(segments);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(
            query
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        );
    }
    Some(url)
}
