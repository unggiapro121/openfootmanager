//! Push notifications on the phone app (phase 5 M3c2, m3-tech-spec §5.3): whether the phone may
//! show the app's pushes, asking for that, the token the server sends them to, and the push the
//! coach opened. Android keeps its half in `android/` (Firebase Messaging), iOS in `ios/` (APNs,
//! no Firebase, Qm3-9). Desktop has no push: every command there answers `unsupported`.
//!
//! Each command waits for the native half on Tauri's async runtime (`run_mobile_plugin_async`),
//! never on the thread that runs the command, and gives up after `NATIVE_TIMEOUT`: a native call
//! that never answers must not hang the app (spike m3c2 §3.2, condition B1).

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

#[cfg(mobile)]
mod mobile;

/// The longest any native call may take before the command answers `timeout` (B1: 10 s).
pub const NATIVE_TIMEOUT: Duration = Duration::from_secs(10);

/// Whether the phone shows the app's pushes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionState {
    /// The coach allowed them and they are on in the phone's settings.
    Granted,
    /// He refused, or turned them off in the phone's settings: only the settings can undo it.
    Denied,
    /// Not asked yet, or asked and not answered for good: the system may still ask.
    Prompt,
}

/// What the app was opened from: the push's data as the server sent it (`kind`, `outboxId`,
/// `route`, m3-tech-spec §4.6).
pub type OpenedPush = HashMap<String, String>;

/// Why a command did not answer as asked. It reaches the webview as a string: never shown to the
/// coach, only logged, so the native reason (a Firebase error, say) is kept as it is.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("push is not available on this platform")]
    Unsupported,
    #[error("the native push call did not answer in time")]
    Timeout,
    #[error("{0}")]
    Native(String),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Wait for `call`, at most `limit`.
#[cfg(any(mobile, test))]
async fn within<T>(
    limit: Duration,
    call: impl std::future::Future<Output = Result<T>>,
) -> Result<T> {
    tokio::time::timeout(limit, call)
        .await
        .unwrap_or(Err(Error::Timeout))
}

mod commands {
    use tauri::{AppHandle, Runtime};

    use super::{OpenedPush, PermissionState, Result};

    #[tauri::command]
    pub(crate) async fn permission_state<R: Runtime>(app: AppHandle<R>) -> Result<PermissionState> {
        super::native::permission_state(&app).await
    }

    #[tauri::command]
    pub(crate) async fn request_permission<R: Runtime>(
        app: AppHandle<R>,
    ) -> Result<PermissionState> {
        super::native::request_permission(&app).await
    }

    #[tauri::command]
    pub(crate) async fn token<R: Runtime>(app: AppHandle<R>) -> Result<String> {
        super::native::token(&app).await
    }

    #[tauri::command]
    pub(crate) async fn take_opened<R: Runtime>(app: AppHandle<R>) -> Result<Option<OpenedPush>> {
        super::native::take_opened(&app).await
    }

    #[tauri::command]
    pub(crate) async fn open_settings<R: Runtime>(app: AppHandle<R>) -> Result<()> {
        super::native::open_settings(&app).await
    }
}

#[cfg(mobile)]
use mobile as native;

#[cfg(not(mobile))]
mod native {
    //! Desktop: no push.
    use tauri::{AppHandle, Runtime};

    use super::{Error, OpenedPush, PermissionState, Result};

    pub(crate) async fn permission_state<R: Runtime>(_: &AppHandle<R>) -> Result<PermissionState> {
        Err(Error::Unsupported)
    }

    pub(crate) async fn request_permission<R: Runtime>(
        _: &AppHandle<R>,
    ) -> Result<PermissionState> {
        Err(Error::Unsupported)
    }

    pub(crate) async fn token<R: Runtime>(_: &AppHandle<R>) -> Result<String> {
        Err(Error::Unsupported)
    }

    pub(crate) async fn take_opened<R: Runtime>(_: &AppHandle<R>) -> Result<Option<OpenedPush>> {
        Err(Error::Unsupported)
    }

    pub(crate) async fn open_settings<R: Runtime>(_: &AppHandle<R>) -> Result<()> {
        Err(Error::Unsupported)
    }
}

/// The plugin, named `ofm-push` (`plugin:ofm-push|token` from the webview).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("ofm-push")
        .invoke_handler(tauri::generate_handler![
            commands::permission_state,
            commands::request_permission,
            commands::token,
            commands::take_opened,
            commands::open_settings,
        ])
        .setup(|_app, _api| {
            #[cfg(mobile)]
            mobile::register(_app, _api)?;
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given the states the native halves answer with,
    /// when they are read,
    /// then each is the plugin's own state.
    #[test]
    fn the_native_states_read_as_the_plugins_own() {
        for (native, state) in [
            ("\"granted\"", PermissionState::Granted),
            ("\"denied\"", PermissionState::Denied),
            ("\"prompt\"", PermissionState::Prompt),
        ] {
            assert_eq!(
                serde_json::from_str::<PermissionState>(native).unwrap(),
                state
            );
        }
    }

    /// Given a native call that never answers,
    /// when the plugin waits for it,
    /// then it gives up with `timeout` instead of waiting for ever.
    #[tokio::test(start_paused = true)]
    async fn a_native_call_that_never_answers_times_out() {
        let never = std::future::pending::<Result<()>>();
        let answer = within(NATIVE_TIMEOUT, never).await;
        assert!(matches!(answer, Err(Error::Timeout)));
    }

    /// Given a native call that fails, say Firebase refusing a token,
    /// when the failure reaches the webview,
    /// then it carries the native reason as it is.
    #[test]
    fn a_native_failure_reaches_the_webview_with_its_reason() {
        let failure = Error::Native("API key not valid".into());
        assert_eq!(
            serde_json::to_string(&failure).unwrap(),
            "\"API key not valid\""
        );
    }
}
