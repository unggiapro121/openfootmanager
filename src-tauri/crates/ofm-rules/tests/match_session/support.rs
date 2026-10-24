//! Synthetic sides for the match session's tests: a squad of a given strength and shape, drawn
//! from its own seed so the sides never depend on how the match is played.

use engine::ai::{AiPersonality, AiProfile};
use engine::{
    CoachMastery, MatchConfig, PlayStyle, PlayerData, PlayerRole, Position, TacticsConfig, TeamData,
};
use ofm_rules::match_session::{MatchSeed, MatchSetup};
use rand::{RngExt, SeedableRng};
use rand_chacha::ChaCha12Rng;

/// Upper bound on steps, so a phase-machine bug fails a test instead of hanging it.
pub const MAX_STEPS: usize = 200;

fn attr(rng: &mut ChaCha12Rng, centre: u8, spread: i16) -> u8 {
    (i16::from(centre) + rng.random_range(-spread..=spread)).clamp(1, 99) as u8
}

pub fn player(rng: &mut ChaCha12Rng, id: String, position: Position, rating: u8) -> PlayerData {
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

/// Outfield lines of a formation, midfield lines summed.
fn lines(formation: &str) -> (usize, usize, usize) {
    let parts: Vec<usize> = formation
        .split('-')
        .filter_map(|part| part.parse().ok())
        .collect();
    let mid = parts[1..parts.len() - 1].iter().sum();
    (parts[0], mid, parts[parts.len() - 1])
}

/// A side of `rating` in `formation`, its XI in slot order (GK, defenders, midfielders,
/// forwards) with ids `<tag>00`…, and a seven-man bench `<tag>s0`…`<tag>s6`.
pub fn squad(
    rng: &mut ChaCha12Rng,
    tag: &str,
    rating: u8,
    style: PlayStyle,
    formation: &str,
) -> (TeamData, Vec<PlayerData>) {
    let (def, mid, fwd) = lines(formation);
    let group = |i: usize| match i {
        0 => Position::Goalkeeper,
        i if i <= def => Position::Defender,
        i if i <= def + mid => Position::Midfielder,
        _ => Position::Forward,
    };
    let players = (0..=def + mid + fwd)
        .map(|i| player(rng, format!("{tag}{i:02}"), group(i), rating))
        .collect();
    let bench = [
        Position::Goalkeeper,
        Position::Defender,
        Position::Defender,
        Position::Midfielder,
        Position::Midfielder,
        Position::Forward,
        Position::Forward,
    ]
    .iter()
    .enumerate()
    .map(|(i, &position)| {
        player(
            rng,
            format!("{tag}s{i}"),
            position,
            rating.saturating_sub(6),
        )
    })
    .collect();
    let team = TeamData {
        id: tag.to_string(),
        name: tag.to_string(),
        formation: formation.to_string(),
        play_style: style,
        players,
        tactics: TacticsConfig::default(),
        coach: CoachMastery::default(),
    };
    (team, bench)
}

pub fn manager() -> AiProfile {
    AiProfile {
        reputation: 600,
        experience: 60,
        personality: AiPersonality::Pragmatist,
    }
}

/// A 32-byte seed spread from a number.
pub fn seed(number: u64) -> MatchSeed {
    let mut key = [0u8; 32];
    for (i, chunk) in key.chunks_exact_mut(8).enumerate() {
        chunk.copy_from_slice(
            &(number ^ (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)).to_le_bytes(),
        );
    }
    MatchSeed(key)
}

/// A setup of two sides of the given ratings and shapes, sides drawn from `number`.
pub fn setup(number: u64, home: (u8, PlayStyle, &str), away: (u8, PlayStyle, &str)) -> MatchSetup {
    let mut rng = ChaCha12Rng::seed_from_u64(number ^ 0x7EA4_5EED);
    let (home_team, home_bench) = squad(&mut rng, "h", home.0, home.1, home.2);
    let (away_team, away_bench) = squad(&mut rng, "a", away.0, away.1, away.2);
    MatchSetup {
        home: home_team,
        away: away_team,
        home_bench,
        away_bench,
        config: MatchConfig::default(),
        allows_extra_time: false,
        seed: seed(number),
        ai_home: manager(),
        ai_away: manager(),
        injury_window_steps: None,
        licence_home: None,
        licence_away: None,
    }
}

/// An even 4-4-2 meeting drawn from `number`.
pub fn even_setup(number: u64) -> MatchSetup {
    setup(
        number,
        (70, PlayStyle::Balanced, "4-4-2"),
        (70, PlayStyle::Balanced, "4-4-2"),
    )
}
