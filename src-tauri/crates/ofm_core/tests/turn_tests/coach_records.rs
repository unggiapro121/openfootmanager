//! What a career tells its coach account (tài-khoản-HLV Y8, Y11): a record of
//! each official match of the user's club, a trophy when one is won, and the
//! mark that a match was managed on the touchline.

use super::*;
use domain::coach::CoachProgress;
use domain::league::CompetitionFormat;
use domain::manager::HonourKind;
use ofm_core::coach_progress::{CoachMatchRecord, CoachRecord};
use ofm_core::manager_mastery::{self, MasteryGain};

fn game_of_an_account() -> Game {
    let mut game = make_game_with_match();
    game.account_id = Some("account-1".to_string());
    game
}

fn match_records(game: &Game) -> Vec<&CoachMatchRecord> {
    game.pending_coach_reports
        .iter()
        .filter_map(|record| match record {
            CoachRecord::Match(record) => Some(record),
            CoachRecord::Honour(_) => None,
        })
        .collect()
}

fn with_sheets(mut report: MatchReport, home_style: engine::PlayStyle) -> MatchReport {
    let sheet = |play_style| engine::TeamSheet {
        formation: "4-4-2".to_string(),
        play_style,
        starters: vec![],
        bench: vec![],
    };
    report.home_sheet = Some(sheet(home_style));
    report.away_sheet = Some(sheet(engine::PlayStyle::Balanced));
    report
}

/// Given a career of an account,
/// When its club's league match is played,
/// Then one record waits for the account, with the score and the club's style,
/// not yet allowed to earn XP.
#[test]
fn an_official_match_is_recorded_for_the_account() {
    let mut game = game_of_an_account();
    game.teams[0].play_style = domain::team::PlayStyle::Possession;

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(2, 1));

    let records = match_records(&game);
    assert_eq!(records.len(), 1);
    let record = records[0];
    assert_eq!(record.fixture_id, "fix1");
    assert_eq!(record.competition, FixtureCompetition::League);
    assert_eq!((record.own_goals, record.opponent_goals), (2, 1));
    assert_eq!(record.style, domain::team::PlayStyle::Possession);
    assert!(!record.earns_xp);
}

/// Given the user's club plays away,
/// When the result is applied,
/// Then the record reads the score from the club's side.
#[test]
fn an_away_match_is_recorded_from_the_clubs_side() {
    let mut game = game_of_an_account();
    game.manager.team_id = Some("team2".to_string());

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(3, 0));

    let record = match_records(&game)[0];
    assert_eq!((record.own_goals, record.opponent_goals), (0, 3));
}

/// Given a career with no account (an MCP game),
/// When its club's match is played,
/// Then nothing waits for any account.
#[test]
fn a_career_without_an_account_records_nothing() {
    let mut game = make_game_with_match();

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 0));

    assert!(game.pending_coach_reports.is_empty());
}

/// Given a career of an account,
/// When a friendly of its club is played,
/// Then it is no official match and nothing is recorded.
#[test]
fn a_friendly_is_not_recorded() {
    let mut game = game_of_an_account();
    game.league.as_mut().unwrap().fixtures[0].competition = FixtureCompetition::Friendly;

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 0));

    assert!(game.pending_coach_reports.is_empty());
}

/// Given a career of an account whose club reaches a cup final,
/// When it wins the final,
/// Then the account is told of the match and of the trophy.
#[test]
fn a_cup_won_is_an_honour_for_the_account() {
    let mut game = game_of_an_account();
    let cup = game.league.as_mut().unwrap();
    cup.rules.format = CompetitionFormat::Knockout;
    cup.standings.clear();
    cup.fixtures[0].competition = FixtureCompetition::Cup;
    cup.knockout_rounds.push(KnockoutRoundState {
        id: "final".to_string(),
        name: "Final".to_string(),
        fixture_ids: vec!["fix1".to_string()],
        ..Default::default()
    });

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(2, 1));

    assert_eq!(match_records(&game).len(), 1);
    assert!(
        game.pending_coach_reports
            .contains(&CoachRecord::Honour(HonourKind::DomesticCup))
    );
}

