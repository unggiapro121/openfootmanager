//! The TypeScript declarations of the core types that cross from Rust to a client: squad,
//! tactics, attributes, coach progress and match events (phase 3, E3-6a; see
//! `fm-document/game-engine/phase 3/E3-6-tech-spec.md` §3.2).
//!
//! This crate has no code. Its test `tests/bindings.rs` renders the declarations and compares
//! them with the files committed under `src/bindings/core/` at the repository root; run it with
//! `UPDATE_BINDINGS=1` to write them. The online server's `contract` renders the same fork types
//! into its own bindings, at the tag it pins.
