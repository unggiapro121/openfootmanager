//! Who takes part where the ball is: presence weights by slot and lane
//! (phase 2, GĐ3, P3.2; GĐ3-tech-spec §6, decisions X48–X50).
//!
//! The one-on-one in the attacking third is no longer a forward
//! drawn at random against a defender drawn at random. Each outfielder is
//! weighted by how present his slot is in the ball's lane — a 4-4-2 attacking
//! down its left mostly sends its left midfielder or left back, and meets the
//! other side's right back — times his condition and a small lift or cut for
//! his role. In midfield the pick stays within the midfield group, weighted
//! the same way.
//!
//! A central slot standing in a row of the same slots leans to one side
//! (`slot_lean`): of a 4-4-2's two centre backs one is the left one, so when
//! the ball is down the defence's right it is the right-sided one who steps
//! across. A defender picked at a flank his slot is not in plays it at
//! κ = 0.82 (S1 §2.2): the flank was empty and he had to come over.

use rand::{Rng, RngExt};

use crate::event::Lane;
use crate::pitch_position::{PitchPosition, formation_slots};
use crate::shared::PlayerSnap;
use crate::types::{PlayerRole, Position, Side};

use super::LiveMatchState;

/// What a defender is worth on a flank his slot is not in (X50).
pub(super) const KAPPA: f64 = 0.82;

/// Which way a central slot leans: of two centre backs side by side, one is
/// the left one and one the right one (GĐ3-tech-spec §6.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Lean {
    Left,
    Centre,
    Right,
}

/// The table a pick reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Column {
    /// The side on the ball, in its attacking third.
    Attack,
    /// The side without it, in its own third.
    Defence,
    /// The side on the ball, midfielders only.
    MidfieldAttack,
    /// The side without it, midfielders only.
    MidfieldDefence,
    /// The side on the ball, in its own third: who plays it out (phase 2,
    /// GĐ4, P4.1, X65).
    BuildUp,
    /// The side without it, in its attacking third: who presses a build-up
    /// (P4.1, X65).
    Press,
}

/// Each slot's lean. Slots come left to right within a row; a central slot
/// in a run of the same slot leans left if first, right if last, centre if
/// between (or alone). A flank slot's lean is never read.
pub(super) fn slot_leans(slots: &[PitchPosition]) -> Vec<Lean> {
    let mut leans = vec![Lean::Centre; slots.len()];
    let mut start = 0;
    while start < slots.len() {
        let mut end = start + 1;
        while end < slots.len() && slots[end] == slots[start] {
            end += 1;
        }
        if slots[start].lane() == Lane::Centre && end - start > 1 {
            leans[start] = Lean::Left;
            leans[end - 1] = Lean::Right;
        }
        start = end;
    }
    leans
}

fn index(lane: Lane) -> usize {
    match lane {
        Lane::Left => 0,
        Lane::Centre => 1,
        Lane::Right => 2,
    }
}

/// The left-hand twin of a right-sided slot, and whether it was mirrored.
fn left_twin(slot: PitchPosition) -> (PitchPosition, bool) {
    use PitchPosition as P;
    match slot {
        P::RightBack => (P::LeftBack, true),
        P::RightWingBack => (P::LeftWingBack, true),
        P::RightMidfielder => (P::LeftMidfielder, true),
        P::RightWinger => (P::LeftWinger, true),
        other => (other, false),
    }
}

/// A central slot's weight on a flank, by whether it leans that way.
fn leaning(lean: Lean, flank: Lane, towards: f64, centred: f64, away: f64) -> f64 {
    match (lean, flank) {
        (Lean::Centre, _) => centred,
        (Lean::Left, Lane::Left) | (Lean::Right, Lane::Right) => towards,
        _ => away,
    }
}

/// A central slot whose flank weights depend on its lean: [left, centre, right].
fn central(lean: Lean, middle: f64, towards: f64, centred: f64, away: f64) -> [f64; 3] {
    [
        leaning(lean, Lane::Left, towards, centred, away),
        middle,
        leaning(lean, Lane::Right, towards, centred, away),
    ]
}

