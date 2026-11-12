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
    /// The server answered with an error; `code` is its translation key, `params` what it is
    /// translated with (`details.params`), in the server's order.
    Rejected {
        status: u16,
        code: String,
        params: Vec<(String, String)>,
    },
}

/// `code?name=value&…`: the form the webview's `resolveBackendError` translates, parameters
/// included, as it does the online client's errors (`src/online/errors.ts` `messageOf`).
fn with_params(code: &str, params: &[(String, String)]) -> String {
    if params.is_empty() {
        return code.to_string();
    }
    let query: String = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(params)
        .finish();
    format!("{code}?{query}")
}

impl ApiError {
    /// A refusal without parameters: one the game makes up itself, not the server's.
    fn unexpected(status: u16) -> Self {
        Self::Rejected {
            status,
            code: UNEXPECTED.to_string(),
            params: Vec::new(),
        }
    }

    /// The translation key, with the server's parameters when it sent any.
    pub fn key(&self) -> String {
        match self {
            Self::Unreachable => CoachStoreError::Unreachable.key(),
            Self::NoSession => NOT_LOGGED_IN.to_string(),
            Self::Rejected { code, params, .. } => with_params(code, params),
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
    #[serde(default)]
    details: Option<ErrorDetails>,
}

#[derive(Deserialize)]
struct ErrorDetails {
    #[serde(default)]
    params: serde_json::Map<String, serde_json::Value>,
}

/// The parameters a code is translated with: strings and numbers, as the online client keeps them.
fn params_of(details: Option<ErrorDetails>) -> Vec<(String, String)> {
    details
        .map(|details| details.params)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(name, value)| match value {
            serde_json::Value::String(text) => Some((name, text)),
            serde_json::Value::Number(number) => Some((name, number.to_string())),
            _ => None,
        })
        .collect()
}

/// What a request needs beyond its path and body.
#[derive(Default, Clone, Copy)]
pub struct Headers<'a> {
    pub bearer: Option<&'a str>,
    pub idempotency_key: Option<&'a str>,
}

/// A request the online proxy sends as it is (E3-6c): the method, the URL built from checked
/// segments, and only the headers allowed through.
pub struct RawRequest<'a> {
    pub method: &'a str,
    pub url: &'a url::Url,
    pub body: Option<&'a serde_json::Value>,
    pub bearer: &'a str,
    pub if_match: Option<&'a str>,
    pub idempotency_key: Option<&'a str>,
    pub timeout: Duration,
}

/// Whatever the server answered, error or not, with the headers the client reads.
#[derive(Debug, Clone, PartialEq)]
pub struct RawResponse {
    pub status: u16,
    /// `null` for an empty body; the text as a string when it is not JSON.
    pub body: serde_json::Value,
    pub retry_after_seconds: Option<u64>,
    pub contract_revision: Option<u32>,
}

/// The header that carries the server's contract revision (`contract::CONTRACT_REVISION_HEADER`).
const CONTRACT_REVISION_HEADER: &str = "ofm-contract-revision";

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

    /// The server's base URL, which the online proxy builds its URLs on.
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Send `request` and return the answer whatever its status; only no answer at all is an
    /// error.
    pub fn send_raw(&self, request: &RawRequest<'_>) -> Result<RawResponse, ApiError> {
        let mut builder = ureq::http::Request::builder()
            .method(request.method)
            .uri(request.url.as_str())
            .header("Authorization", format!("Bearer {}", request.bearer));
        if let Some(version) = request.if_match {
            builder = builder.header("If-Match", version);
        }
        if let Some(key) = request.idempotency_key {
            builder = builder.header("Idempotency-Key", key);
        }
        let body = match request.body {
            Some(value) => {
                builder = builder.header("Content-Type", "application/json");
                value.to_string()
            }
            None => String::new(),
        };
        let http = builder.body(body).map_err(|_| ApiError::unexpected(0))?;
        let http = self
            .agent
            .configure_request(http)
            .timeout_global(Some(request.timeout))
            .build();
        let mut response = self.agent.run(http).map_err(|error| {
            log::warn!("[online] no answer: {error}");
            ApiError::Unreachable
        })?;
        let header_number = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
        };
        let retry_after_seconds = header_number("retry-after");
        let contract_revision =
            header_number(CONTRACT_REVISION_HEADER).and_then(|value| u32::try_from(value).ok());
        let status = response.status().as_u16();
        let text = response
            .body_mut()
            .read_to_string()
            .map_err(|_| ApiError::Unreachable)?;
        let body = if text.trim().is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text))
        };
        Ok(RawResponse {
            status,
            body,
            retry_after_seconds,
            contract_revision,
        })
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
        let body = serde_json::to_string(body).map_err(|_| ApiError::unexpected(0))?;
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
            ApiError::unexpected(status)
        });
    }
    match serde_json::from_str::<ErrorBody>(&text) {
        Ok(body) if body.code.starts_with("be.error.") => Err(ApiError::Rejected {
            status,
            code: body.code,
            params: params_of(body.details),
        }),
        _ => Err(ApiError::unexpected(status)),
    }
}
