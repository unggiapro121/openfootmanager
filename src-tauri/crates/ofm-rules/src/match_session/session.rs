//! The match session: the engine's state, its three generators, who holds each side, and the log
//! of every input, stepped the way online-match-engine-formulas.md §5.2 fixes. It reads no `Game`:
//! the desktop builds its two sides from the save, the online server from its tables.

use std::collections::BTreeMap;

use engine::ai::{self, AiProfile};
use engine::{
    LiveMatchState, MatchCommand, MatchConfig, MatchEvent, MatchPhase, MatchReport, MatchSnapshot,
    MinuteResult, PlayerData, SetPieceTakers, Side, TeamData,
};
use rand_chacha::ChaCha12Rng;
use serde::{Deserialize, Serialize};

use super::check::{LOCKED_BY_LICENCE, check_command};
use super::input::{Controller, InputRecord, InputSource, MatchInput};
use super::minute_hash::minute_hash;
use super::seed::MatchSeed;
use crate::licence::LicenceControls;

/// Everything about a match fixed when it kicks off: the two sides with their benches, the
/// config, the seed, and the profile each side's AI decides by. Kept as it was at kick-off, it is
/// the starting point of a replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchSetup {
    pub home: TeamData,
    pub away: TeamData,
    pub home_bench: Vec<PlayerData>,
    pub away_bench: Vec<PlayerData>,
    pub config: MatchConfig,
    pub allows_extra_time: bool,
    pub seed: MatchSeed,
    pub ai_home: AiProfile,
    pub ai_away: AiProfile,
    /// Steps a manager has to replace a player of theirs hurt on the pitch before the AI replaces
    /// him (the online injury window, phase 3 S-8 S8-9). `None`, the desktop's, waits for the
    /// manager as long as it takes: the desktop pauses the match.
    #[serde(default)]
    pub injury_window_steps: Option<u32>,
    /// What each side's coach may set (the online licence, phase 3 S-9), kept as the open lists so
    /// a later release that opens more leaves this match as it was. `None`, the desktop's and a
    /// season's without licences, opens everything; it is left out of the stored setup, so a
    /// setup without licences reads and hashes as it did before.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub licence_home: Option<LicenceControls>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub licence_away: Option<LicenceControls>,
    /// The captain and set-piece takers each side kicks off with (its coach's match roles, the
    /// online server's, [`crate::squad::kickoff_set_pieces`]). Part of the kick-off, not inputs:
    /// a replay of the setup starts from them too. `None`, the desktop's (it orders them as system
    /// inputs) and every match stored before them, leaves each duty to the engine's own pick; it is
    /// left out of the stored setup, so such a setup reads and hashes as it did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_pieces_home: Option<SetPieceTakers>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub set_pieces_away: Option<SetPieceTakers>,
    /// Whether a duty passes on when its holder leaves the play
    /// ([`LiveMatchState::set_duties_move_on`]). `false`, every match stored before it, keeps the
    /// engine as it played them; it is left out of the stored setup, so such a setup reads and
    /// hashes as it did.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub duties_move_on: bool,
}

/// Each duty of `takers` named, as the command that sets it: captain, penalties, free kicks,
/// corners.
pub fn taker_commands(side: Side, takers: SetPieceTakers) -> impl Iterator<Item = MatchCommand> {
    [
        takers
            .captain
            .map(|player_id| MatchCommand::SetCaptain { side, player_id }),
        takers
            .penalty_taker
            .map(|player_id| MatchCommand::SetPenaltyTaker { side, player_id }),
        takers
            .free_kick_taker
            .map(|player_id| MatchCommand::SetFreeKickTaker { side, player_id }),
        takers
            .corner_taker
            .map(|player_id| MatchCommand::SetCornerTaker { side, player_id }),
    ]
    .into_iter()
    .flatten()
}

/// One step as it happened: the engine's result, and the minute hash of the match after it.
#[derive(Debug, Clone)]
pub struct StepRecord {
    pub step_seq: u32,
    pub minute_hash: u64,
    pub result: MinuteResult,
}

/// The hash a match starts from, before its first step.
pub const KICK_OFF_HASH: u64 = 0;

