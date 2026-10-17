mod finishing;
mod flanks;
mod header;
mod helpers;
mod lane_state;
mod lanes;
mod long_ball;
mod long_shot;
mod observation;
mod penalty;
mod presence;
mod roles;
mod second_ball;
mod set_pieces;
mod simulation;
mod snapshot;
mod substitution;
#[cfg(test)]
mod test_support;
mod transition;
mod wing_play;
mod zone_resolution;

pub use long_shot::long_shot_norm;

use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

use crate::rating::{RosterEntry, rate_players};

pub use finishing::shot_weight;
pub(crate) use observation::AiObservation;

use crate::event::{MatchEvent, SetPiece};
use crate::report::{MatchReport, TeamSheet};
use crate::types::{
    MatchConfig, PlayStyle, PlayerData, PlayerRole, Side, TacticalDial, TeamData, Zone,
};

// ---------------------------------------------------------------------------
// MatchPhase — tracks where we are in the match lifecycle
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchPhase {
    PreKickOff,
    FirstHalf,
    HalfTime,
    SecondHalf,
    FullTime,
    ExtraTimeFirstHalf,
    ExtraTimeHalfTime,
    ExtraTimeSecondHalf,
    ExtraTimeEnd,
    PenaltyShootout,
    Finished,
}

// ---------------------------------------------------------------------------
// MatchCommand — actions injected by user or AI between minutes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MatchCommand {
    Substitute {
        side: Side,
        player_off_id: String,
        player_on_id: String,
    },
    ChangeFormation {
        side: Side,
        formation: String,
    },
    ChangePlayStyle {
        side: Side,
        play_style: PlayStyle,
    },
    SetFreeKickTaker {
        side: Side,
        player_id: String,
    },
    SetCornerTaker {
        side: Side,
        player_id: String,
    },
    SetPenaltyTaker {
        side: Side,
        player_id: String,
    },
    SetCaptain {
        side: Side,
        player_id: String,
    },
    PreMatchSwap {
        side: Side,
        player_off_id: String,
        player_on_id: String,
    },
    /// Two starters trade formation slots before kick-off.
    PreMatchSwapPositions {
        side: Side,
        player_a_id: String,
        player_b_id: String,
    },
    /// Two players in the XI trade formation slots at any point of the match.
    /// Not a substitution and not limited. Either may be a sent-off player:
    /// that is how a side down to ten moves its gap to the line it can best
    /// spare.
    SwapPositions {
        side: Side,
        player_a_id: String,
        player_b_id: String,
    },
    ChangePlayerRole {
        side: Side,
        player_id: String,
        role: PlayerRole,
    },
    /// Turn one of the nine tactical dials, leaving the other eight alone.
    ChangeTacticalDial {
        side: Side,
        dial: TacticalDial,
    },
}

// ---------------------------------------------------------------------------
// SubstitutionRecord — tracks a substitution that was made
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubstitutionRecord {
    pub minute: u8,
    pub side: Side,
    pub player_off_id: String,
    pub player_on_id: String,
}

// ---------------------------------------------------------------------------
// SetPieceTakers — designated set piece takers for a side
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SetPieceTakers {
    pub free_kick_taker: Option<String>,
    pub corner_taker: Option<String>,
    pub penalty_taker: Option<String>,
    pub captain: Option<String>,
}

// ---------------------------------------------------------------------------
// MinuteResult — what happened during one simulated minute
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinuteResult {
    pub minute: u8,
    pub phase: MatchPhase,
    pub events: Vec<MatchEvent>,
    pub home_score: u8,
    pub away_score: u8,
    pub possession: Side,
    pub ball_zone: Zone,
    pub is_finished: bool,
}

