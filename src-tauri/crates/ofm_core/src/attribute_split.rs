//! Splitting the four blended attributes into the 26-attribute set.
//!
//! Before phase 2 a player had one `passing` (short and long passing, crossing
//! and curve together), one `shooting` (with long shots), one `dribbling` (with
//! ball control) and one `aerial` (with heading technique). A package, a world
//! file or a generator that still speaks that language leaves the seven split
//! attributes at 0. This derives them, and moves the old field to its new,
//! narrower meaning, so that `PlayerAttributes::legacy_blends` gives back the
//! number the player had before. Every rule still tuned on the blends therefore
//! sees the same player; only the detail underneath is new.
//!
//! Each split attribute sits at the old blend plus a per-position offset: the
//! mean of (split attribute − old blend) over the EA FC 25 dataset, measured by
//! `fm-document/comon/scripts/gd1-split-offsets.py`. A centre-back's crossing
//! lands twelve points under his old passing, a full-back's three over.

use domain::player::{PlayerAttributes, Position};

/// Offsets for one position, in points: long passing, crossing, curve, free
/// kicks (all against old passing), long shots (against old shooting), first
/// touch (against old dribbling), heading (against old aerial).
#[derive(Clone, Copy)]
struct Offsets {
    long_passing: i16,
    crossing: i16,
    curve: i16,
    free_kick: i16,
    long_shots: i16,
    first_touch: i16,
    heading: i16,
}

const fn offsets(o: [i16; 7]) -> Offsets {
    Offsets {
        long_passing: o[0],
        crossing: o[1],
        curve: o[2],
        free_kick: o[3],
        long_shots: o[4],
        first_touch: o[5],
        heading: o[6],
    }
}

// FC 25, by best position (gd1-split-offsets.txt).
const GK: Offsets = offsets([37, -11, -11, -11, 2, 3, -47]);
const CB: Offsets = offsets([1, -12, -15, -20, 2, 4, -5]);
const FB: Offsets = offsets([-3, 3, -5, -15, 2, 0, -5]);
const WB: Offsets = offsets([-4, 3, -5, -17, 2, 0, -6]);
const DM: Offsets = offsets([2, -10, -11, -14, 4, 2, -5]);
const CM: Offsets = offsets([1, -8, -8, -12, 4, 1, -5]);
const AM: Offsets = offsets([-1, -6, -4, -9, 1, 0, -4]);
const WM: Offsets = offsets([-3, 1, -2, -9, -1, -1, -6]);
const W: Offsets = offsets([-5, 2, 1, -6, 0, -1, -6]);
const ST: Offsets = offsets([-6, -6, -1, -7, -3, 1, -4]);
// The same, pooled by group, for a player whose exact position is not known yet.
const DEF: Offsets = offsets([-1, -6, -11, -18, 2, 2, -5]);
const MID: Offsets = offsets([-1, -5, -5, -10, 2, 0, -5]);
const FWD: Offsets = offsets([-6, -5, -1, -7, -2, 0, -4]);

fn offsets_for(position: &Position) -> Offsets {
    match position {
        Position::Goalkeeper => GK,
        Position::CenterBack => CB,
        Position::RightBack | Position::LeftBack => FB,
        Position::RightWingBack | Position::LeftWingBack => WB,
        Position::DefensiveMidfielder => DM,
        Position::CentralMidfielder => CM,
        Position::AttackingMidfielder => AM,
        Position::RightMidfielder | Position::LeftMidfielder => WM,
        Position::RightWinger | Position::LeftWinger => W,
        Position::Striker => ST,
        Position::Defender => DEF,
        Position::Midfielder => MID,
        Position::Forward => FWD,
    }
}

fn shifted(base: u8, offset: i16) -> u8 {
    (i16::from(base) + offset).clamp(1, 99) as u8
}

/// The offset scales tried in turn. Near either end of the scale the narrowed
/// field cannot give way far enough (a keeper with passing 12 cannot have long
/// passing 49 and still blend back to 12), so the offsets shrink towards 0,
/// where every member equals the old blend and the fit is exact.
const OFFSET_SCALES: [f64; 5] = [1.0, 0.75, 0.5, 0.25, 0.0];

