//! What E3-5c's seeded ids and generator do to a generated world's numbers. Run by hand, on this
//! tree and on the tree before it, and compare:
//! `cargo test --release -p ofm_core --test worldgen_measure -- --ignored --nocapture`.

use ofm_core::generator::{DefinitionSources, generate_world_data_seeded};

fn percentile(sorted: &[f64], share: f64) -> f64 {
    sorted[((sorted.len() - 1) as f64 * share).round() as usize]
}

fn summary(label: &str, mut values: Vec<f64>) {
    values.sort_by(f64::total_cmp);
    let n = values.len() as f64;
    let mean = values.iter().sum::<f64>() / n;
    let sd = (values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / n).sqrt();
    println!(
        "{label:<10} n={:>6} mean={mean:>6.2} sd={sd:>5.2} p10={:>5.1} p50={:>5.1} p90={:>5.1}",
        values.len(),
        percentile(&values, 0.1),
        percentile(&values, 0.5),
        percentile(&values, 0.9),
    );
}

/// Given the standard world generated from seeds 1–20,
/// when every player's OVR, potential and age at the opening are pooled,
/// then their distributions are printed, with the squad and staff counts.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure_e3_5c_generated_worlds() {
    let sources = DefinitionSources::embedded_only();
    let (mut ovr, mut potential, mut age) = (Vec::new(), Vec::new(), Vec::new());
    let (mut teams, mut staff) = (0usize, 0usize);
    for seed in 1..=20 {
        let world = generate_world_data_seeded(seed, &sources);
        teams += world.teams.len();
        staff += world.staff.len();
        for player in &world.players {
            ovr.push(f64::from(player.ovr));
            potential.push(f64::from(player.potential));
            let born: i32 = player.date_of_birth[..4].parse().expect("a dated birth");
            age.push(f64::from(2026 - born));
        }
    }
    println!("E3-5c — 20 thế giới chuẩn (seed 1–20): {teams} CLB, {staff} nhân sự");
    summary("OVR", ovr);
    summary("tiềm năng", potential);
    summary("tuổi", age);
}