pub struct MatchSession {
    state: LiveMatchState,
    seed: MatchSeed,
    engine_rng: ChaCha12Rng,
    ai: [AiProfile; 2],
    licences: [Option<LicenceControls>; 2],
    controllers: [Controller; 2],
    step_seq: u32,
    next_order: u32,
    last_hash: u64,
    log: Vec<InputRecord>,
    /// Where the inputs of the gap under way start in `log`: they go into the next step's hash.
    gap_start: usize,
    injury_window: Option<u32>,
    /// Each player hurt on the pitch, by side index and id, with the step he was first seen hurt
    /// after. Kept by the engine's part of a step, so a replay rebuilds it.
    hurt_since: BTreeMap<(usize, String), u32>,
    /// How many events the match had after the engine's part of the last step: the events after
    /// it are the ones the gap's commands pushed.
    events_after_step: usize,
}

fn index(side: Side) -> usize {
    match side {
        Side::Home => 0,
        Side::Away => 1,
    }
}

impl MatchSession {
    /// A match at kick-off, each side held by the controller given. A side handed to a manager is
    /// logged as a change of control at step 0; both start with the AI.
    pub fn new(setup: MatchSetup, home: Controller, away: Controller) -> Self {
        let mut session = Self::kick_off(setup);
        session.set_controller(Side::Home, home);
        session.set_controller(Side::Away, away);
        session
    }

    /// The match before anything is logged: both sides with the AI.
    pub(super) fn kick_off(setup: MatchSetup) -> Self {
        let mut state = LiveMatchState::new(
            setup.home,
            setup.away,
            setup.config,
            setup.home_bench,
            setup.away_bench,
            setup.allows_extra_time,
        );
        state.set_duties_move_on(setup.duties_move_on);
        for (side, takers) in [
            (Side::Home, setup.set_pieces_home),
            (Side::Away, setup.set_pieces_away),
        ] {
            for command in takers
                .into_iter()
                .flat_map(|takers| taker_commands(side, takers))
            {
                // A duty the shared check refuses (a name not on the pitch) is left to the
                // engine's own pick, as an unset one is.
                if check_command(&state, side, &command).is_err() {
                    continue;
                }
                // The engine never refuses a name; were it to, the duty stays its own pick.
                if let Err(_refused) = state.apply_command(command) {}
            }
        }
        Self {
            state,
            engine_rng: setup.seed.engine_rng(),
            seed: setup.seed,
            ai: [setup.ai_home, setup.ai_away],
            licences: [setup.licence_home, setup.licence_away],
            controllers: [Controller::Ai, Controller::Ai],
            step_seq: 0,
            next_order: 0,
            last_hash: KICK_OFF_HASH,
            log: Vec::new(),
            gap_start: 0,
            injury_window: setup.injury_window_steps,
            hurt_since: BTreeMap::new(),
            events_after_step: 0,
        }
    }

    /// One step: the engine, then the commands of each side the AI holds, home first, then the
    /// AI's replacement of a player a manager left hurt past the injury window. A manager's
    /// commands for the gap that follows come after these.
    pub fn step(&mut self) -> StepRecord {
        let record = self.step_engine();
        if !record.result.is_finished {
            self.run_ai();
            self.close_injury_windows();
        }
        record
    }

    /// The engine's part of a step alone, as a replay runs it: the AI's commands are in the log.
    pub(super) fn step_engine(&mut self) -> StepRecord {
        let result = self.state.step_minute(&mut self.engine_rng);
        self.step_seq += 1;
        self.next_order = 0;
        let inputs_before = &self.log[self.gap_start..];
        self.last_hash = minute_hash(self.last_hash, self.step_seq, inputs_before, &result);
        self.gap_start = self.log.len();
        self.events_after_step = self.state.events().len();
        self.note_the_hurt();
        StepRecord {
            step_seq: self.step_seq,
            minute_hash: self.last_hash,
            result,
        }
    }

    fn run_ai(&mut self) {
        for side in [Side::Home, Side::Away] {
            if self.controllers[index(side)] != Controller::Ai {
                continue;
            }
            let mut rng = self.seed.ai_rng(side, self.step_seq);
            // The AI holding a side gives only the orders that side's licence opens, so it reaches
            // for the next order instead of losing its turn to a refusal (S9-7).
            let licence = self.licences[index(side)].as_ref();
            let allows = |command: &MatchCommand| licence.is_none_or(|l| l.allows_command(command));
            let commands =
                ai::ai_decide_within(&self.state, side, &self.ai[index(side)], &mut rng, &allows);
            for command in commands {
                // A command the rules refuse is dropped and not logged, as the engine always
                // dropped the AI's impossible commands; the refusal is not part of the match.
                if let Err(_refused) = self.command(side, InputSource::Ai, command) {}
            }
        }
    }

