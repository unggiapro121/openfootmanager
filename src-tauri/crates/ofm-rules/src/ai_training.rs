//! AI-only daily training policy.
//!
//! Applies automated training focus and intensity decisions to all non-user teams
//! each non-match training day, BEFORE `training::process_training` runs.
//!
//! Every reading here is taken across the eleven best available players rather
//! than the whole squad. A squad mean is the average of a group most of whom are
//! not going to play: a first eleven worn down to 50 sitting behind eleven
//! untouched reserves reads as a comfortable 75, and the planner answers by
//! putting that same eleven through a hard session. See
//! [`likely_starters_condition`].
//!
//! Algorithm:
//! 1. Skip the user-controlled team entirely.
//! 2. Skip if today is a rest day for that team's schedule.
//! 3. If the likely starters' condition < 10 → Recovery focus + Low intensity (no cycle advance).
//! 4. Otherwise compute intensity from that same reading's band (Low/Medium/High).
//! 5. Apply near-match / congestion downgrade where applicable.
//! 6. Pick focus from the style-biased 5-slot weekly cycle (indexed by weekday % 5).
//! 7. Force Recovery focus when final intensity is Low (fatigue band or downgraded).
//! 8. Force Tactical focus when congested but intensity is still Medium.
//! 9. V1 safety rule: Physical + High → downgrade intensity to Medium.

use domain::player::Player;
use domain::team::{PlayStyle, TrainingFocus, TrainingIntensity};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

// All three are read against `likely_starters_condition`, not the squad mean.
//
// `HIGH_INTENSITY_MIN` is, in effect, where a club settles: above it the planner
// works the squad hard, below it eases off, so the eleven hover at the band's
// edge. It used to be 70, and a club's best eleven arrived at matches at about
// 73 on a normal week. That was worse than the number suggests, because the
// taper before a match only steps a session down one level: from Medium it
// reaches Low, which is a Recovery session and gives condition back, but from
// High it only reaches Medium, which still costs. A club that lives in the High
// band never gets a real run-in to a match.
//
// 85 is the lowest edge at which every settled week of a one-fixture season
// clears 80 (readiness probe, physio 60: worst week 86.9, against 70.8 at 70
// and 79.9 at 80). The cost is development: High is where a session builds
// the most, and a club at this setpoint spends more of its week on Medium —
// which is where the player's own club sits by default.

/// Below this starters' condition: full recovery day (no cycle advance).
pub const RECOVERY_CRISIS_THRESHOLD: f64 = 10.0;
/// Below this starters' condition: Low intensity band.
pub const LOW_INTENSITY_MAX: f64 = 40.0;
/// Above this starters' condition: High intensity band (40–85 inclusive is Medium).
pub const HIGH_INTENSITY_MIN: f64 = 85.0;

// ---------------------------------------------------------------------------
// Style-biased weekly cycle
// ---------------------------------------------------------------------------

