//! A match's seed and the three generators it gives (online-match-engine-formulas.md §5.2, Q13):
//! one for the engine, one for the AI of each side. They are three ChaCha12 streams of the one
//! 32-byte key, so what the AI draws never moves what the engine draws.

use engine::Side;
use rand::SeedableRng;
use rand_chacha::ChaCha12Rng;
use serde::{Deserialize, Serialize};

/// The ChaCha stream (nonce) of each generator. The engine's is stream 0, which is what a bare
/// `ChaCha12Rng::from_seed(key)` reads: an offline match keyed as before draws the same engine
/// numbers it always did.
const ENGINE_STREAM: u64 = 0;
const HOME_AI_STREAM: u64 = 1;
const AWAY_AI_STREAM: u64 = 2;

/// Words of an AI stream each gap between two steps owns. One decision draws a handful, so gaps
/// never overlap, and what the AI draws after step N depends on N alone: not on whether the AI
/// held the side earlier, nor on a runner having restarted in between.
const AI_WORDS_PER_GAP: u128 = 1 << 32;

/// Everything random about one match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MatchSeed(pub [u8; 32]);

impl MatchSeed {
    /// The engine's generator, from its first word.
    pub fn engine_rng(&self) -> ChaCha12Rng {
        stream(self.0, ENGINE_STREAM)
    }

    /// The generator `side`'s AI decides with in the gap after step `step_seq`.
    pub fn ai_rng(&self, side: Side, step_seq: u32) -> ChaCha12Rng {
        let number = match side {
            Side::Home => HOME_AI_STREAM,
            Side::Away => AWAY_AI_STREAM,
        };
        let mut rng = stream(self.0, number);
        rng.set_word_pos(u128::from(step_seq) * AI_WORDS_PER_GAP);
        rng
    }
}

fn stream(key: [u8; 32], number: u64) -> ChaCha12Rng {
    let mut rng = ChaCha12Rng::from_seed(key);
    rng.set_stream(number);
    rng
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::Rng;

    const SEED: MatchSeed = MatchSeed([7; 32]);

    fn first_words(mut rng: ChaCha12Rng) -> [u32; 4] {
        [
            rng.next_u32(),
            rng.next_u32(),
            rng.next_u32(),
            rng.next_u32(),
        ]
    }

    /// Given a seed,
    /// when the engine's generator is made from it,
    /// then it reads exactly what a plain ChaCha12 on the same key reads: stream 0.
    #[test]
    fn the_engine_stream_is_the_plain_generator_of_the_key() {
        assert_eq!(
            first_words(SEED.engine_rng()),
            first_words(ChaCha12Rng::from_seed(SEED.0))
        );
    }

    /// Given a seed,
    /// when the three generators are made,
    /// then they read different numbers, and each AI gap starts somewhere of its own.
    #[test]
    fn the_three_streams_and_the_gaps_are_distinct() {
        let engine = first_words(SEED.engine_rng());
        let home = first_words(SEED.ai_rng(Side::Home, 0));
        let away = first_words(SEED.ai_rng(Side::Away, 0));
        assert_ne!(engine, home);
        assert_ne!(engine, away);
        assert_ne!(home, away);
        assert_ne!(home, first_words(SEED.ai_rng(Side::Home, 1)));
    }

    /// Given the generator of one AI gap,
    /// when it is made twice,
    /// then both read the same: a gap's draws depend on the seed, the side and the step only.
    #[test]
    fn an_ai_gap_is_the_same_every_time() {
        assert_eq!(
            first_words(SEED.ai_rng(Side::Away, 57)),
            first_words(SEED.ai_rng(Side::Away, 57))
        );
    }
}