/// The presence table (GĐ3-tech-spec §6.3 for the attacking third, §6.7 for
/// midfield), read in the side's own frame: [left, centre, right]. Right-sided
/// slots are the mirror of their left twin. Where the spec gives only "leaning
/// towards" and "leaning away", a slot that leans neither way (a lone striker,
/// a lone central midfielder) takes the mean of the two.
///
/// Calibrated at P3.2 against who takes players on in real final thirds
/// (StatsBomb 2015/16: forwards 45.6%, midfielders 37.8%, defenders 16.6%).
/// The spec's starting table gave full backs 26% and forwards 23% over the
/// nine formations; full backs (0.55 → 0.40), wing-backs (0.80 → 0.65) and
/// a striker's drift to a flank (0.15 / 0.05 → 0.30 / 0.10) moved it to
/// 21% and 28%. Forwards stay below the real share because most of the nine
/// formations play wide midfielders, not wingers.
pub(super) fn presence(slot: PitchPosition, lean: Lean, column: Column) -> [f64; 3] {
    use PitchPosition as P;
    let (twin, mirrored) = left_twin(slot);
    let weights = match column {
        Column::Attack => match twin {
            P::Goalkeeper => [0.0, 0.0, 0.0],
            P::CenterBack => [0.02, 0.05, 0.02],
            P::LeftBack => [0.40, 0.05, 0.0],
            P::LeftWingBack => [0.65, 0.05, 0.0],
            P::DefensiveMidfielder => [0.05, 0.15, 0.05],
            P::CentralMidfielder => central(lean, 0.45, 0.15, 0.10, 0.05),
            // Two attacking midfielders side by side (3-4-2-1) work the
            // half-spaces either side (wing-back-3-4-2-1.md §3.4); a lone
            // one stays central (P3.4).
            P::AttackingMidfielder => central(lean, 0.80, 0.35, 0.15, 0.05),
            P::LeftMidfielder => [0.80, 0.20, 0.0],
            P::LeftWinger => [0.95, 0.35, 0.02],
            P::Striker => central(lean, 1.00, 0.30, 0.20, 0.10),
            _ => unreachable_right(twin),
        },
        Column::Defence => match twin {
            P::Goalkeeper => [0.0, 0.0, 0.0],
            P::CenterBack => central(lean, 1.00, 0.45, 0.15, 0.05),
            P::LeftBack => [1.00, 0.15, 0.0],
            P::LeftWingBack => [0.95, 0.10, 0.0],
            P::DefensiveMidfielder => [0.20, 0.50, 0.20],
            P::CentralMidfielder => [0.15, 0.25, 0.15],
            P::AttackingMidfielder => [0.02, 0.05, 0.02],
            P::LeftMidfielder => [0.40, 0.05, 0.0],
            P::LeftWinger => [0.15, 0.0, 0.0],
            P::Striker => [0.0, 0.02, 0.0],
            _ => unreachable_right(twin),
        },
        Column::MidfieldAttack => match twin {
            P::DefensiveMidfielder => [0.25, 0.80, 0.25],
            P::CentralMidfielder => central(lean, 1.00, 0.45, 0.30, 0.15),
            P::AttackingMidfielder => [0.25, 1.00, 0.25],
            P::LeftMidfielder => [1.00, 0.30, 0.0],
            _ => [0.0, 0.0, 0.0],
        },
        Column::MidfieldDefence => match twin {
            P::DefensiveMidfielder => [0.35, 1.00, 0.35],
            P::CentralMidfielder => central(lean, 1.00, 0.40, 0.275, 0.15),
            P::AttackingMidfielder => [0.15, 0.60, 0.15],
            P::LeftMidfielder => [0.90, 0.20, 0.0],
            _ => [0.0, 0.0, 0.0],
        },
        // GĐ4-tech-spec §5.1, calibrated at P4.1 on who plays out of real
        // own thirds, keepers left out (`gd4-real-reference.txt`, item 7: CB
        // 46 · FB 22 · DM 16 · CM 6 · others 10%). The spec's table gave
        // CB 54 · FB 8 · CM 17%: the ball sits in the centre more in the
        // engine than in real football (kick-offs and goal kicks put it
        // there), so full backs came in from the middle too and central
        // midfielders, whom a real side does not drop that deep, came down.
        // This gives 50 · 17 · 16 · 9 · 8. The keeper never plays a short
        // build-up: real keepers' passing and first touch sit near 28 and
        // 19 (§3.5).
        Column::BuildUp => match twin {
            P::CenterBack => central(lean, 0.65, 0.50, 0.25, 0.10),
            P::LeftBack => [1.30, 0.40, 0.0],
            P::LeftWingBack => [1.15, 0.30, 0.0],
            P::DefensiveMidfielder => [0.30, 0.90, 0.30],
            P::CentralMidfielder => central(lean, 0.20, 0.20, 0.15, 0.05),
            P::AttackingMidfielder => [0.05, 0.10, 0.05],
            P::LeftMidfielder => [0.40, 0.0, 0.0],
            _ => [0.0, 0.0, 0.0],
        },
        // §5.2: the front of the side that presses, from its own view.
        Column::Press => match twin {
            P::Striker => central(lean, 1.00, 0.60, 0.45, 0.25),
            P::LeftWinger => [0.90, 0.30, 0.0],
            P::LeftMidfielder => [0.70, 0.20, 0.0],
            P::AttackingMidfielder => [0.30, 0.80, 0.30],
            P::CentralMidfielder => central(lean, 0.50, 0.35, 0.225, 0.10),
            P::DefensiveMidfielder => [0.05, 0.15, 0.05],
            P::LeftBack => [0.10, 0.0, 0.0],
            P::LeftWingBack => [0.20, 0.0, 0.0],
            _ => [0.0, 0.0, 0.0],
        },
    };
    if mirrored {
        [weights[2], weights[1], weights[0]]
    } else {
        weights
    }
}