/// Returns a 5-slot weekly focus cycle for the given play style.
///
/// Indexed by `weekday_num % 5`:
///   0 = Mon slot, 1 = Tue slot, 2 = Wed slot, 3 = Thu slot, 4 = Fri slot.
///   With modulo-5 indexing, Saturday (`weekday_num = 5`) wraps to slot 0
///   (the Monday slot), so the 5-slot cycle repeats Monday-Friday.
///
/// Balanced uses one of each focus.
/// Every other style has 3 slots for its biased focus (2 extras vs the base).
pub fn style_weekly_cycle(play_style: &PlayStyle) -> [TrainingFocus; 5] {
    match play_style {
        PlayStyle::Balanced => [
            TrainingFocus::Physical,
            TrainingFocus::Technical,
            TrainingFocus::Tactical,
            TrainingFocus::Defending,
            TrainingFocus::Attacking,
        ],
        PlayStyle::Attacking => [
            TrainingFocus::Physical,
            TrainingFocus::Technical,
            TrainingFocus::Attacking,
            TrainingFocus::Attacking,
            TrainingFocus::Attacking,
        ],
        PlayStyle::Defensive => [
            TrainingFocus::Physical,
            TrainingFocus::Technical,
            TrainingFocus::Defending,
            TrainingFocus::Defending,
            TrainingFocus::Defending,
        ],
        PlayStyle::Possession => [
            TrainingFocus::Physical,
            TrainingFocus::Technical,
            TrainingFocus::Tactical,
            TrainingFocus::Tactical,
            TrainingFocus::Tactical,
        ],
        PlayStyle::HighPress => [
            TrainingFocus::Physical,
            TrainingFocus::Physical,
            TrainingFocus::Physical,
            TrainingFocus::Technical,
            TrainingFocus::Tactical,
        ],
        PlayStyle::Counter => [
            TrainingFocus::Physical,
            TrainingFocus::Technical,
            TrainingFocus::Technical,
            TrainingFocus::Technical,
            TrainingFocus::Tactical,
        ],
    }
}

// ---------------------------------------------------------------------------
// What the manager reads, and what he sets
// ---------------------------------------------------------------------------

/// Average condition of the eleven this club would pick if nobody were tired.
///
/// This is the number the intensity bands are computed from, and it is
/// deliberately *not* the squad average. A squad average is dominated by
/// whoever is not playing: a first eleven ground down to 50 sitting behind
/// eleven untouched reserves reads as a comfortable 75, so the planner sees
/// room to work and puts the same exhausted eleven through a High session. The
/// gap between the two numbers is not small — over a simulated season an AI
/// squad averages around 71 while its best eleven arrive at matches in the
/// high 40s.
///
/// It is also deliberately not the side the lineup picker would actually name.
/// That side is rotation-adjusted: the tired stars have been left out of it, so
/// reading it would launder the fatigue back out of the signal exactly the way
/// a fresh bench launders it out of the squad mean. The question worth asking
/// is "what condition are this club's best players in", and the answer has to
/// stay uncomfortable while they are tired.
///
/// Injured players are excluded — they are not candidates for anything, and
/// their condition is being managed by the treatment room rather than by the
/// training ground. The eleven is the selector's own condition-free first choice
/// through the club's formation, not "the eleven best-rated": a generated squad
/// carries two keepers, a keeper's rating ignores every outfield attribute, and
/// the spare one — who never plays, so is always fresh — would otherwise count
/// as a starter. A club with nothing to read is reported fully fit rather than
/// in crisis: there is nobody for a lighter session to protect.
///
/// `available` is the club's fit players, `formation` its shape.
pub fn likely_starters_condition(available: &[&Player], formation: &str) -> f64 {
    let eleven = crate::squad::first_choice_eleven(available, formation);
    if eleven.is_empty() {
        return 100.0;
    }
    eleven.iter().map(|p| f64::from(p.condition)).sum::<f64>() / eleven.len() as f64
}

/// The focus and intensity an AI club sets for a training day, from its style, how fresh its
/// best eleven is (`starters_condition`, see [`likely_starters_condition`]) and the weekday
/// (0 = Monday).
pub fn session_plan(
    play_style: &PlayStyle,
    starters_condition: f64,
    weekday_num: u32,
) -> (TrainingFocus, TrainingIntensity) {
    // Recovery crisis: full recovery day, cycle does NOT advance.
    if starters_condition < RECOVERY_CRISIS_THRESHOLD {
        return (TrainingFocus::Recovery, TrainingIntensity::Low);
    }

    // Base intensity from condition band.
    let intensity = if starters_condition < LOW_INTENSITY_MAX {
        TrainingIntensity::Low
    } else if starters_condition <= HIGH_INTENSITY_MIN {
        TrainingIntensity::Medium
    } else {
        TrainingIntensity::High
    };

    // The near-match / congestion taper used to live here. It now lives in
    // the caller's calendar reading (`ofm_core::training::tapering_teams`), which
    // applies it to every club — the human's included — because reducing load
    // before a game is a property of training, not a manager's insight. What stays
    // here is what a manager genuinely decides: how hard to work when there is room
    // to, and on what.

    focus_for(play_style, intensity, weekday_num)
}

