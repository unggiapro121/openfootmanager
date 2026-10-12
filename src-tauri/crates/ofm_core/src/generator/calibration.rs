//! How good a generated player is, anchored to real football.
//!
//! The squad generator draws a profile's shape; this module decides its level.
//! A player generated to fill a squad — backfill for a thin package club, a
//! random world's squads and free agents, a national pool's depth — is drawn
//! from the lower half of the squads he joins (their 25th to 50th percentile),
//! lowered for his age, and given a potential from the room real players of his
//! age have. Every table below was measured on the real-world 2025/26 package
//! (13,143 EA FC players, with its season projection and potential uplift), so
//! a generated world reads like the real one and a package's real stars are
//! never outshone by the players generated around them.

use std::collections::{HashMap, HashSet};

use domain::league::CompetitionType;
use domain::player::{Player, PlayerAttributes, SquadRole};
use rand::{Rng, RngExt};

use super::competition_def::CompetitionDefinition;
use super::generation::reprice_generated_player;

/// Real players a league needs before its own percentiles replace the
/// reputation table: fewer, and a handful of outliers would set its level.
const MIN_REAL_LEAGUE_PLAYERS: usize = 150;

/// Real players a nation needs before its own pool sets the level of the
/// players generated to fill it.
const MIN_REAL_NATION_PLAYERS: usize = 8;

/// Senior OVR at the 25th and 50th percentile of real squads, by club
/// reputation, interpolated between rows and held at the ends. Reputation is the
/// one level both a package club and a generated club carry on the same scale.
const OVR_BY_REPUTATION: [(f64, f64, f64); 9] = [
    (150.0, 58.0, 60.0),
    (250.0, 59.0, 62.0),
    (350.0, 61.0, 65.0),
    (450.0, 63.0, 67.0),
    (550.0, 64.0, 69.0),
    (650.0, 68.0, 72.0),
    (750.0, 70.0, 75.0),
    (850.0, 74.0, 78.0),
    (950.0, 77.0, 82.0),
];

/// How far a real player's OVR sits from his squad's median, by age: a squad's
/// percentiles describe its 25-to-30-year-olds, and a teenager is well short of them.
fn ovr_offset_for_age(age: u32) -> f64 {
    match age {
        ..=17 => -10.0,
        18 => -8.5,
        19..=20 => -7.0,
        21..=22 => -5.0,
        23 => -3.0,
        24 => -1.0,
        25 => 0.0,
        _ => 1.0,
    }
}

/// Room to grow (potential minus OVR) of real players, by age, at the 10th,
/// 50th, 90th and 99th percentile. Drawing from it makes a high ceiling exactly
/// as rare as it is in the real world, with no cap to tune.
fn headroom_percentiles(age: u32) -> [f64; 4] {
    match age {
        ..=18 => [18.0, 23.0, 27.0, 28.0],
        19 => [15.0, 20.0, 25.0, 28.0],
        20 => [13.0, 18.0, 21.0, 23.0],
        21 => [11.0, 15.0, 19.0, 21.0],
        22 => [9.0, 12.0, 16.0, 19.0],
        23 => [7.0, 11.0, 14.0, 17.0],
        24 => [6.0, 9.0, 12.0, 16.0],
        25 => [5.0, 7.0, 10.0, 13.0],
        26 => [4.0, 6.0, 9.0, 11.0],
        27 => [3.0, 5.0, 7.0, 10.0],
        28 => [2.0, 4.0, 6.0, 9.0],
        29 => [2.0, 3.0, 5.0, 8.0],
        30 => [1.0, 2.0, 5.0, 8.0],
        31 => [1.0, 1.0, 5.0, 8.0],
        _ => [0.0, 1.0, 5.0, 7.0],
    }
}

/// Real senior players per thousand at each age from 18 to 35: few teenagers,
/// a peak from 23 to 26, a long tail into the thirties.
const SENIOR_AGE_WEIGHTS: [(u32, u32); 18] = [
    (18, 1),
    (19, 8),
    (20, 19),
    (21, 36),
    (22, 70),
    (23, 89),
    (24, 85),
    (25, 89),
    (26, 86),
    (27, 81),
    (28, 75),
    (29, 77),
    (30, 62),
    (31, 57),
    (32, 54),
    (33, 47),
    (34, 35),
    (35, 28),
];