// ---------------------------------------------------------------------------
// MatchSnapshot — full read-only view of the match for the UI
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchSnapshot {
    pub phase: MatchPhase,
    pub current_minute: u8,
    pub home_score: u8,
    pub away_score: u8,
    pub possession: Side,
    pub ball_zone: Zone,
    /// The ball's lane as the side in possession sees it (phase 2, P3.7);
    /// `None` in a snapshot saved before lanes existed.
    #[serde(default)]
    pub ball_lane: Option<crate::event::Lane>,
    pub home_team: TeamData,
    pub away_team: TeamData,
    pub home_bench: Vec<PlayerData>,
    pub away_bench: Vec<PlayerData>,
    pub home_possession_pct: f64,
    pub away_possession_pct: f64,
    pub events: Vec<MatchEvent>,
    pub home_subs_made: u8,
    pub away_subs_made: u8,
    pub max_subs: u8,
    pub home_set_pieces: SetPieceTakers,
    pub away_set_pieces: SetPieceTakers,
    pub substitutions: Vec<SubstitutionRecord>,
    pub allows_extra_time: bool,
    pub home_yellows: HashMap<String, u8>,
    pub away_yellows: HashMap<String, u8>,
    pub sent_off: HashSet<String>,
    /// Players hurt this match and still on the pitch: they take no further
    /// part, but unlike the sent-off they can be replaced.
    #[serde(default)]
    pub injured: HashSet<String>,
    pub penalty_shootout: Option<PenaltyShootoutSnapshot>,
    /// The event protocol `events` follow (`report::EVENT_PROTOCOL_VERSION`).
    #[serde(default = "crate::report::first_event_protocol")]
    pub protocol_version: u8,
}

// ---------------------------------------------------------------------------
// PenaltyShootoutSnapshot — public snapshot of shootout progress for the UI
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PenaltyShootoutSnapshot {
    pub home_taken: u8,
    pub away_taken: u8,
    pub home_scored: u8,
    pub away_scored: u8,
    pub sudden_death: bool,
}

// ---------------------------------------------------------------------------
// PenaltyShootoutState — tracks penalty shootout progress
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
struct PenaltyShootoutState {
    round: u8,
    home_taken: u8,
    away_taken: u8,
    home_scored: u8,
    away_scored: u8,
    sudden_death: bool,
}

// ---------------------------------------------------------------------------
// LiveMatchState — the core step-by-step simulation engine
// ---------------------------------------------------------------------------

pub struct LiveMatchState {
    // Teams (owned — subs mutate the player list)
    home: TeamData,
    away: TeamData,
    config: MatchConfig,

    // Match progress
    phase: MatchPhase,
    current_minute: u8,

    // Score
    home_score: u8,
    away_score: u8,

    // Field state
    ball_zone: Zone,
    possession: Side,

    // Events log
    events: Vec<MatchEvent>,

    // Possession tracking
    home_possession_ticks: u32,
    away_possession_ticks: u32,

    // Discipline
    yellows: HashMap<String, u8>,
    sent_off: HashSet<String>,
    /// Hurt and still on the pitch; see [`LiveMatchState::out_of_play`].
    injured: HashSet<String>,

    // Substitutions
    home_subs_made: u8,
    away_subs_made: u8,
    max_subs: u8,
    substitutions: Vec<SubstitutionRecord>,

    // Bench players (available for substitution)
    home_bench: Vec<PlayerData>,
    away_bench: Vec<PlayerData>,

    /// Both sides as they kicked off, taken when the match starts so that the
    /// report names who started rather than who finished.
    kickoff_sheets: Option<(TeamSheet, TeamSheet)>,

    // Set piece takers
    home_set_pieces: SetPieceTakers,
    away_set_pieces: SetPieceTakers,

    // Extra time / knockout
    allows_extra_time: bool,

    // Stoppage time (pre-computed when each half starts)
    first_half_stoppage: u8,
    second_half_stoppage: u8,
    et_first_half_stoppage: u8,
    et_second_half_stoppage: u8,
    /// The minute the period being played kicked off. The clock runs on through
    /// stoppage, so a period's end is measured from here rather than from a
    /// fixed minute: see `check_phase_end`.
    period_started_at: u8,

    // Per-minute stamina depletion tracking (player_id → current effective condition)
    player_conditions: HashMap<String, f64>,

    // Penalty shootout state
    penalty_state: PenaltyShootoutState,

    // Rolling window of the last 10 ball_zone values (oldest first)
    recent_zones: VecDeque<Zone>,

