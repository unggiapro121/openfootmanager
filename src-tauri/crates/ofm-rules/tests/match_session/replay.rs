//! Replay (E3-4): random matches with random orders, played, logged, replayed and compared hash by
//! hash; and the same matches cut at a random step, replayed to it and played on, against the
//! match that was never cut.

use engine::{
    BreakSpeed, CrossStyle, DefensiveLine, FORMATIONS, MarkingStyle, MatchCommand, PlayStyle,
    PlayerRole, PressingIntensity, Side, TacticalDial, TacticsPitchWidth, Tempo,
};
use ofm_rules::match_session::{
    Controller, InputRecord, InputSource, MatchInput, MatchSession, MatchSetup, ReplayError,
    StepRecord, verify,
};
use rand::{RngExt, SeedableRng};
use rand_chacha::ChaCha12Rng;

use crate::support::{MAX_STEPS, even_setup, setup};

/// One thing a manager or the match does at a fixed step.
#[derive(Debug, Clone)]
enum Order {
    Command(Side, MatchCommand),
    Handover(Side, Controller),
}

/// A random match: its setup, who holds each side at kick-off, and its orders by step.
struct Scenario {
    setup: MatchSetup,
    home: Controller,
    away: Controller,
    orders: Vec<(u32, Order)>,
}

const STYLES: [PlayStyle; 6] = [
    PlayStyle::Balanced,
    PlayStyle::Attacking,
    PlayStyle::Defensive,
    PlayStyle::Possession,
    PlayStyle::Counter,
    PlayStyle::HighPress,
];

const ROLES: [PlayerRole; 8] = [
    PlayerRole::Standard,
    PlayerRole::BoxToBox,
    PlayerRole::Poacher,
    PlayerRole::WingBack,
    PlayerRole::SweeperKeeper,
    PlayerRole::AnchorMan,
    PlayerRole::TargetMan,
    PlayerRole::InvertedFB,
];

fn pick<T: Copy>(rng: &mut ChaCha12Rng, items: &[T]) -> T {
    items[rng.random_range(0..items.len())]
}

fn controller(rng: &mut ChaCha12Rng) -> Controller {
    if rng.random_bool(0.5) {
        Controller::Manager
    } else {
        Controller::Ai
    }
}

fn dial(rng: &mut ChaCha12Rng) -> TacticalDial {
    match rng.random_range(0..7) {
        0 => TacticalDial::PressingIntensity(pick(
            rng,
            &[PressingIntensity::Passive, PressingIntensity::Aggressive],
        )),
        1 => TacticalDial::DefensiveLine(pick(
            rng,
            &[
                DefensiveLine::VeryLow,
                DefensiveLine::Low,
                DefensiveLine::High,
            ],
        )),
        2 => TacticalDial::Width(pick(
            rng,
            &[TacticsPitchWidth::Narrow, TacticsPitchWidth::Wide],
        )),
        3 => TacticalDial::Tempo(pick(rng, &[Tempo::Patient, Tempo::Direct])),
        4 => TacticalDial::MarkingStyle(pick(rng, &[MarkingStyle::ManToMan, MarkingStyle::Zonal])),
        5 => TacticalDial::BreakSpeed(pick(rng, &[BreakSpeed::Fast, BreakSpeed::Slow])),
        _ => TacticalDial::CrossStyle(pick(rng, &[CrossStyle::Low, CrossStyle::High])),
    }
}

/// A random order for `side`: often legal, sometimes not (a bench player as taker, a role that
/// does not fit, a shape the game does not offer, a substitution already made).
fn command(rng: &mut ChaCha12Rng, side: Side) -> MatchCommand {
    let tag = match side {
        Side::Home => "h",
        Side::Away => "a",
    };
    let starter = |rng: &mut ChaCha12Rng| format!("{tag}{:02}", rng.random_range(0..11));
    let bench = |rng: &mut ChaCha12Rng| format!("{tag}s{}", rng.random_range(0..7));
    match rng.random_range(0..8) {
        0 => MatchCommand::Substitute {
            side,
            player_off_id: starter(rng),
            player_on_id: bench(rng),
        },
        1 => MatchCommand::ChangeFormation {
            side,
            formation: if rng.random_bool(0.85) {
                pick(rng, &FORMATIONS).to_string()
            } else {
                "2-3-5".to_string()
            },
        },
        2 => MatchCommand::ChangePlayStyle {
            side,
            play_style: pick(rng, &STYLES),
        },
        3 => MatchCommand::ChangeTacticalDial {
            side,
            dial: dial(rng),
        },
        4 => MatchCommand::SwapPositions {
            side,
            player_a_id: starter(rng),
            player_b_id: starter(rng),
        },
        5 => MatchCommand::ChangePlayerRole {
            side,
            player_id: starter(rng),
            role: pick(rng, &ROLES),
        },
        6 => MatchCommand::SetPenaltyTaker {
            side,
            player_id: if rng.random_bool(0.8) {
                starter(rng)
            } else {
                bench(rng)
            },
        },
        _ => MatchCommand::SetCaptain {
            side,
            player_id: starter(rng),
        },
    }
}

