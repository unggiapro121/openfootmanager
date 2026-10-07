//! A generated world's bodies: heights and weights on real players' averages,
//! and the attributes a body shapes following it as closely as they do in real
//! football. See `fm-document/game-engine/player-physique-duel-formulas.md` §3–4.

use chrono::{TimeZone, Utc};
use domain::manager::Manager;
use domain::player::{Player, Position};
use ofm_core::clock::GameClock;
use ofm_core::game::Game;
use ofm_core::generator::{DefinitionSources, WorldGenConfig, generate_world_data_seeded_with};
use ofm_core::player_identity::upgrade_game_player_identities;

fn generated_players(seed: u64) -> Vec<Player> {
    generate_world_data_seeded_with(
        seed,
        &WorldGenConfig::compact(),
        &DefinitionSources::embedded_only(),
    )
    .players
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len() as f64
}

/// Pearson correlation of `pairs`, each centred on its own group's mean first,
/// so a difference between positions cannot pass for a link within one.
fn within_group_correlation(groups: &[Vec<(f64, f64)>]) -> f64 {
    let (mut cov, mut vx, mut vy) = (0.0, 0.0, 0.0);
    for pairs in groups {
        let mx = mean(&pairs.iter().map(|p| p.0).collect::<Vec<_>>());
        let my = mean(&pairs.iter().map(|p| p.1).collect::<Vec<_>>());
        for (x, y) in pairs {
            cov += (x - mx) * (y - my);
            vx += (x - mx).powi(2);
            vy += (y - my).powi(2);
        }
    }
    cov / (vx * vy).sqrt()
}

const GROUPS: [Position; 4] = [
    Position::Goalkeeper,
    Position::Defender,
    Position::Midfielder,
    Position::Forward,
];

fn in_group<'a>(players: &'a [Player], group: &Position) -> Vec<&'a Player> {
    players
        .iter()
        .filter(|p| &p.position.to_group_position() == group)
        .collect()
}

/// Given a generated world, when its players are measured, then every one has
/// a height and weight in the real range, and each position group sits on the
/// real average for its position.
#[test]
fn generated_players_have_real_heights_and_weights_for_their_position() {
    let players = generated_players(17);
    for player in &players {
        assert!(
            (160..=205).contains(&player.height_cm),
            "{}",
            player.height_cm
        );
        assert!(
            (50..=105).contains(&player.weight_kg),
            "{}",
            player.weight_kg
        );
    }
    for (group, expected) in GROUPS.iter().zip([188.9, 183.0, 178.4, 181.6]) {
        let heights: Vec<f64> = in_group(&players, group)
            .iter()
            .map(|p| f64::from(p.height_cm))
            .collect();
        let average = mean(&heights);
        assert!(
            (average - expected).abs() < 1.5,
            "{group:?} averages {average:.1} cm, expected about {expected}"
        );
    }
}

/// Given a generated world, when height and weight are set against the
/// attributes they shape within each position, then aerial ability follows
/// height, strength follows weight and agility falls with height, about as
/// strongly as in real football.
#[test]
fn the_attributes_a_body_shapes_follow_it() {
    let players = generated_players(23);
    let outfield = &GROUPS[1..];
    let link = |body: fn(&Player) -> f64, attr: fn(&Player) -> f64| {
        let groups: Vec<Vec<(f64, f64)>> = outfield
            .iter()
            .map(|g| {
                in_group(&players, g)
                    .iter()
                    .map(|p| (body(p), attr(p)))
                    .collect()
            })
            .collect();
        within_group_correlation(&groups)
    };
    let height = |p: &Player| f64::from(p.height_cm);
    let weight = |p: &Player| f64::from(p.weight_kg);

    let aerial = link(height, |p| f64::from(p.attributes.aerial));
    let strength = link(weight, |p| f64::from(p.attributes.strength));
    let agility = link(height, |p| f64::from(p.attributes.agility));
    assert!((aerial - 0.30).abs() < 0.1, "height–aerial r = {aerial:.2}");
    assert!(
        (strength - 0.55).abs() < 0.12,
        "weight–strength r = {strength:.2}"
    );
    assert!(
        (agility + 0.40).abs() < 0.1,
        "height–agility r = {agility:.2}"
    );
}

/// Given a generated world whose detailed positions have been inferred, as when
/// a career opens, when centre-backs are set against full-backs, then the
/// centre-backs are the taller: the tall, strong defenders are the ones read as
/// centre-backs.
#[test]
fn centre_backs_come_out_taller_than_full_backs() {
    let world = generate_world_data_seeded_with(
        29,
        &WorldGenConfig::compact(),
        &DefinitionSources::embedded_only(),
    );
    let start = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();
    let mut manager = Manager::new(
        "body-mgr".to_string(),
        "Body".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire(world.teams[0].id.clone());
    let mut game = Game::new(
        GameClock::new(start),
        manager,
        world.teams,
        world.players,
        world.staff,
        vec![],
    );
    upgrade_game_player_identities(&mut game);

    let average_height = |positions: &[Position]| {
        let heights: Vec<f64> = game
            .players
            .iter()
            .filter(|p| positions.contains(&p.natural_position))
            .map(|p| f64::from(p.height_cm))
            .collect();
        mean(&heights)
    };
    let centre_backs = average_height(&[Position::CenterBack]);
    let full_backs = average_height(&[Position::RightBack, Position::LeftBack]);
    assert!(
        centre_backs > full_backs,
        "centre-backs {centre_backs:.1} cm, full-backs {full_backs:.1} cm"
    );
}
