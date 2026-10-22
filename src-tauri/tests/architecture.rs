//! Mechanical enforcement of the crate boundaries described in `src-tauri/CLAUDE.md` §1 and
//! `docs/ARCHITECTURE.md`.
//!
//! Until now the project's most important architectural rule — "`engine` never imports `domain`"
//! — was enforced by prose plus a review agent reading that prose. That is weak in a specific way:
//! the same document also claimed `ofm_core` depends on `db`, when the manifests say `db` depends
//! on `ofm_core`. A wrong diagram cannot catch a wrong dependency, and nobody noticed for a long
//! time. These tests check the manifests themselves, so they cannot drift from the code they
//! describe.
//!
//! # Why `cargo metadata` and not a grep over `Cargo.toml`
//!
//! A crate cannot `use domain::` without `domain` appearing in its own manifest, so manifest
//! granularity really is a complete check — but only if the manifest is *parsed*. Every one of
//! these declares a real dependency edge while evading a naive line match:
//!
//! - a dotted table, `[dependencies.domain]` (the root manifest already declares five deps this
//!   way, so this is a live spelling in this repo, not a hypothetical)
//! - workspace inheritance, `domain.workspace = true`
//! - a rename, `foo = { package = "domain" }`, which mentions `domain` only as a value
//! - `[dev-dependencies]`, which would let engine's own tests import `domain` — precisely the
//!   "only for testing" rationalisation the rule exists to stop
//! - `[build-dependencies]`, coupling a build script to it
//! - `[target.'cfg(windows)'.dependencies]`, a violation that exists on one platform only
//!
//! `cargo metadata` reports the resolved package name (so renames are seen through), the
//! dependency kind, and the target, which is why the assertions below can cover all of them.

use std::collections::BTreeSet;
use std::process::Command;

use serde_json::Value;

/// The core crates: the ones the online server (phase 3) compiles as well as the game. Each names
/// the workspace crates it may depend on, and the reason for the boundary.
const CORE: &[(&str, &[&str], &str)] = &[
    (
        "engine",
        &[],
        "The match engine defines its own mirror types (PlayerData, TeamData, Position, PlayStyle) \
         so it can be tested with synthetic data and evolved independently of the game's domain \
         model. `ofm_core/turn/` is the only place the conversion between them is allowed to live.",
    ),
    (
        "domain",
        &[],
        "`domain` is the bottom of the graph: plain structs and enums that everything else may \
         depend on. If it gains a dependency, it has stopped being data and started being logic.",
    ),
    (
        "ofm-rules",
        &["domain", "engine"],
        "`ofm-rules` holds the pure rules the online server runs exactly as the game does. It \
         reads `domain` data and drives the `engine` (the match session, phase 3 E3-3), and \
         nothing above them: a rule that needs `Game`, the calendar or the save belongs in \
         `ofm_core`, which re-exports these modules under their old paths.",
    ),
];

/// What a core crate must never pull in, by direct dependency: a desktop shell, a database, an
/// async runtime, a web server, the wall clock's calendar, random ids, archives, logging. The
/// server runs the core crates headless and replays a match from its inputs, so none of these may
/// reach a rule (phase 3, E3-0).
const PLATFORM_CRATES: &[&str] = &[
    "tauri", "rusqlite", "tokio", "axum", "chrono", "uuid", "zip", "log",
];

fn metadata() -> Value {
    // `CARGO` rather than a bare "cargo": cargo sets this for the test process, and it points at
    // the toolchain currently running the tests. A bare invocation can resolve to a different one.
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| String::from("cargo"));
    let manifest = concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml");

    let output = Command::new(cargo)
        .args([
            "metadata",
            "--no-deps",
            "--format-version",
            "1",
            "--manifest-path",
            manifest,
        ])
        .output()
        .expect("could not run `cargo metadata`");

    assert!(
        output.status.success(),
        "`cargo metadata` failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    serde_json::from_slice(&output.stdout).expect("`cargo metadata` emitted invalid JSON")
}

fn packages(meta: &Value) -> &Vec<Value> {
    meta["packages"]
        .as_array()
        .expect("`cargo metadata` output has no packages array")
}

/// Every crate in this workspace. `--no-deps` limits the output to workspace members, so this is
/// exactly the set a boundary rule can talk about.
fn workspace_crate_names(meta: &Value) -> BTreeSet<String> {
    packages(meta)
        .iter()
        .filter_map(|pkg| pkg["name"].as_str())
        .map(String::from)
        .collect()
}

fn package<'a>(meta: &'a Value, name: &str) -> &'a Value {
    packages(meta)
        .iter()
        .find(|pkg| pkg["name"].as_str() == Some(name))
        .unwrap_or_else(|| panic!("no crate named `{name}` in this workspace"))
}

