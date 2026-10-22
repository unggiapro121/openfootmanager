//! What E3-5b's changes of behaviour do to the numbers (E5, E6, E7). Run by hand:
//! `cargo test --release -p ofm-rules --test world_rules_measure -- --ignored --nocapture`.
//! Each measurement compares the rule as it was with the rule as it is, on the same population.

/// A small deterministic generator for the synthetic populations (not a game stream).
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }

    fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }
}

fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in(year: i32, month: u32) -> u32 {
    match month {
        2 if is_leap(year) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn ordinal(year: i32, month: u32, day: u32) -> u32 {
    (1..month).map(|m| days_in(year, m)).sum::<u32>() + day
}

/// 100,000 birth dates spread evenly over 1985–2009, the ages a world's players have.
fn births() -> Vec<(i32, u32, u32)> {
    let mut rng = Lcg(0xB127_4DA7);
    (0..100_000)
        .map(|_| {
            let year = 1985 + rng.below(25) as i32;
            let month = 1 + rng.below(12) as u32;
            let day = 1 + rng.below(u64::from(days_in(year, month))) as u32;
            (year, month, day)
        })
        .collect()
}

/// The two rules E7 replaced: the day-of-year comparison (aging, contracts, awards) and the year
/// subtraction (training).
fn old_ordinal_age(birth: (i32, u32, u32), on: (i32, u32, u32)) -> i32 {
    let mut age = on.0 - birth.0;
    if ordinal(on.0, on.1, on.2) < ordinal(birth.0, birth.1, birth.2) {
        age -= 1;
    }
    age
}

/// Given 100,000 players born over 1985–2009,
/// when their age is taken on a season's first day, a mid-season day and the season's end by the
/// old rules and by the one rule,
/// then the share whose age changes, and what that does to the training age factor, is printed.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure_e7_one_age_rule() {
    use ofm_rules::age::age_on_day;
    use ofm_rules::training::age_factor;

    println!("E7 — một hàm tuổi (100.000 ngày sinh 1985–2009)");
    for on in [(2025, 7, 1), (2026, 1, 15), (2026, 6, 30), (2028, 12, 30)] {
        let mut ordinal_differs = 0;
        let mut training_differs = 0;
        let (mut old_factor, mut new_factor) = (0.0, 0.0);
        for &birth in &births() {
            let iso = format!("{:04}-{:02}-{:02}", birth.0, birth.1, birth.2);
            let new = age_on_day(&iso, on.0, on.1, on.2).expect("a real date");
            ordinal_differs += usize::from(old_ordinal_age(birth, on) != new);
            let old_training = (on.0 - birth.0) as u32;
            training_differs += usize::from(old_training != new as u32);
            old_factor += age_factor(old_training);
            new_factor += age_factor(new as u32);
        }
        let n = 100_000.0;
        println!(
            "ngày {:04}-{:02}-{:02}: tuổi lệch so với cách so ngày-trong-năm {:.3}% | tuổi tập lệch so với trừ năm {:.1}% | hệ số tuổi khi tập trung bình {:.4} → {:.4}",
            on.0,
            on.1,
            on.2,
            ordinal_differs as f64 / n * 100.0,
            training_differs as f64 / n * 100.0,
            old_factor / n,
            new_factor / n
        );
    }
}
