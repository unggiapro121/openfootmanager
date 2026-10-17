//! Counts read off a match's events that no report field carries: who won the
//! aerial duels after crosses, where the fouls were, and — for phase 2, GĐ3 —
//! which lane the play in the final third ran down and who shot in the box.
//!
//! sim-bench and the real-world probe both measure these, so the rule for
//! reading them lives here, once, next to the events it reads.

use crate::event::{EventType, Lane, MatchEvent, ShotKind, TacticalContext};
use crate::pitch_position::formation_slots;
use crate::report::{MatchReport, TeamSheet};
use crate::types::{Position, Zone};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct EventTally {
    /// Aerial duels after a cross the attacking side won, and lost.
    pub aerial_won: u64,
    pub aerial_lost: u64,
    /// Goals scored from the shot a won aerial duel set up.
    pub cross_goals: u64,
    /// Fouls in the fouled side's attacking third, outside the box: where a
    /// direct free kick can come from.
    pub fouls_final_third: u64,
    pub fouls_in_box: u64,
    /// One-on-ones in the attacking third (`Dribble` won, `DribbleTackled`
    /// lost) by the lane their event carries: left, centre, right. Protocol 2
    /// puts the lane of the attacker's slot there, protocol 3 the ball's
    /// (phase 2, GĐ3, X59). A one-on-one lost to a clearance has no attacker
    /// event and is not counted.
    pub final_third_lanes: [u64; 3],
    /// Crosses by the lane their event carries: left, centre, right.
    pub crosses_by_lane: [u64; 3],
    /// Crosses in open play (not from a corner or free kick), the number real
    /// football's 22 a match counts (phase 2, P3.4).
    pub open_play_crosses: u64,
    /// Open-play crosses along the ground, and crosses that never reached
    /// the contest (P3.4): neither is an aerial duel.
    pub low_crosses: u64,
    pub unreached_crosses: u64,
    /// One-on-ones down a flank in the attacking third, won and lost: the
    /// ordinary ones, and those into a flank a full back left open
    /// (`FlankExposed`, P3.6), with the goals the latter led to before the
    /// other side touched the ball.
    pub flank_won: u64,
    pub flank_lost: u64,
    pub exploit_won: u64,
    pub exploit_lost: u64,
    pub exploit_goals: u64,
    /// Shots in the box with the feet or the head, by the group of the slot
    /// the shooter kicked off in: DEF, MID, FWD, and a fourth for players who
    /// came off the bench. Only [`EventTally::of_report`] fills it.
    pub box_shots_by_group: [u64; 4],
    /// One-on-ones in the attacking third by the group of the slot the
    /// attacker kicked off in: DEF, MID, FWD, substitutes. Only
    /// [`EventTally::of_report`] fills it.
    pub final_third_by_group: [u64; 4],
}

fn lane_index(lane: Lane) -> usize {
    match lane {
        Lane::Left => 0,
        Lane::Centre => 1,
        Lane::Right => 2,
    }
}

impl EventTally {
    /// The tally of one match's events, in the order they happened.
    pub fn of(events: &[MatchEvent]) -> Self {
        let mut tally = Self::default();
        // The side whose break into an open flank is still going.
        let mut exploiting: Option<crate::types::Side> = None;
        for (index, event) in events.iter().enumerate() {
            let previous = index.checked_sub(1).map(|i| &events[i]);
            tally.add_flank_duel(event, previous, &mut exploiting);
            match event.event_type {
                EventType::Cross => {
                    if event.set_piece.is_none() {
                        tally.open_play_crosses += 1;
                    }
                    tally.add_cross(event, &events[index + 1..]);
                    if let Some(lane) = event.lane {
                        tally.crosses_by_lane[lane_index(lane)] += 1;
                    }
                }
                EventType::Foul => tally.add_foul(event),
                EventType::Dribble | EventType::DribbleTackled
                    if event.zone == Zone::attacking_third(event.side) =>
                {
                    if let Some(lane) = event.lane {
                        tally.final_third_lanes[lane_index(lane)] += 1;
                    }
                }
                _ => {}
            }
        }
        tally
    }

