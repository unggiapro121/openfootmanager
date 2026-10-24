//! One match, kick-off to final whistle, as the game and the online server both play it (phase 3,
//! E3-3; online-match-engine-formulas.md §5–§6):
//!
//! - three generators from one seed, so the AI never moves the engine (`seed`);
//! - a controller per side, a manager or the AI, so two people can meet;
//! - one check every command passes, whoever gives it (`check`);
//! - a log of every input, the AI's included, keyed by step (`input`);
//! - a hash of the match after every step, chained (`minute_hash`);
//! - a replay from the setup and the log, with no AI run (`replay`, E3-4);
//! - who held each side over the match (`control`, S-8).

mod check;
mod control;
mod input;
mod minute_hash;
mod replay;
mod seed;
mod session;

pub use check::{
    COMMANDS_CLOSED, LOCKED_BY_LICENCE, NOT_ON_PITCH, NOT_YOUR_SIDE, ROLE_NOT_FOR_POSITION,
    TOO_MANY_UNDER_PRICED_DIALS, UNKNOWN_FORMATION, check_command,
};
pub use control::control_share;
pub use input::{Controller, InputRecord, InputSource, MatchInput};
pub use replay::{ReplayError, verify};
pub use seed::MatchSeed;
pub use session::{KICK_OFF_HASH, MatchSession, MatchSetup, StepRecord};
