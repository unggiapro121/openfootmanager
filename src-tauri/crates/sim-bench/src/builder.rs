use engine::{PlayStyle, PlayerData, PlayerRole, Position, TacticsConfig, TeamData};
use rand::{Rng, RngExt};

/// Build a synthetic team with per-attribute values centered on `avg_ovr`.
/// Formation is parsed as "4-3-3" → 4 DEF, 3 MID, 3 FWD (plus 1 GK always).
/// Player roles are sampled from position-appropriate distributions.
pub fn build_team(
    id: &str,
    name: &str,
    avg_ovr: u8,
    play_style: PlayStyle,
    formation: &str,
    rng: &mut impl Rng,
) -> TeamData {
    build_team_with_tactics(
        id,
        name,
        avg_ovr,
        play_style,
        formation,
        TacticsConfig::default(),
        rng,
    )
}

pub fn build_team_with_tactics(
    id: &str,
    name: &str,
    avg_ovr: u8,
    play_style: PlayStyle,
    formation: &str,
    tactics: TacticsConfig,
    rng: &mut impl Rng,
) -> TeamData {
    let (formation, outfield) = outfield_groups(formation);
    TeamData {
        id: id.to_string(),
        name: name.to_string(),
        formation,
        play_style,
        coach: engine::CoachMastery::default(),
        tactics,
        players: build_group(id, "", avg_ovr, &outfield, rng),
    }
}

/// The formation the side plays (4-4-2 for one that does not lay out eleven)
/// and the group of each outfield slot, in slot order. Groups come from the
/// slots, not from counting the formation's rows, so 3-4-2-1's wing-backs are
/// defenders standing in its second row (phase 2, P2.7, X44); for every
/// formation whose groups run back to front the result is what counting gave.
fn outfield_groups(formation: &str) -> (String, Vec<Position>) {
    let slots = engine::formation_slots(formation);
    let (formation, slots) = if slots.len() == 11 {
        (formation.to_string(), slots)
    } else {
        ("4-4-2".to_string(), engine::formation_slots("4-4-2"))
    };
    let groups = slots.iter().skip(1).map(|slot| slot.group()).collect();
    (formation, groups)
}

/// A seven-man bench: a keeper and two of each outfield group, `bench_penalty`
/// points weaker than the XI so a substitution has a cost. Ids carry a `sub`
/// tag, so they never collide with the starters.
pub fn build_bench(
    team_id: &str,
    avg_ovr: u8,
    bench_penalty: u8,
    rng: &mut impl Rng,
) -> Vec<PlayerData> {
    use Position::{Defender, Forward, Midfielder};
    build_group(
        team_id,
        "sub",
        avg_ovr.saturating_sub(bench_penalty),
        &[Defender, Defender, Midfielder, Midfielder, Forward, Forward],
        rng,
    )
}

/// The same team under another id: every player keeps every attribute, only the
/// ids change, so a match against it is a match between two identical sides.
pub fn mirror(team: &TeamData, id: &str, name: &str) -> TeamData {
    let mut copy = team.clone();
    copy.id = id.to_string();
    copy.name = name.to_string();
    for player in &mut copy.players {
        player.id = player.id.replacen(&team.id, id, 1);
    }
    copy
}

