//! Counts read off a match's events that no report field carries: who won the
//! aerial duels after crosses, where the fouls were, and — for phase 2, GĐ3 —
//! which lane the play in the final third ran down and who shot in the box.
//!
//! sim-bench and the real-world probe both measure these, so the rule for
//! reading them lives here, once, next to the events it reads.

use crate::event::{EventType, Lane, MatchEvent, ShotKind};
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
    /// Shots in the box with the feet or the head, by the group of the slot
    /// the shooter kicked off in: DEF, MID, FWD, and a fourth for players who
    /// came off the bench. Only [`EventTally::of_report`] fills it.
    pub box_shots_by_group: [u64; 4],
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
        for (index, event) in events.iter().enumerate() {
            match event.event_type {
                EventType::Cross => {
                    tally.add_cross(&events[index + 1..]);
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
        }
        tally
    }

    pub fn add(&mut self, other: &Self) {
        self.aerial_won += other.aerial_won;
        self.aerial_lost += other.aerial_lost;
        self.cross_goals += other.cross_goals;
        self.fouls_final_third += other.fouls_final_third;
        self.fouls_in_box += other.fouls_in_box;
        for i in 0..3 {
            self.final_third_lanes[i] += other.final_third_lanes[i];
            self.crosses_by_lane[i] += other.crosses_by_lane[i];
        }
        for i in 0..4 {
            self.box_shots_by_group[i] += other.box_shots_by_group[i];
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
        let total: u64 = self.box_shots_by_group.iter().sum();
        self.box_shots_by_group.map(|n| {
            if total == 0 {
                0.0
            } else {
                n as f64 / total as f64 * 100.0
            }
        })
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
    /// goal, save, miss or penalty.
    fn add_cross(&mut self, after: &[MatchEvent]) {
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
            event(EventType::Cross, third),
            event(EventType::Clearance, third),
            event(EventType::Cross, third),
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
