//! Offers the manager sends are answered days later, by mail, as in real
//! football: a bid, a loan offer, a counter to a club bidding for one of his
//! players, a contract for a free agent.

use chrono::{Duration, NaiveDate, TimeZone, Utc};
use domain::manager::Manager;
use domain::player::{Player, PlayerAttributes, Position};
use domain::season::TransferWindowStatus;
use domain::team::Team;
use ofm_core::clock::GameClock;
use ofm_core::game::Game;
use ofm_core::transfers::{
    ERR_AWAITING_REPLY, Submission, UserProposal, deliver_due_replies, submit_proposal,
};

fn attributes() -> PlayerAttributes {
    PlayerAttributes {
        pace: 60,
        stamina: 60,
        strength: 60,
        agility: 60,
        passing: 60,
        shooting: 60,
        tackling: 60,
        dribbling: 60,
        defending: 60,
        positioning: 60,
        vision: 60,
        decisions: 60,
        composure: 60,
        aggression: 60,
        teamwork: 60,
        leadership: 60,
        handling: 30,
        reflexes: 30,
        aerial: 60,
        long_passing: 0,
        crossing: 0,
        curve: 0,
        free_kick: 0,
        long_shots: 0,
        first_touch: 0,
        heading: 0,
    }
}

fn player(id: &str, team: &str) -> Player {
    let mut player = Player::new(
        id.to_string(),
        format!("{id}. Test"),
        format!("{id} Test"),
        "2000-01-01".to_string(),
        "England".to_string(),
        Position::Forward,
        attributes(),
    );
    player.team_id = Some(team.to_string());
    player.stage_contract_end(Some("2029-06-30".to_string()));
    player.market_value = 1_000_000;
    player.morale = 70;
    player
}

fn team(id: &str, name: &str, money: i64) -> Team {
    let mut team = Team::new(
        id.to_string(),
        name.to_string(),
        name[..3].to_string(),
        "England".to_string(),
        "Testville".to_string(),
        format!("{name} Ground"),
        25_000,
    );
    team.reputation = 600;
    team.finance = money;
    team.transfer_budget = money;
    team.wage_budget = 2_000_000;
    team
}

/// The user (team-1) and a seller (team-2) holding `target`, with squad depth
/// for both so one departure never trips the squad floor, the window open with
/// a month to run.
fn game_with(target: Player, user_money: i64) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "manager-1".to_string(),
        "Jane".to_string(),
        "Doe".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team-1".to_string());
    let mut players = vec![target];
    for club in ["team-1", "team-2"] {
        for index in 0..24 {
            let mut depth = player(&format!("{club}-depth-{index}"), club);
            depth.market_value = 0;
            depth.stage_wage(0);
            players.push(depth);
        }
    }
    let mut game = Game::new(
        clock,
        manager,
        vec![
            team("team-1", "Alpha FC", user_money),
            team("team-2", "Beta FC", 50_000_000),
        ],
        players,
        vec![],
        vec![],
    );
    let window = &mut game.season_context.transfer_window;
    window.status = TransferWindowStatus::Open;
    window.closes_on = Some("2026-08-31".to_string());
    game
}

fn today(game: &Game) -> NaiveDate {
    game.clock.current_date.date_naive()
}

fn advance_to(game: &mut Game, date: &str) {
    let date = NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
    while today(game) < date {
        game.clock.current_date += Duration::days(1);
    }
}

fn club_of(game: &Game, player_id: &str) -> Option<String> {
    game.players
        .iter()
        .find(|player| player.id == player_id)
        .and_then(|player| player.team_id.clone())
}

fn bid(fee: u64) -> UserProposal {
    UserProposal::TransferBid {
        player_id: "target".to_string(),
        fee,
    }
}