/// Describes a dependency edge well enough to fix it, including the ones a grep would miss.
fn describe(dep: &Value) -> String {
    let name = dep["name"].as_str().unwrap_or("<unnamed>");

    // null = a normal dependency; otherwise "dev" or "build".
    let kind = match dep["kind"].as_str() {
        Some(kind) => format!("[{kind}-dependencies]"),
        None => String::from("[dependencies]"),
    };

    let mut description = format!("{name} in {kind}");

    if let Some(rename) = dep["rename"].as_str() {
        description.push_str(&format!(" (declared under the alias `{rename}`)"));
    }
    if let Some(target) = dep["target"].as_str() {
        description.push_str(&format!(" (only for target `{target}`)"));
    }
    if dep["optional"].as_bool() == Some(true) {
        description.push_str(" (optional)");
    }

    description
}

/// Every dependency of `crate_name`, across **all** dependency kinds, with the resolved name.
fn dependencies_of<'a>(meta: &'a Value, crate_name: &str) -> impl Iterator<Item = &'a Value> {
    package(meta, crate_name)["dependencies"]
        .as_array()
        .expect("package has no dependencies array")
        .iter()
}

/// Workspace dependencies of `crate_name` that are not in `allowed`, across all dependency kinds.
fn forbidden_workspace_dependencies_of(
    meta: &Value,
    crate_name: &str,
    allowed: &[&str],
) -> Vec<String> {
    let workspace = workspace_crate_names(meta);

    dependencies_of(meta, crate_name)
        .filter(|dep| {
            dep["name"]
                .as_str()
                .is_some_and(|name| workspace.contains(name) && !allowed.contains(&name))
        })
        .map(describe)
        .collect()
}

/// Given the workspace manifests,
/// when each core crate's dependencies are resolved,
/// then it depends on no workspace crate outside its allowed list.
#[test]
fn core_crates_depend_only_on_their_allowed_workspace_crates() {
    let meta = metadata();

    for (crate_name, allowed, rationale) in CORE {
        let violations = forbidden_workspace_dependencies_of(&meta, crate_name, allowed);

        assert!(
            violations.is_empty(),
            "`{crate_name}` may depend only on {allowed:?} in this workspace, but declares:\n\
             \n  {}\n\n\
             {rationale}\n\n\
             Adding this dependency \"to avoid duplication\" is the single most damaging change \
             available in this codebase. If `engine` needs a new field, add it to the engine's own \
             type and extend the bridge in `ofm_core/turn/`.\n\
             See docs/ARCHITECTURE.md \"Engine Isolation\" and src-tauri/CLAUDE.md §1.",
            violations.join("\n  "),
        );
    }
}

/// Given the workspace manifests,
/// when each core crate's dependencies are resolved,
/// then none of them is a platform crate (desktop shell, database, runtime, clock, ids, logging),
/// so the server can build the core crates headless.
#[test]
fn core_crates_use_no_platform_dependencies() {
    let meta = metadata();

    for (crate_name, _, _) in CORE {
        let violations: Vec<String> = dependencies_of(&meta, crate_name)
            .filter(|dep| {
                dep["name"].as_str().is_some_and(|name| {
                    PLATFORM_CRATES
                        .iter()
                        .any(|platform| name == *platform || name.starts_with("tauri"))
                })
            })
            .map(describe)
            .collect();

        assert!(
            violations.is_empty(),
            "`{crate_name}` is a core crate and must not depend on a platform crate, but declares:\n\
             \n  {}\n\n\
             The online server compiles the core crates and replays matches from their inputs. \
             Keep I/O, clocks, random ids and logging in `ofm_core` or the app.",
            violations.join("\n  "),
        );
    }
}

#[test]
fn the_core_crates_still_exist() {
    // Guards the assertions above against silently passing if a crate is renamed or removed: an
    // empty violation list is also what "this crate is gone" looks like.
    let names = workspace_crate_names(&metadata());

    for (crate_name, _, _) in CORE {
        assert!(
            names.contains(*crate_name),
            "`{crate_name}` is no longer a workspace member, so the boundary tests above are \
             vacuously passing. Either restore the crate or update CORE to match the new \
             architecture — deliberately, not by deleting the test.",
        );
    }
}

/// Given the workspace's sources,
/// when they are searched for a read of the calibration knob file,
/// then only sim-bench and the real-world probes read `OFM_KNOBS`: the game
/// plays the tuned constants and never a file (phase 2, GĐ5 X82).
#[test]
fn only_the_measuring_tools_read_the_knob_file() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let needle = concat!("\"OFM_", "KNOBS\"");
    let mut readers = BTreeSet::new();
    let mut stack = vec![root.join("src"), root.join("crates")];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("a readable source directory") {
            let path = entry.expect("a directory entry").path();
            if path.is_dir() {
                if path.file_name().is_some_and(|name| name != "target") {
                    stack.push(path);
                }
            } else if path.extension().is_some_and(|ext| ext == "rs")
                && std::fs::read_to_string(&path).is_ok_and(|text| text.contains(needle))
            {
                let relative = path.strip_prefix(root).expect("under the root");
                readers.insert(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    let expected: BTreeSet<String> = [
        "crates/sim-bench/src/main.rs",
        "src/commands/game/real_world_probe.rs",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    assert_eq!(readers, expected);
}
