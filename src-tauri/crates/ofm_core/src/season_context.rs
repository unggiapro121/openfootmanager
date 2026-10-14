use crate::end_of_season::{is_league_complete, is_season_complete};
use crate::game::Game;
use chrono::{Datelike, Duration, NaiveDate};
use domain::league::League;
use domain::season::{
    SeasonContext, SeasonPhase, TransferWindowContext, TransferWindowKind, TransferWindowStatus,
};

const TRANSFER_WINDOW_PRESEASON_DAYS: i64 = 30;
const TRANSFER_WINDOW_POST_START_DAYS: i64 = 30;
/// The winter window opens on the first of the month this many months after the
/// season's opening month — January for an August season, June for a January one
/// — and runs to the end of that month.
const WINTER_WINDOW_MONTHS_AFTER_START: u32 = 5;

pub fn refresh_game_context(game: &mut Game) {
    game.season_context = derive_season_context(game);
}

pub fn derive_season_context(game: &Game) -> SeasonContext {
    let Some(league) = &game.league else {
        return SeasonContext::default();
    };

    let season_start = league_boundary_date(league, Boundary::Start);
    let season_end = league_boundary_date(league, Boundary::End);
    let current_date = game.clock.current_date.date_naive();

    let phase = if is_league_complete(league) {
        SeasonPhase::PostSeason
    } else if league_has_started(league) {
        SeasonPhase::InSeason
    } else {
        SeasonPhase::Preseason
    };

    let days_until_season_start = season_start.and_then(|start| {
        let days = (start - current_date).num_days();
        (days >= 0).then_some(days)
    });

    let transfer_window = derive_transfer_window_context(current_date, season_start);

    SeasonContext {
        phase,
        season_start: season_start.map(format_date),
        season_end: season_end.map(format_date),
        days_until_season_start,
        transfer_window,
        season_complete: is_season_complete(game),
    }
}

#[derive(Copy, Clone)]
enum Boundary {
    Start,
    End,
}

fn league_boundary_date(league: &League, boundary: Boundary) -> Option<NaiveDate> {
    league
        .fixtures
        .iter()
        .filter(|fixture| fixture.counts_for_league_standings())
        .filter_map(|fixture| NaiveDate::parse_from_str(&fixture.date, "%Y-%m-%d").ok())
        .reduce(|left, right| match boundary {
            Boundary::Start => left.min(right),
            Boundary::End => left.max(right),
        })
}

fn league_has_started(league: &League) -> bool {
    league.standings.iter().any(|entry| entry.played > 0)
        || league.fixtures.iter().any(|fixture| {
            fixture.counts_for_league_standings()
                && fixture.status == domain::league::FixtureStatus::Completed
        })
}

fn derive_transfer_window_context(
    current_date: NaiveDate,
    season_start: Option<NaiveDate>,
) -> TransferWindowContext {
    let Some(mut window_season_start) = season_start else {
        return TransferWindowContext::default();
    };

    // The window in force, or the next to open: each season has its summer
    // window and then its winter one, and past both lie the next season's.
    let (kind, opens_on, closes_on) = loop {
        let upcoming = season_windows(window_season_start)
            .into_iter()
            .find(|(_, _, closes_on)| current_date <= *closes_on);
        if let Some(window) = upcoming {
            break window;
        }
        window_season_start = add_year_clamped(window_season_start);
    };

    let (status, days_until_opens, days_remaining) = if current_date < opens_on {
        (
            TransferWindowStatus::Closed,
            Some((opens_on - current_date).num_days()),
            None,
        )
    } else if current_date > closes_on {
        (TransferWindowStatus::Closed, None, None)
    } else {
        let remaining = (closes_on - current_date).num_days();
        let status = if remaining == 0 {
            TransferWindowStatus::DeadlineDay
        } else {
            TransferWindowStatus::Open
        };
        (status, None, Some(remaining))
    };

    TransferWindowContext {
        status,
        kind,
        opens_on: Some(format_date(opens_on)),
        closes_on: Some(format_date(closes_on)),
        days_until_opens,
        days_remaining,
    }
}

