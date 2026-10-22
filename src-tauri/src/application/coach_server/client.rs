//! HTTP to the account server (`ofm-server`, its ARCHITECTURE.md §6): one blocking call per
//! request, and the server's error envelope turned into the translation key it carries.

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

use crate::application::coach::CoachStoreError;

/// Long enough for a busy server, short enough that one that stopped answering does not hold a
/// day's advance for long. A server that is down refuses at once and never waits this out.
const TIMEOUT: Duration = Duration::from_secs(5);
const UNEXPECTED: &str = "be.error.coach.serverUnexpected";
const NOT_LOGGED_IN: &str = "be.error.coach.notLoggedIn";

/// Why a call to the server came to nothing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiError {
    /// No answer: no connection, a timeout, or nothing listening.
    Unreachable,
    /// No session to make an authorized call with: the player has to log in.
    NoSession,
    /// The server answered with an error; `code` is its translation key.
    Rejected { status: u16, code: String },
}

impl ApiError {
    pub fn key(&self) -> String {
        match self {
            Self::Unreachable => CoachStoreError::Unreachable.key(),
            Self::NoSession => NOT_LOGGED_IN.to_string(),
            Self::Rejected { code, .. } => code.clone(),
        }
    }

    pub fn is_unauthorized(&self) -> bool {
        matches!(self, Self::Rejected { status: 401, .. })
    }

    /// Whether the server could not do its work at all, as opposed to refusing this request:
    /// the player is then told nothing counts until it is back (Y12).
    pub fn is_outage(&self) -> bool {
        match self {
            Self::Unreachable => true,
            Self::NoSession => false,
            Self::Rejected { status, .. } => *status >= 500,
        }
    }
}

impl From<ApiError> for CoachStoreError {
    fn from(error: ApiError) -> Self {
        if error.is_outage() {
            Self::Unreachable
        } else {
            Self::Failed(error.key())
        }
    }
}

/// The error envelope every failed request returns; only its key reaches the player.
#[derive(Deserialize)]
struct ErrorBody {
    code: String,
}

/// What a request needs beyond its path and body.
#[derive(Default, Clone, Copy)]
pub struct Headers<'a> {
    pub bearer: Option<&'a str>,
    pub idempotency_key: Option<&'a str>,
}

pub struct ApiClient {
    agent: ureq::Agent,
    base_url: String,
}

impl ApiClient {
    pub fn new(base_url: &str) -> Self {
        Self::with_timeout(base_url, TIMEOUT)
    }

    pub fn with_timeout(base_url: &str, timeout: Duration) -> Self {
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(timeout))
            .http_status_as_error(false)
            .build()
            .into();
        Self {
            agent,
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    pub fn get<T: DeserializeOwned>(
        &self,
        path: &str,
        headers: Headers<'_>,
    ) -> Result<T, ApiError> {
        let mut request = self.agent.get(format!("{}{path}", self.base_url));
        if let Some(token) = headers.bearer {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
        decode(request.call())
    }

    pub fn post<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
        headers: Headers<'_>,
    ) -> Result<T, ApiError> {
        let body = serde_json::to_string(body).map_err(|_| ApiError::Rejected {
            status: 0,
            code: UNEXPECTED.to_string(),
        })?;
        let mut request = self
            .agent
            .post(format!("{}{path}", self.base_url))
            .header("Content-Type", "application/json");
        if let Some(token) = headers.bearer {
            request = request.header("Authorization", format!("Bearer {token}"));
        }
        if let Some(key) = headers.idempotency_key {
            request = request.header("Idempotency-Key", key);
        }
        decode(request.send(&body))
    }
}

fn decode<T: DeserializeOwned>(
    result: Result<ureq::http::Response<ureq::Body>, ureq::Error>,
) -> Result<T, ApiError> {
    let mut response = result.map_err(|error| {
        log::warn!("[coach-server] no answer: {error}");
        ApiError::Unreachable
    })?;
    let status = response.status().as_u16();
    let text = response
        .body_mut()
        .read_to_string()
        .map_err(|_| ApiError::Unreachable)?;
    if (200..300).contains(&status) {
        // A 204 carries no body: read it as `null`, which an acknowledgement accepts.
        let text = if text.trim().is_empty() {
            "null"
        } else {
            &text
        };
        return serde_json::from_str(text).map_err(|error| {
            log::warn!("[coach-server] unreadable answer to a {status}: {error}");
            ApiError::Rejected {
                status,
                code: UNEXPECTED.to_string(),
            }
        });
    }
    let code = serde_json::from_str::<ErrorBody>(&text)
        .ok()
        .map(|body| body.code)
        .filter(|code| code.starts_with("be.error."))
        .unwrap_or_else(|| UNEXPECTED.to_string());
    Err(ApiError::Rejected { status, code })
}
