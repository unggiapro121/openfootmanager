//! The minute hash (ARCHITECTURE.md §8.3): a fingerprint of the match after each step, chained
//! from the one before, so a replay that drifts anywhere is caught at the first step it differs.
//!
//! A step's fingerprint holds what the step did (its events, the score, the clock, the ball) and
//! the inputs applied in the gap before it. The inputs stand in for the sides' shape, roles and
//! dials, which only they change: a replay missing a command, or holding an extra one, parts from
//! the original at the very next step, whether or not that command has changed a ball yet.

use engine::{MatchEvent, MatchPhase, MinuteResult, Side, Zone};
use serde::Serialize;

use super::input::InputRecord;

/// The starting state of the word hash, so a minute hash shares nothing with other hashes.
const MINUTE_HASH_SALT: u64 = 0x6d69_6e75_7465_0001;
const MULTIPLIER: u64 = 0x9E37_79B9_7F4A_7C15;

#[derive(Serialize)]
struct StepSummary<'a> {
    previous: u64,
    step_seq: u32,
    inputs_before: &'a [InputRecord],
    phase: MatchPhase,
    minute: u8,
    score: (u8, u8),
    possession: Side,
    ball_zone: Zone,
    events: &'a [MatchEvent],
}

/// The hash of the match after step `step_seq`, which produced `result` after the gap whose
/// inputs were `inputs_before`.
pub(super) fn minute_hash(
    previous: u64,
    step_seq: u32,
    inputs_before: &[InputRecord],
    result: &MinuteResult,
) -> u64 {
    let summary = StepSummary {
        previous,
        step_seq,
        inputs_before,
        phase: result.phase,
        minute: result.minute,
        score: (result.home_score, result.away_score),
        possession: result.possession,
        ball_zone: result.ball_zone,
        events: &result.events,
    };
    // Serialising plain data with derived `Serialize` cannot fail; an empty string would still
    // hash, and any drift shows in the events and scores that follow.
    let bytes = serde_json::to_vec(&summary).unwrap_or_default();
    word_hash(&bytes)
}

/// A hash of `bytes` taken eight at a time, little-endian, so it is the same on every machine.
/// A step's summary runs to a few kilobytes; byte-at-a-time FNV made hashing cost a third of the
/// match (E3-3 measurement), which this does not.
fn word_hash(bytes: &[u8]) -> u64 {
    let mut chunks = bytes.chunks_exact(8);
    let mut hash = MINUTE_HASH_SALT ^ bytes.len() as u64;
    for chunk in &mut chunks {
        let mut word = [0u8; 8];
        word.copy_from_slice(chunk);
        hash = mix(hash, u64::from_le_bytes(word));
    }
    let mut tail = [0u8; 8];
    tail[..chunks.remainder().len()].copy_from_slice(chunks.remainder());
    mix(hash, u64::from_le_bytes(tail))
}

fn mix(hash: u64, word: u64) -> u64 {
    (hash ^ word).wrapping_mul(MULTIPLIER).rotate_left(29)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given the bytes of a summary,
    /// when they are hashed,
    /// then the value is pinned: stored minute hashes must still match after any refactor, and a
    /// one-byte change, or a change of length alone, moves it.
    #[test]
    fn the_word_hash_is_pinned_and_sensitive() {
        assert_eq!(word_hash(b"step 1: 0-0"), 0x53C1_B2CB_0A86_6850);
        assert_ne!(word_hash(b"step 1: 0-0"), word_hash(b"step 1: 0-1"));
        assert_ne!(word_hash(b"abc"), word_hash(b"abc\0"));
    }
}
