//! A stand-in for the account server in tests: it answers each request with what the test's
//! handler says, and keeps every request so the test can read what the game sent.

use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    pub path: String,
    /// Header names lower-cased.
    pub headers: BTreeMap<String, String>,
    pub body: serde_json::Value,
}

/// A status, a body, and headers to add to the answer.
pub type Answer = (u16, serde_json::Value, Vec<(String, String)>);

type Handler = dyn Fn(&Recorded) -> Answer + Send + Sync;

pub struct TestServer {
    pub url: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

impl TestServer {
    /// Serve on a free local port until the test process ends.
    pub fn start(
        handler: impl Fn(&Recorded) -> (u16, serde_json::Value) + Send + Sync + 'static,
    ) -> Self {
        Self::start_with_headers(move |request| {
            let (status, body) = handler(request);
            (status, body, Vec::new())
        })
    }

    /// As [`TestServer::start`], with headers on the answers.
    pub fn start_with_headers(
        handler: impl Fn(&Recorded) -> Answer + Send + Sync + 'static,
    ) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
        let url = format!("http://{}", listener.local_addr().expect("an address"));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let kept = Arc::clone(&requests);
        let handler: Arc<Handler> = Arc::new(handler);
        std::thread::spawn(move || {
            // One thread per connection: a slow answer must not hold the next request back.
            for stream in listener.incoming().flatten() {
                let kept = Arc::clone(&kept);
                let handler = Arc::clone(&handler);
                std::thread::spawn(move || serve(stream, &kept, handler.as_ref()));
            }
        });
        Self { url, requests }
    }

    pub fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().expect("requests").clone()
    }

    pub fn paths(&self) -> Vec<String> {
        self.requests()
            .into_iter()
            .map(|request| request.path)
            .collect()
    }
}

fn serve(stream: TcpStream, kept: &Mutex<Vec<Recorded>>, handler: &Handler) {
    let mut reader = BufReader::new(stream.try_clone().expect("a stream"));
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() || line.is_empty() {
        return;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = BTreeMap::new();
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            headers.insert(name.trim().to_lowercase(), value.trim().to_string());
        }
    }
    let length: usize = headers
        .get("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let mut body = vec![0; length];
    if reader.read_exact(&mut body).is_err() {
        return;
    }
    let request = Recorded {
        method,
        path,
        headers,
        body: serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null),
    };
    // Kept before it is answered, so a request still being answered is already seen.
    kept.lock().expect("requests").push(request.clone());
    let (status, answer, extra) = handler(&request);
    if status == 0 {
        // A status of 0 drops the connection unanswered: to the game, the server is unreachable.
        return;
    }
    let extra: String = extra
        .iter()
        .map(|(name, value)| format!("{name}: {value}\r\n"))
        .collect();
    // `null` stands for no body at all, as a 204 sends.
    let answer = if answer.is_null() {
        String::new()
    } else {
        answer.to_string()
    };
    let mut stream = stream;
    let written = write!(
        stream,
        "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{answer}",
        answer.len()
    );
    if written.is_err() {
        // The client gave up waiting, as a test of its timeout means it to.
        eprintln!("[test-server] a {status} answered after the client left");
    }
}
