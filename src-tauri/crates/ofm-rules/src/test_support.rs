//! Builders shared by `ofm-rules`' unit tests: the same helper as `ofm_core::test_support`, which
//! a test in another crate cannot reach.

use domain::player::PlayerAttributes;

/// Every attribute at `value`. Enough for any test that needs a player who exists and is not
/// remarkable — squad selection, strength averages.
pub(crate) fn uniform_attributes(value: u8) -> PlayerAttributes {
    PlayerAttributes {
        pace: value,
        stamina: value,
        strength: value,
        agility: value,
        passing: value,
        shooting: value,
        tackling: value,
        dribbling: value,
        defending: value,
        positioning: value,
        vision: value,
        decisions: value,
        composure: value,
        aggression: value,
        teamwork: value,
        leadership: value,
        handling: value,
        reflexes: value,
        aerial: value,
        long_passing: value,
        crossing: value,
        curve: value,
        free_kick: value,
        long_shots: value,
        first_touch: value,
        heading: value,
    }
}
