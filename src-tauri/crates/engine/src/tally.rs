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
    /// Build-ups from a side's own third (phase 2, P4.0): every pass played
    /// out of it, the ones that reached midfield, and the ones intercepted
    /// there (a high turnover), with the shots and goals the side that won
    /// the ball had before the other side touched it again.
    pub build_ups: u64,
    pub build_ups_completed: u64,
    pub high_turnovers: u64,
    pub high_turnover_shots: u64,
    pub high_turnover_goals: u64,
    /// Of the high turnovers, the ones after which the side that won the ball
    /// had at least one shot before the other side touched it again (GĐ5
    /// P5.3, T14).
    pub high_turnovers_with_shot: u64,
    /// Balls lost in midfield, to a tackle or an interception that is not a
    /// foul, and the ones the winner had a shot after, counted like a high
    /// turnover (GĐ5 P5.3, T14): the yardstick a high turnover's danger is
    /// read against.
    pub midfield_turnovers: u64,
    pub midfield_turnovers_with_shot: u64,
    /// Midfield duels (P4.0): the side on the ball passing into the final
    /// third, or losing it to a tackle or an interception in midfield.
    pub midfield_duels: u64,
    pub midfield_attack_won: u64,
    /// Midfield duels by the group of the slot the winner kicked off in:
    /// DEF, MID, FWD, substitutes. Only [`EventTally::of_report`] fills it.
    pub midfield_winners_by_group: [u64; 4],
    /// Balls a defence won in its own third with a tackle or a clearance and
    /// then took straight up the pitch, or played out from the back (phase 2,
    /// P4.1, X77): read off the winners' next event, when it is theirs.
    pub direct_wins: u64,
    pub played_out_wins: u64,
    /// Build-ups by the slot the passer kicked off in: centre back, full or
    /// wing-back, defensive midfielder, central midfielder, anyone else
    /// (substitutes included). Only [`EventTally::of_report`] fills it.
    pub build_up_passers: [u64; 5],
    /// Long balls out of the own third (phase 2, P4.2): all of them, those
    /// that cleared the midfield, and those whose side still had the ball
    /// after it (brought down, run onto, or the second ball won).
    pub long_balls: u64,
    pub long_balls_over: u64,
    pub long_balls_kept: u64,
    /// Races onto a long ball behind a high line, and those won.
    pub races: u64,
    pub races_won: u64,
    /// Loose balls after a long ball, and those the side that kicked it won.
    pub second_balls: u64,
    pub second_balls_kicker_won: u64,
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
        // The side whose long ball it was, while its loose balls are played.
        let mut kicker: Option<crate::types::Side> = None;
        for (index, event) in events.iter().enumerate() {
            let previous = index.checked_sub(1).map(|i| &events[i]);
            tally.add_flank_duel(event, previous, &mut exploiting);
            tally.add_build_up(event, &events[index + 1..]);
            tally.add_midfield_loss(event, &events[index + 1..]);
            tally.add_defensive_win(event, events.get(index + 1));
            tally.add_long_ball(event, events.get(index + 1), &mut kicker);
            if is_midfield_duel(event) {
                tally.midfield_duels += 1;
                if event.event_type == EventType::PassCompleted {
                    tally.midfield_attack_won += 1;
                }
            }
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
            let is_shot = event.is_shot();
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
            if let (true, Some(id)) = (is_midfield_duel(event), event.player_id.as_deref()) {
                tally.midfield_winners_by_group[group_of(id)] += 1;
            }
            let build_up = matches!(
                event.event_type,
                EventType::PassCompleted | EventType::PassIntercepted
            ) && event.zone == Zone::defensive_third(event.side);
            if let (true, Some(id)) = (build_up, event.player_id.as_deref()) {
                let slot = [home, away]
                    .into_iter()
                    .find_map(|sheet| starting_slot(sheet, id));
                tally.build_up_passers[build_up_slot_index(slot)] += 1;
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
        self.build_ups += other.build_ups;
        self.build_ups_completed += other.build_ups_completed;
        self.high_turnovers += other.high_turnovers;
        self.high_turnover_shots += other.high_turnover_shots;
        self.high_turnover_goals += other.high_turnover_goals;
        self.high_turnovers_with_shot += other.high_turnovers_with_shot;
        self.midfield_turnovers += other.midfield_turnovers;
        self.midfield_turnovers_with_shot += other.midfield_turnovers_with_shot;
        self.midfield_duels += other.midfield_duels;
        self.midfield_attack_won += other.midfield_attack_won;
        self.direct_wins += other.direct_wins;
        self.long_balls += other.long_balls;
        self.long_balls_over += other.long_balls_over;
        self.long_balls_kept += other.long_balls_kept;
        self.races += other.races;
        self.races_won += other.races_won;
        self.second_balls += other.second_balls;
        self.second_balls_kicker_won += other.second_balls_kicker_won;
        self.played_out_wins += other.played_out_wins;
        for i in 0..5 {
            self.build_up_passers[i] += other.build_up_passers[i];
        }
        for i in 0..3 {
            self.final_third_lanes[i] += other.final_third_lanes[i];
            self.crosses_by_lane[i] += other.crosses_by_lane[i];
        }
        for i in 0..4 {
            self.box_shots_by_group[i] += other.box_shots_by_group[i];
            self.final_third_by_group[i] += other.final_third_by_group[i];
            self.midfield_winners_by_group[i] += other.midfield_winners_by_group[i];
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

    /// Shares of midfield duels by the winner's group: DEF, MID, FWD and
    /// substitutes, in percent.
    pub fn midfield_winner_group_pct(&self) -> [f64; 4] {
        shares(self.midfield_winners_by_group)
    }

    /// Share of build-ups that reached midfield, in percent.
    pub fn build_up_success_pct(&self) -> f64 {
        percent(self.build_ups_completed, self.build_ups)
    }

    /// Share of midfield duels the side on the ball won, in percent.
    pub fn midfield_attack_won_pct(&self) -> f64 {
        percent(self.midfield_attack_won, self.midfield_duels)
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

    /// A pass played out of a side's own third, made or intercepted there.
    /// After an interception, the shots and goals of the side that won the
    /// ball count until the side that lost it has an event of its own.
    fn add_build_up(&mut self, event: &MatchEvent, after: &[MatchEvent]) {
        if event.zone != Zone::defensive_third(event.side) {
            return;
        }
        match event.event_type {
            EventType::PassCompleted => {
                self.build_ups += 1;
                self.build_ups_completed += 1;
            }
            EventType::PassIntercepted => {
                self.build_ups += 1;
                self.high_turnovers += 1;
                let winner = event.side.opposite();
                let mut shot = false;
                for next in after.iter().take_while(|e| e.side == winner) {
                    if next.is_shot() {
                        self.high_turnover_shots += 1;
                        shot = true;
                    }
                    if next.is_goal() {
                        self.high_turnover_goals += 1;
                    }
                }
                self.high_turnovers_with_shot += u64::from(shot);
            }
            _ => {}
        }
    }

    /// A ball won in midfield by a tackle or an interception, unless the
    /// tackle was a foul (the side on the ball keeps it), and whether the
    /// winner had a shot before the other side touched it again.
    fn add_midfield_loss(&mut self, event: &MatchEvent, after: &[MatchEvent]) {
        let won_in_midfield = event.zone == Zone::Midfield
            && matches!(
                event.event_type,
                EventType::Tackle | EventType::Interception
            );
        if !won_in_midfield
            || after
                .first()
                .is_some_and(|n| n.event_type == EventType::Foul)
        {
            return;
        }
        let winner = event.side;
        self.midfield_turnovers += 1;
        let shot = after
            .iter()
            .take_while(|e| e.side == winner)
            .any(MatchEvent::is_shot);
        self.midfield_turnovers_with_shot += u64::from(shot);
    }

    /// How much likelier a shot is after a ball lost in the own third than
    /// after one lost in midfield (GĐ5 P5.3, T14; StatsBomb 1.44): the share
    /// of each that the winner had a shot after. Zero without a midfield loss
    /// to compare with.
    pub fn turnover_danger_ratio(&self) -> f64 {
        let rate = |with_shot: u64, all: u64| with_shot as f64 / all.max(1) as f64;
        let midfield = rate(self.midfield_turnovers_with_shot, self.midfield_turnovers);
        if midfield == 0.0 {
            return 0.0;
        }
        rate(self.high_turnovers_with_shot, self.high_turnovers) / midfield
    }

    /// A tackle or clearance in the winner's own third, and where play goes
    /// next: the winners' attacking third or box, whoever has the next event
    /// there (the other side may clear at once), is direct; the winners'
    /// own build-up is played out. A foul straight after, a corner, or the
    /// ball lost before the next action, and the win is not counted.
    fn add_defensive_win(&mut self, event: &MatchEvent, next: Option<&MatchEvent>) {
        let won = matches!(event.event_type, EventType::Tackle | EventType::Clearance)
            && event.zone == Zone::defensive_third(event.side);
        let Some(next) = next.filter(|n| won && n.event_type != EventType::Foul) else {
            return;
        };
        let winner = event.side;
        if next.side == winner && next.zone == Zone::defensive_third(winner) {
            self.played_out_wins += 1;
        } else if next.zone == Zone::attacking_third(winner) || next.zone.is_box_for(winner) {
            self.direct_wins += 1;
        }
    }

    /// A long ball and what its next event says of it: a loose ball in
    /// midfield (it fell short), a run behind won (`BallInBehind`) or lost
    /// (the defence's interception), a header clear, a loose ball where it
    /// was met; anything else is a ball brought down. Every loose ball counts
    /// for or against the side that kicked it.
    fn add_long_ball(
        &mut self,
        event: &MatchEvent,
        next: Option<&MatchEvent>,
        kicker: &mut Option<crate::types::Side>,
    ) {
        if event.event_type == EventType::BallRecovery {
            self.second_balls += 1;
            if *kicker == Some(event.side) {
                self.second_balls_kicker_won += 1;
                self.long_balls_kept += 1;
            }
            return;
        }
        if event.event_type != EventType::LongBall {
            return;
        }
        let side = event.side;
        *kicker = Some(side);
        self.long_balls += 1;
        let Some(next) = next else {
            return;
        };
        let short = next.event_type == EventType::BallRecovery && next.zone == Zone::Midfield;
        if short {
            return;
        }
        self.long_balls_over += 1;
        match next.event_type {
            EventType::Dribble if next.tactical_context == Some(TacticalContext::BallInBehind) => {
                self.races += 1;
                self.races_won += 1;
                self.long_balls_kept += 1;
            }
            EventType::Interception if next.side != side => self.races += 1,
            EventType::Clearance | EventType::BallRecovery => {}
            _ => self.long_balls_kept += 1,
        }
    }

    /// Share of long balls that cleared the midfield, and of those kept by
    /// the side that kicked them, in percent.
    pub fn long_ball_pct(&self) -> (f64, f64) {
        (
            percent(self.long_balls_over, self.long_balls),
            percent(self.long_balls_kept, self.long_balls),
        )
    }

    /// Share of build-ups by passer slot: CB, FB, DM, CM and anyone else, in
    /// percent.
    pub fn build_up_passer_pct(&self) -> [f64; 5] {
        let total: u64 = self.build_up_passers.iter().sum();
        self.build_up_passers.map(|n| percent(n, total))
    }

    /// Share of balls won in the own third that went straight up the pitch,
    /// in percent.
    pub fn direct_win_pct(&self) -> f64 {
        percent(self.direct_wins, self.direct_wins + self.played_out_wins)
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

/// A midfield duel's deciding event: the side on the ball passing on, or the
/// other side winning it with a tackle or an interception.
fn is_midfield_duel(event: &MatchEvent) -> bool {
    event.zone == Zone::Midfield
        && matches!(
            event.event_type,
            EventType::PassCompleted | EventType::Tackle | EventType::Interception
        )
}

fn percent(part: u64, whole: u64) -> f64 {
    if whole == 0 {
        0.0
    } else {
        part as f64 / whole as f64 * 100.0
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

/// The slot `id` kicked off in, if he started for this sheet.
fn starting_slot(sheet: &TeamSheet, id: &str) -> Option<crate::pitch_position::PitchPosition> {
    let index = sheet.starters.iter().position(|s| s == id)?;
    formation_slots(&sheet.formation).get(index).copied()
}

/// Where a build-up's passer counts: CB, FB (wing-backs too), DM, CM, else.
fn build_up_slot_index(slot: Option<crate::pitch_position::PitchPosition>) -> usize {
    use crate::pitch_position::PitchPosition as P;
    match slot {
        Some(P::CenterBack) => 0,
        Some(P::LeftBack | P::RightBack | P::LeftWingBack | P::RightWingBack) => 1,
        Some(P::DefensiveMidfielder) => 2,
        Some(P::CentralMidfielder) => 3,
        _ => 4,
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

    fn away(event_type: EventType, zone: Zone) -> MatchEvent {
        MatchEvent::new(10, event_type, Side::Away, zone)
    }

    /// Given a home build-up that reaches midfield and one intercepted in the
    /// home third, after which the away side shoots and scores, then the home
    /// side has the ball again,
    /// when they are tallied,
    /// then there are two build-ups, one completed, one high turnover, and
    /// one shot and one goal from it (phase 2, P4.0).
    #[test]
    fn a_build_up_lost_in_the_own_third_is_a_high_turnover() {
        let tally = EventTally::of(&[
            event(EventType::PassCompleted, Zone::HomeDefense),
            event(EventType::PassIntercepted, Zone::HomeDefense),
            away(EventType::Interception, Zone::HomeDefense),
            away(EventType::Dribble, Zone::HomeDefense),
            away(EventType::Goal, Zone::HomeBox),
            event(EventType::PassCompleted, Zone::Midfield),
            away(EventType::ShotSaved, Zone::HomeBox),
        ]);
        assert_eq!((tally.build_ups, tally.build_ups_completed), (2, 1));
        assert_eq!(tally.high_turnovers, 1);
        assert_eq!(
            (tally.high_turnover_shots, tally.high_turnover_goals),
            (1, 1)
        );
    }

    /// Given an away tackle in midfield after which the away side shoots
    /// twice, an away interception in midfield after which the home side has
    /// the ball back without a shot, an away tackle in midfield that is a
    /// foul, and a home build-up lost after which the away side shoots twice,
    /// when they are tallied,
    /// then two balls were lost in midfield, one of them led to a shot, the
    /// foul is not a loss, and the danger ratio counts each lost ball once
    /// however many shots followed (GĐ5 P5.3, T14).
    #[test]
    fn a_ball_lost_in_midfield_is_counted_with_whether_a_shot_followed() {
        let tally = EventTally::of(&[
            away(EventType::Tackle, Zone::Midfield),
            away(EventType::ShotBlocked, Zone::HomeBox),
            away(EventType::ShotSaved, Zone::HomeBox),
            event(EventType::PassCompleted, Zone::Midfield),
            away(EventType::Interception, Zone::Midfield),
            event(EventType::PassCompleted, Zone::Midfield),
            away(EventType::Tackle, Zone::Midfield),
            away(EventType::Foul, Zone::Midfield),
            event(EventType::PassIntercepted, Zone::HomeDefense),
            away(EventType::Interception, Zone::HomeDefense),
            away(EventType::ShotOffTarget, Zone::HomeBox),
            away(EventType::ShotSaved, Zone::HomeBox),
        ]);
        assert_eq!(
            (tally.midfield_turnovers, tally.midfield_turnovers_with_shot),
            (2, 1)
        );
        assert_eq!(
            (tally.high_turnovers, tally.high_turnovers_with_shot),
            (1, 1)
        );
        assert!((tally.turnover_danger_ratio() - 2.0).abs() < 1e-9);
    }

    /// Given an away tackle in its own third followed by the away side in its
    /// attacking third, an away clearance followed by an away build-up, and
    /// an away tackle followed by a home free kick, and an away clearance
    /// the home side clears straight back out of its own third,
    /// when they are tallied,
    /// then two wins went direct, one was played out, and the free kick counts
    /// as neither (phase 2, P4.1, X77).
    #[test]
    fn a_ball_won_in_the_own_third_goes_direct_or_is_played_out() {
        let tally = EventTally::of(&[
            away(EventType::Tackle, Zone::AwayDefense),
            away(EventType::Dribble, Zone::HomeDefense),
            away(EventType::Clearance, Zone::AwayDefense),
            away(EventType::PassCompleted, Zone::AwayDefense),
            away(EventType::Tackle, Zone::AwayDefense),
            event(EventType::FreeKick, Zone::AwayDefense),
            away(EventType::Clearance, Zone::AwayDefense),
            event(EventType::Clearance, Zone::HomeDefense),
        ]);
        assert_eq!((tally.direct_wins, tally.played_out_wins), (2, 1));
    }

    /// Given five home long balls: one dropping short to a second ball the
    /// away side wins, one run onto behind, one the away side wins in the
    /// race, one headed clear and won back by the home side, and one brought
    /// down,
    /// when they are tallied,
    /// then five long balls, four over the midfield, two races (one won), two
    /// second balls (one to the home side) and three kept by the home side
    /// (phase 2, P4.2).
    #[test]
    fn long_balls_are_read_from_what_follows_them() {
        let long = |e: MatchEvent| e.with_tactical_context(TacticalContext::LongBall);
        let tally = EventTally::of(&[
            long(event(EventType::LongBall, Zone::HomeDefense)),
            away(EventType::BallRecovery, Zone::Midfield)
                .with_tactical_context(TacticalContext::SecondBall),
            long(event(EventType::LongBall, Zone::HomeDefense)),
            event(EventType::Dribble, Zone::AwayDefense)
                .with_tactical_context(TacticalContext::BallInBehind),
            long(event(EventType::LongBall, Zone::HomeDefense)),
            long(away(EventType::Interception, Zone::AwayDefense)),
            long(event(EventType::LongBall, Zone::HomeDefense)),
            long(away(EventType::Clearance, Zone::AwayDefense)),
            event(EventType::BallRecovery, Zone::Midfield)
                .with_tactical_context(TacticalContext::SecondBall),
            long(event(EventType::LongBall, Zone::HomeDefense)),
            long(event(EventType::Dribble, Zone::AwayDefense)),
        ]);
        assert_eq!((tally.long_balls, tally.long_balls_over), (5, 4));
        assert_eq!((tally.races, tally.races_won), (2, 1));
        assert_eq!((tally.second_balls, tally.second_balls_kicker_won), (2, 1));
        assert_eq!(tally.long_balls_kept, 3);
    }

    /// Given a midfield pass completed by the home side, a home pass in
    /// midfield lost to a tackle and one to an interception,
    /// when they are tallied,
    /// then there are three midfield duels and the attacker won one.
    #[test]
    fn midfield_duels_are_counted_from_both_outcomes() {
        let tally = EventTally::of(&[
            event(EventType::PassCompleted, Zone::Midfield),
            away(EventType::Tackle, Zone::Midfield),
            away(EventType::Interception, Zone::Midfield),
            away(EventType::Tackle, Zone::HomeDefense),
        ]);
        assert_eq!((tally.midfield_duels, tally.midfield_attack_won), (3, 1));
        assert!((tally.midfield_attack_won_pct() - 100.0 / 3.0).abs() < 1e-9);
    }
}
