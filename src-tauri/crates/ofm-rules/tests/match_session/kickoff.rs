//! The captain and set-piece takers a match kicks off with (the online setup's match roles): set
//! from the setup before anything is logged, so a replay of the same setup starts from them too.

use engine::{MatchCommand, Position, SetPieceTakers, Side};
use ofm_rules::match_session::{Controller, InputSource, MatchSession, MatchSetup, verify};

use crate::support::{MAX_STEPS, even_setup};

/// The home side's takers: four of its starters, one duty each.
fn home_takers(setup: &MatchSetup) -> SetPieceTakers {
    let id = |slot: usize| Some(setup.home.players[slot].id.clone());
    SetPieceTakers {
        captain: id(4),
        penalty_taker: id(9),
        free_kick_taker: id(7),
        corner_taker: id(6),
    }
}

/// The match of `setup` played to the end by the AI, and the minute hash of each step.
fn played(setup: MatchSetup) -> (MatchSession, Vec<(u32, u64)>) {
    let mut session = MatchSession::new(setup, Controller::Ai, Controller::Ai);
    let mut hashes = Vec::new();
    while !session.is_finished() && hashes.len() < MAX_STEPS {
        let step = session.step();
        hashes.push((step.step_seq, step.minute_hash));
    }
    (session, hashes)
}

/// Given a setup naming the home side's captain and takers,
/// when the match kicks off,
/// then it holds them before the first step, the away side keeps the engine's own choice, and
/// nothing is logged for them.
#[test]
fn a_match_kicks_off_with_the_takers_of_its_setup() {
    let mut setup = even_setup(41);
    let takers = home_takers(&setup);
    setup.set_pieces_home = Some(takers.clone());

    let session = MatchSession::new(setup, Controller::Ai, Controller::Ai);

    let snapshot = session.snapshot();
    assert_eq!(snapshot.home_set_pieces.captain, takers.captain);
    assert_eq!(snapshot.home_set_pieces.penalty_taker, takers.penalty_taker);
    assert_eq!(
        snapshot.home_set_pieces.free_kick_taker,
        takers.free_kick_taker
    );
    assert_eq!(snapshot.home_set_pieces.corner_taker, takers.corner_taker);
    assert_eq!(snapshot.away_set_pieces.captain, None);
    assert!(
        session.log().is_empty(),
        "the setup's takers are not inputs"
    );
}

/// Given a match played to the end from a setup with takers,
/// when it is replayed from that setup and its log,
/// then every minute hash matches.
#[test]
fn a_match_with_takers_replays_hash_for_hash() {
    let mut setup = even_setup(42);
    setup.set_pieces_home = Some(home_takers(&setup));

    let (session, hashes) = played(setup.clone());

    let report = verify(setup, session.log(), &hashes);
    assert!(report.is_ok(), "{report:?}");
}

/// Given a setup with no takers, as every match stored before them,
/// when it is written,
/// then it carries no takers key, so it reads and hashes as it did.
#[test]
fn a_setup_without_takers_is_written_as_before() {
    let setup = even_setup(43);

    let json = serde_json::to_value(&setup).expect("a setup writes");

    assert!(json.get("set_pieces_home").is_none());
    assert!(json.get("set_pieces_away").is_none());
}

/// The home side's captain and every set piece on one starter, slot 9, as the engine's own pick
/// may leave them, with duties passing on when he leaves.
fn one_man_duties(number: u64) -> (MatchSetup, String) {
    let mut setup = even_setup(number);
    let holder = setup.home.players[9].id.clone();
    setup.set_pieces_home = Some(SetPieceTakers {
        captain: Some(holder.clone()),
        penalty_taker: Some(holder.clone()),
        free_kick_taker: Some(holder.clone()),
        corner_taker: Some(holder.clone()),
    });
    setup.duties_move_on = true;
    (setup, holder)
}

/// Every duty of `takers`, each one named.
fn duties(takers: &SetPieceTakers) -> [Option<String>; 4] {
    [
        takers.captain.clone(),
        takers.penalty_taker.clone(),
        takers.free_kick_taker.clone(),
        takers.corner_taker.clone(),
    ]
}

