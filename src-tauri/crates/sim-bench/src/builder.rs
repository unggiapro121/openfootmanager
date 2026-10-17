use engine::{
    Foot, PitchPosition, PlayStyle, PlayerData, PlayerRole, Position, TacticsConfig, TeamData,
};
use rand::{Rng, RngExt};

/// Build a synthetic team around `avg_ovr`: one player per slot of the
/// formation, each with the attributes, height, foot and roles of real players
/// at that position (phase 2, P3.0, X61).
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
    let (formation, slots) = formation_layout(formation);
    TeamData {
        id: id.to_string(),
        name: name.to_string(),
        formation,
        play_style,
        coach: engine::CoachMastery::default(),
        tactics,
        players: build_group(id, "", avg_ovr, &slots, rng),
    }
}

/// The formation the side plays (4-4-2 for one that does not lay out eleven)
/// and its eleven slots, keeper first. Each player is built for the slot he
/// stands in (phase 2, P3.0, X61), and his group comes from that slot, so
/// 3-4-2-1's wing-backs are defenders standing in its second row (P2.7, X44).
fn formation_layout(formation: &str) -> (String, Vec<PitchPosition>) {
    let slots = engine::formation_slots(formation);
    if slots.len() == 11 {
        (formation.to_string(), slots)
    } else {
        ("4-4-2".to_string(), engine::formation_slots("4-4-2"))
    }
}