fn scaled(offset: i16, scale: f64) -> i16 {
    (f64::from(offset) * scale).round() as i16
}

/// The narrowed field that makes `target` blend back, given what the split
/// members contribute and the narrowed field's own weight. `None` when it
/// would fall outside 1–99.
fn narrowed(target: u8, others: f64, own_weight: f64) -> Option<u8> {
    let value = ((f64::from(target) - others) / own_weight).round();
    (1.0..=99.0).contains(&value).then_some(value as u8)
}

/// Nudge `field` by one point at a time until the family's blend reads
/// `target` again: rounding and the 1–99 clamp can leave it a point off.
fn settle(
    attrs: &mut PlayerAttributes,
    is_gk: bool,
    target: u8,
    read: fn(&PlayerAttributes, bool) -> u8,
    field: fn(&mut PlayerAttributes) -> &mut u8,
) {
    for _ in 0..4 {
        let now = read(attrs, is_gk);
        if now == target {
            return;
        }
        let slot = field(attrs);
        *slot = if now < target {
            slot.saturating_add(1).min(99)
        } else {
            slot.saturating_sub(1).max(1)
        };
    }
}

/// Derive whichever of the seven split attributes are still 0 from the old
/// blend they came out of, for a player at `position`. A family already
/// declared (a package built with the split attributes) is left exactly as is.
pub fn split_legacy_attributes(attrs: &mut PlayerAttributes, position: &Position) {
    let o = offsets_for(position);
    let is_gk = matches!(position, Position::Goalkeeper);

    if attrs.free_kick == 0 {
        // Free kicks never fed a blend, so nothing has to give way for them.
        // Read before passing is narrowed below.
        attrs.free_kick = shifted(attrs.passing, o.free_kick);
    }

    if attrs.long_passing == 0 && attrs.crossing == 0 && attrs.curve == 0 {
        let p = attrs.passing;
        for scale in OFFSET_SCALES {
            let long_passing = shifted(p, scaled(o.long_passing, scale));
            let crossing = shifted(p, scaled(o.crossing, scale));
            let curve = shifted(p, scaled(o.curve, scale));
            let others = 0.30 * f64::from(long_passing)
                + 0.15 * f64::from(crossing)
                + 0.10 * f64::from(curve);
            if let Some(passing) = narrowed(p, others, 0.45) {
                (
                    attrs.long_passing,
                    attrs.crossing,
                    attrs.curve,
                    attrs.passing,
                ) = (long_passing, crossing, curve, passing);
                break;
            }
        }
        settle(
            attrs,
            is_gk,
            p,
            |a, gk| a.legacy_blends(gk).passing,
            |a| &mut a.passing,
        );
    }

    if attrs.long_shots == 0 {
        let s = attrs.shooting;
        for scale in OFFSET_SCALES {
            let long_shots = shifted(s, scaled(o.long_shots, scale));
            if let Some(shooting) = narrowed(s, 0.2 * f64::from(long_shots), 0.8) {
                (attrs.long_shots, attrs.shooting) = (long_shots, shooting);
                break;
            }
        }
        settle(
            attrs,
            is_gk,
            s,
            |a, gk| a.legacy_blends(gk).shooting,
            |a| &mut a.shooting,
        );
    }

    if attrs.first_touch == 0 {
        let d = attrs.dribbling;
        for scale in OFFSET_SCALES {
            let first_touch = shifted(d, scaled(o.first_touch, scale));
            if let Some(dribbling) = narrowed(d, 0.5 * f64::from(first_touch), 0.5) {
                (attrs.first_touch, attrs.dribbling) = (first_touch, dribbling);
                break;
            }
        }
        settle(
            attrs,
            is_gk,
            d,
            |a, gk| a.legacy_blends(gk).dribbling,
            |a| &mut a.dribbling,
        );
    }

    if attrs.heading == 0 {
        let a = attrs.aerial;
        if is_gk {
            // A keeper's aerial was always his own claiming; only an
            // outfielder's mixed in heading, so a keeper's stays whole.
            attrs.heading = shifted(a, o.heading);
        } else {
            for scale in OFFSET_SCALES {
                let heading = shifted(a, scaled(o.heading, scale));
                if let Some(aerial) = narrowed(a, 0.5 * f64::from(heading), 0.5) {
                    (attrs.heading, attrs.aerial) = (heading, aerial);
                    break;
                }
            }
            settle(
                attrs,
                is_gk,
                a,
                |x, gk| x.legacy_blends(gk).aerial,
                |x| &mut x.aerial,
            );
        }
    }
}

