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
    // The coach's own picture: sent, read back and taken away.
    route("GET", &[L("v1"), L("me"), L("avatar-image")], &[]),
    route("PUT", &[L("v1"), L("me"), L("avatar-image")], &[]),
    route("DELETE", &[L("v1"), L("me"), L("avatar-image")], &[]),
    // The coach's online career and the road ahead, for his profile.
    route("GET", &[L("v1"), L("me"), L("career")], &[]),
    route("GET", &[L("v1"), L("season")], &[]),
    route("POST", &[L("v1"), L("clubs"), L("takeover")], &[]),
    route("GET", &[L("v1"), L("clubs"), L("mine")], &[]),
    route("GET", &[L("v1"), L("clubs"), L("mine"), L("fixtures")], &[]),
    route("PATCH", &[L("v1"), L("clubs"), L("mine")], &[]),
    // The club's stadium renamed.
    route(
        "PATCH",
        &[L("v1"), L("clubs"), L("mine"), L("stadium")],
        &[],
    ),
    // A player of the coach's club renamed (S-14).
    route("PATCH", &[L("v1"), L("players"), Id, L("name")], &[]),
    // A player's shirt number set, swapped or cleared.
    route("PATCH", &[L("v1"), L("players"), Id, L("shirt")], &[]),
    // What letting a player go now would cost, and the release itself (severance, then a free agent).
    route(
        "GET",
        &[
            L("v1"),
            L("clubs"),
            L("mine"),
            L("players"),
            Id,
            L("release-quote"),
        ],
        &[],
    ),
    route(
        "POST",
        &[
            L("v1"),
            L("clubs"),
            L("mine"),
            L("players"),
            Id,
            L("release"),
        ],
        &[],
    ),
    // A player's face, own picture and nationality.
    route("PATCH", &[L("v1"), L("players"), Id, L("avatar")], &[]),
    route("GET", &[L("v1"), L("players"), Id, L("avatar-image")], &[]),
    route("PUT", &[L("v1"), L("players"), Id, L("avatar-image")], &[]),
    route(
        "DELETE",
        &[L("v1"), L("players"), Id, L("avatar-image")],
        &[],
    ),
    route("PATCH", &[L("v1"), L("players"), Id, L("nationality")], &[]),
    // The session a player trains alone, whatever his group does.
    route(
        "PATCH",
        &[L("v1"), L("players"), Id, L("training-focus")],
        &[],
    ),
    route("PUT", &[L("v1"), L("clubs"), L("mine"), L("setup")], &[]),
    route("PUT", &[L("v1"), L("clubs"), L("mine"), L("training")], &[]),
    // The coach's licence (S-9): the notice of what the server fitted, and the table of licences.
    route(
        "DELETE",
        &[L("v1"), L("clubs"), L("mine"), L("licence-notice")],
        &[],
    ),
    route("GET", &[L("v1"), L("licences")], &[]),
    route("GET", &[L("v1"), L("clubs"), Id], &[]),
    route("GET", &[L("v1"), L("leagues"), L("mine")], &[]),
    route("GET", &[L("v1"), L("leagues"), Id], &[]),
    route("GET", &[L("v1"), L("leagues"), Id, L("leaders")], &[]),
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
    // The coach's inbox: a page at a time, a message or all read, a message or the read ones gone.
    route("GET", &[L("v1"), L("inbox")], &["before", "limit"]),
    route("POST", &[L("v1"), L("inbox"), L("read")], &[]),
    route("POST", &[L("v1"), L("inbox"), Id, L("read")], &[]),
    route("DELETE", &[L("v1"), L("inbox")], &[]),
    route("DELETE", &[L("v1"), L("inbox"), Id], &[]),
    // The club's money (S-10, C-5a): what it holds, its ledger a page at a time, its facilities
    // and an upgrade of each of the three.
    route("GET", &[L("v1"), L("clubs"), L("mine"), L("finance")], &[]),
    route(
        "GET",
        &[L("v1"), L("clubs"), L("mine"), L("ledger")],
        &["cursor", "limit"],
    ),
    route(
        "GET",
        &[L("v1"), L("clubs"), L("mine"), L("facilities")],
        &[],
    ),
    upgrade(&FACILITY_UPGRADES[0]),
    upgrade(&FACILITY_UPGRADES[1]),
    upgrade(&FACILITY_UPGRADES[2]),
    // The auction market (S-11, C-5b): the open auctions by the market's filters, one auction, a
    // bid and a withdrawal, the club's own market, the quote and the listing of a player.
    route(
        "GET",
        &[L("v1"), L("auctions")],
        &[
            "position",
            "naturalPosition",
            "minOvr",
            "maxOvr",
            "maxPrice",
            "maxAge",
            "cursor",
            "limit",
        ],
    ),
    route("GET", &[L("v1"), L("auctions"), Id], &[]),
    route("POST", &[L("v1"), L("auctions"), Id, L("bids")], &[]),
    route("DELETE", &[L("v1"), L("auctions"), Id], &[]),
    route("GET", &[L("v1"), L("clubs"), L("mine"), L("market")], &[]),
    route(
        "GET",
        &[
            L("v1"),
            L("clubs"),
            L("mine"),
            L("players"),
            Id,
            L("listing-quote"),
        ],
        &[],
    ),
    route(
        "POST",
        &[L("v1"), L("clubs"), L("mine"), L("listings")],
        &[],
    ),
];

/// The paths of the three facility upgrades (S-10b): one literal per facility, as the path takes
/// no other.
const FACILITY_UPGRADES: [[Part; 6]; 3] = [
    facility_upgrade("training"),
    facility_upgrade("medical"),
    facility_upgrade("scouting"),
];

const fn facility_upgrade(facility: &'static str) -> [Part; 6] {
    [
        L("v1"),
        L("clubs"),
        L("mine"),
        L("facilities"),
        L(facility),
        L("upgrade"),
    ]
}

const fn upgrade(path: &'static [Part; 6]) -> Route {
    route("POST", path, &[])
}

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
