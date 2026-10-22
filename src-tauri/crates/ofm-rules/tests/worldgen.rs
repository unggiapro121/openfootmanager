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

/// The world with every name blanked, so two worlds compare on everything else.
fn without_names(world: &World) -> serde_json::Value {
    let mut value = json(world);
    for player in value[1].as_array_mut().expect("players") {
        player["full_name"] = serde_json::Value::Null;
        player["match_name"] = serde_json::Value::Null;
    }
    for member in value[2].as_array_mut().expect("staff") {
        member["first_name"] = serde_json::Value::Null;
        member["last_name"] = serde_json::Value::Null;
    }
    value
}

/// Given one seed and two different sets of name pools,
/// when a world is grown from each,
/// then the people have other names but the same ids, ages, bodies and attributes: a name is
/// drawn from its own stream, so new pools rename people and never re-roll them (E3-5q F13).
#[test]
fn other_name_pools_change_names_and_nothing_else() {
    let names = embedded_names();
    let mut renamed = names.clone();
    // Dropping pools sends their nationals down the borrowing path, which draws more: on a shared
    // stream that would shift every draw after the name.
    renamed
        .pools
        .retain(|code, _| !matches!(code.as_str(), "ES" | "IT" | "PT" | "BR"));
    for pool in renamed.pools.values_mut() {
        pool.first_names.reverse();
        pool.last_names.truncate(11);
    }
    let config = WorldGenConfig::compact(2030);

    let first = generate_world(rng_from_u64(5), &config, &names);
    let second = generate_world(rng_from_u64(5), &config, &renamed);

    assert!(
        first
            .1
            .iter()
            .zip(&second.1)
            .any(|(a, b)| a.full_name != b.full_name),
        "the pools changed, so some names must"
    );
    assert!(
        without_names(&first) == without_names(&second),
        "something besides a name changed"
    );
}
