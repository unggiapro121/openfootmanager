//! The calibration knobs of phase 2's GĐ5 (P5.0, decision X82;
//! GĐ5-tech-spec §4.4, §13).
//!
//! Every constant GĐ5 is allowed to tune lives here, with its current value
//! as the default, so a sweep can try values without a rebuild: sim-bench
//! and the real-world probes read a JSON file named by `OFM_KNOBS`
//! ([`apply_knob_file`]). The game never reads it — it plays
//! `MatchConfig::default()`, whose knobs are these defaults. A value chosen
//! at the end of a package is written back here as the new default.
//!
//! `MatchConfig` already carries three knobs of its own (`home_advantage`,
//! `shot_accuracy_base`, `goal_conversion_base`); a knob file may set them
//! too.

use serde::{Deserialize, Serialize};

use crate::types::MatchConfig;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CalibrationKnobs {
    /// How often a defence that wins the ball in its own third goes direct
    /// (GĐ4 X77, `live_match/transition.rs`).
    pub p_direct_base: f64,
    /// How often a ball won from the other side's build-up stays in their
    /// third for the winner, before the winner's press scales it (GĐ5 P5.2,
    /// X84, `live_match/zone_resolution.rs`): the rest is played in midfield.
    pub p_high_turnover: f64,
    /// The second ball's anchor: 1 splits it evenly between equal sides
    /// (GĐ4 X71, `duel.rs`).
    pub anchor_second_ball: f64,
    /// The aerial anchor at corners and long balls (GĐ2 P2.2), and after an
    /// open-play cross (GĐ3 P3.5).
    pub anchor_aerial: f64,
    pub anchor_aerial_open_play_cross: f64,
    /// How often a one-on-one cleared goes behind for a corner (GĐ2).
    pub corner_from_cleared_duel: f64,
    /// A header's base chance of beating the keeper (GĐ2 P2.2,
    /// `live_match/header.rs`).
    pub header_conversion_base: f64,
    /// How often a wide man who beats his man and does not cut inside
    /// crosses (GĐ3 P3.4, `live_match/wing_play.rs`).
    pub p_cross_flank: f64,
    /// How often an average delivery reaches the contest: an open-play cross
    /// (GĐ3 X54) and a corner or wide free kick (GĐ2 P2.3).
    pub open_play_cross_reach: f64,
    pub set_piece_reach: f64,
    /// How often a foul in the centre of the attacking third is shot at goal
    /// (GĐ3 P3.4), and how often the wall blocks it (GĐ2 P2.4).
    pub p_dfk_centre: f64,
    pub wall_block: f64,
    /// Shots from distance (GĐ2 P2.5, GĐ3): the trigger's base and its
    /// penalty from a flank, the chance on target and the chance it goes in.
    pub long_shot_base: f64,
    pub long_shot_flank_penalty: f64,
    pub long_shot_on_target_base: f64,
    pub long_shot_goal_base: f64,
    /// The trigger's slope in `long_shots` and the habit's bonus (GĐ5 P5.3,
    /// approved 2026-10-18): the share of shots from distance should not
    /// follow a league's quality.
    pub long_shot_slope: f64,
    pub long_shot_habit_bonus: f64,
    /// Who finishes in the box (GĐ5 P5.3b, approved 2026-10-18): how far ω
    /// above 1 is kept (1 = the table as written, 0 = every forward alike;
    /// ω at or below 1 never moves), and the weight of the man who carried
    /// the ball in (`live_match/finishing.rs`).
    pub shot_weight_spread: f64,
    pub last_actor_weight: f64,
    /// The one-on-one in the attacking third: its two sensitivities and its
    /// anchor (GĐ0, GĐ3 X49; X12 / X85).
    pub gamma_one_v_one_technical: f64,
    pub gamma_one_v_one_physical: f64,
    pub anchor_one_v_one: f64,
    /// A patient side's hold on the ball in the end-of-minute contest
    /// (GĐ0, `shared.rs::tactics_tempo_retention`).
    pub tempo_retention_patient: f64,
    /// How sharply the end-of-minute contest for the ball follows the two
    /// midfields: the side on the ball keeps it with `a^k / (a^k + d^k)`.
    /// 1 is the plain ratio; above 1 the stronger midfield holds the ball
    /// more, which widens possession's spread across matches (GĐ5 P5.4, T16).
    pub possession_contest_sharpness: f64,
    /// A defensive line's effect on the chances it concedes (GĐ2,
    /// `shared.rs::tactics_defensive_conversion_mod`): high and very low.
    pub conversion_high_line: f64,
    pub conversion_very_low_line: f64,
}

