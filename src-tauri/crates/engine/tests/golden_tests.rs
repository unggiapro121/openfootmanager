//! Golden matches: twenty seeded fixtures whose every event is pinned.
//!
//! The statistical tests elsewhere ask "does the dial move the game the right
//! way over many seeds"; they cannot see a refactor that quietly changes what
//! happens in a match. These pin the exact outcome instead: for each fixture the
//! final score and a fingerprint of the full event sequence.
//!
//! When an engine change is *meant* to change results, the failure message
//! prints the whole regenerated `GOLDEN` table. Paste it over the one below and
//! say in the commit why the results moved, with a sim-bench report alongside.
//! A refactor that is not meant to change results must leave this file alone.
//!
//! Every fixture drives `LiveMatchState` directly, the engine every real
//! fixture goes through. Twelve are headless (no bench, no manager), eight have
//! a seven-man bench and `ai_decide` on both touchlines, as unwatched fixtures
//! do in the game. The RNG is ChaCha12 because its output is fixed by its
//! specification; `StdRng` may change algorithm between `rand` releases.

use engine::ai::{AiPersonality, AiProfile, ai_decide};
use engine::{
    BreakSpeed, CoachMastery, CounterPressDuration, DefensiveLine, DefensiveShape, LiveMatchState,
    MatchConfig, MatchEvent, MatchReport, PlayStyle, PlayerData, PlayerRole, Position,
    PressingIntensity, Side, TacticsBuildUpStyle, TacticsConfig, TacticsPitchWidth, TeamData,
    Tempo,
};
use rand::{Rng, RngExt, SeedableRng};
use rand_chacha::ChaCha12Rng;

/// Upper bound on engine steps for one match, so a phase-machine bug fails the
/// test instead of hanging it. A regulation match takes about 100.
const MAX_STEPS: usize = 200;

/// One side of a golden fixture.
#[derive(Clone, Copy)]
struct Club {
    rating: u8,
    style: PlayStyle,
    formation: &'static str,
    tactics: Tactics,
    /// Give the XI specialist roles and traits, so role and trait code is on the path.
    specialists: bool,
}

/// Named tactic presets, so the table below reads as football rather than as nine dials.
#[derive(Clone, Copy)]
enum Tactics {
    Neutral,
    HighPress,
    LowBlock,
    DirectWide,
}

#[derive(Clone, Copy)]
struct Fixture {
    name: &'static str,
    seed: u64,
    home: Club,
    away: Club,
    /// Seven-man benches and `ai_decide` on both sides.
    managed: bool,
}

const fn club(rating: u8, style: PlayStyle, formation: &'static str) -> Club {
    Club {
        rating,
        style,
        formation,
        tactics: Tactics::Neutral,
        specialists: false,
    }
}

const fn with_tactics(mut s: Club, tactics: Tactics) -> Club {
    s.tactics = tactics;
    s
}

const fn with_specialists(mut s: Club) -> Club {
    s.specialists = true;
    s
}

const fn fixture(name: &'static str, seed: u64, home: Club, away: Club, managed: bool) -> Fixture {
    Fixture {
        name,
        seed,
        home,
        away,
        managed,
    }
}

