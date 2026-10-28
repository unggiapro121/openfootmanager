//! Online recovery by blocks of the online day, and the cap on a club's sessions (E5-1). A season
//! whose ruleset carries [`RecoveryBlocks`] gives back condition a block at a time instead of all
//! at once at 04:00, and lets a person hold his sessions himself (`training::online_session`).
//! Nothing here knows a clock: the caller counts the block boundaries between two instants.

use domain::player::Player;
use serde::{Deserialize, Serialize};

use crate::training::{TeamTrainingPlan, condition_after_rest};

/// How an online day gives back condition: `per_day` blocks, each worth `hours` hours of a
/// football rest. Six blocks of eight hours are the 48 hours that `restDaysPerDay` 2 gave each
/// online day before blocks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryBlocks {
    /// Blocks in an online day; the server checks the day's length divides by it.
    pub per_day: u32,
    /// Hours of football rest one block gives.
    pub hours: u32,
}

/// Why a [`RecoveryBlocks`] cannot be run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryIssue {
    PerDay,
    Hours,
}

/// The most of either number: a block an hour, or a whole football day a block. At 24 × 24 an
/// online day rests 24 football days, under the 30 rest days a ruleset already allows.
const MOST_PER_DAY: u32 = 24;
const MOST_HOURS: u32 = 24;

impl RecoveryBlocks {
    /// The starting point before measuring: six four-hour blocks of a real day, eight hours each.
    pub const PROPOSED: Self = Self {
        per_day: 6,
        hours: 8,
    };

    /// Whether these blocks can run a season.
    pub fn validate(&self) -> Result<(), RecoveryIssue> {
        if !(1..=MOST_PER_DAY).contains(&self.per_day) {
            return Err(RecoveryIssue::PerDay);
        }
        if !(1..=MOST_HOURS).contains(&self.hours) {
            return Err(RecoveryIssue::Hours);
        }
        Ok(())
    }
}

/// `condition` after `blocks` blocks of rest: exactly `condition_after_rest` for their hours, with
/// every factor of a rest day (stamina, age, morale, condition, fitness, physio, medical).
/// `recovery` is the club's `(physio_mult, medical_facility_mult)`, see [`recovery_mults`].
pub fn rest_blocks(
    player: &Player,
    condition: u8,
    age: u32,
    recovery: (f64, f64),
    blocks: u32,
    blocks_of: &RecoveryBlocks,
) -> u8 {
    let hours = u64::from(blocks) * u64::from(blocks_of.hours);
    let hours = u32::try_from(hours).unwrap_or(u32::MAX);
    condition_after_rest(player, condition, age, recovery, hours)
}

/// The club's recovery multipliers for [`rest_blocks`], in the order `condition_after_rest` takes.
pub fn recovery_mults(plan: &TeamTrainingPlan) -> (f64, f64) {
    (plan.bonus.physio_mult, plan.medical_facility_mult)
}

/// The most sessions a club holds in any seven days in a row: the Intense schedule's, the most the
/// automatic sessions ever hold. A person's own sessions count with them, so pressing the button
/// buys when and how hard, never more (Qe51-1).
pub const SESSIONS_PER_7_DAYS: u32 = 6;
const WINDOW_DAYS: u32 = 7;

