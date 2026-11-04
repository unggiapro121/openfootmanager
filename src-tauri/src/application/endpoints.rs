//! Where the account server and the realtime gateway are (phase 5 M1).
//!
//! In order, the first that names one wins:
//! 1. the run-time environment (`OFM_SERVER_URL`, `OFM_REALTIME_URL`), as before;
//! 2. the same variables when the app was built (`option_env!`), as before (`build-app.sh`);
//! 3. on Android and iOS only, `plugins.ofmOnline` of the platform config the build merged in
//!    (`tauri.android.conf.json`, `tauri.ios.conf.json`, or a `--config` given to the build).
//!
//! A phone has no run-time environment, and Xcode's build phase does not hand the build's
//! environment to cargo, so a mobile build needs the third source. A desktop build never reads it:
//! the platform configs are merged only into mobile builds, and the call that hands them over is
//! compiled for mobile only, so desktop behaves exactly as before.
//!
//! The committed platform configs name the local play stack as an emulator or simulator sees it:
//! Android's emulator reaches the Mac at `10.0.2.2`, iOS's simulator at `127.0.0.1`; the API is on
//! :8080 and the realtime gateway on :8090. A build for another server overrides them with
//! `tauri android|ios build --config '{"plugins":{"ofmOnline":{"serverUrl":…,"realtimeUrl":…}}}'`.
//!
//! Without an explicit realtime URL the gateway is taken to sit beside the API
//! (`realtime_url_of`), as behind one proxy.

use std::sync::OnceLock;

use serde::Deserialize;

/// The URLs a mobile build was configured with (`plugins.ofmOnline`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileEndpoints {
    pub server_url: Option<String>,
    pub realtime_url: Option<String>,
}

/// The plugin entry of the platform config that names the URLs.
#[cfg(any(mobile, test))]
pub const MOBILE_CONFIG_KEY: &str = "ofmOnline";

static MOBILE: OnceLock<MobileEndpoints> = OnceLock::new();

/// Hands over `plugins.ofmOnline` of the merged config, once, before anything asks for a URL.
/// A missing or unreadable entry leaves the app without one, as on desktop.
#[cfg(mobile)]
pub fn set_mobile_endpoints(entry: Option<&serde_json::Value>) {
    store_once(&MOBILE, entry);
}

/// The first hand-over stays: a second one is a mistake, logged, not a change.
#[cfg(any(mobile, test))]
fn store_once(cell: &OnceLock<MobileEndpoints>, entry: Option<&serde_json::Value>) {
    if cell.set(parse_mobile_endpoints(entry)).is_err() {
        log::warn!("[endpoints] mobile endpoints were already set");
    }
}

#[cfg(any(mobile, test))]
fn parse_mobile_endpoints(entry: Option<&serde_json::Value>) -> MobileEndpoints {
    match entry {
        None => MobileEndpoints::default(),
        Some(value) => serde_json::from_value(value.clone()).unwrap_or_else(|error| {
            log::warn!("[endpoints] plugins.{MOBILE_CONFIG_KEY} not read: {error}");
            MobileEndpoints::default()
        }),
    }
}

fn mobile() -> Option<&'static MobileEndpoints> {
    MOBILE.get()
}

/// The first candidate that names something, trimmed.
fn first_named(candidates: impl IntoIterator<Item = Option<String>>) -> Option<String> {
    candidates
        .into_iter()
        .flatten()
        .map(|url| url.trim().to_string())
        .find(|url| !url.is_empty())
}

const SERVER_URL_ENV: &str = "OFM_SERVER_URL";
const REALTIME_URL_ENV: &str = "OFM_REALTIME_URL";

/// The account server to use: run time, then build time, then a mobile build's config.
pub fn configured_server_url() -> Option<String> {
    first_named([
        std::env::var(SERVER_URL_ENV).ok(),
        option_env!("OFM_SERVER_URL").map(str::to_string),
        mobile().and_then(|m| m.server_url.clone()),
    ])
}

/// The gateway: run time, then build time, then a mobile build's config, otherwise beside the API.
pub fn configured_realtime_url() -> Option<String> {
    first_named([
        std::env::var(REALTIME_URL_ENV).ok(),
        option_env!("OFM_REALTIME_URL").map(str::to_string),
        mobile().and_then(|m| m.realtime_url.clone()),
    ])
    .or_else(|| configured_server_url().and_then(|base| realtime_url_of(&base)))
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Given a run-time URL, a build-time URL and a mobile config URL,
    /// when the first is picked,
    /// then the run-time one wins, then the build-time one, then the config.
    #[test]
    fn the_run_time_url_wins_then_the_build_time_one_then_the_mobile_config() {
        let all = || {
            [
                Some("http://run".to_string()),
                Some("http://build".to_string()),
                Some("http://config".to_string()),
            ]
        };
        assert_eq!(first_named(all()).as_deref(), Some("http://run"));
        assert_eq!(
            first_named([
                None,
                Some("http://build".into()),
                Some("http://config".into())
            ])
            .as_deref(),
            Some("http://build")
        );
        assert_eq!(
            first_named([None, None, Some("http://config".into())]).as_deref(),
            Some("http://config")
        );
    }

    /// Given empty and blank candidates,
    /// when the first is picked,
    /// then they are skipped, and with nothing named there is no URL.
    #[test]
    fn blank_urls_name_nothing() {
        assert_eq!(
            first_named([Some("  ".into()), None, Some(" http://config ".into())]).as_deref(),
            Some("http://config")
        );
        assert_eq!(first_named([Some(String::new()), None, None]), None);
    }

    /// Given the `plugins.ofmOnline` entry of a mobile config,
    /// when it is read,
    /// then both URLs come through; a missing or malformed entry names none.
    #[test]
    fn the_mobile_config_entry_is_read_and_a_bad_one_names_nothing() {
        let entry = json!({
            "serverUrl": "http://10.0.2.2:8080",
            "realtimeUrl": "ws://10.0.2.2:8090/v1/realtime"
        });
        assert_eq!(
            parse_mobile_endpoints(Some(&entry)),
            MobileEndpoints {
                server_url: Some("http://10.0.2.2:8080".into()),
                realtime_url: Some("ws://10.0.2.2:8090/v1/realtime".into()),
            }
        );
        assert_eq!(parse_mobile_endpoints(None), MobileEndpoints::default());
        assert_eq!(
            parse_mobile_endpoints(Some(&json!({ "serverUrl": 8080 }))),
            MobileEndpoints::default()
        );
    }

    /// Given the app's mobile endpoints handed over once,
    /// when they are handed over again,
    /// then the first stay (a second call is a mistake, logged, not a change).
    #[test]
    fn mobile_endpoints_are_set_once() {
        let cell = OnceLock::new();
        store_once(&cell, Some(&json!({ "serverUrl": "http://first" })));
        store_once(&cell, Some(&json!({ "serverUrl": "http://second" })));
        assert_eq!(
            cell.get()
                .and_then(|m: &MobileEndpoints| m.server_url.as_deref()),
            Some("http://first")
        );
    }

    /// Given a desktop build, where no mobile config is ever handed over,
    /// when the URLs are asked for,
    /// then the mobile source names nothing (only the environment can).
    #[test]
    fn a_desktop_build_has_no_mobile_endpoints() {
        assert_eq!(mobile(), None);
    }
}