fn scenario(number: u64) -> Scenario {
    let mut rng = ChaCha12Rng::seed_from_u64(number ^ 0x5CE7_A510);
    let side_of = |rng: &mut ChaCha12Rng| {
        (
            rng.random_range(60..=80),
            pick(rng, &STYLES),
            pick(rng, &FORMATIONS),
        )
    };
    let home = side_of(&mut rng);
    let away = side_of(&mut rng);
    let mut setup = setup(number, home, away);
    setup.allows_extra_time = rng.random_bool(0.2);
    let mut orders: Vec<(u32, Order)> = (0..rng.random_range(0..10))
        .map(|_| {
            let step = if rng.random_bool(0.1) {
                0
            } else {
                rng.random_range(1..100)
            };
            let side = pick(&mut rng, &[Side::Home, Side::Away]);
            let order = if rng.random_bool(0.15) {
                Order::Handover(side, controller(&mut rng))
            } else {
                Order::Command(side, command(&mut rng, side))
            };
            (step, order)
        })
        .collect();
    orders.sort_by_key(|(step, _)| *step);
    Scenario {
        setup,
        home: controller(&mut rng),
        away: controller(&mut rng),
        orders,
    }
}

/// Give `session` the orders of the gap after its current step. A manager's order is given only
/// while a manager holds the side, as the server lets only the holder command it; a refused one
/// changes nothing either way.
fn give_orders(session: &mut MatchSession, orders: &[(u32, Order)]) {
    let gap = session.step_seq();
    for (_, order) in orders.iter().filter(|(step, _)| *step == gap) {
        match order {
            Order::Handover(side, controller) => session.set_controller(*side, *controller),
            Order::Command(side, command) => {
                if session.controller(*side) == Controller::Manager
                    && let Err(_refused) =
                        session.command(*side, InputSource::Manager, command.clone())
                {
                }
            }
        }
    }
}

/// Play `scenario` from kick-off, or on from `session` when given, to the final whistle.
fn play_on(mut session: MatchSession, orders: &[(u32, Order)]) -> (MatchSession, Vec<StepRecord>) {
    let mut steps = Vec::new();
    for _ in 0..MAX_STEPS {
        if session.is_finished() {
            break;
        }
        steps.push(session.step());
        give_orders(&mut session, orders);
    }
    assert!(session.is_finished(), "the match did not finish");
    (session, steps)
}

fn play(scenario: &Scenario) -> (MatchSession, Vec<StepRecord>) {
    let mut session = MatchSession::new(scenario.setup.clone(), scenario.home, scenario.away);
    give_orders(&mut session, &scenario.orders);
    play_on(session, &scenario.orders)
}

fn hashes(steps: &[StepRecord]) -> Vec<(u32, u64)> {
    steps
        .iter()
        .map(|step| (step.step_seq, step.minute_hash))
        .collect()
}

/// Given 1,000 random matches (random sides, shapes, styles, knockout or not, who holds each side,
/// and up to nine orders each, legal or not, with changes of control),
/// when each is played, then replayed from its setup and log alone,
/// then every minute hash, the log and the final events are the same: a stored match is checked
/// by replay with no AI run.
#[test]
fn a_thousand_random_matches_replay_hash_for_hash() {
    let mut seen = Coverage::default();
    for number in 0..1_000 {
        let scenario = scenario(number);
        let (played, steps) = play(&scenario);
        let log = played.log().to_vec();
        seen.add(&log, &steps);

        let replayed = verify(scenario.setup.clone(), &log, &hashes(&steps))
            .unwrap_or_else(|error| panic!("match {number}: {error:?}"));
        assert_eq!(hashes(&replayed), hashes(&steps), "match {number}");

        let (session, _) = MatchSession::replay(scenario.setup.clone(), &log, None)
            .unwrap_or_else(|error| panic!("match {number}: {error:?}"));
        assert_eq!(session.log(), log.as_slice(), "match {number}");
        assert!(session.is_finished());
        assert_eq!(
            format!("{:?}", session.into_report().events),
            format!("{:?}", played.into_report().events),
            "match {number}"
        );
    }
    // The random matches really are varied: orders of every kind, both kinds of control, and
    // extra time and penalties on the path.
    assert!(seen.manager_commands > 500, "{seen:?}");
    assert!(seen.ai_commands > 1_000, "{seen:?}");
    assert!(seen.handovers > 100, "{seen:?}");
    assert!(seen.extra_time > 20 && seen.shootouts > 5, "{seen:?}");
}

/// What the random matches put on the path.
#[derive(Debug, Default)]
struct Coverage {
    manager_commands: usize,
    ai_commands: usize,
    handovers: usize,
    extra_time: usize,
    shootouts: usize,
}