    /// The side that has just broken away with the ball: its next action, if
    /// it still has the ball in its attacking third, is on the break.
    on_the_break: Option<Side>,
    /// Whether the action being resolved is on the break. `emit` tags every
    /// event of it as a counter.
    active_break: bool,
    /// The set piece being played out (a corner, from the kick to the header
    /// or the clearance). `emit` tags every event with it.
    active_set_piece: Option<SetPiece>,
    /// The minute each side's full back left each flank open, from that
    /// side's own view: [side][left, right] (P3.6).
    flank_exposed: [[Option<u8>; 2]; 2],
    /// The side that had the last action, so a side regaining the ball gets
    /// its full backs back in place (P3.6).
    last_on_the_ball: Option<Side>,
    /// A break into an open flank, waiting for its one-on-one (P3.6).
    pending_exploit: Option<flanks::PendingExploit>,
    /// What the action being played out is (a cut inside, an early cross;
    /// phase 2, P3.4): `emit` tags each event that carries no context of its
    /// own, after a break's `Counter`.
    active_context: Option<crate::event::TacticalContext>,

    // Phase 2, GĐ3: the ball's lane and what the grid's rules read
    // (`lane_state`).
    /// The ball's lane, stored from the home side's direction; read it with
    /// `lane_for`.
    ball_side: lane_state::BallSide,
    /// The lane, as the attacking side saw it, the ball last came into the
    /// box from. Written from P3.1; the shooter's weight reads it at P3.5.
    entry_lane: Option<crate::event::Lane>,
    /// Who acted last, with his side: only ever read for the side that has
    /// the ball, so no change of possession has to clear it. Written from
    /// P3.1; `LastActor` reads it at P3.5.
    last_actor: Option<(Side, String)>,
    /// The side counter-pressing the build-up the other side is about to
    /// play, having just lost the ball in its attack (phase 2, GĐ4, P4.1,
    /// X77). Only that first build-up feels it.
    counter_pressing: Option<Side>,
    /// What the next action of a side still in its attacking third is: a
    /// high turnover after winning the ball in the other side's build-up
    /// (P4.1, X67), a long ball brought down (P4.2).
    pending_context: Option<(Side, crate::event::TacticalContext)>,
}

impl LiveMatchState {
    /// Create a new live match. `starting_xi` are already in `home.players` / `away.players`.
    /// Bench players are separate and available for substitution.
    pub fn new(
        mut home: TeamData,
        mut away: TeamData,
        config: MatchConfig,
        mut home_bench: Vec<PlayerData>,
        mut away_bench: Vec<PlayerData>,
        allows_extra_time: bool,
    ) -> Self {
        for player in home
            .players
            .iter_mut()
            .chain(away.players.iter_mut())
            .chain(home_bench.iter_mut())
            .chain(away_bench.iter_mut())
        {
            player.declare_split_attributes();
        }

        // Initialize player conditions from their condition attribute
        let mut player_conditions = HashMap::new();
        for p in home.players.iter().chain(away.players.iter()) {
            player_conditions.insert(p.id.clone(), p.condition as f64);
        }

        Self {
            home,
            away,
            config,
            phase: MatchPhase::PreKickOff,
            kickoff_sheets: None,
            current_minute: 0,
            home_score: 0,
            away_score: 0,
            ball_zone: Zone::Midfield,
            possession: Side::Home,
            events: Vec::with_capacity(300),
            home_possession_ticks: 0,
            away_possession_ticks: 0,
            yellows: HashMap::new(),
            sent_off: HashSet::new(),
            injured: HashSet::new(),
            home_subs_made: 0,
            away_subs_made: 0,
            max_subs: 5,
            substitutions: Vec::new(),
            home_bench,
            away_bench,
            home_set_pieces: SetPieceTakers::default(),
            away_set_pieces: SetPieceTakers::default(),
            allows_extra_time,
            first_half_stoppage: 0,
            second_half_stoppage: 0,
            et_first_half_stoppage: 0,
            et_second_half_stoppage: 0,
            period_started_at: 0,
            player_conditions,
            penalty_state: PenaltyShootoutState::default(),
            recent_zones: VecDeque::with_capacity(10),
            active_set_piece: None,
            active_context: None,
            flank_exposed: [[None, None], [None, None]],
            last_on_the_ball: None,
            pending_exploit: None,
            on_the_break: None,
            active_break: false,
            ball_side: lane_state::BallSide::centre(),
            entry_lane: None,
            last_actor: None,
            counter_pressing: None,
            pending_context: None,
        }
    }

