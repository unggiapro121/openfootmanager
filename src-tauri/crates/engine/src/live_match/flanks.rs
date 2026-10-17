//! Flanks left open, and the break into them (phase 2, GĐ3, P3.6;
//! GĐ3-tech-spec §10, S1 §4.3, decision X58).
//!
//! A full back who joins an attack down his flank leaves it behind him. The
//! flank stays open for two minutes: when he is the one carrying, crossing or
//! cutting inside, or, when someone else is, as often as his role sends him up
//! (`P_up`). If the other side wins the ball in that time, it goes into the
//! space `P_exploit` of the time: the next one-on-one is down that flank, the
//! full back is not there to meet it, whoever comes across plays out of lane
//! (κ), and the attacker has the space behind (`S_space`). Win it and he is
//! straight into the box.
//!
//! Nothing here adds a phase of play: it changes the lane and the defender
//! of one that was coming anyway.

use rand::{Rng, RngExt};

use crate::event::Lane;
use crate::pitch_position::{PitchPosition, formation_slots};
use crate::shared::PlayerSnap;
use crate::types::{BreakSpeed, PlayerRole, Side};

use super::LiveMatchState;

/// How often a side that wins the ball breaks into an open flank. The spec
/// started at 0.6 (0.8 breaking fast); at 0.6 a match saw 5 such breaks and
/// goals rose 0.19 on the guardrail sweep, against a budget of 0.05, and the
/// spec cuts this before the space (§10.3). Calibrated at P3.6 to 0.06 (0.08
/// fast); raised at P4.1, where a defence that wins the ball only goes
/// straight up the pitch `p_direct` of the time (X77), to keep about 0.56
/// such breaks a match (0.58 on the guardrail sweep).
const P_EXPLOIT: f64 = 0.10;
/// … when it breaks fast.
const P_EXPLOIT_FAST: f64 = 0.135;
/// The space behind a full back who went up: the attacker's effort is worth
/// this much more in the one-on-one that exploits it. Set so the attacker
/// wins about a quarter more often than down a flank that is covered
/// (GĐ3-tech-spec §10.3, target +20–30% relative): 72% against 57%. The spec
/// started at 1.45, which measured +15% once the defender left out and κ
/// were counted on real duels. Calibrated at P3.6.
pub(super) const S_SPACE: f64 = 2.0;
/// A half-back dropping between the centre backs sends the full backs up
/// this much more often (phase 2, P4.4, GĐ4-tech-spec §8.2).
const HALF_BACK_PUSH: f64 = 0.10;
/// A Carrilero on the flank a full back left covers it: a break goes into it
/// half as often (P4.4).
const CARRILERO_COVER: f64 = 0.5;
/// How long an open flank stays open: open while `now − minute ≤ this`.
const OPEN_FOR: u8 = 1;

/// How often a full back of `role` goes up when the attack down his flank is
/// someone else's (GĐ3-tech-spec §10.1); a wing-back more than a full back.
pub(super) fn push_up_chance(role: PlayerRole, wing_back: bool) -> f64 {
    let (full_back, wing) = match role {
        PlayerRole::DefensiveFB => (0.05, 0.15),
        PlayerRole::InvertedFB => (0.10, 0.20),
        PlayerRole::AttackingFB => (0.50, 0.60),
        PlayerRole::WingBack => (0.60, 0.70),
        _ => (0.25, 0.40),
    };
    if wing_back { wing } else { full_back }
}

fn side_index(side: Side) -> usize {
    match side {
        Side::Home => 0,
        Side::Away => 1,
    }
}

fn flank_index(lane: Lane) -> Option<usize> {
    match lane {
        Lane::Left => Some(0),
        Lane::Right => Some(1),
        Lane::Centre => None,
    }
}

/// A break waiting for its one-on-one: the side breaking, the side caught,
/// and the open flank as the side caught sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct PendingExploit {
    pub breaking: Side,
    pub flank: Lane,
    /// The full back who went up, left out of the defence.
    pub absent: String,
}

