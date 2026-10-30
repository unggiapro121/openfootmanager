//! E5-6b (E5-6-tech-spec.md §4): the keeper's drill, measured. E5-1's world and days, people's
//! clubs on their automatic sessions with each player on his best focus (E54-13, now
//! `training::best_focus`), bots on the AI's plan. At the first season's start every club gets a
//! planted keeper and, for him, a centre-back and a central midfielder of the same OVR, potential
//! and age, all fielded whenever fit; their growth over three seasons, with and without the drill,
//! is what K1–K3 read. K4 is the world's goals a match.

use std::collections::{BTreeMap, HashMap};

use domain::player::{Player, Position};
use ofm_rules::age;
use ofm_rules::player_rating::{primary_position, refresh_player_derived};
use ofm_rules::recovery::RecoveryBlocks;
use ofm_rules::training::{ExtraParams, KeeperDrill};

use super::{
    Club, FIRST_YEAR, Kind, LEAGUE, Measure, Measures, Recovery, SEASONS, SEEDS, Variant,
    kind_measure, mean, run, spread,
};

/// People's clubs on the automatic sessions, and bots; nobody presses (E5-6 §4).
const PLACES_KEEPER: [Kind; LEAGUE] = [
    Kind::Bot,
    Kind::Auto,
    Kind::Bot,
    Kind::Auto,
    Kind::Bot,
    Kind::Auto,
    Kind::Bot,
    Kind::Auto,
    Kind::Bot,
    Kind::Auto,
    Kind::Bot,
    Kind::Auto,
    Kind::Bot,
    Kind::Auto,
];

/// The planted keepers of §4: (name, OVR, potential, age), and whether a people's club gets them.
const PROBES: [(&str, u8, u8, i32, bool); 4] = [
    ("TM-1", 60, 85, 17, true),
    ("TM-2", 60, 75, 18, true),
    ("TM-3", 70, 80, 21, false),
    ("TM-4", 70, 74, 26, false),
];

/// The roles planted for one probe: the keeper and his controls of the same OVR, P and age.
const ROLES: [Position; 3] = [
    Position::Goalkeeper,
    Position::CenterBack,
    Position::CentralMidfielder,
];

/// One planted player.
#[derive(Clone)]
struct Planted {
    id: String,
    probe: usize,
    role: usize,
    potential: u8,
}

/// The players planted in a club, if any.
#[derive(Default)]
pub(super) struct ClubProbes {
    planted: Vec<Planted>,
    /// OVR at the start of the current season, by id.
    start: HashMap<String, u8>,
}

/// What the planted players did, and the world around them.
#[derive(Default)]
pub(super) struct KeeperMeasure {
    /// (probe, role, season) → OVR changes of the season.
    growth: BTreeMap<(usize, usize, u32), Vec<f64>>,
    /// (probe, role) → the season (1-based) a planted player reached his potential.
    reached: BTreeMap<(usize, usize), Vec<Option<u32>>>,
    /// Season-start age ≤ 25: (keepers' OVR change sum, keepers, outfielders' sum, outfielders).
    young: (f64, u32, f64, u32),
}

/// The probe the `nth` club of `kind` gets: people's clubs take TM-1 and TM-2 in turn, bots all
/// four (§4: TM-3 and TM-4 are bots' only).
fn probe_of(nth: usize, kind: Kind) -> Option<usize> {
    match kind {
        Kind::Auto => Some(nth % 2),
        Kind::Bot => Some(nth % PROBES.len()),
        _ => None,
    }
}

/// A planted player: `player` turned into a fit regular of `position`, every attribute `ovr`,
/// born in `year` (January 1st), potential `potential`.
fn plant(player: &mut Player, position: Position, ovr: u8, potential: u8, year: i32) {
    player.position = position.clone();
    player.natural_position = position;
    player.alternate_positions.clear();
    let a = &mut player.attributes;
    for value in [
        &mut a.pace,
        &mut a.stamina,
        &mut a.strength,
        &mut a.agility,
        &mut a.passing,
        &mut a.shooting,
        &mut a.tackling,
        &mut a.dribbling,
        &mut a.defending,
        &mut a.positioning,
        &mut a.vision,
        &mut a.decisions,
        &mut a.composure,
        &mut a.aggression,
        &mut a.teamwork,
        &mut a.leadership,
        &mut a.handling,
        &mut a.reflexes,
        &mut a.aerial,
        &mut a.long_passing,
        &mut a.crossing,
        &mut a.curve,
        &mut a.free_kick,
        &mut a.long_shots,
        &mut a.first_touch,
        &mut a.heading,
    ] {
        *value = ovr;
    }
    player.date_of_birth = format!("{year}-01-01");
    player.injury = None;
    player.condition = 100;
    player.training_focus = None;
    player.playing_time = 80;
    player.potential = 0;
    refresh_player_derived(player, FIRST_YEAR);
    player.potential = potential;
}