/// One of the four pre-split blends.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Blend {
    Passing,
    Shooting,
    Dribbling,
    Aerial,
}

fn raise(value: &mut u8, delta: u8) -> u8 {
    let before = *value;
    *value = value.saturating_add(delta).min(99);
    *value - before
}

/// Raise a blend's field and every split attribute that came out of it by
/// `delta`, so a rule written for the blend (aging, loan growth) moves the blend
/// by the same amount it always did. Split attributes still at 0 (undeclared)
/// stay 0, and a keeper's heading never fed his aerial. Returns the points the
/// blend's own field gained, which is what such rules count.
pub fn raise_blend(
    attrs: &mut PlayerAttributes,
    blend: Blend,
    delta: u8,
    is_goalkeeper: bool,
) -> u8 {
    let raise_split = |value: &mut u8| {
        if *value != 0 {
            raise(value, delta);
        }
    };
    match blend {
        Blend::Passing => {
            raise_split(&mut attrs.long_passing);
            raise_split(&mut attrs.crossing);
            raise_split(&mut attrs.curve);
            raise(&mut attrs.passing, delta)
        }
        Blend::Shooting => {
            raise_split(&mut attrs.long_shots);
            raise(&mut attrs.shooting, delta)
        }
        Blend::Dribbling => {
            raise_split(&mut attrs.first_touch);
            raise(&mut attrs.dribbling, delta)
        }
        Blend::Aerial => {
            if !is_goalkeeper {
                raise_split(&mut attrs.heading);
            }
            raise(&mut attrs.aerial, delta)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::uniform_attributes;

    const POSITIONS: [Position; 17] = [
        Position::Goalkeeper,
        Position::Defender,
        Position::Midfielder,
        Position::Forward,
        Position::RightBack,
        Position::CenterBack,
        Position::LeftBack,
        Position::RightWingBack,
        Position::LeftWingBack,
        Position::DefensiveMidfielder,
        Position::CentralMidfielder,
        Position::AttackingMidfielder,
        Position::RightMidfielder,
        Position::LeftMidfielder,
        Position::RightWinger,
        Position::LeftWinger,
        Position::Striker,
    ];

    /// A player from before the split: the four blends set, the seven split
    /// attributes still undeclared.
    fn legacy(passing: u8, shooting: u8, dribbling: u8, aerial: u8) -> PlayerAttributes {
        let mut attrs = uniform_attributes(60);
        (
            attrs.long_passing,
            attrs.crossing,
            attrs.curve,
            attrs.free_kick,
        ) = (0, 0, 0, 0);
        (attrs.long_shots, attrs.first_touch, attrs.heading) = (0, 0, 0);
        attrs.passing = passing;
        attrs.shooting = shooting;
        attrs.dribbling = dribbling;
        attrs.aerial = aerial;
        attrs
    }

    /// Given pre-split attributes across a wide range, at every position,
    /// when they are split,
    /// then the legacy blends read back exactly the values they started from.
    #[test]
    fn splitting_keeps_every_legacy_blend() {
        for position in &POSITIONS {
            for base in [12u8, 30, 45, 58, 66, 74, 83, 91, 98] {
                let before = legacy(
                    base,
                    base.saturating_sub(7).max(1),
                    (base + 3).min(99),
                    base,
                );
                let mut after = before.clone();
                split_legacy_attributes(&mut after, position);
                let is_gk = matches!(position, Position::Goalkeeper);
                assert_eq!(
                    after.legacy_blends(is_gk),
                    before.legacy_blends(is_gk),
                    "{position:?} at {base}"
                );
            }
        }
    }

    /// Given varied pre-split attributes at every position,
    /// when they are split,
    /// then the overall rating at that position is exactly what it was: the
    /// split changes the data, not the player.
    #[test]
    fn splitting_keeps_the_overall_rating() {
        for position in &POSITIONS {
            for (i, base) in [35u8, 52, 61, 68, 77, 86].into_iter().enumerate() {
                let mut before = legacy(base, base + 4, base.saturating_sub(6), base + 2);
                before.vision = 50 + 7 * i as u8;
                before.pace = 90 - 6 * i as u8;
                let mut after = before.clone();
                split_legacy_attributes(&mut after, position);
                assert_eq!(
                    crate::player_rating::ovr_from_attributes(&after, position),
                    crate::player_rating::ovr_from_attributes(&before, position),
                    "{position:?} at {base}"
                );
            }
        }
    }

    /// Given the same old passing for a centre-back and a full-back,
    /// when both are split,
    /// then the centre-back crosses worse and the full-back better, as in the data.
    #[test]
    fn the_split_follows_the_position_profile() {
        let mut centre_back = legacy(70, 50, 60, 70);
        let mut full_back = legacy(70, 50, 60, 70);
        split_legacy_attributes(&mut centre_back, &Position::CenterBack);
        split_legacy_attributes(&mut full_back, &Position::LeftBack);
        assert_eq!(centre_back.crossing, 58);
        assert_eq!(full_back.crossing, 73);
        assert!(centre_back.free_kick < full_back.free_kick);
    }

    /// Given attributes that already carry the split values,
    /// when the split runs,
    /// then nothing changes: a package built with 26 attributes is read as is.
    #[test]
    fn declared_attributes_are_left_alone() {
        let mut attrs = uniform_attributes(70);
        attrs.long_passing = 61;
        attrs.crossing = 62;
        attrs.curve = 63;
        attrs.free_kick = 64;
        attrs.long_shots = 65;
        attrs.first_touch = 66;
        attrs.heading = 67;
        let before = attrs.clone();
        split_legacy_attributes(&mut attrs, &Position::CentralMidfielder);
        assert_eq!(format!("{attrs:?}"), format!("{before:?}"));
    }

    /// Given a keeper,
    /// when he is split,
    /// then his aerial (claiming) is untouched and heading is set apart from it.
    #[test]
    fn a_keepers_aerial_is_not_narrowed() {
        let mut keeper = legacy(40, 25, 30, 80);
        split_legacy_attributes(&mut keeper, &Position::Goalkeeper);
        assert_eq!(keeper.aerial, 80);
        assert_eq!(keeper.heading, 33);
        assert!(keeper.long_passing > keeper.passing);
    }

    /// Given split attributes,
    /// when a blend is raised by a point,
    /// then the legacy blend rises by exactly that point.
    #[test]
    fn raising_a_blend_moves_it_by_the_same_amount() {
        let mut attrs = legacy(66, 62, 70, 68);
        split_legacy_attributes(&mut attrs, &Position::CentralMidfielder);
        let before = attrs.legacy_blends(false);
        for blend in [
            Blend::Passing,
            Blend::Shooting,
            Blend::Dribbling,
            Blend::Aerial,
        ] {
            assert_eq!(raise_blend(&mut attrs, blend, 1, false), 1);
        }
        let after = attrs.legacy_blends(false);
        assert_eq!(
            (after.passing, after.shooting, after.dribbling, after.aerial),
            (
                before.passing + 1,
                before.shooting + 1,
                before.dribbling + 1,
                before.aerial + 1
            )
        );
    }

    /// Given pre-split attributes (the seven still 0),
    /// when a blend is raised,
    /// then the split attributes stay 0: raising never declares them.
    #[test]
    fn raising_leaves_undeclared_split_attributes_at_zero() {
        let mut attrs = legacy(66, 62, 70, 68);
        raise_blend(&mut attrs, Blend::Passing, 2, false);
        assert_eq!(
            (attrs.passing, attrs.long_passing, attrs.crossing),
            (68, 0, 0)
        );
    }

    /// Given split attributes,
    /// when the split runs again,
    /// then it is a no-op: the seven are no longer 0.
    #[test]
    fn splitting_twice_changes_nothing() {
        let mut attrs = legacy(70, 64, 68, 72);
        split_legacy_attributes(&mut attrs, &Position::Striker);
        let once = attrs.clone();
        split_legacy_attributes(&mut attrs, &Position::Striker);
        assert_eq!(format!("{attrs:?}"), format!("{once:?}"));
    }
}
