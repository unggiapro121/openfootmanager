//! The rules of a coach account's progress (tài-khoản-HLV-tech-spec §4): what
//! a match is worth, the day's allowance, and the region day it is counted in.
//!
//! Pure on purpose — no clock, no I/O — so the store on this machine and the
//! server (G-2) run the very same rules. The time is passed in; on the server
//! it is the server's own, never the client's.

use domain::coach::{CoachProgress, CoachRegion, DailyAllowance};
use domain::league::FixtureCompetition;
use domain::manager::HonourKind;
use domain::team::PlayStyle;
use serde::{Deserialize, Serialize};

use crate::manager_mastery::{MasteryGain, MatchOutcome, bank_style_xp, match_xp};

/// The hour of the region's day at which the allowance starts afresh: late
/// enough that a match played around midnight is not cut in two (K1, O1).
pub const RESET_HOUR: i64 = 4;
/// The least gap between two fresh starts of one account's allowance, so that
/// no change of zone or offset can make a second day inside one.
pub const MIN_RESET_GAP_HOURS: i64 = 20;
/// How much more a real-time online match is worth than an offline one (D3).
/// Used by the server's online matches; the offline game never applies it.
pub const ONLINE_XP_MULTIPLIER: f64 = 5.0;
/// How many matches a day can earn XP at all (D2).
pub const DAILY_XP_MATCH_LIMIT: u32 = 50;

const SECONDS_PER_HOUR: i64 = 3_600;
const SECONDS_PER_DAY: i64 = 86_400;

/// One official match of a club the coach led, as his account counts it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CoachMatchRecord {
    pub save_id: String,
    pub fixture_id: String,
    pub competition: FixtureCompetition,
    /// The score after 90 or 120 minutes: a tie settled on penalties is a draw.
    pub own_goals: u8,
    pub opponent_goals: u8,
    pub own_strength: f64,
    pub opponent_strength: f64,
    /// The style the coach's side kicked off in (X99).
    pub style: PlayStyle,
    /// Whether the match may earn XP: official, and managed on the touchline
    /// ("go to the field"); others count in the totals only (Y8).
    pub earns_xp: bool,
}

/// What a career tells the coach's account.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CoachRecord {
    Match(CoachMatchRecord),
    Honour(HonourKind),
}

/// The region's offset from UTC, in minutes.
pub fn region_offset_minutes(region: CoachRegion) -> i64 {
    match region {
        CoachRegion::AsiaSoutheast => 7 * 60,
        CoachRegion::AsiaEast => 8 * 60,
        CoachRegion::Europe => 60,
        CoachRegion::Americas => -5 * 60,
    }
}

/// Seconds to add to Unix time to count region days from the epoch.
fn day_shift(region: CoachRegion) -> i64 {
    region_offset_minutes(region) * 60 - RESET_HOUR * SECONDS_PER_HOUR
}

/// The region day `now_unix` falls in: whole days since the epoch, each
/// starting at [`RESET_HOUR`] of the region's time.
pub fn region_day(now_unix: i64, region: CoachRegion) -> i64 {
    (now_unix + day_shift(region)).div_euclid(SECONDS_PER_DAY)
}

/// When region day `day` starts, in Unix seconds.
fn day_start_unix(day: i64, region: CoachRegion) -> i64 {
    day * SECONDS_PER_DAY - day_shift(region)
}

/// When the region day after the one `now_unix` falls in starts, in Unix seconds.
pub fn next_reset_unix(now_unix: i64, region: CoachRegion) -> i64 {
    day_start_unix(region_day(now_unix, region) + 1, region)
}

/// The allowance as it stands at `now_unix`: started afresh when a new region
/// day has begun and the last fresh start is far enough behind; otherwise as it
/// was. The day never goes back, however the time passed in does.
pub fn roll_day(daily: &DailyAllowance, now_unix: i64, region: CoachRegion) -> DailyAllowance {
    let today = region_day(now_unix, region);
    let is_later_day = daily.last_reset_unix.is_none() || today > daily.day;
    let is_far_enough = daily
        .last_reset_unix
        .is_none_or(|last| now_unix - last >= MIN_RESET_GAP_HOURS * SECONDS_PER_HOUR);
    if !is_later_day || !is_far_enough {
        return *daily;
    }
    DailyAllowance {
        day: today,
        counted_today: 0,
        last_reset_unix: Some(day_start_unix(today, region)),
    }
}

/// The share of a match's XP it earns, by how many earned XP before it this
/// day (D2): the first 20 in full, the next 20 at half, 10 more at a quarter,
/// none after 50.
pub fn daily_factor(counted_before: u32) -> f64 {
    match counted_before {
        0..20 => 1.0,
        20..40 => 0.5,
        40..DAILY_XP_MATCH_LIMIT => 0.25,
        _ => 0.0,
    }
}

