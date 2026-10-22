//! Named streams of randomness from a seed (phase 3, E3-5b): the generators the game's day path
//! draws from, shared with the online server so a rule that rolls dice rolls the same ones there.
//! ChaCha12 by name, keys expanded from `stable_hash`: the same answer on every toolchain and
//! after any dependency bump. `ofm_core::seed` puts them on a `Game` (`rng_for`, `rng_today`).

use rand::SeedableRng;
use rand_chacha::ChaCha12Rng;

use crate::stable_hash::stable_hash;

/// A generator from a bare `u64`, for callers handed only a number (a team talk's seed). The
/// same algorithm as [`Game::rng_for`], so nothing on the day path depends on `StdRng`.
pub fn rng_from_u64(seed: u64) -> ChaCha12Rng {
    ChaCha12Rng::seed_from_u64(seed)
}

/// [`Game::rng_for`] for a seed that is not (yet) on a game: a world being built into one.
pub fn rng_for_seed(seed: u64, tag: &str, date: &str) -> ChaCha12Rng {
    let per_purpose = stable_hash(tag.as_bytes(), seed);
    expand_to_rng(stable_hash(date.as_bytes(), per_purpose), per_purpose)
}

/// A generator for something described by `key` alone, for the builders of news and
/// messages that are handed only what the story is about and have no game to ask.
///
/// The same key is the same stream on every replay, so a builder that draws from it
/// writes the same story each time; different keys are different streams. Like
/// [`variant_for`] it is wording, so it carries no game seed.
pub fn rng_from_key(key: &str) -> ChaCha12Rng {
    expand_to_rng(
        stable_hash(key.as_bytes(), KEYED_STREAM_SALT),
        KEYED_STREAM_SALT,
    )
}

/// Keeps a keyed stream from being the same stream as a `rng_for` on the same text.
const KEYED_STREAM_SALT: u64 = 0x7a51_0000_7a51_0002;

/// Four hashes chained from `word`, each of the one before, make the 32-byte ChaCha key, so
/// every byte of it depends on everything `word` was made from.
fn expand_to_rng(mut word: u64, chain_salt: u64) -> ChaCha12Rng {
    let mut key = [0u8; 32];
    for chunk in key.chunks_exact_mut(8) {
        chunk.copy_from_slice(&word.to_le_bytes());
        word = stable_hash(&word.to_le_bytes(), chain_salt);
    }
    ChaCha12Rng::from_seed(key)
}

/// Which of `count` phrasings a message is written in, chosen from what the message is.
///
/// Wording is the one random choice that needs no seed: nothing depends on which of two
/// greetings an inbox item uses, and a pick made from `key` — the message's own id, which
/// names the event, the player and the day — is the same on every replay with no
/// generator to thread through every builder. Different events still get different
/// phrasings, because different keys hash differently.
///
/// `count` must be non-zero.
pub fn variant_for(key: &str, count: usize) -> usize {
    (stable_hash(key.as_bytes(), VARIANT_SALT) % count as u64) as usize
}

/// Keeps a phrasing pick from being the same number as any other use of `stable_hash`
/// on the same string.
const VARIANT_SALT: u64 = 0x7a51_0000_7a51_0001;