const FIXTURES: [Fixture; 20] = [
    // Headless: the shape sim-bench measures.
    fixture(
        "even_442",
        1,
        club(70, PlayStyle::Balanced, "4-4-2"),
        club(70, PlayStyle::Balanced, "4-4-2"),
        false,
    ),
    fixture(
        "even_433",
        2,
        club(72, PlayStyle::Balanced, "4-3-3"),
        club(72, PlayStyle::Balanced, "4-3-3"),
        false,
    ),
    fixture(
        "gap_5",
        3,
        club(74, PlayStyle::Attacking, "4-3-3"),
        club(69, PlayStyle::Defensive, "4-5-1"),
        false,
    ),
    fixture(
        "gap_10",
        4,
        club(78, PlayStyle::Possession, "4-2-3-1"),
        club(68, PlayStyle::Counter, "4-4-2"),
        false,
    ),
    fixture(
        "gap_20_away_strong",
        5,
        club(60, PlayStyle::Defensive, "5-3-2"),
        club(80, PlayStyle::Attacking, "4-3-3"),
        false,
    ),
    fixture(
        "three_at_back",
        6,
        club(71, PlayStyle::HighPress, "3-5-2"),
        club(71, PlayStyle::Counter, "3-4-3"),
        false,
    ),
    fixture(
        "one_four_one",
        7,
        club(73, PlayStyle::Possession, "4-1-4-1"),
        club(70, PlayStyle::Balanced, "4-4-2"),
        false,
    ),
    fixture(
        "press_vs_block",
        8,
        with_tactics(club(72, PlayStyle::HighPress, "4-3-3"), Tactics::HighPress),
        with_tactics(club(72, PlayStyle::Defensive, "4-5-1"), Tactics::LowBlock),
        false,
    ),
    fixture(
        "direct_wide",
        9,
        with_tactics(club(70, PlayStyle::Counter, "4-4-2"), Tactics::DirectWide),
        club(71, PlayStyle::Possession, "4-3-3"),
        false,
    ),
    fixture(
        "specialists_433",
        10,
        with_specialists(club(75, PlayStyle::Attacking, "4-3-3")),
        with_specialists(club(74, PlayStyle::HighPress, "4-3-3")),
        false,
    ),
    fixture(
        "low_league",
        11,
        club(52, PlayStyle::Balanced, "4-4-2"),
        club(55, PlayStyle::Counter, "4-4-2"),
        false,
    ),
    fixture(
        "elite",
        12,
        with_specialists(club(86, PlayStyle::Possession, "4-3-3")),
        club(84, PlayStyle::Attacking, "4-2-3-1"),
        false,
    ),
    // Managed: benches and AI managers, as every unwatched fixture in the game.
    fixture(
        "managed_even",
        13,
        club(70, PlayStyle::Balanced, "4-4-2"),
        club(70, PlayStyle::Balanced, "4-4-2"),
        true,
    ),
    fixture(
        "managed_gap_10",
        14,
        club(77, PlayStyle::Attacking, "4-3-3"),
        club(67, PlayStyle::Defensive, "5-3-2"),
        true,
    ),
    fixture(
        "managed_specialists",
        15,
        with_specialists(club(74, PlayStyle::Possession, "4-3-3")),
        with_specialists(club(73, PlayStyle::Counter, "4-3-3")),
        true,
    ),
    fixture(
        "managed_press",
        16,
        with_tactics(
            club(72, PlayStyle::HighPress, "4-2-3-1"),
            Tactics::HighPress,
        ),
        club(72, PlayStyle::Balanced, "4-4-2"),
        true,
    ),
    fixture(
        "managed_block",
        17,
        club(73, PlayStyle::Attacking, "4-3-3"),
        with_tactics(club(69, PlayStyle::Defensive, "4-5-1"), Tactics::LowBlock),
        true,
    ),
    fixture(
        "managed_three_back",
        18,
        club(71, PlayStyle::Counter, "3-4-3"),
        club(71, PlayStyle::Possession, "3-5-2"),
        true,
    ),
    fixture(
        "managed_low_league",
        19,
        club(54, PlayStyle::Balanced, "4-4-2"),
        club(56, PlayStyle::HighPress, "4-4-2"),
        true,
    ),
    fixture(
        "managed_elite",
        20,
        with_specialists(club(85, PlayStyle::Possession, "4-3-3")),
        with_tactics(club(83, PlayStyle::Counter, "4-4-2"), Tactics::DirectWide),
        true,
    ),
];

/// (fixture name, home goals, away goals, event fingerprint), in `FIXTURES` order.
const GOLDEN: [(&str, u8, u8, u64); 20] = [
    ("even_442", 2, 2, 0x1B1BD4095833EA5C),
    ("even_433", 3, 3, 0x82A2A86BE940A460),
    ("gap_5", 2, 0, 0x38497269313E95E6),
    ("gap_10", 3, 0, 0xD1006392350279C6),
    ("gap_20_away_strong", 2, 1, 0x4B65BB168F8A2826),
    ("three_at_back", 3, 1, 0x83E041C1DF5C5754),
    ("one_four_one", 0, 0, 0x9F744F86ECD1AE6D),
    ("press_vs_block", 4, 1, 0x9EEC1C76429BC912),
    ("direct_wide", 0, 2, 0xB113814701B9089E),
    ("specialists_433", 1, 2, 0x3D27875E3EE5C81B),
    ("low_league", 1, 1, 0xB3DE88070FE921E6),
    ("elite", 1, 0, 0xE914FADA72112929),
    ("managed_even", 0, 2, 0x257332E08A9FFD37),
    ("managed_gap_10", 3, 1, 0x1438078D394C0A34),
    ("managed_specialists", 5, 0, 0xCF14E931E3B1011D),
    ("managed_press", 5, 3, 0x8F82F41B45CFE0B9),
    ("managed_block", 0, 1, 0xE850F42C4ACA27F5),
    ("managed_three_back", 1, 0, 0xD6C238DDF78FF261),
    ("managed_low_league", 2, 1, 0x2E932F877501D94E),
    ("managed_elite", 3, 1, 0x797E1BDDF4D416A8),
];

