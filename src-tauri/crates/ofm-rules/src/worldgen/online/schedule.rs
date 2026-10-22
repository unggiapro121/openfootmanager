//! Which nation a region's club belongs to, from its ordinal alone (E3-5q §4.2, F2).
//!
//! A region's integer weights sum to `W`. Ordinals come in blocks of `W`; within a block each
//! nation holds fixed positions, laid out by smooth weighted round-robin so nations interleave
//! rather than clump. Club `ordinal` is then nation `schedule[ordinal % W]`, and its index within
//! that nation is `(ordinal / W) × weight + its rank within the block` — arithmetic, with no need
//! to know any other club.

/// A region's fixed deal of nations to ordinals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NationSchedule {
    /// The nation at each position of a block.
    positions: Vec<usize>,
    /// For each position, how many earlier positions of the block went to the same nation.
    rank: Vec<u64>,
    /// Each nation's weight (its positions per block).
    weights: Vec<u64>,
    codes: Vec<String>,
}

impl NationSchedule {
    /// The schedule for `(code, weight)` pairs, in order. `None` when no weight is positive.
    pub fn new(nations: &[(String, u16)]) -> Option<Self> {
        let weights: Vec<u64> = nations
            .iter()
            .map(|(_, weight)| u64::from(*weight))
            .collect();
        let total: u64 = weights.iter().sum();
        if total == 0 {
            return None;
        }
        // Smooth weighted round-robin: each step every nation gains its weight; the one now
        // highest takes the position and pays the total back. Ties go to the earlier nation.
        let mut current = vec![0i64; weights.len()];
        let mut positions = Vec::with_capacity(total as usize);
        let mut rank = Vec::with_capacity(total as usize);
        let mut taken = vec![0u64; weights.len()];
        for _ in 0..total {
            for (credit, weight) in current.iter_mut().zip(&weights) {
                *credit += *weight as i64;
            }
            let (best, _) = current
                .iter()
                .enumerate()
                .filter(|(at, _)| weights[*at] > 0)
                .fold((0usize, i64::MIN), |best, (at, credit)| {
                    if *credit > best.1 {
                        (at, *credit)
                    } else {
                        best
                    }
                });
            current[best] -= total as i64;
            positions.push(best);
            rank.push(taken[best]);
            taken[best] += 1;
        }
        Some(Self {
            positions,
            rank,
            weights,
            codes: nations.iter().map(|(code, _)| code.clone()).collect(),
        })
    }

    /// The nation of club `ordinal`, and the club's index among that nation's clubs.
    pub fn nation_of(&self, ordinal: u64) -> (&str, u64) {
        let block_len = self.positions.len() as u64;
        let (block, at) = (ordinal / block_len, (ordinal % block_len) as usize);
        let nation = self.positions[at];
        let index = block * self.weights[nation] + self.rank[at];
        (&self.codes[nation], index)
    }

    /// Clubs of each nation among the first `clubs` ordinals.
    pub fn clubs_per_nation(&self, clubs: u64) -> Vec<(String, u64)> {
        let mut counts = vec![0u64; self.codes.len()];
        let block_len = self.positions.len() as u64;
        for (nation, weight) in self.weights.iter().enumerate() {
            counts[nation] = clubs / block_len * weight;
        }
        for at in 0..(clubs % block_len) as usize {
            counts[self.positions[at]] += 1;
        }
        self.codes.iter().cloned().zip(counts).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region() -> NationSchedule {
        NationSchedule::new(&[("VN".into(), 10), ("TH".into(), 4), ("SG".into(), 1)])
            .expect("positive weights")
    }

    /// Given a region of three weighted nations,
    /// when ordinals are dealt one by one,
    /// then each nation's indices run 0, 1, 2… with no gap or repeat, exactly as the arithmetic
    /// of `nation_of` says without looking at any other club.
    #[test]
    fn each_nations_clubs_are_numbered_in_order_from_the_ordinal_alone() {
        let schedule = region();
        let mut next: std::collections::HashMap<String, u64> = Default::default();
        for ordinal in 0..300 {
            let (nation, index) = schedule.nation_of(ordinal);
            let expected = next.entry(nation.to_string()).or_default();
            assert_eq!(index, *expected, "ordinal {ordinal} of {nation}");
            *expected += 1;
        }
        assert_eq!(next["VN"], 200);
        assert_eq!(next["SG"], 20);
    }

    /// Given the same region,
    /// when one block is dealt,
    /// then the heavy nation is spread through it rather than bunched at its start.
    #[test]
    fn nations_interleave_within_a_block() {
        let schedule = region();
        let first: Vec<&str> = (0..5)
            .map(|ordinal| schedule.nation_of(ordinal).0)
            .collect();
        assert!(first.contains(&"TH"), "{first:?}");
        assert_eq!(
            schedule.clubs_per_nation(45),
            vec![
                ("VN".to_string(), 30),
                ("TH".to_string(), 12),
                ("SG".to_string(), 3)
            ]
        );
    }
}