/// Given the record of a match the user took to the field, starting in Counter,
/// When it is marked as managed,
/// Then it may earn XP, in the style the side kicked off in.
#[test]
fn a_managed_match_is_marked_to_earn_xp_in_its_starting_style() {
    let mut game = game_of_an_account();
    let report = with_sheets(empty_report(2, 0), engine::PlayStyle::Counter);
    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    let marked = manager_mastery::mark_managed_match(&mut game, &report, "fix1", "team1", "team2");

    assert!(marked);
    let record = match_records(&game)[0];
    assert!(record.earns_xp);
    assert_eq!(record.style, domain::team::PlayStyle::Counter);
}

/// Given no record of the fixture (another fixture's id, or a career without an account),
/// When a managed match is marked,
/// Then nothing is marked.
#[test]
fn only_the_recorded_fixture_is_marked() {
    let mut game = game_of_an_account();
    let report = with_sheets(empty_report(2, 0), engine::PlayStyle::Counter);
    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);
    let mut without_account = make_game_with_match();
    turn::apply_match_report(&mut without_account, 0, "team1", "team2", &report);

    assert!(!manager_mastery::mark_managed_match(
        &mut game, &report, "fix2", "team1", "team2"
    ));
    assert!(!match_records(&game)[0].earns_xp);
    assert!(!manager_mastery::mark_managed_match(
        &mut without_account,
        &report,
        "fix1",
        "team1",
        "team2"
    ));
}

/// Given the account's progress after a report that took Counter to 55,
/// When it is applied to the career,
/// Then the manager carries the account's mastery and XP, and is told of the milestone.
#[test]
fn the_accounts_progress_is_carried_into_the_career() {
    let mut game = game_of_an_account();
    let mut progress = CoachProgress::default();
    progress.mastery.counter = 55;
    progress.style_xp.counter.xp = 4;
    progress.style_xp.counter.matches = 31;
    let gain = MasteryGain {
        style: domain::team::PlayStyle::Counter,
        xp: 15,
        mastery_before: 54,
        mastery_after: 55,
    };

    manager_mastery::apply_coach_progress(&mut game, &progress, Some(&gain));

    assert_eq!(game.manager.play_style_mastery.counter, 55);
    assert_eq!(game.manager.progression.style_xp, progress.style_xp);
    let message = game
        .messages
        .iter()
        .find(|message| message.id.starts_with("style_mastery_"))
        .expect("the milestone is announced");
    assert_eq!(message.i18n_params.get("mastery"), Some(&"55".to_string()));
}

/// Given a gain that crosses no multiple of five,
/// When the progress is applied,
/// Then no message is sent.
#[test]
fn a_point_between_milestones_is_not_announced() {
    let mut game = game_of_an_account();
    let gain = MasteryGain {
        style: domain::team::PlayStyle::Counter,
        xp: 15,
        mastery_before: 50,
        mastery_after: 51,
    };

    manager_mastery::apply_coach_progress(&mut game, &CoachProgress::default(), Some(&gain));

    assert!(
        !game
            .messages
            .iter()
            .any(|message| message.id.starts_with("style_mastery_"))
    );
}

/// Given a cup tie the user's club won on penalties after a draw,
/// When the result is applied,
/// Then the record holds the draw: a shootout is no win (X97).
#[test]
fn a_shootout_win_is_recorded_as_a_draw() {
    let mut game = game_of_an_account();
    game.league.as_mut().unwrap().fixtures[0].competition = FixtureCompetition::Cup;
    let mut report = empty_report(1, 1);
    report.home_penalties = Some(5);
    report.away_penalties = Some(4);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    let record = match_records(&game)[0];
    assert_eq!((record.own_goals, record.opponent_goals), (1, 1));
}

/// Given a managed match whose report has no team sheets,
/// When it is marked,
/// Then it keeps the style the user's club plays.
#[test]
fn without_a_team_sheet_the_clubs_style_is_kept() {
    let mut game = game_of_an_account();
    game.teams[0].play_style = domain::team::PlayStyle::HighPress;
    let report = empty_report(0, 1);
    turn::apply_match_report(&mut game, 0, "team1", "team2", &report);

    assert!(manager_mastery::mark_managed_match(
        &mut game, &report, "fix1", "team1", "team2"
    ));

    assert_eq!(
        match_records(&game)[0].style,
        domain::team::PlayStyle::HighPress
    );
}
