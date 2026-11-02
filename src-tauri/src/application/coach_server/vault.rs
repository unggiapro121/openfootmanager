//! Where the refresh token waits between two runs of the game: the operating system's keychain
//! (tech-spec-phase3 §5, assumption A13), or on Android, where `keyring` has no backend, a file in
//! the app's private data folder (phase 5 M0). The access token never leaves memory.

/// Keeps one refresh token. A failure to keep it costs the player a login next time, nothing
/// more, so it is logged rather than returned.
pub trait RefreshTokenVault: Send + Sync {
    fn load(&self) -> Option<String>;
    fn store(&self, token: &str);
    fn clear(&self);
}

#[cfg(not(target_os = "android"))]
const SERVICE: &str = "openfootmanager";

/// The keychain entry of one server: a token from the local test server never meets another.
#[cfg(not(target_os = "android"))]
pub struct KeyringVault {
    user: String,
}

#[cfg(not(target_os = "android"))]
impl KeyringVault {
    pub fn for_server(base_url: &str) -> Self {
        Self {
            user: format!("refresh-token@{base_url}"),
        }
    }

    fn entry(&self) -> Option<keyring::Entry> {
        keyring::Entry::new(SERVICE, &self.user)
            .map_err(|error| log::warn!("[coach-server] keychain unavailable: {error}"))
            .ok()
    }
}

#[cfg(not(target_os = "android"))]
impl RefreshTokenVault for KeyringVault {
    fn load(&self) -> Option<String> {
        match self.entry()?.get_password() {
            Ok(token) => Some(token),
            Err(keyring::Error::NoEntry) => None,
            Err(error) => {
                log::warn!("[coach-server] refresh token not read: {error}");
                None
            }
        }
    }

    fn store(&self, token: &str) {
        if let Some(entry) = self.entry() {
            if let Err(error) = entry.set_password(token) {
                log::warn!("[coach-server] refresh token not kept: {error}");
            }
        }
    }

    fn clear(&self) {
        if let Some(entry) = self.entry() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {}
                Err(error) => log::warn!("[coach-server] refresh token not removed: {error}"),
            }
        }
    }
}

/// The refresh token of one server in a file of the app's own data folder: Android's keystore is
/// not reachable from `keyring`, and the folder is private to the app on Android (phase 5 M0;
/// the platform keystore is a later step). One file per server, as the keychain has one entry.
#[cfg(any(target_os = "android", test))]
pub struct FileVault {
    path: std::path::PathBuf,
}

#[cfg(any(target_os = "android", test))]
impl FileVault {
    pub fn for_server(app_data_dir: &std::path::Path, base_url: &str) -> Self {
        let name: String = base_url
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
            .collect();
        Self {
            path: app_data_dir
                .join("coach-server")
                .join(format!("refresh-token-{name}")),
        }
    }

    fn write(&self, token: &str) -> std::io::Result<()> {
        if let Some(folder) = self.path.parent() {
            std::fs::create_dir_all(folder)?;
        }
        // Written beside, then renamed over: a crash mid-write never leaves half a token.
        let partial = self.path.with_extension("partial");
        std::fs::write(&partial, token)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&partial, &self.path)
    }
}

#[cfg(any(target_os = "android", test))]
impl RefreshTokenVault for FileVault {
    fn load(&self) -> Option<String> {
        match std::fs::read_to_string(&self.path) {
            Ok(token) if !token.trim().is_empty() => Some(token.trim().to_string()),
            Ok(_) => None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                log::warn!("[coach-server] refresh token not read: {error}");
                None
            }
        }
    }

    fn store(&self, token: &str) {
        if let Err(error) = self.write(token) {
            log::warn!("[coach-server] refresh token not kept: {error}");
        }
    }

    fn clear(&self) {
        match std::fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => log::warn!("[coach-server] refresh token not removed: {error}"),
        }
    }
}

/// The vault this platform keeps the refresh token of the server at `base_url` in.
pub fn platform_vault(
    app_data_dir: &std::path::Path,
    base_url: &str,
) -> Box<dyn RefreshTokenVault> {
    #[cfg(target_os = "android")]
    {
        Box::new(FileVault::for_server(app_data_dir, base_url))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app_data_dir;
        Box::new(KeyringVault::for_server(base_url))
    }
}

/// A vault in memory, for tests: what the keychain would hold, readable by the test.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryVault(pub std::sync::Arc<std::sync::Mutex<Option<String>>>);

#[cfg(test)]
impl RefreshTokenVault for MemoryVault {
    fn load(&self) -> Option<String> {
        self.0.lock().ok()?.clone()
    }

    fn store(&self, token: &str) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = Some(token.to_string());
        }
    }

    fn clear(&self) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = None;
        }
    }
}

#[cfg(test)]
mod file_vault_tests {
    use super::{FileVault, RefreshTokenVault};

    /// Given a file vault for a server,
    /// when a token is stored, then read by a second vault for the same server,
    /// then the second reads it (it survives the app's restart).
    #[test]
    fn a_stored_token_is_read_back_by_the_next_run() {
        let dir = tempfile::tempdir().expect("a temp folder");
        FileVault::for_server(dir.path(), "http://10.0.2.2:8080").store("token-1");
        let next_run = FileVault::for_server(dir.path(), "http://10.0.2.2:8080");
        assert_eq!(next_run.load().as_deref(), Some("token-1"));
    }

    /// Given tokens of two servers,
    /// when each is read,
    /// then each server's vault reads only its own.
    #[test]
    fn each_server_keeps_its_own_token() {
        let dir = tempfile::tempdir().expect("a temp folder");
        FileVault::for_server(dir.path(), "http://10.0.2.2:8080").store("local");
        FileVault::for_server(dir.path(), "https://play.example").store("play");
        assert_eq!(
            FileVault::for_server(dir.path(), "http://10.0.2.2:8080")
                .load()
                .as_deref(),
            Some("local")
        );
        assert_eq!(
            FileVault::for_server(dir.path(), "https://play.example")
                .load()
                .as_deref(),
            Some("play")
        );
    }

    /// Given a stored token, and a vault with none,
    /// when the token is cleared, and the empty vault is cleared,
    /// then nothing is read back and clearing an empty vault is no error.
    #[test]
    fn a_cleared_token_is_gone_and_an_empty_vault_clears_quietly() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let vault = FileVault::for_server(dir.path(), "http://10.0.2.2:8080");
        assert_eq!(vault.load(), None);
        vault.clear();
        vault.store("token-1");
        vault.store("token-2");
        assert_eq!(vault.load().as_deref(), Some("token-2"));
        vault.clear();
        assert_eq!(vault.load(), None);
    }

    /// Given a stored token on unix,
    /// when its file is inspected,
    /// then only the app's own user may read it.
    #[cfg(unix)]
    #[test]
    fn the_token_file_is_private_to_the_app() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().expect("a temp folder");
        FileVault::for_server(dir.path(), "http://10.0.2.2:8080").store("token-1");
        let file = dir
            .path()
            .join("coach-server")
            .join("refresh-token-http___10_0_2_2_8080");
        let mode = std::fs::metadata(file)
            .expect("the file")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