impl LiveMatchState {
    /// The full back of `side` on `flank` (its own view), still on the
    /// pitch, with whether he stands at wing-back.
    fn full_back_on(&self, side: Side, flank: Lane) -> Option<(&crate::types::PlayerData, bool)> {
        let team = self.team_ref(side);
        let slots = formation_slots(&team.formation);
        if slots.len() != team.players.len() {
            return None;
        }
        team.players
            .iter()
            .zip(slots)
            .find(|(player, slot)| {
                !self.out_of_play(&player.id)
                    && slot.lane() == flank
                    && matches!(
                        slot,
                        PitchPosition::LeftBack
                            | PitchPosition::RightBack
                            | PitchPosition::LeftWingBack
                            | PitchPosition::RightWingBack
                    )
            })
            .map(|(player, slot)| {
                let wing_back = matches!(
                    slot,
                    PitchPosition::LeftWingBack | PitchPosition::RightWingBack
                );
                (player, wing_back)
            })
    }

    /// `side` attacks down `lane` with `actor` on the ball: its full back on
    /// that flank leaves it open if he is the actor, or if his role sends him
    /// up. A side with no full back there has nothing to leave open.
    pub(super) fn note_full_back_push<R: Rng>(
        &mut self,
        side: Side,
        lane: Lane,
        actor_id: &str,
        rng: &mut R,
    ) {
        let Some(flank) = flank_index(lane) else {
            return;
        };
        let Some((full_back, wing_back)) = self.full_back_on(side, lane) else {
            return;
        };
        let half_back = if self.has_on_pitch(side, PlayerRole::HalfBack) {
            HALF_BACK_PUSH
        } else {
            0.0
        };
        let goes_up = full_back.id == actor_id
            || rng.random_range(0.0..1.0f64)
                < push_up_chance(full_back.role, wing_back) + half_back;
        if goes_up {
            self.flank_exposed[side_index(side)][flank] = Some(self.current_minute);
        }
    }

    /// The flank `side` has open now, as it sees it, if any (the more
    /// recently opened when both are).
    pub(super) fn open_flank(&self, side: Side) -> Option<Lane> {
        let open = |i: usize| {
            self.flank_exposed[side_index(side)][i]
                .filter(|minute| self.current_minute.saturating_sub(*minute) <= OPEN_FOR)
        };
        match (open(0), open(1)) {
            (Some(l), Some(r)) => Some(if r > l { Lane::Right } else { Lane::Left }),
            (Some(_), None) => Some(Lane::Left),
            (None, Some(_)) => Some(Lane::Right),
            (None, None) => None,
        }
    }

    /// Whether `side` has a player of `role` still on the pitch.
    fn has_on_pitch(&self, side: Side, role: PlayerRole) -> bool {
        self.team_ref(side)
            .players
            .iter()
            .any(|p| p.role == role && !self.out_of_play(&p.id))
    }

    /// Whether `side` has a Carrilero still playing on the side of `flank`
    /// (its own view): a central midfielder leaning that way, or the only
    /// one, who slides across behind the full back.
    fn carrilero_covers(&self, side: Side, flank: Lane) -> bool {
        let team = self.team_ref(side);
        let slots = formation_slots(&team.formation);
        if slots.len() != team.players.len() {
            return false;
        }
        let leans = super::presence::slot_leans(&slots);
        team.players
            .iter()
            .zip(slots.iter().zip(leans))
            .any(|(p, (slot, lean))| {
                p.role == PlayerRole::Carrilero
                    && *slot == PitchPosition::CentralMidfielder
                    && !self.out_of_play(&p.id)
                    && matches!(
                        (lean, flank),
                        (super::presence::Lean::Centre, _)
                            | (super::presence::Lean::Left, Lane::Left)
                            | (super::presence::Lean::Right, Lane::Right)
                    )
            })
    }