/// The focus a planned `intensity` trains on, and the intensity after the safety rule: a Low day
/// is a recovery day, otherwise the style's weekly cycle; Physical never goes High.
fn focus_for(
    play_style: &PlayStyle,
    intensity: TrainingIntensity,
    weekday_num: u32,
) -> (TrainingFocus, TrainingIntensity) {
    // Style-biased weekly cycle; slot is based on weekday mod 5.
    let cycle = style_weekly_cycle(play_style);
    let slot = (weekday_num as usize) % 5;
    let rotation_focus = cycle[slot].clone();

    // Focus override based on effective intensity.
    let focus = match &intensity {
        // Low intensity band (a tired squad) → recovery-first.
        TrainingIntensity::Low => TrainingFocus::Recovery,
        // Healthy band → follow style-biased rotation.
        _ => rotation_focus,
    };

    // V1 safety rule: Physical + High is the most punishing combination.
    let intensity = if focus == TrainingFocus::Physical && intensity == TrainingIntensity::High {
        TrainingIntensity::Medium
    } else {
        intensity
    };
    (focus, intensity)
}

/// How an online bot trains (phase 4, S-34 S34-6, S34-15), a season's ruleset: harder than the
/// game's AI, since a bot's squad is refreshed every season and has no human to rest it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BotTrainingRules {
    /// The likely starters' condition from which a bot trains High; under it, Medium.
    pub high_from_condition: u8,
    /// Whether each of a bot's players trains his own best focus outside recovery days (the
    /// server sets the plan's `auto_focus`; S34-16).
    pub auto_focus: bool,
}

impl Default for BotTrainingRules {
    /// The values of S-34 S34-7.
    fn default() -> Self {
        Self {
            high_from_condition: 60,
            auto_focus: true,
        }
    }
}

/// The focus and intensity an online bot sets for a training day (S34-6): Recovery only in a
/// crisis, as [`session_plan`]; otherwise Medium under `high_from_condition` and High from it,
/// on its style's weekly cycle.
pub fn bot_session_plan(
    play_style: &PlayStyle,
    starters_condition: f64,
    weekday_num: u32,
    rules: &BotTrainingRules,
) -> (TrainingFocus, TrainingIntensity) {
    if starters_condition < RECOVERY_CRISIS_THRESHOLD {
        return (TrainingFocus::Recovery, TrainingIntensity::Low);
    }
    let intensity = if starters_condition < f64::from(rules.high_from_condition) {
        TrainingIntensity::Medium
    } else {
        TrainingIntensity::High
    };
    focus_for(play_style, intensity, weekday_num)
}

/// [`plan_session`] for an online bot, by [`bot_session_plan`].
pub fn online_bot_session(
    team: &mut domain::team::Team,
    available: &[&Player],
    weekday_num: u32,
    rules: &BotTrainingRules,
) {
    if !team.training_schedule.is_training_day(weekday_num) {
        return;
    }
    let starters_condition = likely_starters_condition(available, &team.formation);
    let (focus, intensity) =
        bot_session_plan(&team.play_style, starters_condition, weekday_num, rules);
    team.training_focus = focus;
    team.training_intensity = intensity;
}

/// `team`'s focus and intensity set for today's session by the AI's plan, when today is one of
/// its training days (phase 3, E3-7: the game's AI clubs and the online world's bot clubs plan
/// alike). `available` is the squad fit to play; a rest day leaves the club as it is.
pub fn plan_session(team: &mut domain::team::Team, available: &[&Player], weekday_num: u32) {
    if !team.training_schedule.is_training_day(weekday_num) {
        return;
    }
    let starters_condition = likely_starters_condition(available, &team.formation);
    let (focus, intensity) = session_plan(&team.play_style, starters_condition, weekday_num);
    team.training_focus = focus;
    team.training_intensity = intensity;
}

