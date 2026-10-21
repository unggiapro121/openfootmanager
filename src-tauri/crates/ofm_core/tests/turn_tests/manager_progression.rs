//! The user's season tallies kept as matches are played (phase 2 lane M, M-1).

use super::*;
use domain::league::CompetitionFormat;
use domain::manager::HonourKind;

/// The fixture of `make_game_with_match` turned into a one-match knockout
/// competition of `competition` kind: a final between team1 and team2.
fn game_with_final(competition: FixtureCompetition) -> Game {
    let mut game = make_game_with_match();
    let cup = game.league.as_mut().unwrap();
    cup.id = "the-cup".to_string();
    cup.rules.format = CompetitionFormat::Knockout;
    cup.standings.clear();
    cup.fixtures[0].competition = competition;
    cup.knockout_rounds.push(KnockoutRoundState {
        id: "the-cup-final".to_string(),
        name: "Final".to_string(),
        fixture_ids: vec!["fix1".to_string()],
        ..Default::default()
    });
    game
}

/// Given the user's club plays a league match,
/// When the result is applied,
/// Then it counts as a league match the user led this season.
#[test]
fn a_league_match_of_the_users_club_counts_as_one_led() {
    let mut game = make_game_with_match();

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 0));

    assert_eq!(game.manager.progression.season_league_matches_led, 1);
}

/// Given a league match between two clubs the user does not lead,
/// When the result is applied,
/// Then the user's count does not move.
#[test]
fn another_clubs_league_match_does_not_count() {
    let mut game = make_game_with_match();
    game.manager.team_id = Some("team3".to_string());

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 0));

    assert_eq!(game.manager.progression.season_league_matches_led, 0);
}

/// Given the user's club plays a cup tie,
/// When the result is applied,
/// Then it is not a league match and does not count.
#[test]
fn a_cup_match_is_not_a_league_match_led() {
    let mut game = game_with_final(FixtureCompetition::Cup);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(1, 0));

    assert_eq!(game.manager.progression.season_league_matches_led, 0);
}

/// Given the user's club wins a domestic cup final,
/// When the result is applied,
/// Then the cup is the user's honour for the season and a trophy in their record.
#[test]
fn winning_a_cup_final_is_an_honour_and_a_trophy() {
    let mut game = game_with_final(FixtureCompetition::Cup);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(2, 1));

    let honours = &game.manager.progression.season_honours;
    assert_eq!(honours.len(), 1);
    assert_eq!(honours[0].kind, HonourKind::DomesticCup);
    assert_eq!(honours[0].competition_id, "the-cup");
    assert_eq!(honours[0].team_id, "team1");
    assert_eq!(game.manager.career_stats.trophies, 1);
}

/// Given the user's club loses a cup final,
/// When the result is applied,
/// Then nothing is won.
#[test]
fn losing_a_cup_final_wins_nothing() {
    let mut game = game_with_final(FixtureCompetition::Cup);

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(0, 1));

    assert!(game.manager.progression.season_honours.is_empty());
    assert_eq!(game.manager.career_stats.trophies, 0);
}

/// Given the user's club wins a continental final, and another a club world final,
/// When each result is applied,
/// Then each is recorded as its own kind of honour.
#[test]
fn a_finals_kind_follows_its_competition() {
    let mut continental = game_with_final(FixtureCompetition::ContinentalClub);
    let mut club_world = game_with_final(FixtureCompetition::InternationalClub);

    turn::apply_match_report(&mut continental, 0, "team1", "team2", &empty_report(1, 0));
    turn::apply_match_report(&mut club_world, 0, "team1", "team2", &empty_report(1, 0));

    assert_eq!(
        continental.manager.progression.season_honours[0].kind,
        HonourKind::Continental
    );
    assert_eq!(
        club_world.manager.progression.season_honours[0].kind,
        HonourKind::ClubWorld
    );
}

/// Given a final won by a club the user does not lead,
/// When the result is applied,
/// Then the user wins nothing.
#[test]
fn another_clubs_final_is_not_the_users_honour() {
    let mut game = game_with_final(FixtureCompetition::Cup);
    game.manager.team_id = Some("team3".to_string());

    turn::apply_match_report(&mut game, 0, "team1", "team2", &empty_report(2, 0));

    assert!(game.manager.progression.season_honours.is_empty());
}

// ── Play style mastery earned in managed matches (M-2) ─────────────────────

