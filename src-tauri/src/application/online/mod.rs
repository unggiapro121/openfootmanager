//! The webview's only way to the online API (phase 3 E3-6c, E3-6-tech-spec.md §3.4): one proxy
//! that sends a request the route table allows, with the session's access token, and returns
//! the server's answer. The tokens never reach the webview, and the webview has no network of
//! its own (its CSP allows the IPC channel only, §3.8).

mod routes;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::coach_server::{ApiError, RawRequest, RawResponse, ServerSession};

const NOT_SIGNED_IN: &str = "be.error.online.notSignedIn";
const UNREACHABLE: &str = "be.error.online.unreachable";
const SERVER_UNEXPECTED: &str = "be.error.online.serverUnexpected";
const ROUTE_NOT_ALLOWED: &str = "be.error.online.routeNotAllowed";
/// The app runs without an account server (`OFM_SERVER_URL`), the code C-1 already uses.
const NOT_CONFIGURED: &str = "be.error.coach.serverNotConfigured";

/// What the webview asks for. Segments come unencoded, as the route names them.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineRequest {
    pub method: String,
    pub segments: Vec<String>,
    #[serde(default)]
    pub query: Vec<(String, String)>,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default)]
    pub if_match: Option<String>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

/// A successful answer.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineResponse {
    pub status: u16,
    pub body: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_revision: Option<u32>,
}

/// A failed one: the server's envelope, or the proxy's own code (`be.error.online.*`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineError {
    pub status: u16,
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_revision: Option<u32>,
}

impl OnlineError {
    pub fn of(code: &str) -> Self {
        Self {
            status: 0,
            code: code.to_string(),
            detail: None,
            details: None,
            retry_after_seconds: None,
            contract_revision: None,
        }
    }
}

/// Send `request` through the coach's server session; without a server, nothing is sent.
pub fn send_for(
    coach: &super::coach::CoachContext,
    request: &OnlineRequest,
) -> Result<OnlineResponse, OnlineError> {
    let session = coach
        .server_session()
        .ok_or_else(|| OnlineError::of(NOT_CONFIGURED))?;
    send(session, request, chrono::Utc::now().timestamp())
}

/// Send `request` through `session`. A request the route table does not allow never leaves.
pub fn send(
    session: &ServerSession,
    request: &OnlineRequest,
    now_unix: i64,
) -> Result<OnlineResponse, OnlineError> {
    let method = request.method.to_ascii_uppercase();
    let headers_plain = request
        .if_match
        .as_deref()
        .is_none_or(routes::is_plain_version)
        && request
            .idempotency_key
            .as_deref()
            .is_none_or(routes::is_plain_key);
    let route = routes::find(&method, &request.segments, &request.query)
        .filter(|_| headers_plain)
        .ok_or_else(|| OnlineError::of(ROUTE_NOT_ALLOWED))?;
    let url = routes::url_of(session.base_url(), &request.segments, &request.query)
        .ok_or_else(|| OnlineError::of(ROUTE_NOT_ALLOWED))?;
    let raw = RawRequest {
        method: &method,
        url: &url,
        body: if method == "GET" {
            None
        } else {
            request.body.as_ref()
        },
        bearer: "",
        if_match: request.if_match.as_deref(),
        idempotency_key: request.idempotency_key.as_deref(),
        timeout: route.timeout,
    };
    // Safe to send twice: a read, or a write the server answers once per key.
    let repeatable = method == "GET" || request.idempotency_key.is_some();
    let started = std::time::Instant::now();
    let outcome = session.send_authorized(now_unix, |bearer| {
        let attempt = RawRequest { bearer, ..raw };
        match session.client().send_raw(&attempt) {
            Err(ApiError::Unreachable) if repeatable => session.client().send_raw(&attempt),
            outcome => outcome,
        }
    });
    let status = outcome.as_ref().map_or(0, |answer| answer.status);
    log::info!(
        "[online] {} → {status} in {} ms",
        route.pattern(),
        started.elapsed().as_millis()
    );
    answer_of(outcome)
}

fn answer_of(outcome: Result<RawResponse, ApiError>) -> Result<OnlineResponse, OnlineError> {
    let answer = outcome.map_err(|error| match error {
        ApiError::NoSession => OnlineError::of(NOT_SIGNED_IN),
        ApiError::Unreachable => OnlineError::of(UNREACHABLE),
        ApiError::Rejected { status, code } => OnlineError {
            status,
            ..OnlineError::of(&code)
        },
    })?;
    if (200..300).contains(&answer.status) {
        return Ok(OnlineResponse {
            status: answer.status,
            body: answer.body,
            retry_after_seconds: answer.retry_after_seconds,
            contract_revision: answer.contract_revision,
        });
    }
    Err(error_of(answer))
}

/// The server's error envelope as the webview gets it; a body without a `be.error.` code is the
/// server misbehaving, not a reason a player can read.
fn error_of(answer: RawResponse) -> OnlineError {
    let code = answer
        .body
        .get("code")
        .and_then(Value::as_str)
        .filter(|code| code.starts_with("be.error."))
        .unwrap_or(SERVER_UNEXPECTED)
        .to_string();
    OnlineError {
        status: answer.status,
        detail: answer
            .body
            .get("detail")
            .and_then(Value::as_str)
            .map(str::to_string),
        details: answer.body.get("details").cloned(),
        retry_after_seconds: answer.retry_after_seconds,
        contract_revision: answer.contract_revision,
        code,
    }
}
