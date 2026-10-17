//! Who finishes in the box (phase 2, GĐ3, P3.5; GĐ3-tech-spec §8, decisions
//! D8, X57).
//!
//! Before GĐ3 every shot in the box went to a forward drawn at random and
//! every cross to a forward other than the crosser. Here each outfielder is weighted
//! by ω — how much his slot and role get on the end of things in the box —
//! times his positioning (for a shot) or his aerial rating (for a cross), and
//! the man who has just carried the ball in counts double. A cross is
//! contested by a centre back.

use rand::{Rng, RngExt};

use crate::duel;
use crate::pitch_position::{PitchPosition, formation_slots};
use crate::shared::PlayerSnap;
use crate::types::{PlayerData, PlayerRole, Position, Side};

use super::LiveMatchState;

/// How much more likely the player who has just carried the ball into the box
/// is to be the one who shoots (`LastActor`, X57).
pub(super) const LAST_ACTOR_WEIGHT: f64 = 2.0;

/// ω, a slot's share of the finishing (GĐ3-tech-spec §8.2, S1 §3.2A): a
/// role in the table replaces the slot's default.
pub fn shot_weight(slot: PitchPosition, role: PlayerRole) -> f64 {
    use PitchPosition as P;
    let by_role = match role {
        PlayerRole::Poacher => Some(3.5),
        PlayerRole::CompleteForward | PlayerRole::TargetMan => Some(2.5),
        PlayerRole::ShadowStriker | PlayerRole::PressingForward => Some(2.0),
        PlayerRole::DeepLyingForward => Some(1.6),
        PlayerRole::InsideForward | PlayerRole::False9 => Some(1.5),
        PlayerRole::WideForward | PlayerRole::InvertedWinger | PlayerRole::AdvancedPlaymaker => {
            Some(1.2)
        }
        PlayerRole::BoxToBox => Some(0.8),
        _ => None,
    };
    by_role.unwrap_or(match slot {
        P::Goalkeeper => 0.0,
        P::Striker => 2.0,
        P::LeftWinger
        | P::RightWinger
        | P::LeftMidfielder
        | P::RightMidfielder
        | P::AttackingMidfielder => 1.0,
        _ => 0.05,
    })
}

/// One weighted draw over `candidates`; `None` when every weight is zero.
fn draw<'a, R: Rng>(candidates: &[(&'a PlayerData, f64)], rng: &mut R) -> Option<&'a PlayerData> {
    let total: f64 = candidates.iter().map(|(_, w)| w).sum();
    if total <= 0.0 {
        return None;
    }
    let mut roll = rng.random_range(0.0..total);
    for (player, weight) in candidates {
        if roll < *weight {
            return Some(player);
        }
        roll -= weight;
    }
    candidates.last().map(|(player, _)| *player)
}

impl LiveMatchState {
    /// `side`'s outfielders still playing, each with his slot. Empty when the
    /// XI does not fill its formation.
    fn outfield_by_slot(&self, side: Side) -> Vec<(&PlayerData, PitchPosition)> {
        let team = self.team_ref(side);
        let slots = formation_slots(&team.formation);
        if slots.len() != team.players.len() {
            return Vec::new();
        }
        team.players
            .iter()
            .zip(slots)
            .filter(|(player, slot)| {
                *slot != PitchPosition::Goalkeeper && !self.out_of_play(&player.id)
            })
            .collect()
    }

    /// Whether `id` of `side` carried the ball into the box: the last actor,
    /// if he is on that side.
    fn carried_it_in(&self, side: Side, id: &str) -> bool {
        matches!(&self.last_actor, Some((s, last)) if *s == side && last == id)
    }

    /// Who shoots in the box: `P ∝ ω × positioning / 70 × LastActor`.
    fn pick_shooter<R: Rng>(&self, side: Side, rng: &mut R) -> Option<PlayerSnap> {
        let candidates: Vec<(&PlayerData, f64)> = self
            .outfield_by_slot(side)
            .into_iter()
            .map(|(player, slot)| {
                let carried = if self.carried_it_in(side, &player.id) {
                    LAST_ACTOR_WEIGHT
                } else {
                    1.0
                };
                let weight = shot_weight(slot, player.role)
                    * (f64::from(player.positioning) / 70.0)
                    * carried;
                (player, weight)
            })
            .collect();
        draw(&candidates, rng).map(PlayerSnap::from)
    }

