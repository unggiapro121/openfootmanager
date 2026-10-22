//! Replay (phase 3, E3-4; online-match-engine-formulas.md §5.2): a match rebuilt from its setup and
//! its input log, with no AI run, for checking a stored match and for a runner taking one over.
//! The AI's commands are in the log; its streams are positioned by step, so a match replayed to
//! step N and then played on is the match that was never interrupted.

use super::input::{InputRecord, MatchInput};
use super::session::{MatchSession, MatchSetup, StepRecord};

/// Upper bound on steps a replay takes, as for any match (about 100 in regulation time).
const MAX_STEPS: u32 = 200;

/// Why a log could not be replayed onto a setup. Any of these means the log is not this match's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplayError {
    /// The line at `index` is not where the log's order says it should be: a step before the one
    /// already reached, or a place in its gap that skips or repeats one.
    OutOfOrder { index: usize },
    /// The line at `index` was refused by the check or the engine, or hands a side to whoever
    /// already holds it; `reason` is the refusal's key.
    InputRefused { index: usize, reason: String },
    /// The line at `index` comes after a step this replay did not reach: past the final whistle,
    /// or past the step it was asked to stop at.
    BeyondTheMatch { index: usize },
    /// The match after step `step_seq` is not the match that was stored.
    HashMismatch {
        step_seq: u32,
        expected: u64,
        actual: u64,
    },
}

impl MatchSession {
    /// The match of `setup` rebuilt from `log` up to step `through` (to the final whistle when
    /// `None`), applying every logged input in its gap and running no AI. The session comes back
    /// ready to play on, with the log it was given, and every step it replayed.
    pub fn replay(
        setup: MatchSetup,
        log: &[InputRecord],
        through: Option<u32>,
    ) -> Result<(MatchSession, Vec<StepRecord>), ReplayError> {
        let mut session = MatchSession::kick_off(setup);
        let mut next = session.apply_gap_from(log, 0, 0)?;
        let mut steps = Vec::new();
        while !session.is_finished()
            && through.is_none_or(|last| session.step_seq() < last)
            && session.step_seq() < MAX_STEPS
        {
            let step = session.step_engine();
            next = session.apply_gap_from(log, next, step.step_seq)?;
            steps.push(step);
        }
        if next < log.len() {
            return Err(ReplayError::BeyondTheMatch { index: next });
        }
        Ok((session, steps))
    }

    /// Apply the inputs of `log` from `start` that belong to the gap after step `step_seq`;
    /// returns where the next gap's inputs start.
    fn apply_gap_from(
        &mut self,
        log: &[InputRecord],
        start: usize,
        step_seq: u32,
    ) -> Result<usize, ReplayError> {
        let mut index = start;
        while let Some(record) = log.get(index) {
            if record.step_seq > step_seq {
                break;
            }
            let in_place = record.step_seq == step_seq
                && usize::try_from(record.order_in_gap).ok() == Some(self.gap_len());
            if !in_place {
                return Err(ReplayError::OutOfOrder { index });
            }
            let applied = match &record.input {
                MatchInput::Command(command) => {
                    self.command(record.side, record.source, command.clone())
                }
                MatchInput::ControlHandover(controller) => {
                    if self.controller(record.side) == *controller {
                        Err("a handover to the controller already holding the side".to_string())
                    } else {
                        self.set_controller(record.side, *controller);
                        Ok(())
                    }
                }
            };
            applied.map_err(|reason| ReplayError::InputRefused { index, reason })?;
            index += 1;
        }
        Ok(index)
    }
}

/// Replay the whole match of `setup` from `log` and check each step against `stored`, the
/// `(step_seq, minute_hash)` pairs kept when it was played. Every stored step must be reached and
/// match; the replayed steps come back.
pub fn verify(
    setup: MatchSetup,
    log: &[InputRecord],
    stored: &[(u32, u64)],
) -> Result<Vec<StepRecord>, ReplayError> {
    let through = stored.iter().map(|(step_seq, _)| *step_seq).max();
    let (_, steps) = MatchSession::replay(setup, log, through)?;
    for (step_seq, expected) in stored {
        let actual = steps
            .iter()
            .find(|step| step.step_seq == *step_seq)
            .map_or(0, |step| step.minute_hash);
        if actual != *expected {
            return Err(ReplayError::HashMismatch {
                step_seq: *step_seq,
                expected: *expected,
                actual,
            });
        }
    }
    Ok(steps)
}
