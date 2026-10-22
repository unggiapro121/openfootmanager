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

/// The roll E6 replaced: std's `DefaultHasher` over the player, the season and the purpose.
fn old_seeded_value(player_id: &str, season: u32, salt: &str) -> u32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    player_id.hash(&mut hasher);
    season.hash(&mut hasher);
    salt.hash(&mut hasher);
    (hasher.finish() % u32::MAX as u64) as u32
}

fn veteran(id: &str) -> domain::player::Player {
    let mut player = domain::player::Player::new(
        id.into(),
        id.into(),
        id.into(),
        "1990-01-01".into(),
        "England".into(),
        domain::player::Position::Midfielder,
        domain::player::PlayerAttributes {
            pace: 60,
            stamina: 60,
            strength: 60,
            agility: 60,
            passing: 60,
            shooting: 60,
            tackling: 60,
            dribbling: 60,
            defending: 60,
            positioning: 60,
            vision: 60,
            decisions: 60,
            composure: 60,
            aggression: 60,
            teamwork: 60,
            leadership: 60,
            handling: 20,
            reflexes: 20,
            aerial: 60,
            long_passing: 60,
            crossing: 60,
            curve: 60,
            free_kick: 60,
            long_shots: 60,
            first_touch: 60,
            heading: 60,
        },
    );
    player.team_id = Some("club".into());
    player.stats.appearances = 25;
    player.stats.avg_rating = 6.8;
    player.ovr = 70;
    player
}

/// Given 50,000 veterans of each age from 33 to 37, regular starters with no contract on file,
/// when the retirement roll and the veteran's pace loss are drawn with the old hash and the new,
/// then the shares retiring and the mean pace lost are printed side by side.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure_e6_stable_aging_rolls() {
    use ofm_rules::aging::{retirement_chance, should_retire, veteran_pace_loss};

    println!(
        "E6 — DefaultHasher → stable_hash (50.000 cầu thủ mỗi tuổi, đá chính, chưa ghi hợp đồng)"
    );
    const N: u32 = 50_000;
    for age in 33..=37 {
        let (mut old_retired, mut new_retired) = (0u32, 0u32);
        let (mut old_pace, mut new_pace) = (0u32, 0u32);
        let mut chance = 0;
        for index in 0..N {
            let id = format!("veteran-{age}-{index}");
            let player = veteran(&id);
            chance = retirement_chance(&player, age, false);
            old_retired += u32::from(old_seeded_value(&id, 2030, "retirement-roll") % 100 < chance);
            new_retired += u32::from(should_retire(&player, age, false, 2030));
            old_pace += 1 + old_seeded_value(&id, 2030, "pace-loss") % 3;
            new_pace += u32::from(veteran_pace_loss(&id, age, 2030));
        }
        println!(
            "tuổi {age} (xác suất {chance}%): giải nghệ {:.2}% → {:.2}% | mất tốc độ trung bình {:.3} → {:.3}",
            f64::from(old_retired) / f64::from(N) * 100.0,
            f64::from(new_retired) / f64::from(N) * 100.0,
            f64::from(old_pace) / f64::from(N),
            f64::from(new_pace) / f64::from(N),
        );
    }
}

fn trainee(index: usize) -> domain::player::Player {
    let mut player = veteran(&format!("trainee-{index}"));
    player.date_of_birth = "2006-03-15".into();
    for value in [
        &mut player.attributes.pace,
        &mut player.attributes.stamina,
        &mut player.attributes.strength,
        &mut player.attributes.agility,
    ] {
        *value = 40;
    }
    player.potential = 99;
    player.playing_time = 100;
    player
}

/// Given 400 identical 19-year-olds on a Physical, Medium programme for 300 days,
/// when they train with one stream for the whole squad per day (the old way) and with a stream
/// of their own per day (E5),
/// then the mean and spread of their physical gains are printed side by side.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure_e5_a_stream_per_player() {
    use domain::team::{TrainingFocus, TrainingIntensity, TrainingSchedule};
    use ofm_rules::seed::rng_for_seed;
    use ofm_rules::training::{
        TeamCoachingBonus, TeamTrainingPlan, TrainingDay, session_rng, train_player,
    };

    const PLAYERS: usize = 400;
    const DAYS: u32 = 300;
    let plan = TeamTrainingPlan {
        default_focus: TrainingFocus::Physical,
        intensity: TrainingIntensity::Medium,
        schedule: TrainingSchedule::Intense,
        bonus: TeamCoachingBonus {
            coaching_mult: 1.2,
            specialization_mult: 1.0,
            physio_mult: 1.2,
        },
        medical_facility_mult: 1.0,
        training_facility_mult: 1.0,
        group_overrides: Default::default(),
        taper: None,
    };
    let physical = |p: &domain::player::Player| {
        u32::from(p.attributes.pace)
            + u32::from(p.attributes.stamina)
            + u32::from(p.attributes.strength)
            + u32::from(p.attributes.agility)
    };
    let mut results = Vec::new();
    for per_player in [false, true] {
        let mut squad: Vec<_> = (0..PLAYERS).map(trainee).collect();
        let before: Vec<u32> = squad.iter().map(physical).collect();
        for offset in 0..DAYS {
            let date = format!("2026-{:02}-{:02}", 1 + offset / 28 % 12, 1 + offset % 28);
            let day = TrainingDay {
                weekday_num: offset % 7,
                year: 2026,
                date: date.clone(),
                development_multiplier: 1.0,
            };
            let mut shared = rng_for_seed(7, "training", &date);
            for player in &mut squad {
                player.condition = 90;
                if per_player {
                    let mut own = session_rng(7, &player.id, &date);
                    train_player(player, &plan, &day, &mut own);
                } else {
                    train_player(player, &plan, &day, &mut shared);
                }
            }
        }
        let gains: Vec<f64> = squad
            .iter()
            .zip(&before)
            .map(|(player, before)| f64::from(physical(player) - before))
            .collect();
        let mean = gains.iter().sum::<f64>() / gains.len() as f64;
        let spread =
            (gains.iter().map(|g| (g - mean).powi(2)).sum::<f64>() / gains.len() as f64).sqrt();
        results.push((mean, spread));
    }
    println!(
        "E5 — luồng ngẫu nhiên riêng mỗi cầu thủ (400 cầu thủ 19 tuổi, Physical/Medium, 300 ngày)"
    );
    println!(
        "tăng thể chất mỗi cầu thủ: trung bình {:.2} → {:.2} | độ lệch chuẩn {:.2} → {:.2}",
        results[0].0, results[1].0, results[0].1, results[1].1
    );
}