/// The club's three players to plant: its keeper of the lowest OVR (so the other keeper is the
/// backup), then its two outfielders of the lowest OVR.
fn chosen_for_planting(club: &Club) -> Option<[usize; 3]> {
    let lowest = |keeper: bool| {
        let mut ids: Vec<usize> = (0..club.players.len())
            .filter(|&i| (primary_position(&club.players[i]) == Position::Goalkeeper) == keeper)
            .collect();
        ids.sort_by_key(|&i| club.players[i].ovr);
        ids
    };
    let keepers = lowest(true);
    let outfield = lowest(false);
    Some([*keepers.first()?, *outfield.first()?, *outfield.get(1)?])
}

/// At each season's start: in the first, plant every club's probe; then note OVRs and ages.
pub(super) fn open_season(clubs: &mut [Club], season_number: u32) {
    let mut seen: BTreeMap<Kind, usize> = BTreeMap::new();
    for club in clubs.iter_mut() {
        let nth = seen.entry(club.kind).or_default();
        let probe = probe_of(*nth, club.kind);
        *nth += 1;
        if season_number == 1
            && let Some(probe) = probe
            && let Some(slots) = chosen_for_planting(club)
        {
            let (_, ovr, potential, age, _) = PROBES[probe];
            let year = i32::try_from(FIRST_YEAR).unwrap_or(2026) - age;
            club.probes.planted.clear();
            for (role, slot) in slots.into_iter().enumerate() {
                let player = &mut club.players[slot];
                plant(player, ROLES[role].clone(), ovr, potential, year);
                club.probes.planted.push(Planted {
                    id: player.id.clone(),
                    probe,
                    role,
                    potential,
                });
            }
        }
        club.probes.start = club.players.iter().map(|p| (p.id.clone(), p.ovr)).collect();
    }
}

/// At each season's end, before aging: each planted player's growth and whether he reached his
/// potential; every young keeper's and outfielder's growth.
pub(super) fn close_season(clubs: &[Club], season_number: u32, first_day: &str, m: &mut Measures) {
    young_growth(clubs, first_day, m);
    for club in clubs {
        let e = &mut kind_measure(m, club.kind).keeper;
        for planted in &club.probes.planted {
            let (Some(player), Some(start)) = (
                club.players.iter().find(|p| p.id == planted.id),
                club.probes.start.get(&planted.id),
            ) else {
                continue;
            };
            e.growth
                .entry((planted.probe, planted.role, season_number))
                .or_default()
                .push(f64::from(player.ovr) - f64::from(*start));
            let reached = e.reached.entry((planted.probe, planted.role)).or_default();
            if season_number == 1 {
                reached.push(None);
            }
            if let Some(last) = reached.last_mut()
                && last.is_none()
                && player.ovr >= planted.potential
            {
                *last = Some(season_number);
            }
        }
    }
}

/// Every young player's growth of the season (≤ 25 at its start), keepers apart.
fn young_growth(clubs: &[Club], first_day: &str, m: &mut Measures) {
    for club in clubs {
        let e = &mut kind_measure(m, club.kind).keeper;
        for player in &club.players {
            let Some(start) = club.probes.start.get(&player.id) else {
                continue;
            };
            if age::age_on(&player.date_of_birth, first_day).unwrap_or(30) > 25 {
                continue;
            }
            let change = f64::from(player.ovr) - f64::from(*start);
            if primary_position(player) == Position::Goalkeeper {
                e.young.0 += change;
                e.young.1 += 1;
            } else {
                e.young.2 += change;
                e.young.3 += 1;
            }
        }
    }
}