    /// Step one minute forward. Returns the events that occurred.
    pub fn step_minute<R: Rng>(&mut self, rng: &mut R) -> MinuteResult {
        match self.phase {
            MatchPhase::PreKickOff => self.start_match(rng),
            MatchPhase::FirstHalf => self.play_minute(rng),
            MatchPhase::HalfTime => self.start_second_half(rng),
            MatchPhase::SecondHalf => self.play_minute(rng),
            MatchPhase::FullTime => self.handle_full_time(rng),
            MatchPhase::ExtraTimeFirstHalf => self.play_minute(rng),
            MatchPhase::ExtraTimeHalfTime => self.start_et_second_half(rng),
            MatchPhase::ExtraTimeSecondHalf => self.play_minute(rng),
            MatchPhase::ExtraTimeEnd => self.handle_et_end(rng),
            MatchPhase::PenaltyShootout => self.play_penalty_round(rng),
            MatchPhase::Finished => self.make_result(true),
        }
    }

    /// Apply a command (substitution, tactic change, set piece assignment).
    pub fn apply_command(&mut self, cmd: MatchCommand) -> Result<(), String> {
        match cmd {
            MatchCommand::Substitute {
                side,
                player_off_id,
                player_on_id,
            } => self.do_substitution(side, &player_off_id, &player_on_id),
            MatchCommand::ChangeFormation { side, formation } => {
                self.apply_formation(side, &formation);
                Ok(())
            }
            MatchCommand::ChangePlayStyle { side, play_style } => {
                self.team_mut(side).play_style = play_style;
                Ok(())
            }
            MatchCommand::SetFreeKickTaker { side, player_id } => {
                self.set_pieces_mut(side).free_kick_taker = Some(player_id);
                Ok(())
            }
            MatchCommand::SetCornerTaker { side, player_id } => {
                self.set_pieces_mut(side).corner_taker = Some(player_id);
                Ok(())
            }
            MatchCommand::SetPenaltyTaker { side, player_id } => {
                self.set_pieces_mut(side).penalty_taker = Some(player_id);
                Ok(())
            }
            MatchCommand::SetCaptain { side, player_id } => {
                self.set_pieces_mut(side).captain = Some(player_id);
                Ok(())
            }
            MatchCommand::PreMatchSwap {
                side,
                player_off_id,
                player_on_id,
            } => {
                if self.phase != MatchPhase::PreKickOff {
                    return Err("be.error.liveMatch.preMatchSwapTooLate".into());
                }
                self.do_pre_match_swap(side, &player_off_id, &player_on_id)
            }
            MatchCommand::PreMatchSwapPositions {
                side,
                player_a_id,
                player_b_id,
            } => {
                if self.phase != MatchPhase::PreKickOff {
                    return Err("be.error.liveMatch.preMatchSwapTooLate".into());
                }
                self.swap_slots(side, &player_a_id, &player_b_id)
            }
            MatchCommand::SwapPositions {
                side,
                player_a_id,
                player_b_id,
            } => self.swap_slots(side, &player_a_id, &player_b_id),
            MatchCommand::ChangeTacticalDial { side, dial } => {
                dial.set_on(&mut self.team_mut(side).tactics);
                Ok(())
            }
            MatchCommand::ChangePlayerRole {
                side,
                player_id,
                role,
            } => {
                let team = self.team_mut(side);
                if let Some(p) = team.players.iter_mut().find(|p| p.id == player_id)
                    && is_role_valid_for_position(role, p.position)
                {
                    p.role = role;
                }
                Ok(())
            }
        }
    }

