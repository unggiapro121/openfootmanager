use engine::{LiveMatchState, MatchCommand, PlayStyle, Side, TacticalDial, Tempo};
use ofm_rules::match_session::{
    Controller, InputRecord, InputSource, KICK_OFF_HASH, MatchInput, MatchSession, StepRecord,
};

use crate::support::{MAX_STEPS, even_setup};

/// Step `session` to the end, returning every step.
fn play_out(session: &mut MatchSession) -> Vec<StepRecord> {
    let mut steps = Vec::new();
    for _ in 0..MAX_STEPS {
        if session.is_finished() {
            break;
        }
        steps.push(session.step());
    }
    assert!(session.is_finished(), "the match did not finish");
    steps
}

fn ai_commands(log: &[InputRecord]) -> Vec<&InputRecord> {
    log.iter()
        .filter(|record| record.source == InputSource::Ai)
        .collect()
}

/// Given a match with both sides held by managers who give no command,
/// when it is played through the session and, separately, by the bare engine on the seed's
/// engine generator,
/// then the two are the same match: the session adds nothing of its own to the engine's draws.
#[test]
fn a_session_without_commands_is_the_bare_engine_on_the_engine_stream() {
    let setup = even_setup(11);
    let mut session = MatchSession::new(setup.clone(), Controller::Manager, Controller::Manager);
    let steps = play_out(&mut session);

    let mut bare = LiveMatchState::new(
        setup.home,
        setup.away,
        setup.config,
        setup.home_bench,
        setup.away_bench,
        setup.allows_extra_time,
    );
    let mut rng = setup.seed.engine_rng();
    for step in &steps {
        let result = bare.step_minute(&mut rng);
        assert_eq!(
            format!("{:?}", result.events),
            format!("{:?}", step.result.events),
            "step {}",
            step.step_seq
        );
    }
    assert!(bare.is_finished());
}

/// Given the same match held by the AI on both sides, and by idle managers on both,
/// when both are played,
/// then every step's events up to and including the first one the AI acted after are identical: the AI
/// draws from its own streams and only its commands, never its dice, change the match.
#[test]
fn the_ai_never_moves_the_engine_until_it_acts() {
    let mut with_ai = MatchSession::new(even_setup(12), Controller::Ai, Controller::Ai);
    let ai_steps = play_out(&mut with_ai);
    let first_ai_step = ai_commands(with_ai.log())
        .first()
        .map(|record| record.step_seq)
        .expect("the AI acted at least once in a full match");

    let mut idle = MatchSession::new(even_setup(12), Controller::Manager, Controller::Manager);
    let idle_steps = play_out(&mut idle);

    for (ai, quiet) in ai_steps.iter().zip(&idle_steps) {
        if ai.step_seq > first_ai_step {
            break;
        }
        // The hashes differ from step 1, since only one log holds the opening handovers; what
        // the engine did must not.
        assert_eq!(
            format!("{:?}", ai.result.events),
            format!("{:?}", quiet.result.events),
            "step {}",
            ai.step_seq
        );
    }
}

/// Given one setup,
/// when it is played twice through the session with the AI on both sides,
/// then the logs, every minute hash and the final report are the same.
#[test]
fn a_session_plays_the_same_match_every_time() {
    let mut first = MatchSession::new(even_setup(13), Controller::Ai, Controller::Ai);
    let mut second = MatchSession::new(even_setup(13), Controller::Ai, Controller::Ai);
    let first_steps = play_out(&mut first);
    let second_steps = play_out(&mut second);

    assert_eq!(first.log(), second.log());
    let hashes = |steps: &[StepRecord]| steps.iter().map(|s| s.minute_hash).collect::<Vec<_>>();
    assert_eq!(hashes(&first_steps), hashes(&second_steps));
    assert_eq!(
        format!("{:?}", first.into_report().events),
        format!("{:?}", second.into_report().events)
    );
}

