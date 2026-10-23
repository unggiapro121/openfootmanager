//! The player's session with the account server: the auth routes of its ARCHITECTURE.md §7.2, the
//! short access token kept in memory, and the rotating refresh token kept in the keychain (Z3).
//!
//! The refresh token lives **only** in the keychain (E3-6 E6-20): read just before each refresh,
//! written the moment a new one arrives. A copy in memory could go stale while another copy of the
//! app rotated the token, and presenting it later would end the session everywhere.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use domain::coach::{CoachAccount, CoachRegion};
use serde::de::{DeserializeOwned, IgnoredAny};
use serde::{Deserialize, Serialize};

use super::client::{ApiClient, ApiError, Headers, RawResponse};
use super::vault::RefreshTokenVault;

/// An access token this close to its end is refreshed first rather than sent to be refused.
const EXPIRY_MARGIN_SECONDS: i64 = 30;
/// The server's answer to a refresh token presented again just after its rotation, most likely
/// by a second copy of the app: the session is kept, and the token that replaced it is in the
/// keychain, or about to be.
const REFRESH_RACED: &str = "be.error.auth.refreshRaced";

/// How long to wait after a raced refresh before reading the keychain again: long enough for the
/// other copy to have written its new token, a little different each time (300–500 ms).
fn race_pause() -> Duration {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.subsec_nanos());
    Duration::from_millis(300 + u64::from(nanos % 201))
}

/// The account as the server returns it with a login (`AccountView`). Its status and
/// capabilities do not concern the game.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerAccount {
    pub id: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: String,
    pub nationality: String,
    pub region: CoachRegion,
}

impl ServerAccount {
    /// The account as the rest of the game knows a coach. The server keeps when it was made;
    /// nothing in the game reads that.
    pub fn into_coach_account(self, logged_in_at: &str) -> CoachAccount {
        CoachAccount {
            id: self.id,
            first_name: self.first_name,
            last_name: self.last_name,
            date_of_birth: self.date_of_birth,
            nationality: self.nationality,
            region: self.region,
            created_at: String::new(),
            last_login_at: Some(logged_in_at.to_string()),
        }
    }
}

/// `POST /v1/auth/register`: who the coach is, and how they log in.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterRequest {
    pub email: String,
    pub password: String,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: String,
    pub nationality: String,
    pub region: CoachRegion,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenPair {
    access_token: String,
    access_token_expires_at: String,
    refresh_token: String,
    account: ServerAccount,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmailBody<'a> {
    email: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TokenBody<'a> {
    token: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginBody<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshBody<'a> {
    refresh_token: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResetBody<'a> {
    token: &'a str,
    new_password: &'a str,
}

/// The access token; the refresh token is never kept here (see the module comment).
struct Tokens {
    access: String,
    access_expires_unix: i64,
}

pub struct ServerSession {
    client: ApiClient,
    vault: Box<dyn RefreshTokenVault>,
    /// Held across a refresh. The server rotates the refresh token and takes a second use of one
    /// as theft, logging the account out everywhere (Z3), so two refreshes in this process must
    /// never race: a call that waited for the lock finds the new access token and uses it.
    tokens: Mutex<Option<Tokens>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // Each write under this lock replaces the whole value, so a panic elsewhere spoils nothing.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl ServerSession {
    pub fn new(client: ApiClient, vault: Box<dyn RefreshTokenVault>) -> Self {
        Self {
            client,
            vault,
            tokens: Mutex::new(None),
        }
    }

    /// The HTTP client, for the online proxy's requests.
    pub fn client(&self) -> &ApiClient {
        &self.client
    }

    /// The server's base URL.
    pub fn base_url(&self) -> &str {
        self.client.base_url()
    }

    /// Make the account. It cannot log in until its email is verified with the code sent there.
    pub fn register(&self, request: &RegisterRequest) -> Result<(), ApiError> {
        self.post_public::<_, IgnoredAny>("/v1/auth/register", request)
            .map(|_| ())
    }

    pub fn verify_email(&self, code: &str) -> Result<(), ApiError> {
        self.post_public::<_, IgnoredAny>("/v1/auth/verify-email", &TokenBody { token: code })
            .map(|_| ())
    }

    /// Ask for a fresh code. The server answers the same whether or not the address has an
    /// account, so neither does the game.
    pub fn resend_verification(&self, email: &str) -> Result<(), ApiError> {
        self.post_public::<_, IgnoredAny>("/v1/auth/resend-verification", &EmailBody { email })
            .map(|_| ())
    }

    pub fn forgot_password(&self, email: &str) -> Result<(), ApiError> {
        self.post_public::<_, IgnoredAny>("/v1/auth/forgot-password", &EmailBody { email })
            .map(|_| ())
    }

    pub fn reset_password(&self, code: &str, new_password: &str) -> Result<(), ApiError> {
        let body = ResetBody {
            token: code,
            new_password,
        };
        self.post_public::<_, IgnoredAny>("/v1/auth/reset-password", &body)
            .map(|_| ())
    }

    pub fn login(&self, email: &str, password: &str) -> Result<ServerAccount, ApiError> {
        let pair: TokenPair = self.post_public("/v1/auth/login", &LoginBody { email, password })?;
        Ok(self.keep(&mut lock(&self.tokens), pair))
    }

