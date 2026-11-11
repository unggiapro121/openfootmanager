use engine::{
    CounterPressDuration, DefensiveLine, DefensiveShape, LiveMatchState, MatchCommand, MatchPhase,
    PlayStyle, PlayerRole, Side, TacticalDial, TacticsPitchWidth,
};
use ofm_rules::match_session::{
    COMMANDS_CLOSED, MatchSetup, NOT_ON_PITCH, NOT_YOUR_SIDE, ROLE_NOT_FOR_POSITION,
    TOO_MANY_UNDER_PRICED_DIALS, UNKNOWN_FORMATION, check_command, ration_refuses,
};

use crate::support::{MAX_STEPS, even_setup, setup};

fn state_of(setup: MatchSetup) -> LiveMatchState {
    LiveMatchState::new(
        setup.home,
        setup.away,
        setup.config,
        setup.home_bench,
        setup.away_bench,
        setup.allows_extra_time,
    )
}

/// A match a few minutes in.
fn under_way() -> LiveMatchState {
    let setup = even_setup(21);
    let mut rng = setup.seed.engine_rng();
    let mut state = state_of(setup);
    for _ in 0..5 {
        state.step_minute(&mut rng);
    }
    state
}

fn dial(side: Side, dial: TacticalDial) -> MatchCommand {
    MatchCommand::ChangeTacticalDial { side, dial }
}

/// Given a match under way,
/// when the home manager gives an order for the away side,
/// then it is refused: a manager commands only his own side.
#[test]
fn a_manager_commands_only_his_own_side() {
    let state = under_way();
    let style = MatchCommand::ChangePlayStyle {
        side: Side::Away,
        play_style: PlayStyle::Attacking,
    };
    assert_eq!(
        check_command(&state, Side::Home, &style),
        Err(NOT_YOUR_SIDE)
    );
    assert_eq!(check_command(&state, Side::Away, &style), Ok(()));
}

/// Given a finished match, and one at its penalty shootout,
/// when either side gives any order,
/// then it is refused: nothing can be changed once the match is over or at penalties.
#[test]
fn no_order_is_taken_after_the_whistle_or_at_penalties() {
    let style = MatchCommand::ChangePlayStyle {
        side: Side::Home,
        play_style: PlayStyle::Attacking,
    };
    let setup = even_setup(22);
    let mut rng = setup.seed.engine_rng();
    let mut finished = state_of(setup);
    for _ in 0..MAX_STEPS {
        finished.step_minute(&mut rng);
    }
    assert!(finished.is_finished());
    assert_eq!(
        check_command(&finished, Side::Home, &style),
        Err(COMMANDS_CLOSED)
    );

    let shootout = (0..300)
        .find_map(|number| {
            let mut knockout = even_setup(1_000 + number);
            knockout.allows_extra_time = true;
            let mut rng = knockout.seed.engine_rng();
            let mut state = state_of(knockout);
            for _ in 0..MAX_STEPS {
                if state.phase() == MatchPhase::PenaltyShootout {
                    return Some(state);
                }
                state.step_minute(&mut rng);
            }
            None
        })
        .expect("some knockout tie goes to penalties");
    assert_eq!(
        check_command(&shootout, Side::Home, &style),
        Err(COMMANDS_CLOSED)
    );
}

/// Given a match under way,
/// when a side asks for each of the nine shapes the game offers, then for one it does not,
/// then the nine are allowed and the other refused rather than played as 4-4-2.
#[test]
fn only_the_offered_formations_are_allowed() {
    let state = under_way();
    for formation in engine::FORMATIONS {
        let command = MatchCommand::ChangeFormation {
            side: Side::Home,
            formation: formation.to_string(),
        };
        assert_eq!(
            check_command(&state, Side::Home, &command),
            Ok(()),
            "{formation}"
        );
    }
    let odd = MatchCommand::ChangeFormation {
        side: Side::Home,
        formation: "4-4-1-1-0".into(),
    };
    assert_eq!(
        check_command(&state, Side::Home, &odd),
        Err(UNKNOWN_FORMATION)
    );
}

/// Given a side already holding two of the four under-priced dials (a low line, a compact shape),
/// when its manager narrows the pitch, then lengthens the counter-press instead, then raises the
/// line,
/// then the third under-priced dial is refused for a person exactly as for the AI, and a dial
/// that does not add to the count is allowed.
#[test]
fn the_under_priced_dial_ration_applies_to_people_too() {
    let mut rationed = even_setup(23);
    rationed.home.tactics.defensive_line = DefensiveLine::Low;
    rationed.home.tactics.defensive_shape = DefensiveShape::Compact;
    let state = state_of(rationed);

    let narrow = dial(Side::Home, TacticalDial::Width(TacticsPitchWidth::Narrow));
    let long_press = dial(
        Side::Home,
        TacticalDial::CounterPressDuration(CounterPressDuration::Long),
    );
    let higher = dial(Side::Home, TacticalDial::DefensiveLine(DefensiveLine::High));
    assert_eq!(
        check_command(&state, Side::Home, &narrow),
        Err(TOO_MANY_UNDER_PRICED_DIALS)
    );
    assert_eq!(
        check_command(&state, Side::Home, &long_press),
        Err(TOO_MANY_UNDER_PRICED_DIALS)
    );
    assert_eq!(check_command(&state, Side::Home, &higher), Ok(()));
}