fn format_date(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// A season's two windows in the order they open: summer, then winter.
fn season_windows(season_start: NaiveDate) -> [(TransferWindowKind, NaiveDate, NaiveDate); 2] {
    let winter_opens_on = season_start
        .with_day(1)
        .and_then(|first| {
            first.checked_add_months(chrono::Months::new(WINTER_WINDOW_MONTHS_AFTER_START))
        })
        .unwrap_or(season_start);
    let winter_closes_on = winter_opens_on
        .checked_add_months(chrono::Months::new(1))
        .map_or(winter_opens_on, |next_month| next_month - Duration::days(1));
    [
        (
            TransferWindowKind::Summer,
            transfer_window_opens_on(season_start),
            transfer_window_closes_on(season_start),
        ),
        (
            TransferWindowKind::Winter,
            winter_opens_on,
            winter_closes_on,
        ),
    ]
}

fn transfer_window_opens_on(season_start: NaiveDate) -> NaiveDate {
    season_start - Duration::days(TRANSFER_WINDOW_PRESEASON_DAYS)
}

fn transfer_window_closes_on(season_start: NaiveDate) -> NaiveDate {
    season_start + Duration::days(TRANSFER_WINDOW_POST_START_DAYS)
}

fn add_year_clamped(date: NaiveDate) -> NaiveDate {
    let target_year = date.year() + 1;
    date.with_year(target_year).unwrap_or_else(|| {
        NaiveDate::from_ymd_opt(target_year, date.month(), 1)
            .and_then(|first_of_month| {
                first_of_month
                    .checked_add_months(chrono::Months::new(1))
                    .and_then(|next_month| next_month.checked_sub_signed(Duration::days(1)))
            })
            .expect("target year and month should produce a valid date")
    })
}

#[cfg(test)]
mod tests {
    use super::derive_season_context;
    use crate::clock::GameClock;
    use crate::game::Game;
    use chrono::{TimeZone, Utc};
    use domain::league::{
        Fixture, FixtureCompetition, FixtureStatus, League, MatchResult, StandingEntry,
    };
    use domain::manager::Manager;
    use domain::season::{SeasonPhase, TransferWindowKind, TransferWindowStatus};
    use domain::team::Team;

    /// The dashboard decides whether to show the end-of-season screen, and it
    /// must agree with `advance_to_next_season`, which refuses to roll over
    /// unless `is_season_complete`. The screen used to be driven from the
    /// *first* competition in the list — in a generated world that is a foreign
    /// league on another calendar, so an English career whose season ended in
    /// April was told to wait for an Argentine Apertura that runs to October.
    /// The screen never appeared and the player could not continue.
    #[test]
    fn season_complete_reports_the_users_own_season_not_the_first_competition() {
        let mut ours = make_league(vec![
            make_fixture("f1", "2035-08-10", FixtureStatus::Completed, 1),
            make_fixture("f2", "2036-04-10", FixtureStatus::Completed, 2),
        ]);
        ours.id = "eng-d1".to_string();
        ours.participant_ids = vec!["team1".to_string(), "team2".to_string()];

        // A foreign league that sorts first and is still mid-season.
        let mut foreign = make_league(vec![
            make_fixture("g1", "2036-02-10", FixtureStatus::Completed, 1),
            make_fixture("g2", "2036-10-10", FixtureStatus::Scheduled, 2),
        ]);
        foreign.id = "ar-d1-apertura".to_string();
        foreign.country_id = Some("AR".to_string());
        foreign.participant_ids = vec!["team3".to_string(), "team4".to_string()];

        let mut game = make_game((2036, 4, 20), Some(ours.clone()));
        game.manager.hire("team1".to_string());
        ours.country_id = Some("ENG".to_string());
        game.competitions = vec![foreign, ours];

        let context = derive_season_context(&game);

        assert!(
            context.season_complete,
            "the user's own season is over, whatever the first competition is doing"
        );
        assert_eq!(context.phase, SeasonPhase::PostSeason);
    }

    fn make_team(id: &str, name: &str) -> Team {
        Team::new(
            id.to_string(),
            name.to_string(),
            name.to_string(),
            "England".to_string(),
            "Test City".to_string(),
            format!("{} Ground", name),
            20_000,
        )
    }

    fn make_fixture(id: &str, date: &str, status: FixtureStatus, matchday: u32) -> Fixture {
        Fixture {
            id: id.to_string(),
            matchday,
            date: date.to_string(),
            home_team_id: "team1".to_string(),
            away_team_id: "team2".to_string(),
            competition: FixtureCompetition::League,
            status: status.clone(),
            result: (status == FixtureStatus::Completed).then_some(MatchResult {
                home_goals: 1,
                away_goals: 0,
                home_scorers: vec![],
                away_scorers: vec![],
                report: None,
                home_penalties: None,
                away_penalties: None,
            }),
            ..Default::default()
        }
    }

    fn make_league(fixtures: Vec<Fixture>) -> League {
        League {
            id: "league1".to_string(),
            name: "Premier Division".to_string(),
            season: 2036,
            fixtures,
            standings: vec![
                StandingEntry::new("team1".to_string()),
                StandingEntry::new("team2".to_string()),
            ],
            ..Default::default()
        }
    }

    fn make_game(current_date: (i32, u32, u32), league: Option<League>) -> Game {
        let clock = GameClock::new(
            Utc.with_ymd_and_hms(current_date.0, current_date.1, current_date.2, 12, 0, 0)
                .unwrap(),
        );
        let manager = Manager::new(
            "mgr1".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let mut game = Game::new(
            clock,
            manager,
            vec![
                make_team("team1", "Alpha FC"),
                make_team("team2", "Beta FC"),
            ],
            vec![],
            vec![],
            vec![],
        );
        game.league = league;
        game
    }

    #[test]
    fn derives_preseason_context_before_first_fixture() {
        let league = League {
            id: "league1".to_string(),
            name: "Premier Division".to_string(),
            season: 2026,
            fixtures: vec![make_fixture(
                "fx1",
                "2026-08-01",
                FixtureStatus::Scheduled,
                1,
            )],
            standings: vec![
                StandingEntry::new("team1".to_string()),
                StandingEntry::new("team2".to_string()),
            ],
            transfer_log: vec![],
            transfer_rumours: vec![],
            ..Default::default()
        };
        let game = make_game((2026, 7, 10), Some(league));

        let context = derive_season_context(&game);

        assert_eq!(context.phase, SeasonPhase::Preseason);
        assert_eq!(context.season_start.as_deref(), Some("2026-08-01"));
        assert_eq!(context.days_until_season_start, Some(22));
        assert_eq!(context.transfer_window.status, TransferWindowStatus::Open);
        assert_eq!(context.transfer_window.days_remaining, Some(52));
    }

    #[test]
    fn derives_deadline_day_window_status() {
        let league = League {
            id: "league1".to_string(),
            name: "Premier Division".to_string(),
            season: 2026,
            fixtures: vec![make_fixture(
                "fx1",
                "2026-08-01",
                FixtureStatus::Scheduled,
                1,
            )],
            standings: vec![
                StandingEntry::new("team1".to_string()),
                StandingEntry::new("team2".to_string()),
            ],
            transfer_log: vec![],
            transfer_rumours: vec![],
            ..Default::default()
        };
        let game = make_game((2026, 8, 31), Some(league));

        let context = derive_season_context(&game);

        assert_eq!(
            context.transfer_window.status,
            TransferWindowStatus::DeadlineDay
        );
        assert_eq!(context.transfer_window.days_remaining, Some(0));
    }

    /// A season opening on 1 August: its league fixture, and a game on `date`.
    fn august_season_on(date: (i32, u32, u32)) -> Game {
        let league = League {
            id: "league1".to_string(),
            name: "Premier Division".to_string(),
            season: 2026,
            fixtures: vec![make_fixture(
                "fx1",
                "2026-08-01",
                FixtureStatus::Completed,
                1,
            )],
            standings: vec![
                StandingEntry::new("team1".to_string()),
                StandingEntry::new("team2".to_string()),
            ],
            ..Default::default()
        };
        make_game(date, Some(league))
    }

    /// Given an August season in mid-January,
    /// When the season context is derived,
    /// Then the winter window is open, running through January.
    #[test]
    fn opens_the_winter_window_in_january() {
        let context = derive_season_context(&august_season_on((2027, 1, 15)));

        assert_eq!(context.transfer_window.status, TransferWindowStatus::Open);
        assert_eq!(context.transfer_window.kind, TransferWindowKind::Winter);
        assert_eq!(
            context.transfer_window.opens_on.as_deref(),
            Some("2027-01-01")
        );
        assert_eq!(
            context.transfer_window.closes_on.as_deref(),
            Some("2027-01-31")
        );
        assert_eq!(context.transfer_window.days_remaining, Some(16));
    }

    /// Given an August season in February, after the winter window,
    /// When the season context is derived,
    /// Then the next window is the following summer's.
    #[test]
    fn looks_to_next_summer_once_the_winter_window_has_closed() {
        let context = derive_season_context(&august_season_on((2027, 2, 10)));

        assert_eq!(context.transfer_window.status, TransferWindowStatus::Closed);
        assert_eq!(context.transfer_window.kind, TransferWindowKind::Summer);
        assert_eq!(
            context.transfer_window.opens_on.as_deref(),
            Some("2027-07-02")
        );
    }

    /// Given an August season in mid-September, after the summer window,
    /// When the season context is derived,
    /// Then the next window is January's, not next summer's.
    #[test]
    fn derives_next_window_after_current_window_has_closed() {
        let league = League {
            id: "league1".to_string(),
            name: "Premier Division".to_string(),
            season: 2026,
            fixtures: vec![make_fixture(
                "fx1",
                "2026-08-01",
                FixtureStatus::Completed,
                1,
            )],
            standings: vec![
                StandingEntry::new("team1".to_string()),
                StandingEntry::new("team2".to_string()),
            ],
            transfer_log: vec![],
            transfer_rumours: vec![],
            ..Default::default()
        };
        let game = make_game((2026, 9, 15), Some(league));

        let context = derive_season_context(&game);

        assert_eq!(context.transfer_window.status, TransferWindowStatus::Closed);
        assert_eq!(context.transfer_window.kind, TransferWindowKind::Winter);
        assert_eq!(
            context.transfer_window.opens_on.as_deref(),
            Some("2027-01-01")
        );
        assert_eq!(
            context.transfer_window.closes_on.as_deref(),
            Some("2027-01-31")
        );
        assert_eq!(context.transfer_window.days_until_opens, Some(108));
        assert_eq!(context.transfer_window.days_remaining, None);
    }

    #[test]
    fn derives_in_season_context_after_matches_begin() {
        let mut alpha = StandingEntry::new("team1".to_string());
        alpha.record_result(2, 1);
        let mut beta = StandingEntry::new("team2".to_string());
        beta.record_result(1, 2);
        let league = League {
            id: "league1".to_string(),
            name: "Premier Division".to_string(),
            season: 2026,
            fixtures: vec![make_fixture(
                "fx1",
                "2026-08-01",
                FixtureStatus::Completed,
                1,
            )],
            standings: vec![alpha, beta],
            transfer_log: vec![],
            transfer_rumours: vec![],
            ..Default::default()
        };
        let game = make_game((2026, 8, 5), Some(league));

        let context = derive_season_context(&game);

        assert_eq!(context.phase, SeasonPhase::InSeason);
        assert_eq!(context.days_until_season_start, None);
        assert_eq!(context.transfer_window.status, TransferWindowStatus::Open);
    }

    #[test]
    fn derives_postseason_context_once_league_is_complete() {
        let mut alpha = StandingEntry::new("team1".to_string());
        alpha.record_result(2, 1);
        let mut beta = StandingEntry::new("team2".to_string());
        beta.record_result(1, 2);
        let league = League {
            id: "league1".to_string(),
            name: "Premier Division".to_string(),
            season: 2026,
            fixtures: vec![
                make_fixture("fx1", "2026-08-01", FixtureStatus::Completed, 1),
                make_fixture("fx2", "2026-08-08", FixtureStatus::Completed, 2),
            ],
            standings: vec![alpha, beta],
            transfer_log: vec![],
            transfer_rumours: vec![],
            ..Default::default()
        };
        let game = make_game((2026, 8, 9), Some(league));

        let context = derive_season_context(&game);

        assert_eq!(context.phase, SeasonPhase::PostSeason);
        assert_eq!(context.season_end.as_deref(), Some("2026-08-08"));
    }
}
