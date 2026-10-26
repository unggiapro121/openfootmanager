//! A youth scout's candidates are world entities the server keeps with the rules' version
//! (phase 4, E4-1 §5): a change that finds other candidates for the same trip must move
//! `WORLD_RULES_VERSION`. Pinned apart from `world_rules_version.rs`, so adding it moved no old pin.

use ofm_rules::WORLD_RULES_VERSION;
use ofm_rules::academy::AcademyRules;
use ofm_rules::stable_hash::stable_hash;
use ofm_rules::worldgen::online::{
    Generator, OnlineContentPack, ScoutFocus, ScoutKey, ScoutRequest,
};

/// The pinned pair. Change only together with `WORLD_RULES_VERSION` (see the assertion).
const SCOUT_RULES_PIN: (&str, u64) = ("3", 0xCA7E_A046_9287_F517);

/// A fingerprint of twenty trips from one world: every focus, some with an elite ticket, each
/// candidate as stored (through `Persisted`, so his potential counts) with his secret offsets.
fn scout_digest() -> u64 {
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(7, &pack).expect("a generator");
    let rules = AcademyRules::default();
    let focuses = [
        ScoutFocus::Physical,
        ScoutFocus::Technical,
        ScoutFocus::Balanced,
    ];
    let trips: Vec<serde_json::Value> = (0..20u64)
        .map(|trip| {
            let request = ScoutRequest {
                region: if trip % 2 == 0 { "AsiaSoutheast" } else { "Europe" }.into(),
                focus: focuses[(trip % 3) as usize],
                elite: trip % 4 == 0,
            };
            let key = ScoutKey {
                account_id: format!("account-{}", trip % 5),
                trip,
            };
            let found = generator
                .scout_report(&key, &request, &rules, 2026)
                .expect("a report");
            let rows: Vec<serde_json::Value> = found
                .iter()
                .map(|candidate| {
                    serde_json::json!({
                        "player": serde_json::to_value(domain::persisted::Persisted(&candidate.player))
                            .expect("json"),
                        "reveal": candidate.reveal,
                    })
                })
                .collect();
            serde_json::Value::Array(rows)
        })
        .collect();
    stable_hash(serde_json::Value::Array(trips).to_string().as_bytes(), 0)
}

/// Given the trips the current rules find and the rules' version,
/// when their digest is taken,
/// then the pair matches the pin.
#[test]
fn scout_rules_move_with_world_rules_version() {
    let actual = (WORLD_RULES_VERSION, scout_digest());
    assert_eq!(
        actual, SCOUT_RULES_PIN,
        "the scouted candidates or WORLD_RULES_VERSION changed.\n\
         If the candidates moved on purpose, bump WORLD_RULES_VERSION in crates/ofm-rules/src/lib.rs,\n\
         then set SCOUT_RULES_PIN to (\"<new version>\", 0x{:016X}).",
        actual.1
    );
}
