//! Event protocol 2 (phase 2, P2.1): what each event says about the attempt,
//! the set piece and the lane, and the goal source the engine stamps once.

use ::engine::*;
use rand::SeedableRng;
use rand::rngs::StdRng;

fn make_player(id: String, position: Position) -> PlayerData {
    PlayerData {
        name: id.clone(),
        id,
        position,
        ovr: 70,
        condition: 90,
        fitness: 75,
        pace: 70,
        stamina: 70,
        strength: 70,
        agility: 70,
        passing: 70,
        shooting: 70,
        tackling: 70,
        dribbling: 70,
        defending: 70,
        positioning: 70,
        vision: 70,
        decisions: 70,
        composure: 70,
        aggression: 70,
        teamwork: 70,
        leadership: 70,
        handling: 70,
        reflexes: 70,
        aerial: 70,
        long_passing: 0,
        crossing: 0,
        curve: 0,
        free_kick: 0,
        long_shots: 0,
        first_touch: 0,
        heading: 0,
        height_cm: 0,
        traits: vec![],
        role: PlayerRole::Standard,
        position_ratings: Vec::new(),
    }
}

/// A 4-4-2 in XI order: keeper, LB, CB, CB, RB, LM, CM, CM, RM, ST, ST.
fn make_team(id: &str) -> TeamData {
    let groups = [
        (Position::Goalkeeper, 1),
        (Position::Defender, 4),
        (Position::Midfielder, 4),
        (Position::Forward, 2),
    ];
    let players = groups
        .iter()
        .flat_map(|(position, count)| {
            (0..*count).map(move |n| make_player(format!("{id}_{position:?}{n}"), *position))
        })
        .collect();
    TeamData {
        id: id.to_string(),
        name: id.to_string(),
        formation: "4-4-2".to_string(),
        play_style: PlayStyle::Balanced,
        coach: CoachMastery::default(),
        tactics: TacticsConfig::default(),
        players,
    }
}

fn reports(count: u64) -> Vec<MatchReport> {
    let (home, away) = (make_team("home"), make_team("away"));
    (0..count)
        .map(|seed| {
            simulate_with_rng(
                &home,
                &away,
                &MatchConfig::default(),
                &mut StdRng::seed_from_u64(seed),
            )
        })
        .collect()
}

const SHOT_EVENTS: [EventType; 6] = [
    EventType::Goal,
    EventType::ShotSaved,
    EventType::ShotOffTarget,
    EventType::ShotBlocked,
    EventType::PenaltyGoal,
    EventType::PenaltyMiss,
];

/// Given the table of how a goal is made,
/// when a source is read for each attempt and set piece,
/// then a penalty beats everything, a corner beats a header, and the rest is
/// open play.
#[test]
fn a_goals_source_follows_the_attempt_then_the_set_piece() {
    use GoalSource as G;
    let cases = [
        (Some(ShotKind::Penalty), Some(SetPiece::Corner), G::Penalty),
        (Some(ShotKind::Header), Some(SetPiece::Corner), G::Corner),
        (Some(ShotKind::Open), Some(SetPiece::Corner), G::Corner),
        (Some(ShotKind::Open), Some(SetPiece::FreeKick), G::FreeKick),
        (Some(ShotKind::Header), None, G::Header),
        (Some(ShotKind::Open), None, G::OpenPlay),
        (None, None, G::OpenPlay),
    ];
    for (kind, set_piece, expected) in cases {
        assert_eq!(
            GoalSource::of(kind, set_piece),
            expected,
            "{kind:?} {set_piece:?}"
        );
    }
}

/// Given a hundred seeded matches,
/// when their events are read,
/// then every attempt says what kind it was, every goal carries the source the
/// report lists for it, and the report says it follows protocol 2.
#[test]
fn every_attempt_has_a_kind_and_every_goal_a_source() {
    for report in reports(100) {
        assert_eq!(report.protocol_version, EVENT_PROTOCOL_VERSION);
        for event in &report.events {
            if SHOT_EVENTS.contains(&event.event_type) {
                assert!(event.shot_kind.is_some(), "{event:?}");
            } else {
                assert_eq!(event.shot_kind, None, "{event:?}");
            }
            assert_eq!(event.goal_source.is_some(), event.is_goal(), "{event:?}");
        }
        let stamped: Vec<GoalSource> = report
            .events
            .iter()
            .filter_map(|event| event.goal_source)
            .collect();
        let listed: Vec<GoalSource> = report.goals.iter().map(|goal| goal.goal_source).collect();
        assert_eq!(stamped, listed);
    }
}