/// `left_twin` never hands back a right-sided slot.
fn unreachable_right(_slot: PitchPosition) -> [f64; 3] {
    [0.0, 0.0, 0.0]
}

/// The role layer (GĐ3-tech-spec §6.3), attacking third only: a full back
/// who bombs on is there more on his flank, an inside forward drifts in, a
/// false nine drops off. `own` is the slot's flank, if it has one.
fn with_role(
    mut weights: [f64; 3],
    role: PlayerRole,
    own: Option<Lane>,
    column: Column,
) -> [f64; 3] {
    let centre = index(Lane::Centre);
    match column {
        Column::Attack => {
            if let Some(flank) = own {
                let flank = index(flank);
                match role {
                    PlayerRole::AttackingFB => weights[flank] *= 1.30,
                    PlayerRole::WingBack => weights[flank] *= 1.40,
                    PlayerRole::DefensiveFB => weights[flank] *= 0.60,
                    PlayerRole::InvertedFB => {
                        weights[flank] *= 0.50;
                        weights[centre] += 0.15;
                    }
                    PlayerRole::InsideForward | PlayerRole::InvertedWinger => {
                        weights[flank] *= 0.85;
                        weights[centre] += 0.35;
                    }
                    PlayerRole::WideForward => weights[flank] *= 1.10,
                    _ => {}
                }
            }
            match role {
                PlayerRole::False9 | PlayerRole::DeepLyingForward => weights[centre] *= 0.75,
                PlayerRole::ShadowStriker => weights[centre] *= 1.20,
                _ => {}
            }
        }
        Column::Defence => {
            if let Some(flank) = own {
                let flank = index(flank);
                match role {
                    PlayerRole::AttackingFB => weights[flank] *= 0.95,
                    PlayerRole::WingBack => weights[flank] *= 0.90,
                    PlayerRole::DefensiveFB => weights[flank] *= 1.05,
                    _ => {}
                }
            }
        }
        Column::MidfieldAttack | Column::MidfieldDefence | Column::BuildUp | Column::Press => {}
    }
    weights
}

/// A pick: who, and the slot he stands in.
pub(super) struct Picked {
    pub player: PlayerSnap,
    pub slot: PitchPosition,
}