/// `progress` after `record`, at `now_unix`, and what a match did for the
/// mastery of the style it was played in when it could earn XP.
pub fn apply(
    progress: &CoachProgress,
    record: &CoachRecord,
    now_unix: i64,
    region: CoachRegion,
) -> (CoachProgress, Option<MasteryGain>) {
    let mut next = progress.clone();
    let game = match record {
        CoachRecord::Honour(_) => {
            next.totals.trophies += 1;
            return (next, None);
        }
        CoachRecord::Match(game) => game,
    };
    let outcome = match game.own_goals.cmp(&game.opponent_goals) {
        std::cmp::Ordering::Greater => MatchOutcome::Won,
        std::cmp::Ordering::Equal => MatchOutcome::Drawn,
        std::cmp::Ordering::Less => MatchOutcome::Lost,
    };
    next.totals.matches += 1;
    match outcome {
        MatchOutcome::Won => next.totals.wins += 1,
        MatchOutcome::Drawn => next.totals.draws += 1,
        MatchOutcome::Lost => next.totals.losses += 1,
    }
    if !game.earns_xp {
        return (next, None);
    }

    next.daily = roll_day(&next.daily, now_unix, region);
    let factor = daily_factor(next.daily.counted_today);
    next.daily.counted_today += 1;
    let full = match_xp(outcome, game.own_strength, game.opponent_strength);
    let xp = (f64::from(full) * factor).round() as u32;
    let (before, after) = bank_style_xp(&mut next.mastery, &mut next.style_xp, &game.style, xp);
    next.style_xp.for_style_mut(&game.style).matches += 1;
    let gain = MasteryGain {
        style: game.style.clone(),
        xp,
        mastery_before: before,
        mastery_after: after,
    };
    (next, Some(gain))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-21T00:00:00Z.
    const MIDNIGHT_UTC: i64 = 1_792_540_800;
    const HOUR: i64 = SECONDS_PER_HOUR;

    fn record(own: u8, opponent: u8, earns_xp: bool) -> CoachRecord {
        CoachRecord::Match(CoachMatchRecord {
            save_id: "save".into(),
            fixture_id: "fix".into(),
            competition: FixtureCompetition::League,
            own_goals: own,
            opponent_goals: opponent,
            own_strength: 70.0,
            opponent_strength: 70.0,
            style: PlayStyle::Counter,
            earns_xp,
        })
    }

    /// `n` XP-earning wins against an equal side, a minute apart from `start`.
    fn play_wins(n: u32, start: i64) -> (CoachProgress, Vec<u32>) {
        play_wins_in(n, start, CoachRegion::AsiaSoutheast)
    }

    fn play_wins_in(n: u32, start: i64, region: CoachRegion) -> (CoachProgress, Vec<u32>) {
        let mut progress = CoachProgress::default();
        let mut earned = Vec::new();
        for i in 0..n {
            let (next, gain) = apply(
                &progress,
                &record(1, 0, true),
                start + i64::from(i) * 60,
                region,
            );
            earned.push(gain.map_or(0, |g| g.xp));
            progress = next;
        }
        (progress, earned)
    }

    /// Given the day's matches, then the first 20 earn in full, the next 20 at
    /// half, 10 more at a quarter, and none after 50 (D2).
    #[test]
    fn the_day_s_allowance_steps_down_by_matches() {
        for (before, factor) in [
            (0, 1.0),
            (19, 1.0),
            (20, 0.5),
            (39, 0.5),
            (40, 0.25),
            (49, 0.25),
            (50, 0.0),
            (80, 0.0),
        ] {
            assert_eq!(daily_factor(before), factor, "after {before} matches");
        }
        let (progress, earned) = play_wins(52, MIDNIGHT_UTC);
        // A win against an equal side is worth 15 XP (làn M X98).
        assert_eq!(earned[0], 15);
        assert_eq!(earned[19], 15);
        assert_eq!(earned[20], 8); // round(7.5)
        assert_eq!(earned[40], 4); // round(3.75)
        assert_eq!(earned[50], 0);
        assert_eq!(progress.daily.counted_today, 52);
        assert_eq!(progress.totals.matches, 52);
    }

    /// Given the South-East Asia region (UTC+7), then its day turns at 04:00
    /// local time, 21:00 UTC: a minute before and at it are two days.
    #[test]
    fn the_region_day_turns_at_four_in_the_morning() {
        let four_local = MIDNIGHT_UTC - 3 * HOUR; // 21:00 UTC the day before
        let region = CoachRegion::AsiaSoutheast;
        assert_eq!(
            region_day(four_local, region),
            region_day(four_local - 60, region) + 1
        );
        assert_eq!(
            region_day(four_local + 24 * HOUR - 60, region),
            region_day(four_local, region)
        );
        assert_eq!(next_reset_unix(four_local - 60, region), four_local);
        assert_eq!(region_offset_minutes(CoachRegion::Americas), -300);
    }

    /// Given a full day and the next region day, then the allowance starts
    /// afresh.
    #[test]
    fn a_new_day_starts_the_allowance_afresh() {
        let (progress, _) = play_wins(30, MIDNIGHT_UTC);
        let tomorrow = MIDNIGHT_UTC + 24 * HOUR;
        let (next, gain) = apply(
            &progress,
            &record(1, 0, true),
            tomorrow,
            CoachRegion::AsiaSoutheast,
        );
        assert_eq!(next.daily.counted_today, 1);
        assert_eq!(gain.map(|g| g.xp), Some(15));
    }

    /// Given a clock that goes back (the machine's time set earlier), then the
    /// day stays and the count is not started afresh.
    #[test]
    fn the_day_never_goes_back() {
        let (progress, _) = play_wins(25, MIDNIGHT_UTC);
        let yesterday = MIDNIGHT_UTC - 30 * HOUR;
        let rolled = roll_day(&progress.daily, yesterday, CoachRegion::AsiaSoutheast);
        assert_eq!(rolled, progress.daily);
    }

    /// Given a day started in the Americas (04:00 UTC−5 = 09:00 UTC), when
    /// the same allowance is next counted as East Asia (UTC+8), whose next day
    /// starts at 20:00 UTC — only 11 hours later — then no second day is made.
    #[test]
    fn two_fresh_starts_are_at_least_twenty_hours_apart() {
        let (progress, _) = play_wins_in(25, MIDNIGHT_UTC + 10 * HOUR, CoachRegion::Americas);
        assert_eq!(
            progress.daily.last_reset_unix,
            Some(MIDNIGHT_UTC + 9 * HOUR)
        );
        let eleven_hours_on = MIDNIGHT_UTC + 20 * HOUR;
        let rolled = roll_day(&progress.daily, eleven_hours_on, CoachRegion::AsiaEast);
        assert_eq!(rolled, progress.daily);
        // A full day on, the new day comes.
        let next_day = MIDNIGHT_UTC + 33 * HOUR;
        assert_eq!(
            roll_day(&progress.daily, next_day, CoachRegion::Americas).counted_today,
            0
        );
    }

    /// Given a match handed to the assistant, then it counts in the totals but
    /// earns no XP and uses none of the day's allowance.
    #[test]
    fn a_match_without_the_right_to_xp_only_counts_in_the_totals() {
        let (next, gain) = apply(
            &CoachProgress::default(),
            &record(0, 2, false),
            MIDNIGHT_UTC,
            CoachRegion::AsiaSoutheast,
        );
        assert_eq!(gain, None);
        assert_eq!((next.totals.matches, next.totals.losses), (1, 1));
        assert_eq!(next.daily.counted_today, 0);
        assert_eq!(next.style_xp.counter.xp, 0);
    }

    /// Given a trophy, then the account's trophies go up and nothing else.
    #[test]
    fn a_trophy_counts_in_the_totals() {
        let (next, gain) = apply(
            &CoachProgress::default(),
            &CoachRecord::Honour(HonourKind::DomesticCup),
            MIDNIGHT_UTC,
            CoachRegion::AsiaSoutheast,
        );
        assert_eq!(gain, None);
        assert_eq!(next.totals.trophies, 1);
        assert_eq!(next.totals.matches, 0);
    }

    /// Given matches spread one a day (no cap), then the account reaches the
    /// lane M milestones: 60 after about 50 matches at 11 XP.
    #[test]
    fn the_account_reaches_the_lane_m_milestones_uncapped() {
        let mut progress = CoachProgress::default();
        let mut day = MIDNIGHT_UTC;
        // A win against a side 10 weaker is worth round(15 × 0.75) = 11 XP.
        let eleven = CoachRecord::Match(CoachMatchRecord {
            opponent_strength: 60.0,
            ..match record(1, 0, true) {
                CoachRecord::Match(m) => m,
                CoachRecord::Honour(_) => unreachable!(),
            }
        });
        for _ in 0..51 {
            progress = apply(&progress, &eleven, day, CoachRegion::AsiaSoutheast).0;
            day += 24 * HOUR;
        }
        assert_eq!(progress.mastery.counter, 60);
    }
}
