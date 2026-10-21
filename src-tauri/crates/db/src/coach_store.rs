//! The coach accounts on this machine, and what each has built up, kept as
//! plain files in the app's data directory: `coach/accounts.json` lists the
//! accounts, and `coach/<id>.json` holds one account's progress. A stand-in
//! for the account server (G-2): the application reaches progress only through
//! its `CoachProgressStore`, so the server replaces this without touching the
//! game.

use domain::coach::{CoachAccount, CoachProgress, CoachRegion};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const ACCOUNTS_FILE: &str = "accounts.json";
const LOAD_FAILED: &str = "be.error.coach.loadFailed";
const SAVE_FAILED: &str = "be.error.coach.saveFailed";
const ACCOUNT_NOT_FOUND: &str = "be.error.coach.accountNotFound";

/// Who a coach is, as the player enters it when making or editing an account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachIdentity {
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: String,
    pub nationality: String,
    #[serde(default)]
    pub region: CoachRegion,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AccountIndex {
    version: u32,
    #[serde(default)]
    accounts: Vec<CoachAccount>,
}

/// A manager profile as the menu kept it before accounts (`profiles.json`).
#[derive(Debug, Deserialize)]
struct LegacyProfile {
    id: String,
    first_name: String,
    last_name: String,
    date_of_birth: String,
    nationality: String,
    created_at: String,
    #[serde(default)]
    last_used_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LegacyProfileIndex {
    #[serde(default)]
    profiles: Vec<LegacyProfile>,
}

/// The accounts and their progress under one directory.
#[derive(Debug, Clone)]
pub struct CoachStore {
    dir: PathBuf,
}

impl CoachStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    /// Every account, the one logged into most recently first.
    pub fn accounts(&self) -> Result<Vec<CoachAccount>, String> {
        let mut accounts = self.load_index()?.accounts;
        accounts.sort_by(|a, b| last_seen(b).cmp(last_seen(a)));
        Ok(accounts)
    }

    pub fn account(&self, id: &str) -> Result<Option<CoachAccount>, String> {
        Ok(self.load_index()?.accounts.into_iter().find(|a| a.id == id))
    }

    pub fn create(&self, identity: CoachIdentity, now: &str) -> Result<CoachAccount, String> {
        let mut index = self.load_index()?;
        let account = CoachAccount {
            id: Uuid::new_v4().to_string(),
            first_name: identity.first_name,
            last_name: identity.last_name,
            date_of_birth: identity.date_of_birth,
            nationality: identity.nationality,
            region: identity.region,
            created_at: now.to_string(),
            last_login_at: None,
        };
        index.accounts.push(account.clone());
        self.write_index(&mut index)?;
        Ok(account)
    }

    /// The account with its identity replaced; its id, history and progress stay.
    pub fn update(&self, id: &str, identity: CoachIdentity) -> Result<CoachAccount, String> {
        self.modify(id, |account| {
            account.first_name = identity.first_name;
            account.last_name = identity.last_name;
            account.date_of_birth = identity.date_of_birth;
            account.nationality = identity.nationality;
            account.region = identity.region;
        })
    }

    pub fn record_login(&self, id: &str, now: &str) -> Result<CoachAccount, String> {
        self.modify(id, |account| account.last_login_at = Some(now.to_string()))
    }

    /// Remove the account and its progress. The careers it played stay on disk.
    pub fn delete(&self, id: &str) -> Result<bool, String> {
        let mut index = self.load_index()?;
        let before = index.accounts.len();
        index.accounts.retain(|a| a.id != id);
        if index.accounts.len() == before {
            return Ok(false);
        }
        self.write_index(&mut index)?;
        let progress = self.progress_path(id)?;
        if progress.exists() {
            fs::remove_file(progress).map_err(|_| SAVE_FAILED.to_string())?;
        }
        Ok(true)
    }