    /// [`EventTally::of`] the report's events, plus the box shots by the
    /// group of the slot each shooter kicked off in, read off the team sheets.
    /// A report without sheets (the instant path) counts no box shots.
    pub fn of_report(report: &MatchReport) -> Self {
        let mut tally = Self::of(&report.events);
        let (Some(home), Some(away)) = (&report.home_sheet, &report.away_sheet) else {
            return tally;
        };
        let group_of = |id: &str| -> usize {
            for sheet in [home, away] {
                if let Some(group) = starting_group(sheet, id) {
                    return match group {
                        Position::Defender | Position::Goalkeeper => 0,
                        Position::Midfielder => 1,
                        Position::Forward => 2,
                    };
                }
            }
            3
        };
        for event in &report.events {
            let is_shot = matches!(
                event.event_type,
                EventType::Goal
                    | EventType::ShotSaved
                    | EventType::ShotOffTarget
                    | EventType::ShotBlocked
            );
            let in_box = matches!(event.shot_kind, Some(ShotKind::Open | ShotKind::Header));
            if let (true, true, Some(id)) = (is_shot, in_box, event.player_id.as_deref()) {
                tally.box_shots_by_group[group_of(id)] += 1;
            }
            let one_v_one = matches!(
                event.event_type,
                EventType::Dribble | EventType::DribbleTackled
            ) && event.zone == Zone::attacking_third(event.side);
            if let (true, Some(id)) = (one_v_one, event.player_id.as_deref()) {
                tally.final_third_by_group[group_of(id)] += 1;
            }
        }
        tally
    }

    pub fn add(&mut self, other: &Self) {
        self.aerial_won += other.aerial_won;
        self.aerial_lost += other.aerial_lost;
        self.cross_goals += other.cross_goals;
        self.fouls_final_third += other.fouls_final_third;
        self.fouls_in_box += other.fouls_in_box;
        self.open_play_crosses += other.open_play_crosses;
        self.low_crosses += other.low_crosses;
        self.unreached_crosses += other.unreached_crosses;
        self.flank_won += other.flank_won;
        self.flank_lost += other.flank_lost;
        self.exploit_won += other.exploit_won;
        self.exploit_lost += other.exploit_lost;
        self.exploit_goals += other.exploit_goals;
        for i in 0..3 {
            self.final_third_lanes[i] += other.final_third_lanes[i];
            self.crosses_by_lane[i] += other.crosses_by_lane[i];
        }
        for i in 0..4 {
            self.box_shots_by_group[i] += other.box_shots_by_group[i];
            self.final_third_by_group[i] += other.final_third_by_group[i];
        }
    }

    /// Share of the attacking third's one-on-ones down the centre, in percent.
    pub fn centre_lane_pct(&self) -> f64 {
        let total: u64 = self.final_third_lanes.iter().sum();
        if total == 0 {
            return 0.0;
        }
        self.final_third_lanes[1] as f64 / total as f64 * 100.0
    }

    /// Shares of box shots by DEF, MID, FWD and substitutes, in percent.
    pub fn box_shot_group_pct(&self) -> [f64; 4] {
        shares(self.box_shots_by_group)
    }

    /// Shares of the attacking third's one-on-ones by DEF, MID, FWD and
    /// substitutes, in percent.
    pub fn final_third_group_pct(&self) -> [f64; 4] {
        shares(self.final_third_by_group)
    }

    /// Share of aerial duels the defending side won, in percent.
    pub fn defender_aerial_win_pct(&self) -> f64 {
        let total = self.aerial_won + self.aerial_lost;
        if total == 0 {
            return 0.0;
        }
        self.aerial_lost as f64 / total as f64 * 100.0
    }

