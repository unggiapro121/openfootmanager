//! The realtime client (phase 3 S-8e, S-8-tech-spec.md §3.10): one WebSocket to the online
//! gateway for the whole app, opened with the session's access token, which never reaches the
//! webview. Screens follow a channel (`match:<id>`, `league:<id>`, `auction:<id>`, `account:<id>`) through
//! `online_watch` and get its messages on a `tauri::ipc::Channel` of their own.
//!
//! The client remembers, for every watch, the last step it handed over. When the connection
//! drops it reconnects after 1, 2, 4 … up to 30 s and subscribes each channel again from there,
//! so a screen hears every frame once and in order. About a minute before the token expires it
//! sends a fresh one on the open connection; a token that lapsed anyway (4001) is replaced and
//! the connection made again; an account locked or signed out (4003, or no token to be had)
//! ends the connection, told to the screens as `be.error.online.notSignedIn`.

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::{self, Message};

const NOT_SIGNED_IN: &str = "be.error.online.notSignedIn";
const ROUTE_NOT_ALLOWED: &str = "be.error.online.routeNotAllowed";
/// The app runs without an account server, the code C-1 already uses.
const NOT_CONFIGURED: &str = "be.error.coach.serverNotConfigured";

/// The gateway's close codes (the server's `contract::live::close`).
const TOKEN_EXPIRED: u16 = 4001;
const ACCOUNT_REVOKED: u16 = 4003;

/// Where the gateway is: `OFM_REALTIME_URL` when set (at run time, or when the app was built),
/// otherwise the account server's host with `ws`/`wss` and `/v1/realtime`, as behind one proxy.
pub const REALTIME_URL_ENV: &str = "OFM_REALTIME_URL";

pub fn configured_realtime_url() -> Option<String> {
    let explicit = std::env::var(REALTIME_URL_ENV)
        .ok()
        .or_else(|| option_env!("OFM_REALTIME_URL").map(str::to_string))
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    explicit.or_else(|| {
        super::coach_server::configured_server_url().and_then(|base| realtime_url_of(&base))
    })
}

/// The gateway's URL beside the API at `base`.
pub fn realtime_url_of(base: &str) -> Option<String> {
    let mut url = url::Url::parse(base).ok()?;
    let scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => return None,
    };
    url.set_scheme(scheme).ok()?;
    url.set_path("/v1/realtime");
    url.set_query(None);
    Some(url.to_string())
}

/// What a screen is told about the channel it follows.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RealtimeMessage {
    /// One step of a match, after the last one this watch was handed (`contract::live::MatchFrame`).
    Frame {
        channel: String,
        seq: u32,
        data: Value,
    },
    /// A league changed: read it again.
    Notice { channel: String, data: Value },
    /// The connection's state; `code` says why it closed for good.
    Status {
        state: ConnectionState,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },
    /// The gateway refused something about this channel (`be.error.realtime.*`).
    Error { channel: String, code: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Connecting,
    Open,
    Reconnecting,
    /// Not connected, and not trying: no account, or it was locked.
    Closed,
}

/// Why no token could be had.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenFailure {
    /// No one is signed in, or the server no longer takes the session.
    NotSignedIn,
    /// The server could not be reached: try again later.
    Unreachable,
}

/// The session's access tokens, as the client needs them.
pub trait TokenSource: Send + Sync + 'static {
    /// A token good for at least `seconds` more, and its expiry (unix seconds). It may block on
    /// a refresh, so the client calls it off the async threads.
    fn token(&self, seconds: i64) -> Result<(String, i64), TokenFailure>;
}

impl TokenSource for super::coach::CoachContext {
    fn token(&self, seconds: i64) -> Result<(String, i64), TokenFailure> {
        let session = self.server_session().ok_or(TokenFailure::NotSignedIn)?;
        session
            .access_token_lasting(chrono::Utc::now().timestamp(), seconds)
            .map_err(|error| match error {
                super::coach_server::ApiError::NoSession => TokenFailure::NotSignedIn,
                error if error.is_unauthorized() => TokenFailure::NotSignedIn,
                _ => TokenFailure::Unreachable,
            })
    }
}