/// Given a hundred seeded matches,
/// when the attempts after a cross are read,
/// then the shot that a won header leads to is a header, and a header goal
/// outside a corner counts as a header goal.
#[test]
fn the_shot_after_a_won_header_is_a_header() {
    let mut headers = 0;
    for report in reports(100) {
        for pair in report.events.windows(2) {
            let (cross, next) = (&pair[0], &pair[1]);
            if cross.event_type != EventType::Cross || !SHOT_EVENTS[..4].contains(&next.event_type)
            {
                continue;
            }
            headers += 1;
            assert_eq!(next.shot_kind, Some(ShotKind::Header), "{next:?}");
            if next.event_type == EventType::Goal && next.set_piece.is_none() {
                assert_eq!(next.goal_source, Some(GoalSource::Header));
            }
        }
    }
    assert!(headers > 100, "only {headers} headers in 100 matches");
}

/// Given a hundred seeded matches,
/// when a corner leaves the attackers with the ball in the box,
/// then the attempt that follows it is part of the corner, and a goal from it
/// is a corner goal; an attempt with no corner before it is not.
#[test]
fn the_attempt_a_corner_leads_to_is_part_of_it() {
    let mut corner_attempts = 0;
    for report in reports(100) {
        for event in &report.events {
            if event.event_type == EventType::Corner {
                assert_eq!(event.set_piece, Some(SetPiece::Corner));
            }
            if event.event_type == EventType::FreeKick {
                assert_eq!(event.set_piece, Some(SetPiece::FreeKick));
            }
            if event.set_piece == Some(SetPiece::Corner) && SHOT_EVENTS.contains(&event.event_type)
            {
                corner_attempts += 1;
                if event.is_goal() && event.shot_kind != Some(ShotKind::Penalty) {
                    assert_eq!(event.goal_source, Some(GoalSource::Corner));
                }
            }
        }
        // The first attempt of a match comes before any corner.
        let first_attempt = report
            .events
            .iter()
            .position(|e| SHOT_EVENTS.contains(&e.event_type));
        let first_corner = report
            .events
            .iter()
            .position(|e| e.event_type == EventType::Corner);
        if let (Some(attempt), Some(corner)) = (first_attempt, first_corner)
            && attempt < corner
        {
            assert_eq!(report.events[attempt].set_piece, None);
        }
    }
    assert!(
        corner_attempts > 50,
        "only {corner_attempts} corner attempts"
    );
}

/// Given a 4-4-2 whose left-back, right midfielder and strikers are known,
/// when a hundred matches are played,
/// then each of them is placed in his slot's lane on every event he leads.
#[test]
fn an_events_lane_is_its_players_slot() {
    let lanes = [
        ("home_Defender0", Lane::Left),
        ("home_Defender1", Lane::Centre),
        ("home_Defender3", Lane::Right),
        ("home_Midfielder3", Lane::Right),
        ("home_Forward0", Lane::Centre),
        ("away_Midfielder0", Lane::Left),
    ];
    let mut checked = 0;
    for report in reports(100) {
        for event in &report.events {
            let Some(player) = event.player_id.as_deref() else {
                continue;
            };
            if let Some((_, lane)) = lanes.iter().find(|(id, _)| *id == player) {
                assert_eq!(event.lane, Some(*lane), "{event:?}");
                checked += 1;
            }
        }
    }
    assert!(checked > 500, "only {checked} events checked");
}

/// Given an event saved before protocol 2, and a report saved before it,
/// when they are read back,
/// then they load with none of the new fields, and the report as protocol 1.
#[test]
fn protocol_one_events_and_reports_still_load() {
    let event: MatchEvent = serde_json::from_str(
        r#"{"minute":10,"event_type":"Goal","side":"Home","zone":"AwayBox",
            "player_id":"p1","secondary_player_id":null}"#,
    )
    .unwrap();
    assert_eq!(
        (
            event.shot_kind,
            event.set_piece,
            event.goal_source,
            event.lane
        ),
        (None, None, None, None)
    );

    let mut report = reports(1).remove(0);
    let mut json = serde_json::to_value(&report).unwrap();
    json.as_object_mut().unwrap().remove("protocol_version");
    report = serde_json::from_value(json).unwrap();
    assert_eq!(report.protocol_version, 1);
}