impl Default for CalibrationKnobs {
    /// The game's values: each the named constant beside its mechanism, with
    /// the history of how it was set.
    fn default() -> Self {
        use crate::duel;
        use crate::live_match::knob_defaults as live;
        Self {
            p_direct_base: live::P_DIRECT_BASE,
            p_high_turnover: live::P_HIGH_TURNOVER,
            anchor_second_ball: duel::ANCHOR_SECOND_BALL,
            anchor_aerial: duel::ANCHOR_AERIAL,
            anchor_aerial_open_play_cross: duel::ANCHOR_AERIAL_OPEN_PLAY_CROSS,
            corner_from_cleared_duel: live::CORNER_FROM_CLEARED_DUEL,
            header_conversion_base: live::HEADER_CONVERSION_BASE,
            p_cross_flank: live::P_CROSS_FLANK,
            open_play_cross_reach: live::P0_CROSS,
            set_piece_reach: live::SET_PIECE_REACH,
            p_dfk_centre: live::P_DFK_CENTRE,
            wall_block: live::WALL_BLOCK,
            long_shot_base: live::LONG_SHOT_BASE,
            long_shot_flank_penalty: live::LONG_SHOT_FLANK_PENALTY,
            long_shot_on_target_base: live::LONG_SHOT_ON_TARGET_BASE,
            long_shot_goal_base: live::LONG_SHOT_GOAL_BASE,
            long_shot_slope: live::LONG_SHOT_SLOPE,
            long_shot_habit_bonus: live::LONG_SHOT_HABIT_BONUS,
            shot_weight_spread: live::SHOT_WEIGHT_SPREAD,
            last_actor_weight: live::LAST_ACTOR_WEIGHT,
            gamma_one_v_one_technical: duel::GAMMA_ONE_V_ONE_TECHNICAL,
            gamma_one_v_one_physical: duel::GAMMA_ONE_V_ONE_PHYSICAL,
            anchor_one_v_one: duel::ANCHOR_ONE_V_ONE,
            // GĐ0's values, which lived only as literals in `shared.rs`.
            tempo_retention_patient: 1.03,
            // 1.6 from GĐ5 P5.4: a side's possession spread 7.8 points across
            // matches, real football 10.6; 1.6 gives 10.1, the stronger
            // midfield holding the ball more.
            possession_contest_sharpness: 1.6,
            conversion_high_line: 1.12,
            conversion_very_low_line: 0.85,
        }
    }
}

/// The three knobs `MatchConfig` carries itself, as a knob file names them.
#[derive(Debug, Default, Deserialize)]
struct ConfigKnobs {
    home_advantage: Option<f64>,
    shot_accuracy_base: Option<f64>,
    goal_conversion_base: Option<f64>,
}

/// Apply a knob file's JSON to `config`: any knob it names replaces the
/// default, the rest stay. For sim-bench and the probes only; the game never
/// calls this.
pub fn apply_knob_file(config: &mut MatchConfig, json: &str) -> Result<(), String> {
    let mut value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("knob file: {e}"))?;
    let own: ConfigKnobs =
        serde_json::from_value(value.clone()).map_err(|e| format!("knob file: {e}"))?;
    if let Some(v) = own.home_advantage {
        config.home_advantage = v;
    }
    if let Some(v) = own.shot_accuracy_base {
        config.shot_accuracy_base = v;
    }
    if let Some(v) = own.goal_conversion_base {
        config.goal_conversion_base = v;
    }
    let mut knobs = serde_json::to_value(&config.knobs).map_err(|e| e.to_string())?;
    if let (Some(base), Some(over)) = (knobs.as_object_mut(), value.as_object_mut()) {
        for (key, v) in over.iter() {
            if base.contains_key(key) {
                base.insert(key.clone(), v.clone());
            } else if !matches!(
                key.as_str(),
                "home_advantage" | "shot_accuracy_base" | "goal_conversion_base"
            ) {
                return Err(format!("knob file: unknown knob {key}"));
            }
        }
    }
    config.knobs = serde_json::from_value(knobs).map_err(|e| format!("knob file: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given the default match config,
    /// when its knobs are read,
    /// then they are the knobs' defaults: a game plays the tuned constants.
    #[test]
    fn the_default_config_plays_the_default_knobs() {
        assert_eq!(MatchConfig::default().knobs, CalibrationKnobs::default());
    }

    /// Given a knob file naming two knobs and the home advantage,
    /// when it is applied,
    /// then those three change and every other knob keeps its default.
    #[test]
    fn a_knob_file_changes_only_what_it_names() {
        let mut config = MatchConfig::default();
        apply_knob_file(
            &mut config,
            r#"{"p_direct_base": 0.5, "anchor_second_ball": 0.62, "home_advantage": 1.11}"#,
        )
        .expect("a valid file");
        assert_eq!(config.knobs.p_direct_base, 0.5);
        assert_eq!(config.knobs.anchor_second_ball, 0.62);
        assert_eq!(config.home_advantage, 1.11);
        assert_eq!(
            config.knobs.wall_block,
            CalibrationKnobs::default().wall_block
        );
    }

    /// Given a knob file with a misspelt knob,
    /// when it is applied,
    /// then it is refused rather than silently ignored.
    #[test]
    fn a_misspelt_knob_is_refused() {
        let mut config = MatchConfig::default();
        assert!(apply_knob_file(&mut config, r#"{"p_direct_bse": 0.5}"#).is_err());
    }
}
