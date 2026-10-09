//! Story: a career that opens mid-season finds its club's past matches played in
//! full.
//!
//! The world settles every past fixture by scoreline alone. When the player takes
//! over a club, that club's league and cups are played again through the engine,
//! so each of those matches has a report, lineups, scorers and stats rows — and
//! nothing else in the world changes because of it.

use std::collections::HashMap;

use chrono::{TimeZone, Utc};
use domain::league::{CompetitionScope, CompetitionType, FixtureStatus, League, StandingEntry};
use domain::manager::Manager;
use domain::player::{Player, PlayerAttributes, Position};
use domain::stats::StatsState;
use domain::team::Team;
use ofm_core::catchup::simulate_past_fixtures;
use ofm_core::clock::GameClock;
use ofm_core::game::Game;
use ofm_core::schedule::{generate_knockout_cup, generate_league};
use ofm_core::season_replay::replay_user_competitions_through_engine;
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;

const MANAGED: &str = "club-0";

fn attributes(goalkeeper: bool) -> PlayerAttributes {
    let keeping = if goalkeeper { 75 } else { 30 };
    PlayerAttributes {
        pace: 65,
        stamina: 70,
        strength: 65,
        agility: 65,
        passing: 65,
        shooting: 60,
        tackling: 60,
        dribbling: 62,
        defending: 60,
        positioning: 62,
        vision: 62,
        decisions: 62,
        composure: 62,
        aggression: 55,
        teamwork: 65,
        leadership: 55,
        handling: keeping,
        reflexes: keeping,
        aerial: 60,
    }
}

/// A 16-man squad: two keepers, six defenders, five midfielders, three forwards.
fn squad(team_id: &str) -> Vec<Player> {
    [
        (Position::Goalkeeper, 2),
        (Position::Defender, 6),
        (Position::Midfielder, 5),
        (Position::Forward, 3),
    ]
    .into_iter()
    .flat_map(|(position, count)| {
        (0..count).map(move |index| {
            let mut player = Player::new(
                format!("{team_id}-{position:?}-{index}"),
                format!("{team_id} {position:?} {index}"),
                format!("{team_id} {position:?} Player {index}"),
                "1996-01-01".to_string(),
                "England".to_string(),
                position.clone(),
                attributes(position == Position::Goalkeeper),
            );
            player.team_id = Some(team_id.to_string());
            player.morale = 70;
            player.condition = 90;
            player
        })
    })
    .collect()
}

fn club(id: &str) -> Team {
    Team::new(
        id.to_string(),
        format!("Club {id}"),
        id[..3].to_string(),
        "England".to_string(),
        "Town".to_string(),
        "Ground".to_string(),
        30_000,
    )
}

fn ids(range: std::ops::Range<usize>) -> Vec<String> {
    range.map(|index| format!("club-{index}")).collect()
}

fn utc(year: i32, month: u32, day: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).unwrap()
}

/// Settle every fixture before `today` by scoreline, rounds included, the way
/// the world is built.
fn settle_by_scoreline(competition: &mut League, players: &[Player], today: chrono::DateTime<Utc>) {
    let mut rng = ChaCha8Rng::seed_from_u64(7);
    while simulate_past_fixtures(competition, players, today, &mut rng) > 0 {}
}

/// A world on 15 October 2025, ten weeks into its season. The managed club plays
/// in an eight-club league (seven matchdays past) and an eight-club cup (its
/// quarter-finals from 17 September and semi-finals from 4 October past, the
/// final on 19 October still to come). Four other clubs play a league of their own.
fn mid_season_world() -> Game {
    let today = utc(2025, 10, 15);
    let teams: Vec<Team> = ids(0..12).iter().map(|id| club(id)).collect();
    let players: Vec<Player> = ids(0..12).iter().flat_map(|id| squad(id)).collect();

    let mut league = generate_league("League", 2025, &ids(0..8), utc(2025, 8, 30));
    let mut cup = generate_knockout_cup(
        "Cup",
        2025,
        &ids(0..8),
        utc(2025, 9, 17),
        CompetitionType::Cup,
        CompetitionScope::Domestic,
    );
    let mut other = generate_league("Other", 2025, &ids(8..12), utc(2025, 8, 30));
    for competition in [&mut league, &mut cup, &mut other] {
        settle_by_scoreline(competition, &players, today);
    }

    let manager = Manager::new(
        "mgr".to_string(),
        "Alex".to_string(),
        "Boss".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let mut game = Game::new(
        GameClock::new(today),
        manager,
        teams,
        players,
        vec![],
        vec![],
    );
    game.competitions = vec![league, cup, other];
    game
}

fn competition<'a>(game: &'a Game, name: &str) -> &'a League {
    game.competitions
        .iter()
        .find(|competition| competition.name == name)
        .unwrap_or_else(|| panic!("no competition {name}"))
}