/// Given an open window with weeks to run, when the user bids, then nothing is
/// decided yet: the bid waits one to three days for the selling club's answer.
#[test]
fn a_bid_waits_one_to_three_days_for_an_answer() {
    let mut game = game_with(player("target", "team-2"), 20_000_000);

    let submission = submit_proposal(&mut game, bid(10_000_000)).expect("a valid bid is sent");

    let Submission::Awaiting { reply_on } = submission else {
        panic!("the bid should wait for an answer, got {submission:?}");
    };
    let reply_on = NaiveDate::parse_from_str(&reply_on, "%Y-%m-%d").unwrap();
    let days = (reply_on - today(&game)).num_days();
    assert!((1..=3).contains(&days), "replied after {days} days");
    assert_eq!(club_of(&game, "target").as_deref(), Some("team-2"));
    assert_eq!(game.awaited_replies.len(), 1);
}

/// Given a generous bid waiting for its answer, when the reply day comes, then
/// the selling club accepts, the player moves, and the answer arrives by mail.
#[test]
fn the_answer_comes_by_mail_on_the_reply_day() {
    let mut game = game_with(player("target", "team-2"), 20_000_000);
    let Submission::Awaiting { reply_on } = submit_proposal(&mut game, bid(10_000_000)).unwrap()
    else {
        panic!("the bid should wait for an answer");
    };

    deliver_due_replies(&mut game);
    assert_eq!(club_of(&game, "target").as_deref(), Some("team-2"));

    advance_to(&mut game, &reply_on);
    deliver_due_replies(&mut game);

    assert_eq!(club_of(&game, "target").as_deref(), Some("team-1"));
    assert!(game.awaited_replies.is_empty());
    assert!(game.messages.iter().any(|message| {
        message.subject_key.as_deref() == Some("be.msg.offerReply.accepted.subject")
    }));
}

/// Given a bid waiting for its answer, when the user bids again for the same
/// player, then the second bid is refused until the first is answered.
#[test]
fn a_second_offer_waits_for_the_first_answer() {
    let mut game = game_with(player("target", "team-2"), 20_000_000);
    submit_proposal(&mut game, bid(10_000_000)).unwrap();

    let second = submit_proposal(&mut game, bid(12_000_000));

    assert_eq!(second.unwrap_err(), ERR_AWAITING_REPLY);
    assert_eq!(game.awaited_replies.len(), 1);
}

/// Given the last two days of the window, when the user bids, then the club
/// answers the same day, as on deadline day: the caller settles it at once.
#[test]
fn deadline_bids_are_answered_at_once() {
    let mut game = game_with(player("target", "team-2"), 20_000_000);
    advance_to(&mut game, "2026-08-30");

    let submission = submit_proposal(&mut game, bid(10_000_000)).unwrap();

    assert_eq!(submission, Submission::Now);
    assert!(game.awaited_replies.is_empty());
}

/// Given a bid the user cannot pay, when it is sent, then it is refused at
/// once as before, and nothing waits for an answer.
#[test]
fn an_offer_that_cannot_stand_is_refused_when_sent() {
    let mut game = game_with(player("target", "team-2"), 1_000);

    let result = submit_proposal(&mut game, bid(10_000_000));

    assert!(result.is_err());
    assert!(game.awaited_replies.is_empty());
}

/// Given a bid waiting for its answer, when the player joins another club in
/// the meantime, then the reply says the offer has lapsed.
#[test]
fn an_offer_overtaken_by_events_lapses() {
    let mut game = game_with(player("target", "team-2"), 20_000_000);
    let Submission::Awaiting { reply_on } = submit_proposal(&mut game, bid(10_000_000)).unwrap()
    else {
        panic!("the bid should wait for an answer");
    };
    game.players
        .iter_mut()
        .find(|player| player.id == "target")
        .unwrap()
        .team_id = None;

    advance_to(&mut game, &reply_on);
    deliver_due_replies(&mut game);

    assert!(game.awaited_replies.is_empty());
    assert!(game.messages.iter().any(|message| {
        message.subject_key.as_deref() == Some("be.msg.offerReply.lapsed.subject")
    }));
}