/// A seven-man bench — keeper, centre back, full back, central midfielder,
/// wide midfielder and two strikers (GĐ3-tech-spec §4.5) — `bench_penalty`
/// points weaker than the XI so a substitution has a cost. Ids carry a `sub`
/// tag, so they never collide with the starters.
pub fn build_bench(
    team_id: &str,
    avg_ovr: u8,
    bench_penalty: u8,
    rng: &mut impl Rng,
) -> Vec<PlayerData> {
    use PitchPosition::{
        CenterBack, CentralMidfielder, Goalkeeper, RightBack, RightMidfielder, Striker,
    };
    build_group(
        team_id,
        "sub",
        avg_ovr.saturating_sub(bench_penalty),
        &[
            Goalkeeper,
            CenterBack,
            RightBack,
            CentralMidfielder,
            RightMidfielder,
            Striker,
            Striker,
        ],
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

/// One player per slot, ids namespaced by `tag` so a squad's starters and its
/// bench never collide (`tag` is empty for starters). Each player is numbered
/// within his group (GK1, DEF1, DEF2, …, MID1, …, FWD1).
fn build_group(
    team_id: &str,
    tag: &str,
    avg_ovr: u8,
    slots: &[PitchPosition],
    rng: &mut impl Rng,
) -> Vec<PlayerData> {
    let mut numbered = [0u8; 4];
    slots
        .iter()
        .map(|&slot| {
            let (label, index) = match slot.group() {
                Position::Goalkeeper => ("GK", 0),
                Position::Defender => ("DEF", 1),
                Position::Midfielder => ("MID", 2),
                Position::Forward => ("FWD", 3),
            };
            numbered[index] += 1;
            make_player(
                team_id,
                &format!("{tag}{label}"),
                numbered[index],
                slot,
                avg_ovr,
                rng,
            )
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Slot profiles (phase 2, P3.0, X61)
// ---------------------------------------------------------------------------

/// The 26 attributes, in the order of the columns of [`OFFSETS`].
const ATTRIBUTES: [&str; 26] = [
    "pace",
    "stamina",
    "strength",
    "agility",
    "passing",
    "long_passing",
    "crossing",
    "curve",
    "free_kick",
    "shooting",
    "long_shots",
    "tackling",
    "dribbling",
    "first_touch",
    "heading",
    "defending",
    "positioning",
    "vision",
    "decisions",
    "composure",
    "aggression",
    "teamwork",
    "leadership",
    "handling",
    "reflexes",
    "aerial",
];

/// The profiles a slot is built from. Left and right share one, so the bench
/// sees no flank stronger than the other; only the foot differs by side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Profile {
    Keeper,
    CentreBack,
    FullBack,
    Holding,
    Central,
    Attacking,
    Wide,
    Winger,
    Striker,
}

impl Profile {
    fn of(slot: PitchPosition) -> Self {
        use PitchPosition as P;
        match slot {
            P::Goalkeeper => Self::Keeper,
            P::CenterBack => Self::CentreBack,
            // No real player is listed at wing-back: they play as full backs.
            P::RightBack | P::LeftBack | P::RightWingBack | P::LeftWingBack => Self::FullBack,
            P::DefensiveMidfielder => Self::Holding,
            P::CentralMidfielder => Self::Central,
            P::AttackingMidfielder => Self::Attacking,
            P::RightMidfielder | P::LeftMidfielder => Self::Wide,
            P::RightWinger | P::LeftWinger => Self::Winger,
            P::Striker => Self::Striker,
        }
    }

    fn index(self) -> usize {
        self as usize
    }
}

/// How far each attribute sits from the OVR, on average, for real players of
/// the profile's position: `attribute − OVR` over the real-world package, OVR
/// worked out at the natural position by `ofm_core::player_rating`. Generated
/// by `fm-document/comon/scripts/gd3-slot-profiles.py`; the measured table,
/// with its spreads, is `fm-document/comon/sim-bench/reference/
/// gd3-slot-profiles.txt`. Rows follow [`Profile`], columns [`ATTRIBUTES`].
#[rustfmt::skip]
const OFFSETS: [[i8; 26]; 9] = [
    // Keeper
    [-28, -34, -3, -23, -34, 1, -49, -48, -49, -45, -43, -50, -50, -43, -49, -50, 1, -23, -4, -21, -37, -27, -19, 2, 4, -1],
    // CentreBack
    [-7, -3, 8, -13, -8, -12, -26, -30, -34, -32, -30, 0, -20, -11, -1, -1, -1, -24, -5, -9, -1, -15, -21, -57, -58, 7],
    // FullBack
    [8, 5, -4, 3, -4, -11, -3, -12, -22, -22, -19, -2, -3, -4, -12, -4, -4, -12, -4, -8, -4, -8, -21, -56, -56, -1],
    // Holding
    [-4, 6, 1, -1, 3, 0, -13, -14, -17, -16, -10, 0, -4, -1, -9, -1, -1, -4, -1, -4, 2, 0, -19, -57, -57, 0],
    // Central
    [-1, 5, -5, 3, 3, 0, -10, -9, -12, -10, -6, -6, 0, 1, -14, -8, -3, 0, -1, -4, -4, 2, -20, -56, -56, -5],
    // Attacking
    [4, -2, -11, 7, 3, -3, -7, -4, -8, -4, -4, -23, 3, 3, -18, -25, -2, 1, -2, -1, -14, 1, -22, -57, -57, -9],
    // Wide
    [13, 2, -8, 10, -1, -8, -2, -4, -13, -5, -5, -24, 4, 2, -17, -26, -1, -2, -3, -4, -13, -2, -21, -55, -55, -5],
    // Winger
    [10, -3, -12, 7, -4, -12, -5, -7, -15, -4, -6, -33, 3, 1, -20, -34, -3, -5, -6, -6, -18, -5, -24, -56, -56, -9],
    // Striker
    [3, -3, 4, -2, -7, -19, -19, -14, -20, 1, -4, -40, -3, -1, -2, -40, 1, -10, -3, -5, -12, -8, -21, -57, -57, 7],
];

/// Mean and spread of height (cm) for the profile on the real-world package.
const HEIGHTS: [(f64, f64); 9] = [
    (188.9, 5.0),
    (186.8, 4.6),
    (178.3, 5.3),
    (180.9, 6.0),
    (178.7, 5.5),
    (177.2, 6.0),
    (176.7, 5.4),
    (176.5, 6.0),
    (183.4, 6.1),
];

/// Share of left-footed players at the slot's position on the real-world
/// package, which lists nobody as two-footed. Wing-backs take their side's
/// full back.
fn left_footed_share(slot: PitchPosition) -> f64 {
    use PitchPosition as P;
    match slot {
        P::Goalkeeper => 0.12,
        P::CenterBack => 0.24,
        P::LeftBack | P::LeftWingBack => 0.92,
        P::RightBack | P::RightWingBack => 0.01,
        P::DefensiveMidfielder => 0.14,
        P::CentralMidfielder => 0.16,
        P::AttackingMidfielder => 0.26,
        P::LeftMidfielder => 0.29,
        P::RightMidfielder => 0.31,
        P::LeftWinger => 0.14,
        P::RightWinger => 0.35,
        P::Striker => 0.14,
    }
}

/// The roles a player may take at the slot: `domain::Position::valid_roles`,
/// which the engine does not see, copied here.
pub(crate) fn valid_roles(slot: PitchPosition) -> &'static [PlayerRole] {
    use PitchPosition as P;
    use PlayerRole as R;
    match slot {
        P::Goalkeeper => &[R::Standard, R::BallPlayingKeeper, R::SweeperKeeper],
        P::CenterBack => &[R::Standard, R::Stopper, R::CoverCB, R::BallPlayingCB],
        P::RightBack | P::LeftBack | P::RightWingBack | P::LeftWingBack => &[
            R::Standard,
            R::AttackingFB,
            R::DefensiveFB,
            R::InvertedFB,
            R::WingBack,
        ],
        P::DefensiveMidfielder => &[
            R::Standard,
            R::AnchorMan,
            R::BallWinner,
            R::DeepLyingPlaymaker,
        ],
        P::CentralMidfielder => &[R::Standard, R::BoxToBox, R::Carrilero, R::Mezzala],
        P::AttackingMidfielder => &[R::Standard, R::AdvancedPlaymaker, R::ShadowStriker],
        P::RightMidfielder | P::LeftMidfielder | P::RightWinger | P::LeftWinger => &[
            R::Standard,
            R::WideForward,
            R::InsideForward,
            R::InvertedWinger,
        ],
        P::Striker => &[
            R::Standard,
            R::Poacher,
            R::TargetMan,
            R::DeepLyingForward,
            R::False9,
            R::PressingForward,
            R::CompleteForward,
        ],
    }
}

/// The 26 attributes of a player built for `slot` around `avg_ovr`: the
/// profile's offset plus a uniform ±8, rounded and clamped to 10–99.
fn slot_attributes(slot: PitchPosition, avg_ovr: u8, rng: &mut impl Rng) -> [u8; 26] {
    let offsets = OFFSETS[Profile::of(slot).index()];
    offsets.map(|offset| {
        (f64::from(avg_ovr) + f64::from(offset) + rng.random_range(-8.0f64..8.0f64))
            .round()
            .clamp(10.0, 99.0) as u8
    })
}

/// A height (cm) around the real average for the slot's position, with roughly
/// its real spread (a sum of three uniforms stands in for a normal draw).
fn synthetic_height(slot: PitchPosition, rng: &mut impl Rng) -> u16 {
    let (mean, sd) = HEIGHTS[Profile::of(slot).index()];
    let spread: f64 = (0..3).map(|_| rng.random_range(0.0f64..1.0)).sum::<f64>() - 1.5;
    (mean + 2.0 * sd * spread).clamp(160.0, 205.0).round() as u16
}

/// `label` is the player's group label, already carrying any tag — `"GK"` for
/// a starter, `"subGK"` for his deputy.
fn make_player(
    team_id: &str,
    label: &str,
    idx: u8,
    slot: PitchPosition,
    avg_ovr: u8,
    rng: &mut impl Rng,
) -> PlayerData {
    let a = slot_attributes(slot, avg_ovr, rng);
    let at = |key: &str| {
        a[ATTRIBUTES
            .iter()
            .position(|k| *k == key)
            .expect("attribute")]
    };
    let roles = valid_roles(slot);
    let role = roles[rng.random_range(0..roles.len())];
    let footedness = if rng.random_range(0.0f64..1.0) < left_footed_share(slot) {
        Foot::Left
    } else {
        Foot::Right
    };

    PlayerData {
        id: format!("{team_id}_{label}{idx}"),
        name: format!("{label}{idx}"),
        position: slot.group(),
        ovr: avg_ovr,
        condition: rng.random_range(80u8..=100u8),
        fitness: rng.random_range(65u8..=90u8),
        pace: at("pace"),
        stamina: at("stamina"),
        strength: at("strength"),
        agility: at("agility"),
        // Raw, as the bridge hands them over since P4.0 (X64).
        passing: at("passing"),
        shooting: at("shooting"),
        tackling: at("tackling"),
        dribbling: at("dribbling"),
        defending: at("defending"),
        positioning: at("positioning"),
        vision: at("vision"),
        decisions: at("decisions"),
        composure: at("composure"),
        aggression: at("aggression"),
        teamwork: at("teamwork"),
        leadership: at("leadership"),
        handling: at("handling"),
        reflexes: at("reflexes"),
        aerial: at("aerial"),
        long_passing: at("long_passing"),
        crossing: at("crossing"),
        curve: at("curve"),
        free_kick: at("free_kick"),
        long_shots: at("long_shots"),
        first_touch: at("first_touch"),
        heading: at("heading"),
        height_cm: synthetic_height(slot, rng),
        footedness,
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

    /// A built player's 26 attributes as the game's own attribute block.
    fn domain_attributes(a: &[u8; 26]) -> domain::player::PlayerAttributes {
        let map: serde_json::Map<String, serde_json::Value> = ATTRIBUTES
            .iter()
            .zip(a)
            .map(|(k, v)| (k.to_string(), serde_json::Value::from(*v)))
            .collect();
        serde_json::from_value(serde_json::Value::Object(map)).expect("26 attributes")
    }

    fn domain_position(slot: PitchPosition) -> domain::player::Position {
        use domain::player::Position as D;
        use PitchPosition as P;
        match slot {
            P::Goalkeeper => D::Goalkeeper,
            P::RightBack => D::RightBack,
            P::CenterBack => D::CenterBack,
            P::LeftBack => D::LeftBack,
            P::RightWingBack => D::RightWingBack,
            P::LeftWingBack => D::LeftWingBack,
            P::DefensiveMidfielder => D::DefensiveMidfielder,
            P::CentralMidfielder => D::CentralMidfielder,
            P::AttackingMidfielder => D::AttackingMidfielder,
            P::RightMidfielder => D::RightMidfielder,
            P::LeftMidfielder => D::LeftMidfielder,
            P::RightWinger => D::RightWinger,
            P::LeftWinger => D::LeftWinger,
            P::Striker => D::Striker,
        }
    }

    const ALL_SLOTS: [PitchPosition; 14] = [
        PitchPosition::Goalkeeper,
        PitchPosition::RightBack,
        PitchPosition::CenterBack,
        PitchPosition::LeftBack,
        PitchPosition::RightWingBack,
        PitchPosition::LeftWingBack,
        PitchPosition::DefensiveMidfielder,
        PitchPosition::CentralMidfielder,
        PitchPosition::AttackingMidfielder,
        PitchPosition::RightMidfielder,
        PitchPosition::LeftMidfielder,
        PitchPosition::RightWinger,
        PitchPosition::LeftWinger,
        PitchPosition::Striker,
    ];

    /// Given players built for each slot around OVR 55, 70 and 85,
    /// when the game rates them at that slot,
    /// then their mean OVR is within one point of the level asked for: the
    /// profiles are the real offsets from OVR, so a side built "at 70" is a
    /// side of 70s (phase 2, P3.0, X61).
    #[test]
    fn players_built_for_a_slot_rate_at_the_level_asked_for() {
        let mut rng = StdRng::seed_from_u64(7);
        for slot in ALL_SLOTS {
            for level in [55u8, 70, 85] {
                let n = 2_000;
                let mean = (0..n)
                    .map(|_| {
                        let a = slot_attributes(slot, level, &mut rng);
                        ofm_core::player_rating::ovr_from_attributes(
                            &domain_attributes(&a),
                            &domain_position(slot),
                        )
                    })
                    .sum::<f64>()
                    / f64::from(n);
                assert!(
                    (mean - f64::from(level)).abs() <= 1.0,
                    "{slot:?} at {level}: mean OVR {mean:.2}"
                );
            }
        }
    }

    /// Given every slot,
    /// when players are built for it,
    /// then each takes a role the game allows at that slot — a left back is
    /// never handed a centre back's role (phase 2, P3.0, X61).
    #[test]
    fn a_built_player_takes_a_role_his_slot_allows() {
        let mut rng = StdRng::seed_from_u64(11);
        for slot in ALL_SLOTS {
            let allowed = domain_position(slot).valid_roles();
            for _ in 0..200 {
                let player = make_player("t", "X", 1, slot, 70, &mut rng);
                let name = format!("{:?}", player.role);
                assert!(
                    allowed.iter().any(|r| format!("{r:?}") == name),
                    "{slot:?} got {name}"
                );
            }
        }
    }

    /// Given 10,000 players built for each slot,
    /// when their feet are counted,
    /// then the left-footed share is within 3 points of the real one: 92% at
    /// left back, 1% at right back (phase 2, P3.0, X61).
    #[test]
    fn the_left_footed_share_follows_the_slot() {
        let mut rng = StdRng::seed_from_u64(13);
        for slot in ALL_SLOTS {
            let n = 10_000;
            let left = (0..n)
                .filter(|_| make_player("t", "X", 1, slot, 70, &mut rng).footedness == Foot::Left)
                .count();
            let share = left as f64 / f64::from(n);
            assert!(
                (share - left_footed_share(slot)).abs() <= 0.03,
                "{slot:?}: {share:.3}"
            );
        }
    }

    /// Given a 4-4-2,
    /// when a side is built for it,
    /// then its full backs are quicker and its centre backs taller, as real
    /// ones are, instead of sharing one defender profile.
    #[test]
    fn full_backs_and_centre_backs_are_built_differently() {
        let mut rng = StdRng::seed_from_u64(17);
        let (mut fb_pace, mut cb_pace, mut fb_height, mut cb_height) = (0u32, 0u32, 0u32, 0u32);
        for _ in 0..500 {
            let fb = make_player("t", "X", 1, PitchPosition::LeftBack, 70, &mut rng);
            let cb = make_player("t", "X", 1, PitchPosition::CenterBack, 70, &mut rng);
            fb_pace += u32::from(fb.pace);
            cb_pace += u32::from(cb.pace);
            fb_height += u32::from(fb.height_cm);
            cb_height += u32::from(cb.height_cm);
        }
        assert!(fb_pace > cb_pace + 500 * 10, "pace {fb_pace} vs {cb_pace}");
        assert!(
            cb_height > fb_height + 500 * 5,
            "height {cb_height} vs {fb_height}"
        );
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