// ---------------------------------------------------------------------------
// Team building: deterministic from the fixture seed, varied enough that every
// attribute, height and condition takes a different value.
// ---------------------------------------------------------------------------

fn tactics_for(preset: Tactics) -> TacticsConfig {
    let mut t = TacticsConfig::default();
    match preset {
        Tactics::Neutral => {}
        Tactics::HighPress => {
            t.pressing_intensity = PressingIntensity::Aggressive;
            t.defensive_line = DefensiveLine::High;
            t.counter_press_duration = CounterPressDuration::Long;
            t.build_up_style = TacticsBuildUpStyle::Short;
        }
        Tactics::LowBlock => {
            t.pressing_intensity = PressingIntensity::Passive;
            t.defensive_line = DefensiveLine::Low;
            t.defensive_shape = DefensiveShape::Compact;
            t.break_speed = BreakSpeed::Fast;
        }
        Tactics::DirectWide => {
            t.width = TacticsPitchWidth::Wide;
            t.tempo = Tempo::Direct;
            t.build_up_style = TacticsBuildUpStyle::Long;
            t.break_speed = BreakSpeed::Fast;
        }
    }
    t
}

/// Outfield lines of a "D-M-F" or "D-DM-AM-F" formation string, midfield lines summed.
fn lines(formation: &str) -> (usize, usize, usize) {
    let parts: Vec<usize> = formation
        .split('-')
        .filter_map(|p| p.parse().ok())
        .collect();
    let (def, fwd) = (parts[0], parts[parts.len() - 1]);
    let mid = parts[1..parts.len() - 1].iter().sum();
    (def, mid, fwd)
}

fn attr(rng: &mut ChaCha12Rng, centre: u8, spread: i16) -> u8 {
    (i16::from(centre) + rng.random_range(-spread..=spread)).clamp(1, 99) as u8
}

fn make_player(rng: &mut ChaCha12Rng, id: String, position: Position, rating: u8) -> PlayerData {
    let is_gk = position == Position::Goalkeeper;
    let keeping = if is_gk { rating } else { 20 };
    PlayerData {
        name: id.clone(),
        id,
        position,
        ovr: rating,
        condition: rng.random_range(80..=100),
        fitness: rng.random_range(65..=95),
        pace: attr(rng, rating, 10),
        stamina: attr(rng, rating, 10),
        strength: attr(rng, rating, 10),
        agility: attr(rng, rating, 10),
        passing: attr(rng, rating, 10),
        shooting: attr(rng, if is_gk { 25 } else { rating }, 10),
        tackling: attr(rng, rating, 10),
        dribbling: attr(rng, rating, 10),
        defending: attr(rng, rating, 10),
        positioning: attr(rng, rating, 10),
        vision: attr(rng, rating, 10),
        decisions: attr(rng, rating, 10),
        composure: attr(rng, rating, 10),
        aggression: attr(rng, 60, 20),
        teamwork: attr(rng, rating, 10),
        leadership: attr(rng, 55, 20),
        handling: attr(rng, keeping, 6),
        reflexes: attr(rng, keeping, 6),
        aerial: attr(rng, rating, 10),
        long_passing: 0,
        crossing: 0,
        curve: 0,
        free_kick: 0,
        long_shots: 0,
        first_touch: 0,
        heading: 0,
        height_cm: rng.random_range(168..=196),
        footedness: Default::default(),
        traits: Vec::new(),
        role: PlayerRole::Standard,
        position_ratings: Vec::new(),
    }
}