    /// The shot in the box, and who set it up: the shooter by ω, and the
    /// assist to whoever carried the ball in if that was someone else.
    pub(super) fn box_shooter_and_assister<R: Rng>(
        &self,
        side: Side,
        rng: &mut R,
    ) -> (PlayerSnap, String) {
        let shooter = self
            .pick_shooter(side, rng)
            .unwrap_or_else(|| self.snap_player(side, Position::Forward, rng));
        let assister = match &self.last_actor {
            Some((s, id)) if *s == side && *id != shooter.id && !self.out_of_play(id) => id.clone(),
            _ => self.snap_player(side, Position::Midfielder, rng).id,
        };
        (shooter, assister)
    }

    /// Who meets a cross from `crosser_id`: anyone but the crosser,
    /// `P ∝ ω × aerial / 70`.
    pub(super) fn cross_target<R: Rng>(
        &self,
        side: Side,
        crosser_id: &str,
        rng: &mut R,
    ) -> PlayerSnap {
        let candidates: Vec<(&PlayerData, f64)> = self
            .outfield_by_slot(side)
            .into_iter()
            .filter(|(player, _)| player.id != crosser_id)
            .map(|(player, slot)| {
                let aerial = duel::aerial_rating(&PlayerSnap::from(player)) / 70.0;
                (player, shot_weight(slot, player.role) * aerial)
            })
            .collect();
        draw(&candidates, rng)
            .map(PlayerSnap::from)
            .unwrap_or_else(|| self.snap_header_target(side, crosser_id, rng))
    }

    /// Who meets a low cross from `crosser_id` (P3.4): anyone but the
    /// crosser, `P ∝ ω × positioning / 70`, first to the ball along the
    /// ground. Falls back on the high cross's pick.
    pub(super) fn low_cross_target<R: Rng>(
        &self,
        side: Side,
        crosser_id: &str,
        rng: &mut R,
    ) -> PlayerSnap {
        let candidates: Vec<(&PlayerData, f64)> = self
            .outfield_by_slot(side)
            .into_iter()
            .filter(|(player, _)| player.id != crosser_id)
            .map(|(player, slot)| {
                let weight = shot_weight(slot, player.role) * f64::from(player.positioning) / 70.0;
                (player, weight)
            })
            .collect();
        draw(&candidates, rng)
            .map(PlayerSnap::from)
            .unwrap_or_else(|| self.cross_target(side, crosser_id, rng))
    }

