//! Keeping a domestic cup's rounds clear of its clubs' other fixtures.
//!
//! A cup round is seeded on its calendar date without looking at the leagues;
//! this moves the whole round, when it has to, to the nearest day on which none
//! of its clubs plays anything else the day before, the day itself or the day
//! after. Real leagues stand down on cup weekends; leagues here play every week
//! of their season, so the round goes into a gap between matchdays instead.

use chrono::{Duration, NaiveDate};
use domain::league::{CompetitionScope, CompetitionType, FixtureStatus, League};
use std::collections::{BTreeSet, HashSet};

/// How far either way a round may move to find a clear day.
const SEARCH_DAYS: i64 = 10;

/// Settle every domestic cup's next round on a clear day after `today`. A
/// round already on a clear day stays where it is, so this is safe to run
/// every day; one that is today or past is never moved.
pub(crate) fn settle_cup_rounds(competitions: &mut [League], today: NaiveDate) {
    for cup_index in 0..competitions.len() {
        let cup = &competitions[cup_index];
        if cup.kind != CompetitionType::Cup || cup.scope != CompetitionScope::Domestic {
            continue;
        }
        let Some(round) = cup.knockout_rounds.iter().find(|round| !round.completed) else {
            continue;
        };
        let round_ids: HashSet<&str> = round.fixture_ids.iter().map(String::as_str).collect();
        let pending: Vec<usize> = cup
            .fixtures
            .iter()
            .enumerate()
            .filter(|(_, fixture)| {
                round_ids.contains(fixture.id.as_str())
                    && fixture.status == FixtureStatus::Scheduled
            })
            .map(|(index, _)| index)
            .collect();
        let Some(target) = pending
            .iter()
            .filter_map(|&index| parse(&cup.fixtures[index].date))
            .min()
        else {
            continue;
        };
        if target <= today {
            continue;
        }
        let clubs: HashSet<&str> = pending
            .iter()
            .flat_map(|&index| {
                let fixture = &cup.fixtures[index];
                [fixture.home_team_id.as_str(), fixture.away_team_id.as_str()]
            })
            .collect();
        let busy = busy_days(competitions, cup_index, &clubs);
        let Some(day) = clear_day(target, today, &busy) else {
            continue;
        };
        let date = day.format("%Y-%m-%d").to_string();
        for index in pending {
            competitions[cup_index].fixtures[index].date = date.clone();
        }
    }
}

/// The days any of `clubs` plays a fixture of a competition other than the cup
/// at `cup_index`.
fn busy_days(
    competitions: &[League],
    cup_index: usize,
    clubs: &HashSet<&str>,
) -> BTreeSet<NaiveDate> {
    competitions
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != cup_index)
        .flat_map(|(_, competition)| competition.fixtures.iter())
        .filter(|fixture| {
            clubs.contains(fixture.home_team_id.as_str())
                || clubs.contains(fixture.away_team_id.as_str())
        })
        .filter_map(|fixture| parse(&fixture.date))
        .collect()
}

/// The day nearest `target`, after `today`, with no busy day beside it; failing
/// that, the nearest that is at least not busy itself; failing both, none.
fn clear_day(target: NaiveDate, today: NaiveDate, busy: &BTreeSet<NaiveDate>) -> Option<NaiveDate> {
    let candidates = || {
        (0..=SEARCH_DAYS)
            .flat_map(|offset| [offset, -offset])
            .map(move |offset| target + Duration::days(offset))
            .filter(move |day| *day > today)
    };
    let rested =
        |day: NaiveDate| (-1..=1).all(|delta| !busy.contains(&(day + Duration::days(delta))));
    candidates()
        .find(|day| rested(*day))
        .or_else(|| candidates().find(|day| !busy.contains(day)))
}

fn parse(date: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schedule::{build_round_robin_fixtures_with, seed_knockout_round};
    use chrono::{TimeZone, Utc};
    use domain::league::{CompetitionFormat, FixtureCompetition};

    fn day(text: &str) -> NaiveDate {
        parse(text).unwrap()
    }

    /// A league of `clubs` playing every Monday from 3 August 2026.
    fn monday_league(clubs: &[String]) -> League {
        let mut league = League::new("league".into(), "League".into(), 2026, clubs);
        league.fixtures = build_round_robin_fixtures_with(
            "league",
            clubs,
            Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap(),
            FixtureCompetition::League,
            2,
            7,
        );
        league
    }

    /// A domestic cup of `clubs` whose first round is seeded on `date`.
    fn cup_on(clubs: &[String], date: (i32, u32, u32)) -> League {
        let mut cup = League::new("cup".into(), "Cup".into(), 2026, clubs);
        cup.kind = CompetitionType::Cup;
        cup.scope = CompetitionScope::Domestic;
        cup.rules.format = CompetitionFormat::Knockout;
        let start = Utc
            .with_ymd_and_hms(date.0, date.1, date.2, 0, 0, 0)
            .unwrap();
        seed_knockout_round(&mut cup, clubs, start, FixtureCompetition::Cup);
        cup
    }

    fn cup_dates(competitions: &[League]) -> BTreeSet<String> {
        competitions[1]
            .fixtures
            .iter()
            .map(|f| f.date.clone())
            .collect()
    }

    fn clubs(count: usize) -> Vec<String> {
        (0..count).map(|i| format!("club_{i}")).collect()
    }

    /// Given a cup round seeded on a Monday its clubs play their league,
    /// When the cup's rounds are settled,
    /// Then the whole round moves to the nearest day with a free day either
    /// side: the Wednesday between two league Mondays.
    #[test]
    fn a_round_on_a_league_day_moves_to_a_rested_day() {
        let clubs = clubs(8);
        let mut competitions = vec![monday_league(&clubs), cup_on(&clubs, (2026, 11, 2))];

        settle_cup_rounds(&mut competitions, day("2026-10-01"));

        assert_eq!(
            cup_dates(&competitions),
            BTreeSet::from(["2026-11-04".to_string()])
        );
    }

    /// Given a cup round already on a day clear of the leagues,
    /// When the rounds are settled, then it stays where it is.
    #[test]
    fn a_round_on_a_clear_day_stays() {
        let clubs = clubs(8);
        let mut competitions = vec![monday_league(&clubs), cup_on(&clubs, (2026, 11, 5))];

        settle_cup_rounds(&mut competitions, day("2026-10-01"));

        assert_eq!(
            cup_dates(&competitions),
            BTreeSet::from(["2026-11-05".to_string()])
        );
    }

    /// Given a round due today,
    /// When the rounds are settled, then it is not moved: today's matches are
    /// already being played.
    #[test]
    fn a_round_due_today_is_never_moved() {
        let clubs = clubs(8);
        let mut competitions = vec![monday_league(&clubs), cup_on(&clubs, (2026, 11, 2))];

        settle_cup_rounds(&mut competitions, day("2026-11-02"));

        assert_eq!(
            cup_dates(&competitions),
            BTreeSet::from(["2026-11-02".to_string()])
        );
    }

    /// Given a cup none of whose clubs is in the league,
    /// When the rounds are settled, then the league's days do not move it.
    #[test]
    fn only_the_rounds_own_clubs_matter() {
        let league_clubs = clubs(8);
        let cup_clubs: Vec<String> = (0..8).map(|i| format!("other_{i}")).collect();
        let mut competitions = vec![
            monday_league(&league_clubs),
            cup_on(&cup_clubs, (2026, 11, 2)),
        ];

        settle_cup_rounds(&mut competitions, day("2026-10-01"));

        assert_eq!(
            cup_dates(&competitions),
            BTreeSet::from(["2026-11-02".to_string()])
        );
    }
}