/// Specialist roles and a few traits on the XI. The order is GK, defenders,
/// midfielders, forwards, as `make_team` builds it.
fn add_specialists(players: &mut [PlayerData], (def, mid, fwd): (usize, usize, usize)) {
    let defence = [
        PlayerRole::InvertedFB,
        PlayerRole::Stopper,
        PlayerRole::CoverCB,
        PlayerRole::WingBack,
        PlayerRole::BallPlayingCB,
    ];
    let midfield = [
        PlayerRole::AnchorMan,
        PlayerRole::BoxToBox,
        PlayerRole::Mezzala,
        PlayerRole::DeepLyingPlaymaker,
        PlayerRole::AdvancedPlaymaker,
    ];
    let attack = [
        PlayerRole::InsideForward,
        PlayerRole::Poacher,
        PlayerRole::TargetMan,
    ];
    players[0].role = PlayerRole::SweeperKeeper;
    for (i, p) in players[1..=def].iter_mut().enumerate() {
        p.role = defence[i % defence.len()];
    }
    for (i, p) in players[1 + def..=def + mid].iter_mut().enumerate() {
        p.role = midfield[i % midfield.len()];
    }
    for (i, p) in players[1 + def + mid..=def + mid + fwd]
        .iter_mut()
        .enumerate()
    {
        p.role = attack[i % attack.len()];
        p.traits = vec!["Sharpshooter".to_string()];
    }
    players[1 + def].traits = vec!["Playmaker".to_string(), "Visionary".to_string()];
    players[def + mid].traits = vec!["Dribbler".to_string(), "Speedster".to_string()];
}

fn make_squad(
    rng: &mut ChaCha12Rng,
    tag: &str,
    s: Club,
    bench_size: usize,
) -> (TeamData, Vec<PlayerData>) {
    let shape = lines(s.formation);
    let (def, mid, fwd) = shape;
    let group = |i: usize| match i {
        0 => Position::Goalkeeper,
        i if i <= def => Position::Defender,
        i if i <= def + mid => Position::Midfielder,
        _ => Position::Forward,
    };
    let mut players: Vec<PlayerData> = (0..=def + mid + fwd)
        .map(|i| make_player(rng, format!("{tag}{i:02}"), group(i), s.rating))
        .collect();
    if s.specialists {
        add_specialists(&mut players, shape);
    }
    let bench_positions = [
        Position::Goalkeeper,
        Position::Defender,
        Position::Defender,
        Position::Midfielder,
        Position::Midfielder,
        Position::Forward,
        Position::Forward,
    ];
    let bench = bench_positions[..bench_size]
        .iter()
        .enumerate()
        .map(|(i, &pos)| make_player(rng, format!("{tag}s{i}"), pos, s.rating.saturating_sub(6)))
        .collect();
    let team = TeamData {
        id: tag.to_string(),
        name: tag.to_string(),
        formation: s.formation.to_string(),
        play_style: s.style,
        players,
        tactics: tactics_for(s.tactics),
        coach: CoachMastery::default(),
    };
    (team, bench)
}

// ---------------------------------------------------------------------------
// Playing and fingerprinting
// ---------------------------------------------------------------------------

fn play(fixture: &Fixture) -> MatchReport {
    // Teams and the match draw from separate streams, so a change in how teams
    // are built cannot hide inside a change in how the match is played.
    let mut team_rng = ChaCha12Rng::seed_from_u64(fixture.seed ^ 0x7EA4_5EED);
    let bench_size = if fixture.managed { 7 } else { 0 };
    let (home, home_bench) = make_squad(&mut team_rng, "h", fixture.home, bench_size);
    let (away, away_bench) = make_squad(&mut team_rng, "a", fixture.away, bench_size);

    let mut rng = ChaCha12Rng::seed_from_u64(fixture.seed);
    let mut state = LiveMatchState::new(
        home,
        away,
        MatchConfig::default(),
        home_bench,
        away_bench,
        false,
    );
    let manager = AiProfile {
        reputation: 600,
        experience: 60,
        personality: AiPersonality::Pragmatist,
    };
    for _ in 0..MAX_STEPS {
        if state.is_finished() {
            break;
        }
        state.step_minute(&mut rng);
        if fixture.managed {
            manage(&mut state, &manager, &mut rng);
        }
    }
    assert!(
        state.is_finished(),
        "{} did not finish in {MAX_STEPS} steps",
        fixture.name
    );
    state.into_report()
}

/// Both touchlines, as `ofm_core` runs them every minute of an unwatched fixture.
fn manage<R: Rng>(state: &mut LiveMatchState, manager: &AiProfile, rng: &mut R) {
    for side in [Side::Home, Side::Away] {
        for command in ai_decide(state, side, manager, rng) {
            // A refused command (no cover on the bench, substitutions used up)
            // changes nothing; the refusal itself is not part of the match.
            let _ = state.apply_command(command);
        }
    }
}

/// FNV-1a, 64-bit: tiny, and stable across platforms and Rust versions,
/// which `std`'s `DefaultHasher` does not promise.
fn fnv1a(hash: u64, bytes: &[u8]) -> u64 {
    bytes.iter().fold(hash, |h, &b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01B3)
    })
}

