//! Finding a fixture by its id wherever it is kept.
//!
//! Fixtures live in three places: every competition's list, each national
//! team's own list, and the legacy `game.league` mirror of a save written
//! before competitions existed. A screen that opens "this match" has only the
//! id, so it needs the one search that knows all three.

use std::collections::HashSet;

use domain::league::Fixture;

use crate::game::Game;

/// A fixture and the competition it belongs to.
pub struct FoundFixture<'a> {
    pub fixture: &'a Fixture,
    pub competition_id: String,
    pub competition_name: String,
}

/// The fixture with `fixture_id`: in the competitions first, then the national
/// teams, then the legacy league mirror.
pub fn find_fixture<'a>(game: &'a Game, fixture_id: &str) -> Option<FoundFixture<'a>> {
    for competition in &game.competitions {
        if let Some(fixture) = competition.fixtures.iter().find(|f| f.id == fixture_id) {
            return Some(FoundFixture {
                fixture,
                competition_id: competition.id.clone(),
                competition_name: competition.name.clone(),
            });
        }
    }
    for national_team in &game.national_teams {
        if let Some(fixture) = national_team.fixtures.iter().find(|f| f.id == fixture_id) {
            return Some(FoundFixture {
                fixture,
                competition_id: fixture.competition_id.clone(),
                competition_name: competition_name(game, &fixture.competition_id),
            });
        }
    }
    let league = game.league.as_ref()?;
    let fixture = league.fixtures.iter().find(|f| f.id == fixture_id)?;
    Some(FoundFixture {
        fixture,
        competition_id: league.id.clone(),
        competition_name: league.name.clone(),
    })
}

/// A side's display name: a club's, a national team's, or the id itself when
/// neither knows it.
pub fn side_name(game: &Game, team_id: &str) -> String {
    if let Some(team) = game.teams.iter().find(|team| team.id == team_id) {
        return team.name.clone();
    }
    game.national_teams
        .iter()
        .find(|team| team.id == team_id)
        .map(|team| team.name.clone())
        .unwrap_or_else(|| team_id.to_string())
}

/// The ids of every fixture still on a schedule — this season's. Fixture ids
/// are unique and a rollover replaces each competition's fixtures, so a stats
/// row from an earlier season points at an id no schedule holds.
pub fn scheduled_fixture_ids(game: &Game) -> HashSet<String> {
    game.competitions
        .iter()
        .flat_map(|competition| competition.fixtures.iter())
        .chain(
            game.national_teams
                .iter()
                .flat_map(|team| team.fixtures.iter()),
        )
        .map(|fixture| fixture.id.clone())
        .collect()
}

fn competition_name(game: &Game, competition_id: &str) -> String {
    game.competitions
        .iter()
        .find(|competition| competition.id == competition_id)
        .map(|competition| competition.name.clone())
        .unwrap_or_else(|| competition_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use chrono::{TimeZone, Utc};
    use domain::league::League;
    use domain::manager::Manager;
    use domain::national_team::NationalTeam;

    fn fixture(id: &str, competition_id: &str, home: &str, away: &str) -> Fixture {
        Fixture {
            id: id.to_string(),
            competition_id: competition_id.to_string(),
            home_team_id: home.to_string(),
            away_team_id: away.to_string(),
            ..Default::default()
        }
    }

    fn game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap());
        let manager = Manager::new(
            "mgr".to_string(),
            "Alex".to_string(),
            "Boss".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let mut game = Game::new(clock, manager, vec![], vec![], vec![], vec![]);
        let mut league = League::new("eng-1".to_string(), "Premier".to_string(), 2026, &[]);
        league
            .fixtures
            .push(fixture("league-fixture", "eng-1", "a", "b"));
        let mut cup = League::new("eng-cup".to_string(), "FA Cup".to_string(), 2026, &[]);
        cup.fixtures
            .push(fixture("cup-fixture", "eng-cup", "a", "c"));
        game.competitions = vec![league, cup];
        game
    }

    /// Given fixtures in a league and a cup, when each is looked up by id,
    /// then it is found with the competition it belongs to.
    #[test]
    fn finds_a_fixture_in_any_competition() {
        let game = game();

        let found = find_fixture(&game, "cup-fixture").expect("the cup fixture");

        assert_eq!(found.fixture.away_team_id, "c");
        assert_eq!(found.competition_id, "eng-cup");
        assert_eq!(found.competition_name, "FA Cup");
    }

    /// Given a national team's friendly, when it is looked up, then it is found
    /// on that team's own fixture list, and both sides are named.
    #[test]
    fn finds_a_national_team_fixture_and_names_its_sides() {
        let mut game = game();
        let mut england = NationalTeam::new(
            "nt-eng".to_string(),
            "England".to_string(),
            "ENG".to_string(),
            None,
        );
        england
            .fixtures
            .push(fixture("friendly", "intl-friendlies", "nt-eng", "nt-fra"));
        game.national_teams = vec![
            england,
            NationalTeam::new(
                "nt-fra".to_string(),
                "France".to_string(),
                "FRA".to_string(),
                None,
            ),
        ];

        let found = find_fixture(&game, "friendly").expect("the friendly");

        assert_eq!(found.fixture.home_team_id, "nt-eng");
        assert_eq!(side_name(&game, "nt-fra"), "France");
    }

    /// Given fixtures in competitions and on a national team's list, then all
    /// of them are on the schedule, and nothing else is.
    #[test]
    fn the_schedule_holds_every_competition_and_national_team_fixture() {
        let mut game = game();
        let mut england = NationalTeam::new(
            "nt-eng".to_string(),
            "England".to_string(),
            "ENG".to_string(),
            None,
        );
        england
            .fixtures
            .push(fixture("friendly", "intl-friendlies", "nt-eng", "nt-fra"));
        game.national_teams = vec![england];

        let ids = scheduled_fixture_ids(&game);

        assert_eq!(
            ids,
            HashSet::from([
                "league-fixture".to_string(),
                "cup-fixture".to_string(),
                "friendly".to_string()
            ])
        );
    }

    /// Given an id no fixture has, then nothing is found.
    #[test]
    fn an_unknown_id_finds_nothing() {
        assert!(find_fixture(&game(), "no-such-fixture").is_none());
    }
}
