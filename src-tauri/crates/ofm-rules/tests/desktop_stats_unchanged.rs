//! E3-5q2 changes what the desktop's random worlds are called, never what they are (E3-5q §4.7,
//! F11, F13): a person's name is drawn from a stream of its own, a club's name, stadium and kit
//! from a keyed one, so every number of every person and club stays as it was.

use ofm_rules::seed::rng_from_u64;
use ofm_rules::stable_hash::stable_hash;
use ofm_rules::worldgen::clubs::WorldGenConfig;
use ofm_rules::worldgen::definitions::embedded_names;
use ofm_rules::worldgen::generate_world;
use serde_json::Value;

/// The digest of the three standard worlds of seeds 1–3, opening in 2026, without their words:
/// measured on `staging` b3ca20a4, before E3-5q2 touched the desktop's names. Re-pinned when the
/// attribute profiles were redrawn from real players (`worldgen::attribute_shape`,
/// WORLD_RULES_VERSION 4): from then on it guards the numbers against a name-only change.
const STATS_PIN: u64 = 0x8C1A_A5ED_5E41_7EF5;

/// Fields that are words, not numbers: what a name, a place or a kit is.
const WORDS: [&str; 10] = [
    "full_name",
    "match_name",
    "first_name",
    "last_name",
    "name",
    "short_name",
    "city",
    "stadium_name",
    "colors",
    "kit_pattern",
];

fn without_words(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for key in WORDS {
                map.remove(key);
            }
            for inner in map.values_mut() {
                without_words(inner);
            }
        }
        Value::Array(items) => items.iter_mut().for_each(without_words),
        _ => {}
    }
}

fn stats_digest() -> u64 {
    let mut worlds = Vec::new();
    for seed in 1..=3 {
        let (teams, players, staff) = generate_world(
            rng_from_u64(seed),
            &WorldGenConfig::standard(2026),
            &embedded_names(),
        );
        let mut world = serde_json::json!({
            "teams": serde_json::to_value(domain::persisted::Persisted(&teams)).expect("json"),
            "players": serde_json::to_value(domain::persisted::Persisted(&players)).expect("json"),
            "staff": serde_json::to_value(domain::persisted::Persisted(&staff)).expect("json"),
        });
        without_words(&mut world);
        worlds.push(world);
    }
    stable_hash(Value::Array(worlds).to_string().as_bytes(), 0)
}

/// Given the standard desktop worlds of seeds 1–3,
/// when everything in them but their words is digested,
/// then the digest is the one measured before the package: only names changed.
#[test]
fn the_desktop_worlds_keep_every_number() {
    let actual = stats_digest();
    assert_eq!(
        actual, STATS_PIN,
        "the desktop worlds' numbers moved: 0x{actual:016X}"
    );
}

/// Given the standard desktop worlds of seeds 1–3,
/// when every person's and every club's name is checked against the protected lists,
/// then none is a protected person's (in either order) and none is a blocked club name.
#[test]
fn no_desktop_name_is_a_real_famous_one() {
    use ofm_rules::worldgen::online::OnlineContentPack;
    use ofm_rules::worldgen::online::names::is_protected_person;
    use ofm_rules::worldgen::online::naming::is_blocked_club_name;
    let pack = OnlineContentPack::builtin_shared();
    for seed in 1..=3 {
        let (teams, players, staff) = generate_world(
            rng_from_u64(seed),
            &WorldGenConfig::standard(2026),
            &embedded_names(),
        );
        let people = players.iter().map(|player| player.full_name.clone()).chain(
            staff
                .iter()
                .map(|member| format!("{} {}", member.first_name, member.last_name)),
        );
        let protected: Vec<String> = people
            .filter(|name| is_protected_person(name, &[]))
            .collect();
        assert!(protected.is_empty(), "seed {seed}: {protected:?}");
        let blocked: Vec<&str> = teams
            .iter()
            .filter(|team| is_blocked_club_name(&team.name, &team.country, pack))
            .map(|team| team.name.as_str())
            .collect();
        assert!(blocked.is_empty(), "seed {seed}: {blocked:?}");
    }
}

/// Given two standard desktop worlds of other seeds,
/// when their club names are compared,
/// then they differ: a world's names are keyed by its seed, not shared by every world.
#[test]
fn worlds_of_other_seeds_name_their_clubs_otherwise() {
    let names = |seed| {
        let (teams, _, _) = generate_world(
            rng_from_u64(seed),
            &WorldGenConfig::standard(2026),
            &embedded_names(),
        );
        teams.into_iter().map(|team| team.name).collect::<Vec<_>>()
    };
    let (one, two) = (names(1), names(2));
    let same = one.iter().zip(&two).filter(|(a, b)| a == b).count();
    assert!(
        same * 10 < one.len(),
        "{same} of {} club names the same",
        one.len()
    );
}