/// The fields that make up what happened, written out by name so that adding a
/// field to `MatchEvent` does not by itself move every fingerprint. Event
/// protocol 2's four fields joined in P2.1, after the table was shown to hold
/// without them: they describe what happened, so a change to them is a change
/// to the match.
fn event_line(e: &MatchEvent) -> String {
    format!(
        "{}|{:?}|{:?}|{:?}|{}|{}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}\n",
        e.minute,
        e.event_type,
        e.side,
        e.zone,
        e.player_id.as_deref().unwrap_or("-"),
        e.secondary_player_id.as_deref().unwrap_or("-"),
        e.detail,
        e.shot_kind,
        e.set_piece,
        e.goal_source,
        e.lane,
        e.tactical_context,
    )
}

fn fingerprint(report: &MatchReport) -> u64 {
    report.events.iter().fold(0xCBF2_9CE4_8422_2325, |h, e| {
        fnv1a(h, event_line(e).as_bytes())
    })
}

fn regenerated_table(actual: &[(&str, u8, u8, u64)]) -> String {
    let rows: String = actual
        .iter()
        .map(|(name, h, a, fp)| format!("    (\"{name}\", {h}, {a}, 0x{fp:016X}),\n"))
        .collect();
    format!("const GOLDEN: [(&str, u8, u8, u64); 20] = [\n{rows}];")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// Given the twenty golden fixtures,
/// when each is played on its seed,
/// then its score and event fingerprint match the pinned table.
#[test]
fn golden_fixtures_play_exactly_as_pinned() {
    let actual: Vec<(&str, u8, u8, u64)> = FIXTURES
        .iter()
        .map(|f| {
            let r = play(f);
            (f.name, r.home_goals, r.away_goals, fingerprint(&r))
        })
        .collect();
    let mismatched: Vec<&str> = actual
        .iter()
        .zip(GOLDEN.iter())
        .filter(|(a, g)| a != g)
        .map(|(a, _)| a.0)
        .collect();
    assert!(
        mismatched.is_empty(),
        "golden fixtures changed: {mismatched:?}\n\
         If the change is intended, replace GOLDEN with:\n{}",
        regenerated_table(&actual)
    );
}

/// Given one golden fixture,
/// when it is played twice,
/// then both runs produce the same events, so the table pins the engine and not chance.
#[test]
fn a_golden_fixture_replays_identically() {
    for f in [&FIXTURES[0], &FIXTURES[12]] {
        assert_eq!(
            fingerprint(&play(f)),
            fingerprint(&play(f)),
            "{} is not reproducible",
            f.name
        );
    }
}

/// Given the golden fixtures,
/// when they are played,
/// then the managed ones between them make substitutions and the headless ones
/// make none, so both paths the table claims to cover are really exercised.
/// (One managed match can end with no change; the set as a whole cannot.)
#[test]
fn golden_fixtures_cover_both_the_headless_and_the_managed_path() {
    let substitutions = |f: &Fixture| {
        play(f)
            .events
            .iter()
            .filter(|e| e.event_type == engine::EventType::Substitution)
            .count()
    };
    let managed: usize = FIXTURES
        .iter()
        .filter(|f| f.managed)
        .map(substitutions)
        .sum();
    assert!(
        managed >= 8,
        "managed fixtures made only {managed} substitutions in all"
    );
    for f in FIXTURES.iter().filter(|f| !f.managed) {
        assert_eq!(
            substitutions(f),
            0,
            "{}: a headless fixture made a substitution",
            f.name
        );
    }
}

/// Given the golden fixture table,
/// when it is compared with the fixture list,
/// then they name the same fixtures in the same order.
#[test]
fn golden_table_lists_every_fixture_in_order() {
    let fixtures: Vec<&str> = FIXTURES.iter().map(|f| f.name).collect();
    let golden: Vec<&str> = GOLDEN.iter().map(|g| g.0).collect();
    assert_eq!(fixtures, golden);
}

/// Given a fingerprint over a match's events,
/// when one event's minute changes,
/// then the fingerprint changes, so the table really sees the event sequence.
#[test]
fn the_fingerprint_sees_a_single_changed_event() {
    let mut report = play(&FIXTURES[0]);
    let before = fingerprint(&report);
    report.events[1].minute = report.events[1].minute.wrapping_add(1);
    assert_ne!(before, fingerprint(&report));
}
