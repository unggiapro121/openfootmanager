//! Pure game rules shared by the game and its online server (phase 3, E3-2).
//!
//! Everything here is a function of its inputs: no `Game`, no calendar, no I/O, no wall clock and
//! no unseeded randomness (`clippy.toml` makes the last two lint errors). The game reaches these
//! modules through `ofm_core`, which re-exports each under its old path; the online server
//! depends on this crate directly, so it runs the very rules the game runs.
//!
//! A rule belongs here when it decides an outcome from data the server will also hold. A rule
//! that walks the world day by day, reads the save or talks to the player stays in `ofm_core`.

pub mod ai_math;
pub mod ai_roles;
pub mod coach_progress;
pub mod facilities;
pub mod lineup_assignment;
pub mod mastery_xp;
pub mod match_form;
pub mod player_rating;
pub mod player_wear;
pub mod playing_time;
pub mod stable_hash;
