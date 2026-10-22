//! The coach the player is logged in as, and the store his progress lives in
//! (tài-khoản-HLV-tech-spec Y1–Y6). The game reaches that progress only through
//! `CoachProgressStore`: a file on this machine, or the account server (G-2,
//! `coach_server`), which runs the same rules (`ofm_rules::coach_progress`) on
//! its own clock.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use db::coach_store::{CoachIdentity, CoachStore};
use db::save_manager::SaveManager;
use domain::coach::{CoachAccount, CoachProgress, CoachRegion};
use ofm_core::coach_progress::{self, CoachMatchRecord, CoachRecord, DAILY_XP_MATCH_LIMIT};
use ofm_core::game::Game;
use ofm_core::manager_mastery::{apply_coach_progress, MasteryGain};
use ofm_core::state::StateManager;
use serde::{Deserialize, Serialize};

use super::coach_server::{
    configured_server_url, ApiClient, KeyringVault, RemoteCoachProgressStore, ServerSession,
};

/// Set to `1` to play as if the account server could not be reached: matches
/// still play and save, but earn the account nothing (Y12). For trying the
/// warning by hand until the real server exists.
pub const OFFLINE_ENV: &str = "OFM_COACH_OFFLINE";
const NOT_LOGGED_IN: &str = "be.error.coach.notLoggedIn";
const OFFLINE: &str = "be.error.coach.offline";
const SAVE_OF_ANOTHER_ACCOUNT: &str = "be.error.coach.saveOfAnotherAccount";
const SAVE_WITHOUT_ACCOUNT: &str = "be.error.coach.saveWithoutAccount";
/// What the screens for accounts on this machine get when the accounts are on the server.
const MANAGED_BY_SERVER: &str = "be.error.coach.managedByServer";

/// Why the store could not take a report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoachStoreError {
    /// No connection: the records are dropped and the player warned (Y12).
    Unreachable,
    /// The store answered with an error, as a translation key.
    Failed(String),
}

impl CoachStoreError {
    pub fn key(&self) -> String {
        match self {
            Self::Unreachable => OFFLINE.to_string(),
            Self::Failed(key) => key.clone(),
        }
    }
}

/// The account's progress after a report, and what the last match that earned
/// XP did for the mastery of its style.
#[derive(Debug, Clone, PartialEq)]
pub struct CoachReport {
    pub progress: CoachProgress,
    pub mastery_gain: Option<MasteryGain>,
}

/// Where an account's progress is kept and counted.
pub trait CoachProgressStore: Send + Sync {
    /// The progress as last confirmed. Readable even with no connection: the
    /// player then sees it unchanged (Y12).
    fn load(&self, account: &CoachAccount) -> Result<CoachProgress, CoachStoreError>;
    /// Count `records` into the account at `now_unix`, by the store's rules.
    fn report(
        &self,
        account: &CoachAccount,
        records: &[CoachRecord],
        now_unix: i64,
    ) -> Result<CoachReport, CoachStoreError>;
    /// Whether a report would get through now.
    fn is_reachable(&self) -> bool;
}

/// The store on this machine.
pub struct LocalCoachProgressStore {
    store: CoachStore,
    is_offline: bool,
    /// One report at a time: each reads, counts and writes the whole file.
    writing: Mutex<()>,
}

impl LocalCoachProgressStore {
    pub fn new(store: CoachStore, is_offline: bool) -> Self {
        Self {
            store,
            is_offline,
            writing: Mutex::new(()),
        }
    }
}

impl CoachProgressStore for LocalCoachProgressStore {
    fn load(&self, account: &CoachAccount) -> Result<CoachProgress, CoachStoreError> {
        self.store
            .progress(&account.id)
            .map_err(CoachStoreError::Failed)
    }

