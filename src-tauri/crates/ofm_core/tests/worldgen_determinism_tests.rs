//! A world is regenerated from its seed (phase 3, E3-5c): the same seed, config and opening year
//! build the same world — clubs, players, staff and every id — so the online server and the game
//! agree on a world from the seed alone, and a bug report names a world by a number.

use ofm_core::generator::{
    DefinitionSources, WorldData, WorldGenConfig, generate_world_data_seeded_with,
};

fn config(opening_year: u32) -> WorldGenConfig {
    WorldGenConfig {
        opening_year,
        ..WorldGenConfig::compact(ofm_core::generator::default_opening_year())
    }
}

fn build(seed: u64, opening_year: u32) -> WorldData {
    generate_world_data_seeded_with(
        seed,
        &config(opening_year),
        &DefinitionSources::embedded_only(),
    )
}

/// The world as a JSON value: maps compare by content, not by the order a `HashMap` lists them.
fn json(world: &WorldData) -> serde_json::Value {
    serde_json::to_value(world).expect("a world serializes")
}

/// Given one seed, one config and one opening year,
/// when a world is generated twice,
/// then the two are identical, ids included.
#[test]
fn the_same_seed_builds_the_same_world_ids_included() {
    let first = build(41, 2030);
    let second = build(41, 2030);

    assert!(!first.players.is_empty());
    assert_eq!(first.metadata.world_id, second.metadata.world_id);
    assert_eq!(first.players[0].id, second.players[0].id);
    assert!(json(&first) == json(&second), "the two worlds differ");
}

/// The control: another seed must give another world, or the test above could not tell a
/// seeded generator from one that ignores its seed.
#[test]
fn another_seed_builds_another_world() {
    let first = build(41, 2030);
    let other = build(42, 2030);

    assert_ne!(first.metadata.world_id, other.metadata.world_id);
    assert_ne!(first.players[0].id, other.players[0].id);
}

/// Given one seed,
/// when the world is generated to open in 2030 and in 2040,
/// then it is the same people, each born ten years later: the opening year comes from the config,
/// never from the clock.
#[test]
fn the_opening_year_comes_from_the_config() {
    let early = build(41, 2030);
    let late = build(41, 2040);

    assert_eq!(early.players.len(), late.players.len());
    for (a, b) in early.players.iter().zip(&late.players) {
        assert_eq!(a.id, b.id);
        let year = |dob: &str| dob[..4].parse::<i32>().expect("a dated birth");
        assert_eq!(
            year(&b.date_of_birth) - year(&a.date_of_birth),
            10,
            "{}",
            a.id
        );
    }
}