fn completed(league: &League) -> impl Iterator<Item = &domain::league::Fixture> {
    league
        .fixtures
        .iter()
        .filter(|fixture| fixture.status == FixtureStatus::Completed)
}

fn replay(game: &mut Game) -> (usize, StatsState) {
    let mut stats = StatsState::default();
    let played = replay_user_competitions_through_engine(game, MANAGED, &mut stats);
    (played, stats)
}

/// Given a mid-season world,
/// When the managed club's competitions are replayed,
/// Then every past fixture of its league and cup has a report with both lineups,
/// and stats rows for both sides.
#[test]
fn the_managed_clubs_past_matches_are_played_in_full() {
    let mut game = mid_season_world();

    let (played, stats) = replay(&mut game);

    let league_and_cup: Vec<_> = completed(competition(&game, "League"))
        .chain(completed(competition(&game, "Cup")))
        .collect();
    assert_eq!(
        league_and_cup.len(),
        7 * 4 + 4 + 2,
        "seven matchdays, quarters and semis"
    );
    assert_eq!(played, league_and_cup.len());
    for fixture in league_and_cup {
        let report = fixture
            .result
            .as_ref()
            .and_then(|result| result.report.as_ref())
            .unwrap_or_else(|| panic!("{} has no report", fixture.id));
        assert!(report.home_lineup.is_some() && report.away_lineup.is_some());
        assert_eq!(
            stats
                .team_matches
                .iter()
                .filter(|row| row.fixture_id == fixture.id)
                .count(),
            2
        );
        assert!(
            stats
                .player_matches
                .iter()
                .any(|row| row.fixture_id == fixture.id)
        );
    }
}

/// Given a league the managed club is not in,
/// When the club's competitions are replayed,
/// Then that league's past fixtures keep their scoreline-only results.
#[test]
fn other_clubs_competitions_stay_settled_by_scoreline() {
    let mut game = mid_season_world();
    let before: Vec<_> = completed(competition(&game, "Other"))
        .map(|fixture| {
            fixture
                .result
                .clone()
                .map(|result| (result.home_goals, result.away_goals))
        })
        .collect();

    replay(&mut game);

    let other = competition(&game, "Other");
    assert!(completed(other).all(|fixture| {
        fixture
            .result
            .as_ref()
            .is_some_and(|result| result.report.is_none())
    }));
    let after: Vec<_> = completed(other)
        .map(|fixture| {
            fixture
                .result
                .clone()
                .map(|result| (result.home_goals, result.away_goals))
        })
        .collect();
    assert_eq!(before, after);
}

/// Given the replayed league,
/// Then its table is exactly what its replayed results add up to.
#[test]
fn the_table_adds_up_the_replayed_results() {
    let mut game = mid_season_world();

    replay(&mut game);

    let league = competition(&game, "League");
    let mut expected: HashMap<&str, StandingEntry> = HashMap::new();
    for fixture in completed(league) {
        let result = fixture.result.as_ref().expect("a result");
        expected
            .entry(&fixture.home_team_id)
            .or_insert_with(|| StandingEntry::new(fixture.home_team_id.clone()))
            .record_result(result.home_goals, result.away_goals);
        expected
            .entry(&fixture.away_team_id)
            .or_insert_with(|| StandingEntry::new(fixture.away_team_id.clone()))
            .record_result(result.away_goals, result.home_goals);
    }
    for entry in &league.standings {
        let want = &expected[entry.team_id.as_str()];
        assert_eq!(
            (
                entry.played,
                entry.points,
                entry.goals_for,
                entry.goals_against
            ),
            (want.played, want.points, want.goals_for, want.goals_against),
            "{}",
            entry.team_id
        );
    }
}