/// Median senior OVR of a nation's squad, for nations a world has too few real
/// players of to measure: approximated from their FIFA ranking tier, so a nation
/// generated from nothing plays like the nation it is. Nations not listed take
/// [`UNLISTED_NATION_OVR`].
const NATION_SQUAD_OVR: &[(&str, f64)] = &[
    ("IR", 67.0),
    ("UZ", 65.0),
    ("IQ", 64.0),
    ("QA", 63.0),
    ("AE", 64.0),
    ("JO", 63.0),
    ("SY", 61.0),
    ("BH", 60.0),
    ("OM", 60.0),
    ("TH", 60.0),
    ("LB", 57.0),
    ("PS", 57.0),
    ("KW", 56.0),
    ("YE", 52.0),
    ("PH", 52.0),
    ("ID", 58.0),
    ("MY", 55.0),
    ("VN", 56.0),
    ("KG", 55.0),
    ("TJ", 56.0),
    ("IN", 54.0),
    ("MM", 48.0),
    ("NP", 46.0),
    ("BD", 45.0),
    ("LK", 45.0),
    ("PA", 64.0),
    ("CW", 64.0),
    ("HT", 63.0),
    ("HN", 62.0),
    ("SV", 60.0),
    ("GT", 58.0),
    ("TT", 58.0),
    ("SR", 60.0),
    ("DO", 52.0),
    ("CU", 55.0),
    ("PR", 50.0),
    ("GY", 50.0),
    ("BM", 46.0),
    ("KN", 46.0),
    ("GD", 45.0),
    ("AG", 45.0),
    ("LC", 44.0),
    ("BB", 44.0),
    ("MS", 42.0),
    ("AI", 40.0),
    ("BO", 62.0),
    ("VE", 66.0),
    ("PE", 66.0),
    ("CV", 64.0),
    ("ZA", 64.0),
    ("EG", 66.0),
    ("KE", 60.0),
    ("ZM", 62.0),
    ("UG", 60.0),
    ("GQ", 62.0),
    ("BJ", 62.0),
    ("CF", 60.0),
    ("MR", 61.0),
    ("MZ", 60.0),
    ("TZ", 59.0),
    ("LR", 58.0),
    ("MG", 60.0),
    ("NA", 57.0),
    ("MW", 56.0),
    ("RW", 56.0),
    ("NE", 58.0),
    ("TD", 55.0),
    ("BI", 58.0),
    ("LY", 60.0),
    ("SD", 58.0),
    ("ET", 55.0),
    ("CY", 60.0),
    ("LT", 60.0),
    ("LV", 59.0),
    ("EE", 58.0),
    ("MT", 55.0),
    ("AD", 50.0),
    ("FO", 54.0),
    ("MD", 57.0),
    ("BY", 60.0),
    ("AZ", 59.0),
    ("AM", 61.0),
    ("KZ", 61.0),
    ("LI", 48.0),
    ("SM", 42.0),
    ("GI", 45.0),
    ("NZ", 62.0),
    ("FJ", 48.0),
    ("NC", 46.0),
    ("VU", 44.0),
];

/// The level of a nation absent from [`NATION_SQUAD_OVR`] and from the world.
const UNLISTED_NATION_OVR: f64 = 50.0;

/// The OVR band a generated player's level is drawn from: the 25th and 50th
/// percentile of the squads he joins.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct FillerLevel {
    lower: f64,
    upper: f64,
}

impl FillerLevel {
    /// The level of a club of `reputation`, from [`OVR_BY_REPUTATION`].
    pub(super) fn for_reputation(reputation: u32) -> Self {
        let reputation = f64::from(reputation);
        let first = OVR_BY_REPUTATION[0];
        let last = OVR_BY_REPUTATION[OVR_BY_REPUTATION.len() - 1];
        if reputation <= first.0 {
            return Self {
                lower: first.1,
                upper: first.2,
            };
        }
        if reputation >= last.0 {
            return Self {
                lower: last.1,
                upper: last.2,
            };
        }
        let (below, above) = OVR_BY_REPUTATION
            .windows(2)
            .map(|pair| (pair[0], pair[1]))
            .find(|(_, above)| reputation <= above.0)
            .unwrap_or((last, last));
        let share = (reputation - below.0) / (above.0 - below.0);
        Self {
            lower: below.1 + (above.1 - below.1) * share,
            upper: below.2 + (above.2 - below.2) * share,
        }
    }