    fn report(
        &self,
        account: &CoachAccount,
        records: &[CoachRecord],
        now_unix: i64,
    ) -> Result<CoachReport, CoachStoreError> {
        if self.is_offline {
            return Err(CoachStoreError::Unreachable);
        }
        let _writing = lock(&self.writing);
        let mut progress = self.load(account)?;
        let mut mastery_gain = None;
        for record in records {
            let (next, gain) = coach_progress::apply(&progress, record, now_unix, account.region);
            progress = next;
            mastery_gain = gain.or(mastery_gain);
        }
        progress.synced_at = Some(now_unix);
        self.store
            .write_progress(&account.id, &progress)
            .map_err(CoachStoreError::Failed)?;
        Ok(CoachReport {
            progress,
            mastery_gain,
        })
    }

    fn is_reachable(&self) -> bool {
        !self.is_offline
    }
}

/// The accounts, the one logged in, and its progress store: managed app state.
pub struct CoachContext {
    accounts: CoachStore,
    progress: Arc<dyn CoachProgressStore>,
    /// The menu's old profiles, turned into accounts the first time the list is read.
    legacy_profiles: PathBuf,
    active: Mutex<Option<CoachAccount>>,
    /// The session with the account server, when the accounts live there.
    server: Option<Arc<ServerSession>>,
}

impl CoachContext {
    pub fn new(
        accounts: CoachStore,
        progress: Arc<dyn CoachProgressStore>,
        legacy_profiles: PathBuf,
    ) -> Self {
        Self {
            accounts,
            progress,
            legacy_profiles,
            active: Mutex::new(None),
            server: None,
        }
    }

    /// The account server when one is configured (`OFM_SERVER_URL`), the store on this machine
    /// otherwise.
    pub fn from_environment(app_data_dir: &Path) -> Self {
        match configured_server_url() {
            Some(url) => {
                log::info!("[coach] accounts on the server at {url}");
                let session = ServerSession::new(
                    ApiClient::new(&url),
                    Box::new(KeyringVault::for_server(&url)),
                );
                Self::with_server(app_data_dir, Arc::new(session))
            }
            None => Self::local(app_data_dir),
        }
    }

    /// Accounts and progress on the server behind `session`. The accounts made on this machine
    /// are not carried over and are deleted (Z7, Q-L5); their careers stay on disk.
    pub fn with_server(app_data_dir: &Path, session: Arc<ServerSession>) -> Self {
        let accounts_dir = app_data_dir.join("coach");
        if accounts_dir.exists() {
            if let Err(error) = std::fs::remove_dir_all(&accounts_dir) {
                log::warn!("[coach] accounts on this machine not removed: {error}");
            }
        }
        let progress = Arc::new(RemoteCoachProgressStore::new(Arc::clone(&session)));
        Self {
            server: Some(session),
            ..Self::new(
                CoachStore::new(accounts_dir),
                progress,
                app_data_dir.join("profiles.json"),
            )
        }
    }

    /// The store on this machine, under `app_data_dir/coach`.
    pub fn local(app_data_dir: &Path) -> Self {
        let accounts = CoachStore::new(app_data_dir.join("coach"));
        let is_offline = std::env::var(OFFLINE_ENV).is_ok_and(|value| value == "1");
        let progress = Arc::new(LocalCoachProgressStore::new(accounts.clone(), is_offline));
        Self::new(accounts, progress, app_data_dir.join("profiles.json"))
    }

    pub fn active_account(&self) -> Option<CoachAccount> {
        lock(&self.active).clone()
    }

    pub fn progress_store(&self) -> &dyn CoachProgressStore {
        self.progress.as_ref()
    }

    pub fn server_session(&self) -> Option<&ServerSession> {
        self.server.as_deref()
    }

    pub(crate) fn set_active_account(&self, account: Option<CoachAccount>) {
        *lock(&self.active) = account;
    }

