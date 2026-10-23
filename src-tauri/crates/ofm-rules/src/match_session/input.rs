//! The input log of a match (online-match-engine-formulas.md §5.2): every command applied to it,
//! the AI's included, and every change of who holds a side. With the seed and the lineups at
//! kick-off, it is all a replay needs.

use engine::{MatchCommand, Side};
use serde::{Deserialize, Serialize};

/// Who gave an input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub enum InputSource {
    /// The side's manager, a person.
    Manager,
    /// The side's AI, holding it for nobody or for an absent manager.
    Ai,
    /// The match itself: the club's saved set-piece takers before kick-off, a change of control.
    System,
}

/// Who holds a side: issues its commands between steps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub enum Controller {
    Manager,
    Ai,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub enum MatchInput {
    Command(MatchCommand),
    /// The side passed to this controller. Shown and checked; it never moves a replay, which
    /// applies the logged commands and runs no AI.
    ControlHandover(Controller),
}

/// One line of the log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub struct InputRecord {
    /// The step the input came after; 0 is before the first step (the kick-off).
    pub step_seq: u32,
    /// Its place among the inputs of that gap, from 0.
    pub order_in_gap: u32,
    pub side: Side,
    pub source: InputSource,
    pub input: MatchInput,
}
