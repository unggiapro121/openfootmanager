//! Match ratings: one number per player for how well he played.
//!
//! Built from the same events the report counts, so a rating never credits
//! anything the simulation did not do. The scale centres on 6.0 — an ordinary
//! game — with a match-winning goal reaching 7 and beyond and a sending-off
//! sinking to about 4. A player who is anonymous for ninety minutes lands
//! below 6.0, because an ordinary game includes an ordinary amount of work. A
//! cameo is pulled back toward 6.0 in proportion to how little of the match it
//! covered, and a few minutes at the end are not rated at all.

use std::collections::HashMap;

use crate::event::EventType;
use crate::report::MatchReport;
use crate::types::{PlayerData, Position, Side};

/// A player who was on either side's books for the match, as the rating needs
/// him: whose side he was on and where he played.
pub struct RosterEntry<'a> {
    pub id: &'a str,
    pub side: Side,
    pub position: Position,
}

impl<'a> RosterEntry<'a> {
    pub(crate) fn new(player: &'a PlayerData, side: Side) -> Self {
        Self {
            id: &player.id,
            side,
            position: player.position,
        }
    }
}

/// Fill in `rating` for every player in `report` who played long enough to be
/// judged. Anyone else keeps 0.0, which reads as "not rated" everywhere a
/// rating is consumed.
pub(crate) fn rate_players(report: &mut MatchReport, roster: &[RosterEntry<'_>]) {
    let total_minutes = report.total_minutes.max(1);
    let minutes_of = |id: &str| {
        report
            .player_stats
            .get(id)
            .map_or(0, |stats| stats.minutes_played)
    };
    let mut contributions: HashMap<&str, Contribution> = HashMap::new();
    for event in &report.events {
        if let Some(player) = event.player_id.as_deref() {
            contributions
                .entry(player)
                .or_default()
                .credit(&event.event_type);
        }
        if event.event_type == EventType::Goal
            && let Some(assister) = event.secondary_player_id.as_deref()
        {
            contributions.entry(assister).or_default().assists += 1;
        }
    }

    let match_context = MatchContext::read(report, roster, &minutes_of);
    let mut ratings = Vec::new();
    for player in roster {
        let minutes = minutes_of(player.id);
        if minutes < MIN_RATED_MINUTES {
            continue;
        }
        let share_of_match = f32::from(minutes) / f32::from(total_minutes);
        let mut rating = NEUTRAL_RATING - AVERAGE_CONTRIBUTION
            + contributions
                .get(player.id)
                .map_or(0.0, Contribution::value)
            + match_context.result_value(player.side)
            + match_context.defending_value(player, minutes, share_of_match);
        if minutes < FULL_WEIGHT_MINUTES {
            rating = NEUTRAL_RATING
                + (rating - NEUTRAL_RATING) * f32::from(minutes) / f32::from(FULL_WEIGHT_MINUTES);
        }
        let rating = (rating.clamp(LOWEST_RATING, HIGHEST_RATING) * 10.0).round() / 10.0;
        ratings.push((player.id.to_string(), rating));
    }
    for (id, rating) in ratings {
        if let Some(stats) = report.player_stats.get_mut(&id) {
            stats.rating = rating;
        }
    }
}

/// An ordinary game: where a player who neither stood out nor let anyone down lands.
const NEUTRAL_RATING: f32 = 6.0;
const LOWEST_RATING: f32 = 3.0;
const HIGHEST_RATING: f32 = 10.0;
/// Below this a player has not had time to be judged, and gets no rating.
const MIN_RATED_MINUTES: u8 = 10;
/// Below this a rating is pulled toward neutral in proportion to the minutes played.
const FULL_WEIGHT_MINUTES: u8 = 30;
/// A keeper or defender must have been on for this long to share in a clean sheet.
const CLEAN_SHEET_MINUTES: u8 = 60;

/// What an ordinary player's ninety minutes add up to under the values below,
/// taken off so that an ordinary game rates 6.0. Measured from the engine's
/// own output: about two tackles, one interception, one or two dribbles and a
/// clearance a player, a goal or assist every few games, and a back line that
/// concedes about two. If the engine starts producing more or fewer actions,
/// `ratings_centre_on_six_across_many_matches` fails and this moves with it.
const AVERAGE_CONTRIBUTION: f32 = 0.5;

/// A long afternoon of simple passes is worth something, but not a goal's worth.
const PASSING_CAP: f32 = 0.5;

const WIN_VALUE: f32 = 0.3;
const KEEPER_CLEAN_SHEET: f32 = 0.6;
const DEFENDER_CLEAN_SHEET: f32 = 0.4;
const KEEPER_PER_GOAL_CONCEDED: f32 = 0.25;
const DEFENDER_PER_GOAL_CONCEDED: f32 = 0.15;
const KEEPER_PER_SAVE: f32 = 0.15;

/// What one player did himself, event by event.
#[derive(Default)]
struct Contribution {
    on_the_ball: f32,
    passing: f32,
    assists: u32,
}

impl Contribution {
    fn credit(&mut self, event_type: &EventType) {
        if *event_type == EventType::PassCompleted {
            self.passing += 0.01;
            return;
        }
        self.on_the_ball += match event_type {
            EventType::Goal => 1.2,
            EventType::PenaltyGoal => 0.7,
            EventType::PenaltyMiss => -0.6,
            EventType::ShotSaved | EventType::ShotOnTarget => 0.1,
            EventType::ShotOffTarget => -0.05,
            EventType::ShotBlocked => -0.03,
            EventType::PassIntercepted => -0.03,
            EventType::Dribble => 0.06,
            EventType::DribbleTackled => -0.04,
            EventType::Cross => 0.02,
            EventType::Tackle => 0.07,
            EventType::Interception => 0.08,
            EventType::Clearance => 0.04,
            EventType::Foul => -0.05,
            EventType::YellowCard => -0.3,
            EventType::SecondYellow | EventType::RedCard => -1.5,
            _ => 0.0,
        };
    }

    fn value(&self) -> f32 {
        self.on_the_ball + self.passing.min(PASSING_CAP) + self.assists as f32 * 0.7
    }
}

/// What the match itself says about each side: the result, the goals each
/// conceded, and the saves each keeper made.
struct MatchContext {
    home_goals: u8,
    away_goals: u8,
    /// Shots each side's keeper kept out, credited to whichever keeper of that
    /// side played the most minutes — the engine records the shooter, not the keeper.
    home_saves: u32,
    away_saves: u32,
    home_keeper: Option<String>,
    away_keeper: Option<String>,
}

impl MatchContext {
    fn read(
        report: &MatchReport,
        roster: &[RosterEntry<'_>],
        minutes_of: &dyn Fn(&str) -> u8,
    ) -> Self {
        let saves_against = |shooting_side: Side| {
            report
                .events
                .iter()
                .filter(|event| {
                    event.event_type == EventType::ShotSaved && event.side == shooting_side
                })
                .count() as u32
        };
        let keeper_of = |side: Side| {
            roster
                .iter()
                .filter(|player| player.side == side && player.position == Position::Goalkeeper)
                .max_by_key(|player| minutes_of(player.id))
                .map(|player| player.id.to_string())
        };
        Self {
            home_goals: report.home_goals,
            away_goals: report.away_goals,
            home_saves: saves_against(Side::Away),
            away_saves: saves_against(Side::Home),
            home_keeper: keeper_of(Side::Home),
            away_keeper: keeper_of(Side::Away),
        }
    }

    fn goals_for_and_against(&self, side: Side) -> (u8, u8) {
        match side {
            Side::Home => (self.home_goals, self.away_goals),
            Side::Away => (self.away_goals, self.home_goals),
        }
    }

    fn result_value(&self, side: Side) -> f32 {
        let (scored, conceded) = self.goals_for_and_against(side);
        match scored.cmp(&conceded) {
            std::cmp::Ordering::Greater => WIN_VALUE,
            std::cmp::Ordering::Less => -WIN_VALUE,
            std::cmp::Ordering::Equal => 0.0,
        }
    }

    fn defending_value(&self, player: &RosterEntry<'_>, minutes: u8, share_of_match: f32) -> f32 {
        let (clean_sheet, per_goal) = match player.position {
            Position::Goalkeeper => (KEEPER_CLEAN_SHEET, KEEPER_PER_GOAL_CONCEDED),
            Position::Defender => (DEFENDER_CLEAN_SHEET, DEFENDER_PER_GOAL_CONCEDED),
            Position::Midfielder | Position::Forward => return 0.0,
        };
        let (_, conceded) = self.goals_for_and_against(player.side);
        let back_line = if conceded == 0 {
            if minutes >= CLEAN_SHEET_MINUTES {
                clean_sheet
            } else {
                0.0
            }
        } else {
            -per_goal * f32::from(conceded) * share_of_match
        };
        let (keeper, saves) = match player.side {
            Side::Home => (&self.home_keeper, self.home_saves),
            Side::Away => (&self.away_keeper, self.away_saves),
        };
        let saving = if keeper.as_deref() == Some(player.id) {
            KEEPER_PER_SAVE * saves as f32
        } else {
            0.0
        };
        back_line + saving
    }
}

#[cfg(test)]
mod tests {
    use super::{RosterEntry, rate_players};
    use crate::event::{EventType, MatchEvent};
    use crate::report::MatchReport;
    use crate::types::{Position, Side, Zone};

    fn event(minute: u8, kind: EventType, side: Side, player: &str) -> MatchEvent {
        MatchEvent::new(minute, kind, side, Zone::Midfield).with_player(player)
    }

    fn roster() -> Vec<RosterEntry<'static>> {
        vec![
            RosterEntry {
                id: "h_gk",
                side: Side::Home,
                position: Position::Goalkeeper,
            },
            RosterEntry {
                id: "h_def",
                side: Side::Home,
                position: Position::Defender,
            },
            RosterEntry {
                id: "h_mid",
                side: Side::Home,
                position: Position::Midfielder,
            },
            RosterEntry {
                id: "h_fwd",
                side: Side::Home,
                position: Position::Forward,
            },
            RosterEntry {
                id: "h_sub",
                side: Side::Home,
                position: Position::Forward,
            },
            RosterEntry {
                id: "a_gk",
                side: Side::Away,
                position: Position::Goalkeeper,
            },
            RosterEntry {
                id: "a_def",
                side: Side::Away,
                position: Position::Defender,
            },
            RosterEntry {
                id: "a_mid",
                side: Side::Away,
                position: Position::Midfielder,
            },
            RosterEntry {
                id: "a_fwd",
                side: Side::Away,
                position: Position::Forward,
            },
        ]
    }

    fn rated(events: Vec<MatchEvent>) -> MatchReport {
        let starters = [
            "h_gk", "h_def", "h_mid", "h_fwd", "a_gk", "a_def", "a_mid", "a_fwd",
        ]
        .iter()
        .map(|id| id.to_string())
        .collect();
        let mut report = MatchReport::from_events_with_players(events, 50, 50, 90, starters);
        rate_players(&mut report, &roster());
        report
    }

    fn rating_of(report: &MatchReport, id: &str) -> f32 {
        report
            .player_stats
            .get(id)
            .map(|stats| stats.rating)
            .unwrap_or(0.0)
    }

    /// Given a goalless draw in which nobody did anything of note,
    /// When the players are rated,
    /// Then the outfield players are all marked alike, and below the 6.0 of an
    /// ordinary game: ninety anonymous minutes are not an ordinary game.
    #[test]
    fn ninety_anonymous_minutes_rate_below_six() {
        let report = rated(vec![]);

        for id in ["h_mid", "h_fwd", "a_mid", "a_fwd"] {
            assert!(
                (rating_of(&report, id) - 5.5).abs() < 0.05,
                "{id}: {}",
                rating_of(&report, id)
            );
        }
    }

    /// Given a match the home side wins 1-0 with a goal from its forward,
    /// When the players are rated,
    /// Then the scorer rates well above six, the assister above six, and the
    /// losing forward below six.
    #[test]
    fn the_match_winner_rates_highest_and_the_beaten_forward_below_six() {
        let report = rated(vec![
            event(30, EventType::Goal, Side::Home, "h_fwd").with_secondary("h_mid"),
        ]);

        assert!(
            rating_of(&report, "h_fwd") >= 7.0,
            "scorer {}",
            rating_of(&report, "h_fwd")
        );
        assert!(
            rating_of(&report, "h_mid") > 6.0,
            "assister {}",
            rating_of(&report, "h_mid")
        );
        assert!(rating_of(&report, "h_fwd") > rating_of(&report, "h_mid"));
        assert!(
            rating_of(&report, "a_fwd") < 6.0,
            "beaten forward {}",
            rating_of(&report, "a_fwd")
        );
    }

    /// Given a 1-0 home win,
    /// When the players are rated,
    /// Then the home keeper and defender are rewarded for the clean sheet and
    /// the away keeper and defender are marked down for the goal they let in.
    #[test]
    fn a_clean_sheet_rewards_the_back_line_and_a_goal_conceded_costs_it() {
        let report = rated(vec![
            event(30, EventType::Goal, Side::Home, "h_fwd").with_secondary("h_mid"),
        ]);

        assert!(
            rating_of(&report, "h_gk") > 6.0,
            "clean sheet keeper {}",
            rating_of(&report, "h_gk")
        );
        assert!(
            rating_of(&report, "h_def") > 6.0,
            "clean sheet defender {}",
            rating_of(&report, "h_def")
        );
        assert!(
            rating_of(&report, "a_gk") < 6.0,
            "beaten keeper {}",
            rating_of(&report, "a_gk")
        );
        assert!(
            rating_of(&report, "a_def") < 6.0,
            "beaten defender {}",
            rating_of(&report, "a_def")
        );
    }

    /// Given a keeper who makes three saves in a goalless draw,
    /// When the players are rated,
    /// Then he rates above the keeper who had nothing to do.
    #[test]
    fn saves_lift_the_keeper_who_made_them() {
        let report = rated(vec![
            event(10, EventType::ShotSaved, Side::Away, "a_fwd"),
            event(40, EventType::ShotSaved, Side::Away, "a_fwd"),
            event(70, EventType::ShotSaved, Side::Away, "a_mid"),
        ]);

        assert!(rating_of(&report, "h_gk") > rating_of(&report, "a_gk") + 0.3);
    }

    /// Given a midfielder sent off in a goalless draw,
    /// When the players are rated,
    /// Then he rates far below six.
    #[test]
    fn a_sending_off_sinks_the_rating() {
        let report = rated(vec![event(50, EventType::RedCard, Side::Home, "h_mid")]);

        assert!(
            rating_of(&report, "h_mid") < 5.0,
            "sent off {}",
            rating_of(&report, "h_mid")
        );
    }

    /// Given a defender who wins tackles and interceptions all afternoon,
    /// When the players are rated,
    /// Then his defending shows in his rating.
    #[test]
    fn defensive_work_is_rewarded() {
        let mut events = Vec::new();
        for minute in [5, 15, 25, 35, 45, 55, 65, 75] {
            events.push(event(minute, EventType::Tackle, Side::Away, "a_def"));
            events.push(event(
                minute + 1,
                EventType::Interception,
                Side::Away,
                "a_def",
            ));
        }
        let report = rated(events);

        assert!(
            rating_of(&report, "a_def") > 6.5,
            "busy defender {}",
            rating_of(&report, "a_def")
        );
    }

    /// Given a substitute who comes on for the last five minutes,
    /// When the players are rated,
    /// Then he is not rated at all.
    #[test]
    fn a_few_minutes_at_the_end_are_not_rated() {
        let report = rated(vec![
            event(85, EventType::Substitution, Side::Home, "h_sub").with_secondary("h_fwd"),
        ]);

        assert_eq!(rating_of(&report, "h_sub"), 0.0);
        assert!(
            rating_of(&report, "h_fwd") > 0.0,
            "the man he replaced played 85 minutes"
        );
    }

    /// Given a substitute who scores within twenty minutes of coming on,
    /// When the players are rated,
    /// Then his rating is pulled back toward six for the short time he played,
    /// below a starter who did the same over ninety minutes.
    #[test]
    fn a_cameo_is_judged_in_proportion_to_its_minutes() {
        let cameo = rated(vec![
            event(70, EventType::Substitution, Side::Home, "h_sub").with_secondary("h_fwd"),
            event(80, EventType::Goal, Side::Home, "h_sub").with_secondary("h_mid"),
        ]);
        let full = rated(vec![
            event(80, EventType::Goal, Side::Home, "h_fwd").with_secondary("h_mid"),
        ]);

        let cameo_rating = rating_of(&cameo, "h_sub");
        assert!(
            cameo_rating > 6.0,
            "a scoring cameo still rates above six: {cameo_rating}"
        );
        assert!(cameo_rating < rating_of(&full, "h_fwd"));
    }

    /// Given any match,
    /// When the players are rated,
    /// Then every rating is on the 3.0–10.0 scale and has one decimal place.
    #[test]
    fn ratings_stay_on_the_scale_and_are_rounded_to_a_tenth() {
        let mut events = Vec::new();
        for minute in 1..=8 {
            events.push(
                event(minute * 10, EventType::Goal, Side::Home, "h_fwd").with_secondary("h_mid"),
            );
        }
        events.push(event(20, EventType::RedCard, Side::Away, "a_mid"));
        events.push(event(21, EventType::YellowCard, Side::Away, "a_def"));
        let report = rated(events);

        for (id, stats) in &report.player_stats {
            if stats.rating == 0.0 {
                continue;
            }
            assert!(
                (3.0..=10.0).contains(&stats.rating),
                "{id}: {}",
                stats.rating
            );
            assert!(
                ((stats.rating * 10.0).round() - stats.rating * 10.0).abs() < 1e-3,
                "{id}: {}",
                stats.rating
            );
        }
    }
}
