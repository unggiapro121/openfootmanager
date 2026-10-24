//! E3-5q at the target scale: the clubs `scale` asks for, measured; and the desktop's standard
//! worlds of seeds 1–3. Run by hand:
//! `cargo test --release -p ofm-rules --test online_world_measure -- --ignored --nocapture`.
//! With `OFM_SAMPLES=<file>` it also writes 50 clubs and 200 players of each region there, for
//! a person to read (E3-5q2 exit criterion).

use std::collections::{BTreeMap, HashMap, HashSet};

use ofm_rules::worldgen::online::names::{fold, is_protected_person};
use ofm_rules::worldgen::online::naming::is_blocked_club_name;
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
fn measure_e3_5q_at_scale() {
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
        "E3-5q — {} CLB theo scale của {}, seed 2026, năm 2026",
        clubs.len(),
        pack.version
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
    let mut people = 0usize;
    let mut protected = Vec::new();
    for (_, _, club) in &clubs {
        let names = club
            .players
            .iter()
            .map(|p| p.full_name.clone())
            .chain(
                club.staff
                    .iter()
                    .map(|m| format!("{} {}", m.first_name, m.last_name)),
            )
            .chain(std::iter::once(format!(
                "{} {}",
                club.coach.first_name, club.coach.last_name
            )));
        for name in names {
            people += 1;
            if is_protected_person(&name, &[]) {
                protected.push(name);
            }
        }
    }
    let blocked_clubs = clubs
        .iter()
        .filter(|(_, _, c)| is_blocked_club_name(&c.team.name, &c.nation, &pack))
        .count();
    let blocked_stadiums = clubs
        .iter()
        .filter(|(_, _, c)| is_blocked_club_name(&c.team.stadium_name, &c.nation, &pack))
        .count();
    let kits: HashSet<String> = clubs
        .iter()
        .map(|(_, _, c)| {
            format!(
                "{}/{}/{:?}",
                c.team.colors.primary, c.team.colors.secondary, c.team.kit_pattern
            )
        })
        .collect();
    let mut shirt_clash = 0usize;
    for (_, _, club) in &clubs {
        let mut shirts = HashSet::new();
        for p in &club.players {
            if !shirts.insert(fold(&p.match_name)) {
                shirt_clash += 1;
            }
        }
    }
    println!(
        "người trùng danh sách được bảo vệ: {}/{people} {:?} | tên CLB bị chặn: {blocked_clubs} | tên sân bị chặn: {blocked_stadiums}",
        protected.len(),
        protected.iter().take(5).collect::<Vec<_>>()
    );
    println!(
        "bộ áo khác nhau: {} | tên in áo trùng trong một CLB: {shirt_clash}",
        kits.len()
    );
    if let Ok(path) = std::env::var("OFM_SAMPLES") {
        write_samples(&path, &pack, &clubs);
    }
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

type Club = (String, u64, ofm_rules::worldgen::online::GeneratedClub);

/// 50 clubs and 200 players of each region, spread over the region's clubs, as Markdown.
fn write_samples(path: &str, pack: &OnlineContentPack, clubs: &[Club]) {
    use std::fmt::Write as _;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "# Mẫu thế giới online — {} (seed 2026)\n",
        pack.version
    );
    for region in pack.scale.region_share.keys() {
        let of_region: Vec<&Club> = clubs.iter().filter(|(r, _, _)| r == region).collect();
        let step = (of_region.len() / 50).max(1);
        let _ = writeln!(
            out,
            "## {region}\n\n### 50 CLB\n\n| # | Nước | CLB | Sân | Áo | HLV |\n|---|---|---|---|---|---|"
        );
        for (_, ordinal, club) in of_region.iter().step_by(step).take(50) {
            let _ = writeln!(
                out,
                "| {ordinal} | {} | {} | {} | {} {} {:?} | {} {} |",
                club.nation,
                club.team.name,
                club.team.stadium_name,
                club.team.colors.primary,
                club.team.colors.secondary,
                club.team.kit_pattern,
                club.coach.first_name,
                club.coach.last_name
            );
        }
        let _ = writeln!(
            out,
            "\n### 200 cầu thủ\n\n| CLB | Họ tên | Tên áo | Quốc tịch | Vị trí | Tuổi (2026) |\n|---|---|---|---|---|---|"
        );
        let mut listed = 0;
        let per_club = 200 / of_region.len().clamp(1, 50) + 1;
        for (_, _, club) in of_region.iter().step_by(step) {
            for p in club.players.iter().take(per_club) {
                if listed == 200 {
                    break;
                }
                let born: u32 = p.date_of_birth[..4].parse().unwrap_or(2000);
                let _ = writeln!(
                    out,
                    "| {} | {} | {} | {} | {:?} | {} |",
                    club.team.name,
                    p.full_name,
                    p.match_name,
                    p.nationality,
                    p.position,
                    2026 - born
                );
                listed += 1;
            }
        }
        out.push('\n');
    }
    std::fs::write(path, out).expect("samples written");
}

/// Given the desktop's standard worlds of seeds 1–3,
/// when every person and club is checked,
/// then the clashes with the protected lists, the shared full names and the kits are printed.
#[test]
#[ignore = "a measurement, run by hand"]
fn measure_e3_5q_desktop_worlds() {
    use ofm_rules::seed::rng_from_u64;
    use ofm_rules::worldgen::clubs::WorldGenConfig;
    use ofm_rules::worldgen::definitions::embedded_names;
    use ofm_rules::worldgen::generate_world;
    let pack = OnlineContentPack::builtin_shared();
    for seed in 1..=3 {
        let (teams, players, staff) = generate_world(
            rng_from_u64(seed),
            &WorldGenConfig::standard(2026),
            &embedded_names(),
        );
        let mut count: HashMap<String, usize> = HashMap::new();
        for p in &players {
            *count.entry(fold(&p.full_name)).or_default() += 1;
        }
        let shared: usize = count.values().filter(|n| **n > 1).sum();
        let protected = players
            .iter()
            .map(|p| p.full_name.clone())
            .chain(
                staff
                    .iter()
                    .map(|m| format!("{} {}", m.first_name, m.last_name)),
            )
            .filter(|n| is_protected_person(n, &[]))
            .count();
        let blocked = teams
            .iter()
            .filter(|t| is_blocked_club_name(&t.name, &t.country, pack))
            .count();
        let kits: HashSet<String> = teams
            .iter()
            .map(|t| {
                format!(
                    "{}/{}/{:?}",
                    t.colors.primary, t.colors.secondary, t.kit_pattern
                )
            })
            .collect();
        let stadiums: HashSet<&str> = teams.iter().map(|t| t.stadium_name.as_str()).collect();
        println!(
            "desktop seed {seed}: {} CLB, {} cầu thủ | họ tên khác nhau {} | cầu thủ trùng họ tên với người khác {} ({:.1}%) | trùng người được bảo vệ {protected} | tên CLB bị chặn {blocked} | bộ áo khác nhau {} | tên sân khác nhau {}",
            teams.len(),
            players.len(),
            count.len(),
            shared,
            shared as f64 * 100.0 / players.len() as f64,
            kits.len(),
            stadiums.len()
        );
        if seed == 1 {
            let names: Vec<&str> = teams.iter().take(12).map(|t| t.name.as_str()).collect();
            println!("   CLB đầu: {names:?}");
            let people: Vec<&str> = players
                .iter()
                .step_by(400)
                .take(15)
                .map(|p| p.full_name.as_str())
                .collect();
            println!("   cầu thủ: {people:?}");
        }
    }
}
