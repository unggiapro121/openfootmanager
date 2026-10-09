//! Playing the managed club's season up to the day the career opens.
//!
//! A world is built with every fixture already in the past settled by scoreline
//! alone ([`crate::catchup::simulate_past_fixtures`]): a score, and nothing else —
//! no scorers, no report, no stats rows. That is enough for a table, and not
//! enough for the club the player takes over, whose scorers, assists and cards
//! leaderboards and match details have to be complete from the first matchday.
//!
//! So when a career opens mid-season, the club's own competitions — its league,
//! domestic cups and continental competition — are wound back to their first
//! matchday and played again through the engine, day by day, league and cup
//! interleaved as they were scheduled. Each match is recorded the way history
//! keeps it ([`crate::turn::record_match_outcome`]) and nothing more: the match
//! happened before the career, so it sends no mail, writes no news, and leaves
//! today's fitness, morale and board where the world put them.

use std::collections::HashSet;

use chrono::NaiveDate;
use domain::league::{CompetitionFormat, CompetitionType, FixtureStatus, League, StandingEntry};
use domain::stats::StatsState;

use crate::game::Game;
use crate::live_match_manager::play_past_fixture;

/// Wind the competitions `team_id` plays in back to their first matchday and play
/// every fixture before today again through the engine, adding each match's
/// stats rows to `stats`. Returns how many fixtures it played.
///
/// A competition is replayed only while none of its fixtures has a report, so a
/// second call — or a career resumed in a world already played — does nothing.
pub fn replay_user_competitions_through_engine(
    game: &mut Game,
    team_id: &str,
    stats: &mut StatsState,
) -> usize {
    let today = game.clock.current_date.date_naive();
    let competition_indices = competitions_to_replay(game, team_id, today);
    if competition_indices.is_empty() {
        return 0;
    }
    for &index in &competition_indices {
        rewind_scoreline_results(&mut game.competitions[index]);
    }

    let mut played = 0;
    while let Some(date) = earliest_unplayed_date(game, &competition_indices, today) {
        let played_today: usize = competition_indices
            .iter()
            .map(|&index| play_competition_day(game, index, &date, stats))
            .sum();
        // Every fixture due on `date` is settled one way or the other, so the day
        // always moves on; this guards the loop should that ever stop being true.
        if played_today == 0 {
            log::error!("[season-replay] nothing played on {date}; stopping the replay");
            break;
        }
        played += played_today;
    }
    game.sync_legacy_league();
    played
}

/// The club's own competitions with a matchday before today and nothing played
/// through the engine yet. National teams have their own season.
///
/// A past matchday may be settled by scoreline or not settled at all: the world
/// settles fixtures up to the day it was built, and a mid-season career opens
/// later than that, so the weeks in between are still on the schedule until a
/// load repairs them ([`crate::catchup::repair_stranded_fixtures`]).
fn competitions_to_replay(game: &Game, team_id: &str, today: NaiveDate) -> Vec<usize> {
    game.competitions
        .iter()
        .enumerate()
        .filter(|(_, competition)| competition.kind != CompetitionType::InternationalNation)
        .filter(|(_, competition)| competition.participant_ids.iter().any(|id| id == team_id))
        .filter(|(_, competition)| {
            competition.fixtures.iter().any(|fixture| {
                matches!(
                    fixture.status,
                    FixtureStatus::Completed | FixtureStatus::Scheduled
                ) && is_before(&fixture.date, today)
            })
        })
        .filter(|(_, competition)| {
            !competition.fixtures.iter().any(|fixture| {
                fixture
                    .result
                    .as_ref()
                    .is_some_and(|result| result.report.is_some())
            })
        })
        .map(|(index, _)| index)
        .collect()
}

/// Undo a competition's scoreline results, back to its first matchday.
///
/// Rounds that a played round seeded go, with their fixtures: the replay seeds
/// them again from its own winners, on the same dates, since a round's date is
/// worked out from the one before it. A knockout cup keeps its first round, which
/// was drawn with the competition; a group stage's knockout rounds are all seeded
/// from the groups. The schedule is not regenerated: that would undo fixtures
/// moved off national-team dates and could not rebuild the same draw.
fn rewind_scoreline_results(competition: &mut League) {
    let first_seeded_round = match competition.rules.format {
        CompetitionFormat::LeagueTable => competition.knockout_rounds.len(),
        CompetitionFormat::Knockout => 1.min(competition.knockout_rounds.len()),
        CompetitionFormat::GroupAndKnockout => 0,
    };
    let seeded_fixtures: HashSet<String> = competition
        .knockout_rounds
        .drain(first_seeded_round..)
        .flat_map(|round| round.fixture_ids)
        .collect();
    competition
        .fixtures
        .retain(|fixture| !seeded_fixtures.contains(&fixture.id));
    for round in &mut competition.knockout_rounds {
        round.completed = false;
    }
    for fixture in &mut competition.fixtures {
        if fixture.status == FixtureStatus::Completed {
            fixture.status = FixtureStatus::Scheduled;
            fixture.result = None;
        }
    }
    let groups = competition
        .groups
        .iter_mut()
        .flat_map(|group| group.standings.iter_mut());
    for entry in competition.standings.iter_mut().chain(groups) {
        *entry = StandingEntry::new(entry.team_id.clone());
    }
}

