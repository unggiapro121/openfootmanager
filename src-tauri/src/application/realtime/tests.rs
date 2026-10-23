//! The realtime client against a stand-in gateway on a local socket (S-8-tech-spec.md §5, S-8e):
//! a watch hears its channel's frames once and in order; a dropped connection is made again from
//! the last step handed over; a lapsed token is replaced, a locked account ends it; the token is
//! renewed on the open connection; two watches share one subscription; the last watch closes it.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use super::{
    realtime_url_of, ConnectionState, Realtime, RealtimeMessage, Settings, TokenFailure,
    TokenSource,
};

const MATCH: &str = "match:0192f0c4-0000-7000-8000-0000000000aa";
const OTHER: &str = "match:0192f0c4-0000-7000-8000-0000000000bb";
const LEAGUE: &str = "league:0192f0c4-0000-7000-8000-0000000000cc";

/// Tokens `token-1`, `token-2` …, each lasting `lifetime` seconds.
struct Tokens {
    issued: AtomicU32,
    lifetime: i64,
}

impl TokenSource for Tokens {
    fn token(&self, _seconds: i64) -> Result<(String, i64), TokenFailure> {
        let n = self.issued.fetch_add(1, Ordering::SeqCst) + 1;
        Ok((
            format!("token-{n}"),
            chrono::Utc::now().timestamp() + self.lifetime,
        ))
    }
}

/// What the gateway does next on a connection.
enum Out {
    Text(Value),
    Close(u16),
}

/// One connection to the stand-in gateway.
struct Connection {
    authorization: String,
    heard: mpsc::UnboundedReceiver<Value>,
    say: mpsc::UnboundedSender<Out>,
}

impl Connection {
    async fn next(&mut self) -> Value {
        tokio::time::timeout(Duration::from_secs(5), self.heard.recv())
            .await
            .expect("the client said something in time")
            .expect("the connection is open")
    }

    /// The next message other than a ping.
    async fn next_not_ping(&mut self) -> Value {
        loop {
            let message = self.next().await;
            if message["op"] != "ping" {
                return message;
            }
        }
    }

    fn frame(&self, channel: &str, seq: u32) {
        self.send(json!({"op": "frame", "channel": channel, "seq": seq, "data": {"seq": seq}}));
    }

    fn send(&self, message: Value) {
        self.say
            .send(Out::Text(message))
            .expect("the connection is open");
    }

    fn close(&self, code: u16) {
        self.say
            .send(Out::Close(code))
            .expect("the connection is open");
    }
}

/// A gateway on a local port, handing each connection to the test.
async fn gateway() -> (String, mpsc::UnboundedReceiver<Connection>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a port");
    let url = format!(
        "ws://{}/v1/realtime",
        listener.local_addr().expect("an address")
    );
    let (connections, accepted) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let mut authorization = String::new();
            #[expect(
                clippy::result_large_err,
                reason = "tungstenite's handshake callback returns its own ErrorResponse; owner=S-8e"
            )]
            let header = |request: &Request, response: Response| {
                authorization = request
                    .headers()
                    .get("authorization")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default()
                    .to_string();
                Ok(response)
            };
            let Ok(socket) = tokio_tungstenite::accept_hdr_async(stream, header).await else {
                continue;
            };
            let (mut sink, mut stream) = socket.split();
            let (heard_tx, heard) = mpsc::unbounded_channel();
            let (say, mut said) = mpsc::unbounded_channel::<Out>();
            tokio::spawn(async move {
                while let Some(Ok(message)) = stream.next().await {
                    if let Message::Text(text) = message {
                        let value = serde_json::from_str(text.as_str()).expect("JSON");
                        if heard_tx.send(value).is_err() {
                            break;
                        }
                    }
                }
            });
            tokio::spawn(async move {
                while let Some(out) = said.recv().await {
                    match out {
                        Out::Text(value) => {
                            let text = Message::Text(value.to_string().into());
                            if sink.send(text).await.is_err() {
                                break;
                            }
                        }
                        Out::Close(code) => {
                            let frame = CloseFrame {
                                code: CloseCode::from(code),
                                reason: "".into(),
                            };
                            let _ = sink.send(Message::Close(Some(frame))).await;
                            break;
                        }
                    }
                }
            });
            let connection = Connection {
                authorization,
                heard,
                say,
            };
            if connections.send(connection).is_err() {
                break;
            }
        }
    });
    (url, accepted)
}

async fn accepted(connections: &mut mpsc::UnboundedReceiver<Connection>) -> Connection {
    tokio::time::timeout(Duration::from_secs(5), connections.recv())
        .await
        .expect("the client connected in time")
        .expect("a connection")
}

fn quick() -> Settings {
    Settings {
        first_backoff: Duration::from_millis(20),
        max_backoff: Duration::from_millis(100),
        renew_before: Duration::from_secs(60),
        ping_every: Duration::from_secs(30),
    }
}