    /// The 25th and 50th percentile of real players' OVRs. `None` for an empty pool.
    fn from_real_ovrs(ovrs: &[u8]) -> Option<Self> {
        if ovrs.is_empty() {
            return None;
        }
        let mut sorted = ovrs.to_vec();
        sorted.sort_unstable();
        let at = |share: f64| f64::from(sorted[((sorted.len() - 1) as f64 * share) as usize]);
        Some(Self {
            lower: at(0.25),
            upper: at(0.50),
        })
    }

    /// The level of the players generated to fill nation `code`'s pool: its own
    /// players' when the world holds enough of them, its ranking tier's otherwise.
    pub(super) fn for_nation(code: &str, pool_ovrs: &[u8]) -> Self {
        if pool_ovrs.len() >= MIN_REAL_NATION_PLAYERS
            && let Some(level) = Self::from_real_ovrs(pool_ovrs)
        {
            return level;
        }
        let median = NATION_SQUAD_OVR
            .iter()
            .find(|(nation, _)| *nation == code)
            .map_or(UNLISTED_NATION_OVR, |(_, ovr)| *ovr);
        Self {
            lower: median - 4.0,
            upper: median,
        }
    }

    /// An OVR for a player of `age` at this level.
    fn draw_ovr(self, age: u32, rng: &mut impl Rng) -> f64 {
        let squad_level = self.lower + (self.upper - self.lower) * rng.random_range(0.0..1.0);
        (squad_level + ovr_offset_for_age(age)).clamp(25.0, 92.0)
    }
}

/// A senior player's age, drawn as real squads are spread.
pub(super) fn draw_senior_age(rng: &mut impl Rng) -> u32 {
    let total: u32 = SENIOR_AGE_WEIGHTS.iter().map(|(_, weight)| weight).sum();
    let mut pick = rng.random_range(0..total);
    for (age, weight) in SENIOR_AGE_WEIGHTS {
        if pick < weight {
            return age;
        }
        pick -= weight;
    }
    SENIOR_AGE_WEIGHTS[SENIOR_AGE_WEIGHTS.len() - 1].0
}

/// A potential for a player of `ovr` and `age`: his OVR plus room to grow drawn
/// from [`headroom_percentiles`], read as a piecewise-linear distribution whose
/// tails reach half the 10th percentile and two points past the 99th.
fn draw_potential(ovr: u8, age: u32, rng: &mut impl Rng) -> u8 {
    let [p10, p50, p90, p99] = headroom_percentiles(age);
    let knots = [
        (0.0, p10 * 0.5),
        (0.10, p10),
        (0.50, p50),
        (0.90, p90),
        (0.99, p99),
        (1.0, p99 + 2.0),
    ];
    let share: f64 = rng.random_range(0.0..1.0);
    let headroom = knots
        .windows(2)
        .find(|pair| share <= pair[1].0)
        .map_or(p99, |pair| {
            let ((from_share, from), (to_share, to)) = (pair[0], pair[1]);
            from + (to - from) * (share - from_share) / (to_share - from_share)
        });
    (f64::from(ovr) + headroom)
        .round()
        .clamp(f64::from(ovr), 99.0) as u8
}

/// The average OVR of a raw profile from `generate_random_player_from_def`,
/// whose attributes are drawn on a senior scale around 40–95.
const RAW_PROFILE_OVR: f64 = 68.0;

fn scale_each<'a>(values: impl IntoIterator<Item = &'a mut u8>, factor: f64) {
    for value in values {
        *value = (f64::from(*value) * factor).round().clamp(1.0, 99.0) as u8;
    }
}

/// The attributes a player's body shapes (see `physique::BodyLinks`).
fn body_attributes(attributes: &mut PlayerAttributes) -> [&mut u8; 4] {
    [
        &mut attributes.pace,
        &mut attributes.strength,
        &mut attributes.agility,
        &mut attributes.aerial,
    ]
}

/// Every attribute the body does not shape.
fn trained_attributes(attributes: &mut PlayerAttributes) -> [&mut u8; 15] {
    [
        &mut attributes.stamina,
        &mut attributes.passing,
        &mut attributes.shooting,
        &mut attributes.tackling,
        &mut attributes.dribbling,
        &mut attributes.defending,
        &mut attributes.positioning,
        &mut attributes.vision,
        &mut attributes.decisions,
        &mut attributes.composure,
        &mut attributes.aggression,
        &mut attributes.teamwork,
        &mut attributes.leadership,
        &mut attributes.handling,
        &mut attributes.reflexes,
    ]
}

