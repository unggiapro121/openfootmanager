//! Counts read off a match's events that no report field carries: who won the
//! aerial duels after crosses, and where the fouls were.
//!
//! sim-bench and the real-world probe both measure these, so the rule for
//! reading them lives here, once, next to the events it reads.

use crate::event::{EventType, MatchEvent};
use crate::types::Zone;

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
}

impl EventTally {
    /// The tally of one match's events, in the order they happened.
    pub fn of(events: &[MatchEvent]) -> Self {
        let mut tally = Self::default();
        for (index, event) in events.iter().enumerate() {
            match event.event_type {
                EventType::Cross => tally.add_cross(&events[index + 1..]),
                EventType::Foul => tally.add_foul(event),
                _ => {}
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
}
