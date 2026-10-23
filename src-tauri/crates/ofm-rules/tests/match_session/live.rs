//! The online match's extra rules (phase 3, S-8 S8-9, S8-7): the injury window for a side a
//! manager holds, and the events the commands of a gap push, which no `MinuteResult` carries.

use engine::{EventType, MatchCommand, Side};
use ofm_rules::match_session::{
    Controller, InputRecord, InputSource, MatchInput, MatchSession, MatchSetup, verify,
};

use crate::support::{MAX_STEPS, even_setup};

const WINDOW: u32 = 3;

fn with_window(number: u64, window: Option<u32>) -> MatchSetup {
    let mut setup = even_setup(number);
    setup.injury_window_steps = window;
    setup
}

/// The first even meeting in which a home player is hurt while a manager holds the home side
/// and gives no orders: its number, the step after which he is first seen hurt, and his id.
fn first_home_injury() -> (u64, u32, String) {
    for number in 0..2_000 {
        let mut session = MatchSession::new(
            with_window(number, None),
            Controller::Manager,
            Controller::Ai,
        );
        for _ in 0..MAX_STEPS {
            if session.is_finished() {
                break;
            }
            let step = session.step();
            if let Some(hurt) = session.state().injured_on_pitch(Side::Home).first() {
                return (number, step.step_seq, hurt.clone());
            }
        }
    }
    panic!("no home injury in 2,000 meetings");
}

/// The AI's commands for the home side, from the log.
fn ai_home_commands(log: &[InputRecord]) -> Vec<&InputRecord> {
    log.iter()
        .filter(|record| record.side == Side::Home && record.source == InputSource::Ai)
        .collect()
}

fn takes_off(record: &InputRecord, player_id: &str) -> bool {
    matches!(
        &record.input,
        MatchInput::Command(MatchCommand::Substitute { player_off_id, .. }) if player_off_id == player_id
    )
}

/// Given a manager's side with a player hurt after step s and a window of 3 steps,
/// when the manager makes no change,
/// then nothing happens after steps s+1 and s+2, and after step s+3 the AI takes exactly that
/// player off, logged as the AI's, once.
#[test]
fn a_manager_who_lets_the_window_run_out_has_the_ai_replace_the_injured() {
    let (number, hurt_after, hurt) = first_home_injury();
    let mut session = MatchSession::new(
        with_window(number, Some(WINDOW)),
        Controller::Manager,
        Controller::Ai,
    );
    while session.step_seq() < hurt_after + WINDOW - 1 {
        session.step();
    }
    assert!(
        ai_home_commands(session.log()).is_empty(),
        "nothing inside the window"
    );
    session.step();
    let replaced = ai_home_commands(session.log());
    assert_eq!(
        replaced.len(),
        1,
        "one replacement when the window runs out"
    );
    assert!(takes_off(replaced[0], &hurt));
    assert_eq!(replaced[0].step_seq, hurt_after + WINDOW);
    assert!(session.state().injured_on_pitch(Side::Home).is_empty());
    assert_eq!(session.controller(Side::Home), Controller::Manager);
}

/// Given the same match without a window (the desktop's setup),
/// when it is played out with no orders,
/// then the AI never acts for the manager's side: the desktop waits for the manager.
#[test]
fn without_a_window_the_ai_never_acts_for_a_manager() {
    let (number, _, _) = first_home_injury();
    let mut session = MatchSession::new(
        with_window(number, None),
        Controller::Manager,
        Controller::Ai,
    );
    for _ in 0..MAX_STEPS {
        if session.is_finished() {
            break;
        }
        session.step();
    }
    assert!(ai_home_commands(session.log()).is_empty());
}

/// Given a manager whose player is hurt after step s,
/// when the manager replaces him after step s+1, inside the window,
/// then the AI makes no replacement for that side afterwards.
#[test]
fn a_manager_who_replaces_in_time_leaves_the_ai_nothing_to_do() {
    let (number, hurt_after, hurt) = first_home_injury();
    let mut session = MatchSession::new(
        with_window(number, Some(WINDOW)),
        Controller::Manager,
        Controller::Ai,
    );
    while session.step_seq() < hurt_after + 1 {
        session.step();
    }
    let substitution = engine::ai::replacement_for_injured(session.state(), Side::Home, &hurt)
        .expect("a bench player for him");
    session
        .command(Side::Home, InputSource::Manager, substitution)
        .expect("the manager's change");
    for _ in 0..(WINDOW + 2) {
        session.step();
    }
    assert!(ai_home_commands(session.log()).is_empty());
}

/// Given a match with a window, played out with the AI's replacement in it,
/// when it is replayed from its setup and log,
/// then every step's hash matches: the AI's replacement is an input like any other.
#[test]
fn a_match_with_a_window_replays_exactly() {
    let (number, _, _) = first_home_injury();
    let setup = with_window(number, Some(WINDOW));
    let mut session = MatchSession::new(setup.clone(), Controller::Manager, Controller::Ai);
    let mut stored = Vec::new();
    for _ in 0..MAX_STEPS {
        if session.is_finished() {
            break;
        }
        let step = session.step();
        stored.push((step.step_seq, step.minute_hash));
    }
    assert!(
        !ai_home_commands(session.log()).is_empty(),
        "the window closed in this match"
    );
    verify(setup, session.log(), &stored).expect("the match replays");
}

/// The golden match with an injury window: the first meeting with a home injury, a manager
/// holding the home side and giving no orders. A change here is a new engine version
/// (online-match-engine-formulas.md §5.3), as for the other golden matches.
const WINDOWED_GOLDEN: (u64, u64) = (5, 0xA1B0_32B5_8480_576D);

/// Given the windowed golden meeting,
/// when it is played,
/// then its number and final minute hash are as pinned.
#[test]
fn the_windowed_golden_match_plays_as_pinned() {
    let (number, _, _) = first_home_injury();
    let mut session = MatchSession::new(
        with_window(number, Some(WINDOW)),
        Controller::Manager,
        Controller::Ai,
    );
    for _ in 0..MAX_STEPS {
        if session.is_finished() {
            break;
        }
        session.step();
    }
    assert_eq!(
        (number, session.last_hash()),
        WINDOWED_GOLDEN,
        "the windowed golden match moved; if on purpose, set WINDOWED_GOLDEN to ({number}, {:#018X})",
        session.last_hash()
    );
}

/// Given a match both managers hold,
/// when a manager makes a substitution in a gap,
/// then the gap's events hold the substitution, and the next step's events do not; after that
/// step the gap starts empty.
#[test]
fn the_events_of_a_gap_are_the_ones_its_commands_pushed() {
    let mut session = MatchSession::new(even_setup(7), Controller::Manager, Controller::Manager);
    while session.step_seq() < 10 {
        session.step();
    }
    assert!(session.gap_events().is_empty());
    let off = session.state().team(Side::Home).players[5].id.clone();
    let on = session.state().bench(Side::Home)[0].id.clone();
    session
        .command(
            Side::Home,
            InputSource::Manager,
            MatchCommand::Substitute {
                side: Side::Home,
                player_off_id: off,
                player_on_id: on,
            },
        )
        .expect("a substitution");
    let gap: Vec<EventType> = session
        .gap_events()
        .iter()
        .map(|event| event.event_type.clone())
        .collect();
    assert_eq!(gap, vec![EventType::Substitution]);
    let step = session.step();
    assert!(
        step.result
            .events
            .iter()
            .all(|event| event.event_type != EventType::Substitution)
    );
    assert!(session.gap_events().is_empty());
}