fn client(url: &str, lifetime: i64, settings: Settings) -> Arc<Realtime> {
    Arc::new(Realtime::new(
        Some(url.to_string()),
        Arc::new(Tokens {
            issued: AtomicU32::new(0),
            lifetime,
        }),
        settings,
    ))
}

/// A sink, and what it was handed.
fn listener() -> (super::Sink, mpsc::UnboundedReceiver<RealtimeMessage>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (
        Arc::new(move |message| {
            let _ = tx.send(message);
        }),
        rx,
    )
}

/// The steps of the next `count` frames handed over, statuses passed by.
async fn frames(heard: &mut mpsc::UnboundedReceiver<RealtimeMessage>, count: usize) -> Vec<u32> {
    let mut seqs = Vec::new();
    while seqs.len() < count {
        let message = tokio::time::timeout(Duration::from_secs(5), heard.recv())
            .await
            .expect("a frame in time")
            .expect("a message");
        if let RealtimeMessage::Frame { seq, channel, .. } = message {
            assert_eq!(channel, MATCH);
            seqs.push(seq);
        }
    }
    seqs
}

/// The next status handed over, other messages passed by.
async fn status(
    heard: &mut mpsc::UnboundedReceiver<RealtimeMessage>,
) -> (ConnectionState, Option<String>) {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), heard.recv())
            .await
            .expect("a status in time")
            .expect("a message");
        if let RealtimeMessage::Status { state, code } = message {
            return (state, code);
        }
    }
}

/// Given a gateway,
/// when a screen watches a match from step 2 and the gateway sends frames 3, 4, 4 again, a frame
/// of another match, then 5,
/// then the connection went out with the session's token and subscribed from 2, and the screen is
/// told the connection opened and handed frames 3, 4 and 5, once each.
#[tokio::test]
async fn a_watch_hears_its_frames_once_and_in_order() {
    let (url, mut connections) = gateway().await;
    let realtime = client(&url, 900, quick());
    let (sink, mut heard) = listener();
    realtime.watch(MATCH, Some(2), sink).expect("a watch");

    let mut connection = accepted(&mut connections).await;
    assert_eq!(connection.authorization, "Bearer token-1");
    assert_eq!(
        connection.next_not_ping().await,
        json!({"op": "subscribe", "channel": MATCH, "lastSeq": 2})
    );
    for seq in [3, 4, 4] {
        connection.frame(MATCH, seq);
    }
    connection.frame(OTHER, 9);
    connection.frame(MATCH, 5);

    assert_eq!(status(&mut heard).await.0, ConnectionState::Connecting);
    assert_eq!(status(&mut heard).await.0, ConnectionState::Open);
    assert_eq!(frames(&mut heard, 3).await, vec![3, 4, 5]);
}

/// Given a watch handed frames 1 and 2,
/// when the gateway goes away (1001),
/// then the client connects again and subscribes from 2, and of the frames 2 and 3 the gateway
/// then sends, only 3 is handed over.
#[tokio::test]
async fn a_dropped_connection_is_made_again_from_the_last_step() {
    let (url, mut connections) = gateway().await;
    let realtime = client(&url, 900, quick());
    let (sink, mut heard) = listener();
    realtime.watch(MATCH, None, sink).expect("a watch");
    let mut first = accepted(&mut connections).await;
    assert_eq!(first.next_not_ping().await["lastSeq"], 0);
    first.frame(MATCH, 1);
    first.frame(MATCH, 2);
    assert_eq!(frames(&mut heard, 2).await, vec![1, 2]);

    first.close(1001);
    let mut second = accepted(&mut connections).await;
    assert_eq!(
        second.next_not_ping().await,
        json!({"op": "subscribe", "channel": MATCH, "lastSeq": 2})
    );
    second.frame(MATCH, 2);
    second.frame(MATCH, 3);

    assert_eq!(frames(&mut heard, 1).await, vec![3]);
}

/// Given a watch,
/// when the gateway closes because the token lapsed (4001), and on the next connection because
/// the account was locked (4003),
/// then the client connects again at once with a new token, and after the second it stops and
/// tells the screen the session is over (`be.error.online.notSignedIn`), connecting no more.
#[tokio::test]
async fn a_lapsed_token_is_replaced_and_a_locked_account_ends_it() {
    let (url, mut connections) = gateway().await;
    let realtime = client(&url, 900, quick());
    let (sink, mut heard) = listener();
    realtime.watch(MATCH, None, sink).expect("a watch");
    let first = accepted(&mut connections).await;
    assert_eq!(first.authorization, "Bearer token-1");

    first.close(4001);
    let second = accepted(&mut connections).await;
    assert_eq!(second.authorization, "Bearer token-2");
    second.close(4003);

    loop {
        let (state, code) = status(&mut heard).await;
        if state == ConnectionState::Closed {
            assert_eq!(code.as_deref(), Some("be.error.online.notSignedIn"));
            break;
        }
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(300), connections.recv())
            .await
            .is_err(),
        "no connection after the account was locked"
    );
}