    /// The accounts on this machine, or the error that they are on the server.
    fn local_accounts(&self) -> Result<&CoachStore, String> {
        match self.server {
            Some(_) => Err(MANAGED_BY_SERVER.to_string()),
            None => Ok(&self.accounts),
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // Nothing is left half-changed under these locks, so a panic elsewhere
    // while one was held does not spoil what it guards.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The account's progress as the menu and the manager screen show it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoachProgressView {
    pub progress: CoachProgress,
    /// Matches that earned XP in the region day under way now.
    pub counted_today: u32,
    pub daily_limit: u32,
    /// When the region day turns next, in Unix seconds.
    pub next_reset_unix: i64,
    pub region: CoachRegion,
    /// No connection: the progress is the last one confirmed and nothing counts.
    pub is_offline: bool,
}

/// Every account, the latest login first. The old profiles become accounts
/// here the first time; a file that cannot be read is left for next time
/// rather than keeping the player out.
pub fn list_coach_accounts(coach: &CoachContext) -> Result<Vec<CoachAccount>, String> {
    let accounts = coach.local_accounts()?;
    if let Err(error) = accounts.import_legacy_profiles(&coach.legacy_profiles) {
        log::warn!("[coach] old manager profiles not imported: {error}");
    }
    accounts.accounts()
}

pub fn create_coach_account(
    coach: &CoachContext,
    identity: CoachIdentity,
    now: &str,
) -> Result<CoachAccount, String> {
    coach
        .local_accounts()?
        .create(validated_identity(identity)?, now)
}

pub fn login_coach_account(
    coach: &CoachContext,
    id: &str,
    now: &str,
) -> Result<CoachAccount, String> {
    let account = coach.local_accounts()?.record_login(id, now)?;
    *lock(&coach.active) = Some(account.clone());
    Ok(account)
}

/// Log out here, and end the session on the server when the account is there.
pub fn logout_coach_account(coach: &CoachContext) {
    *lock(&coach.active) = None;
    if let Some(session) = coach.server_session() {
        session.logout();
    }
}

pub fn update_coach_account(
    coach: &CoachContext,
    id: &str,
    identity: CoachIdentity,
) -> Result<CoachAccount, String> {
    let account = coach
        .local_accounts()?
        .update(id, validated_identity(identity)?)?;
    let mut active = lock(&coach.active);
    if active.as_ref().is_some_and(|a| a.id == id) {
        *active = Some(account.clone());
    }
    Ok(account)
}

/// Delete the account and its progress, logging it out if it is in use. Its
/// careers stay on disk (Q-TK2), playable again once claimed by an account.
pub fn delete_coach_account(coach: &CoachContext, id: &str) -> Result<bool, String> {
    let removed = coach.local_accounts()?.delete(id)?;
    let mut active = lock(&coach.active);
    if active.as_ref().is_some_and(|a| a.id == id) {
        *active = None;
    }
    Ok(removed)
}

pub fn coach_progress_view(
    coach: &CoachContext,
    now_unix: i64,
) -> Result<CoachProgressView, String> {
    let account = coach.active_account().ok_or(NOT_LOGGED_IN)?;
    let store = coach.progress_store();
    let progress = store.load(&account).map_err(|e| e.key())?;
    let today = coach_progress::roll_day(&progress.daily, now_unix, account.region);
    Ok(CoachProgressView {
        counted_today: today.counted_today,
        daily_limit: DAILY_XP_MATCH_LIMIT,
        next_reset_unix: coach_progress::next_reset_unix(now_unix, account.region),
        region: account.region,
        is_offline: !store.is_reachable(),
        progress,
    })
}

/// What reporting a career's records to its account came to.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CoachReportOutcome {
    /// What the last match that earned XP did for its style's mastery.
    pub mastery_gain: Option<MasteryGain>,
    /// The store could not take the report: the player is warned that these
    /// matches earned the account nothing (Y12).
    pub report_failed: bool,
}

/// Hand the records waiting in the active career to the logged-in account's
/// store (Y11), and carry the progress it returns into the career (Y10).
///
/// The records are taken off the career first, whatever comes of them: a record
/// is reported once or never. `coach` is `None` when an MCP agent drove the
/// game, whose matches earn no account anything (Y14); a career of another
/// account than the one logged in is not reported either. Run after the game
/// lock is released, so a slow store never holds the game.
pub fn report_coach_records(
    state: &StateManager,
    coach: Option<&CoachContext>,
    now_unix: i64,
) -> CoachReportOutcome {
    let Some((records, account_id)) = state.update_game(|game| {
        (
            std::mem::take(&mut game.pending_coach_reports),
            game.account_id.clone(),
        )
    }) else {
        return CoachReportOutcome::default();
    };
    let account = coach.and_then(CoachContext::active_account);
    let (Some(coach), Some(account)) = (coach, account) else {
        return CoachReportOutcome::default();
    };
    if records.is_empty() || account_id.as_deref() != Some(account.id.as_str()) {
        return CoachReportOutcome::default();
    }
    let save_id = state.get_save_id().unwrap_or_default();
    let records: Vec<CoachRecord> = records
        .into_iter()
        .map(|record| match record {
            CoachRecord::Match(game) => CoachRecord::Match(CoachMatchRecord {
                save_id: save_id.clone(),
                ..game
            }),
            honour => honour,
        })
        .collect();
    match coach.progress_store().report(&account, &records, now_unix) {
        Ok(report) => {
            state.update_game(|game| {
                apply_coach_progress(game, &report.progress, report.mastery_gain.as_ref());
            });
            CoachReportOutcome {
                mastery_gain: report.mastery_gain,
                report_failed: false,
            }
        }
        Err(error) => {
            log::warn!(
                "[coach] {} record(s) not reported: {}",
                records.len(),
                error.key()
            );
            CoachReportOutcome {
                mastery_gain: None,
                report_failed: true,
            }
        }
    }
}

/// `result` of a GUI command that advanced the game, once the matches it played
/// have been reported to the logged-in coach. For the commands whose response
/// carries no warning: their days play no match that earns XP.
pub fn after_reporting_to_coach<T>(
    state: &StateManager,
    coach: &CoachContext,
    result: Result<T, String>,
) -> Result<T, String> {
    report_coach_records(state, Some(coach), chrono::Utc::now().timestamp());
    result
}

/// A coach context over a fresh directory with one account logged in, for the
/// tests of the commands that report to it.
#[cfg(test)]
pub(crate) fn logged_in_test_coach(
    is_offline: bool,
) -> (tempfile::TempDir, CoachContext, CoachAccount) {
    let Ok(dir) = tempfile::tempdir() else {
        unreachable!("a test needs a temporary directory");
    };
    let accounts = CoachStore::new(dir.path().join("coach"));
    let progress = Arc::new(LocalCoachProgressStore::new(accounts.clone(), is_offline));
    let coach = CoachContext::new(accounts, progress, dir.path().join("profiles.json"));
    let identity = CoachIdentity {
        first_name: "Dung".to_string(),
        last_name: "Ung".to_string(),
        date_of_birth: "1990-05-01".to_string(),
        nationality: "VN".to_string(),
        region: CoachRegion::AsiaSoutheast,
    };
    let account = create_coach_account(&coach, identity, "t0")
        .and_then(|account| login_coach_account(&coach, &account.id, "t1"));
    let Ok(account) = account else {
        unreachable!("a fresh store takes an account");
    };
    (dir, coach, account)
}

/// The logged-in account and what it has built up: who leads a new career, and
/// the progress a career is opened with (Y10).
pub fn active_coach_with_progress(
    coach: &CoachContext,
) -> Result<(CoachAccount, CoachProgress), String> {
    let account = coach.active_account().ok_or(NOT_LOGGED_IN)?;
    let progress = coach.progress_store().load(&account).map_err(|e| e.key())?;
    Ok((account, progress))
}

/// Make `game`, a new career, the logged-in account's, carrying its progress.
pub fn give_career_to_coach(game: &mut Game, account: &CoachAccount, progress: &CoachProgress) {
    game.account_id = Some(account.id.clone());
    apply_coach_progress(game, progress, None);
}

/// Open `game`, just loaded, for the logged-in account: only its own careers,
/// carrying the account's progress as it stands now (Y9, Y10). A career with no
/// account has to be claimed first (`claim_save_for_coach`, Q-TK3).
pub fn open_career_for_coach(game: &mut Game, coach: &CoachContext) -> Result<(), String> {
    let (account, progress) = active_coach_with_progress(coach)?;
    match game.account_id.as_deref() {
        None => return Err(SAVE_WITHOUT_ACCOUNT.to_string()),
        Some(id) if id != account.id => return Err(SAVE_OF_ANOTHER_ACCOUNT.to_string()),
        Some(_) => {}
    }
    apply_coach_progress(game, &progress, None);
    Ok(())
}

/// Make the save `save_id`, from before accounts, the logged-in account's
/// (Q-TK3). Its mastery is the account's from the next time it is opened; what
/// it had of its own is not carried over to the account.
pub fn claim_save_for_coach(
    saves: &mut SaveManager,
    coach: &CoachContext,
    save_id: &str,
) -> Result<(), String> {
    let account = coach.active_account().ok_or(NOT_LOGGED_IN)?;
    let mut game = saves.load_game(save_id)?;
    match game.account_id.as_deref() {
        Some(id) if id == account.id => return Ok(()),
        Some(_) => return Err(SAVE_OF_ANOTHER_ACCOUNT.to_string()),
        None => {}
    }
    game.account_id = Some(account.id);
    saves.save_game(&game, save_id)
}

/// `identity` trimmed, or the error the new-career form already shows for it.
pub(crate) fn validated_identity(identity: CoachIdentity) -> Result<CoachIdentity, String> {
    let first_name = identity.first_name.trim().to_string();
    let last_name = identity.last_name.trim().to_string();
    if first_name.is_empty() || last_name.is_empty() {
        return Err("be.error.createManager.nameRequired".to_string());
    }
    if first_name.len() > 30 || last_name.len() > 30 {
        return Err("be.error.createManager.nameMaxLength".to_string());
    }
    let nationality = identity.nationality.trim().to_string();
    if nationality.is_empty() {
        return Err("be.error.createManager.nationalityRequired".to_string());
    }
    chrono::NaiveDate::parse_from_str(&identity.date_of_birth, "%Y-%m-%d")
        .map_err(|_| "be.error.createManager.invalidDobFormat".to_string())?;
    Ok(CoachIdentity {
        first_name,
        last_name,
        nationality,
        ..identity
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::league::FixtureCompetition;
    use domain::team::PlayStyle;

    /// 2026-10-21T00:00:00Z.
    const MIDNIGHT_UTC: i64 = 1_792_540_800;
    const HOUR: i64 = 3_600;

    fn identity() -> CoachIdentity {
        CoachIdentity {
            first_name: " Dung ".to_string(),
            last_name: "Ung".to_string(),
            date_of_birth: "1990-05-01".to_string(),
            nationality: "VN".to_string(),
            region: CoachRegion::AsiaSoutheast,
        }
    }

    fn context(is_offline: bool) -> (tempfile::TempDir, CoachContext) {
        let dir = tempfile::tempdir().unwrap();
        let accounts = CoachStore::new(dir.path().join("coach"));
        let progress = Arc::new(LocalCoachProgressStore::new(accounts.clone(), is_offline));
        let coach = CoachContext::new(accounts, progress, dir.path().join("profiles.json"));
        (dir, coach)
    }

    fn logged_in(is_offline: bool) -> (tempfile::TempDir, CoachContext, CoachAccount) {
        logged_in_test_coach(is_offline)
    }

    fn win(earns_xp: bool) -> CoachRecord {
        CoachRecord::Match(CoachMatchRecord {
            save_id: "save".into(),
            fixture_id: "fix".into(),
            competition: FixtureCompetition::League,
            own_goals: 2,
            opponent_goals: 0,
            own_strength: 70.0,
            opponent_strength: 70.0,
            style: PlayStyle::Counter,
            earns_xp,
        })
    }

    /// Given a new account, when it logs in and then out,
    /// then it is the active account until it logs out.
    #[test]
    fn logging_in_and_out_sets_the_active_account() {
        let (_dir, coach, account) = logged_in(false);

        assert_eq!(coach.active_account(), Some(account.clone()));
        assert_eq!(account.first_name, "Dung");
        assert_eq!(account.last_login_at.as_deref(), Some("t1"));

        logout_coach_account(&coach);

        assert_eq!(coach.active_account(), None);
    }

    /// Given an identity with no first name or a malformed birth date,
    /// when an account is made from it, then the new-career form's error comes back.
    #[test]
    fn an_account_needs_a_name_and_a_birth_date() {
        let (_dir, coach) = context(false);
        let nameless = CoachIdentity {
            first_name: "  ".to_string(),
            ..identity()
        };
        let undated = CoachIdentity {
            date_of_birth: "01/05/1990".to_string(),
            ..identity()
        };

        assert_eq!(
            create_coach_account(&coach, nameless, "t").unwrap_err(),
            "be.error.createManager.nameRequired"
        );
        assert_eq!(
            create_coach_account(&coach, undated, "t").unwrap_err(),
            "be.error.createManager.invalidDobFormat"
        );
        assert!(list_coach_accounts(&coach).unwrap().is_empty());
    }

    /// Given the logged-in account, when it is edited and then deleted,
    /// then the active account follows the edit and is logged out by the delete.
    #[test]
    fn editing_and_deleting_the_active_account_follow_through() {
        let (_dir, coach, account) = logged_in(false);
        let edited = CoachIdentity {
            region: CoachRegion::Europe,
            ..identity()
        };

        update_coach_account(&coach, &account.id, edited).unwrap();
        assert_eq!(
            coach.active_account().map(|a| a.region),
            Some(CoachRegion::Europe)
        );

        assert!(delete_coach_account(&coach, &account.id).unwrap());
        assert_eq!(coach.active_account(), None);
    }

    /// Given the menu's old profiles file, when the accounts are first listed,
    /// then its profiles are listed as accounts.
    #[test]
    fn listing_imports_the_old_profiles() {
        let (dir, coach) = context(false);
        std::fs::write(
            dir.path().join("profiles.json"),
            r#"{"version":1,"profiles":[{"id":"p-1","first_name":"Dung","last_name":"Ung",
                "date_of_birth":"1990-05-01","nationality":"VN","created_at":"2026-09-01"}]}"#,
        )
        .unwrap();

        let accounts = list_coach_accounts(&coach).unwrap();

        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, "p-1");
    }

    /// Given a logged-in account, when a match that earns XP is reported,
    /// then the progress is counted, kept for a fresh read, and its gain returned.
    #[test]
    fn a_reported_match_is_counted_and_kept() {
        let (_dir, coach, account) = logged_in(false);
        let now = MIDNIGHT_UTC + 6 * HOUR;

        let report = coach
            .progress_store()
            .report(&account, &[win(true), win(false)], now)
            .unwrap();

        assert_eq!(report.progress.totals.matches, 2);
        assert_eq!(report.progress.daily.counted_today, 1);
        assert_eq!(report.progress.synced_at, Some(now));
        assert_eq!(
            report.mastery_gain.map(|gain| gain.style),
            Some(PlayStyle::Counter)
        );
        assert_eq!(
            coach.progress_store().load(&account).unwrap(),
            report.progress
        );
    }

    /// Given the store cannot be reached, when a match is reported,
    /// then the report fails as unreachable and the progress stays as it was.
    #[test]
    fn an_unreachable_store_counts_nothing() {
        let (_dir, coach, account) = logged_in(true);

        let error = coach
            .progress_store()
            .report(&account, &[win(true)], MIDNIGHT_UTC)
            .unwrap_err();

        assert_eq!(error, CoachStoreError::Unreachable);
        assert_eq!(error.key(), OFFLINE);
        assert_eq!(
            coach.progress_store().load(&account).unwrap(),
            CoachProgress::default()
        );
        assert!(
            coach_progress_view(&coach, MIDNIGHT_UTC)
                .unwrap()
                .is_offline
        );
    }

    /// Given a match counted yesterday, when the progress is viewed after the
    /// region day turned, then today's count reads 0 and the next reset is the next 04:00.
    #[test]
    fn the_view_counts_the_day_under_way() {
        let (_dir, coach, account) = logged_in(false);
        // 06:00 UTC on the 21st is 13:00 in UTC+7: the region day of the 21st.
        let played = MIDNIGHT_UTC + 6 * HOUR;
        coach
            .progress_store()
            .report(&account, &[win(true)], played)
            .unwrap();

        let same_day = coach_progress_view(&coach, played + HOUR).unwrap();
        // 22:00 UTC on the 21st is 05:00 on the 22nd in UTC+7: a new region day.
        let next_day = coach_progress_view(&coach, MIDNIGHT_UTC + 22 * HOUR).unwrap();

        assert_eq!(same_day.counted_today, 1);
        assert_eq!(same_day.daily_limit, 50);
        assert_eq!(same_day.next_reset_unix, MIDNIGHT_UTC + 21 * HOUR);
        assert!(!same_day.is_offline);
        assert_eq!(next_day.counted_today, 0);
    }

    /// Given no one logged in, when the progress is asked for,
    /// then the answer is that no account is logged in.
    #[test]
    fn progress_needs_a_login() {
        let (_dir, coach) = context(false);

        assert_eq!(
            coach_progress_view(&coach, MIDNIGHT_UTC).unwrap_err(),
            NOT_LOGGED_IN
        );
    }

    fn state_with_records(account_id: Option<&str>, records: Vec<CoachRecord>) -> StateManager {
        let clock = ofm_core::clock::GameClock::new(
            chrono::TimeZone::with_ymd_and_hms(&chrono::Utc, 2025, 8, 1, 12, 0, 0).unwrap(),
        );
        let manager = domain::manager::Manager::new(
            "mgr_user".to_string(),
            "Dung".to_string(),
            "Ung".to_string(),
            "1990-05-01".to_string(),
            "VN".to_string(),
        );
        let mut game = Game::new(clock, manager, vec![], vec![], vec![], vec![]);
        game.account_id = account_id.map(str::to_string);
        game.pending_coach_reports = records;
        let state = StateManager::new();
        state.set_game(game);
        state.set_save_id("save-1".to_string());
        state
    }

    fn pending(state: &StateManager) -> usize {
        state
            .get_game(|game| game.pending_coach_reports.len())
            .unwrap()
    }

    /// Given the logged-in account's career with a managed win and a trophy waiting,
    /// When the records are reported,
    /// Then the account counts them, the career carries its new XP, and nothing waits.
    #[test]
    fn a_careers_records_reach_its_account() {
        let (_dir, coach, account) = logged_in(false);
        let state = state_with_records(
            Some(&account.id),
            vec![
                win(true),
                CoachRecord::Honour(domain::manager::HonourKind::League),
            ],
        );

        let outcome = report_coach_records(&state, Some(&coach), MIDNIGHT_UTC);

        assert!(!outcome.report_failed);
        assert_eq!(
            outcome.mastery_gain.map(|gain| gain.style),
            Some(PlayStyle::Counter)
        );
        let progress = coach.progress_store().load(&account).unwrap();
        assert_eq!(progress.totals.matches, 1);
        assert_eq!(progress.totals.trophies, 1);
        assert_eq!(pending(&state), 0);
        let carried = state
            .get_game(|game| game.manager.progression.style_xp)
            .unwrap();
        assert_eq!(carried, progress.style_xp);
        assert_eq!(carried.counter.matches, 1);
    }

    /// Given an MCP agent drove the match (no coach context),
    /// When the records are reported,
    /// Then they are dropped and the account counts nothing (Y14).
    #[test]
    fn an_agents_records_are_dropped() {
        let (_dir, coach, account) = logged_in(false);
        let state = state_with_records(Some(&account.id), vec![win(true)]);

        let outcome = report_coach_records(&state, None, MIDNIGHT_UTC);

        assert_eq!(outcome, CoachReportOutcome::default());
        assert_eq!(pending(&state), 0);
        assert_eq!(
            coach.progress_store().load(&account).unwrap(),
            CoachProgress::default()
        );
    }

    /// Given the store cannot be reached,
    /// When the records are reported,
    /// Then they are dropped, the account counts nothing and the failure is flagged (Y12).
    #[test]
    fn an_unreachable_store_flags_the_report() {
        let (_dir, coach, account) = logged_in(true);
        let state = state_with_records(Some(&account.id), vec![win(true)]);

        let outcome = report_coach_records(&state, Some(&coach), MIDNIGHT_UTC);

        assert!(outcome.report_failed);
        assert!(outcome.mastery_gain.is_none());
        assert_eq!(pending(&state), 0);
        assert_eq!(
            coach.progress_store().load(&account).unwrap(),
            CoachProgress::default()
        );
    }

    /// Given a career that belongs to another account than the one logged in,
    /// When its records are reported,
    /// Then they are dropped: no account is credited with another's matches.
    #[test]
    fn another_accounts_records_are_dropped() {
        let (_dir, coach, account) = logged_in(false);
        let state = state_with_records(Some("someone-else"), vec![win(true)]);

        let outcome = report_coach_records(&state, Some(&coach), MIDNIGHT_UTC);

        assert_eq!(outcome, CoachReportOutcome::default());
        assert_eq!(pending(&state), 0);
        assert_eq!(
            coach.progress_store().load(&account).unwrap(),
            CoachProgress::default()
        );
    }

    /// Given a logged-in account with Counter at 63,
    /// When a new career is given to it,
    /// Then the career belongs to the account and its manager carries Counter 63.
    #[test]
    fn a_new_career_carries_the_accounts_progress() {
        let (_dir, coach, account) = logged_in(false);
        let mut progress = CoachProgress::default();
        progress.mastery.counter = 63;
        coach
            .accounts
            .write_progress(&account.id, &progress)
            .unwrap();
        let state = state_with_records(None, vec![]);
        let mut game = state.get_game(Game::clone).unwrap();

        let (active, loaded) = active_coach_with_progress(&coach).unwrap();
        give_career_to_coach(&mut game, &active, &loaded);

        assert_eq!(game.account_id.as_deref(), Some(account.id.as_str()));
        assert_eq!(game.manager.play_style_mastery.counter, 63);
    }

    /// Given careers of the logged-in account, of another, and of none,
    /// When each is opened,
    /// Then only the account's own opens, carrying its progress.
    #[test]
    fn only_the_accounts_own_careers_open() {
        let (_dir, coach, account) = logged_in(false);
        let mut progress = CoachProgress::default();
        progress.mastery.possession = 71;
        coach
            .accounts
            .write_progress(&account.id, &progress)
            .unwrap();
        let career = |owner: Option<&str>| {
            let mut game = state_with_records(owner, vec![])
                .get_game(Game::clone)
                .unwrap();
            open_career_for_coach(&mut game, &coach).map(|()| game)
        };

        let own = career(Some(&account.id)).unwrap();
        assert_eq!(own.manager.play_style_mastery.possession, 71);
        assert_eq!(
            career(Some("someone-else")).unwrap_err(),
            SAVE_OF_ANOTHER_ACCOUNT
        );
        assert_eq!(career(None).unwrap_err(), SAVE_WITHOUT_ACCOUNT);
    }

    /// Given a save from before accounts,
    /// When the logged-in account claims it,
    /// Then the save belongs to the account and opens for it; another account cannot take it.
    #[test]
    fn a_save_without_an_account_can_be_claimed_once() {
        let (dir, coach, account) = logged_in(false);
        let mut saves = SaveManager::init(&dir.path().join("saves")).unwrap();
        let game = state_with_records(None, vec![])
            .get_game(Game::clone)
            .unwrap();
        let save_id = saves.create_save(&game, "Old career").unwrap();

        claim_save_for_coach(&mut saves, &coach, &save_id).unwrap();

        assert_eq!(
            saves.list_saves()[0].account_id.as_deref(),
            Some(account.id.as_str())
        );
        let mut loaded = saves.load_game(&save_id).unwrap();
        assert!(open_career_for_coach(&mut loaded, &coach).is_ok());
        claim_save_for_coach(&mut saves, &coach, &save_id).unwrap();

        let other = create_coach_account(&coach, identity(), "t2").unwrap();
        login_coach_account(&coach, &other.id, "t3").unwrap();
        assert_eq!(
            claim_save_for_coach(&mut saves, &coach, &save_id).unwrap_err(),
            SAVE_OF_ANOTHER_ACCOUNT
        );
    }
}