/// One GK plus the outfield shape, ids namespaced by `tag` so a squad's starters
/// and its bench never collide. `tag` is empty for starters, which keeps their
/// ids byte-identical to what the single-XI builders have always produced — the
/// existing seeded benchmarks stay reproducible.
fn build_group(
    team_id: &str,
    tag: &str,
    avg_ovr: u8,
    outfield: &[Position],
    rng: &mut impl Rng,
) -> Vec<PlayerData> {
    let mut players = Vec::with_capacity(outfield.len() + 1);
    players.push(make_player(
        team_id,
        &format!("{tag}GK"),
        1,
        1,
        Position::Goalkeeper,
        avg_ovr,
        rng,
    ));
    // Each player is numbered within his group (DEF1, DEF2, …), as the
    // row-by-row builder numbered them, so seeded benchmarks keep their ids.
    let mut numbered = [0u8; 3];
    for &group in outfield {
        let (label, slot) = match group {
            Position::Defender => ("DEF", 0),
            Position::Midfielder => ("MID", 1),
            _ => ("FWD", 2),
        };
        numbered[slot] += 1;
        let total = outfield.iter().filter(|g| **g == group).count() as u8;
        players.push(make_player(
            team_id,
            &format!("{tag}{label}"),
            numbered[slot],
            total,
            group,
            avg_ovr,
            rng,
        ));
    }
    players
}

fn sample_role(
    position: Position,
    slot_idx: u8,
    total_in_position: u8,
    rng: &mut impl Rng,
) -> PlayerRole {
    match position {
        Position::Goalkeeper => {
            const ROLES: [PlayerRole; 3] = [
                PlayerRole::Standard,
                PlayerRole::BallPlayingKeeper,
                PlayerRole::SweeperKeeper,
            ];
            ROLES[rng.random_range(0usize..3)]
        }
        Position::Defender => {
            // FB count: 0 for 3-back, 2 for 4-back and 5-back.
            // CB slots are the first (total - fb_count) slots.
            let fb_count = if total_in_position <= 3 { 0u8 } else { 2u8 };
            let cb_count = total_in_position - fb_count;
            if slot_idx <= cb_count {
                // CB slots
                const ROLES: [PlayerRole; 3] = [
                    PlayerRole::Stopper,
                    PlayerRole::CoverCB,
                    PlayerRole::BallPlayingCB,
                ];
                ROLES[rng.random_range(0usize..3)]
            } else {
                // FB/WB slots
                const ROLES: [PlayerRole; 4] = [
                    PlayerRole::AttackingFB,
                    PlayerRole::DefensiveFB,
                    PlayerRole::WingBack,
                    PlayerRole::InvertedFB,
                ];
                ROLES[rng.random_range(0usize..4)]
            }
        }
        Position::Midfielder => {
            if slot_idx == 1 {
                // Holding/DM slot
                const ROLES: [PlayerRole; 3] = [
                    PlayerRole::AnchorMan,
                    PlayerRole::BallWinner,
                    PlayerRole::DeepLyingPlaymaker,
                ];
                ROLES[rng.random_range(0usize..3)]
            } else {
                const ROLES: [PlayerRole; 5] = [
                    PlayerRole::BoxToBox,
                    PlayerRole::Mezzala,
                    PlayerRole::Carrilero,
                    PlayerRole::InvertedWinger,
                    PlayerRole::WideForward,
                ];
                ROLES[rng.random_range(0usize..5)]
            }
        }
        Position::Forward => {
            const ROLES: [PlayerRole; 6] = [
                PlayerRole::Poacher,
                PlayerRole::TargetMan,
                PlayerRole::CompleteForward,
                PlayerRole::False9,
                PlayerRole::DeepLyingForward,
                PlayerRole::PressingForward,
            ];
            ROLES[rng.random_range(0usize..6)]
        }
    }
}

/// A height (cm) around the real average for the position group, with roughly
/// its real spread (a sum of three uniforms stands in for a normal draw).
fn synthetic_height(position: Position, rng: &mut impl Rng) -> u16 {
    let (mean, sd) = match position {
        Position::Goalkeeper => (188.9, 4.7),
        Position::Defender => (183.0, 6.3),
        Position::Midfielder => (178.4, 5.9),
        Position::Forward => (181.6, 7.0),
    };
    let spread: f64 = (0..3).map(|_| rng.random_range(0.0f64..1.0)).sum::<f64>() - 1.5;
    (mean + 2.0 * sd * spread).clamp(160.0, 205.0).round() as u16
}

