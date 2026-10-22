//! E3-5q1 at the target scale: the clubs `scale` asks for, measured. Run by hand:
//! `cargo test --release -p ofm-rules --test online_world_measure -- --ignored --nocapture`.

use std::collections::{BTreeMap, HashMap, HashSet};

use ofm_rules::worldgen::online::names::fold;
use ofm_rules::worldgen::online::starter::SquadStrength;
use ofm_rules::worldgen::online::{Generator, OnlineContentPack, predicted_name_shares};

/// Given the builtin pack and its scale (5,600 clubs split by region share),
/// when every club is generated,
/// then the time, the bands, the draws per squad and the name clashes are printed.
#[test]
#[ignore = "a measurement, run by hand"]
#[expect(
    clippy::disallowed_methods,
    reason = "a measurement times itself with the wall clock; it is not a rule and feeds no world"
)]
fn measure_e3_5q1_at_scale() {
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(2026, &pack).unwrap();
    let started = std::time::Instant::now();
    let mut clubs = Vec::new();
    for (region, share) in &pack.scale.region_share {
        let count = ((f64::from(pack.scale.clubs) * share) / 14.0).round() as u64 * 14;
        for ordinal in 0..count {
            clubs.push((
                region.clone(),
                ordinal,
                generator.club(region, ordinal, 0, 2026, None).unwrap(),
            ));
        }
    }
    let elapsed = started.elapsed();
    let starter = &pack.profile.starter;
    let within = clubs
        .iter()
        .filter(|(_, _, c)| SquadStrength::of(&c.players).within(starter))
        .count();
    let attempts: f64 = clubs
        .iter()
        .map(|(_, _, c)| f64::from(c.attempts))
        .sum::<f64>()
        / clubs.len() as f64;
    let max_attempts = clubs.iter().map(|(_, _, c)| c.attempts).max().unwrap();
    let names: HashSet<String> = clubs.iter().map(|(_, _, c)| fold(&c.team.name)).collect();
    let mut in_club = 0;
    let mut players = 0usize;
    let mut league_clash = 0usize;
    let mut by_nation: HashMap<String, Vec<String>> = HashMap::new();
    for chunk in clubs.chunks(14) {
        let mut seen: HashMap<String, usize> = HashMap::new();
        for (_, _, club) in chunk {
            let mut own = HashSet::new();
            for p in &club.players {
                players += 1;
                let key = fold(&p.full_name);
                if !own.insert(key.clone()) {
                    in_club += 1;
                }
                *seen.entry(key.clone()).or_default() += 1;
                by_nation
                    .entry(p.nationality.clone())
                    .or_default()
                    .push(key);
            }
        }
        league_clash += seen.values().filter(|n| **n > 1).copied().sum::<usize>();
    }
    let s = |f: fn(&SquadStrength) -> f64| {
        let mut v: Vec<f64> = clubs
            .iter()
            .map(|(_, _, c)| f(&SquadStrength::of(&c.players)))
            .collect();
        v.sort_by(f64::total_cmp);
        (v[0], v[v.len() / 2], v[v.len() - 1])
    };
    println!(
        "E3-5q1 — {} CLB theo scale của builtin-1, seed 2026, năm 2026",
        clubs.len()
    );
    println!(
        "thời gian sinh: {:.2} s ({:.2} ms/CLB)",
        elapsed.as_secs_f64(),
        elapsed.as_secs_f64() * 1000.0 / clubs.len() as f64
    );
    println!(
        "trong cả ba dải: {within}/{} | lần rút trung bình {attempts:.3}, nhiều nhất {max_attempts}",
        clubs.len()
    );
    let (a, b, c) = s(|x| x.top18);
    println!("18 người tốt nhất: min {a:.2} trung vị {b:.2} max {c:.2}");
    let (a, b, c) = s(|x| x.first_eleven);
    println!("XI: min {a:.2} trung vị {b:.2} max {c:.2}");
    let (a, b, c) = s(|x| x.goalkeeper);
    println!("thủ môn: min {a:.0} trung vị {b:.0} max {c:.0}");
    println!(
        "tên CLB khác nhau: {}/{} | họ tên trùng trong một CLB: {in_club}",
        names.len(),
        clubs.len()
    );
    println!(
        "cầu thủ trùng họ tên trong cùng league (14 CLB liền nhau): {league_clash}/{players} ({:.2}%)",
        league_clash as f64 * 100.0 / players as f64
    );
    let predicted = predicted_name_shares(&pack);
    let mut rows: BTreeMap<String, (usize, f64, f64)> = BTreeMap::new();
    for (nation, keys) in &by_nation {
        let mut count: HashMap<&String, usize> = HashMap::new();
        for k in keys {
            *count.entry(k).or_default() += 1;
        }
        let shared: usize = count.values().filter(|n| **n > 1).sum();
        rows.insert(
            nation.clone(),
            (
                keys.len(),
                shared as f64 / keys.len() as f64,
                predicted.get(nation).copied().unwrap_or(0.0),
            ),
        );
    }
    println!("quốc tịch: số người | trùng họ tên toàn thế giới (đo) | dự báo của validate_pack");
    for (nation, (n, measured, predicted)) in rows.iter().filter(|(_, r)| r.0 >= 500) {
        println!(
            "  {nation:<4} {n:>6} | {:>5.1}% | {:>5.1}%",
            measured * 100.0,
            predicted * 100.0
        );
    }
    for (region, ordinal) in [("AsiaSoutheast", 0u64), ("AsiaEast", 1), ("Europe", 0)] {
        let club = &clubs
            .iter()
            .find(|(r, o, _)| r == region && *o == ordinal)
            .unwrap()
            .2;
        println!(
            "\nmẫu {region} #{ordinal}: {} ({}) — {} | {} | HLV {} {} | {:?}",
            club.team.name,
            club.nation,
            club.team.stadium_name,
            club.team.formation,
            club.coach.first_name,
            club.coach.last_name,
            SquadStrength::of(&club.players)
        );
        for p in club.players.iter().take(23) {
            println!(
                "   {:<28} {:<16} {:<4} {:?} OVR {} TN {} sinh {}",
                p.full_name,
                p.match_name,
                p.nationality,
                p.position,
                p.ovr,
                p.potential,
                &p.date_of_birth[..4]
            );
        }
    }
}
