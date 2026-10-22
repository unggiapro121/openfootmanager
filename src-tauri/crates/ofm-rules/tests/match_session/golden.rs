//! Golden matches played through the session, the way the game and the online server play every
//! match since phase 3 (E3-3): each side's AI on its own stream, a manager's orders landing after
//! fixed steps. The engine's own golden tables (`engine/tests/golden_tests.rs`) drive the bare
//! engine; these pin what the session adds on top.
//!
//! When a change is meant to move these results, the failure prints the regenerated table: paste
//! it below, bump the engine version and the pin, and say in the commit why the matches moved.

use engine::{
    DefensiveLine, ENGINE_VERSION, MatchCommand, MatchPhase, PlayStyle, PlayerRole,
    PressingIntensity, Side, TacticalDial, Tempo,
};
use ofm_rules::match_session::{Controller, InputSource, MatchSession, MatchSetup};

use crate::support::{MAX_STEPS, setup};

#[derive(Clone, Copy)]
enum When {
    AfterStep(u32),
    HalfTime,
}

/// A home manager's order, and the moment it lands.
type Order = (When, fn() -> MatchCommand);

/// A home manager's orders at fixed moments; `None` leaves both sides to the AI.
struct Fixture {
    name: &'static str,
    number: u64,
    home: (u8, PlayStyle, &'static str),
    away: (u8, PlayStyle, &'static str),
    knockout: bool,
    script: Option<&'static [Order]>,
}

fn dial(dial: TacticalDial) -> MatchCommand {
    MatchCommand::ChangeTacticalDial {
        side: Side::Home,
        dial,
    }
}

fn sub(off: &str, on: &str) -> MatchCommand {
    MatchCommand::Substitute {
        side: Side::Home,
        player_off_id: off.into(),
        player_on_id: on.into(),
    }
}

fn formation(shape: &str) -> MatchCommand {
    MatchCommand::ChangeFormation {
        side: Side::Home,
        formation: shape.into(),
    }
}

fn style(play_style: PlayStyle) -> MatchCommand {
    MatchCommand::ChangePlayStyle {
        side: Side::Home,
        play_style,
    }
}

const FIXTURES: [Fixture; 10] = [
    Fixture {
        name: "session_dial_then_sub",
        number: 201,
        home: (70, PlayStyle::Balanced, "4-4-2"),
        away: (70, PlayStyle::Balanced, "4-4-2"),
        knockout: false,
        script: Some(&[
            (When::AfterStep(30), || {
                dial(TacticalDial::PressingIntensity(
                    PressingIntensity::Aggressive,
                ))
            }),
            (When::AfterStep(60), || sub("h10", "hs5")),
        ]),
    },
    Fixture {
        name: "session_formation_change",
        number: 202,
        home: (72, PlayStyle::Possession, "4-2-3-1"),
        away: (74, PlayStyle::Counter, "4-4-2"),
        knockout: false,
        script: Some(&[
            (When::AfterStep(55), || formation("4-3-3")),
            (When::AfterStep(70), || sub("h07", "hs3")),
        ]),
    },
    Fixture {
        name: "session_half_time_style",
        number: 203,
        home: (68, PlayStyle::Defensive, "5-3-2"),
        away: (75, PlayStyle::Attacking, "4-3-3"),
        knockout: false,
        script: Some(&[
            (When::HalfTime, || style(PlayStyle::Attacking)),
            (When::AfterStep(65), || {
                dial(TacticalDial::DefensiveLine(DefensiveLine::High))
            }),
        ]),
    },
    Fixture {
        name: "session_swap_and_role",
        number: 204,
        home: (71, PlayStyle::Balanced, "4-3-3"),
        away: (71, PlayStyle::Balanced, "4-3-3"),
        knockout: false,
        script: Some(&[
            (When::AfterStep(20), || MatchCommand::SwapPositions {
                side: Side::Home,
                player_a_id: "h02".into(),
                player_b_id: "h03".into(),
            }),
            (When::AfterStep(25), || MatchCommand::ChangePlayerRole {
                side: Side::Home,
                player_id: "h05".into(),
                role: PlayerRole::BoxToBox,
            }),
        ]),
    },
    Fixture {
        name: "session_three_subs",
        number: 205,
        home: (69, PlayStyle::HighPress, "4-3-3"),
        away: (70, PlayStyle::Possession, "4-2-3-1"),
        knockout: false,
        script: Some(&[
            (When::AfterStep(58), || sub("h09", "hs5")),
            (When::AfterStep(58), || sub("h06", "hs3")),
            (When::AfterStep(75), || sub("h02", "hs1")),
        ]),
    },
    Fixture {
        name: "session_chasing",
        number: 206,
        home: (66, PlayStyle::Balanced, "4-4-2"),
        away: (78, PlayStyle::Balanced, "4-4-2"),
        knockout: false,
        script: Some(&[
            (When::HalfTime, || formation("4-3-3")),
            (When::AfterStep(70), || style(PlayStyle::Attacking)),
            (When::AfterStep(80), || {
                dial(TacticalDial::Tempo(Tempo::Patient))
            }),
        ]),
    },
    Fixture {
        name: "session_ai_even",
        number: 207,
        home: (70, PlayStyle::Balanced, "4-4-2"),
        away: (70, PlayStyle::Balanced, "4-4-2"),
        knockout: false,
        script: None,
    },
    Fixture {
        name: "session_ai_gap",
        number: 208,
        home: (78, PlayStyle::Possession, "4-2-3-1"),
        away: (64, PlayStyle::Counter, "5-3-2"),
        knockout: false,
        script: None,
    },
    Fixture {
        name: "session_ai_wing_backs",
        number: 209,
        home: (72, PlayStyle::HighPress, "3-4-2-1"),
        away: (72, PlayStyle::Attacking, "4-1-4-1"),
        knockout: false,
        script: None,
    },
    Fixture {
        name: "session_ai_knockout",
        // A draw after extra time: the shootout is on the path.
        number: 211,
        home: (71, PlayStyle::Balanced, "4-3-3"),
        away: (71, PlayStyle::Balanced, "4-3-3"),
        knockout: true,
        script: None,
    },
];

/// (fixture name, home goals, away goals, minute hash after the last step), in `FIXTURES` order.
const GOLDEN_SESSION: [(&str, u8, u8, u64); 10] = [
    ("session_dial_then_sub", 2, 1, 0x7B19893C5EAAAE31),
    ("session_formation_change", 2, 0, 0x3230BCFE6415E2E8),
    ("session_half_time_style", 2, 0, 0x0EA61EA18AC96F00),
    ("session_swap_and_role", 1, 0, 0x54B33550B8B3DBEF),
    ("session_three_subs", 1, 0, 0xCF3CE3EEBF47A224),
    ("session_chasing", 1, 3, 0xEC5B280040C47B26),
    ("session_ai_even", 1, 1, 0xDCA8C8771BFDEC71),
    ("session_ai_gap", 0, 0, 0x39BFDE2E70B604CC),
    ("session_ai_wing_backs", 1, 3, 0x33DF714DCFDA770D),
    ("session_ai_knockout", 1, 1, 0x31AD353D4F91B85E),
];

/// The engine version `GOLDEN_SESSION` was pinned under, with a digest of the table. A change
/// that moves a session golden match is a new engine version (online-match-engine-formulas.md
/// §5.3): bump `version` in `crates/engine/Cargo.toml` and set this pair to what the test prints.
const SESSION_VERSION_PIN: (&str, u64) = ("0.4.0", 0xD5589DCF8DCA7EC4);

fn setup_of(fixture: &Fixture) -> MatchSetup {
    let mut setup = setup(fixture.number, fixture.home, fixture.away);
    setup.allows_extra_time = fixture.knockout;
    setup
}

/// A played golden fixture: its session, and what each scripted order returned.
struct Played {
    session: MatchSession,
    outcomes: Vec<Result<(), String>>,
}

fn play(fixture: &Fixture) -> Played {
    let home = if fixture.script.is_some() {
        Controller::Manager
    } else {
        Controller::Ai
    };
    let mut session = MatchSession::new(setup_of(fixture), home, Controller::Ai);
    let mut outcomes = Vec::new();
    let mut half_time_seen = false;
    for _ in 0..MAX_STEPS {
        if session.is_finished() {
            break;
        }
        let step = session.step();
        let at_half_time = !half_time_seen && step.result.phase == MatchPhase::HalfTime;
        half_time_seen |= at_half_time;
        for (when, order) in fixture.script.unwrap_or(&[]) {
            let due = match when {
                When::AfterStep(n) => *n == step.step_seq,
                When::HalfTime => at_half_time,
            };
            if due {
                outcomes.push(session.command(Side::Home, InputSource::Manager, order()));
            }
        }
    }
    assert!(session.is_finished(), "{} did not finish", fixture.name);
    Played { session, outcomes }
}

fn row(fixture: &Fixture) -> (&'static str, u8, u8, u64) {
    let played = play(fixture);
    let (home, away) = played.session.state().score();
    (fixture.name, home, away, played.session.last_hash())
}

fn fnv1a(hash: u64, bytes: &[u8]) -> u64 {
    bytes.iter().fold(hash, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01B3)
    })
}