impl LiveMatchState {
    /// Each outfielder of `side` still playing, with his slot, lean and
    /// weight in `column` (all three lanes). Empty when the XI does not fill
    /// the formation; midfield columns keep midfielders only.
    fn weighted_outfield(
        &self,
        side: Side,
        column: Column,
    ) -> Vec<(usize, PitchPosition, [f64; 3])> {
        let team = self.team_ref(side);
        let slots = formation_slots(&team.formation);
        if slots.len() != team.players.len() {
            return Vec::new();
        }
        let leans = slot_leans(&slots);
        let midfield_only = matches!(column, Column::MidfieldAttack | Column::MidfieldDefence);
        team.players
            .iter()
            .enumerate()
            .filter(|(i, player)| {
                slots[*i] != PitchPosition::Goalkeeper
                    && !self.out_of_play(&player.id)
                    && (!midfield_only || slots[*i].group() == Position::Midfielder)
            })
            .map(|(i, player)| {
                let own = Some(slots[i].lane()).filter(|lane| *lane != Lane::Centre);
                let weights = with_role(
                    presence(slots[i], leans[i], column),
                    player.role,
                    own,
                    column,
                );
                (i, slots[i], weights)
            })
            .collect()
    }

    /// Draw one of `side`'s outfielders for an action in `lane` (the side's
    /// own frame), each weighted by his presence there and his condition
    /// (`0.6 + 0.4·condition/100`, as `condition_adjusted_skill`). `None` when
    /// nobody has any presence there or the XI does not fill its formation;
    /// the caller then falls back on the old pick by group.
    pub(super) fn pick_by_presence<R: Rng>(
        &self,
        side: Side,
        column: Column,
        lane: Lane,
        rng: &mut R,
    ) -> Option<Picked> {
        self.pick_by_presence_without(side, column, lane, None, rng)
    }

    /// [`LiveMatchState::pick_by_presence`] with one player left out: a full
    /// back caught upfield is not there to defend his flank (P3.6).
    pub(super) fn pick_by_presence_without<R: Rng>(
        &self,
        side: Side,
        column: Column,
        lane: Lane,
        absent: Option<&str>,
        rng: &mut R,
    ) -> Option<Picked> {
        let weighted: Vec<(usize, PitchPosition, f64)> = self
            .weighted_outfield(side, column)
            .into_iter()
            .filter(|(i, _, _)| Some(self.team_ref(side).players[*i].id.as_str()) != absent)
            .map(|(i, slot, weights)| {
                let id = &self.team_ref(side).players[i].id;
                let condition = self.player_conditions.get(id).copied().unwrap_or(50.0);
                (
                    i,
                    slot,
                    weights[index(lane)] * (0.6 + 0.4 * condition / 100.0),
                )
            })
            .filter(|(_, _, w)| *w > 0.0)
            .collect();
        let total: f64 = weighted.iter().map(|(_, _, w)| w).sum();
        if total <= 0.0 {
            return None;
        }
        let mut roll = rng.random_range(0.0..total);
        let last = weighted.len() - 1;
        for (n, (i, slot, w)) in weighted.iter().enumerate() {
            if roll < *w || n == last {
                return Some(Picked {
                    player: PlayerSnap::from(&self.team_ref(side).players[*i]),
                    slot: *slot,
                });
            }
            roll -= w;
        }
        None
    }

    /// How hard `side` presses a build-up in `lane` (its own view; GĐ4-tech-spec
    /// §5.2, X65): the mean of `0.40·tackling + 0.35·stamina + 0.25·pace` over
    /// the players near the ball, each weighted by his presence there, his
    /// condition and his role's press (`PressingForward`), and worn down by his
    /// condition as any rating is. A press is the whole group closing in, so
    /// nobody is drawn. `None` when nobody of the side is there.
    pub(super) fn press_rating(&self, side: Side, lane: Lane) -> Option<f64> {
        let (mut sum, mut weight) = (0.0, 0.0);
        for (i, _, weights) in self.weighted_outfield(side, Column::Press) {
            let player = &self.team_ref(side).players[i];
            let condition = self
                .player_conditions
                .get(&player.id)
                .copied()
                .unwrap_or(50.0);
            let w = weights[index(lane)] * (0.6 + 0.4 * condition / 100.0);
            if w <= 0.0 {
                continue;
            }
            let rating = crate::duel::press_rating(&PlayerSnap::from(player))
                * crate::shared::role_attribute_modifier(
                    player.role,
                    crate::shared::PlayStylePhase::Press,
                );
            sum += w * self.condition_adjusted_skill(&player.id, rating);
            weight += w;
        }
        (weight > 0.0).then(|| sum / weight)
    }