/// How the client paces itself.
#[derive(Debug, Clone, Copy)]
pub struct Settings {
    pub first_backoff: Duration,
    pub max_backoff: Duration,
    /// How long before the token expires a fresh one is sent.
    pub renew_before: Duration,
    /// How often the client pings an idle connection.
    pub ping_every: Duration,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            first_backoff: Duration::from_secs(1),
            max_backoff: Duration::from_secs(30),
            renew_before: Duration::from_secs(60),
            ping_every: Duration::from_secs(30),
        }
    }
}

/// Where a watch's messages go.
pub type Sink = Arc<dyn Fn(RealtimeMessage) + Send + Sync>;

struct Watch {
    channel: String,
    /// The last step handed to this watch (match channels).
    delivered: u32,
    sink: Sink,
}

enum Command {
    Subscribe { channel: String, last_seq: u32 },
    Unsubscribe { channel: String },
    Stop,
}

struct Inner {
    next_id: u64,
    watches: BTreeMap<u64, Watch>,
    /// The connection task's queue, while one runs.
    link: Option<mpsc::UnboundedSender<Command>>,
}

pub struct Realtime {
    url: Option<String>,
    tokens: Arc<dyn TokenSource>,
    settings: Settings,
    inner: Mutex<Inner>,
}

fn lock(inner: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    inner.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A channel name a screen may follow: `match:<uuid>`, `league:<uuid>`, an `auction:<uuid>`
/// (S11-11, C-5b), or the coach's own `account:<uuid>` (S-12; the gateway refuses another
/// account's).
fn is_channel(name: &str) -> bool {
    let Some((kind, id)) = name.split_once(':') else {
        return false;
    };
    matches!(kind, "match" | "league" | "auction" | "account") && is_uuid(id)
}

fn is_uuid(text: &str) -> bool {
    let groups: Vec<&str> = text.split('-').collect();
    groups.len() == 5
        && groups.iter().zip([8, 4, 4, 4, 12]).all(|(group, length)| {
            group.len() == length
                && group
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
}

impl Realtime {
    pub fn new(url: Option<String>, tokens: Arc<dyn TokenSource>, settings: Settings) -> Self {
        Self {
            url,
            tokens,
            settings,
            inner: Mutex::new(Inner {
                next_id: 1,
                watches: BTreeMap::new(),
                link: None,
            }),
        }
    }

    /// Follow `channel` from `last_seq` (a match's frames after that step; 0 from kick-off),
    /// handing each message to `sink`; the watch's id, for `unwatch`.
    pub fn watch(
        self: &Arc<Self>,
        channel: &str,
        last_seq: Option<u32>,
        sink: Sink,
    ) -> Result<u64, &'static str> {
        if self.url.is_none() {
            return Err(NOT_CONFIGURED);
        }
        if !is_channel(channel) {
            return Err(ROUTE_NOT_ALLOWED);
        }
        let last_seq = last_seq.unwrap_or(0);
        let mut inner = lock(&self.inner);
        let id = inner.next_id;
        inner.next_id += 1;
        // The channel's subscription starts from the earliest step any watch of it needs.
        let followed_from = inner
            .watches
            .values()
            .filter(|watch| watch.channel == channel)
            .map(|watch| watch.delivered)
            .min();
        inner.watches.insert(
            id,
            Watch {
                channel: channel.to_string(),
                delivered: last_seq,
                sink,
            },
        );
        let resubscribe = followed_from.is_none_or(|from| last_seq < from);
        match &inner.link {
            Some(link) => {
                if resubscribe {
                    // Lost only if the task is ending: its next connection subscribes anew.
                    if link
                        .send(Command::Subscribe {
                            channel: channel.to_string(),
                            last_seq,
                        })
                        .is_err()
                    {
                        log::debug!("[realtime] the connection task is ending");
                    }
                }
            }
            None => {
                let (link, commands) = mpsc::unbounded_channel();
                inner.link = Some(link.clone());
                let realtime = Arc::clone(self);
                tauri::async_runtime::spawn(async move { realtime.run(link, commands).await });
            }
        }
        Ok(id)
    }

    /// Stop the watch `id`. The last watch of a channel leaves it; the last watch of all closes
    /// the connection.
    pub fn unwatch(&self, id: u64) {
        let mut inner = lock(&self.inner);
        let Some(watch) = inner.watches.remove(&id) else {
            return;
        };
        let still_followed = inner.watches.values().any(|w| w.channel == watch.channel);
        let command = if inner.watches.is_empty() {
            inner.link.take().map(|link| (link, Command::Stop))
        } else if still_followed {
            None
        } else {
            inner.link.clone().map(|link| {
                (
                    link,
                    Command::Unsubscribe {
                        channel: watch.channel,
                    },
                )
            })
        };
        if let Some((link, command)) = command {
            if link.send(command).is_err() {
                log::debug!("[realtime] the connection task has ended");
            }
        }
    }

    /// Every channel followed now, from the earliest step any of its watches needs.
    fn wanted(&self) -> BTreeMap<String, u32> {
        let inner = lock(&self.inner);
        let mut wanted: BTreeMap<String, u32> = BTreeMap::new();
        for watch in inner.watches.values() {
            wanted
                .entry(watch.channel.clone())
                .and_modify(|from| *from = (*from).min(watch.delivered))
                .or_insert(watch.delivered);
        }
        wanted
    }

    /// Tell every watch of `channel` (all of them when `None`).
    fn tell(&self, channel: Option<&str>, message: &RealtimeMessage) {
        let sinks: Vec<Sink> = lock(&self.inner)
            .watches
            .values()
            .filter(|watch| channel.is_none_or(|channel| watch.channel == channel))
            .map(|watch| Arc::clone(&watch.sink))
            .collect();
        for sink in sinks {
            sink(message.clone());
        }
    }

    fn status(&self, state: ConnectionState, code: Option<&str>) {
        self.tell(
            None,
            &RealtimeMessage::Status {
                state,
                code: code.map(str::to_string),
            },
        );
    }

    /// Hand frame `seq` of `channel` to each watch of it that has not had it.
    fn frame(&self, channel: &str, seq: u32, data: &Value) {
        let mut sinks = Vec::new();
        for watch in lock(&self.inner).watches.values_mut() {
            if watch.channel == channel && seq > watch.delivered {
                watch.delivered = seq;
                sinks.push(Arc::clone(&watch.sink));
            }
        }
        let message = RealtimeMessage::Frame {
            channel: channel.to_string(),
            seq,
            data: data.clone(),
        };
        for sink in sinks {
            sink(message.clone());
        }
    }

    /// The task ends: no watch is left, or no account. Forget its queue if it is still the one.
    fn ended(&self, link: &mpsc::UnboundedSender<Command>) {
        let mut inner = lock(&self.inner);
        if inner
            .link
            .as_ref()
            .is_some_and(|current| current.same_channel(link))
        {
            inner.link = None;
        }
    }

    async fn token(&self, seconds: i64) -> Result<(String, i64), TokenFailure> {
        let tokens = Arc::clone(&self.tokens);
        tauri::async_runtime::spawn_blocking(move || tokens.token(seconds))
            .await
            .unwrap_or(Err(TokenFailure::Unreachable))
    }

    /// Connect, follow, reconnect, until no watch is left or no account is.
    async fn run(
        self: Arc<Self>,
        link: mpsc::UnboundedSender<Command>,
        mut commands: mpsc::UnboundedReceiver<Command>,
    ) {
        let Some(url) = self.url.clone() else {
            self.ended(&link);
            return;
        };
        let renew_before = self.renew_before();
        let mut backoff = self.settings.first_backoff;
        let mut first = true;
        loop {
            self.status(
                if first {
                    ConnectionState::Connecting
                } else {
                    ConnectionState::Reconnecting
                },
                None,
            );
            first = false;
            let outcome = match self.token(renew_before * 2).await {
                Err(TokenFailure::NotSignedIn) => Outcome::SignedOut,
                Err(TokenFailure::Unreachable) => Outcome::Retry,
                Ok(token) => {
                    self.connected(&url, token, &mut commands, &mut backoff)
                        .await
                }
            };
            match outcome {
                Outcome::Stop => break,
                Outcome::SignedOut => {
                    self.status(ConnectionState::Closed, Some(NOT_SIGNED_IN));
                    break;
                }
                Outcome::Again => continue,
                Outcome::Retry => {
                    let pause = backoff;
                    backoff = (backoff * 2).min(self.settings.max_backoff);
                    tokio::select! {
                        () = tokio::time::sleep(pause) => {}
                        command = wait_for_stop(&mut commands) => {
                            if command {
                                break;
                            }
                        }
                    }
                }
            }
        }
        self.ended(&link);
    }

    /// One connection, from the handshake to its end.
    async fn connected(
        &self,
        url: &str,
        (token, expires_unix): (String, i64),
        commands: &mut mpsc::UnboundedReceiver<Command>,
        backoff: &mut Duration,
    ) -> Outcome {
        let Ok(mut request) = url.into_client_request() else {
            log::error!("[realtime] the gateway URL is not one");
            return Outcome::SignedOut;
        };
        let Ok(bearer) = format!("Bearer {token}").parse() else {
            return Outcome::Retry;
        };
        request.headers_mut().insert("authorization", bearer);
        let mut socket = match tokio_tungstenite::connect_async(request).await {
            Ok((socket, _)) => socket,
            Err(tungstenite::Error::Http(response)) if response.status() == 401 => {
                // The token was good a moment ago: the account no longer is.
                return Outcome::SignedOut;
            }
            Err(error) => {
                log::warn!("[realtime] cannot reach the gateway: {error}");
                return Outcome::Retry;
            }
        };
        *backoff = self.settings.first_backoff;
        self.status(ConnectionState::Open, None);
        for (channel, last_seq) in self.wanted() {
            if send(&mut socket, &subscribe(&channel, last_seq))
                .await
                .is_err()
            {
                return Outcome::Retry;
            }
        }
        let mut expires_unix = expires_unix;
        let mut ping = tokio::time::interval(self.settings.ping_every);
        ping.tick().await;
        loop {
            let renew_in = Duration::from_secs(
                u64::try_from(expires_unix - self.renew_before() - chrono::Utc::now().timestamp())
                    .unwrap_or(0),
            );
            tokio::select! {
                command = commands.recv() => {
                    let Some(message) = command.and_then(command_message) else {
                        if let Err(error) = socket.close(None).await {
                            log::debug!("[realtime] close: {error}");
                        }
                        return Outcome::Stop;
                    };
                    if send(&mut socket, &message).await.is_err() {
                        return Outcome::Retry;
                    }
                }
                () = tokio::time::sleep(renew_in) => {
                    if let Err(outcome) = self.renew(&mut socket, &mut expires_unix).await {
                        return outcome;
                    }
                }
                _ = ping.tick() => {
                    if send(&mut socket, &json!({"op": "ping"})).await.is_err() {
                        return Outcome::Retry;
                    }
                }
                message = socket.next() => match message {
                    Some(Ok(Message::Text(text))) => self.heard(text.as_str()),
                    Some(Ok(Message::Close(frame))) => {
                        return closed_with(frame.map(|frame| u16::from(frame.code)));
                    }
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        log::warn!("[realtime] the connection broke: {error}");
                        return Outcome::Retry;
                    }
                    None => return Outcome::Retry,
                },
            }
        }
    }

    fn renew_before(&self) -> i64 {
        i64::try_from(self.settings.renew_before.as_secs()).unwrap_or(60)
    }

    /// Send a fresh token on the open connection before the one it lives on expires.
    async fn renew<S>(&self, socket: &mut S, expires_unix: &mut i64) -> Result<(), Outcome>
    where
        S: futures_util::Sink<Message, Error = tungstenite::Error> + Unpin,
    {
        match self.token(self.renew_before() * 2).await {
            Ok((fresh, expires)) => {
                *expires_unix = expires;
                send(socket, &json!({"op": "auth", "token": fresh}))
                    .await
                    .map_err(|_| Outcome::Retry)
            }
            Err(TokenFailure::NotSignedIn) => Err(Outcome::SignedOut),
            // Asked again in a few seconds; the gateway closes with 4001 if it lasts.
            Err(TokenFailure::Unreachable) => {
                *expires_unix = chrono::Utc::now().timestamp() + self.renew_before() + 5;
                Ok(())
            }
        }
    }

    /// One message from the gateway. An `op` this client does not know is passed over (E6-15).
    fn heard(&self, text: &str) {
        let Ok(message) = serde_json::from_str::<Value>(text) else {
            log::warn!("[realtime] a message that is not JSON");
            return;
        };
        let channel = message.get("channel").and_then(Value::as_str);
        match (message.get("op").and_then(Value::as_str), channel) {
            (Some("frame"), Some(channel)) => {
                let seq = message
                    .get("seq")
                    .and_then(Value::as_u64)
                    .and_then(|seq| u32::try_from(seq).ok());
                if let (Some(seq), Some(data)) = (seq, message.get("data")) {
                    self.frame(channel, seq, data);
                }
            }
            (Some("notice"), Some(channel)) => self.tell(
                Some(channel),
                &RealtimeMessage::Notice {
                    channel: channel.to_string(),
                    data: message.get("data").cloned().unwrap_or(Value::Null),
                },
            ),
            (Some("error"), Some(channel)) => {
                if let Some(code) = message.get("code").and_then(Value::as_str) {
                    self.tell(
                        Some(channel),
                        &RealtimeMessage::Error {
                            channel: channel.to_string(),
                            code: code.to_string(),
                        },
                    );
                }
            }
            (Some("error"), None) => {
                log::warn!("[realtime] the gateway refused a message: {message}");
            }
            _ => {}
        }
    }
}

enum Outcome {
    /// No watch is left.
    Stop,
    /// No account: stop until a screen watches again.
    SignedOut,
    /// Connect again now (a token that lapsed).
    Again,
    /// Connect again after the backoff.
    Retry,
}

/// What a closed connection means: signed out (4003), a token to replace now (4001), or a
/// connection to make again after the backoff.
fn closed_with(code: Option<u16>) -> Outcome {
    match code {
        Some(ACCOUNT_REVOKED) => Outcome::SignedOut,
        Some(TOKEN_EXPIRED) => Outcome::Again,
        _ => Outcome::Retry,
    }
}

/// The message a command sends; `None` for `Stop`.
fn command_message(command: Command) -> Option<Value> {
    match command {
        Command::Subscribe { channel, last_seq } => Some(subscribe(&channel, last_seq)),
        Command::Unsubscribe { channel } => Some(json!({"op": "unsubscribe", "channel": channel})),
        Command::Stop => None,
    }
}

fn subscribe(channel: &str, last_seq: u32) -> Value {
    if channel.starts_with("match:") {
        json!({"op": "subscribe", "channel": channel, "lastSeq": last_seq})
    } else {
        json!({"op": "subscribe", "channel": channel})
    }
}

async fn send<S>(socket: &mut S, message: &Value) -> Result<(), tungstenite::Error>
where
    S: futures_util::Sink<Message, Error = tungstenite::Error> + Unpin,
{
    socket.send(Message::Text(message.to_string().into())).await
}

/// `true` when `Stop` came (or the queue closed) while waiting to reconnect; other commands are
/// dropped, as the next connection subscribes what the watches need then.
async fn wait_for_stop(commands: &mut mpsc::UnboundedReceiver<Command>) -> bool {
    loop {
        match commands.recv().await {
            Some(Command::Stop) | None => return true,
            Some(_) => {}
        }
    }
}