    /// Who contests a cross for the defence: a centre back — a ball into the
    /// middle of the box is his — or any defender when the side has no
    /// centre-back slot.
    pub(super) fn cross_defender<R: Rng>(&self, side: Side, rng: &mut R) -> PlayerSnap {
        let centre_backs: Vec<(&PlayerData, f64)> = self
            .outfield_by_slot(side)
            .into_iter()
            .filter(|(_, slot)| *slot == PitchPosition::CenterBack)
            .map(|(player, _)| (player, 1.0))
            .collect();
        draw(&centre_backs, rng)
            .map(PlayerSnap::from)
            .unwrap_or_else(|| self.snap_player(side, Position::Defender, rng))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::types::MatchConfig;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn state(formation: &str) -> LiveMatchState {
        let mut home = make_team("home");
        home.formation = formation.to_string();
        LiveMatchState::new(
            home,
            make_team("away"),
            MatchConfig::default(),
            Vec::new(),
            Vec::new(),
            false,
        )
    }

    fn slot_index(s: &LiveMatchState, slot: PitchPosition) -> usize {
        formation_slots(&s.home.formation)
            .iter()
            .position(|p| *p == slot)
            .expect("the slot")
    }

    /// How often `id` shoots in 20,000 draws.
    fn shots_by(s: &LiveMatchState, id: &str) -> u32 {
        let mut rng = StdRng::seed_from_u64(5);
        (0..20_000)
            .filter(|_| s.pick_shooter(Side::Home, &mut rng).expect("a shooter").id == id)
            .count() as u32
    }

    /// Given two strikers alike in every way, one a poacher,
    /// when the shooter is drawn many times,
    /// then the poacher shoots more often.
    #[test]
    fn a_poacher_shoots_more_than_a_standard_striker() {
        let mut s = state("4-4-2");
        let first = slot_index(&s, PitchPosition::Striker);
        s.home.players[first].role = PlayerRole::Poacher;
        let poacher = s.home.players[first].id.clone();
        let other = s.home.players[first + 1].id.clone();
        assert!(shots_by(&s, &poacher) > shots_by(&s, &other) * 3 / 2);
    }

    /// Given a 4-4-2,
    /// when the shooter is drawn many times,
    /// then the keeper never shoots.
    #[test]
    fn the_keeper_never_shoots() {
        let s = state("4-4-2");
        let keeper = s.home.players[0].id.clone();
        assert_eq!(shots_by(&s, &keeper), 0);
    }

    /// Given a left midfielder who has just carried the ball into the box,
    /// when the shooter is drawn,
    /// then he shoots about twice as often as the other wide midfielder.
    #[test]
    fn the_man_who_carried_it_in_shoots_more() {
        let mut s = state("4-4-2");
        let left = s.home.players[slot_index(&s, PitchPosition::LeftMidfielder)]
            .id
            .clone();
        let right = s.home.players[slot_index(&s, PitchPosition::RightMidfielder)]
            .id
            .clone();
        s.last_actor = Some((Side::Home, left.clone()));
        let ratio = f64::from(shots_by(&s, &left)) / f64::from(shots_by(&s, &right));
        assert!((ratio - LAST_ACTOR_WEIGHT).abs() < 0.2, "{ratio:.2}");
    }

    /// Given an away player as the last actor,
    /// when the home side's shooter is drawn,
    /// then nobody at home gets his weight.
    #[test]
    fn the_other_sides_last_actor_lifts_nobody() {
        let mut s = state("4-4-2");
        let left = s.home.players[slot_index(&s, PitchPosition::LeftMidfielder)]
            .id
            .clone();
        let right = s.home.players[slot_index(&s, PitchPosition::RightMidfielder)]
            .id
            .clone();
        s.last_actor = Some((Side::Away, left.clone()));
        let ratio = f64::from(shots_by(&s, &left)) / f64::from(shots_by(&s, &right));
        assert!((ratio - 1.0).abs() < 0.15, "{ratio:.2}");
    }

    /// Given a striker crossing,
    /// when the man who meets it is drawn many times,
    /// then it is never the crosser himself.
    #[test]
    fn the_crosser_never_meets_his_own_cross() {
        let s = state("4-2-3-1");
        let crosser = s.home.players[slot_index(&s, PitchPosition::Striker)]
            .id
            .clone();
        let mut rng = StdRng::seed_from_u64(6);
        for _ in 0..5_000 {
            assert_ne!(s.cross_target(Side::Home, &crosser, &mut rng).id, crosser);
        }
    }

    /// Given a 4-4-2 defending a cross,
    /// when its man in the air is drawn many times,
    /// then he is always one of its centre backs.
    #[test]
    fn a_centre_back_contests_the_cross() {
        let s = state("4-4-2");
        let slots = formation_slots("4-4-2");
        let mut rng = StdRng::seed_from_u64(7);
        for _ in 0..2_000 {
            let id = s.cross_defender(Side::Home, &mut rng).id;
            let index = s
                .home
                .players
                .iter()
                .position(|p| p.id == id)
                .expect("a home player");
            assert_eq!(slots[index], PitchPosition::CenterBack);
        }
    }

    /// Given ω's table,
    /// when slots and roles are read,
    /// then a striker outweighs a wide midfielder, who outweighs a defender,
    /// and a role in the table replaces the slot's default.
    #[test]
    fn omega_ranks_the_box_finishers() {
        use PitchPosition as P;
        assert_eq!(shot_weight(P::Goalkeeper, PlayerRole::Standard), 0.0);
        assert!(
            shot_weight(P::Striker, PlayerRole::Standard)
                > shot_weight(P::LeftMidfielder, PlayerRole::Standard)
        );
        assert!(
            shot_weight(P::LeftMidfielder, PlayerRole::Standard)
                > shot_weight(P::CenterBack, PlayerRole::Standard)
        );
        assert_eq!(shot_weight(P::Striker, PlayerRole::Poacher), 3.5);
        assert_eq!(shot_weight(P::CentralMidfielder, PlayerRole::BoxToBox), 0.8);
    }
}
