//! Synthetic sides for the live engine's unit tests: a 4-4-2 of 70s, every
//! split attribute left undeclared so kick-off fills it.

use crate::types::{PlayStyle, PlayerData, Position, TeamData};

pub(super) fn make_player(id: &str, pos: Position) -> PlayerData {
    PlayerData {
        id: id.to_string(),
        name: id.to_string(),
        position: pos,
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
        role: crate::types::PlayerRole::Standard,
        position_ratings: Vec::new(),
    }
}

pub(super) fn make_team(id: &str) -> TeamData {
    TeamData {
        id: id.to_string(),
        name: id.to_string(),
        formation: "4-4-2".to_string(),
        play_style: PlayStyle::Balanced,
        coach: crate::types::CoachMastery::default(),
        tactics: crate::types::TacticsConfig::default(),
        players: vec![
            make_player(&format!("{id}_gk"), Position::Goalkeeper),
            make_player(&format!("{id}_d1"), Position::Defender),
            make_player(&format!("{id}_d2"), Position::Defender),
            make_player(&format!("{id}_d3"), Position::Defender),
            make_player(&format!("{id}_d4"), Position::Defender),
            make_player(&format!("{id}_m1"), Position::Midfielder),
            make_player(&format!("{id}_m2"), Position::Midfielder),
            make_player(&format!("{id}_m3"), Position::Midfielder),
            make_player(&format!("{id}_m4"), Position::Midfielder),
            make_player(&format!("{id}_f1"), Position::Forward),
            make_player(&format!("{id}_f2"), Position::Forward),
        ],
    }
}
