//! The online proxy as a Tauri command (E3-6c): the webview's only way to the online API.

use std::sync::Arc;

use tauri::State;

use crate::application::coach::CoachContext;
use crate::application::online::{self, OnlineError, OnlineRequest, OnlineResponse};

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
