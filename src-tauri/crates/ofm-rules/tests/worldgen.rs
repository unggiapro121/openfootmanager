//! A fictional world grows from the shared rules alone (phase 3, E3-5c): no definition file, no
//! package, no clock and no OS entropy — the online server grows the world the game would.

use ofm_rules::seed::rng_from_u64;
use ofm_rules::worldgen::clubs::WorldGenConfig;
use ofm_rules::worldgen::definitions::embedded_names;
use ofm_rules::worldgen::generate_world;

type World = (
    Vec<domain::team::Team>,
    Vec<domain::player::Player>,
    Vec<domain::staff::Staff>,
);

fn grow(seed: u64) -> World {
    generate_world(
        rng_from_u64(seed),
        &WorldGenConfig::compact(2030),
        &embedded_names(),
    )
}

fn json(world: &World) -> serde_json::Value {
    serde_json::to_value(world).expect("a world serializes")
}

/// Given the shipped nations and name pools compiled into the crate,
/// when a world is grown,
/// then every club has a squad, staff and a manager-less opening state the game accepts.
#[test]
fn a_world_grows_from_the_rules_alone() {
    let (teams, players, staff) = grow(5);

    assert!(!teams.is_empty());
    for team in &teams {
        let squad = players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some(team.id.as_str()))
            .count();
        assert!(squad >= 22, "{} has {squad} players", team.name);
        assert!(
            staff
                .iter()
                .any(|member| member.team_id.as_deref() == Some(team.id.as_str())),
            "{} has no staff",
            team.name
        );
    }
    assert!(
        players.iter().any(|player| player.team_id.is_none()),
        "free agents open the world"
    );
}

/// Given one seed,
/// when a world is grown twice,
/// then the two are identical, ids included; another seed grows another world.
#[test]
fn the_same_seed_grows_the_same_world() {
    let (first, second, other) = (grow(5), grow(5), grow(6));

    assert!(json(&first) == json(&second), "the two worlds differ");
    assert_ne!(first.1[0].id, other.1[0].id);
}