    /// How much of `side`'s attack is on each lane: the sum of the attacking
    /// presence of everyone still playing (the lane matrix's cover, §7.2).
    pub(super) fn attacking_presence(&self, side: Side) -> [f64; 3] {
        self.weighted_outfield(side, Column::Attack)
            .into_iter()
            .fold([0.0; 3], |mut sum, (_, _, w)| {
                for lane in 0..3 {
                    sum[lane] += w[lane];
                }
                sum
            })
    }
}

/// κ for a defender picked at `lane` (the defence's own frame) from `slot`:
/// 0.82 when the lane is a flank his slot is not on, else 1.
pub(super) fn out_of_lane_factor(slot: PitchPosition, lane: Lane) -> f64 {
    if lane != Lane::Centre && slot.lane() != lane {
        KAPPA
    } else {
        1.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::types::MatchConfig;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    const FORMATIONS: [&str; 9] = [
        "4-4-2", "4-3-3", "3-5-2", "4-5-1", "4-2-3-1", "3-4-3", "5-3-2", "4-1-4-1", "3-4-2-1",
    ];
    const LANES: [Lane; 3] = [Lane::Left, Lane::Centre, Lane::Right];
    const COLUMNS: [Column; 4] = [
        Column::Attack,
        Column::Defence,
        Column::MidfieldAttack,
        Column::MidfieldDefence,
    ];

    fn state(home_formation: &str, away_formation: &str) -> LiveMatchState {
        let mut home = make_team("home");
        home.formation = home_formation.to_string();
        let mut away = make_team("away");
        away.formation = away_formation.to_string();
        LiveMatchState::new(
            home,
            away,
            MatchConfig::default(),
            Vec::new(),
            Vec::new(),
            false,
        )
    }

    /// How often each slot is picked in 20,000 draws.
    fn picks(
        s: &LiveMatchState,
        side: Side,
        column: Column,
        lane: Lane,
    ) -> Vec<(PitchPosition, u32)> {
        let mut rng = StdRng::seed_from_u64(9);
        let mut counts: Vec<(PitchPosition, u32)> = Vec::new();
        for _ in 0..20_000 {
            let picked = s
                .pick_by_presence(side, column, lane, &mut rng)
                .expect("a pick");
            match counts.iter_mut().find(|(slot, _)| *slot == picked.slot) {
                Some((_, n)) => *n += 1,
                None => counts.push((picked.slot, 1)),
            }
        }
        counts.sort_by_key(|c| std::cmp::Reverse(c.1));
        counts
    }

    /// Given every slot, lean and table,
    /// when a right-sided slot is read against its left twin,
    /// then it is the mirror image, and a lean flips with it.
    #[test]
    fn the_right_flank_mirrors_the_left() {
        use PitchPosition as P;
        let twins = [
            (P::LeftBack, P::RightBack),
            (P::LeftWingBack, P::RightWingBack),
            (P::LeftMidfielder, P::RightMidfielder),
            (P::LeftWinger, P::RightWinger),
        ];
        for column in COLUMNS {
            for (left, right) in twins {
                let l = presence(left, Lean::Centre, column);
                let r = presence(right, Lean::Centre, column);
                assert_eq!(l, [r[2], r[1], r[0]], "{left:?}/{right:?} {column:?}");
            }
            for slot in [P::CenterBack, P::CentralMidfielder, P::Striker] {
                let l = presence(slot, Lean::Left, column);
                let r = presence(slot, Lean::Right, column);
                assert_eq!(l, [r[2], r[1], r[0]], "{slot:?} {column:?}");
            }
        }
    }

    /// Given a 4-4-2's back four and a 3-5-2's back three,
    /// when their leans are read,
    /// then two centre backs lean left and right, three lean left, centre
    /// and right, and a lone striker leans neither way.
    #[test]
    fn central_slots_side_by_side_lean_apart() {
        use Lean::*;
        assert_eq!(
            slot_leans(&formation_slots("4-4-2"))[1..5],
            [Centre, Left, Right, Centre]
        );
        assert_eq!(
            slot_leans(&formation_slots("3-5-2"))[1..4],
            [Left, Centre, Right]
        );
        assert_eq!(slot_leans(&formation_slots("4-2-3-1"))[10], Centre);
    }

    /// Given each of the nine formations, each table and each lane,
    /// when the presence of everyone on the pitch is added up,
    /// then it is above zero: a side always has someone to pick.
    #[test]
    fn every_formation_has_someone_in_every_lane() {
        for formation in FORMATIONS {
            let s = state(formation, formation);
            for column in COLUMNS {
                let total = s.weighted_outfield(Side::Home, column).into_iter().fold(
                    [0.0; 3],
                    |mut sum, (_, _, w)| {
                        for lane in 0..3 {
                            sum[lane] += w[lane];
                        }
                        sum
                    },
                );
                for lane in LANES {
                    assert!(total[index(lane)] > 0.0, "{formation} {column:?} {lane:?}");
                }
            }
        }
    }

    /// Given a 4-4-2 attacking down its left against a 4-4-2,
    /// when the one-on-one's players are drawn,
    /// then the left midfielder carries it most often (the left back more
    /// than the central midfielders) and the defence's right back meets it
    /// most often: the duel real football sees.
    #[test]
    fn a_four_four_two_down_the_left_meets_the_right_back() {
        let s = state("4-4-2", "4-4-2");
        let attackers = picks(&s, Side::Home, Column::Attack, Lane::Left);
        assert_eq!(
            attackers[0].0,
            PitchPosition::LeftMidfielder,
            "{attackers:?}"
        );
        let count = |slot| {
            attackers
                .iter()
                .find(|(s, _)| *s == slot)
                .map_or(0, |(_, n)| *n)
        };
        assert!(
            count(PitchPosition::LeftBack) > count(PitchPosition::CentralMidfielder),
            "{attackers:?}"
        );
        let defenders = picks(&s, Side::Away, Column::Defence, Lane::Right);
        assert_eq!(defenders[0].0, PitchPosition::RightBack, "{defenders:?}");
    }

    /// Given a 3-5-2 defending its right flank,
    /// when its defender is drawn,
    /// then it is never a full back — it has none — and most picks stand
    /// outside the lane and play it at κ.
    #[test]
    fn a_back_three_covers_its_flank_out_of_lane() {
        let s = state("4-4-2", "3-5-2");
        let defenders = picks(&s, Side::Away, Column::Defence, Lane::Right);
        let total: u32 = defenders.iter().map(|(_, n)| n).sum();
        let at_kappa: u32 = defenders
            .iter()
            .filter(|(slot, _)| out_of_lane_factor(*slot, Lane::Right) < 1.0)
            .map(|(_, n)| n)
            .sum();
        assert_eq!(defenders[0].0, PitchPosition::CenterBack, "{defenders:?}");
        assert!(
            f64::from(at_kappa) / f64::from(total) > 0.6,
            "{defenders:?}"
        );
    }

    /// Given a 4-4-2 whose left midfielder has been sent off,
    /// when its attackers down the left are drawn,
    /// then he is never one of them.
    #[test]
    fn a_player_sent_off_is_never_picked() {
        let mut s = state("4-4-2", "4-4-2");
        let slots = formation_slots("4-4-2");
        let lm = slots
            .iter()
            .position(|slot| *slot == PitchPosition::LeftMidfielder)
            .expect("a left midfielder");
        let id = s.home.players[lm].id.clone();
        s.sent_off.insert(id);
        let attackers = picks(&s, Side::Home, Column::Attack, Lane::Left);
        assert!(
            attackers
                .iter()
                .all(|(slot, _)| *slot != PitchPosition::LeftMidfielder)
        );
    }

    /// Given a 4-4-2 with the ball down its left in midfield,
    /// when the midfield duel's players are drawn,
    /// then the left midfielder is picked most often and every pick is a
    /// midfielder.
    #[test]
    fn in_midfield_the_wide_man_on_the_ball_side_is_picked() {
        let s = state("4-4-2", "4-4-2");
        let attackers = picks(&s, Side::Home, Column::MidfieldAttack, Lane::Left);
        assert_eq!(
            attackers[0].0,
            PitchPosition::LeftMidfielder,
            "{attackers:?}"
        );
        assert!(
            attackers
                .iter()
                .all(|(slot, _)| slot.group() == Position::Midfielder)
        );
    }

    /// Given a defender picked on a flank from the slot there, from a centre
    /// back, and from anyone in the centre,
    /// when κ is read,
    /// then only the centre back on the flank pays it.
    #[test]
    fn kappa_is_paid_off_ones_own_lane_on_a_flank() {
        assert_eq!(
            out_of_lane_factor(PitchPosition::RightBack, Lane::Right),
            1.0
        );
        assert_eq!(
            out_of_lane_factor(PitchPosition::CenterBack, Lane::Right),
            KAPPA
        );
        assert_eq!(
            out_of_lane_factor(PitchPosition::RightBack, Lane::Centre),
            1.0
        );
    }

    /// Given a 4-4-2 playing out down its left,
    /// when the build-up's passer is drawn,
    /// then the left back plays it most often and the keeper never does
    /// (phase 2, P4.1, X65).
    #[test]
    fn a_build_up_down_the_left_starts_with_the_left_back() {
        let s = state("4-4-2", "4-4-2");
        let passers = picks(&s, Side::Home, Column::BuildUp, Lane::Left);
        assert_eq!(passers[0].0, PitchPosition::LeftBack, "{passers:?}");
        for lane in LANES {
            let passers = picks(&s, Side::Home, Column::BuildUp, lane);
            assert!(
                passers
                    .iter()
                    .all(|(slot, _)| *slot != PitchPosition::Goalkeeper),
                "{passers:?}"
            );
        }
    }

    /// Given a 4-4-2 pressing a build-up in the middle,
    /// when its strikers are made better pressers,
    /// then its press rating rises.
    #[test]
    fn the_press_is_read_off_the_front() {
        let mut s = state("4-4-2", "4-4-2");
        let before = s.press_rating(Side::Away, Lane::Centre).expect("a press");
        for player in &mut s.away.players[9..11] {
            player.tackling = 95;
            player.stamina = 95;
            player.pace = 95;
        }
        let after = s.press_rating(Side::Away, Lane::Centre).expect("a press");
        assert!(after > before + 5.0, "{before:.1} → {after:.1}");
    }

    /// Given a 4-4-2 pressing in the middle,
    /// when one striker is a `PressingForward`,
    /// then the press is harder than with him `Standard`.
    #[test]
    fn a_pressing_forward_presses_harder() {
        let mut s = state("4-4-2", "4-4-2");
        let standard = s.press_rating(Side::Away, Lane::Centre).expect("a press");
        s.away.players[9].role = PlayerRole::PressingForward;
        let pressing = s.press_rating(Side::Away, Lane::Centre).expect("a press");
        assert!(pressing > standard, "{standard:.2} → {pressing:.2}");
    }

    /// Given a 4-4-2 whose best presser is sent off,
    /// when it presses,
    /// then he no longer counts.
    #[test]
    fn a_player_sent_off_does_not_press() {
        let mut s = state("4-4-2", "4-4-2");
        let striker = s.away.players[9].id.clone();
        s.away.players[9].tackling = 99;
        s.away.players[9].stamina = 99;
        s.away.players[9].pace = 99;
        let with_him = s.press_rating(Side::Away, Lane::Centre).expect("a press");
        s.test_send_off(&striker);
        let without = s.press_rating(Side::Away, Lane::Centre).expect("a press");
        assert!(without < with_him, "{with_him:.2} → {without:.2}");
    }
}