/// `label` is the player's position label, already carrying any group tag —
/// `"GK"` for a starter, `"subGK"` for his deputy.
fn make_player(
    team_id: &str,
    label: &str,
    idx: u8,
    total_in_position: u8,
    position: Position,
    avg_ovr: u8,
    rng: &mut impl Rng,
) -> PlayerData {
    let base = avg_ovr as f64;

    fn noise(base: f64, rng: &mut impl Rng) -> u8 {
        (base + rng.random_range(-10.0f64..10.0f64)).clamp(10.0, 99.0) as u8
    }
    fn biased(base: f64, offset: f64, rng: &mut impl Rng) -> u8 {
        (base + offset + rng.random_range(-8.0f64..8.0f64)).clamp(10.0, 99.0) as u8
    }

    let (shoot_off, tackle_off, pass_off, defend_off, gk_off) = match position {
        Position::Goalkeeper => (-25.0, 0.0, 0.0, 10.0, 20.0),
        Position::Defender => (-18.0, 12.0, -5.0, 18.0, -15.0),
        Position::Midfielder => (-3.0, 5.0, 12.0, 0.0, -15.0),
        Position::Forward => (18.0, -12.0, 3.0, -18.0, -20.0),
    };

    let role = sample_role(position, idx, total_in_position, rng);

    PlayerData {
        id: format!("{team_id}_{label}{idx}"),
        name: format!("{label}{idx}"),
        position,
        ovr: avg_ovr,
        condition: rng.random_range(80u8..=100u8),
        fitness: rng.random_range(65u8..=90u8),
        pace: noise(base, rng),
        stamina: noise(base, rng),
        strength: noise(base, rng),
        agility: noise(base, rng),
        passing: biased(base, pass_off, rng),
        shooting: biased(base, shoot_off, rng),
        tackling: biased(base, tackle_off, rng),
        dribbling: noise(base, rng),
        defending: biased(base, defend_off, rng),
        positioning: noise(base, rng),
        vision: biased(base, pass_off / 2.0, rng),
        decisions: noise(base, rng),
        composure: noise(base, rng),
        aggression: noise(base, rng),
        teamwork: noise(base, rng),
        leadership: noise(base, rng),
        handling: biased(base, gk_off, rng),
        reflexes: biased(base, gk_off, rng),
        aerial: noise(base, rng),
        long_passing: 0,
        crossing: 0,
        curve: 0,
        free_kick: 0,
        long_shots: 0,
        first_touch: 0,
        heading: 0,
        height_cm: synthetic_height(position, rng),
        traits: vec![],
        role,
        position_ratings: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    /// Given a 3-4-2-1,
    /// when a synthetic side is built for it,
    /// then its wing-back slots (5th and 8th) hold defenders and its central
    /// midfielders midfielders: the groups follow the slots (phase 2, P2.7).
    #[test]
    fn a_three_four_two_one_side_puts_defenders_at_wing_back() {
        let team = build_team(
            "t",
            "T",
            70,
            PlayStyle::Balanced,
            "3-4-2-1",
            &mut StdRng::seed_from_u64(1),
        );
        let groups: Vec<Position> = team.players.iter().map(|p| p.position).collect();
        use Position::*;
        assert_eq!(
            groups,
            vec![
                Goalkeeper, Defender, Defender, Defender, Defender, Midfielder, Midfielder,
                Defender, Midfielder, Midfielder, Forward,
            ]
        );
        assert_eq!(team.formation, "3-4-2-1");
    }

    /// Given a formation that does not lay out eleven,
    /// when a side is built for it,
    /// then it plays 4-4-2.
    #[test]
    fn a_formation_without_eleven_falls_back_to_four_four_two() {
        let team = build_team(
            "t",
            "T",
            70,
            PlayStyle::Balanced,
            "3-4-2",
            &mut StdRng::seed_from_u64(1),
        );
        assert_eq!(team.formation, "4-4-2");
        assert_eq!(team.players.len(), 11);
    }
}