#[cfg(test)]
mod tests {
    use domain::team::{Team, TrainingSchedule};

    use super::*;

    fn club() -> Team {
        let mut team = Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        );
        team.training_schedule = TrainingSchedule::Light;
        team.training_focus = TrainingFocus::Attacking;
        team
    }

    /// Given the bot rules (High from 60) and a balanced club,
    /// when it plans at starters' condition 5, 35, 59 and 60,
    /// then 5 is a recovery day, 35 and 59 train Medium and 60 trains High, each but the first on
    /// the style's cycle, and Physical never trains High.
    #[test]
    fn a_bot_trains_medium_under_its_threshold_and_high_from_it() {
        let rules = BotTrainingRules::default();
        let style = PlayStyle::Balanced;
        assert_eq!(
            bot_session_plan(&style, 5.0, 1, &rules),
            (TrainingFocus::Recovery, TrainingIntensity::Low)
        );
        for weekday in 0..5 {
            let cycle_focus = style_weekly_cycle(&style)[weekday as usize % 5].clone();
            for (condition, intensity) in [
                (35.0, TrainingIntensity::Medium),
                (59.0, TrainingIntensity::Medium),
                (60.0, TrainingIntensity::High),
            ] {
                let (focus, planned) = bot_session_plan(&style, condition, weekday, &rules);
                assert_eq!(focus, cycle_focus);
                let expected = if focus == TrainingFocus::Physical {
                    TrainingIntensity::Medium
                } else {
                    intensity
                };
                assert_eq!(
                    planned, expected,
                    "condition {condition}, weekday {weekday}"
                );
            }
        }
    }

    /// Given a bot on the light schedule and an empty squad (read as fully fit),
    /// when it plans Monday and Tuesday,
    /// then Monday leaves its settings and Tuesday trains High on the cycle.
    #[test]
    fn a_bot_plans_only_its_training_days() {
        let rules = BotTrainingRules::default();
        let mut team = club();
        online_bot_session(&mut team, &[], 0, &rules);
        assert_eq!(team.training_focus, TrainingFocus::Attacking);
        online_bot_session(&mut team, &[], 1, &rules);
        assert_eq!(
            (team.training_focus, team.training_intensity),
            bot_session_plan(&team.play_style, 100.0, 1, &rules)
        );
    }

    /// Given the bot rules,
    /// when they travel as JSON,
    /// then they read back the same in camelCase and refuse an unknown field.
    #[test]
    fn the_bot_training_rules_travel_as_camel_case_json() {
        let rules = BotTrainingRules::default();
        let json = serde_json::to_string(&rules).expect("json");
        assert_eq!(json, r#"{"highFromCondition":60,"autoFocus":true}"#);
        assert_eq!(
            serde_json::from_str::<BotTrainingRules>(&json).ok(),
            Some(rules)
        );
        assert!(
            serde_json::from_str::<BotTrainingRules>(
                r#"{"highFromCondition":60,"autoFocus":true,"x":1}"#
            )
            .is_err()
        );
    }

    /// Given a club on the light schedule (Tuesday and Thursday) and an empty squad,
    /// when it plans Monday and Tuesday,
    /// then Monday leaves its settings and Tuesday takes the AI's plan for the day.
    #[test]
    fn a_club_plans_only_its_training_days() {
        let mut team = club();
        plan_session(&mut team, &[], 0);
        assert_eq!(team.training_focus, TrainingFocus::Attacking);
        plan_session(&mut team, &[], 1);
        let (focus, intensity) = session_plan(&team.play_style, 100.0, 1);
        assert_eq!(
            (team.training_focus, team.training_intensity),
            (focus, intensity)
        );
    }
}