    /// `side` has the ball for an action: its full backs are back in place
    /// if it has just won it back (§10.1).
    pub(super) fn close_flanks_on_regain(&mut self, side: Side) {
        if self.last_on_the_ball != Some(side) {
            self.flank_exposed[side_index(side)] = [None, None];
        }
        self.last_on_the_ball = Some(side);
    }

    /// `side` has won the ball and it has gone to its attacking third (a
    /// clearance from its own third, or a break): into the open flank of the
    /// side that lost it `P_exploit` of the time, otherwise down the lane the
    /// matrix draws (`passer` playing it on, or a plain pass on a break).
    pub(super) fn regain_lane<R: Rng>(
        &mut self,
        side: Side,
        passer: Option<&PlayerSnap>,
        rng: &mut R,
    ) {
        let caught = side.opposite();
        if let Some(flank) = self.open_flank(caught) {
            let exploit = if self.team_ref(side).tactics.break_speed == BreakSpeed::Fast {
                P_EXPLOIT_FAST
            } else {
                P_EXPLOIT
            } * if self.carrilero_covers(caught, flank) {
                CARRILERO_COVER
            } else {
                1.0
            };
            if rng.random_range(0.0..1.0f64) < exploit
                && let Some((full_back, _)) = self.full_back_on(caught, flank)
            {
                let absent = full_back.id.clone();
                self.set_lane_for(caught, flank);
                self.pending_exploit = Some(PendingExploit {
                    breaking: side,
                    flank,
                    absent,
                });
                return;
            }
        }
        match passer {
            Some(passer) => self.advance_lane(side, passer, rng),
            None => self.advance_lane(side, &PlayerSnap::nobody(), rng),
        }
    }