    /// The duel after a cross is lost when a clearance comes straight after
    /// it; otherwise it was won, and the shot that follows ends at the first
    /// goal, save, miss or penalty. A cross naming nobody never reached the
    /// contest, and one met along the ground (`LowCross`) is no aerial duel:
    /// neither counts (phase 2, P3.4).
    fn add_cross(&mut self, cross: &MatchEvent, after: &[MatchEvent]) {
        if cross.secondary_player_id.is_none() {
            self.unreached_crosses += 1;
            return;
        }
        let low = |e: &MatchEvent| e.tactical_context == Some(TacticalContext::LowCross);
        if low(cross) || after.first().is_some_and(low) {
            self.low_crosses += 1;
            return;
        }
        if after.first().map(|e| &e.event_type) == Some(&EventType::Clearance) {
            self.aerial_lost += 1;
            return;
        }
        self.aerial_won += 1;
        let ending = after.iter().find(|e| {
            matches!(
                e.event_type,
                EventType::Goal
                    | EventType::ShotSaved
                    | EventType::ShotOffTarget
                    | EventType::ShotBlocked
                    | EventType::PenaltyAwarded
            )
        });
        if ending.map(|e| &e.event_type) == Some(&EventType::Goal) {
            self.cross_goals += 1;
        }
    }

    /// One-on-ones down a flank, ordinary and into an open flank, and the
    /// goals a break into an open flank leads to.
    ///
    /// A one-on-one lost to a clearance leaves only the defence's
    /// `Clearance`, in its own third, straight after no cross and outside a
    /// set piece (as `DuelCounts` reads it); it counts as lost.
    fn add_flank_duel(
        &mut self,
        event: &MatchEvent,
        previous: Option<&MatchEvent>,
        exploiting: &mut Option<crate::types::Side>,
    ) {
        let exploit = event.tactical_context == Some(TacticalContext::FlankExposed);
        let flank = matches!(event.lane, Some(Lane::Left | Lane::Right));
        let in_third = event.zone == Zone::attacking_third(event.side);
        let duel_cleared = event.event_type == EventType::Clearance
            && event.zone == Zone::attacking_third(event.side.opposite())
            && event.set_piece.is_none()
            && previous.is_none_or(|p| p.event_type != EventType::Cross);
        if duel_cleared {
            if exploit {
                self.exploit_lost += 1;
            } else if flank {
                self.flank_lost += 1;
            }
        }
        match event.event_type {
            EventType::Dribble if exploit => {
                self.exploit_won += 1;
                *exploiting = Some(event.side);
                return;
            }
            EventType::DribbleTackled if exploit => self.exploit_lost += 1,
            EventType::Dribble if flank && in_third => self.flank_won += 1,
            EventType::DribbleTackled if flank && in_third => self.flank_lost += 1,
            EventType::Goal if *exploiting == Some(event.side) => self.exploit_goals += 1,
            _ => {}
        }
        if *exploiting != Some(event.side) || event.is_goal() {
            *exploiting = None;
        }
    }

    /// How much more often the attacker wins a one-on-one into an open flank
    /// than down a covered one, relative, in percent.
    pub fn exploit_advantage_pct(&self) -> f64 {
        let rate = |won: u64, lost: u64| won as f64 / (won + lost).max(1) as f64;
        let ordinary = rate(self.flank_won, self.flank_lost);
        if ordinary == 0.0 {
            return 0.0;
        }
        (rate(self.exploit_won, self.exploit_lost) / ordinary - 1.0) * 100.0
    }

    /// A foul's event carries the side that fouled; where it happened counts
    /// from the side that was fouled, the one attacking.
    fn add_foul(&mut self, foul: &MatchEvent) {
        let fouled_side = foul.side.opposite();
        if foul.zone.is_box_for(fouled_side) {
            self.fouls_in_box += 1;
        } else if foul.zone == Zone::attacking_third(fouled_side) {
            self.fouls_final_third += 1;
        }
    }
}

fn shares(counts: [u64; 4]) -> [f64; 4] {
    let total: u64 = counts.iter().sum();
    counts.map(|n| {
        if total == 0 {
            0.0
        } else {
            n as f64 / total as f64 * 100.0
        }
    })
}

