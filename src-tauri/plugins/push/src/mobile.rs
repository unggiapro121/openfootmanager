//! The native halves on Android (Kotlin `app.ofm.push.PushPlugin`) and iOS (Swift `PushPlugin`).

use serde::de::DeserializeOwned;
use serde::Deserialize;
use tauri::plugin::{PluginApi, PluginHandle};
use tauri::{AppHandle, Manager, Runtime};

use super::{within, Error, OpenedPush, PermissionState, Result, NATIVE_TIMEOUT};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_ofm_push);

/// The handle to the native half, kept in the app's state.
struct Push<R: Runtime>(PluginHandle<R>);

pub(crate) fn register<R: Runtime>(
    app: &AppHandle<R>,
    api: PluginApi<R, ()>,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "android")]
    let handle = api.register_android_plugin("app.ofm.push", "PushPlugin")?;
    #[cfg(target_os = "ios")]
    let handle = api.register_ios_plugin(init_plugin_ofm_push)?;
    app.manage(Push(handle));
    Ok(())
}

/// Run native `command` on the async runtime, at most `NATIVE_TIMEOUT`.
async fn run<R: Runtime, T: DeserializeOwned>(app: &AppHandle<R>, command: &str) -> Result<T> {
    let handle = app.state::<Push<R>>().0.clone();
    within(NATIVE_TIMEOUT, async move {
        handle
            .run_mobile_plugin_async::<T>(command, serde_json::Map::new())
            .await
            .map_err(|error| Error::Native(error.to_string()))
    })
    .await
}

#[derive(Deserialize)]
struct StateReply {
    state: PermissionState,
}

#[derive(Deserialize)]
struct TokenReply {
    token: String,
}

#[derive(Deserialize)]
struct OpenedReply {
    data: Option<OpenedPush>,
}

pub(crate) async fn permission_state<R: Runtime>(app: &AppHandle<R>) -> Result<PermissionState> {
    Ok(run::<R, StateReply>(app, "permissionState").await?.state)
}

pub(crate) async fn request_permission<R: Runtime>(app: &AppHandle<R>) -> Result<PermissionState> {
    Ok(run::<R, StateReply>(app, "requestPermission").await?.state)
}

pub(crate) async fn token<R: Runtime>(app: &AppHandle<R>) -> Result<String> {
    let token = run::<R, TokenReply>(app, "getToken").await?.token;
    // An empty token is no token: 0.1.4's stubs answered that way (spike m3c2 §3.2).
    if token.is_empty() {
        return Err(Error::Native("the platform gave an empty token".into()));
    }
    Ok(token)
}

pub(crate) async fn take_opened<R: Runtime>(app: &AppHandle<R>) -> Result<Option<OpenedPush>> {
    Ok(run::<R, OpenedReply>(app, "takeOpened").await?.data)
}

pub(crate) async fn open_settings<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    // The reply carries nothing; whatever shape the platform gives it is ignored.
    run::<R, serde::de::IgnoredAny>(app, "openSettings").await?;
    Ok(())
}
