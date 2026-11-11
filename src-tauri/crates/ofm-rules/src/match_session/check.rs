//! The shared command check (online-match-engine-formulas.md §6): what a command must satisfy
//! before the match takes it, on the desktop and on the online server alike. The engine applies
//! whatever it is given; the rules a manager plays by are here, once.

use engine::ai::{MAX_UNDER_PRICED_DIALS, under_priced_dials};
use engine::{
    FORMATIONS, LiveMatchState, MatchCommand, MatchPhase, Side, is_role_valid_for_position,
};

pub const NOT_YOUR_SIDE: &str = "be.error.liveMatch.notYourSide";
pub const COMMANDS_CLOSED: &str = "be.error.liveMatch.commandsClosed";
pub const UNKNOWN_FORMATION: &str = "be.error.liveMatch.unknownFormation";
pub const TOO_MANY_UNDER_PRICED_DIALS: &str = "be.error.liveMatch.tooManyUnderPricedDials";
pub const NOT_ON_PITCH: &str = "be.error.liveMatch.playerNotOnPitch";
pub const ROLE_NOT_FOR_POSITION: &str = "be.error.roleNotValidForPosition";
/// An order the side's licence does not open (phase 3, S-9). The match session refuses it, not
/// [`check_command`]: the licence is the session's, not the match state's.
pub const LOCKED_BY_LICENCE: &str = "be.error.liveMatch.lockedByLicence";

/// Whether a change taking a side from `before` to `after` under-priced dials breaks the ration:
/// more than [`MAX_UNDER_PRICED_DIALS`] and more than before. A side may keep what it holds, or
/// give some back, however many that is; it may not add past the ration. The one formula for a
/// dial turned during a match and for tactics saved before one (E5-16 E516-1).
pub fn ration_refuses(before: usize, after: usize) -> bool {
    after > MAX_UNDER_PRICED_DIALS && after > before
}

/// Whether `issuer`, the side giving `command`, may give it now. `Err` is the translation key of
/// the refusal. The online server adds only "does the caller hold `issuer` at this step".
pub fn check_command(
    state: &LiveMatchState,
    issuer: Side,
    command: &MatchCommand,
) -> Result<(), &'static str> {
    let side = command.side();
    if side != issuer {
        return Err(NOT_YOUR_SIDE);
    }
    if matches!(
        state.phase(),
        MatchPhase::Finished | MatchPhase::PenaltyShootout
    ) {
        return Err(COMMANDS_CLOSED);
    }
    match command {
        MatchCommand::ChangeFormation { formation, .. } => {
            if FORMATIONS.contains(&formation.as_str()) {
                Ok(())
            } else {
                Err(UNKNOWN_FORMATION)
            }
        }
        MatchCommand::ChangeTacticalDial { dial, .. } => {
            let tactics = &state.team(side).tactics;
            let mut turned = tactics.clone();
            dial.set_on(&mut turned);
            if ration_refuses(under_priced_dials(tactics), under_priced_dials(&turned)) {
                Err(TOO_MANY_UNDER_PRICED_DIALS)
            } else {
                Ok(())
            }
        }
        MatchCommand::SetFreeKickTaker { player_id, .. }
        | MatchCommand::SetCornerTaker { player_id, .. }
        | MatchCommand::SetPenaltyTaker { player_id, .. }
        | MatchCommand::SetCaptain { player_id, .. } => on_the_pitch(state, side, player_id),
        MatchCommand::ChangePlayerRole {
            player_id, role, ..
        } => {
            on_the_pitch(state, side, player_id)?;
            let fits = state
                .team(side)
                .players
                .iter()
                .find(|player| player.id == *player_id)
                .is_some_and(|player| is_role_valid_for_position(*role, player.position));
            if fits {
                Ok(())
            } else {
                Err(ROLE_NOT_FOR_POSITION)
            }
        }
        // The engine refuses a substitution or swap that breaks its own limits.
        MatchCommand::Substitute { .. }
        | MatchCommand::ChangePlayStyle { .. }
        | MatchCommand::PreMatchSwap { .. }
        | MatchCommand::PreMatchSwapPositions { .. }
        | MatchCommand::SwapPositions { .. } => Ok(()),
    }
}

fn on_the_pitch(state: &LiveMatchState, side: Side, player_id: &str) -> Result<(), &'static str> {
    let in_the_xi = state
        .team(side)
        .players
        .iter()
        .any(|player| player.id == player_id);
    if in_the_xi && !state.is_sent_off(player_id) {
        Ok(())
    } else {
        Err(NOT_ON_PITCH)
    }
}