/// Given a count of under-priced dials before and after a change,
/// when the ration is asked about it,
/// then only a change that adds a dial past two is refused: keeping or lowering is always
/// allowed, however many the side holds (E5-16 E516-1, the one formula of `check_command`).
#[test]
fn the_ration_refuses_only_adding_a_dial_past_two() {
    let cases = [
        ((2, 3), true),
        ((1, 3), true),
        ((3, 4), true),
        ((3, 3), false),
        ((4, 3), false),
        ((4, 4), false),
        ((2, 2), false),
        ((0, 2), false),
        ((1, 2), false),
    ];
    for ((before, after), refused) in cases {
        assert_eq!(
            ration_refuses(before, after),
            refused,
            "{before} -> {after}"
        );
    }
}

/// Given a side that kicked off holding three under-priced dials,
/// when its manager turns a dial that keeps the count at three,
/// then it is allowed: the ration stops adding, it does not force a side to give one back.
#[test]
fn a_side_may_keep_what_it_kicked_off_with() {
    let mut heavy = even_setup(24);
    heavy.home.tactics.defensive_line = DefensiveLine::Low;
    heavy.home.tactics.defensive_shape = DefensiveShape::Compact;
    heavy.home.tactics.width = TacticsPitchWidth::Narrow;
    let state = state_of(heavy);
    let very_low = dial(
        Side::Home,
        TacticalDial::DefensiveLine(DefensiveLine::VeryLow),
    );
    assert_eq!(check_command(&state, Side::Home, &very_low), Ok(()));
}

/// Given a match under way with one home starter sent off,
/// when the manager names a starter, a bench player and the sent-off man as taker or captain,
/// then only the starter on the pitch is allowed.
#[test]
fn takers_and_the_captain_must_be_on_the_pitch() {
    let mut state = under_way();
    state.test_send_off("h05");
    let takers = |player: &str| {
        let id = player.to_string();
        [
            MatchCommand::SetFreeKickTaker {
                side: Side::Home,
                player_id: id.clone(),
            },
            MatchCommand::SetCornerTaker {
                side: Side::Home,
                player_id: id.clone(),
            },
            MatchCommand::SetPenaltyTaker {
                side: Side::Home,
                player_id: id.clone(),
            },
            MatchCommand::SetCaptain {
                side: Side::Home,
                player_id: id,
            },
        ]
    };
    for command in takers("h07") {
        assert_eq!(check_command(&state, Side::Home, &command), Ok(()));
    }
    for player in ["hs3", "h05"] {
        for command in takers(player) {
            assert_eq!(
                check_command(&state, Side::Home, &command),
                Err(NOT_ON_PITCH),
                "{player}"
            );
        }
    }
}

/// Given a match under way,
/// when the manager gives a midfielder a midfield role, a goalkeeper's role, and a bench player
/// a role,
/// then the first is allowed, the second refused as not for his position (the engine used to
/// ignore it and report success), the third refused as not on the pitch.
#[test]
fn a_role_must_fit_a_player_on_the_pitch() {
    let state = under_way();
    let role = |player: &str, role: PlayerRole| MatchCommand::ChangePlayerRole {
        side: Side::Home,
        player_id: player.to_string(),
        role,
    };
    assert_eq!(
        check_command(&state, Side::Home, &role("h06", PlayerRole::BoxToBox)),
        Ok(())
    );
    assert_eq!(
        check_command(&state, Side::Home, &role("h06", PlayerRole::SweeperKeeper)),
        Err(ROLE_NOT_FOR_POSITION)
    );
    assert_eq!(
        check_command(&state, Side::Home, &role("hs3", PlayerRole::BoxToBox)),
        Err(NOT_ON_PITCH)
    );
}

/// Given a stronger and a weaker side,
/// when a substitution, a swap and a style change are checked,
/// then all pass the shared check, which leaves their limits to the engine.
#[test]
fn substitutions_swaps_and_styles_pass_to_the_engine() {
    let state = state_of(setup(
        25,
        (75, PlayStyle::Possession, "4-3-3"),
        (65, PlayStyle::Counter, "4-5-1"),
    ));
    for command in [
        MatchCommand::Substitute {
            side: Side::Home,
            player_off_id: "h09".into(),
            player_on_id: "hs5".into(),
        },
        MatchCommand::SwapPositions {
            side: Side::Home,
            player_a_id: "h02".into(),
            player_b_id: "h03".into(),
        },
        MatchCommand::ChangePlayStyle {
            side: Side::Home,
            play_style: PlayStyle::HighPress,
        },
    ] {
        assert_eq!(check_command(&state, Side::Home, &command), Ok(()));
    }
}