/// Every planted player of `club` takes a place in the eleven when fit: a planted keeper the
/// keeper's slot, a control the place of the eleven's weakest of his position group.
pub(super) fn field_probes(
    club: &Club,
    side: &mut engine::TeamData,
    bench: &mut [engine::PlayerData],
) {
    let ovr: HashMap<&str, u8> = club
        .players
        .iter()
        .map(|p| (p.id.as_str(), p.ovr))
        .collect();
    let planted: Vec<&str> = club.probes.planted.iter().map(|p| p.id.as_str()).collect();
    for id in &planted {
        if side.players.iter().any(|p| p.id == *id) {
            continue;
        }
        let Some(at) = bench.iter().position(|p| p.id == *id) else {
            continue;
        };
        let group = bench[at].position;
        let out = side
            .players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.position == group && !planted.contains(&p.id.as_str()))
            .min_by(|(_, a), (_, b)| {
                let rating = |p: &engine::PlayerData| ovr.get(p.id.as_str()).copied().unwrap_or(0);
                rating(a).cmp(&rating(b)).then_with(|| a.id.cmp(&b.id))
            })
            .map(|(slot, _)| slot);
        if let Some(slot) = out {
            std::mem::swap(&mut side.players[slot], &mut bench[at]);
        }
    }
}

fn keeper_variant(seed: u64, drill: Option<KeeperDrill>) -> Variant {
    Variant {
        multiplier: 16.0,
        recovery: Recovery::Blocks(RecoveryBlocks {
            per_day: 6,
            hours: 8,
        }),
        injury_scale: 13,
        places: Some(&PLACES_KEEPER),
        shift: 0,
        rotate: false,
        seasons: SEASONS,
        seed,
        // People's clubs need the E5-4b hooks for the best focus and fielding; `Auto` presses
        // nothing, so the extra sessions' settings do not matter.
        extra: Some(super::extra::ExtraRun::with(ExtraParams::PROPOSED)),
        keeper_drill: drill,
        probes: true,
    }
}

/// Over the seeds: the mean OVR change a season of `(probe, role)` in `kind`'s clubs, all
/// seasons pooled.
fn growth_of(runs: &[Measures], kind: Kind, probe: usize, role: usize) -> f64 {
    let values: Vec<f64> = runs
        .iter()
        .flat_map(|r| {
            r.get(&kind).into_iter().flat_map(move |m| {
                (1..=SEASONS).flat_map(move |s| {
                    m.keeper
                        .growth
                        .get(&(probe, role, s))
                        .cloned()
                        .unwrap_or_default()
                })
            })
        })
        .collect();
    mean(&values)
}

fn goals_a_match(runs: &[Measures]) -> f64 {
    let (goals, sides) = runs
        .iter()
        .flat_map(|r| r.values())
        .fold((0u32, 0u32), |(g, n), m| (g + m.goals, n + m.matches));
    2.0 * f64::from(goals) / f64::from(sides.max(1))
}

/// The keeper's growth over his controls' (centre-back and, when planted, midfielder).
fn ratio(runs: &[Measures], kind: Kind, probe: usize) -> f64 {
    let keeper = growth_of(runs, kind, probe, 0);
    let controls = mean(&[
        growth_of(runs, kind, probe, 1),
        growth_of(runs, kind, probe, 2),
    ]);
    keeper / controls.max(f64::EPSILON)
}

/// K1 (people, TM-1 and TM-2) and K2 (bots, TM-1…TM-4), and everything printed with them.
struct Kays {
    k1: f64,
    k2: f64,
    goals: f64,
}

