//! The coach account: the user's coach as one person across every career on
//! this machine, and (once the server lands, G-2) across offline and online.
//! The account carries what the coach himself has built up — his mastery of
//! each play style, the XP toward it, his career totals — and the day's
//! allowance of matches that earn XP. What belongs to one world stays in its
//! save: reputation, the club, the board and the fans, the club history.

use serde::{Deserialize, Serialize};

use crate::manager::{PlayStyleMastery, StyleXp};

/// The region a coach plays in, chosen when the account is made. Its day turns
/// at a fixed hour of a fixed offset (no summer time), as regional servers of
/// online games keep it: changing the machine's clock or zone moves nothing.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum CoachRegion {
    /// UTC+7.
    #[default]
    AsiaSoutheast,
    /// UTC+8.
    AsiaEast,
    /// UTC+1.
    Europe,
    /// UTC−5.
    Americas,
}

/// Who the coach is, and the region his day is counted in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoachAccount {
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub date_of_birth: String,
    pub nationality: String,
    #[serde(default)]
    pub region: CoachRegion,
    pub created_at: String,
    #[serde(default)]
    pub last_login_at: Option<String>,
}

/// Official matches and trophies across every career of the account.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CoachTotals {
    pub matches: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub trophies: u32,
}

/// The day's allowance of matches that earn XP.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DailyAllowance {
    /// The region day the count belongs to: whole days since the epoch, each
    /// starting at the region's reset hour.
    pub day: i64,
    /// Matches that earned XP so far this day.
    pub counted_today: u32,
    /// When the count was last started afresh, in Unix seconds: a new day
    /// needs a long enough gap since then, so no change of zone can make two.
    pub last_reset_unix: Option<i64>,
}

/// What the account has built up.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CoachProgress {
    pub mastery: PlayStyleMastery,
    pub style_xp: StyleXp,
    pub totals: CoachTotals,
    pub daily: DailyAllowance,
    /// When the progress was last confirmed by the store, in Unix seconds.
    pub synced_at: Option<i64>,
}
