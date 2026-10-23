//! What a finished match leaves behind for the rest of the world (phase 3, E3-7): the score, each
//! player's numbers and who was hurt. The online runner stores it when a match ends; the server
//! settles the fixture from it (S-7) without keeping the whole report, whose events the step log
//! already holds.

use std::collections::BTreeMap;

use engine::{EventType, MatchReport, PlayerMatchStats};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSummary {
    pub home_goals: u8,
    pub away_goals: u8,
    /// Every player who took part, by id, as the engine counted him.
    pub player_stats: BTreeMap<String, PlayerMatchStats>,
    /// Players the engine hurt, in the order it hurt them; how badly is the settling side's roll
    /// (`player_wear::assign_match_injury`).
    pub injured: Vec<String>,
}

impl MatchSummary {
    pub fn from_report(report: &MatchReport) -> Self {
        Self {
            home_goals: report.home_goals,
            away_goals: report.away_goals,
            player_stats: report.player_stats.clone(),
            injured: injured_players(report),
        }
    }
}

/// The players `report`'s match hurt, in the order it hurt them.
pub fn injured_players(report: &MatchReport) -> Vec<String> {
    report
        .events
        .iter()
        .filter(|event| event.event_type == EventType::Injury)
        .filter_map(|event| event.player_id.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use engine::{MatchEvent, Side, Zone};

    use super::*;

    fn event(event_type: EventType, player: &str) -> MatchEvent {
        MatchEvent::new(10, event_type, Side::Home, Zone::Midfield).with_player(player)
    }

    /// Given a report with a foul and two injuries,
    /// when it is summed up,
    /// then the score and the players' numbers are kept, and only the injured are listed, in
    /// order.
    #[test]
    fn a_summary_keeps_the_score_the_numbers_and_the_injured() {
        let mut report = MatchReport::from_events(
            vec![
                event(EventType::Injury, "back"),
                event(EventType::Foul, "mid"),
                event(EventType::Injury, "keeper"),
            ],
            50,
            50,
            90,
        );
        report.home_goals = 2;
        report.away_goals = 1;
        report.player_stats.insert(
            "striker".into(),
            PlayerMatchStats {
                goals: 2,
                minutes_played: 90,
                ..PlayerMatchStats::default()
            },
        );
        let summary = MatchSummary::from_report(&report);
        assert_eq!((summary.home_goals, summary.away_goals), (2, 1));
        assert_eq!(summary.player_stats["striker"].goals, 2);
        assert_eq!(summary.injured, vec!["back", "keeper"]);

        let json = serde_json::to_string(&summary).unwrap();
        let back: MatchSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(back.injured, summary.injured);
        assert_eq!(back.player_stats["striker"].minutes_played, 90);
    }
}