/// The home side's holder of every duty replaced by its first substitute.
fn substitute_holder(session: &mut MatchSession, holder: &str) {
    let player_on_id = session.snapshot().home_bench[0].id.clone();
    session
        .command(
            Side::Home,
            InputSource::Manager,
            MatchCommand::Substitute {
                side: Side::Home,
                player_off_id: holder.to_string(),
                player_on_id,
            },
        )
        .expect("the substitution is taken");
}

/// Given a side whose captain and set-piece taker is one man, with duties passing on,
/// when he is substituted,
/// then every duty passes to a player still on the pitch, the keeper taking no set piece.
#[test]
fn duties_pass_on_when_their_holder_is_substituted() {
    let (setup, holder) = one_man_duties(44);
    let mut session = MatchSession::new(setup, Controller::Manager, Controller::Ai);
    session.step();

    substitute_holder(&mut session, &holder);

    let snapshot = session.snapshot();
    let on_pitch: Vec<&str> = snapshot
        .home_team
        .players
        .iter()
        .map(|p| p.id.as_str())
        .collect();
    let keeper = snapshot
        .home_team
        .players
        .iter()
        .find(|p| p.position == Position::Goalkeeper)
        .map(|p| p.id.clone())
        .expect("a keeper");
    for duty in duties(&snapshot.home_set_pieces) {
        let duty = duty.expect("every duty is held");
        assert_ne!(duty, holder);
        assert!(on_pitch.contains(&duty.as_str()), "{duty} is on the pitch");
    }
    for kick in [
        &snapshot.home_set_pieces.penalty_taker,
        &snapshot.home_set_pieces.free_kick_taker,
        &snapshot.home_set_pieces.corner_taker,
    ] {
        assert_ne!(
            kick.as_deref(),
            Some(keeper.as_str()),
            "the keeper takes no set piece"
        );
    }
}

/// Given the same side without duties passing on, as every match stored before it,
/// when its holder is substituted,
/// then every duty stays his, as the engine played it.
#[test]
fn without_the_switch_duties_stay_with_a_substituted_holder() {
    let (mut setup, holder) = one_man_duties(45);
    setup.duties_move_on = false;
    let mut session = MatchSession::new(setup, Controller::Manager, Controller::Ai);
    session.step();

    substitute_holder(&mut session, &holder);

    for duty in duties(&session.snapshot().home_set_pieces) {
        assert_eq!(duty.as_deref(), Some(holder.as_str()));
    }
}

/// Given a side with duties passing on,
/// when the match is played to the end,
/// then after every step each duty is held by a player of the eleven still playing.
#[test]
fn duties_stay_with_players_still_playing_all_match() {
    let (setup, _) = one_man_duties(46);
    let mut session = MatchSession::new(setup, Controller::Ai, Controller::Ai);
    while !session.is_finished() {
        session.step();
        let snapshot = session.snapshot();
        for duty in duties(&snapshot.home_set_pieces).into_iter().flatten() {
            assert!(
                snapshot.home_team.players.iter().any(|p| p.id == duty)
                    && !session.state().is_sent_off(&duty)
                    && !session.state().injured_on_pitch(Side::Home).contains(&duty),
                "{duty} still plays at minute {}",
                snapshot.current_minute
            );
        }
    }
}

/// Given a match with duties passing on and a substitution of their holder,
/// when it is replayed from its setup and log,
/// then every minute hash matches.
#[test]
fn a_match_whose_duties_pass_on_replays_hash_for_hash() {
    let (setup, holder) = one_man_duties(47);
    let mut session = MatchSession::new(setup.clone(), Controller::Manager, Controller::Ai);
    let mut hashes = Vec::new();
    let step = session.step();
    hashes.push((step.step_seq, step.minute_hash));
    substitute_holder(&mut session, &holder);
    while !session.is_finished() && hashes.len() < MAX_STEPS {
        let step = session.step();
        hashes.push((step.step_seq, step.minute_hash));
    }

    let report = verify(setup, session.log(), &hashes);
    assert!(report.is_ok(), "{report:?}");
}

/// Given a setup without duties passing on, as every match stored before it,
/// when it is written,
/// then it carries no such key, so it reads and hashes as it did.
#[test]
fn a_setup_without_duties_moving_on_is_written_as_before() {
    let json = serde_json::to_value(even_setup(48)).expect("a setup writes");

    assert!(json.get("duties_move_on").is_none());
}