/// Given the replayed cup,
/// Then each round is contested by the winners of the round before, and the
/// final, after the day the career opens, is still to be played.
#[test]
fn the_cup_advances_the_replayed_winners() {
    let mut game = mid_season_world();

    replay(&mut game);

    let cup = competition(&game, "Cup");
    assert_eq!(
        cup.knockout_rounds.len(),
        3,
        "quarters, semis and the final"
    );
    for pair in cup.knockout_rounds.windows(2) {
        let winners: Vec<String> = pair[0]
            .fixture_ids
            .iter()
            .filter_map(|id| cup.fixtures.iter().find(|fixture| &fixture.id == id))
            .filter_map(|fixture| fixture.advancing_team_id().map(str::to_string))
            .collect();
        let mut next: Vec<String> = pair[1]
            .fixture_ids
            .iter()
            .filter_map(|id| cup.fixtures.iter().find(|fixture| &fixture.id == id))
            .flat_map(|fixture| [fixture.home_team_id.clone(), fixture.away_team_id.clone()])
            .collect();
        let mut winners_sorted = winners.clone();
        winners_sorted.sort();
        next.sort();
        assert_eq!(
            next, winners_sorted,
            "{} is not contested by {}'s winners",
            pair[1].name, pair[0].name
        );
    }
    let final_round = cup.knockout_rounds.last().expect("a final");
    assert!(!final_round.completed);
    assert_eq!(
        cup.fixtures.len(),
        4 + 2 + 1,
        "no fixture of a dropped round lingers"
    );
}

/// Given the replay,
/// Then each player's season goals are the goals the reports credit him with.
#[test]
fn season_totals_match_the_reports() {
    let mut game = mid_season_world();

    replay(&mut game);

    let mut goals: HashMap<String, u32> = HashMap::new();
    for name in ["League", "Cup"] {
        for fixture in completed(competition(&game, name)) {
            let result = fixture.result.as_ref().expect("a result");
            for goal in result.home_scorers.iter().chain(&result.away_scorers) {
                *goals.entry(goal.player_id.clone()).or_default() += 1;
            }
        }
    }
    assert!(!goals.is_empty(), "thirty-odd matches without a goal");
    for player in &game.players {
        assert_eq!(
            player.stats.goals,
            goals.get(&player.id).copied().unwrap_or(0),
            "{}",
            player.id
        );
    }
}

/// Given the replay,
/// Then it sends no mail, writes no news, and leaves every player's fitness,
/// morale and injuries, every club's form and the board where they were.
#[test]
fn the_past_leaves_the_present_alone() {
    let mut game = mid_season_world();
    let snapshot = |game: &Game| {
        game.players
            .iter()
            .map(|player| {
                (
                    player.id.clone(),
                    player.condition,
                    player.morale,
                    player.injury.is_some(),
                )
            })
            .collect::<Vec<_>>()
    };
    let players_before = snapshot(&game);
    let form_before: Vec<_> = game.teams.iter().map(|team| team.form.clone()).collect();
    let (messages, news, satisfaction) = (
        game.messages.len(),
        game.news.len(),
        game.manager.satisfaction,
    );

    replay(&mut game);

    assert_eq!(snapshot(&game), players_before);
    assert_eq!(
        game.teams
            .iter()
            .map(|team| team.form.clone())
            .collect::<Vec<_>>(),
        form_before
    );
    assert_eq!(game.messages.len(), messages);
    assert_eq!(game.news.len(), news);
    assert_eq!(game.manager.satisfaction, satisfaction);
}

/// Given two copies of the same world,
/// When each is replayed,
/// Then the matches finish with the same scores.
#[test]
fn the_same_world_replays_the_same_way() {
    let scores = |game: &Game| {
        let mut scores: Vec<_> = ["League", "Cup"]
            .iter()
            .flat_map(|name| completed(competition(game, name)))
            .map(|fixture| {
                let result = fixture.result.as_ref().expect("a result");
                (
                    fixture.date.clone(),
                    fixture.home_team_id.clone(),
                    fixture.away_team_id.clone(),
                    result.home_goals,
                    result.away_goals,
                )
            })
            .collect();
        scores.sort();
        scores
    };
    let mut first = mid_season_world();
    let mut second = first.clone();

    replay(&mut first);
    replay(&mut second);

    assert_eq!(scores(&first), scores(&second));
}

/// Given a world already replayed,
/// When it is replayed again,
/// Then nothing is played and nothing changes.
#[test]
fn replaying_again_does_nothing() {
    let mut game = mid_season_world();
    replay(&mut game);
    let league_before = competition(&game, "League").fixtures.len();

    let (played, stats) = replay(&mut game);

    assert_eq!(played, 0);
    assert!(stats.player_matches.is_empty());
    assert_eq!(competition(&game, "League").fixtures.len(), league_before);
}