/// Given a token that expires 61 s from now and a client that renews a minute before,
/// when the connection is open,
/// then within about a second the client sends the next token on it, and the connection stays.
#[tokio::test]
async fn the_token_is_renewed_on_the_open_connection() {
    let (url, mut connections) = gateway().await;
    let realtime = client(&url, 61, quick());
    let (sink, _heard) = listener();
    realtime.watch(LEAGUE, None, sink).expect("a watch");
    let mut connection = accepted(&mut connections).await;
    assert_eq!(
        connection.next_not_ping().await,
        json!({"op": "subscribe", "channel": LEAGUE})
    );

    assert_eq!(
        connection.next_not_ping().await,
        json!({"op": "auth", "token": "token-2"})
    );
}

/// Given two screens watching the same match from kick-off, and a league notice and a refusal for
/// that match,
/// when frames come, the first screen stops watching, then the second,
/// then the match was subscribed once and both screens were handed each frame and the notice of
/// their channel only; the first unwatch leaves the subscription, the last closes the connection.
#[tokio::test]
async fn watches_share_a_subscription_and_the_last_one_closes_it() {
    let (url, mut connections) = gateway().await;
    let realtime = client(&url, 900, quick());
    let (first_sink, mut first) = listener();
    let (second_sink, mut second) = listener();
    let one = realtime.watch(MATCH, None, first_sink).expect("a watch");
    let mut connection = accepted(&mut connections).await;
    assert_eq!(connection.next_not_ping().await["channel"], MATCH);
    let two = realtime.watch(MATCH, None, second_sink).expect("a watch");
    connection.frame(MATCH, 1);
    connection.send(
        json!({"op": "error", "channel": MATCH, "code": "be.error.realtime.tooManyChannels"}),
    );
    assert_eq!(frames(&mut first, 1).await, vec![1]);
    assert_eq!(frames(&mut second, 1).await, vec![1]);
    let refusal = loop {
        match second.recv().await.expect("a message") {
            RealtimeMessage::Error { code, .. } => break code,
            _ => continue,
        }
    };
    assert_eq!(refusal, "be.error.realtime.tooManyChannels");

    realtime.unwatch(one);
    connection.send(json!({"op": "pong"}));
    realtime.unwatch(two);
    let mut after = Vec::new();
    tokio::time::timeout(Duration::from_secs(2), async {
        while let Some(message) = connection.heard.recv().await {
            after.push(message);
        }
    })
    .await
    .expect("the last unwatch closes the connection");
    assert!(
        after.iter().all(|message| message["op"] == "ping"),
        "no second subscribe and no unsubscribe: {after:?}"
    );
}

/// Given a client with no gateway, and one with a gateway,
/// when a screen watches, watches a channel that is not one, and watches an account's own channel
/// (S-12),
/// then the first is told there is no server, the second that the channel is not allowed, and the
/// account's channel is taken.
#[tokio::test]
async fn a_watch_needs_a_gateway_and_a_channel() {
    let none = Arc::new(Realtime::new(
        None,
        Arc::new(Tokens {
            issued: AtomicU32::new(0),
            lifetime: 900,
        }),
        quick(),
    ));
    let (sink, _) = listener();
    assert_eq!(
        none.watch(MATCH, None, Arc::clone(&sink)),
        Err("be.error.coach.serverNotConfigured")
    );
    let some = client("ws://127.0.0.1:9/v1/realtime", 900, quick());
    for channel in [
        "club:0192f0c4-0000-7000-8000-0000000000aa",
        "match:../admin",
        "match:",
        "account:",
        "account:me",
    ] {
        assert_eq!(
            some.watch(channel, None, Arc::clone(&sink)),
            Err("be.error.online.routeNotAllowed"),
            "{channel}"
        );
    }
    assert!(some
        .watch(
            "account:0192f0c4-0000-7000-8000-0000000000aa",
            None,
            Arc::clone(&sink)
        )
        .is_ok());
}

/// Given an account server's base URL,
/// when the gateway's URL is worked out from it,
/// then it is the same host with `ws` or `wss` and `/v1/realtime`.
#[test]
fn the_gateway_sits_beside_the_api() {
    assert_eq!(
        realtime_url_of("http://localhost:8080").as_deref(),
        Some("ws://localhost:8080/v1/realtime")
    );
    assert_eq!(
        realtime_url_of("https://ofm.example/api/").as_deref(),
        Some("wss://ofm.example/v1/realtime")
    );
    assert_eq!(realtime_url_of("ftp://ofm.example"), None);
}
