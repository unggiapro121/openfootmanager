//! Where the ball is across the pitch: its lane (phase 2, GĐ3, P3.1).
//!
//! The lane is stored from the home side's attacking direction, like `Zone`,
//! and read for a side through [`LiveMatchState::lane_for`]: the left wing of
//! the side attacking one way is the right wing of the side attacking the
//! other. Possession changing hands therefore leaves the stored lane alone —
//! the ball has not moved — and none of the many places that hand the ball
//! over has to remember to flip it (GĐ3-tech-spec §5, decision X46).
//!
//! Every rule here runs only under `EngineModel::Grid15` and draws nothing
//! from the match's random stream, so `Zones5` plays exactly as before.

use crate::event::{EventType, Lane, MatchEvent};
use crate::types::{EngineModel, Side};

use super::LiveMatchState;

/// The event protocol a `Grid15` match writes: an event's `lane` is the lane
/// of the ball as `event.side` sees it, where protocol 2 put the lane of the
/// actor's slot (decision X59).
pub const GRID_EVENT_PROTOCOL_VERSION: u8 = 3;

/// The ball's lane from the home side's attacking direction. The field is
/// private to this module, so nothing can read it without saying whose
/// direction it reads it from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct BallSide(Lane);

impl BallSide {
    /// Down the middle: kick-off, goal kicks, penalties.
    pub(super) fn centre() -> Self {
        Self(Lane::Centre)
    }
}

impl Lane {
    /// The same strip of grass, seen by the side attacking the other way.
    pub fn mirrored(self) -> Lane {
        match self {
            Lane::Left => Lane::Right,
            Lane::Right => Lane::Left,
            Lane::Centre => Lane::Centre,
        }
    }
}

impl LiveMatchState {
    pub(super) fn plays_grid15(&self) -> bool {
        self.config.engine_model == EngineModel::Grid15
    }

    /// The ball's lane seen from `side`'s attacking direction.
    pub(super) fn lane_for(&self, side: Side) -> Lane {
        match side {
            Side::Home => self.ball_side.0,
            Side::Away => self.ball_side.0.mirrored(),
        }
    }

    /// Put the ball in `lane` as `side` sees it.
    pub(super) fn set_lane_for(&mut self, side: Side, lane: Lane) {
        self.ball_side = BallSide(match side {
            Side::Home => lane,
            Side::Away => lane.mirrored(),
        });
    }

    /// Back to the centre spot: a kick-off.
    pub(super) fn centre_the_ball(&mut self) {
        self.ball_side = BallSide::centre();
    }