fn report_with_sheets(
    home_goals: u8,
    away_goals: u8,
    home_style: engine::PlayStyle,
) -> MatchReport {
    let mut report = empty_report(home_goals, away_goals);
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

/// Given the user managed a league win against an equal side, starting in Counter,
/// When the match is credited,
/// Then Counter banks 15 XP and one match, and nothing else moves.
#[test]
fn a_managed_league_win_banks_xp_in_the_starting_style() {
    let mut game = make_game_with_match();
    let report = report_with_sheets(2, 0, engine::PlayStyle::Counter);

    let gain = ofm_core::manager_mastery::credit_managed_match(
        &mut game,
        &report,
        &FixtureCompetition::League,
        "team1",
        "team2",
    )
    .expect("a league match the user managed earns XP");

    assert_eq!(gain.style, domain::team::PlayStyle::Counter);
    assert_eq!(gain.xp, 15);
    assert_eq!((gain.mastery_before, gain.mastery_after), (50, 50));
    let counter = game.manager.progression.style_xp.counter;
    assert_eq!((counter.xp, counter.matches), (15, 1));
    assert_eq!(game.manager.progression.style_xp.balanced.matches, 0);
}

/// Given a friendly the user managed,
/// When it is credited,
/// Then it earns nothing.
#[test]
fn a_friendly_earns_no_mastery() {
    let mut game = make_game_with_match();
    let report = report_with_sheets(2, 0, engine::PlayStyle::Counter);

    let gain = ofm_core::manager_mastery::credit_managed_match(
        &mut game,
        &report,
        &FixtureCompetition::Friendly,
        "team1",
        "team2",
    );

    assert!(gain.is_none());
    assert_eq!(game.manager.progression.style_xp.counter.matches, 0);
}

/// Given a cup tie the user's club won on penalties after a draw,
/// When it is credited,
/// Then it is worth a draw's 10 XP.
#[test]
fn a_shootout_win_counts_as_a_draw() {
    let mut game = make_game_with_match();
    let mut report = report_with_sheets(1, 1, engine::PlayStyle::Possession);
    report.home_penalties = Some(5);
    report.away_penalties = Some(4);

    let gain = ofm_core::manager_mastery::credit_managed_match(
        &mut game,
        &report,
        &FixtureCompetition::Cup,
        "team1",
        "team2",
    )
    .unwrap();

    assert_eq!(gain.xp, 10);
}

/// Given a report without team sheets,
/// When it is credited,
/// Then the XP goes to the style the user's club plays.
#[test]
fn without_a_team_sheet_the_clubs_style_earns_the_xp() {
    let mut game = make_game_with_match();
    game.teams[0].play_style = domain::team::PlayStyle::HighPress;

    let gain = ofm_core::manager_mastery::credit_managed_match(
        &mut game,
        &empty_report(0, 1),
        &FixtureCompetition::League,
        "team1",
        "team2",
    )
    .unwrap();

    assert_eq!(gain.style, domain::team::PlayStyle::HighPress);
    assert_eq!(gain.xp, 7);
}

/// Given a match between two clubs the user does not lead,
/// When it is credited,
/// Then nothing is earned.
#[test]
fn another_clubs_match_earns_the_user_nothing() {
    let mut game = make_game_with_match();
    game.manager.team_id = Some("team3".to_string());

    let gain = ofm_core::manager_mastery::credit_managed_match(
        &mut game,
        &report_with_sheets(2, 0, engine::PlayStyle::Counter),
        &FixtureCompetition::League,
        "team1",
        "team2",
    );

    assert!(gain.is_none());
}

/// Given a user one XP short of Counter 55,
/// When a managed win takes them past it,
/// Then they are told the team has grown used to the style, at its new mastery.
#[test]
fn reaching_a_multiple_of_five_is_announced() {
    let mut game = make_game_with_match();
    game.manager.play_style_mastery.counter = 54;
    game.manager.progression.style_xp.counter.xp = 60;

    let gain = ofm_core::manager_mastery::credit_managed_match(
        &mut game,
        &report_with_sheets(2, 0, engine::PlayStyle::Counter),
        &FixtureCompetition::League,
        "team1",
        "team2",
    )
    .unwrap();

    assert_eq!((gain.mastery_before, gain.mastery_after), (54, 55));
    let message = game
        .messages
        .iter()
        .find(|message| message.id.starts_with("style_mastery_"))
        .expect("the milestone is announced");
    assert_eq!(
        message.subject_key.as_deref(),
        Some("be.msg.styleMastery.subject")
    );
    assert_eq!(
        message.i18n_params.get("style"),
        Some(&"common.playStyles.Counter".to_string())
    );
    assert_eq!(message.i18n_params.get("mastery"), Some(&"55".to_string()));
}

/// Given a managed win that moves mastery but crosses no multiple of five,
/// When it is credited,
/// Then no message is sent.
#[test]
fn a_point_between_milestones_is_not_announced() {
    let mut game = make_game_with_match();
    game.manager.progression.style_xp.counter.xp = 30;

    let gain = ofm_core::manager_mastery::credit_managed_match(
        &mut game,
        &report_with_sheets(2, 0, engine::PlayStyle::Counter),
        &FixtureCompetition::League,
        "team1",
        "team2",
    )
    .unwrap();

    assert_eq!((gain.mastery_before, gain.mastery_after), (50, 51));
    assert!(
        !game
            .messages
            .iter()
            .any(|m| m.id.starts_with("style_mastery_"))
    );
}