/// Given a career that opens before the season's first matchday,
/// When the club's competitions are replayed,
/// Then there is nothing to play.
#[test]
fn a_career_opening_before_the_season_replays_nothing() {
    let mut game = mid_season_world();
    for competition in &mut game.competitions {
        for fixture in &mut competition.fixtures {
            fixture.status = FixtureStatus::Scheduled;
            fixture.result = None;
        }
    }
    game.clock.current_date = utc(2025, 8, 1);

    let (played, _) = replay(&mut game);

    assert_eq!(played, 0);
}

/// Given matchdays between the day the world was built and the day the career
/// opens, still unplayed on the schedule,
/// When the club's competitions are replayed,
/// Then they are played through the engine with the rest.
#[test]
fn matchdays_the_world_never_settled_are_played_too() {
    let mut game = mid_season_world();
    // The world was built on 1 October: the last two matchdays are still to play.
    for competition in &mut game.competitions {
        for fixture in &mut competition.fixtures {
            if fixture.date.as_str() >= "2025-10-01" && fixture.date.as_str() < "2025-10-15" {
                fixture.status = FixtureStatus::Scheduled;
                fixture.result = None;
            }
        }
    }

    replay(&mut game);

    let league = competition(&game, "League");
    let stranded: Vec<_> = league
        .fixtures
        .iter()
        .filter(|fixture| {
            fixture.date.as_str() >= "2025-10-01" && fixture.date.as_str() < "2025-10-15"
        })
        .collect();
    assert!(!stranded.is_empty());
    assert!(stranded.iter().all(|fixture| {
        fixture
            .result
            .as_ref()
            .is_some_and(|result| result.report.is_some())
    }));
}

/// Given a club in the managed club's league with nobody left on its books,
/// When the league is replayed,
/// Then its matches are settled by scoreline and nobody is signed to play them.
#[test]
fn a_side_with_nobody_to_field_is_settled_by_scoreline_without_signings() {
    let mut game = mid_season_world();
    game.players
        .retain(|player| player.team_id.as_deref() != Some("club-7"));
    let players = game.players.len();

    replay(&mut game);

    assert_eq!(game.players.len(), players, "someone was signed");
    let league = competition(&game, "League");
    let club_7: Vec<_> = completed(league)
        .filter(|fixture| fixture.home_team_id == "club-7" || fixture.away_team_id == "club-7")
        .collect();
    assert!(!club_7.is_empty());
    assert!(club_7.iter().all(|fixture| {
        fixture
            .result
            .as_ref()
            .is_some_and(|result| result.report.is_none())
    }));
}

/// How long a mid-season career takes to open in the full shipped world, with
/// the club's league and cups replayed through the engine. For reading, not for
/// the suite:
///
/// ```text
/// cargo test --release -p ofm_core --test season_replay_tests -- --ignored --nocapture
/// ```
#[test]
#[ignore = "a timing probe over the full world; run by hand in release"]
fn a_mid_season_career_opens_in_reasonable_time_in_the_full_world() {
    use ofm_core::generator::{
        DefinitionSources, WorldGenConfig, default_opening_year, generate_world_data_seeded_with,
    };
    use ofm_core::world::start_date_for_year;

    let sources = DefinitionSources::embedded_only();
    let data =
        generate_world_data_seeded_with(11, &WorldGenConfig::standard_from(&sources), &sources);
    let manager = Manager::new(
        "probe".to_string(),
        "Probe".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let mut clock = GameClock::new(start_date_for_year(default_opening_year() as i32).unwrap());
    clock.advance_days(120);
    let mut game = Game::new(clock, manager, data.teams, data.players, data.staff, vec![]);
    let club = game
        .teams
        .iter()
        .find(|team| team.football_nation == "ENG")
        .map(|team| team.id.clone())
        .expect("an English club");

    let started = std::time::Instant::now();
    let stats = ofm_core::career::begin_career(
        &mut game,
        &club,
        ofm_core::career::CareerScope::default(),
        StatsState::default(),
    )
    .expect("the career begins");
    let elapsed = started.elapsed();

    println!(
        "mid-season career opened in {:.2?}, {} fixtures replayed through the engine",
        elapsed,
        stats.team_matches.len() / 2
    );
}