    /// The `Grid15` bookkeeping `emit` does for each event: move the ball's
    /// lane as the event moves it, tag the event with the lane as its side
    /// sees it, and remember who acted.
    ///
    /// Where the ball goes when a side moves it up a zone is the lane matrix's
    /// (`lanes`, P3.3), drawn where the move is resolved. Here: a corner is
    /// taken from the flank the ball was on, or, when it went out from the
    /// centre, the left on even minutes and the right on odd ones; a cross
    /// puts the ball in the box, which is one cell, so in the centre.
    pub(super) fn track_lane(&mut self, event: &mut MatchEvent) {
        match event.event_type {
            EventType::Corner if self.lane_for(event.side) == Lane::Centre => {
                let flank = if event.minute.is_multiple_of(2) {
                    Lane::Left
                } else {
                    Lane::Right
                };
                self.set_lane_for(event.side, flank);
            }
            EventType::GoalKick | EventType::PenaltyAwarded => self.centre_the_ball(),
            _ => {}
        }
        event.lane = Some(self.lane_for(event.side));
        // The ball enters the box from the lane it is in: after a one-on-one
        // won in the attacking third, or from a cross.
        if matches!(event.event_type, EventType::Dribble | EventType::Cross)
            && event.zone == crate::types::Zone::attacking_third(event.side)
        {
            self.entry_lane = Some(self.lane_for(event.side));
        }
        if let Some(id) = &event.player_id {
            self.last_actor = Some((event.side, id.clone()));
        }
        if event.is_goal() || event.event_type == EventType::Cross {
            self.centre_the_ball();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::types::{MatchConfig, Zone};

    fn state() -> LiveMatchState {
        LiveMatchState::new(
            make_team("home"),
            make_team("away"),
            MatchConfig {
                engine_model: EngineModel::Grid15,
                ..MatchConfig::default()
            },
            Vec::new(),
            Vec::new(),
            false,
        )
    }

    /// Given the ball in each lane as the home side sees it,
    /// when the away side reads it,
    /// then it reads the mirror: the home left is the away right.
    #[test]
    fn the_two_sides_read_the_lane_as_mirror_images() {
        let mut s = state();
        for lane in [Lane::Left, Lane::Centre, Lane::Right] {
            s.set_lane_for(Side::Home, lane);
            assert_eq!(s.lane_for(Side::Home), lane);
            assert_eq!(s.lane_for(Side::Away), lane.mirrored());
            s.set_lane_for(Side::Away, lane);
            assert_eq!(s.lane_for(Side::Away), lane);
            assert_eq!(s.lane_for(Side::Home), lane.mirrored());
        }
    }

    /// Given the ball down the home left,
    /// when possession changes hands,
    /// then the ball has not moved: the away side has it down its right.
    #[test]
    fn a_change_of_possession_leaves_the_ball_where_it_is() {
        let mut s = state();
        s.set_lane_for(Side::Home, Lane::Left);
        s.possession = Side::Away;
        assert_eq!(s.lane_for(Side::Home), Lane::Left);
        assert_eq!(s.lane_for(Side::Away), Lane::Right);
    }

    /// Given the ball down the home side's left,
    /// when a home pass and an away tackle there are tracked,
    /// then the pass carries the left and the tackle the right — the same
    /// grass, seen from the other end.
    #[test]
    fn the_defending_sides_event_carries_the_mirrored_lane() {
        let mut s = state();
        s.set_lane_for(Side::Home, Lane::Left);
        let mut pass = MatchEvent::new(5, EventType::PassCompleted, Side::Home, Zone::Midfield);
        s.track_lane(&mut pass);
        let mut tackle = MatchEvent::new(5, EventType::Tackle, Side::Away, Zone::Midfield);
        s.track_lane(&mut tackle);
        assert_eq!(pass.lane, Some(Lane::Left));
        assert_eq!(tackle.lane, Some(Lane::Right));
    }

    /// Given the ball down a flank in the attacking third,
    /// when a cross is tracked,
    /// then the cross carries the flank, the box is entered from it, and the
    /// ball is in the centre of the box afterwards.
    #[test]
    fn a_cross_comes_from_the_flank_and_lands_in_the_centre() {
        let mut s = state();
        s.set_lane_for(Side::Home, Lane::Right);
        let mut cross = MatchEvent::new(20, EventType::Cross, Side::Home, Zone::AwayDefense);
        s.track_lane(&mut cross);
        assert_eq!(cross.lane, Some(Lane::Right));
        assert_eq!(s.entry_lane, Some(Lane::Right));
        assert_eq!(s.lane_for(Side::Home), Lane::Centre);
    }

    /// Given the ball down a flank,
    /// when a goal kick, a penalty or a goal follows,
    /// then the ball is back in the centre.
    #[test]
    fn a_goal_kick_a_penalty_and_a_goal_bring_the_ball_back_to_the_centre() {
        for event_type in [
            EventType::GoalKick,
            EventType::PenaltyAwarded,
            EventType::Goal,
        ] {
            let mut s = state();
            s.set_lane_for(Side::Home, Lane::Right);
            let mut e = MatchEvent::new(30, event_type.clone(), Side::Home, Zone::AwayBox);
            s.track_lane(&mut e);
            assert_eq!(s.lane_for(Side::Home), Lane::Centre, "{event_type:?}");
        }
    }

    /// Given a corner won with the ball in the centre, and one won on a flank,
    /// when each is tracked,
    /// then the first is taken from a flank and the second from its own.
    #[test]
    fn a_corner_is_taken_from_a_flank() {
        let mut s = state();
        let mut corner = MatchEvent::new(11, EventType::Corner, Side::Away, Zone::HomeDefense);
        s.track_lane(&mut corner);
        assert_ne!(corner.lane, Some(Lane::Centre));
        s.set_lane_for(Side::Away, Lane::Left);
        let mut corner = MatchEvent::new(12, EventType::Corner, Side::Away, Zone::HomeDefense);
        s.track_lane(&mut corner);
        assert_eq!(corner.lane, Some(Lane::Left));
    }

    /// Given an away player acting,
    /// when the event is tracked,
    /// then the last actor is remembered with his side, so a home read can
    /// tell it is not one of its own.
    #[test]
    fn the_last_actor_is_remembered_with_his_side() {
        let mut s = state();
        let id = s.away.players[9].id.clone();
        let mut e = MatchEvent::new(40, EventType::PassCompleted, Side::Away, Zone::Midfield)
            .with_player(&id);
        s.track_lane(&mut e);
        assert_eq!(s.last_actor, Some((Side::Away, id)));
    }
}