/// Scale every attribute by `factor`, keeping each within 1–99.
pub(super) fn scale_attributes(attributes: &mut PlayerAttributes, factor: f64) {
    scale_each(body_attributes(attributes), factor);
    scale_each(trained_attributes(attributes), factor);
}

/// Bring a generated player to `level`: his OVR drawn for his age, then a
/// potential drawn for that OVR and age, and his traits, value and wage settled
/// on the result.
///
/// The attributes the body shapes are scaled by the level alone — the target
/// against an average raw profile — and the rest by whatever then lands the OVR.
/// Scaling everything by the player's own raw OVR would undo the body's link: a
/// tall player's aerial ability lifts his raw OVR, so he would be scaled down
/// the hardest, and height would stop predicting it.
pub(super) fn calibrate_generated_player(
    player: &mut Player,
    level: FillerLevel,
    current_year: u32,
    rng: &mut impl Rng,
) {
    use crate::player_rating::natural_ovr;

    let age = crate::player_rating::player_age(&player.date_of_birth, current_year);
    let target = level.draw_ovr(age, rng);
    scale_each(
        body_attributes(&mut player.attributes),
        target / RAW_PROFILE_OVR,
    );
    // Only part of the OVR moves with the trained attributes, and rounding and
    // attributes pinned at 1 or 99 keep any pass from landing exactly; a few
    // passes settle it.
    for _ in 0..10 {
        let ovr = natural_ovr(player);
        if ovr <= 0.0 || (ovr - target).abs() < 0.5 {
            break;
        }
        scale_each(trained_attributes(&mut player.attributes), target / ovr);
    }
    let ovr = natural_ovr(player).round() as u8;
    player.potential = draw_potential(ovr, age, rng);
    crate::player_rating::refresh_player_derived(player, current_year);
    reprice_generated_player(player, current_year);
}

