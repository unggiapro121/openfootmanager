//! The captain and set-piece takers a match kicks off with (the online setup's match roles): set
//! from the setup before anything is logged, so a replay of the same setup starts from them too.

use engine::SetPieceTakers;
use ofm_rules::match_session::{Controller, MatchSession, MatchSetup, verify};

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
