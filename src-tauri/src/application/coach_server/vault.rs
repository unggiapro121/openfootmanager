//! Where the refresh token waits between two runs of the game: the operating system's keychain
//! (tech-spec-phase3 §5, assumption A13). The access token never leaves memory.

/// Keeps one refresh token. A failure to keep it costs the player a login next time, nothing
/// more, so it is logged rather than returned.
pub trait RefreshTokenVault: Send + Sync {
    fn load(&self) -> Option<String>;
    fn store(&self, token: &str);
    fn clear(&self);
}

const SERVICE: &str = "openfootmanager";

/// The keychain entry of one server: a token from the local test server never meets another.
pub struct KeyringVault {
    user: String,
}

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