/// Re-level a package's generated backfill to the real players of its league.
///
/// The backfill is first drawn at its club's reputation. Wherever a league holds
/// at least [`MIN_REAL_LEAGUE_PLAYERS`] authored seniors, their own 25th and 50th
/// percentile is the truer level — a package's reputations are an author's
/// estimate, its players are the league itself — so the backfill of that
/// league's clubs is drawn again from it. Only explicitly listed participants
/// are read: a selector resolves against a built world, which does not exist yet.
pub(super) fn calibrate_backfill_to_leagues(
    players: &mut [Player],
    competitions: &[CompetitionDefinition],
    authored_ids: &HashSet<String>,
    current_year: u32,
    rng: &mut impl Rng,
) {
    let mut league_of: HashMap<&str, &str> = HashMap::new();
    for competition in competitions
        .iter()
        .filter(|competition| competition.r#type == CompetitionType::League)
    {
        for team_id in competition.participants.explicit.iter().flatten() {
            league_of.insert(team_id.as_str(), competition.id.as_str());
        }
    }

    let mut real_ovrs: HashMap<&str, Vec<u8>> = HashMap::new();
    for player in players.iter().filter(|player| {
        authored_ids.contains(&player.id) && player.squad_role == SquadRole::Senior
    }) {
        if let Some(league) = player
            .team_id
            .as_deref()
            .and_then(|team_id| league_of.get(team_id))
        {
            real_ovrs.entry(league).or_default().push(player.ovr);
        }
    }
    let levels: HashMap<&str, FillerLevel> = real_ovrs
        .into_iter()
        .filter(|(_, ovrs)| ovrs.len() >= MIN_REAL_LEAGUE_PLAYERS)
        .filter_map(|(league, ovrs)| Some((league, FillerLevel::from_real_ovrs(&ovrs)?)))
        .collect();

    for player in players
        .iter_mut()
        .filter(|player| !authored_ids.contains(&player.id))
    {
        let level = player
            .team_id
            .as_deref()
            .and_then(|team_id| league_of.get(team_id))
            .and_then(|league| levels.get(league))
            .copied();
        if let Some(level) = level {
            calibrate_generated_player(player, level, current_year, rng);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use super::{FillerLevel, draw_potential, draw_senior_age};
    use domain::player::SquadRole;
    use std::collections::HashMap;

    fn median(values: &mut [u8]) -> u8 {
        values.sort_unstable();
        values[values.len() / 2]
    }

    fn seeded_world() -> (Vec<Team>, Vec<Player>) {
        let (teams, players, _) =
            generate_world_seeded(7, &definitions::DefinitionSources::embedded_only());
        (teams, players)
    }

    fn age_of(player: &Player) -> u32 {
        crate::player_rating::player_age(&player.date_of_birth, default_opening_year())
    }

    /// Given a generated world,
    /// when its teenagers are looked at,
    /// then none of them is already a first-team star at a strong club.
    #[test]
    fn a_generated_world_has_no_ready_made_teenage_stars() {
        let (_, players) = seeded_world();
        let prodigies: Vec<(u32, u8)> = players
            .iter()
            .filter(|player| age_of(player) <= 19 && player.ovr >= 75)
            .map(|player| (age_of(player), player.ovr))
            .collect();
        assert!(prodigies.is_empty(), "teenagers rated 75+: {prodigies:?}");
    }

    /// Given a generated world,
    /// when potentials are counted,
    /// then a 90+ ceiling is as rare as it is among real players.
    #[test]
    fn a_ninety_potential_is_rare_in_a_generated_world() {
        let (_, players) = seeded_world();
        let elite = players
            .iter()
            .filter(|player| player.potential >= 90)
            .count();
        let share = elite as f64 / players.len() as f64;
        assert!(
            share <= 0.015,
            "{elite} of {} have potential 90+",
            players.len()
        );
    }

    /// Given a generated world,
    /// when each club's senior squad is rated,
    /// then a small club plays at a small club's level and a big club at a big club's.
    #[test]
    fn generated_squads_follow_their_clubs_reputation() {
        let (teams, players) = seeded_world();
        let mut by_team: HashMap<&str, Vec<u8>> = HashMap::new();
        for player in &players {
            if let Some(team_id) = player.team_id.as_deref()
                && player.squad_role == SquadRole::Senior
            {
                by_team.entry(team_id).or_default().push(player.ovr);
            }
        }
        for team in &teams {
            let squad_median = median(by_team.get_mut(team.id.as_str()).expect("a squad"));
            if team.reputation <= 300 {
                assert!(
                    squad_median <= 66,
                    "{} (reputation {}) has a squad median of {squad_median}",
                    team.name,
                    team.reputation
                );
            }
            if team.reputation >= 750 {
                assert!(
                    squad_median >= 70,
                    "{} (reputation {}) has a squad median of {squad_median}",
                    team.name,
                    team.reputation
                );
            }
        }
    }

    fn pool_median(code: &str, pool_ovrs: &[u8]) -> u8 {
        let mut ovrs: Vec<u8> = (0..40)
            .map(|slot| generate_national_team_player(code, slot, 2026, pool_ovrs).ovr)
            .collect();
        median(&mut ovrs)
    }

    /// Given a nation the world holds no players of,
    /// when its national pool is filled,
    /// then the players it gets play at that nation's real level, not a top league's.
    #[test]
    fn a_minnow_nation_is_filled_at_a_minnows_level() {
        let nepal = pool_median("NP", &[]);
        assert!(
            nepal <= 50,
            "Nepal's generated pool has a median of {nepal}"
        );
        let iran = pool_median("IR", &[]);
        assert!(
            (60..=68).contains(&iran),
            "Iran's generated pool has a median of {iran}"
        );
    }

    /// Given a nation the world holds enough real players of,
    /// when its national pool is topped up,
    /// then the newcomers sit in the lower half of those real players.
    #[test]
    fn a_nation_with_real_players_is_filled_below_them() {
        let real: Vec<u8> = (60..=80).collect();
        let topped_up = pool_median("JP", &real);
        assert!(
            (60..=71).contains(&topped_up),
            "a pool rated 60-80 was topped up at a median of {topped_up}"
        );
    }

    /// Given the real age spread of senior squads,
    /// when senior ages are drawn,
    /// then teenagers are rare and the mid-twenties dominate.
    #[test]
    fn senior_ages_follow_real_squads() {
        use rand::SeedableRng;
        let mut rng = rand::rngs::StdRng::seed_from_u64(3);
        let ages: Vec<u32> = (0..5_000).map(|_| draw_senior_age(&mut rng)).collect();
        let teenagers = ages.iter().filter(|age| **age <= 19).count();
        let prime = ages.iter().filter(|age| (23..=28).contains(*age)).count();
        assert!(
            teenagers < 75,
            "{teenagers} of 5,000 senior draws are teenagers"
        );
        assert!(
            prime > 2_200,
            "only {prime} of 5,000 senior draws are 23-28"
        );
    }

    /// Given the real room to grow of 19-year-olds,
    /// when potentials are drawn for a 19-year-old rated 60,
    /// then most land near 80 and a ceiling of 89 or more — past the real 99th
    /// percentile — is under one in a hundred.
    #[test]
    fn a_high_potential_is_rare_and_lower_ones_common() {
        use rand::SeedableRng;
        let mut rng = rand::rngs::StdRng::seed_from_u64(11);
        let mut potentials: Vec<u8> = (0..10_000)
            .map(|_| draw_potential(60, 19, &mut rng))
            .collect();
        let elite = potentials
            .iter()
            .filter(|potential| **potential >= 89)
            .count();
        assert!((20..=100).contains(&elite), "{elite} of 10,000 reached 89+");
        let middle = median(&mut potentials);
        assert!((78..=82).contains(&middle), "median potential {middle}");
    }

    /// Given a club reputation between two measured rows,
    /// when its level is read,
    /// then it lies between theirs, and the ends of the table hold.
    #[test]
    fn reputation_levels_interpolate_and_hold_at_the_ends() {
        let mid = FillerLevel::for_reputation(400);
        assert_eq!(
            mid,
            FillerLevel {
                lower: 62.0,
                upper: 66.0
            }
        );
        assert_eq!(
            FillerLevel::for_reputation(10),
            FillerLevel::for_reputation(150)
        );
        assert_eq!(
            FillerLevel::for_reputation(2_000),
            FillerLevel::for_reputation(950)
        );
    }

    fn package_team(id: &str) -> TeamDef {
        serde_json::from_value(serde_json::json!({
            "id": id, "name": id, "shortName": id[..3].to_uppercase(), "city": "Town",
            "country": "ENG", "colors": {"primary": "#ffffff", "secondary": "#000000"},
            "playStyle": "Balanced", "stadiumName": "Ground",
            "reputationRange": [700, 700]
        }))
        .expect("a team definition")
    }

    fn package_player(club: &str, index: usize, position: Position) -> package::PlayerDef {
        let mut def: package::PlayerDef =
            serde_json::from_str("{}").expect("PlayerDef should default");
        def.id = format!("{club}-{index}");
        def.first_name = "Real".to_string();
        def.last_name = format!("Player{index}");
        def.club = club.to_string();
        def.nationality = "ENG".to_string();
        def.position = position;
        def.date_of_birth = Some("1998-01-01".to_string());
        def.overall = Some(60);
        def
    }

    fn squad_for(club: &str, size: usize) -> Vec<package::PlayerDef> {
        const LAYOUT: [Position; 10] = [
            Position::Goalkeeper,
            Position::Defender,
            Position::Defender,
            Position::Defender,
            Position::Midfielder,
            Position::Midfielder,
            Position::Midfielder,
            Position::Forward,
            Position::Forward,
            Position::Defender,
        ];
        (0..size)
            .map(|index| package_player(club, index, LAYOUT[index % LAYOUT.len()].clone()))
            .collect()
    }

    /// Given a package league of real players rated about 60, one of whose clubs
    /// is thin, and clubs whose reputation would suggest a stronger league,
    /// when the world is built,
    /// then the players generated to fill the thin club play at that league's level.
    #[test]
    fn backfill_in_a_package_league_plays_at_the_leagues_real_level() {
        let mut package = WorldPackage::default();
        let mut club_ids = Vec::new();
        for index in 0..9 {
            let id = format!("club-{index}");
            package.teams.push(package_team(&id));
            let size = if index == 8 { 5 } else { 22 };
            package.players.extend(squad_for(&id, size));
            club_ids.push(id);
        }
        package.competitions.push(
            serde_json::from_value(serde_json::json!({
                "id": "test-league", "name": "Test League", "type": "League",
                "scope": "Domestic", "countryId": "ENG",
                "format": {"kind": "LeagueTable", "legs": 2},
                "participants": {"explicit": club_ids}
            }))
            .expect("a competition definition"),
        );

        let world = build_world_data_from_package(
            &package,
            Some(2026),
            &definitions::DefinitionSources::embedded_only(),
        );
        let mut backfill: Vec<u8> = world
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some("club-8"))
            .filter(|player| !player.id.starts_with("club-8-"))
            .filter(|player| player.squad_role == SquadRole::Senior)
            .map(|player| player.ovr)
            .collect();
        assert!(
            backfill.len() >= 10,
            "thin club was topped up: {}",
            backfill.len()
        );
        let backfill_median = median(&mut backfill);
        assert!(
            (52..=62).contains(&backfill_median),
            "backfill median {backfill_median} against a league rated about 60"
        );
    }
}
