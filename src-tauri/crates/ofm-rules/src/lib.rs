//! Pure game rules shared by the game and its online server (phase 3, E3-2).
//!
//! Everything here is a function of its inputs: no `Game`, no calendar, no I/O, no wall clock and
//! no unseeded randomness (`clippy.toml` makes the last two lint errors). The game reaches these
//! modules through `ofm_core`, which re-exports each under its old path; the online server
//! depends on this crate directly, so it runs the very rules the game runs.
//!
//! A rule belongs here when it decides an outcome from data the server will also hold. A rule
//! that walks the world day by day, reads the save or talks to the player stays in `ofm_core`.

/// The version of the rules a world is grown and run by — the generator, its data and
/// blocklists, training and aging — apart from the match (`engine::ENGINE_VERSION`). Every
/// generated entity records it; a change that moves a generated world must bump it, which
/// `tests/world_rules_version.rs` enforces (E3-5q F12).
pub const WORLD_RULES_VERSION: &str = "5";

pub mod academy;
pub mod age;
pub mod aging;
pub mod ai_formation;
pub mod ai_math;
pub mod ai_roles;
pub mod ai_tactics;
pub mod ai_training;
pub mod assigned_traits;
pub mod attribute_split;
pub mod bot_level;
pub mod coach_progress;
pub mod economy;
pub mod facilities;
pub mod facility_works;
pub mod growth_cap;
pub mod items;
pub mod level_caps;
pub mod licence;
pub mod lineup_assignment;
pub mod market_ai;
pub mod mastery_xp;
pub mod match_form;
pub mod match_growth;
pub mod match_morale;
pub mod match_session;
pub mod match_summary;
pub mod matchday;
pub mod nations;
pub mod player_identity;
pub mod player_rating;
pub mod player_wear;
pub mod playing_time;
pub mod recovery;
pub mod season;
pub mod season_stats;
pub mod seed;
pub mod setup;
pub mod squad;
pub mod stable_hash;
#[cfg(test)]
mod test_support;
pub mod training;
pub mod valuation;
pub mod worldgen;
pub mod youth;