    /// What the account has built up; a fresh start when nothing is stored yet.
    pub fn progress(&self, id: &str) -> Result<CoachProgress, String> {
        let path = self.progress_path(id)?;
        if !path.exists() {
            return Ok(CoachProgress::default());
        }
        let data = fs::read_to_string(path).map_err(|_| LOAD_FAILED.to_string())?;
        serde_json::from_str(&data).map_err(|_| LOAD_FAILED.to_string())
    }

    pub fn write_progress(&self, id: &str, progress: &CoachProgress) -> Result<(), String> {
        let path = self.progress_path(id)?;
        let data = serde_json::to_string_pretty(progress).map_err(|_| SAVE_FAILED.to_string())?;
        write_atomically(&path, &data)
    }

    /// Turn the menu's old manager profiles into accounts, once: each keeps its
    /// id and dates and plays in the default region, and the old file is
    /// renamed out of the way so it is never read again. How many were added.
    pub fn import_legacy_profiles(&self, profiles_path: &Path) -> Result<usize, String> {
        if !profiles_path.exists() {
            return Ok(0);
        }
        let data = fs::read_to_string(profiles_path).map_err(|_| LOAD_FAILED.to_string())?;
        let legacy: LegacyProfileIndex =
            serde_json::from_str(&data).map_err(|_| LOAD_FAILED.to_string())?;
        let mut index = self.load_index()?;
        let mut added = 0;
        for profile in legacy.profiles {
            if index.accounts.iter().any(|a| a.id == profile.id) {
                continue;
            }
            index.accounts.push(CoachAccount {
                id: profile.id,
                first_name: profile.first_name,
                last_name: profile.last_name,
                date_of_birth: profile.date_of_birth,
                nationality: profile.nationality,
                region: CoachRegion::default(),
                created_at: profile.created_at,
                last_login_at: profile.last_used_at,
            });
            added += 1;
        }
        self.write_index(&mut index)?;
        fs::rename(profiles_path, profiles_path.with_extension("json.migrated"))
            .map_err(|_| SAVE_FAILED.to_string())?;
        Ok(added)
    }

    fn modify(
        &self,
        id: &str,
        change: impl FnOnce(&mut CoachAccount),
    ) -> Result<CoachAccount, String> {
        let mut index = self.load_index()?;
        let account = index
            .accounts
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| ACCOUNT_NOT_FOUND.to_string())?;
        change(account);
        let updated = account.clone();
        self.write_index(&mut index)?;
        Ok(updated)
    }

    fn load_index(&self) -> Result<AccountIndex, String> {
        let path = self.dir.join(ACCOUNTS_FILE);
        if !path.exists() {
            return Ok(AccountIndex::default());
        }
        let data = fs::read_to_string(path).map_err(|_| LOAD_FAILED.to_string())?;
        serde_json::from_str(&data).map_err(|_| LOAD_FAILED.to_string())
    }

    fn write_index(&self, index: &mut AccountIndex) -> Result<(), String> {
        index.version = 1;
        let data = serde_json::to_string_pretty(index).map_err(|_| SAVE_FAILED.to_string())?;
        write_atomically(&self.dir.join(ACCOUNTS_FILE), &data)
    }

    /// The progress file of `id`. Ids are made here (UUIDs) or kept from the
    /// old profiles, so anything that could step outside the directory is no
    /// account at all.
    fn progress_path(&self, id: &str) -> Result<PathBuf, String> {
        let is_plain = !id.is_empty()
            && id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !is_plain {
            return Err(ACCOUNT_NOT_FOUND.to_string());
        }
        Ok(self.dir.join(format!("{id}.json")))
    }
}

fn last_seen(account: &CoachAccount) -> &str {
    account
        .last_login_at
        .as_deref()
        .unwrap_or(&account.created_at)
}