/// Given a match with the AI on both sides,
/// when it is played,
/// then each AI command is logged with its side, the step it came after, and its place in the
/// gap from 0, and every logged step is a step that was taken.
#[test]
fn the_ai_logs_every_command_it_gives() {
    let mut session = MatchSession::new(even_setup(14), Controller::Ai, Controller::Ai);
    let steps = play_out(&mut session);
    let last_step = steps.last().map(|s| s.step_seq).unwrap_or(0);

    let ai = ai_commands(session.log());
    assert!(!ai.is_empty());
    for record in &ai {
        assert!(record.step_seq >= 1 && record.step_seq <= last_step);
        let MatchInput::Command(command) = &record.input else {
            panic!("the AI only gives commands");
        };
        assert_eq!(command.side(), record.side);
    }
    for pair in session.log().windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        if a.step_seq == b.step_seq {
            assert_eq!(b.order_in_gap, a.order_in_gap + 1);
        } else {
            assert!(b.step_seq > a.step_seq);
            assert_eq!(b.order_in_gap, 0);
        }
    }
}

/// Given a home side held by a manager and an away side by the AI,
/// when the match starts, the manager changes the tempo after the first step, and the home side
/// is handed to the AI and back,
/// then the log holds the opening handover at step 0, the command after step 1 with the source
/// Manager, and both handovers; handing a side to whoever holds it logs nothing.
#[test]
fn commands_and_handovers_are_logged_where_they_happen() {
    let mut session = MatchSession::new(even_setup(15), Controller::Manager, Controller::Ai);
    session.set_controller(Side::Away, Controller::Ai);
    session.step();
    let tempo = MatchCommand::ChangeTacticalDial {
        side: Side::Home,
        dial: TacticalDial::Tempo(Tempo::Direct),
    };
    session
        .command(Side::Home, InputSource::Manager, tempo.clone())
        .expect("a manager may turn his own dial");
    session.set_controller(Side::Home, Controller::Ai);
    session.set_controller(Side::Home, Controller::Manager);

    let log = session.log();
    assert_eq!(log.len(), 4);
    assert_eq!(
        (log[0].step_seq, log[0].source, &log[0].input),
        (
            0,
            InputSource::System,
            &MatchInput::ControlHandover(Controller::Manager)
        )
    );
    assert_eq!(
        (log[1].step_seq, log[1].source, &log[1].input),
        (1, InputSource::Manager, &MatchInput::Command(tempo))
    );
    assert_eq!(log[2].input, MatchInput::ControlHandover(Controller::Ai));
    assert_eq!(
        log[3].input,
        MatchInput::ControlHandover(Controller::Manager)
    );
    assert_eq!(session.controller(Side::Home), Controller::Manager);
}

/// Given two copies of a match,
/// when one manager changes his style after step 10 and the other does not,
/// then the minute hashes agree up to step 10 and differ from step 11: the hash chain catches a
/// difference at the first step it shows.
#[test]
fn the_minute_hash_chain_parts_at_the_first_different_step() {
    let mut plain = MatchSession::new(even_setup(16), Controller::Manager, Controller::Manager);
    let mut changed = MatchSession::new(even_setup(16), Controller::Manager, Controller::Manager);
    assert_eq!(plain.last_hash(), KICK_OFF_HASH);
    let mut plain_hashes = Vec::new();
    let mut changed_hashes = Vec::new();
    for step in 1..=20 {
        plain_hashes.push(plain.step().minute_hash);
        changed_hashes.push(changed.step().minute_hash);
        if step == 10 {
            changed
                .command(
                    Side::Home,
                    InputSource::Manager,
                    MatchCommand::ChangePlayStyle {
                        side: Side::Home,
                        play_style: PlayStyle::Attacking,
                    },
                )
                .expect("a style change is always allowed");
        }
    }
    assert_eq!(plain_hashes[..10], changed_hashes[..10]);
    for (plain, changed) in plain_hashes[10..].iter().zip(&changed_hashes[10..]) {
        assert_ne!(plain, changed);
    }
}

/// Given a command the check refuses,
/// when the session is given it,
/// then it is refused with the check's key, and neither the match nor the log changes.
#[test]
fn a_refused_command_changes_nothing() {
    let mut session = MatchSession::new(even_setup(17), Controller::Manager, Controller::Ai);
    session.step();
    let before = session.log().len();
    let refused = session.command(
        Side::Home,
        InputSource::Manager,
        MatchCommand::ChangeFormation {
            side: Side::Home,
            formation: "2-3-5".into(),
        },
    );
    assert_eq!(
        refused,
        Err(ofm_rules::match_session::UNKNOWN_FORMATION.to_string())
    );
    assert_eq!(session.log().len(), before);
    assert_eq!(session.state().team(Side::Home).formation, "4-4-2");
}
