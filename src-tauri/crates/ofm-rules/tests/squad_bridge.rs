//! The squad bridge from `domain` data alone (phase 3, E3-5a): the online server builds a match
//! between two real clubs without `ofm_core` — a manager's saved eleven, an AI club's rested one,
//! a short side made up from the treatment room, the set-piece takers, stale roles dropped — and
//! the match plays through the shared session.

use std::collections::HashMap;

use domain::player::{Injury, Player, PlayerAttributes, Position};
use domain::team::{PlayStyle, PlayerRole, Team};
use engine::ai::AiProfile;
use engine::{CoachMastery, MatchConfig};
use ofm_rules::match_session::{Controller, MatchSeed, MatchSession, MatchSetup};
use ofm_rules::squad::{
    FixtureLoad, SideSelection, build_side, pick_set_piece_takers, reconcile_roles,
};

fn attributes(value: u8) -> PlayerAttributes {
    PlayerAttributes {
        pace: value,
        stamina: value,
        strength: value,
        agility: value,
        passing: value,
        shooting: value,
        tackling: value,
        dribbling: value,
        defending: value,
        positioning: value,
        vision: value,
        decisions: value,
        composure: value,
        aggression: value,
        teamwork: value,
        leadership: value,
        handling: value,
        reflexes: value,
        aerial: value,
        long_passing: value,
        crossing: value,
        curve: value,
        free_kick: value,
        long_shots: value,
        first_touch: value,
        heading: value,
    }
}

/// The positions of a 4-4-2 eleven, in slot order, then a seven-man bench.
const ELEVEN: [Position; 11] = [
    Position::Goalkeeper,
    Position::RightBack,
    Position::CenterBack,
    Position::CenterBack,
    Position::LeftBack,
    Position::RightMidfielder,
    Position::CentralMidfielder,
    Position::CentralMidfielder,
    Position::LeftMidfielder,
    Position::Striker,
    Position::Striker,
];
const BENCH: [Position; 7] = [
    Position::Goalkeeper,
    Position::CenterBack,
    Position::CentralMidfielder,
    Position::CentralMidfielder,
    Position::LeftWinger,
    Position::Striker,
    Position::RightBack,
];

/// A club of eighteen: `<tag>00`–`<tag>10` the eleven at `rating`, `<tag>b0`–`<tag>b6` a bench
/// six points weaker; the saved XI is the eleven in slot order.
fn club(tag: &str, rating: u8) -> (Team, Vec<Player>) {
    let mut team = Team::new(
        tag.into(),
        format!("{tag} FC"),
        tag.to_uppercase(),
        "England".into(),
        "Town".into(),
        "Ground".into(),
        20_000,
    );
    team.formation = "4-4-2".into();
    team.play_style = PlayStyle::Possession;
    let mut players = Vec::new();
    for (index, position) in ELEVEN.iter().enumerate() {
        players.push(player(
            &format!("{tag}{index:02}"),
            position.clone(),
            rating,
            tag,
        ));
    }
    for (index, position) in BENCH.iter().enumerate() {
        players.push(player(
            &format!("{tag}b{index}"),
            position.clone(),
            rating - 6,
            tag,
        ));
    }
    team.starting_xi_ids = players.iter().take(11).map(|p| p.id.clone()).collect();
    (team, players)
}

fn player(id: &str, position: Position, rating: u8, team_id: &str) -> Player {
    let mut player = Player::new(
        id.into(),
        id.into(),
        id.into(),
        "1998-03-01".into(),
        "England".into(),
        position,
        attributes(rating),
    );
    player.team_id = Some(team_id.into());
    player
}

fn selection<'a>(
    team: &'a Team,
    available: &'a [&'a Player],
    injured: &'a [&'a Player],
    is_user_team: bool,
) -> SideSelection<'a> {
    SideSelection {
        team_id: &team.id,
        team: Some(team),
        available,
        injured,
        is_user_team,
        head_coach: CoachMastery::default(),
        management_quality: 0.5,
        selection_seed: 7,
        load: FixtureLoad::Normal,
    }
}

fn ids(players: &[engine::PlayerData]) -> Vec<&str> {
    players.iter().map(|player| player.id.as_str()).collect()
}

/// Given a manager's club with its eleven saved slot by slot,
/// when its side is built,
/// then the XI is the saved eleven in the saved slots, the bench holds the other seven, and the
/// club's shape and style reach the engine.
#[test]
fn a_managers_side_is_his_saved_eleven() {
    let (team, players) = club("h", 70);
    let available: Vec<&Player> = players.iter().collect();

    let (side, bench) = build_side(&selection(&team, &available, &[], true));

    assert_eq!(
        ids(&side.players),
        team.starting_xi_ids
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    );
    assert_eq!(bench.len(), 7);
    assert_eq!(side.formation, "4-4-2");
    assert_eq!(side.play_style, engine::PlayStyle::Possession);
}