/// Whether a club that held sessions on days `held` of the season may hold one on `day`: not if it
/// already has, nor if any seven days in a row around `day` would then hold more than
/// [`SESSIONS_PER_7_DAYS`]. A rolling window, not a calendar week: by weeks, six sessions at the
/// end of one and six at the start of the next would be twelve in twelve days.
pub fn session_allowed(held: &[u32], day: u32) -> bool {
    if held.contains(&day) {
        return false;
    }
    let first_start = day.saturating_sub(WINDOW_DAYS - 1);
    (first_start..=day).all(|start| {
        let window = start..start + WINDOW_DAYS;
        let in_window = held.iter().filter(|d| window.contains(d)).count();
        u32::try_from(in_window).is_ok_and(|n| n < SESSIONS_PER_7_DAYS)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::uniform_attributes;
    use domain::player::Position;
    use domain::team::TrainingSchedule;

    fn tired_player() -> Player {
        let mut player = Player::new(
            "p".into(),
            "P".into(),
            "P".into(),
            "1999-05-01".into(),
            "England".into(),
            Position::Midfielder,
            uniform_attributes(70),
        );
        player.condition = 35;
        player.morale = 60;
        player.fitness = 75;
        player
    }

    /// Given a tired player,
    /// when he rests six blocks of eight hours,
    /// then he ends where 48 hours of rest and two rest days in a row leave him.
    #[test]
    fn six_blocks_of_eight_hours_are_two_rest_days() {
        let player = tired_player();
        let by_blocks = rest_blocks(&player, 35, 27, (1.2, 1.1), 6, &RecoveryBlocks::PROPOSED);
        let by_hours = condition_after_rest(&player, 35, 27, (1.2, 1.1), 48);
        let mut by_days = 35;
        for _ in 0..2 {
            by_days = crate::training::rest_day_condition(&player, by_days, 27, 1.2, 1.1);
        }
        assert_eq!(by_blocks, by_hours);
        assert_eq!(by_blocks, by_days);
    }

    /// Given a tired player,
    /// when he rests six blocks one lock at a time, as a day of reads and presses does,
    /// then he ends within two points of six blocks rested at once, above or below: a day's
    /// recovery depends on the condition it starts from, but no lock loses its share (cut down at
    /// every lock, he ended up to four points short, always short).
    #[test]
    fn blocks_locked_one_by_one_match_blocks_at_once() {
        let player = tired_player();
        let blocks_of = RecoveryBlocks::PROPOSED;
        for start in [5, 10, 20, 30, 35, 45, 60, 70, 85, 95] {
            let mut one_by_one = start;
            for _ in 0..6 {
                one_by_one = rest_blocks(&player, one_by_one, 27, (1.0, 1.0), 1, &blocks_of);
            }
            let at_once = rest_blocks(&player, start, 27, (1.0, 1.0), 6, &blocks_of);
            assert!(
                one_by_one.abs_diff(at_once) <= 2,
                "{start}: {one_by_one} vs {at_once}"
            );
        }
    }

    /// Given a tired player,
    /// when he rests from no block up to every block there is,
    /// then his condition never falls, never passes 100, stays put with none, and is full at the
    /// end without the hours overflowing.
    #[test]
    fn blocks_are_capped_and_monotone() {
        let player = tired_player();
        let blocks_of = RecoveryBlocks::PROPOSED;
        let at = |blocks| rest_blocks(&player, 35, 27, (1.0, 1.0), blocks, &blocks_of);
        assert_eq!(at(0), 35);
        let mut last = at(0);
        for blocks in 1..60 {
            let now = at(blocks);
            assert!(now >= last && now <= 100);
            last = now;
        }
        assert_eq!(at(u32::MAX), 100);
    }

    /// Given the proposed blocks and blocks at each edge,
    /// when they are checked,
    /// then the proposed and the largest are accepted, and none or too many of either are refused
    /// for that number.
    #[test]
    fn recovery_blocks_validate() {
        assert_eq!(RecoveryBlocks::PROPOSED.validate(), Ok(()));
        let blocks = |per_day, hours| RecoveryBlocks { per_day, hours }.validate();
        assert_eq!(blocks(24, 24), Ok(()));
        assert_eq!(blocks(0, 8), Err(RecoveryIssue::PerDay));
        assert_eq!(blocks(25, 8), Err(RecoveryIssue::PerDay));
        assert_eq!(blocks(6, 0), Err(RecoveryIssue::Hours));
        assert_eq!(blocks(6, 25), Err(RecoveryIssue::Hours));
    }

    /// Given blocks as a ruleset writes them,
    /// when they are read and written back, or read with a field missing,
    /// then they round-trip in camelCase, and a missing field is an error, not a silent default.
    #[test]
    fn recovery_blocks_serde() {
        let json = r#"{"perDay":6,"hours":8}"#;
        let read: RecoveryBlocks = serde_json::from_str(json).expect("blocks");
        assert_eq!(read, RecoveryBlocks::PROPOSED);
        assert_eq!(serde_json::to_string(&read).expect("json"), json);
        assert!(serde_json::from_str::<RecoveryBlocks>(r#"{"perDay":6}"#).is_err());
    }

    /// Given every weekday a season can start on and every weekly schedule,
    /// when a club holds its schedule's sessions over a 28-day season,
    /// then the cap never stops one of them: no automatic session is ever lost to it.
    #[test]
    fn session_cap_matches_intense() {
        for start_weekday in 0..7 {
            for schedule in [
                TrainingSchedule::Intense,
                TrainingSchedule::Balanced,
                TrainingSchedule::Light,
            ] {
                let mut held = Vec::new();
                for day in 0..28 {
                    if schedule.is_training_day(crate::season::season_weekday(start_weekday, day)) {
                        assert!(session_allowed(&held, day), "{schedule:?} day {day}");
                        held.push(day);
                    }
                }
            }
        }
    }

    /// Given sessions on six days in a row, and on six days either side of a week's end,
    /// when one more is asked for,
    /// then the seventh day in a row is refused and the eighth allowed; the rolling window stops
    /// the second run where a calendar week would not; a day already held is always refused.
    #[test]
    fn session_cap_blocks_the_seventh() {
        let six: Vec<u32> = (0..6).collect();
        assert!(!session_allowed(&six, 6));
        assert!(session_allowed(&six, 7));
        assert!(!session_allowed(&six, 3));
        // Days 8–13 are the end of one Monday-start week and the start of the next.
        let across: Vec<u32> = (8..14).collect();
        assert!(!session_allowed(&across, 14));
        assert!(!session_allowed(&across, 7));
        assert!(session_allowed(&across, 15));
        assert!(session_allowed(&[0, 2, 4], 6));
    }

    /// Given a new season,
    /// when its first day asks for a session,
    /// then it is allowed: the cap counts this season's days only.
    #[test]
    fn session_cap_is_per_season() {
        assert!(session_allowed(&[], 0));
        assert!(session_allowed(&[0], 1));
    }
}