    /// Convert the finished match into a MatchReport.
    pub fn into_report(self) -> MatchReport {
        let tracked_player_ids = self
            .home
            .players
            .iter()
            .chain(self.away.players.iter())
            .map(|player| player.id.clone())
            .collect();

        // Where each man in either XI ended the match, for the rating's sense
        // of an ordinary game at his position.
        let slots: HashMap<String, crate::pitch_position::PitchPosition> = [&self.home, &self.away]
            .into_iter()
            .flat_map(|team| {
                let layout = crate::pitch_position::formation_slots(&team.formation);
                let filled = layout.len() == team.players.len();
                team.players
                    .iter()
                    .zip(layout)
                    .filter(move |_| filled)
                    .map(|(player, slot)| (player.id.clone(), slot))
            })
            .collect();
        let mut report = MatchReport::from_events_with_players(
            self.events,
            self.home_possession_ticks,
            self.away_possession_ticks,
            self.current_minute,
            tracked_player_ids,
        );
        // The bench is part of the roster: a player substituted off ends the
        // match there, and is rated for the time he played all the same.
        let roster: Vec<RosterEntry<'_>> = self
            .home
            .players
            .iter()
            .chain(self.home_bench.iter())
            .map(|player| RosterEntry::new(player, Side::Home).at(slots.get(&player.id).copied()))
            .chain(
                self.away
                    .players
                    .iter()
                    .chain(self.away_bench.iter())
                    .map(|player| {
                        RosterEntry::new(player, Side::Away).at(slots.get(&player.id).copied())
                    }),
            )
            .collect();
        rate_players(&mut report, &roster);
        if self.penalty_state.home_taken > 0 || self.penalty_state.away_taken > 0 {
            report.home_penalties = Some(self.penalty_state.home_scored);
            report.away_penalties = Some(self.penalty_state.away_scored);
        }
        if let Some((home_sheet, away_sheet)) = self.kickoff_sheets {
            report.home_sheet = Some(home_sheet);
            report.away_sheet = Some(away_sheet);
        }
        report
    }

    /// Is the match finished?
    pub fn is_finished(&self) -> bool {
        self.phase == MatchPhase::Finished
    }

    /// Current phase
    pub fn phase(&self) -> MatchPhase {
        self.phase
    }

    /// Current minute
    pub fn minute(&self) -> u8 {
        self.current_minute
    }

    /// Get the bench for a side
    pub fn bench(&self, side: Side) -> &[PlayerData] {
        match side {
            Side::Home => &self.home_bench,
            Side::Away => &self.away_bench,
        }
    }

    /// Injure a player on the pitch, as a challenge would.
    #[doc(hidden)]
    pub fn test_injure(&mut self, player_id: &str) {
        self.injured.insert(player_id.to_string());
    }

    /// Simulate a red card for a player (adds to sent_off set).
    /// Primarily used for testing substitution guards.
    #[doc(hidden)]
    pub fn test_send_off(&mut self, player_id: &str) {
        self.sent_off.insert(player_id.to_string());
    }

    /// Put a scoreline on the board without playing the match that produced it.
    ///
    /// For tests about what a manager does when he is two down with twenty
    /// minutes left. Reaching that position by simulation would make the test
    /// about the seed rather than about the decision.
    #[doc(hidden)]
    pub fn test_set_score(&mut self, home: u8, away: u8) {
        self.home_score = home;
        self.away_score = away;
    }
}

fn is_role_valid_for_position(role: PlayerRole, position: crate::types::Position) -> bool {
    use crate::types::Position;
    match position {
        Position::Goalkeeper => matches!(
            role,
            PlayerRole::Standard | PlayerRole::BallPlayingKeeper | PlayerRole::SweeperKeeper
        ),
        Position::Defender => matches!(
            role,
            PlayerRole::Standard
                | PlayerRole::Stopper
                | PlayerRole::CoverCB
                | PlayerRole::BallPlayingCB
                | PlayerRole::AttackingFB
                | PlayerRole::DefensiveFB
                | PlayerRole::InvertedFB
                | PlayerRole::WingBack
        ),
        Position::Midfielder => matches!(
            role,
            PlayerRole::Standard
                | PlayerRole::AnchorMan
                | PlayerRole::BallWinner
                | PlayerRole::DeepLyingPlaymaker
                | PlayerRole::BoxToBox
                | PlayerRole::Carrilero
                | PlayerRole::Mezzala
                | PlayerRole::AdvancedPlaymaker
                | PlayerRole::ShadowStriker
                | PlayerRole::WideForward
                | PlayerRole::InsideForward
                | PlayerRole::InvertedWinger
        ),
        // Wingers (LW/RW) play in the Forward bucket, so the wide roles belong
        // here too — as in `domain::Position::Forward.valid_roles()`.
        Position::Forward => matches!(
            role,
            PlayerRole::Standard
                | PlayerRole::WideForward
                | PlayerRole::InsideForward
                | PlayerRole::InvertedWinger
                | PlayerRole::Poacher
                | PlayerRole::TargetMan
                | PlayerRole::DeepLyingForward
                | PlayerRole::False9
                | PlayerRole::PressingForward
                | PlayerRole::CompleteForward
        ),
    }
}
