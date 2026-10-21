//! The user's manager's career record, kept match by match (after GĐ5).
//!
//! Every official match of the club he leads counts the day it is played —
//! league, cup, continental and club world cup alike, whoever is in charge on
//! the touchline (played, handed to the assistant or watched) — so the manager
//! screen shows the season so far. The season's end only adds the honours and
//! the best finish (`end_of_season`).

use domain::league::FixtureCompetition;
use domain::manager::ManagerCareerEntry;

use crate::game::Game;

/// Whether a match of `competition` is official: a friendly, a pre-season
/// tournament or a national side's match is not.
pub(crate) fn is_official(competition: &FixtureCompetition) -> bool {
    matches!(
        competition,
        FixtureCompetition::League
            | FixtureCompetition::Cup
            | FixtureCompetition::ContinentalClub
            | FixtureCompetition::InternationalClub
    )
}

enum Outcome {
    Won,
    Drawn,
    Lost,
}

/// Counts fixture `fixture_index` of the competition being played, just
/// finished `home_goals`–`away_goals`, in the manager's record when it is an
/// official match of his club. The score after 90 or 120 minutes decides it: a
/// tie settled on penalties is a draw.
pub(crate) fn record_match(
    game: &mut Game,
    fixture_index: usize,
    home_team_id: &str,
    away_team_id: &str,
    home_goals: u8,
    away_goals: u8,
) {
    let Some(team_id) = game.manager.team_id.clone() else {
        return;
    };
    if team_id != home_team_id && team_id != away_team_id {
        return;
    }
    let is_official_match = game
        .league
        .as_ref()
        .and_then(|competition| competition.fixtures.get(fixture_index))
        .is_some_and(|fixture| is_official(&fixture.competition));
    if !is_official_match {
        return;
    }
    let (own, conceded) = if team_id == home_team_id {
        (home_goals, away_goals)
    } else {
        (away_goals, home_goals)
    };
    let outcome = match own.cmp(&conceded) {
        std::cmp::Ordering::Greater => Outcome::Won,
        std::cmp::Ordering::Equal => Outcome::Drawn,
        std::cmp::Ordering::Less => Outcome::Lost,
    };

    let stats = &mut game.manager.career_stats;
    stats.matches_managed += 1;
    match outcome {
        Outcome::Won => stats.wins += 1,
        Outcome::Drawn => stats.draws += 1,
        Outcome::Lost => stats.losses += 1,
    }

    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let team_name = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .map(|team| team.name.clone())
        .unwrap_or_default();
    let history = &mut game.manager.career_history;
    let index = match history
        .iter()
        .position(|entry| entry.team_id == team_id && entry.end_date.is_none())
    {
        Some(index) => index,
        None => {
            history.push(ManagerCareerEntry::open(team_id, team_name, today));
            history.len() - 1
        }
    };
    let entry = &mut history[index];
    entry.matches += 1;
    match outcome {
        Outcome::Won => entry.wins += 1,
        Outcome::Drawn => entry.draws += 1,
        Outcome::Lost => entry.losses += 1,
    }
}
