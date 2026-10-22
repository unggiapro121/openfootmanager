//! What a match the coach managed is worth, and how XP buys mastery of a play style
//! (phase 2 lane M, làn-M-tech-spec §6). Pure: a coach account's rules, run the same by the game
//! and by the online server (phase 3).

use domain::manager::{NEUTRAL_MASTERY, PlayStyleMastery, StyleXp};
use domain::team::PlayStyle;

/// XP a match is worth before its result and opponent are weighed.
const MATCH_BASE_XP: f64 = 10.0;
const WIN_MULTIPLIER: f64 = 1.5;
const DRAW_MULTIPLIER: f64 = 1.0;
const LOSS_MULTIPLIER: f64 = 0.7;
/// Strength points (`S`) of difference that move a match's XP by its whole
/// base: beating a side 10 stronger is worth ×1.25, one 10 weaker ×0.75. At 40
/// every club earns about the same XP a match over a season (analysis F1).
const OPPONENT_STRENGTH_SCALE: f64 = 40.0;
const OPPONENT_MULTIPLIER_MIN: f64 = 0.5;
const OPPONENT_MULTIPLIER_MAX: f64 = 1.5;
/// The two pieces of the cost curve, chosen so that at about 11 XP a match
/// mastery reaches 60 in a season (~51 matches), 80 in ~400 and 99 in ~1,800
/// (Q-M1). They meet at 80, where a point costs 397 XP either side.
const XP_LOW_BASE: f64 = 37.7;
const XP_LOW_RATE: f64 = 0.0785;
const XP_HIGH_BASE: f64 = 397.0;
const XP_HIGH_RATE: f64 = 0.071;
const XP_CURVE_BREAK: u8 = 80;
/// Use takes mastery this far; 100 is only ever rolled for an AI manager.
pub const MASTERY_XP_CAP: u8 = 99;

/// A match's result, from the user's side, as XP weighs it. A shootout does
/// not count: a tie level after extra time is a draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchOutcome {
    Won,
    Drawn,
    Lost,
}

/// XP it costs to raise `mastery` by one point. A mastery below neutral costs
/// as neutral does.
pub fn xp_to_next(mastery: u8) -> u32 {
    let mastery = f64::from(mastery.max(NEUTRAL_MASTERY));
    let cost = if mastery < f64::from(XP_CURVE_BREAK) {
        XP_LOW_BASE * (XP_LOW_RATE * (mastery - f64::from(NEUTRAL_MASTERY))).exp()
    } else {
        XP_HIGH_BASE * (XP_HIGH_RATE * (mastery - f64::from(XP_CURVE_BREAK))).exp()
    };
    cost.round() as u32
}

/// XP a match the user managed is worth.
pub fn match_xp(outcome: MatchOutcome, own_strength: f64, opponent_strength: f64) -> u32 {
    let result = match outcome {
        MatchOutcome::Won => WIN_MULTIPLIER,
        MatchOutcome::Drawn => DRAW_MULTIPLIER,
        MatchOutcome::Lost => LOSS_MULTIPLIER,
    };
    let opponent = (1.0 + (opponent_strength - own_strength) / OPPONENT_STRENGTH_SCALE)
        .clamp(OPPONENT_MULTIPLIER_MIN, OPPONENT_MULTIPLIER_MAX);
    (MATCH_BASE_XP * result * opponent).round() as u32
}

/// Bank `xp` in `style` and raise its mastery a point at a time while the bank
/// covers the next point, up to the cap. Returns the mastery before and after.
/// The mastery and XP are a coach account's (`coach_progress`): a career only
/// carries a copy of them (`apply_coach_progress`).
pub fn bank_style_xp(
    mastery: &mut PlayStyleMastery,
    style_xp: &mut StyleXp,
    style: &PlayStyle,
    xp: u32,
) -> (u8, u8) {
    let before = mastery.for_style(style);
    let progress = style_xp.for_style_mut(style);
    progress.xp = progress.xp.saturating_add(xp);

    let mut level = before;
    while level < MASTERY_XP_CAP && progress.xp >= xp_to_next(level) {
        progress.xp -= xp_to_next(level);
        level += 1;
    }
    mastery.set(style, level);
    (before, level)
}

/// What a match the user managed did for their mastery of the style their
/// side started it in.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MasteryGain {
    pub style: PlayStyle,
    pub xp: u32,
    pub mastery_before: u8,
    pub mastery_after: u8,
}