/// The group of the slot `id` kicked off in, if he started for this sheet.
fn starting_group(sheet: &TeamSheet, id: &str) -> Option<Position> {
    let index = sheet.starters.iter().position(|s| s == id)?;
    formation_slots(&sheet.formation)
        .get(index)
        .map(|slot| slot.group())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Side;

    fn event(event_type: EventType, zone: Zone) -> MatchEvent {
        MatchEvent::new(10, event_type, Side::Home, zone)
    }

    /// Given two crosses, one cleared and one headed in,
    /// when the events are tallied,
    /// then one aerial duel is lost, one won, and the won one is a cross goal.
    #[test]
    fn a_cross_is_lost_when_cleared_and_won_otherwise() {
        let third = Zone::AwayDefense;
        let tally = EventTally::of(&[
            event(EventType::Cross, third).with_secondary("target"),
            event(EventType::Clearance, third),
            event(EventType::Cross, third).with_secondary("target"),
            event(EventType::Goal, Zone::AwayBox),
        ]);
        assert_eq!((tally.aerial_won, tally.aerial_lost), (1, 1));
        assert_eq!(tally.cross_goals, 1);
        assert_eq!(tally.defender_aerial_win_pct(), 50.0);
    }

    /// Given fouls by the home side in its own box, its own defensive third and
    /// midfield, and one by the away side in the home box,
    /// when they are tallied,
    /// then the zone is read from the attacking (fouled) side.
    #[test]
    fn fouls_are_placed_from_the_fouled_sides_view() {
        let mut events: Vec<MatchEvent> = [Zone::HomeBox, Zone::HomeDefense, Zone::Midfield]
            .into_iter()
            .map(|zone| event(EventType::Foul, zone))
            .collect();
        events.push(MatchEvent::new(
            10,
            EventType::Foul,
            Side::Away,
            Zone::HomeBox,
        ));
        let tally = EventTally::of(&events);
        assert_eq!((tally.fouls_in_box, tally.fouls_final_third), (1, 1));
    }

    fn in_lane(event_type: EventType, zone: Zone, lane: Lane) -> MatchEvent {
        let mut e = event(event_type, zone);
        e.lane = Some(lane);
        e
    }

    /// Given a cross that never reached the contest, one met along the
    /// ground and then cleared, and one won in the air,
    /// when they are tallied,
    /// then only the last is an aerial duel, and all three are open-play
    /// crosses (phase 2, P3.4).
    #[test]
    fn only_a_cross_contested_in_the_air_is_an_aerial_duel() {
        let third = Zone::AwayDefense;
        let low = |e: MatchEvent| e.with_tactical_context(TacticalContext::LowCross);
        let tally = EventTally::of(&[
            event(EventType::Cross, third),
            event(EventType::Clearance, third),
            event(EventType::Cross, third).with_secondary("target"),
            low(event(EventType::Clearance, third)),
            event(EventType::Cross, third).with_secondary("target"),
            event(EventType::Goal, Zone::AwayBox),
        ]);
        assert_eq!((tally.aerial_won, tally.aerial_lost), (1, 0));
        assert_eq!((tally.unreached_crosses, tally.low_crosses), (1, 1));
        assert_eq!(tally.open_play_crosses, 3);
    }

    /// Given one-on-ones in the attacking third down the left and the centre,
    /// one in midfield, and a cross from the right,
    /// when they are tallied,
    /// then the attacking third's lanes count two and the cross one.
    #[test]
    fn final_third_play_is_counted_by_lane() {
        let third = Zone::AwayDefense;
        let tally = EventTally::of(&[
            in_lane(EventType::Dribble, third, Lane::Left),
            in_lane(EventType::DribbleTackled, third, Lane::Centre),
            in_lane(EventType::Dribble, Zone::Midfield, Lane::Centre),
            in_lane(EventType::Cross, third, Lane::Right),
            event(EventType::Clearance, third),
        ]);
        assert_eq!(tally.final_third_lanes, [1, 1, 0]);
        assert_eq!(tally.crosses_by_lane, [0, 0, 1]);
        assert_eq!(tally.centre_lane_pct(), 50.0);
    }
}