fn report(runs: &[Measures], drill: Option<KeeperDrill>) -> Kays {
    let label = drill.map_or("None".to_string(), |d| {
        format!(
            "{}/{}/{}",
            d.handling_permille, d.reflexes_permille, d.aerial_permille
        )
    });
    println!(
        "\n==== keeper drill {label}, {} seeds × {SEASONS} seasons ====",
        runs.len()
    );
    for (kind, probes) in [(Kind::Auto, 0..2), (Kind::Bot, 0..4)] {
        for probe in probes {
            let (name, ovr, potential, age, _) = PROBES[probe];
            let reached = |role: usize| {
                let all: Vec<Option<u32>> = runs
                    .iter()
                    .filter_map(|r| r.get(&kind))
                    .flat_map(|m| {
                        m.keeper
                            .reached
                            .get(&(probe, role))
                            .cloned()
                            .unwrap_or_default()
                    })
                    .collect();
                let hit = all.iter().filter(|s| s.is_some()).count();
                format!("{hit}/{}", all.len())
            };
            println!(
                "  {kind:?} {name} ({ovr}/{potential}, {age}): ΔOVR a season keeper {:+.2} · centre-back {:+.2} · midfielder {:+.2} · keeper / controls {:.2} · reached P in {SEASONS} seasons: keeper {}, centre-back {}",
                growth_of(runs, kind, probe, 0),
                growth_of(runs, kind, probe, 1),
                growth_of(runs, kind, probe, 2),
                ratio(runs, kind, probe),
                reached(0),
                reached(1),
            );
        }
    }
    let young = |kind: Kind| {
        let (k, kn, o, on) =
            runs.iter()
                .filter_map(|r| r.get(&kind))
                .fold((0.0, 0, 0.0, 0), |(k, kn, o, on), m| {
                    let y = m.keeper.young;
                    (k + y.0, kn + y.1, o + y.2, on + y.3)
                });
        (k / f64::from(kn.max(1)), o / f64::from(on.max(1)))
    };
    for kind in [Kind::Auto, Kind::Bot] {
        let (keepers, outfield) = young(kind);
        let points: Vec<f64> = runs
            .iter()
            .filter_map(|r| r.get(&kind))
            .map(Measure::points_per_match)
            .collect();
        println!(
            "  {kind:?}: ΔOVR a season ≤25 keepers {keepers:+.2}, outfielders {outfield:+.2} · points a match {:.3} (±{:.3})",
            mean(&points),
            spread(&points)
        );
    }
    let k1 = mean(&[ratio(runs, Kind::Auto, 0), ratio(runs, Kind::Auto, 1)]);
    let k2 = mean(
        &(0..4)
            .map(|p| ratio(runs, Kind::Bot, p))
            .collect::<Vec<_>>(),
    );
    let goals = goals_a_match(runs);
    println!(
        "  K1 people keeper/controls {k1:.2} (0.85–1.15) · K2 bots {k2:.2} (0.8–1.25) · goals a match {goals:.3}"
    );
    Kays { k1, k2, goals }
}

fn runs_with(drill: Option<KeeperDrill>) -> Vec<Measures> {
    SEEDS
        .iter()
        .map(|seed| run(keeper_variant(*seed, drill)))
        .collect()
}

fn drill_at(permille: u16) -> KeeperDrill {
    KeeperDrill {
        handling_permille: permille,
        reflexes_permille: permille,
        aerial_permille: permille,
    }
}

fn in_bands(k: &Kays) -> bool {
    (0.85..=1.15).contains(&k.k1) && (0.8..=1.25).contains(&k.k2)
}

/// E5-6b: None and the proposed drill; out of the bands, the grid {250, 300, 350} and the one
/// nearest 1.0 for both; none in both bands, None (Qe56-4). K3 and K4 are printed.
pub(super) fn measure_keeper_drill() {
    let none = report(&runs_with(None), None);
    let proposed = report(
        &runs_with(Some(KeeperDrill::PROPOSED)),
        Some(KeeperDrill::PROPOSED),
    );
    let drift = |k: &Kays| 100.0 * (k.goals - none.goals) / none.goals.max(f64::EPSILON);
    println!("  K4 goals a match vs None: {:+.1} %", drift(&proposed));
    let chosen = if in_bands(&proposed) {
        Some((300, proposed))
    } else {
        let mut grid: Vec<(u16, Kays)> = Vec::new();
        for permille in [250, 350] {
            let kays = report(
                &runs_with(Some(drill_at(permille))),
                Some(drill_at(permille)),
            );
            println!("  K4 goals a match vs None: {:+.1} %", drift(&kays));
            grid.push((permille, kays));
        }
        grid.push((300, proposed));
        grid.into_iter()
            .filter(|(_, k)| in_bands(k))
            .min_by(|(_, a), (_, b)| {
                let off = |k: &Kays| (k.k1 - 1.0).abs() + (k.k2 - 1.0).abs();
                off(a).total_cmp(&off(b))
            })
    };
    match chosen {
        Some((permille, k)) => println!(
            "\n  chosen: keeperDrill {permille}/{permille}/{permille} (K1 {:.2}, K2 {:.2}, goals {:+.1} % vs None)",
            k.k1,
            k.k2,
            drift(&k)
        ),
        None => {
            println!("\n  no drill puts K1 and K2 in their bands: the official run goes with None")
        }
    }
}