impl Coverage {
    fn add(&mut self, log: &[InputRecord], steps: &[StepRecord]) {
        for record in log {
            match (&record.input, record.source) {
                (MatchInput::ControlHandover(_), _) => self.handovers += 1,
                (_, InputSource::Manager) => self.manager_commands += 1,
                (_, InputSource::Ai) => self.ai_commands += 1,
                (_, InputSource::System) => {}
            }
        }
        let reached = |phase| steps.iter().any(|step| step.result.phase == phase);
        self.extra_time += usize::from(reached(engine::MatchPhase::ExtraTimeFirstHalf));
        self.shootouts += usize::from(reached(engine::MatchPhase::PenaltyShootout));
    }
}

/// Given 300 random matches,
/// when each is cut after a random step, replayed to it from the log so far, and played on with
/// the orders still to come,
/// then it ends exactly as the match that was never cut: the AI's streams are positioned by step,
/// so a runner that takes a match over plays the same match.
#[test]
fn a_match_cut_anywhere_and_played_on_ends_the_same() {
    let mut cuts = ChaCha12Rng::seed_from_u64(0xC07);
    for number in 0..300 {
        let scenario = scenario(10_000 + number);
        let (_, whole) = play(&scenario);
        let (whole_session, _) = play(&scenario);
        let full_log = whole_session.log().to_vec();
        let last = whole.last().map_or(1, |step| step.step_seq);
        let cut = cuts.random_range(0..last);

        let log_so_far: Vec<InputRecord> = full_log
            .iter()
            .filter(|record| record.step_seq <= cut)
            .cloned()
            .collect();
        let (resumed, replayed) =
            MatchSession::replay(scenario.setup.clone(), &log_so_far, Some(cut))
                .unwrap_or_else(|error| panic!("match {number}: {error:?}"));
        let (finished, rest) = play_on(resumed, &scenario.orders);

        let mut stitched = hashes(&replayed);
        stitched.extend(hashes(&rest));
        assert_eq!(
            stitched,
            hashes(&whole),
            "match {number}, cut after step {cut}"
        );
        assert_eq!(finished.log(), full_log.as_slice(), "match {number}");
    }
}

/// A played match with the AI on both sides and one manager order, and its log.
fn played_with_orders() -> (MatchSetup, Vec<InputRecord>, Vec<(u32, u64)>) {
    let setup = even_setup(31);
    let mut session = MatchSession::new(setup.clone(), Controller::Manager, Controller::Ai);
    let orders = [(
        20,
        Order::Command(
            Side::Home,
            MatchCommand::ChangePlayStyle {
                side: Side::Home,
                play_style: PlayStyle::Counter,
            },
        ),
    )];
    give_orders(&mut session, &orders);
    let (session, steps) = play_on(session, &orders);
    (setup, session.log().to_vec(), hashes(&steps))
}

/// Given a played match,
/// when its log loses the manager's order, has two lines swapped, holds an order for the wrong
/// side, or has a line after the final whistle,
/// then each replay fails, naming the step whose hash parts, or the line out of place, refused,
/// or beyond the match.
#[test]
fn a_tampered_log_is_caught() {
    let (setup, log, stored) = played_with_orders();
    let manager_order = log
        .iter()
        .position(|record| record.source == InputSource::Manager)
        .expect("the manager gave an order");

    let mut without = log.clone();
    without.remove(manager_order);
    for record in without
        .iter_mut()
        .filter(|r| r.step_seq == log[manager_order].step_seq)
    {
        if record.order_in_gap > log[manager_order].order_in_gap {
            record.order_in_gap -= 1;
        }
    }
    assert!(matches!(
        verify(setup.clone(), &without, &stored),
        Err(ReplayError::HashMismatch { step_seq: 21, .. })
    ));

    let mut swapped = log.clone();
    swapped.swap(0, 1);
    assert!(matches!(
        verify(setup.clone(), &swapped, &stored),
        Err(ReplayError::OutOfOrder { .. })
    ));

    let mut foreign = log.clone();
    if let MatchInput::Command(MatchCommand::ChangePlayStyle { side, .. }) =
        &mut foreign[manager_order].input
    {
        *side = Side::Away;
    }
    assert!(matches!(
        verify(setup.clone(), &foreign, &stored),
        Err(ReplayError::InputRefused { index, .. }) if index == manager_order
    ));

    let mut late = log.clone();
    let mut extra = log[manager_order].clone();
    extra.step_seq = 500;
    extra.order_in_gap = 0;
    late.push(extra);
    assert!(matches!(
        MatchSession::replay(setup, &late, None),
        Err(ReplayError::BeyondTheMatch { index }) if index == log.len()
    ));
}

/// Given a played match whose setup and log are stored as JSON, as the server stores them,
/// when they are read back and replayed,
/// then every hash still matches: nothing a replay needs is lost in the round trip.
#[test]
fn a_match_replays_from_its_json() {
    let (setup, log, stored) = played_with_orders();
    let setup_json = serde_json::to_string(&setup).expect("the setup serialises");
    let log_json = serde_json::to_string(&log).expect("the log serialises");

    let setup_back: MatchSetup = serde_json::from_str(&setup_json).expect("the setup reads back");
    let log_back: Vec<InputRecord> = serde_json::from_str(&log_json).expect("the log reads back");

    assert!(verify(setup_back, &log_back, &stored).is_ok());
}