/// Write through a temporary file and a rename, so a crash mid-write leaves the
/// old file whole rather than half of the new one.
fn write_atomically(path: &Path, data: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| SAVE_FAILED.to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, data).map_err(|_| SAVE_FAILED.to_string())?;
    fs::rename(&temporary, path).map_err(|_| SAVE_FAILED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::coach::CoachTotals;

    fn identity(first: &str, last: &str) -> CoachIdentity {
        CoachIdentity {
            first_name: first.to_string(),
            last_name: last.to_string(),
            date_of_birth: "1963-01-26".to_string(),
            nationality: "PT".to_string(),
            region: CoachRegion::Europe,
        }
    }

    fn store() -> (tempfile::TempDir, CoachStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = CoachStore::new(dir.path().join("coach"));
        (dir, store)
    }

    /// Given an empty store, when an account is created,
    /// then it is listed with its identity and region and no login yet.
    #[test]
    fn a_created_account_is_listed() {
        let (_dir, store) = store();
        let account = store
            .create(identity("José", "Mourinho"), "2026-10-22T01:00:00Z")
            .unwrap();

        let accounts = store.accounts().unwrap();
        assert_eq!(accounts, vec![account.clone()]);
        assert_eq!(account.region, CoachRegion::Europe);
        assert_eq!(account.created_at, "2026-10-22T01:00:00Z");
        assert!(account.last_login_at.is_none());
    }

    /// Given two accounts with the same name, when both are created,
    /// then both exist: an account is a person's choice, not deduplicated.
    #[test]
    fn two_accounts_may_share_a_name() {
        let (_dir, store) = store();
        let first = store.create(identity("Alex", "Ferguson"), "t1").unwrap();
        let second = store.create(identity("Alex", "Ferguson"), "t2").unwrap();

        assert_ne!(first.id, second.id);
        assert_eq!(store.accounts().unwrap().len(), 2);
    }

    /// Given two accounts, when the older one logs in,
    /// then it is listed first.
    #[test]
    fn the_latest_login_is_listed_first() {
        let (_dir, store) = store();
        let older = store
            .create(identity("Pep", "Guardiola"), "2026-10-01")
            .unwrap();
        let newer = store
            .create(identity("Jürgen", "Klopp"), "2026-10-02")
            .unwrap();
        assert_eq!(store.accounts().unwrap()[0].id, newer.id);

        let logged_in = store.record_login(&older.id, "2026-10-03").unwrap();

        assert_eq!(logged_in.last_login_at.as_deref(), Some("2026-10-03"));
        assert_eq!(store.accounts().unwrap()[0].id, older.id);
    }

    /// Given an account, when its identity is edited,
    /// then its id and creation date stay and the new identity is stored.
    #[test]
    fn editing_keeps_the_id_and_creation_date() {
        let (_dir, store) = store();
        let account = store.create(identity("José", "Mourinho"), "t1").unwrap();
        let mut edited = identity("Jose", "Mourinho");
        edited.region = CoachRegion::AsiaEast;

        let updated = store.update(&account.id, edited).unwrap();

        assert_eq!(updated.id, account.id);
        assert_eq!(updated.created_at, "t1");
        assert_eq!(updated.first_name, "Jose");
        assert_eq!(store.account(&account.id).unwrap(), Some(updated));
    }

    /// Given no such account, when it is edited or logged into,
    /// then the store answers that the account was not found.
    #[test]
    fn an_unknown_account_is_not_found() {
        let (_dir, store) = store();

        assert_eq!(
            store.update("missing", identity("A", "B")).unwrap_err(),
            ACCOUNT_NOT_FOUND
        );
        assert_eq!(
            store.record_login("missing", "t").unwrap_err(),
            ACCOUNT_NOT_FOUND
        );
    }

    /// Given an account with progress, when it is deleted,
    /// then neither the account nor its progress remains, and a second delete finds nothing.
    #[test]
    fn deleting_an_account_removes_its_progress() {
        let (_dir, store) = store();
        let account = store.create(identity("Pep", "Guardiola"), "t1").unwrap();
        let progress = CoachProgress {
            totals: CoachTotals {
                matches: 3,
                ..CoachTotals::default()
            },
            ..CoachProgress::default()
        };
        store.write_progress(&account.id, &progress).unwrap();

        assert!(store.delete(&account.id).unwrap());

        assert!(store.accounts().unwrap().is_empty());
        assert_eq!(
            store.progress(&account.id).unwrap(),
            CoachProgress::default()
        );
        assert!(!store.delete(&account.id).unwrap());
    }

    /// Given an account, when its progress is written and read back by a fresh store,
    /// then every value survives.
    #[test]
    fn progress_round_trips() {
        let (dir, store) = store();
        let account = store.create(identity("Carlo", "Ancelotti"), "t1").unwrap();
        let mut progress = CoachProgress::default();
        progress.totals.matches = 51;
        progress.totals.trophies = 2;
        progress.daily.day = 20_383;
        progress.daily.counted_today = 21;
        progress.daily.last_reset_unix = Some(1_761_080_400);
        progress.synced_at = Some(1_761_100_000);

        store.write_progress(&account.id, &progress).unwrap();

        let fresh = CoachStore::new(dir.path().join("coach"));
        assert_eq!(fresh.progress(&account.id).unwrap(), progress);
    }

    /// Given an id that would reach outside the store, when its progress is asked for,
    /// then it is no account.
    #[test]
    fn an_id_with_a_path_in_it_is_refused() {
        let (_dir, store) = store();

        assert_eq!(store.progress("../escape").unwrap_err(), ACCOUNT_NOT_FOUND);
        assert_eq!(
            store
                .write_progress("a/b", &CoachProgress::default())
                .unwrap_err(),
            ACCOUNT_NOT_FOUND
        );
    }

    /// Given the menu's old profiles file, when it is imported,
    /// then each profile becomes an account with its id and dates in the default region,
    /// and the old file is renamed so a second import adds nothing.
    #[test]
    fn old_profiles_become_accounts_once() {
        let (dir, store) = store();
        let profiles = dir.path().join("profiles.json");
        fs::write(
            &profiles,
            r#"{"version":1,"profiles":[
                {"id":"p-1","first_name":"Dung","last_name":"Ung","date_of_birth":"1990-05-01",
                 "nationality":"VN","created_at":"2026-09-01","last_used_at":"2026-10-20"},
                {"id":"p-2","first_name":"Pep","last_name":"Guardiola","date_of_birth":"1971-01-18",
                 "nationality":"ES","created_at":"2026-09-02"}
            ]}"#,
        )
        .unwrap();

        assert_eq!(store.import_legacy_profiles(&profiles).unwrap(), 2);

        let accounts = store.accounts().unwrap();
        assert_eq!(accounts.len(), 2);
        let dung = accounts.iter().find(|a| a.id == "p-1").unwrap();
        assert_eq!(dung.first_name, "Dung");
        assert_eq!(dung.region, CoachRegion::AsiaSoutheast);
        assert_eq!(dung.created_at, "2026-09-01");
        assert_eq!(dung.last_login_at.as_deref(), Some("2026-10-20"));
        assert!(!profiles.exists());
        assert!(dir.path().join("profiles.json.migrated").exists());
        assert_eq!(store.import_legacy_profiles(&profiles).unwrap(), 0);
        assert_eq!(store.accounts().unwrap().len(), 2);
    }

    /// Given no old profiles file, when an import is asked for,
    /// then nothing is added and no accounts file is written.
    #[test]
    fn no_old_profiles_imports_nothing() {
        let (dir, store) = store();

        assert_eq!(
            store
                .import_legacy_profiles(&dir.path().join("profiles.json"))
                .unwrap(),
            0
        );
        assert!(!dir.path().join("coach").join(ACCOUNTS_FILE).exists());
    }
}
