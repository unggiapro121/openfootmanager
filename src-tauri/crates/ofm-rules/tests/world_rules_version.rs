//! `WORLD_RULES_VERSION` moves with the worlds the rules grow (E3-5q F12), as `ENGINE_VERSION`
//! moves with the golden matches: every generated entity records the version it was made by, so
//! a change that makes a different world under the same version would make two worlds claim one.

use ofm_rules::WORLD_RULES_VERSION;
use ofm_rules::seed::rng_from_u64;
use ofm_rules::stable_hash::stable_hash;
use ofm_rules::worldgen::clubs::WorldGenConfig;
use ofm_rules::worldgen::definitions::embedded_names;
use ofm_rules::worldgen::generate_world;
use ofm_rules::worldgen::online::{Generator, OnlineContentPack};

/// The pinned pair. Change only together with `WORLD_RULES_VERSION` (see the assertion).
const WORLD_RULES_PIN: (&str, u64) = ("1", 0x77C2_4E42_7A8C_D987);

/// A fingerprint of what the rules grow: a desktop world and fourteen online clubs with free
/// agents, as JSON values (sorted maps, so a `HashMap` field's order cannot move it). Through
/// `Persisted`: a player serialised any other way hides his potential and the Wonderkid trait,
/// and the fingerprint would not see a change to either.
fn worlds_digest() -> u64 {
    let persisted = |value: &dyn erased::Json| value.persisted();
    let desktop = generate_world(
        rng_from_u64(7),
        &WorldGenConfig::compact(2030),
        &embedded_names(),
    );
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(7, &pack).expect("a generator");
    let clubs: Vec<serde_json::Value> = (0..14)
        .map(|ordinal| {
            let club = generator
                .club("AsiaSoutheast", ordinal, 0, 2026, None)
                .expect("a club");
            serde_json::json!({"team": club.team, "players": persisted(&club.players),
                "staff": club.staff, "coach": club.coach, "bot": club.bot_account_id})
        })
        .collect();
    let free = generator.free_agents(0, 20, 2026).expect("free agents");
    let all = serde_json::json!({"desktop": persisted(&desktop), "online": clubs, "free": persisted(&free)});
    stable_hash(all.to_string().as_bytes(), 0)
}

mod erased {
    /// Anything serialisable, as a JSON value written for storage.
    pub trait Json {
        fn persisted(&self) -> serde_json::Value;
    }

    impl<T: serde::Serialize> Json for T {
        fn persisted(&self) -> serde_json::Value {
            serde_json::to_value(domain::persisted::Persisted(self)).expect("json")
        }
    }
}

/// Given the worlds the current rules grow and the rules' version,
/// when their digest is taken,
/// then the pair matches the pin.
#[test]
fn world_rules_version_moves_with_the_worlds_it_grows() {
    let actual = (WORLD_RULES_VERSION, worlds_digest());
    assert_eq!(
        actual, WORLD_RULES_PIN,
        "the generated worlds or WORLD_RULES_VERSION changed.\n\
         If the worlds moved on purpose, bump WORLD_RULES_VERSION in crates/ofm-rules/src/lib.rs,\n\
         then set WORLD_RULES_PIN to (\"<new version>\", 0x{:016X}).",
        actual.1
    );
}