    /// The break waiting for `side`'s one-on-one, if any; it is used up.
    pub(super) fn take_exploit(&mut self, side: Side) -> Option<PendingExploit> {
        match &self.pending_exploit {
            Some(p) if p.breaking == side => self.pending_exploit.take(),
            _ => {
                self.pending_exploit = None;
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::types::MatchConfig;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn state(home_formation: &str) -> LiveMatchState {
        let mut home = make_team("home");
        home.formation = home_formation.to_string();
        LiveMatchState::new(
            home,
            make_team("away"),
            MatchConfig::default(),
            Vec::new(),
            Vec::new(),
            false,
        )
    }

    fn left_back_id(s: &LiveMatchState) -> String {
        s.full_back_on(Side::Home, Lane::Left)
            .map(|(p, _)| p.id.clone())
            .expect("a left back")
    }

    /// Given a left back carrying the ball down his flank,
    /// when the push is noted,
    /// then the flank is open for two minutes and then closes.
    #[test]
    fn an_open_flank_closes_after_two_minutes() {
        let mut s = state("4-4-2");
        s.current_minute = 30;
        let id = left_back_id(&s);
        s.note_full_back_push(Side::Home, Lane::Left, &id, &mut StdRng::seed_from_u64(1));
        assert_eq!(s.open_flank(Side::Home), Some(Lane::Left));
        s.current_minute = 31;
        assert_eq!(s.open_flank(Side::Home), Some(Lane::Left));
        s.current_minute = 32;
        assert_eq!(s.open_flank(Side::Home), None);
    }

    /// Given a 3-5-2, which has no full back,
    /// when it attacks down either flank many times,
    /// then no flank is ever left open.
    #[test]
    fn a_back_three_never_leaves_a_flank_open() {
        let mut s = state("3-5-2");
        let mut rng = StdRng::seed_from_u64(2);
        for _ in 0..500 {
            s.note_full_back_push(Side::Home, Lane::Left, "someone", &mut rng);
            s.note_full_back_push(Side::Home, Lane::Right, "someone", &mut rng);
        }
        assert_eq!(s.open_flank(Side::Home), None);
    }

    /// Given an open home left flank and the away side winning the ball,
    /// when the lane is drawn many times,
    /// then a break goes down the away side's right — the mirror — about
    /// `P_exploit` of the time, with the left back left out.
    #[test]
    fn a_break_goes_into_the_mirror_of_the_open_flank() {
        let mut rng = StdRng::seed_from_u64(3);
        let mut exploits = 0;
        for _ in 0..4_000 {
            let mut s = state("4-4-2");
            s.current_minute = 50;
            let id = left_back_id(&s);
            s.note_full_back_push(Side::Home, Lane::Left, &id, &mut rng);
            s.regain_lane(Side::Away, None, &mut rng);
            if let Some(p) = s.take_exploit(Side::Away) {
                exploits += 1;
                assert_eq!(s.lane_for(Side::Away), Lane::Right);
                assert_eq!(p.absent, id);
            }
        }
        let share = f64::from(exploits) / 4_000.0;
        assert!((share - P_EXPLOIT).abs() < 0.03, "{share:.3}");
    }

    /// Given a full back's role,
    /// when his chance to go up is read,
    /// then a defensive full back goes least and a wing-back most, and the
    /// wing-back slot always more than the full-back slot.
    #[test]
    fn an_attacking_role_goes_up_more() {
        use PlayerRole::*;
        let order = [DefensiveFB, InvertedFB, Standard, AttackingFB, WingBack];
        for pair in order.windows(2) {
            assert!(push_up_chance(pair[0], false) < push_up_chance(pair[1], false));
        }
        for role in order {
            assert!(push_up_chance(role, true) > push_up_chance(role, false));
        }
    }

    /// Breaks into the home side's open left flank out of 6,000, with the
    /// home 4-4-2's two central midfielders playing `cm_roles`.
    fn breaks_into_left(cm_roles: [PlayerRole; 2]) -> u32 {
        let mut rng = StdRng::seed_from_u64(12);
        let mut breaks = 0;
        for _ in 0..6_000 {
            let mut s = state("4-4-2");
            s.home.players[6].role = cm_roles[0];
            s.home.players[7].role = cm_roles[1];
            s.current_minute = 50;
            let id = left_back_id(&s);
            s.note_full_back_push(Side::Home, Lane::Left, &id, &mut rng);
            s.regain_lane(Side::Away, None, &mut rng);
            if s.take_exploit(Side::Away).is_some() {
                breaks += 1;
            }
        }
        breaks
    }

    /// Given a 4-4-2 whose left back has gone up,
    /// when its left-sided central midfielder is a Carrilero,
    /// then the other side breaks into that flank about half as often
    /// (phase 2, P4.4).
    #[test]
    fn a_carrilero_covers_the_flank_behind_him() {
        let covered = breaks_into_left([PlayerRole::Carrilero, PlayerRole::Standard]);
        let open = breaks_into_left([PlayerRole::Standard, PlayerRole::Standard]);
        assert!(
            f64::from(covered) < 0.7 * f64::from(open),
            "{covered} vs {open}"
        );
    }

    /// Given a 4-3-3 whose defensive midfielder is a half-back,
    /// when the attack goes down the left without its left back many times,
    /// then the left back goes up more often than beside a standard one.
    #[test]
    fn a_half_back_sends_the_full_backs_up() {
        let pushes = |role: PlayerRole| {
            let mut rng = StdRng::seed_from_u64(13);
            (0..6_000)
                .filter(|_| {
                    let mut s = state("4-3-3");
                    s.home.players[5].role = role;
                    s.current_minute = 30;
                    s.note_full_back_push(Side::Home, Lane::Left, "someone", &mut rng);
                    s.open_flank(Side::Home).is_some()
                })
                .count()
        };
        assert!(pushes(PlayerRole::HalfBack) > pushes(PlayerRole::Standard) + 300);
    }
}
