use crate::report::GoalSource;
use crate::types::{Side, Zone};
use serde::{Deserialize, Serialize};

/// A single event that occurred during the match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchEvent {
    pub minute: u8,
    pub event_type: EventType,
    pub side: Side,
    pub zone: Zone,
    /// ID of the primary player involved (scorer, passer, fouler, etc.).
    pub player_id: Option<String>,
    /// ID of a secondary player: the assist provider of a goal, the fouled
    /// player, the player substituted off, the man a cross is aimed at and the
    /// keeper who made a save.
    pub secondary_player_id: Option<String>,
    /// Optional engine-derived qualifier for richer commentary. `None` for
    /// events that carry no extra colour.
    #[serde(default)]
    pub detail: Option<EventDetail>,
    /// What kind of attempt a shot, a goal or a penalty was. `None` on every
    /// other event, and on events saved before event protocol 2.
    #[serde(default)]
    pub shot_kind: Option<ShotKind>,
    /// The set piece this event is part of: the corner itself, and everything
    /// the corner leads to before the ball is cleared, shot or lost.
    #[serde(default)]
    pub set_piece: Option<SetPiece>,
    /// How a goal was made, decided once by the engine when it is scored, so
    /// the report, the match history and the UI all read the same answer.
    #[serde(default)]
    pub goal_source: Option<GoalSource>,
    /// The lane of the formation slot the acting player stands in, seen from
    /// his side's attacking direction. For display only: the engine does not
    /// read it.
    #[serde(default)]
    pub lane: Option<Lane>,
    /// What the event type alone cannot say: that it came on the break, or
    /// that a sweeper keeper was involved (phase 2, P2.6).
    #[serde(default)]
    pub tactical_context: Option<TacticalContext>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TacticalContext {
    /// Part of an attack on the break, straight after the ball was won.
    Counter,
    /// A sweeper keeper came off his line and won the ball first.
    SweeperKeeperInterception,
    /// A sweeper keeper came off his line and was beaten to it: the shot
    /// that follows is at a goal he has left.
    KeeperOffHisLine,
    /// A wide player beat his man and came inside onto his stronger foot
    /// instead of crossing (phase 2, P3.4).
    CutInside,
    /// A cross along the ground, met by a first-time shot (P3.4).
    LowCross,
    /// A cross played early from the flank, before taking the full back on
    /// (P3.4).
    EarlyCross,
    /// A one-on-one in the space a full back left behind him when he went
    /// up (P3.6). Only the duel's events carry it; the rest of a break keeps
    /// `Counter`.
    FlankExposed,
    /// A build-up lost in the own third: the pass, the interception and the
    /// next action of the side that won the ball (phase 2, GĐ4, P4.1, X67).
    HighTurnover,
}

/// What kind of attempt on goal an event records.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShotKind {
    /// A shot with the feet from inside the box.
    #[default]
    Open,
    /// A header from a won aerial duel.
    Header,
    Penalty,
    /// A shot straight at goal from a free kick (phase 2, P2.4).
    DirectFreeKick,
    /// A shot from outside the box in open play (phase 2, P2.5).
    LongRange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SetPiece {
    Corner,
    FreeKick,
}

/// A third of the pitch's width, from the attacking side's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Lane {
    Left,
    Centre,
    Right,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventType {
    // --- Structural events ---
    KickOff,
    HalfTime,
    SecondHalfStart,
    FullTime,

    // --- Possession & passing ---
    PassCompleted,
    PassIntercepted,

    // --- Attacking ---
    Dribble,
    DribbleTackled,
    Cross,

    // --- Shooting ---
    ShotOnTarget,
    ShotOffTarget,
    ShotBlocked,
    ShotSaved,
    Goal,
    PenaltyAwarded,
    PenaltyGoal,
    PenaltyMiss,
    // Penalty-shootout kicks. Distinct from PenaltyGoal/PenaltyMiss so the
    // shootout never counts toward match goals or player stats.
    ShootoutGoal,
    ShootoutMiss,

    // --- Defending ---
    Tackle,
    Interception,
    Clearance,

    // --- Fouls & discipline ---
    Foul,
    YellowCard,
    RedCard,
    SecondYellow,

    // --- Set pieces ---
    Corner,
    FreeKick,

    // --- Other ---
    Injury,
    GoalKick,
    Substitution,
}

/// Truthful, engine-derived qualifiers used to colour commentary.
/// Every variant carries only values the engine already computes, so prose
/// built from it never claims something that was not simulated.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventDetail {
    Shot { danger: DangerBand },
    Save { quality: SaveQuality },
    Foul { severity: FoulSeverity },
    Goal { context: GoalContext },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DangerBand {
    Speculative,
    Decent,
    BigChance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SaveQuality {
    Routine,
    Strong,
    WorldClass,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FoulSeverity {
    Soft,
    Hard,
    Reckless,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GoalContext {
    Opener,
    Equaliser,
    Extends,
    Consolation,
}

impl MatchEvent {
    pub fn new(minute: u8, event_type: EventType, side: Side, zone: Zone) -> Self {
        Self {
            minute,
            event_type,
            side,
            zone,
            player_id: None,
            secondary_player_id: None,
            detail: None,
            shot_kind: None,
            set_piece: None,
            goal_source: None,
            lane: None,
            tactical_context: None,
        }
    }

    pub fn with_player(mut self, player_id: &str) -> Self {
        self.player_id = Some(player_id.to_string());
        self
    }

    pub fn with_secondary(mut self, player_id: &str) -> Self {
        self.secondary_player_id = Some(player_id.to_string());
        self
    }

    pub fn with_detail(mut self, detail: EventDetail) -> Self {
        self.detail = Some(detail);
        self
    }

    pub fn with_shot_kind(mut self, kind: ShotKind) -> Self {
        self.shot_kind = Some(kind);
        self
    }

    pub fn with_tactical_context(mut self, context: TacticalContext) -> Self {
        self.tactical_context = Some(context);
        self
    }

    pub fn with_set_piece(mut self, set_piece: SetPiece) -> Self {
        self.set_piece = Some(set_piece);
        self
    }

    pub fn is_goal(&self) -> bool {
        matches!(self.event_type, EventType::Goal | EventType::PenaltyGoal)
    }

    /// A shot from open play or a set piece, whatever became of it.
    pub fn is_shot(&self) -> bool {
        matches!(
            self.event_type,
            EventType::Goal
                | EventType::ShotSaved
                | EventType::ShotOffTarget
                | EventType::ShotBlocked
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Side, Zone};

    #[test]
    fn new_event_has_no_detail() {
        let evt = MatchEvent::new(10, EventType::Goal, Side::Home, Zone::AwayBox);
        assert!(evt.detail.is_none());
    }

    #[test]
    fn with_detail_attaches_and_round_trips_through_serde() {
        let evt = MatchEvent::new(10, EventType::Goal, Side::Home, Zone::AwayBox)
            .with_player("p1")
            .with_detail(EventDetail::Goal {
                context: GoalContext::Equaliser,
            });
        let json = serde_json::to_string(&evt).unwrap();
        let back: MatchEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(
            back.detail,
            Some(EventDetail::Goal {
                context: GoalContext::Equaliser
            })
        );
    }
}