    /// Who is hurt on the pitch now, and since when: a player still hurt keeps his first step.
    fn note_the_hurt(&mut self) {
        let mut hurt = BTreeMap::new();
        for side in [Side::Home, Side::Away] {
            for id in self.state.injured_on_pitch(side) {
                let key = (index(side), id);
                let since = self.hurt_since.get(&key).copied().unwrap_or(self.step_seq);
                hurt.insert(key, since);
            }
        }
        self.hurt_since = hurt;
    }

    /// For each side a manager holds, the AI replaces a player hurt on the pitch for the injury
    /// window or longer, as it would for a side it held. Logged as the AI's.
    fn close_injury_windows(&mut self) {
        let Some(window) = self.injury_window else {
            return;
        };
        let playing = matches!(
            self.state.phase(),
            MatchPhase::FirstHalf
                | MatchPhase::SecondHalf
                | MatchPhase::ExtraTimeFirstHalf
                | MatchPhase::ExtraTimeSecondHalf
                | MatchPhase::HalfTime
                | MatchPhase::ExtraTimeHalfTime
        );
        if !playing {
            return;
        }
        let overdue: Vec<(Side, String)> = self
            .hurt_since
            .iter()
            .filter(|(_, since)| self.step_seq.saturating_sub(**since) >= window)
            .map(|((side, id), _)| (if *side == 0 { Side::Home } else { Side::Away }, id.clone()))
            .filter(|(side, _)| self.controllers[index(*side)] == Controller::Manager)
            .collect();
        for (side, id) in overdue {
            if let Some(command) = ai::replacement_for_injured(&self.state, side, &id) {
                // Refused only if the rules changed under it; the side then plays on a man short.
                if let Err(_refused) = self.command(side, InputSource::Ai, command) {}
            }
        }
    }

    /// The events the commands of the gap under way pushed (a substitution's), which the next
    /// step's `MinuteResult` will not carry: the online server sends them with that step.
    pub fn gap_events(&self) -> &[MatchEvent] {
        let events = self.state.events();
        &events[self.events_after_step.min(events.len())..]
    }

    /// Apply `command`, given by `issuer` through `source`, if the shared check and the engine take
    /// it; it is then logged. `Err` is the refusal's translation key, and nothing changed.
    pub fn command(
        &mut self,
        issuer: Side,
        source: InputSource,
        command: MatchCommand,
    ) -> Result<(), String> {
        check_command(&self.state, issuer, &command)?;
        // After the shared check, so an order for the other side or after the whistle is refused
        // for that first. Every source alike: a person, the AI, the system (S9-6).
        if self.licences[index(issuer)]
            .as_ref()
            .is_some_and(|licence| !licence.allows_command(&command))
        {
            return Err(LOCKED_BY_LICENCE.to_string());
        }
        self.state.apply_command(command.clone())?;
        self.record(issuer, source, MatchInput::Command(command));
        Ok(())
    }

    /// Hand `side` to `controller`. A change is logged; handing a side to whoever holds it is not.
    pub fn set_controller(&mut self, side: Side, controller: Controller) {
        if self.controllers[index(side)] == controller {
            return;
        }
        self.controllers[index(side)] = controller;
        self.record(
            side,
            InputSource::System,
            MatchInput::ControlHandover(controller),
        );
    }

    fn record(&mut self, side: Side, source: InputSource, input: MatchInput) {
        self.log.push(InputRecord {
            step_seq: self.step_seq,
            order_in_gap: self.next_order,
            side,
            source,
            input,
        });
        self.next_order += 1;
    }

    /// How many inputs the gap under way holds: the place the next one takes.
    pub(super) fn gap_len(&self) -> usize {
        self.log.len() - self.gap_start
    }

    pub fn controller(&self, side: Side) -> Controller {
        self.controllers[index(side)]
    }

    /// The engine's state, to read.
    pub fn state(&self) -> &LiveMatchState {
        &self.state
    }

    pub fn log(&self) -> &[InputRecord] {
        &self.log
    }

    /// The number of steps taken; the step the next input comes after.
    pub fn step_seq(&self) -> u32 {
        self.step_seq
    }

    /// The minute hash after the last step, [`KICK_OFF_HASH`] before the first.
    pub fn last_hash(&self) -> u64 {
        self.last_hash
    }

    pub fn seed(&self) -> MatchSeed {
        self.seed
    }

    pub fn phase(&self) -> MatchPhase {
        self.state.phase()
    }

    pub fn is_finished(&self) -> bool {
        self.state.is_finished()
    }

    pub fn snapshot(&self) -> MatchSnapshot {
        self.state.snapshot()
    }

    pub fn into_report(self) -> MatchReport {
        self.state.into_report()
    }
}