/// The first date before today on which any of the competitions still has a
/// fixture to play.
fn earliest_unplayed_date(
    game: &Game,
    competition_indices: &[usize],
    today: NaiveDate,
) -> Option<String> {
    competition_indices
        .iter()
        .flat_map(|&index| game.competitions[index].fixtures.iter())
        .filter(|fixture| {
            fixture.status == FixtureStatus::Scheduled && is_before(&fixture.date, today)
        })
        .map(|fixture| fixture.date.clone())
        .min()
}

/// Play one competition's fixtures on `date`. Simulation reads the competition
/// out of the legacy `game.league` slot, so it is moved there and back, as the
/// day loop does.
fn play_competition_day(
    game: &mut Game,
    competition_index: usize,
    date: &str,
    stats: &mut StatsState,
) -> usize {
    game.league = Some(std::mem::take(&mut game.competitions[competition_index]));
    let due: Vec<usize> = game.league.as_ref().map_or_else(Vec::new, |league| {
        league
            .fixtures
            .iter()
            .enumerate()
            .filter(|(_, fixture)| {
                fixture.date == date && fixture.status == FixtureStatus::Scheduled
            })
            .map(|(index, _)| index)
            .collect()
    });
    for &fixture_index in &due {
        replay_fixture(game, fixture_index, date, stats);
    }
    match game.league.take() {
        Some(competition) => game.competitions[competition_index] = competition,
        // Nothing on this path clears the slot; were it ever empty, the
        // competition would be lost, so say so rather than carry on silently.
        None => log::error!("[season-replay] competition {competition_index} left the legacy slot"),
    }
    due.len()
}

/// One past fixture through the engine; a side with nobody to field is settled
/// by scoreline instead, as the day loop settles it, and nobody is signed.
fn replay_fixture(game: &mut Game, fixture_index: usize, date: &str, stats: &mut StatsState) {
    match play_past_fixture(game, fixture_index) {
        Ok(played) => {
            crate::turn::record_match_outcome(
                game,
                fixture_index,
                &played.home_team_id,
                &played.away_team_id,
                &played.report,
                &mut |capture| stats.append(capture),
            );
        }
        Err(error) => {
            log::warn!(
                "[season-replay] fixture {fixture_index} on {date} could not be played ({error}); settled by scoreline"
            );
            let mut rng = game.rng_for("season-replay/scoreline", date);
            if let Some(league) = game.league.as_mut() {
                crate::catchup::resolve_fixture_by_scoreline(
                    &game.players,
                    league,
                    fixture_index,
                    &mut rng,
                );
            }
        }
    }
}

fn is_before(date: &str, today: NaiveDate) -> bool {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok_and(|date| date < today)
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::league::{CompetitionRules, Fixture, GroupState, KnockoutRoundState, MatchResult};

    fn played(id: &str, home: &str, away: &str) -> Fixture {
        Fixture {
            id: id.to_string(),
            home_team_id: home.to_string(),
            away_team_id: away.to_string(),
            status: FixtureStatus::Completed,
            result: Some(MatchResult {
                home_goals: 2,
                away_goals: 0,
                ..Default::default()
            }),
            ..Default::default()
        }
    }

    fn recorded(team_id: &str) -> StandingEntry {
        let mut entry = StandingEntry::new(team_id.to_string());
        entry.record_result(2, 0);
        entry
    }

    /// Given a group stage played out and the knockout round it seeded,
    /// When the competition is rewound,
    /// Then the knockout round and its fixture are gone, the group fixtures are
    /// unplayed again, and every group table is back to zero.
    #[test]
    fn rewinding_a_group_stage_drops_the_knockout_rounds_it_seeded() {
        let mut competition = League {
            rules: CompetitionRules {
                format: CompetitionFormat::GroupAndKnockout,
                ..Default::default()
            },
            fixtures: vec![
                played("g1", "a", "b"),
                played("g2", "c", "d"),
                played("ko1", "a", "c"),
            ],
            groups: vec![GroupState {
                id: "group-a".to_string(),
                name: "A".to_string(),
                team_ids: vec!["a".to_string(), "b".to_string()],
                standings: vec![recorded("a"), recorded("b")],
            }],
            knockout_rounds: vec![KnockoutRoundState {
                id: "final".to_string(),
                name: "Final".to_string(),
                fixture_ids: vec!["ko1".to_string()],
                bye_team_ids: vec![],
                completed: true,
            }],
            ..Default::default()
        };

        rewind_scoreline_results(&mut competition);

        assert!(competition.knockout_rounds.is_empty());
        let ids: Vec<&str> = competition
            .fixtures
            .iter()
            .map(|fixture| fixture.id.as_str())
            .collect();
        assert_eq!(ids, vec!["g1", "g2"]);
        assert!(
            competition
                .fixtures
                .iter()
                .all(|fixture| fixture.status == FixtureStatus::Scheduled
                    && fixture.result.is_none())
        );
        assert!(
            competition.groups[0]
                .standings
                .iter()
                .all(|entry| entry.played == 0 && entry.points == 0)
        );
    }
}
