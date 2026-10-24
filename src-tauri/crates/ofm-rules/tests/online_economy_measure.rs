//! E3-10: one online season of money for starter leagues, under the S-10 rules, so the season's
//! ruleset values can be chosen from numbers instead of guesses (S-10/S-11 tech-spec §6, Qe3).
//! Run by hand:
//! `cargo test --release -p ofm-rules --test online_economy_measure -- --ignored --nocapture`.
//!
//! Every club starts with the opening cash, takes the gate of its 13 home games, pays 52 weeks of
//! wages over the 28 season days and gets the reward of a finishing place. The places are dealt
//! round-robin by a fixed shuffle: strength decides a real table, but money is the question here,
//! not who wins. No transfer is modelled, so the tax is left out and the drift printed is the
//! drift before any trade.

use ofm_rules::economy::{online_ticket_income, online_wage, rank_reward, wage_due};
use ofm_rules::worldgen::online::{Generator, OnlineContentPack};

const SEASON_DAYS: u32 = 28;
const HOME_GAMES: u64 = 13;
const OPENING_CASH: u64 = 3_000_000;
const LEVEL_ONE_REWARDS: [u64; 14] = [
    1_500_000, 1_150_000, 900_000, 750_000, 620_000, 520_000, 440_000, 370_000, 310_000, 260_000,
    220_000, 180_000, 150_000, 120_000,
];
const LEAGUES: u64 = 40;

struct Club {
    reputation: u32,
    capacity: u32,
    weekly_bill: u64,
}

/// Given 40 starter leagues of the builtin pack,
/// when a season of gates, wages and rewards is played for several ticket scales,
/// then each club's money and the money supply's drift are printed.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure_e3_10_one_online_season() {
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(2026, &pack).unwrap();
    let clubs: Vec<Club> = (0..LEAGUES * 14)
        .map(|ordinal| {
            let club = generator.club("Europe", ordinal, 0, 2026, None).unwrap();
            let reputation = club.team.reputation;
            let weekly_bill = club
                .players
                .iter()
                .map(|p| online_wage(p, reputation, 1000))
                .sum();
            Club {
                reputation,
                capacity: club.team.stadium_capacity,
                weekly_bill,
            }
        })
        .collect();

    let mut bills: Vec<u64> = clubs.iter().map(|c| c.weekly_bill).collect();
    bills.sort_unstable();
    let pick = |q: usize| bills[(bills.len() - 1) * q / 100];
    println!(
        "E3-10 — {} starter clubs (pack {}, Europe, seed 2026), reputation {} / {} seats",
        clubs.len(),
        pack.version,
        clubs[0].reputation,
        clubs[0].capacity
    );
    println!(
        "weekly wage bill: min {} p10 {} median {} p90 {} max {}",
        bills[0],
        pick(10),
        pick(50),
        pick(90),
        bills[bills.len() - 1]
    );
    let median = pick(50);
    let season_wages: u64 = (0..SEASON_DAYS)
        .map(|d| wage_due(median, d, SEASON_DAYS))
        .sum();
    println!(
        "median club, one season of wages: football year (x52/28 a day) {season_wages}; requirement's /7 a day {}",
        median * u64::from(SEASON_DAYS) / 7
    );
    println!();
    println!(
        "ticket ‰ | gate/match | median club Δcash | worst Δcash (rank 14, top bill) | best Δcash | clubs losing cash | supply drift/season"
    );
    for permille in [300, 400, 450, 500, 600, 1000] {
        season_at(&clubs, permille);
    }
}

fn season_at(clubs: &[Club], permille: u32) {
    let mut deltas = Vec::with_capacity(clubs.len());
    for (index, club) in clubs.iter().enumerate() {
        let rank = shuffled_rank(index);
        let gate = online_ticket_income(club.reputation, club.capacity, permille);
        let wages: u64 = (0..SEASON_DAYS)
            .map(|d| wage_due(club.weekly_bill, d, SEASON_DAYS))
            .sum();
        let reward = rank_reward(&LEVEL_ONE_REWARDS, rank, 1, 1250);
        let income = gate * HOME_GAMES + reward;
        deltas.push((income as i64 - wages as i64, rank, club.weekly_bill));
    }
    let gate = online_ticket_income(clubs[0].reputation, clubs[0].capacity, permille);
    let mut sorted: Vec<i64> = deltas.iter().map(|d| d.0).collect();
    sorted.sort_unstable();
    let median = sorted[sorted.len() / 2];
    let worst = deltas
        .iter()
        .filter(|d| d.1 == 14)
        .max_by_key(|d| d.2)
        .map_or(0, |d| d.0);
    let best = sorted[sorted.len() - 1];
    let losing = sorted.iter().filter(|d| **d < 0).count();
    let supply_before = OPENING_CASH as i64 * clubs.len() as i64;
    let drift = sorted.iter().sum::<i64>() as f64 / supply_before as f64 * 100.0;
    println!(
        "{permille:>8} | {gate:>10} | {median:>17} | {worst:>31} | {best:>10} | {losing:>5}/{:<5} | {drift:>+6.1}%",
        clubs.len()
    );
}

/// The finishing place (1–14) of the club at `index`: a fixed shuffle inside each league, so a
/// club's place does not follow the order clubs were generated in.
fn shuffled_rank(index: usize) -> usize {
    let league = index / 14;
    let seat = index % 14;
    (seat * 5 + league * 3) % 14 + 1
}