    /// The account of the refresh token kept from an earlier run, or `None` when there is none or
    /// the server no longer takes it.
    pub fn resume(&self) -> Result<Option<ServerAccount>, ApiError> {
        let mut tokens = lock(&self.tokens);
        match self.refresh(&mut tokens) {
            Ok(account) => Ok(Some(account)),
            Err(ApiError::NoSession) => Ok(None),
            Err(error) if error.is_unauthorized() => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// End the session here and on the server. A server out of reach only keeps a refresh token
    /// that this machine has already forgotten until it expires.
    pub fn logout(&self) {
        let mut tokens = lock(&self.tokens);
        tokens.take();
        let refresh = self.vault.load();
        self.vault.clear();
        if let Some(refresh) = refresh {
            let body = RefreshBody {
                refresh_token: &refresh,
            };
            if let Err(error) = self.post_public::<_, IgnoredAny>("/v1/auth/logout", &body) {
                log::warn!("[coach-server] logout not confirmed: {}", error.key());
            }
        }
    }

    pub fn get_authorized<T: DeserializeOwned>(
        &self,
        path: &str,
        now_unix: i64,
    ) -> Result<T, ApiError> {
        self.authorized(now_unix, |bearer| {
            self.client.get(
                path,
                Headers {
                    bearer: Some(bearer),
                    idempotency_key: None,
                },
            )
        })
    }

    pub fn post_authorized<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
        idempotency_key: &str,
        now_unix: i64,
    ) -> Result<T, ApiError> {
        self.authorized(now_unix, |bearer| {
            self.client.post(
                path,
                body,
                Headers {
                    bearer: Some(bearer),
                    idempotency_key: Some(idempotency_key),
                },
            )
        })
    }

    /// `send` with a live access token, once more with a fresh one if the answer is 401; the
    /// answer is returned whatever its status (the online proxy, E3-6c).
    pub fn send_authorized(
        &self,
        now_unix: i64,
        send: impl Fn(&str) -> Result<RawResponse, ApiError>,
    ) -> Result<RawResponse, ApiError> {
        let bearer = self.access_token(now_unix)?;
        let first = send(&bearer)?;
        if first.status != 401 {
            return Ok(first);
        }
        send(&self.access_token_after(&bearer)?)
    }

    fn post_public<B: Serialize, T: DeserializeOwned>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, ApiError> {
        self.client.post(path, body, Headers::default())
    }

    /// `call` with a live access token; once more with a fresh one if the server refused it, as it
    /// does at once for an account locked since the token was issued.
    fn authorized<T>(
        &self,
        now_unix: i64,
        call: impl Fn(&str) -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let bearer = self.access_token(now_unix)?;
        match call(&bearer) {
            Err(error) if error.is_unauthorized() => call(&self.access_token_after(&bearer)?),
            outcome => outcome,
        }
    }

    fn access_token(&self, now_unix: i64) -> Result<String, ApiError> {
        let mut tokens = lock(&self.tokens);
        if let Some(live) = tokens.as_ref() {
            if live
                .access_expires_unix
                .saturating_sub(EXPIRY_MARGIN_SECONDS)
                > now_unix
            {
                return Ok(live.access.clone());
            }
        }
        self.refresh(&mut tokens)?;
        tokens
            .as_ref()
            .map(|tokens| tokens.access.clone())
            .ok_or(ApiError::NoSession)
    }

    /// A fresh access token after `refused` was refused, unless another call already refreshed.
    fn access_token_after(&self, refused: &str) -> Result<String, ApiError> {
        let mut tokens = lock(&self.tokens);
        if let Some(live) = tokens.as_ref() {
            if live.access != refused {
                return Ok(live.access.clone());
            }
        }
        self.refresh(&mut tokens)?;
        tokens
            .as_ref()
            .map(|tokens| tokens.access.clone())
            .ok_or(ApiError::NoSession)
    }

    /// A fresh pair. A refresh refused as a race (another copy of the app rotated the token a
    /// moment ago) is tried once more with what the keychain holds after a short wait; refused
    /// again, this copy is logged out but the keychain is left to the other one.
    fn refresh(&self, tokens: &mut Option<Tokens>) -> Result<ServerAccount, ApiError> {
        match self.refresh_once(tokens) {
            Err(error) if is_raced(&error) => {
                std::thread::sleep(race_pause());
                match self.refresh_once(tokens) {
                    Err(error) if is_raced(&error) => {
                        log::warn!("[coach-server] refresh raced twice; logged out here");
                        *tokens = None;
                        Err(ApiError::NoSession)
                    }
                    outcome => outcome,
                }
            }
            outcome => outcome,
        }
    }

    fn refresh_once(&self, tokens: &mut Option<Tokens>) -> Result<ServerAccount, ApiError> {
        let refresh = self.vault.load().ok_or(ApiError::NoSession)?;
        let body = RefreshBody {
            refresh_token: &refresh,
        };
        match self.post_public::<_, TokenPair>("/v1/auth/refresh", &body) {
            Ok(pair) => Ok(self.keep(tokens, pair)),
            Err(error) => {
                if error.is_unauthorized() && !is_raced(&error) {
                    // Expired, revoked, or reused: the session is over and the player logs in again.
                    *tokens = None;
                    self.vault.clear();
                }
                Err(error)
            }
        }
    }

    fn keep(&self, tokens: &mut Option<Tokens>, pair: TokenPair) -> ServerAccount {
        self.vault.store(&pair.refresh_token);
        // An expiry that cannot be read is treated as already past: the next call refreshes.
        let access_expires_unix =
            chrono::DateTime::parse_from_rfc3339(&pair.access_token_expires_at)
                .map(|at| at.timestamp())
                .unwrap_or(i64::MIN);
        *tokens = Some(Tokens {
            access: pair.access_token,
            access_expires_unix,
        });
        pair.account
    }
}

fn is_raced(error: &ApiError) -> bool {
    matches!(error, ApiError::Rejected { status: 401, code } if code == REFRESH_RACED)
}
