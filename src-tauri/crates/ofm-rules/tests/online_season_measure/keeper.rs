//! E5-6b (E5-6-tech-spec.md §4): the keeper's drill, measured. E5-1's world and days, people's
//! clubs on their automatic sessions with each player on his best focus (E54-13, now
//! `training::best_focus`), bots on the AI's plan. At the first season's start every club gets a
//! planted keeper and, for him, a centre-back and a central midfielder of the same OVR, potential
//! and age, all fielded whenever fit; their growth over three seasons, with and without the drill,
//! is what K1–K3 read. K4 is the world's goals a match.

use std::collections::{BTreeMap, HashMap};

use domain::player::{Player, Position};
use domain::team::PlayStyle;
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
    /// E5-6c: his club's play style when planted (a bot's weekly cycle follows it).
    style: PlayStyle,
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
    /// E5-6c: (style, probe, role, season) → OVR changes of the season.
    growth_style: BTreeMap<(String, usize, usize, u32), Vec<f64>>,
    /// E5-6c: `young`, season by season.
    young_by_season: BTreeMap<u32, (f64, u32, f64, u32)>,
    /// E5-6c: season → (goals scored, sides) of this kind in that season.
    season_goals: BTreeMap<u32, (u32, u32)>,
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
                    style: club.team.play_style.clone(),
                });
            }
        }
        club.probes.start = club.players.iter().map(|p| (p.id.clone(), p.ovr)).collect();
    }
}

