//! Who held a side, over a match (phase 3, S-8 S8-10): the online server gives a coach XP for a
//! match only when the coach directed it, not when the AI played it for them.

use engine::Side;

use super::input::{Controller, InputRecord, MatchInput};

/// The share of the match's `steps` steps that `side` played under a manager, 0.0–1.0, read from
/// the log alone. Both sides start with the AI; an input logged at `step_seq` j sits in the gap
/// after step j, so a change of control logged there holds from step j + 1.
pub fn control_share(log: &[InputRecord], side: Side, steps: u32) -> f64 {
    if steps == 0 {
        return 0.0;
    }
    let mut controller = Controller::Ai;
    let mut held_since = 1;
    let mut managed = 0;
    for record in log.iter().filter(|record| record.side == side) {
        let MatchInput::ControlHandover(next) = record.input else {
            continue;
        };
        let from = record.step_seq.saturating_add(1).min(steps + 1);
        if controller == Controller::Manager {
            managed += from.saturating_sub(held_since);
        }
        controller = next;
        held_since = from;
    }
    if controller == Controller::Manager {
        managed += (steps + 1).saturating_sub(held_since);
    }
    f64::from(managed) / f64::from(steps)
}

#[cfg(test)]
mod tests {
    use engine::Side;

    use super::super::input::{Controller, InputRecord, InputSource, MatchInput};
    use super::control_share;

    fn handover(step_seq: u32, side: Side, to: Controller) -> InputRecord {
        InputRecord {
            step_seq,
            order_in_gap: 0,
            side,
            source: InputSource::System,
            input: MatchInput::ControlHandover(to),
        }
    }

    /// Given a log with no change of control,
    /// when the share of a side is read,
    /// then it is 0: the AI played it all.
    #[test]
    fn a_side_never_handed_over_was_the_ais() {
        assert_eq!(control_share(&[], Side::Home, 100), 0.0);
    }

    /// Given a manager handed the side before kick-off (step 0),
    /// when the share is read,
    /// then it is the whole match.
    #[test]
    fn a_side_handed_over_before_kick_off_is_all_the_managers() {
        let log = [handover(0, Side::Home, Controller::Manager)];
        assert_eq!(control_share(&log, Side::Home, 100), 1.0);
        assert_eq!(control_share(&log, Side::Away, 100), 0.0);
    }

    /// Given a manager who takes the side after step 20 and loses it after step 70,
    /// when the share of 100 steps is read,
    /// then it is the 50 steps from 21 to 70.
    #[test]
    fn the_steps_between_two_handovers_count() {
        let log = [
            handover(20, Side::Away, Controller::Manager),
            handover(70, Side::Away, Controller::Ai),
        ];
        assert_eq!(control_share(&log, Side::Away, 100), 0.5);
    }

    /// Given a match of no steps,
    /// when the share is read,
    /// then it is 0, not a division by zero.
    #[test]
    fn a_match_of_no_steps_has_no_share() {
        let log = [handover(0, Side::Home, Controller::Manager)];
        assert_eq!(control_share(&log, Side::Home, 0), 0.0);
    }
}
