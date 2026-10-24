//! A match between licensed sides (phase 3, S-9): what a side's licence closes is refused to its
//! manager and never given by the AI holding it, and the match replays as it was played.

use engine::ai::{AiPersonality, AiProfile};
use engine::{MatchCommand, PlayStyle, Side};
use ofm_rules::licence::{LicenceControls, controls};
use ofm_rules::match_session::{
    Controller, InputSource, LOCKED_BY_LICENCE, MatchInput, MatchSession, MatchSetup, verify,
};

use crate::support::{MAX_STEPS, even_setup, setup};

fn first_licence_both_sides(mut setup: MatchSetup) -> MatchSetup {
    setup.licence_home = Some(controls(1));
    setup.licence_away = Some(controls(1));
    setup
}

/// Given a match whose home side holds the first licence and whose away side holds none,
/// when both managers order a 4-2-3-1 and the home manager then orders a 4-3-3,
/// then the home 4-2-3-1 is refused and not logged, and the other two are taken.
#[test]
fn an_order_the_licence_does_not_open_is_refused_and_not_logged() {
    let mut licensed = even_setup(31);
    licensed.licence_home = Some(controls(1));
    let mut session = MatchSession::new(licensed, Controller::Manager, Controller::Manager);
    for _ in 0..5 {
        session.step();
    }
    let logged = session.log().len();
    let bolder = |side| MatchCommand::ChangeFormation {
        side,
        formation: "4-2-3-1".into(),
    };
    assert_eq!(
        session.command(Side::Home, InputSource::Manager, bolder(Side::Home)),
        Err(LOCKED_BY_LICENCE.to_string())
    );
    assert_eq!(session.log().len(), logged);
    assert_eq!(
        session.command(Side::Away, InputSource::Manager, bolder(Side::Away)),
        Ok(())
    );
    let open = MatchCommand::ChangeFormation {
        side: Side::Home,
        formation: "4-3-3".into(),
    };
    assert_eq!(
        session.command(Side::Home, InputSource::Manager, open),
        Ok(())
    );
}

fn profile(number: u64) -> AiProfile {
    let personality = match number % 3 {
        0 => AiPersonality::Visionary,
        1 => AiPersonality::Reactive,
        _ => AiPersonality::Pragmatist,
    };
    AiProfile {
        reputation: 600,
        experience: 90,
        personality,
    }
}

/// Given 500 matches between first-licence sides of every temper, both held by the AI,
/// when they are played and replayed,
/// then no order in any log is one the first licence closes, the AI still gave tactical orders,
/// and every match replays hash for hash.
#[test]
fn the_ai_holding_a_licensed_side_never_gives_a_closed_order() {
    let grassroots = controls(1);
    let shapes = ["4-4-2", "4-3-3", "3-5-2"];
    let mut tactical_orders = 0;
    for number in 0..500u64 {
        let mut licensed = first_licence_both_sides(setup(
            number,
            (
                60 + (number % 15) as u8,
                PlayStyle::Balanced,
                shapes[(number % 3) as usize],
            ),
            (68, PlayStyle::Balanced, shapes[((number + 1) % 3) as usize]),
        ));
        licensed.ai_home = profile(number);
        licensed.ai_away = profile(number + 1);
        let mut session = MatchSession::new(licensed.clone(), Controller::Ai, Controller::Ai);
        let mut stored = Vec::new();
        for _ in 0..MAX_STEPS {
            if session.is_finished() {
                break;
            }
            let step = session.step();
            stored.push((step.step_seq, step.minute_hash));
        }
        assert!(session.is_finished(), "match {number} did not finish");
        for record in session.log() {
            if let MatchInput::Command(command) = &record.input {
                assert!(
                    grassroots.allows_command(command),
                    "match {number}: {command:?}"
                );
                if matches!(
                    command,
                    MatchCommand::ChangeFormation { .. }
                        | MatchCommand::ChangePlayStyle { .. }
                        | MatchCommand::ChangeTacticalDial { .. }
                ) {
                    tactical_orders += 1;
                }
            }
        }
        verify(licensed, session.log(), &stored)
            .unwrap_or_else(|error| panic!("match {number} does not replay: {error:?}"));
    }
    assert!(
        tactical_orders > 100,
        "the AI gave {tactical_orders} tactical orders in 500 matches: too few to prove anything"
    );
}

/// Given a setup with no licences, one written before licences existed, and one with both,
/// when they are written and read back,
/// then the first writes no licence field, the second reads with none, and the third keeps both.
#[test]
fn a_setup_without_licences_reads_and_writes_as_before() {
    let plain = even_setup(41);
    let json = serde_json::to_value(&plain).expect("a setup writes");
    assert!(json.get("licence_home").is_none(), "{json}");
    assert!(json.get("licence_away").is_none(), "{json}");
    let read: MatchSetup = serde_json::from_value(json).expect("an old setup reads");
    assert!(read.licence_home.is_none() && read.licence_away.is_none());

    let mut licensed = even_setup(41);
    licensed.licence_home = Some(controls(2));
    licensed.licence_away = Some(LicenceControls::all_open());
    let back: MatchSetup =
        serde_json::from_value(serde_json::to_value(&licensed).expect("writes")).expect("reads");
    assert_eq!(back.licence_home, Some(controls(2)));
    assert_eq!(back.licence_away, Some(LicenceControls::all_open()));
}

/// Given 300 matches in which a Visionary's weaker side starts in a 4-4-2 it may not leave, the
/// AI holding both sides,
/// when they are played,
/// then the Visionary, chasing late, still turns to attacking play: the session hands the AI its
/// licence, so a closed shape is passed over rather than refused every time he looks up.
#[test]
fn the_ai_passes_a_closed_shape_over_for_the_next_order() {
    let mut stuck = LicenceControls::all_open();
    stuck.formations = vec!["4-4-2".to_string()];
    let mut late_attacking = 0;
    for number in 0..300u64 {
        let mut licensed = setup(
            number,
            (62, PlayStyle::Balanced, "4-4-2"),
            (78, PlayStyle::Balanced, "4-4-2"),
        );
        licensed.licence_home = Some(stuck.clone());
        licensed.ai_home = profile(0);
        let mut session = MatchSession::new(licensed, Controller::Ai, Controller::Ai);
        for _ in 0..MAX_STEPS {
            if session.is_finished() {
                break;
            }
            session.step();
        }
        late_attacking += session
            .log()
            .iter()
            .filter(|record| record.side == Side::Home && record.step_seq >= 75)
            .filter(|record| {
                matches!(
                    &record.input,
                    MatchInput::Command(MatchCommand::ChangePlayStyle {
                        play_style: PlayStyle::Attacking,
                        ..
                    })
                )
            })
            .count();
    }
    assert!(
        late_attacking > 0,
        "a chasing Visionary held to a 4-4-2 never turned to attacking play after the 70th minute"
    );
}