/// At each season's end, before aging: each planted player's growth and whether he reached his
/// potential; every young keeper's and outfielder's growth.
pub(super) fn close_season(clubs: &[Club], season_number: u32, first_day: &str, m: &mut Measures) {
    for measure in m.values_mut() {
        let (goals, sides) = measure
            .keeper
            .season_goals
            .values()
            .fold((0, 0), |(g, n), (goals, sides)| (g + goals, n + sides));
        measure.keeper.season_goals.insert(
            season_number,
            (measure.goals - goals, measure.matches - sides),
        );
    }
    young_growth(clubs, season_number, first_day, m);
    for club in clubs {
        let e = &mut kind_measure(m, club.kind).keeper;
        for planted in &club.probes.planted {
            let (Some(player), Some(start)) = (
                club.players.iter().find(|p| p.id == planted.id),
                club.probes.start.get(&planted.id),
            ) else {
                continue;
            };
            let change = f64::from(player.ovr) - f64::from(*start);
            e.growth
                .entry((planted.probe, planted.role, season_number))
                .or_default()
                .push(change);
            e.growth_style
                .entry((
                    format!("{:?}", planted.style),
                    planted.probe,
                    planted.role,
                    season_number,
                ))
                .or_default()
                .push(change);
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
fn young_growth(clubs: &[Club], season_number: u32, first_day: &str, m: &mut Measures) {
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
            let by_season = e.young_by_season.entry(season_number).or_default();
            if primary_position(player) == Position::Goalkeeper {
                e.young.0 += change;
                e.young.1 += 1;
                by_season.0 += change;
                by_season.1 += 1;
            } else {
                e.young.2 += change;
                e.young.3 += 1;
                by_season.2 += change;
                by_season.3 += 1;
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
        keeper_drill_bots: None,
        best_focus: true,
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

// ---- E5-6c-a (E5-6c-tech-spec.md §5): the drill at ×6, a bot's keeper on his own ----

/// §5.1: E5-6b's three seeds and two more.
const SEEDS_X6: [u64; 5] = [SEEDS[0], SEEDS[1], SEEDS[2], 0x0E51_0003, 0x0E51_0004];
/// §5.1: 8 × 6 = 3 × 16, E5-6b's growth in all.
const SEASONS_X6: u32 = 8;
/// K1, true K1 and K2 pool seasons 1–4, before the controls reach their potential (§5.3).
const KAYS_SEASONS: std::ops::RangeInclusive<u32> = 1..=4;
/// The bands of Qe56-4, fixed before the numbers (D18).
const K1_BAND: std::ops::RangeInclusive<f64> = 0.85..=1.15;
const K2_BAND: std::ops::RangeInclusive<f64> = 0.8..=1.25;
/// §5.4 step 5: the drill's own goals a match no lower than this, against M.
const K4_FLOOR: f64 = -0.05;
/// §5.2: the grid (people's, bots' permille).
const GRID: [(u16, u16); 4] = [(300, 100), (350, 150), (400, 200), (400, 250)];
/// §5.2: PD-Q1's cap on the people's permille, and V8's level above it.
const PEOPLE_CAP: u16 = 400;
const PEOPLE_V8: u16 = 450;

/// One variant of §5.2: the people's and the bots' drills, and whether people train their best
/// focus (E54-13) or the club's plan.
#[derive(Clone, Copy)]
struct X6 {
    people: Option<u16>,
    bots: Option<u16>,
    best_focus: bool,
}

impl X6 {
    fn label(self) -> String {
        let permille = |p: Option<u16>| p.map_or("None".to_string(), |p| p.to_string());
        format!(
            "people {} / bots {}, {}",
            permille(self.people),
            permille(self.bots),
            if self.best_focus {
                "best focus"
            } else {
                "the club's plan (Technical)"
            }
        )
    }
}

fn x6_variant(seed: u64, x: X6) -> Variant {
    Variant {
        multiplier: 6.0,
        recovery: Recovery::Blocks(RecoveryBlocks {
            per_day: 6,
            hours: 8,
        }),
        injury_scale: 13,
        places: Some(&PLACES_KEEPER),
        shift: 0,
        rotate: false,
        seasons: SEASONS_X6,
        seed,
        // The gate draft's extra sessions; `Auto` presses nothing, so they do not matter.
        extra: Some(super::extra::ExtraRun::with(ExtraParams {
            floor: 40,
            dev_permille: 250,
        })),
        keeper_drill: x.people.map(drill_at),
        keeper_drill_bots: x.bots.map(drill_at),
        best_focus: x.best_focus,
        probes: true,
    }
}

/// The five seeds of `x`, each on a thread of its own (every run is its own world).
fn runs_x6(x: X6) -> Vec<Measures> {
    std::thread::scope(|scope| {
        let handles: Vec<_> = SEEDS_X6
            .iter()
            .map(|seed| scope.spawn(move || run(x6_variant(*seed, x))))
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("a run"))
            .collect()
    })
}

/// Over the seeds: the OVR changes of `(probe, role)` in `kind`'s clubs in `seasons`.
fn growth_values(
    runs: &[Measures],
    kind: Kind,
    (probe, role): (usize, usize),
    seasons: &std::ops::RangeInclusive<u32>,
) -> Vec<f64> {
    runs.iter()
        .filter_map(|r| r.get(&kind))
        .flat_map(|m| {
            seasons.clone().flat_map(move |s| {
                m.keeper
                    .growth
                    .get(&(probe, role, s))
                    .cloned()
                    .unwrap_or_default()
            })
        })
        .collect()
}

/// The keeper's growth over his controls' in `seasons`.
fn ratio_in(runs: &[Measures], kind: Kind, probe: usize) -> f64 {
    let at = |role| mean(&growth_values(runs, kind, (probe, role), &KAYS_SEASONS));
    at(0) / mean(&[at(1), at(2)]).max(f64::EPSILON)
}

/// K2 by the bot's play style: every probe of the style pooled, seasons 1–4; with the keepers
/// counted.
fn k2_by_style(runs: &[Measures]) -> Vec<(String, f64, usize)> {
    let mut pooled: BTreeMap<String, [Vec<f64>; 3]> = BTreeMap::new();
    for m in runs.iter().filter_map(|r| r.get(&Kind::Bot)) {
        for ((style, _, role, season), values) in &m.keeper.growth_style {
            if KAYS_SEASONS.contains(season) {
                pooled.entry(style.clone()).or_default()[*role].extend(values);
            }
        }
    }
    pooled
        .into_iter()
        .map(|(style, [keeper, back, mid])| {
            let controls = mean(&[mean(&back), mean(&mid)]);
            (
                style,
                mean(&keeper) / controls.max(f64::EPSILON),
                keeper.len(),
            )
        })
        .collect()
}

/// Goals a match of the whole world in `seasons`, pooled over the seeds.
fn goals_in(runs: &[Measures], seasons: std::ops::RangeInclusive<u32>) -> f64 {
    let (goals, sides) = runs
        .iter()
        .flat_map(|r| r.values())
        .flat_map(|m| {
            m.keeper
                .season_goals
                .iter()
                .filter(|(s, _)| seasons.contains(s))
                .map(|(_, v)| *v)
        })
        .fold((0u32, 0u32), |(g, n), (goals, sides)| {
            (g + goals, n + sides)
        });
    2.0 * f64::from(goals) / f64::from(sides.max(1))
}

/// ≤ 25 keepers' growth over ≤ 25 outfielders', seasons 1–4, in `kind`'s clubs.
fn world_ratio(runs: &[Measures], kind: Kind) -> f64 {
    let (k, kn, o, on) = runs
        .iter()
        .filter_map(|r| r.get(&kind))
        .flat_map(|m| {
            m.keeper
                .young_by_season
                .iter()
                .filter(|(s, _)| KAYS_SEASONS.contains(s))
                .map(|(_, v)| *v)
        })
        .fold((0.0, 0, 0.0, 0), |(k, kn, o, on), y| {
            (k + y.0, kn + y.1, o + y.2, on + y.3)
        });
    (k / f64::from(kn.max(1))) / (o / f64::from(on.max(1))).max(f64::EPSILON)
}

/// The median season (1-based) the people's TM-1 and TM-2 `role` reached P, and how many did.
fn reached_people(runs: &[Measures], role: usize) -> (Option<u32>, usize, usize) {
    let all: Vec<Option<u32>> = runs
        .iter()
        .filter_map(|r| r.get(&Kind::Auto))
        .flat_map(|m| {
            (0..2).flat_map(move |probe| {
                m.keeper
                    .reached
                    .get(&(probe, role))
                    .cloned()
                    .unwrap_or_default()
            })
        })
        .collect();
    let mut hit: Vec<u32> = all.iter().flatten().copied().collect();
    hit.sort_unstable();
    // A keeper who never reached P counts as after the last season.
    let median = if hit.len() * 2 > all.len() {
        let mut every: Vec<u32> = all.iter().map(|s| s.unwrap_or(SEASONS_X6 + 1)).collect();
        every.sort_unstable();
        Some(every[every.len() / 2])
    } else {
        None
    };
    (median, hit.len(), all.len())
}

/// One variant's numbers.
struct KaysX6 {
    k1: f64,
    k2: f64,
    /// The people's keepers' (TM-1, TM-2) OVR change a season, seasons 1–4 (§5.4 step 4).
    keeper_delta: f64,
    /// Goals a match of the whole world, season 1 to 8.
    goals: Vec<f64>,
    /// Goals a match of seasons 2–8 and 6–8.
    goals_2_8: f64,
    goals_6_8: f64,
}

fn report_x6(name: &str, x: X6, runs: &[Measures]) -> KaysX6 {
    println!(
        "\n==== {name}: {}, ×6, {} seeds × {SEASONS_X6} seasons ====",
        x.label(),
        runs.len()
    );
    for (kind, probes) in [(Kind::Auto, 0..2), (Kind::Bot, 0..4)] {
        for probe in probes {
            let (probe_name, ovr, potential, age, _) = PROBES[probe];
            let at = |role| mean(&growth_values(runs, kind, (probe, role), &KAYS_SEASONS));
            println!(
                "  {kind:?} {probe_name} ({ovr}/{potential}, {age}), seasons 1–4: ΔOVR a season keeper {:+.2} · centre-back {:+.2} · midfielder {:+.2} · keeper / controls {:.2}",
                at(0),
                at(1),
                at(2),
                ratio_in(runs, kind, probe)
            );
        }
    }
    let k1 = mean(&[ratio_in(runs, Kind::Auto, 0), ratio_in(runs, Kind::Auto, 1)]);
    let k2 = mean(
        &(0..4)
            .map(|p| ratio_in(runs, Kind::Bot, p))
            .collect::<Vec<_>>(),
    );
    let styles: Vec<String> = k2_by_style(runs)
        .into_iter()
        .map(|(style, k, n)| format!("{style} {k:.2} (n={n})"))
        .collect();
    println!("  K2 by the bot's style: {}", styles.join(" · "));
    let k3 = |role| {
        let (median, hit, n) = reached_people(runs, role);
        format!(
            "{hit}/{n}, median season {}",
            median.map_or(format!("> {SEASONS_X6}"), |s| s.to_string())
        )
    };
    println!(
        "  K3 (printed) people's TM-1, TM-2 reached P in {SEASONS_X6} seasons: keeper {} · centre-back {}",
        k3(0),
        k3(1)
    );
    let keeper_delta = mean(&[
        mean(&growth_values(runs, Kind::Auto, (0, 0), &KAYS_SEASONS)),
        mean(&growth_values(runs, Kind::Auto, (1, 0), &KAYS_SEASONS)),
    ]);
    println!(
        "  world (printed) ≤25 keepers / ≤25 outfielders, seasons 1–4: Auto {:.2} · Bot {:.2}",
        world_ratio(runs, Kind::Auto),
        world_ratio(runs, Kind::Bot)
    );
    let goals: Vec<f64> = (1..=SEASONS_X6).map(|s| goals_in(runs, s..=s)).collect();
    let by_season: Vec<String> = goals
        .iter()
        .enumerate()
        .map(|(i, g)| format!("s{} {g:.3}", i + 1))
        .collect();
    println!("  goals a match by season: {}", by_season.join(" · "));
    let (goals_2_8, goals_6_8) = (
        goals_in(runs, 2..=SEASONS_X6),
        goals_in(runs, 6..=SEASONS_X6),
    );
    println!(
        "  K1 {k1:.2} (0.85–1.15) · K2 {k2:.2} (0.8–1.25) · people's keeper ΔOVR a season (s1–4) {keeper_delta:+.2} · goals a match s2–8 {goals_2_8:.3}, s6–8 {goals_6_8:.3}"
    );
    KaysX6 {
        k1,
        k2,
        keeper_delta,
        goals,
        goals_2_8,
        goals_6_8,
    }
}

/// §5.4 step 1: among the grid's bots' permille, the one whose K2 is nearest 1.0 within its band.
fn pick_bots(rows: &[(u16, f64)]) -> Option<u16> {
    rows.iter()
        .filter(|(_, k2)| K2_BAND.contains(k2))
        .min_by(|a, b| (a.1 - 1.0).abs().total_cmp(&(b.1 - 1.0).abs()))
        .map(|(p, _)| *p)
}

/// §5.4 step 2: among the people's permille, the one whose K1 is nearest 1.0 within its band.
fn pick_people(levels: &[(u16, f64)]) -> Option<u16> {
    levels
        .iter()
        .filter(|(_, k1)| K1_BAND.contains(k1))
        .min_by(|a, b| (a.1 - 1.0).abs().total_cmp(&(b.1 - 1.0).abs()))
        .map(|(p, _)| *p)
}

/// The share K4 apart reads: the variant's goals of seasons 2–8 over V0's, against M.
fn k4_apart(k: &KaysX6, v0: &KaysX6, m: f64) -> f64 {
    (k.goals_2_8 - v0.goals_2_8) / m.max(f64::EPSILON)
}

fn in_bands_x6(k: &KaysX6) -> bool {
    K1_BAND.contains(&k.k1) && K2_BAND.contains(&k.k2)
}

/// E5-6c-a: §5.2's variants and §5.4's rules. Every place §5.4 hands a choice on to the user is
/// PO's (the user's delegation of 2026-11-01): the variant it needs is run and the numbers named.
pub(super) fn measure_keeper_drill_x6() {
    let measured = |name: &str, x: X6| {
        let runs = runs_x6(x);
        report_x6(name, x, &runs)
    };
    let none = X6 {
        people: None,
        bots: None,
        best_focus: true,
    };
    let v0 = measured("V0", none);
    let m = v0.goals[0];
    println!("\n  M = V0's goals a match in season 1: {m:.3}");
    let mut grid = Vec::new();
    for (i, (people, bots)) in GRID.into_iter().enumerate() {
        let x = X6 {
            people: Some(people),
            bots: Some(bots),
            best_focus: true,
        };
        let k = measured(&format!("V{}", i + 1), x);
        grid.push(((people, bots), k));
    }
    let v5 = measured(
        "V5",
        X6 {
            best_focus: false,
            ..none
        },
    );

    println!("\n==== §5.4 ====");
    for ((people, bots), k) in &grid {
        println!(
            "  {people}/{bots}: K1 {:.2} · K2 {:.2} · K4 apart {:+.1} % · K4 world {:+.1} %",
            k.k1,
            k.k2,
            100.0 * k4_apart(k, &v0, m),
            100.0 * (k.goals_6_8 / m - 1.0)
        );
    }
    println!(
        "  V0: K4 world {:+.1} % (seasons 6–8 against M)",
        100.0 * (v0.goals_6_8 / m - 1.0)
    );
    let mut to_po: Vec<String> = Vec::new();
    // Step 1: the bots' permille, K2 read on each grid row.
    let bot_rows: Vec<(u16, f64)> = grid.iter().map(|((_, b), k)| (*b, k.k2)).collect();
    let bots = pick_bots(&bot_rows).unwrap_or_else(|| {
        let nearest = bot_rows
            .iter()
            .min_by(|a, b| (a.1 - 1.0).abs().total_cmp(&(b.1 - 1.0).abs()))
            .map_or(200, |(p, _)| *p);
        to_po.push(format!(
            "step 1: no bots' permille puts K2 in 0.8–1.25; the rest below is run with the nearest, {nearest}"
        ));
        nearest
    });
    println!("  step 1: bots' permille {bots}");
    // Step 2: the people's permille, K1 read on its rows (400 on both of its rows).
    let people_levels: Vec<(u16, f64)> = [300, 350, PEOPLE_CAP]
        .into_iter()
        .map(|p| {
            let rows: Vec<f64> = grid
                .iter()
                .filter(|((people, _), _)| *people == p)
                .map(|(_, k)| k.k1)
                .collect();
            (p, mean(&rows))
        })
        .collect();
    let k1_at_cap = people_levels.last().map_or(0.0, |(_, k1)| *k1);
    let people = pick_people(&people_levels);
    let mut v8 = None;
    if k1_at_cap < *K1_BAND.start() {
        let x = X6 {
            people: Some(PEOPLE_V8),
            bots: Some(bots),
            best_focus: true,
        };
        let k = measured("V8", x);
        let wrong = measured(
            "V6 at 450",
            X6 {
                best_focus: false,
                ..x
            },
        );
        to_po.push(format!(
            "step 2: K1 at 400 is {k1_at_cap:.2} < 0.85; V8 (450/{bots}): K1 {:.2}, K2 {:.2}, K4 apart {:+.1} %; the club's plan at 450 trains the keeper {:+.2} a season against {:+.2} on the best focus ({})",
            k.k1,
            k.k2,
            100.0 * k4_apart(&k, &v0, m),
            wrong.keeper_delta,
            k.keeper_delta,
            if wrong.keeper_delta <= k.keeper_delta {
                "the wrong focus does not gain"
            } else {
                "the wrong focus GAINS"
            }
        ));
        v8 = Some(k);
    }
    let people = people.unwrap_or_else(|| {
        if v8.is_none() {
            to_po.push(
                "step 2: no people's permille puts K1 in 0.85–1.15 and 400's is above it"
                    .to_string(),
            );
        }
        PEOPLE_CAP
    });
    println!(
        "  step 2: people's permille {people} (K1 by level: {})",
        people_levels
            .iter()
            .map(|(p, k)| format!("{p} {k:.2}"))
            .collect::<Vec<_>>()
            .join(", ")
    );
    // Step 3: a pair off the grid is confirmed by V7.
    let pair = X6 {
        people: Some(people),
        bots: Some(bots),
        best_focus: true,
    };
    let on_grid = grid.iter().position(|(p, _)| *p == (people, bots));
    let v7_owned;
    let v7 = match on_grid {
        Some(row) => {
            println!("  step 3: {people}/{bots} is grid row V{}; no V7", row + 1);
            &grid[row].1
        }
        None => {
            v7_owned = measured("V7", pair);
            if !in_bands_x6(&v7_owned) {
                let fallback = grid.iter().find(|(_, k)| in_bands_x6(k));
                to_po.push(format!(
                    "step 3: V7 {people}/{bots} leaves the bands (K1 {:.2}, K2 {:.2}); grid rows in both bands: {}",
                    v7_owned.k1,
                    v7_owned.k2,
                    fallback.map_or("none".to_string(), |((p, b), _)| format!("{p}/{b}"))
                ));
            }
            &v7_owned
        }
    };
    // Step 4: the club's own plan never trains the keeper faster than the best focus.
    let v6 = measured(
        "V6",
        X6 {
            best_focus: false,
            ..pair
        },
    );
    let invariant = v6.keeper_delta <= v7.keeper_delta;
    println!(
        "  step 4: keeper ΔOVR a season, club's plan {:+.2} ≤ best focus {:+.2}: {} · true K1 (printed) V5 {:.2}, V6 {:.2}",
        v6.keeper_delta,
        v7.keeper_delta,
        if invariant { "ok" } else { "FAIL" },
        v5.k1,
        v6.k1
    );
    if !invariant {
        to_po.push(format!(
            "step 4: the club's plan trains the keeper faster ({:+.2}) than the best focus ({:+.2})",
            v6.keeper_delta, v7.keeper_delta
        ));
    }
    // Step 5: the drill's own goals.
    let k4 = k4_apart(v7, &v0, m);
    println!(
        "  step 5: K4 apart {:+.1} % (≥ {:.0} %) · K4 world {:+.1} % (V0 {:+.1} %)",
        100.0 * k4,
        100.0 * K4_FLOOR,
        100.0 * (v7.goals_6_8 / m - 1.0),
        100.0 * (v0.goals_6_8 / m - 1.0)
    );
    if k4 < K4_FLOOR {
        to_po.push(format!(
            "step 5: K4 apart {:+.1} % < −5 % (Qe56c-3 = b: the pair goes in with the goals package); grid: {}",
            100.0 * k4,
            grid.iter()
                .map(|((p, b), k)| format!("{p}/{b} {:+.1} %", 100.0 * k4_apart(k, &v0, m)))
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    let pair_ok = in_bands_x6(v7) && invariant;
    if to_po.is_empty() && pair_ok {
        println!(
            "\n  chosen: keeperDrill {people}/{people}/{people}, botKeeperDrill {bots}/{bots}/{bots} (K1 {:.2}, K2 {:.2}, K4 apart {:+.1} %)",
            v7.k1,
            v7.k2,
            100.0 * k4
        );
    } else {
        println!(
            "\n  pair measured: keeperDrill {people}, botKeeperDrill {bots} (K1 {:.2}, K2 {:.2}, K4 apart {:+.1} %)",
            v7.k1,
            v7.k2,
            100.0 * k4
        );
        for line in &to_po {
            println!("  to PO (the user's delegation): {line}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bots_level_nearest_one_within_the_band_is_taken() {
        let rows = [(100, 0.7), (150, 0.92), (200, 1.05), (250, 1.3)];
        assert_eq!(pick_bots(&rows), Some(200));
        assert_eq!(pick_bots(&[(100, 0.5), (250, 1.4)]), None);
    }

    #[test]
    fn the_peoples_level_nearest_one_within_the_band_is_taken() {
        assert_eq!(
            pick_people(&[(300, 0.8), (350, 0.88), (400, 0.93)]),
            Some(400)
        );
        assert_eq!(pick_people(&[(300, 0.7), (350, 0.78), (400, 0.84)]), None);
    }

    #[test]
    fn a_bot_takes_its_own_drill_and_the_peoples_without_one() {
        let (people, bots) = (Some(drill_at(400)), Some(drill_at(200)));
        let drill_for = super::super::keeper_drill_for;
        assert_eq!(drill_for(None, None, Kind::Bot), None);
        assert_eq!(drill_for(people, None, Kind::Bot), people);
        assert_eq!(drill_for(people, bots, Kind::Bot), bots);
        assert_eq!(drill_for(people, bots, Kind::Auto), people);
    }
}
