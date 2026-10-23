//! The online proxy as a Tauri command (E3-6c): the webview's only way to the online API; and
//! the realtime channels it may follow (S-8e).

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::application::coach::CoachContext;
use crate::application::online::{self, OnlineError, OnlineRequest, OnlineResponse};
use crate::application::realtime::{Realtime, RealtimeMessage};

/// Send one request of the route table with the session's tokens, off the window's thread (the
/// HTTP client blocks for up to the route's wait).
#[tauri::command]
pub async fn online_request(
    coach: State<'_, Arc<CoachContext>>,
    request: OnlineRequest,
) -> Result<OnlineResponse, OnlineError> {
    let coach = coach.inner().clone();
    tauri::async_runtime::spawn_blocking(move || online::send_for(&coach, &request))
        .await
        .map_err(|_| OnlineError::of("be.error.taskJoinFailed"))?
}

/// Follow a realtime channel (`match:<id>` from `lastSeq`, or `league:<id>`), its messages sent
/// on `on_message`; the watch's id (phase 3 S-8e). The connection and its token stay in Rust.
#[tauri::command]
pub fn online_watch(
    realtime: State<'_, Arc<Realtime>>,
    channel: String,
    last_seq: Option<u32>,
    on_message: Channel<RealtimeMessage>,
) -> Result<u64, OnlineError> {
    let sink = Arc::new(move |message: RealtimeMessage| {
        if let Err(error) = on_message.send(message) {
            log::debug!("[realtime] a screen stopped listening: {error}");
        }
    });
    realtime
        .inner()
        .watch(&channel, last_seq, sink)
        .map_err(OnlineError::of)
}

/// Stop the watch `id`.
#[tauri::command]
pub fn online_unwatch(realtime: State<'_, Arc<Realtime>>, id: u64) {
    realtime.unwatch(id);
}
