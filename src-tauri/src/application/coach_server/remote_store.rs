//! The account's progress kept and counted by the server (G-2): the same `CoachProgressStore` the
//! game used on this machine, over `GET /v1/coach/progress` and `POST /v1/coach/reports`. The
//! server counts on its own clock and the account's region; the client's clock counts for nothing.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use domain::coach::{CoachAccount, CoachProgress};
use ofm_core::coach_progress::CoachRecord;
use ofm_core::manager_mastery::MasteryGain;
use serde::{Deserialize, Serialize};

use super::client::ApiError;
use super::session::ServerSession;
use crate::application::coach::{CoachProgressStore, CoachReport, CoachStoreError};

/// The most records the server takes in one report; a longer advance is sent in parts.
const MAX_RECORDS_PER_REPORT: usize = 100;

#[derive(Deserialize)]
struct ProgressResponse {
    progress: CoachProgress,
}

#[derive(Serialize)]
struct ReportRequest<'a> {
    records: &'a [CoachRecord],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportResponse {
    progress: CoachProgress,
    mastery_gain: Option<MasteryGain>,
}

pub struct RemoteCoachProgressStore {
    session: Arc<ServerSession>,
    /// The progress the server last confirmed, and whose: what the player sees while the server
    /// cannot be reached (Y12).
    confirmed: Mutex<Option<(String, CoachProgress)>>,
    is_reachable: AtomicBool,
}

impl RemoteCoachProgressStore {
    pub fn new(session: Arc<ServerSession>) -> Self {
        Self {
            session,
            confirmed: Mutex::new(None),
            is_reachable: AtomicBool::new(true),
        }
    }

    fn confirm(&self, account: &CoachAccount, progress: &CoachProgress) {
        self.is_reachable.store(true, Ordering::Relaxed);
        *self
            .confirmed
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some((account.id.clone(), progress.clone()));
    }

    fn last_confirmed(&self, account: &CoachAccount) -> Option<CoachProgress> {
        self.confirmed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .filter(|(id, _)| *id == account.id)
            .map(|(_, progress)| progress.clone())
    }

    fn note_failure(&self, error: &ApiError) {
        if error.is_outage() {
            self.is_reachable.store(false, Ordering::Relaxed);
        }
    }

    /// One part of a report, under one key: sent again once with the same key if no answer came,
    /// which the server counts at most once (Z12).
    fn report_part(
        &self,
        records: &[CoachRecord],
        now_unix: i64,
    ) -> Result<ReportResponse, ApiError> {
        let key = idempotency_key();
        let body = ReportRequest { records };
        let send = || {
            self.session
                .post_authorized("/v1/coach/reports", &body, &key, now_unix)
        };
        match send() {
            Err(ApiError::Unreachable) => send(),
            outcome => outcome,
        }
    }
}

impl CoachProgressStore for RemoteCoachProgressStore {
    fn load(&self, account: &CoachAccount) -> Result<CoachProgress, CoachStoreError> {
        let now_unix = chrono::Utc::now().timestamp();
        match self
            .session
            .get_authorized::<ProgressResponse>("/v1/coach/progress", now_unix)
        {
            Ok(response) => {
                self.confirm(account, &response.progress);
                Ok(response.progress)
            }
            Err(error) => {
                self.note_failure(&error);
                self.last_confirmed(account).ok_or_else(|| error.into())
            }
        }
    }

    fn report(
        &self,
        account: &CoachAccount,
        records: &[CoachRecord],
        now_unix: i64,
    ) -> Result<CoachReport, CoachStoreError> {
        let mut report: Option<CoachReport> = None;
        for part in records.chunks(MAX_RECORDS_PER_REPORT) {
            match self.report_part(part, now_unix) {
                Ok(response) => {
                    self.confirm(account, &response.progress);
                    let earlier_gain = report.and_then(|report| report.mastery_gain);
                    report = Some(CoachReport {
                        progress: response.progress,
                        mastery_gain: response.mastery_gain.or(earlier_gain),
                    });
                }
                Err(error) => {
                    // Parts already counted stay counted; the career catches up on its next load.
                    self.note_failure(&error);
                    return Err(error.into());
                }
            }
        }
        match report {
            Some(report) => Ok(report),
            None => self.load(account).map(|progress| CoachReport {
                progress,
                mastery_gain: None,
            }),
        }
    }

    fn is_reachable(&self) -> bool {
        self.is_reachable.load(Ordering::Relaxed)
    }
}

/// 128 random bits: unique to one report, whatever else the account sends.
fn idempotency_key() -> String {
    let bits: u128 = rand::random();
    format!("coach-report-{bits:032x}")
}