fn digest(table: &[(&str, u8, u8, u64)]) -> u64 {
    table
        .iter()
        .fold(0xCBF2_9CE4_8422_2325, |h, (name, home, away, hash)| {
            fnv1a(h, format!("{name}|{home}|{away}|{hash:016X}\n").as_bytes())
        })
}

fn regenerated(actual: &[(&str, u8, u8, u64)]) -> String {
    let rows: String = actual
        .iter()
        .map(|(name, home, away, hash)| {
            format!("    (\"{name}\", {home}, {away}, 0x{hash:016X}),\n")
        })
        .collect();
    format!(
        "const GOLDEN_SESSION: [(&str, u8, u8, u64); {}] = [\n{rows}];",
        actual.len()
    )
}

/// Given the ten session golden fixtures,
/// when each is played through the session,
/// then its score and final minute hash match the pinned table.
#[test]
fn session_golden_fixtures_play_exactly_as_pinned() {
    let actual: Vec<_> = FIXTURES.iter().map(row).collect();
    assert_eq!(
        actual,
        GOLDEN_SESSION,
        "a session golden match moved. If on purpose, paste:\n{}",
        regenerated(&actual)
    );
}

/// Given the scripted session fixtures,
/// when they are played,
/// then every scripted order is taken by the shared check and the engine.
#[test]
fn every_scripted_session_order_lands() {
    for fixture in FIXTURES.iter().filter(|fixture| fixture.script.is_some()) {
        let played = play(fixture);
        let expected = fixture.script.map_or(0, <[_]>::len);
        assert_eq!(played.outcomes.len(), expected, "{}", fixture.name);
        for outcome in &played.outcomes {
            assert_eq!(outcome, &Ok(()), "{}", fixture.name);
        }
    }
}

/// Given the session golden table,
/// when it is read beside the fixtures and the engine version,
/// then it lists every fixture in order, and the pinned version and digest are the current ones.
#[test]
fn engine_version_moves_with_the_session_golden_table() {
    let names: Vec<&str> = FIXTURES.iter().map(|fixture| fixture.name).collect();
    let pinned: Vec<&str> = GOLDEN_SESSION.iter().map(|row| row.0).collect();
    assert_eq!(names, pinned);
    let actual = (ENGINE_VERSION, digest(&GOLDEN_SESSION));
    assert_eq!(
        actual, SESSION_VERSION_PIN,
        "the session golden table or the engine version changed. If a match moved on purpose, \
         bump `version` in crates/engine/Cargo.toml, then set SESSION_VERSION_PIN to \
         (\"<new version>\", 0x{:016X}).",
        actual.1
    );
}
