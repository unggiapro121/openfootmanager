//! The pre-split blends of `passing` and `dribbling` (phase 2, GĐ4, P4.0,
//! decision X64; GĐ4-tech-spec §4.2).
//!
//! The 26-attribute split (GĐ1) narrowed `passing` to short passing and
//! `dribbling` to running with the ball, and the bridge used to hand the
//! engine their old blends in those two fields. The bridge now hands over the
//! raw values, and every rule still tuned on a blend names it here, so that a
//! later package can move one rule at a time to the attributes it really reads
//! without the others counting `long_passing` or `first_touch` twice.
//!
//! The arithmetic is `domain::PlayerAttributes::legacy_blends`, rounding and
//! all, so a real player plays exactly as he did; the bridge's tests hold the
//! two to the same values.

/// `round(Σ value · weight)`, kept to 1–99 like every attribute.
fn blend(parts: &[(u8, f64)]) -> u8 {
    let value: f64 = parts.iter().map(|&(v, w)| f64::from(v) * w).sum();
    value.round().clamp(1.0, 99.0) as u8
}

/// The old `passing`: short and long passing, crossing and curve. A player
/// whose split attributes are undeclared (0) keeps his `passing` as it is.
pub fn legacy_passing(passing: u8, long_passing: u8, crossing: u8, curve: u8) -> u8 {
    if long_passing == 0 || crossing == 0 || curve == 0 {
        return passing;
    }
    blend(&[
        (passing, 0.45),
        (long_passing, 0.30),
        (crossing, 0.15),
        (curve, 0.10),
    ])
}

/// The old `dribbling`: running with the ball and first touch. A player with
/// no declared `first_touch` keeps his `dribbling` as it is.
pub fn legacy_dribbling(dribbling: u8, first_touch: u8) -> u8 {
    if first_touch == 0 {
        return dribbling;
    }
    blend(&[(dribbling, 0.5), (first_touch, 0.5)])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given a passer's four passing attributes,
    /// when the old blend is read,
    /// then it is their weighted sum, rounded.
    #[test]
    fn the_passing_blend_weighs_short_long_crossing_and_curve() {
        assert_eq!(legacy_passing(70, 60, 50, 40), 61);
        assert_eq!(legacy_passing(73, 60, 50, 40), 62);
    }

    /// Given a player whose split attributes were never declared,
    /// when the old blends are read,
    /// then he keeps the values he has.
    #[test]
    fn an_undeclared_split_leaves_the_field_as_it_is() {
        assert_eq!(legacy_passing(70, 0, 50, 40), 70);
        assert_eq!(legacy_passing(70, 60, 0, 40), 70);
        assert_eq!(legacy_passing(70, 60, 50, 0), 70);
        assert_eq!(legacy_dribbling(75, 0), 75);
    }

    /// Given a dribbler's running and first touch,
    /// when the old blend is read,
    /// then it is their mean, a half rounding up.
    #[test]
    fn the_dribbling_blend_is_the_mean_of_running_and_first_touch() {
        assert_eq!(legacy_dribbling(75, 70), 73);
        assert_eq!(legacy_dribbling(80, 60), 70);
    }
}
