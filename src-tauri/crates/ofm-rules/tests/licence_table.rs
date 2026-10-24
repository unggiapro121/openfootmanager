//! The licence table only ever opens more (phase 3, S-9 S9-21). A release that moved a control to
//! a higher licence would turn a setup that was allowed into one that is not, so each licence of
//! the table in code must hold everything the same licence held in the pinned table.
//!
//! Opening more (a control moved to a lower licence, or a new one) is deliberate: re-pin with
//! `UPDATE_LICENCE_TABLE=1 cargo test -p ofm-rules --test licence_table`. Closing anything fails,
//! whatever the variable says.

use std::collections::BTreeSet;
use std::path::PathBuf;

use ofm_rules::licence::{ELITE, LicenceControls, controls};

fn pinned_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/licence_table.json")
}

fn table() -> Vec<LicenceControls> {
    (1..=ELITE).map(controls).collect()
}

/// Every control a licence opens, as `kind:name`.
fn opened(licence: &serde_json::Value) -> BTreeSet<String> {
    let mut items = BTreeSet::new();
    for kind in ["formations", "playStyles", "dials", "roles"] {
        for item in licence[kind].as_array().into_iter().flatten() {
            items.insert(format!("{kind}:{item}"));
        }
    }
    items
}

/// Given the pinned table and the table in code,
/// when each licence of the two is compared,
/// then the code's licence holds everything the pinned one held: nothing was closed.
#[test]
fn the_licence_table_only_opens_more() {
    let current = serde_json::to_value(table()).expect("the table writes");
    let pinned: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(pinned_path()).expect("the pinned table is committed"),
    )
    .expect("the pinned table reads");
    let pinned = pinned.as_array().expect("an array of licences");
    for (tier, was) in pinned.iter().enumerate() {
        let now = &current[tier];
        let closed: Vec<String> = opened(was).difference(&opened(now)).cloned().collect();
        assert!(
            closed.is_empty(),
            "licence {} closes what it opened: {closed:?}",
            tier + 1
        );
    }
    if std::env::var_os("UPDATE_LICENCE_TABLE").is_some() {
        let text = serde_json::to_string_pretty(&current).expect("the table writes") + "\n";
        std::fs::write(pinned_path(), text).expect("the pinned table writes");
    } else {
        assert_eq!(
            &current,
            &serde_json::Value::Array(pinned.clone()),
            "the table opens more than the pin: re-pin with UPDATE_LICENCE_TABLE=1"
        );
    }
}