/// Given an AI club whose first-choice right midfielder is exhausted (condition 30) and whose
/// bench holds a fresh, adequate midfielder,
/// when its side is built,
/// then the tired starter is rested for the fresh one.
#[test]
fn an_ai_club_rests_an_exhausted_starter() {
    let (team, mut players) = club("a", 70);
    players[5].condition = 30;
    players[13].attributes = attributes(68);
    let available: Vec<&Player> = players.iter().collect();

    let (side, _) = build_side(&selection(&team, &available, &[], false));

    let names = ids(&side.players);
    assert!(!names.contains(&"a05"), "{names:?}");
    assert_eq!(side.players.len(), 11);
}

/// Given a club with only nine fit players and three injured ones,
/// when its side is built,
/// then the XI is made up to eleven from the treatment room, the least hurt first.
#[test]
fn a_short_side_is_made_up_from_the_treatment_room() {
    let (team, mut players) = club("s", 70);
    players.truncate(12);
    for (index, days) in [(9, 3), (10, 30), (11, 10)] {
        players[index].injury = Some(Injury {
            name: "Knock".into(),
            days_remaining: days,
        });
    }
    let available: Vec<&Player> = players.iter().filter(|p| p.injury.is_none()).collect();
    let injured: Vec<&Player> = players.iter().filter(|p| p.injury.is_some()).collect();

    let (side, bench) = build_side(&selection(&team, &available, &injured, true));

    let names = ids(&side.players);
    assert_eq!(names.len(), 11);
    assert!(
        names.contains(&"s09") && names.contains(&"sb0"),
        "{names:?}"
    );
    assert!(
        !names.contains(&"s10"),
        "the worst injury stays out: {names:?}"
    );
    assert!(bench.is_empty());
}

/// Given two clubs built from `domain` data,
/// when their sides become a match setup and the match is played through the shared session,
/// then it reaches the final whistle with events: the server needs nothing of `ofm_core` to
/// play two real clubs.
#[test]
fn a_match_between_two_clubs_plays_from_domain_data_alone() {
    let (home_team, home_players) = club("h", 72);
    let (away_team, away_players) = club("a", 68);
    let home_available: Vec<&Player> = home_players.iter().collect();
    let away_available: Vec<&Player> = away_players.iter().collect();
    let (home, home_bench) = build_side(&selection(&home_team, &home_available, &[], false));
    let (away, away_bench) = build_side(&selection(&away_team, &away_available, &[], false));
    let setup = MatchSetup {
        home,
        away,
        home_bench,
        away_bench,
        config: MatchConfig::default(),
        allows_extra_time: false,
        seed: MatchSeed([3; 32]),
        ai_home: AiProfile::default(),
        ai_away: AiProfile::default(),
    };

    let mut session = MatchSession::new(setup, Controller::Ai, Controller::Ai);
    for _ in 0..200 {
        if session.is_finished() {
            break;
        }
        session.step();
    }

    assert!(session.is_finished());
    assert!(!session.into_report().events.is_empty());
}

/// Given an eleven,
/// when the set-piece takers are picked,
/// then the keeper takes none of the kicks, and the captain is the best leader.
#[test]
fn set_piece_takers_come_from_the_eleven() {
    let (_, mut players) = club("t", 70);
    players[0].attributes = attributes(95);
    players[7].attributes.leadership = 99;
    let eleven: Vec<&Player> = players.iter().take(11).collect();

    let (captain, penalty, free_kick, corner) = pick_set_piece_takers(&eleven);

    assert_eq!(captain.as_deref(), Some("t00"));
    for taker in [penalty, free_kick, corner] {
        assert_ne!(taker.as_deref(), Some("t00"));
        assert!(taker.is_some());
    }
}

/// Given a striker in a defensive slot holding Poacher, and a benched midfielder holding a role
/// only his old slot admitted,
/// when the roles are reconciled,
/// then both roles are dropped and a fitting one stays.
#[test]
fn stale_roles_are_dropped() {
    let (mut team, players) = club("r", 70);
    team.starting_xi_ids.swap(2, 9); // the striker r09 now stands at centre-back
    team.player_roles.insert("r09".into(), PlayerRole::Poacher);
    team.player_roles.insert("rb0".into(), PlayerRole::Stopper); // a bench keeper
    team.player_roles.insert("r06".into(), PlayerRole::BoxToBox);
    let natural: HashMap<String, Position> = players
        .iter()
        .map(|p| (p.id.clone(), p.natural_position.clone()))
        .collect();

    let dropped = reconcile_roles(&mut team, &natural);

    assert_eq!(dropped, 2);
    assert_eq!(team.player_roles.len(), 1);
    assert_eq!(team.player_roles.get("r06"), Some(&PlayerRole::BoxToBox));
}
