//! One training session of one player (phase 3, E3-5b): what it costs him, what it gives back,
//! and what it builds, by the club's plan, its staff and its facilities. Shared with the online
//! server, whose daily job runs it for every club (Q6); `ofm_core::training` runs it for a save.
//! The coaching bonus is read off the club's staff as passed in, the taper off its calendar by
//! the caller. Online, a coach may also press extra sessions on top of the day's (E5-4,
//! `extra_session`): as many as condition allows, each at full cost with nothing given back.

use crate::player_rating::refresh_player_derived;
use domain::player::{Player, PlayerAttributes};
use domain::staff::{CoachingSpecialization, Staff, StaffRole};
use domain::team::{TrainingFocus, TrainingIntensity, TrainingSchedule};
use rand::Rng;
use serde::{Deserialize, Serialize};

/// Computed coaching quality for a team's staff.
pub struct TeamCoachingBonus {
    pub coaching_mult: f64, // Overall coaching quality multiplier (1.0 = no staff)
    pub specialization_mult: f64, // Extra bonus if a coach specializes in the current focus
    pub physio_mult: f64,   // Recovery bonus from physio staff
}

/// What a team's coaches and assistant managers multiply training gains by:
/// 0.8 with none, otherwise 0.85 (coaching 0) to 1.35 (coaching 100) on their
/// average coaching. `staff` is the club's staff, every role.
pub fn coaching_mult(staff: &[&Staff]) -> f64 {
    let coaching: Vec<f64> = staff
        .iter()
        .filter(|s| matches!(s.role, StaffRole::Coach | StaffRole::AssistantManager))
        .map(|s| s.attributes.coaching as f64)
        .collect();
    if coaching.is_empty() {
        return 0.8;
    }
    let avg_coaching = coaching.iter().sum::<f64>() / coaching.len() as f64;
    0.85 + (avg_coaching / 100.0) * 0.5
}

/// How fast a player of `age` improves in training: youngsters fastest,
/// veterans slowest.
pub fn age_factor(age: u32) -> f64 {
    if age <= 21 {
        1.5
    } else if age <= 25 {
        1.2
    } else if age <= 29 {
        1.0
    } else if age <= 33 {
        0.6
    } else {
        0.3
    }
}

/// Compute coaching bonuses from a team's staff (`staff`, every role) for a session of `focus`.
pub fn coaching_bonus(staff: &[&Staff], focus: &TrainingFocus) -> TeamCoachingBonus {
    // Coaches + assistant managers, for the specialist check below.
    let coaching_staff: Vec<_> = staff
        .iter()
        .filter(|s| matches!(s.role, StaffRole::Coach | StaffRole::AssistantManager))
        .collect();

    let coaching_mult = coaching_mult(staff);

    // Check if any coach specializes in the current training focus
    let focus_spec = match focus {
        TrainingFocus::Physical => Some(CoachingSpecialization::Fitness),
        TrainingFocus::Technical => Some(CoachingSpecialization::Technique),
        TrainingFocus::Tactical => Some(CoachingSpecialization::Tactics),
        TrainingFocus::Defending => Some(CoachingSpecialization::Defending),
        TrainingFocus::Attacking => Some(CoachingSpecialization::Attacking),
        TrainingFocus::Recovery => None,
    };

    let specialization_mult = if let Some(target_spec) = focus_spec {
        let has_specialist = coaching_staff
            .iter()
            .any(|s| s.specialization.as_ref() == Some(&target_spec));
        if has_specialist { 1.25 } else { 1.0 }
    } else {
        1.0
    };

    // Physio bonus for recovery
    let physio_staff: Vec<_> = staff
        .iter()
        .filter(|s| matches!(s.role, StaffRole::Physio))
        .collect();

    let physio_mult = if physio_staff.is_empty() {
        1.0
    } else {
        let avg_physio: f64 = physio_staff
            .iter()
            .map(|s| s.attributes.physiotherapy as f64)
            .sum::<f64>()
            / physio_staff.len() as f64;
        // Range: 1.0 (physio=0) to 1.4 (physio=100)
        1.0 + (avg_physio / 100.0) * 0.4
    };

    TeamCoachingBonus {
        coaching_mult,
        specialization_mult,
        physio_mult,
    }
}

/// The day a session is held: which weekday, which year, and the pace players develop at.
pub struct TrainingDay {
    pub weekday_num: u32,
    pub year: u32,
    /// The session's date, "YYYY-MM-DD": players' ages are taken on it.
    pub date: String,
    /// The pace players develop at: the career's development speed (1× to 5×) offline, the
    /// season ruleset's multiplier online (Q5).
    pub development_multiplier: f64,
}

/// Chance per session that one attribute in focus rises by a point, before any
/// multiplier: the realistic 1× pace. At 0.04 a regular starter of 18 at a
/// Balanced, Medium-intensity club gains about +3.5 overall a season, so a
/// prospect reaches his ceiling in his mid-twenties. It was 0.15 — +13 a season,
/// a ceiling reached at 19 — before the pace became a per-career setting
/// (`Game::development_speed`); 3.5× to 4× is roughly that old pace.
pub const BASE_TRAINING_GAIN: f64 = 0.04;

/// Below this individual condition a player is automatically rested in training
/// (treated as Recovery focus) regardless of the team's plan. Team intensity is
/// one setting for the whole squad, but the per-player condition cost is flat —
/// so a player who is individually exhausted in an otherwise-okay squad keeps
/// net-losing condition (cost > their diminished recovery) and never climbs out.
/// This guard breaks that fatigue spiral so a rested bench can recover and the
/// condition-aware lineup picker has someone to rotate to.
///
/// It applies to every club. It used to exempt the user's, on the grounds that a
/// human manager has manual control — but the exemption was the difference
/// between a squad that stabilises and one that reaches condition 2 by week five
/// and stays there, which is not a choice anyone was making knowingly.
pub const FATIGUE_GUARD_CONDITION: u8 = 40;

/// Why a club's sessions are lighter today.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Taper {
    /// A fixture within `MATCH_TAPER_DAYS`: today's session runs one step
    /// lighter than the club's standing intensity.
    NearMatch,
    /// Two or more fixtures inside the coming week: every session is recovery
    /// work. A match costs a starter about 28 condition and a recovery day gives
    /// back about 10; two matches in a week leave no room for training load at
    /// all, and one step down from High is still Medium, which costs more than
    /// it restores. Clubs that trained through a two-match week reached its
    /// second match with squads averaging below 80.
    Congested,
}

/// One step down the intensity ladder.
fn downgrade_intensity(intensity: &TrainingIntensity) -> TrainingIntensity {
    match intensity {
        TrainingIntensity::High => TrainingIntensity::Medium,
        TrainingIntensity::Medium | TrainingIntensity::Low => TrainingIntensity::Low,
    }
}

/// A club's training for the day, gathered before any player is touched.
pub struct TeamTrainingPlan {
    pub default_focus: TrainingFocus,
    pub intensity: TrainingIntensity,
    pub schedule: TrainingSchedule,
    pub bonus: TeamCoachingBonus,
    pub medical_facility_mult: f64,
    /// What the club's training facility adds to every session's gains.
    pub training_facility_mult: f64,
    /// player_id → group focus override (players not in any group use default_focus)
    pub group_overrides: std::collections::HashMap<String, TrainingFocus>,
    /// Why today's session runs at reduced load, if it does.
    pub taper: Option<Taper>,
}

/// `team`'s plan for the day, with its staff `staff` (phase 3, E3-7): the standing focus,
/// intensity and schedule, the coaches' bonus, what its medical and training facilities add, each
/// training group's focus, and the taper the caller decided (the game from its fixture list; the
/// online server passes none, S-7 S7-9).
pub fn team_training_plan(
    team: &domain::team::Team,
    staff: &[&Staff],
    taper: Option<Taper>,
) -> TeamTrainingPlan {
    let mut group_overrides = std::collections::HashMap::new();
    for group in &team.training_groups {
        for player_id in &group.player_ids {
            group_overrides.insert(player_id.clone(), group.focus.clone());
        }
    }
    TeamTrainingPlan {
        default_focus: team.training_focus.clone(),
        intensity: team.training_intensity.clone(),
        schedule: team.training_schedule.clone(),
        bonus: coaching_bonus(staff, &team.training_focus),
        medical_facility_mult: crate::facilities::condition_recovery_mult(team.facilities.medical),
        training_facility_mult: crate::facilities::development_mult(team.facilities.training),
        group_overrides,
        taper,
    }
}

/// The dice of `player_id`'s session on `date` ("YYYY-MM-DD") in a world of `seed`: his own
/// stream, so what he gets from a session never depends on who else trained that day or in which
/// order (E3-5b, E5) — the online server trains clubs in no particular order.
pub fn session_rng(seed: u64, player_id: &str, date: &str) -> rand_chacha::ChaCha12Rng {
    crate::seed::rng_for_seed(seed, &format!("training/{player_id}"), date)
}

/// One session (or rest day) of `player` under `plan` on `day`, drawing from `rng`.
pub fn train_player(
    player: &mut Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    rng: &mut impl Rng,
) {
    let is_training_day = plan.schedule.is_training_day(day.weekday_num);
    train_player_on(player, plan, day, is_training_day, rng);
}

/// How an online day of a season with recovery blocks comes to hold a session (E5-1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    /// A person pressed the button: always a training day, on his plan.
    Manual,
    /// The automatic session (a person's club with `auto` on, or a bot): the weekly schedule
    /// decides, exactly as `train_player`.
    Scheduled,
    /// A day with no session: a rest day's recovery, nothing built.
    Rest,
}

/// `player`'s online day of `kind` under `plan` on `day` (E5-1): the game's own session or rest
/// day, so a pressed session costs, recovers and builds what a scheduled one does. The rest of the
/// day's recovery comes by blocks (`recovery::rest_blocks`), not from here. His condition must
/// already be rested up to the moment of the session: the fatigue guard reads it.
pub fn online_session(
    player: &mut Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    kind: SessionKind,
    rng: &mut impl Rng,
) {
    let is_training_day = match kind {
        SessionKind::Manual => true,
        SessionKind::Scheduled => plan.schedule.is_training_day(day.weekday_num),
        SessionKind::Rest => false,
    };
    train_player_on(player, plan, day, is_training_day, rng);
}

/// `train_player` with the day's kind decided by the caller: a session when `is_training_day`,
/// otherwise a rest day.
fn train_player_on(
    player: &mut Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    is_training_day: bool,
    rng: &mut impl Rng,
) {
    // The taper: with a fixture close, today's session runs one step lighter than
    // the manager's standing setting. The setting itself is untouched — the club's
    // stored plan is the manager's, and a taper is not a change of plan.
    let intensity = match plan.taper {
        Some(Taper::Congested) if is_training_day => TrainingIntensity::Low,
        Some(Taper::NearMatch) if is_training_day => downgrade_intensity(&plan.intensity),
        _ => plan.intensity.clone(),
    };
    let intensity_mult = intensity_mult(&intensity);

    // Two ways a session becomes recovery work rather than a load:
    //
    // 1. The fatigue guard — a player this tired physically cannot take a hard
    //    session. See `FATIGUE_GUARD_CONDITION`.
    // 2. A tapered session that has already come down to Low. At that point the
    //    squad is ticking over before a game, which is what Recovery models.
    //
    // Injured players are exempt from both: they don't train regardless, and
    // routing them through Recovery focus here would inflate the injured-recovery
    // base below (9.0 instead of 3.0), giving them ~3x recovery.
    let is_resting = is_training_day
        && player.injury.is_none()
        && (player.condition < FATIGUE_GUARD_CONDITION
            || (plan.taper.is_some() && intensity == TrainingIntensity::Low));
    // Owned, not borrowed from `player`: the development step below changes him.
    let player_focus = if is_resting {
        TrainingFocus::Recovery
    } else {
        planned_focus(player, plan).clone()
    };
    let player_focus = &player_focus;

    // On rest days or Recovery focus: no training cost
    let condition_cost: u8 = if !is_training_day {
        0
    } else {
        match player_focus {
            TrainingFocus::Recovery => 0,
            _ => session_cost(&intensity),
        }
    };

    // A scheduled day off restores more than any session, including a Recovery
    // one. It has to: restoring condition is the *only* thing it does, while a
    // Recovery session does that and nudges match fitness besides. At the old
    // 7.0 against a session's 9.0 a day off was strictly dominated, so the
    // schedule with the fewest of them was simply the best schedule — a club
    // training six days a week finished it fresher than one resting five.
    // The trade is now honest: days off buy condition, sessions buy sharpness
    // and development.
    let recovery_base: f64 = if !is_training_day {
        10.0 * plan.bonus.physio_mult * plan.medical_facility_mult
    } else {
        match player_focus {
            TrainingFocus::Recovery => 9.0 * plan.bonus.physio_mult * plan.medical_facility_mult,
            _ => 3.0 * plan.bonus.physio_mult * plan.medical_facility_mult,
        }
    };

    // Age, morale, and current condition all affect recovery rate.
    // Older players recover more slowly; high morale aids recovery;
    // severely fatigued players have a harder time bouncing back.
    // A date of birth that cannot be read counts as 25, the middle of every age band.
    let age = age_on_day(player, day);
    let age_rec = recovery_factor_from_age(age);
    let morale_rec = recovery_factor_from_morale(player.morale);
    let condition_rec = recovery_factor_from_condition(player.condition);
    let fitness_rec = recovery_factor_from_fitness(player.fitness);

    // Injured players: half base recovery, scaled by age and morale.
    // Fitness decays slowly during injury (inactive = losing sharpness).
    if player.injury.is_some() {
        let recovery = (recovery_base * 0.5 * age_rec * morale_rec * fitness_rec) as u8;
        player.condition = (player.condition + recovery).min(100);
        player.fitness = clamp_fitness(player.fitness as i16 - 1);
        return;
    }

    // On rest days: only recovery, no attribute gains
    if !is_training_day {
        player.condition = rest_day_condition(
            player,
            player.condition,
            age,
            plan.bonus.physio_mult,
            plan.medical_facility_mult,
        );
        return;
    }

    // A scheduled session develops at the session's own pace: a scale of one changes no bit.
    develop(player, plan, day, player_focus, intensity_mult, 1.0, rng);

    // Apply condition: deplete from training, then recover
    player.condition = player.condition.saturating_sub(condition_cost);
    let stamina_factor = player.attributes.stamina as f64 / 100.0;
    let recovery = (recovery_base
        * (0.5 + stamina_factor * 0.5)
        * age_rec
        * morale_rec
        * condition_rec
        * fitness_rec) as u8;
    player.condition = (player.condition + recovery).min(100);
}

/// The focus `player` trains on under `plan` when nothing rests him: his own, else his training
/// group's, else the club's.
fn planned_focus<'a>(player: &'a Player, plan: &'a TeamTrainingPlan) -> &'a TrainingFocus {
    player
        .training_focus
        .as_ref()
        .or_else(|| plan.group_overrides.get(&player.id))
        .unwrap_or(&plan.default_focus)
}

/// How much harder than a Medium session one of `intensity` builds.
fn intensity_mult(intensity: &TrainingIntensity) -> f64 {
    match intensity {
        TrainingIntensity::Low => 0.5,
        TrainingIntensity::Medium => 1.0,
        TrainingIntensity::High => 1.5,
    }
}

/// The condition a session of `intensity` takes, on any focus but Recovery.
fn session_cost(intensity: &TrainingIntensity) -> u8 {
    match intensity {
        TrainingIntensity::Low => 3,
        TrainingIntensity::Medium => 6,
        TrainingIntensity::High => 10,
    }
}

/// `player`'s age on the session's date; a date of birth that cannot be read counts as 25, the
/// middle of every age band.
fn age_on_day(player: &Player, day: &TrainingDay) -> u32 {
    crate::age::age_on(&player.date_of_birth, &day.date).map_or(25, |age| age.max(0) as u32)
}

/// What a session on `focus` builds in `player`: his attributes and match fitness, then his
/// overall rating. `dev_scale` scales the chance per attribute (1.0 for every session but an
/// extra one, E5-4); it multiplies last, so at 1.0 not a bit of the chance changes. The dice
/// fall in the same order as ever: the focus's attributes as written, then fitness. Returns how
/// many attributes went up.
fn develop(
    player: &mut Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    focus: &TrainingFocus,
    intensity_mult: f64,
    dev_scale: f64,
    rng: &mut impl Rng,
) -> u8 {
    // Base gain per attribute per session, boosted by coaching staff and the
    // training facility, held back for a player who is not getting games, and
    // nudged by how well he is playing; younger players grow faster.
    let gain = BASE_TRAINING_GAIN
        * day.development_multiplier
        * intensity_mult
        * age_factor(age_on_day(player, day))
        * plan.bonus.coaching_mult
        * plan.bonus.specialization_mult
        * plan.training_facility_mult
        * crate::playing_time::development_factor(player.playing_time)
        * crate::match_form::development_factor(player.match_form)
        * dev_scale;

    // Peaked players (ovr == potential) get no attribute gains. Without this
    // gate, attribute drift lifts ovr, and `refresh_player_derived`'s
    // `potential = max(potential, ovr)` invariant silently raises the career
    // ceiling in lockstep — the ceiling stops being a ceiling.
    let gains = if player.potential > player.ovr {
        apply_focus_gains(&mut player.attributes, focus, gain, rng)
    } else {
        0
    };
    apply_fitness_change(&mut player.fitness, focus, intensity_mult, rng);

    // Refresh position-weighted OVR and traits after attribute gains.
    refresh_player_derived(player, day.year);
    gains
}

/// What a season's ruleset sets for pressed extra sessions (E5-4; the server reads them from its
/// `extraSession`). Every lever the measurement may pull lives here, so tuning needs no new tag.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtraParams {
    /// Below this condition a player sits the session out.
    pub floor: u8,
    /// The session's development, in thousandths of a scheduled session's (1000 = the same).
    pub dev_permille: u32,
}

/// Why an [`ExtraParams`] cannot be run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtraIssue {
    Floor,
    DevPermille,
}

/// Twice a session's development: past it an extra session would beat the scheduled one it is
/// meant to add to.
const MOST_DEV_PERMILLE: u32 = 2000;

impl ExtraParams {
    /// Before measuring (Q-U3): the game's fatigue guard, and a session's own development.
    pub const PROPOSED: Self = Self {
        floor: FATIGUE_GUARD_CONDITION,
        dev_permille: 1000,
    };

    /// Whether these settings can run a season. A floor of 0 would let a spent player train.
    pub fn validate(&self) -> Result<(), ExtraIssue> {
        if !(1..=100).contains(&self.floor) {
            return Err(ExtraIssue::Floor);
        }
        if self.dev_permille > MOST_DEV_PERMILLE {
            return Err(ExtraIssue::DevPermille);
        }
        Ok(())
    }
}

/// Why a player takes no part in an extra session. A scheduled session would have rested each
/// of them and given condition back; an extra one must never give condition back, or pressing
/// would be a free way to recover.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SitOut {
    /// Injured: a session would give him half a rest's recovery.
    Injured,
    /// Under the floor: a session would turn into Recovery work.
    Tired,
    /// His focus is Recovery: nothing to build, condition to gain.
    Resting,
    /// At his potential: nothing can be built, only condition lost.
    Peaked,
}

/// What one extra session did to one player.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExtraOutcome {
    pub sat_out: Option<SitOut>,
    pub condition_before: u8,
    pub condition_after: u8,
    /// Attributes that went up by one.
    pub gains: u8,
}

/// The dice of `player_id`'s `n`-th extra session (1, 2, …) of the club's online day `date`: his
/// own stream, apart from the day's session (`session_rng`) and from every other extra session.
pub fn extra_session_rng(
    seed: u64,
    player_id: &str,
    date: &str,
    n: u32,
) -> rand_chacha::ChaCha12Rng {
    crate::seed::rng_for_seed(seed, &format!("training/{player_id}/extra/{n}"), date)
}

/// Why `player` would sit an extra session under `plan` out, or none if he takes part; the first
/// reason that holds, in the order of [`SitOut`].
pub fn extra_sit_out(
    player: &Player,
    plan: &TeamTrainingPlan,
    params: &ExtraParams,
) -> Option<SitOut> {
    if player.injury.is_some() {
        Some(SitOut::Injured)
    } else if player.condition < params.floor {
        Some(SitOut::Tired)
    } else if *planned_focus(player, plan) == TrainingFocus::Recovery {
        Some(SitOut::Resting)
    } else if player.ovr >= player.potential {
        Some(SitOut::Peaked)
    } else {
        None
    }
}

/// One extra session of `player` at `intensity` under `plan` on `day` (E5-4, analysis U-1…U-3):
/// the focus and development of a session, scaled by `params.dev_permille`, its full condition
/// cost and no recovery in it. The intensity is the press's own, not the plan's, and no taper
/// applies. A player who sits out is left as he was and casts no die. His condition must already
/// be rested up to the moment of the press (`recovery::rest_blocks`).
pub fn extra_session(
    player: &mut Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    intensity: TrainingIntensity,
    params: &ExtraParams,
    rng: &mut impl Rng,
) -> ExtraOutcome {
    let condition_before = player.condition;
    if let Some(why) = extra_sit_out(player, plan, params) {
        return ExtraOutcome {
            sat_out: Some(why),
            condition_before,
            condition_after: condition_before,
            gains: 0,
        };
    }
    let focus = planned_focus(player, plan).clone();
    let dev_scale = f64::from(params.dev_permille) / 1000.0;
    let gains = develop(
        player,
        plan,
        day,
        &focus,
        intensity_mult(&intensity),
        dev_scale,
        rng,
    );
    player.condition = player.condition.saturating_sub(session_cost(&intensity));
    ExtraOutcome {
        sat_out: None,
        condition_before,
        condition_after: player.condition,
        gains,
    }
}

/// One online day of `player` (phase 3, E3-7, S-7 Qs7-11): the day's session or rest under
/// `plan`, then `rest_days` days more of recovery. An online season is a football year in 28
/// days, so one online day is about thirteen football days; development is compressed by the
/// season's multiplier, and this compresses recovery, or a match a day would wear every squad
/// down (an XI at 15 condition by the last round). `rest_days` is the season ruleset's.
pub fn train_online_day(
    player: &mut Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    rest_days: u32,
    rng: &mut impl Rng,
) {
    train_player(player, plan, day, rng);
    if rest_days == 0 {
        return;
    }
    let age = age_on_day(player, day);
    let recovery = (plan.bonus.physio_mult, plan.medical_facility_mult);
    player.condition =
        condition_after_rest(player, player.condition, age, recovery, rest_days * 24);
}

/// `player`'s condition after one rest day that started at `condition`: the day off's recovery,
/// scaled by his stamina, age, morale, condition and fitness, and by the club's physio bonus and
/// its medical facility's recovery multiplier.
pub fn rest_day_condition(
    player: &Player,
    condition: u8,
    age: u32,
    physio_mult: f64,
    medical_mult: f64,
) -> u8 {
    // In this order, to the bit, as the game's rest day has always multiplied it.
    let recovery_base = 10.0 * physio_mult * medical_mult;
    let stamina_factor = player.attributes.stamina as f64 / 100.0;
    let recovery = (recovery_base
        * (0.5 + stamina_factor * 0.5)
        * recovery_factor_from_age(age)
        * recovery_factor_from_morale(player.morale)
        * recovery_factor_from_condition(condition)
        * recovery_factor_from_fitness(player.fitness)) as u8;
    (condition + recovery).min(100)
}

/// `player`'s condition after resting `hours` from `condition`, with the club's physio and medical
/// multipliers as for [`rest_day_condition`] (Q6: the online server works it out
/// when it is read, with no job ticking it up). Whole days recover exactly as the game's rest
/// days do, one after another; the hours left over give their share of the next day's recovery.
pub fn condition_after_rest(
    player: &Player,
    condition: u8,
    age: u32,
    (physio_mult, medical_mult): (f64, f64),
    hours: u32,
) -> u8 {
    let mut condition = condition;
    for _ in 0..hours / 24 {
        let rested = rest_day_condition(player, condition, age, physio_mult, medical_mult);
        // A day that gives nothing back (full, or a recovery that rounds to nothing) gives nothing
        // every day after it, so a long rest stops here rather than counting out every day.
        if rested == condition {
            break;
        }
        condition = rested;
    }
    let next_day =
        rest_day_condition(player, condition, age, physio_mult, medical_mult) - condition;
    // Rounded, not truncated: online condition is locked every few hours (E5-1 §4), and a share
    // cut down at every lock loses about half a point each time.
    let share = (u32::from(next_day) * (hours % 24) + 12) / 24;
    condition + share as u8
}

/// Apply fitness changes based on training focus.
/// Physical training builds fitness (probabilistic small gains).
/// Recovery focus gives a tiny boost. Non-physical training slowly decays high fitness.
fn apply_fitness_change(
    fitness: &mut u8,
    focus: &TrainingFocus,
    intensity_mult: f64,
    rng: &mut impl Rng,
) {
    use rand::RngExt;
    match focus {
        TrainingFocus::Physical => {
            // Physical training is the primary way to build fitness.
            // Higher intensity → higher gain probability.
            let gain_prob = 0.015 * intensity_mult; // 0.0075–0.0225 per session
            let roll: f64 = rng.random_range(0.0..1.0);
            if roll < gain_prob && *fitness < 100 {
                *fitness = fitness.saturating_add(1);
            }
        }
        TrainingFocus::Recovery => {
            // Recovery days give a tiny fitness nudge.
            let roll: f64 = rng.random_range(0.0..1.0);
            if roll < 0.05 && *fitness < 100 {
                *fitness = fitness.saturating_add(1);
            }
        }
        _ => {
            // Non-physical training: very slight decay if player is already very fit
            // (fitness above 85 needs active maintenance).
            if *fitness > 85 {
                let roll: f64 = rng.random_range(0.0..1.0);
                if roll < 0.05 {
                    *fitness = fitness.saturating_sub(1);
                }
            }
        }
    }
}

/// `try_gain` for one of the seven split attributes: one still at 0 is
/// undeclared (see `attribute_split`), and training must not declare it.
fn try_gain_split(current: &mut u8, gain: f64, rng: &mut impl Rng) -> bool {
    *current != 0 && try_gain(current, gain, rng)
}

/// One roll for `current` at `gain`; whether it went up.
fn try_gain(current: &mut u8, gain: f64, rng: &mut impl Rng) -> bool {
    use rand::RngExt;
    if *current >= 99 {
        return false;
    }
    let roll: f64 = rng.random_range(0.0..1.0);
    let rises = roll < gain;
    if rises {
        *current = (*current + 1).min(99);
    }
    rises
}

/// Apply attribute gains based on training focus; how many attributes went up. Each attribute is
/// rolled in the order written, every roll counted, so the dice fall as they always have.
fn apply_focus_gains(
    attrs: &mut PlayerAttributes,
    focus: &TrainingFocus,
    gain: f64,
    rng: &mut impl Rng,
) -> u8 {
    let mut rose = 0;
    let mut roll = |current: &mut u8, gain: f64, is_split: bool| {
        let up = if is_split {
            try_gain_split(current, gain, rng)
        } else {
            try_gain(current, gain, rng)
        };
        rose += u8::from(up);
    };
    match focus {
        TrainingFocus::Physical => {
            roll(&mut attrs.pace, gain, false);
            roll(&mut attrs.stamina, gain, false);
            roll(&mut attrs.strength, gain, false);
            roll(&mut attrs.agility, gain, false);
        }
        TrainingFocus::Technical => {
            roll(&mut attrs.passing, gain, false);
            roll(&mut attrs.shooting, gain, false);
            roll(&mut attrs.dribbling, gain, false);
            // Each split attribute trains in the focus of the blend it came out
            // of, so a position's OVR grows at the same speed (phase 2, rule R1).
            roll(&mut attrs.long_passing, gain, true);
            roll(&mut attrs.crossing, gain, true);
            roll(&mut attrs.curve, gain, true);
            roll(&mut attrs.free_kick, gain, true);
            roll(&mut attrs.long_shots, gain, true);
            roll(&mut attrs.first_touch, gain, true);
        }
        TrainingFocus::Tactical => {
            roll(&mut attrs.positioning, gain, false);
            roll(&mut attrs.vision, gain, false);
            roll(&mut attrs.decisions, gain, false);
            roll(&mut attrs.composure, gain, false);
        }
        TrainingFocus::Defending => {
            roll(&mut attrs.tackling, gain, false);
            roll(&mut attrs.defending, gain, false);
            roll(&mut attrs.strength, gain * 0.5, false);
            roll(&mut attrs.positioning, gain * 0.5, false);
            roll(&mut attrs.heading, gain * 0.5, true);
        }
        TrainingFocus::Attacking => {
            roll(&mut attrs.shooting, gain, false);
            roll(&mut attrs.dribbling, gain, false);
            roll(&mut attrs.pace, gain * 0.5, false);
            roll(&mut attrs.long_shots, gain, true);
            roll(&mut attrs.first_touch, gain, true);
            roll(&mut attrs.heading, gain * 0.5, true);
        }
        TrainingFocus::Recovery => {
            // No attribute gains on recovery days
        }
    }
    rose
}

/// Recovery multiplier from age: younger players bounce back faster.
fn recovery_factor_from_age(age: u32) -> f64 {
    if age <= 21 {
        1.10
    } else if age <= 25 {
        1.05
    } else if age <= 29 {
        1.00
    } else if age <= 33 {
        0.85
    } else {
        0.70
    }
}

/// Recovery multiplier from morale: players in good spirits recover better.
fn recovery_factor_from_morale(morale: u8) -> f64 {
    if morale >= 70 {
        1.10
    } else if morale >= 40 {
        1.00
    } else {
        0.90
    }
}

/// Recovery multiplier from current condition: severely fatigued players recover more slowly.
fn recovery_factor_from_condition(condition: u8) -> f64 {
    if condition < 30 {
        0.80
    } else if condition < 50 {
        0.90
    } else {
        1.00
    }
}

/// Recovery multiplier from fitness: fitter players recover condition faster.
fn recovery_factor_from_fitness(fitness: u8) -> f64 {
    if fitness < 30 {
        0.75
    } else if fitness < 50 {
        0.88
    } else if fitness < 70 {
        1.00
    } else if fitness < 90 {
        1.12
    } else {
        1.20
    }
}

/// Clamp a fitness value to 0–100.
fn clamp_fitness(val: i16) -> u8 {
    val.clamp(0, 100) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::uniform_attributes;
    use domain::player::Position;

    fn tired_player() -> Player {
        let mut player = Player::new(
            "p".into(),
            "P".into(),
            "P".into(),
            "1999-05-01".into(),
            "England".into(),
            Position::Midfielder,
            uniform_attributes(70),
        );
        player.condition = 35;
        player.morale = 60;
        player.fitness = 75;
        player
    }

    /// Given a tired player,
    /// when he rests three whole days by the hour and by three rest days in a row,
    /// then both reach the same condition: a whole day by the hour is the game's rest day.
    #[test]
    fn whole_days_of_rest_recover_as_rest_days_do() {
        let player = tired_player();
        let mut by_days = player.condition;
        for _ in 0..3 {
            by_days = rest_day_condition(&player, by_days, 27, 1.2, 1.0);
        }
        assert_eq!(
            condition_after_rest(&player, 35, 27, (1.2, 1.0), 72),
            by_days
        );
        assert!(by_days > 35);
    }

    /// Given a tired player,
    /// when he rests half a day, a whole day, and a long holiday,
    /// then half a day gives half a day's recovery rounded to the nearest point, nothing exceeds
    /// 100, and no rest leaves him as he was.
    #[test]
    fn rest_by_the_hour_is_proportional_and_capped() {
        let player = tired_player();
        let day = condition_after_rest(&player, 35, 27, (1.0, 1.0), 24) - 35;
        let half = condition_after_rest(&player, 35, 27, (1.0, 1.0), 12) - 35;
        assert_eq!(half, day.div_ceil(2));
        assert_eq!(condition_after_rest(&player, 35, 27, (1.0, 1.0), 0), 35);
        assert_eq!(
            condition_after_rest(&player, 35, 27, (1.0, 1.0), 24 * 60),
            100
        );
    }

    /// Given a club with a training group, a medical level of 4, no staff and a taper,
    /// when its plan for the day is built,
    /// then the group's players train on the group's focus, the facilities' multipliers and the
    /// taper are the club's, and a club without coaches gets the bare coaching multiplier.
    #[test]
    fn a_club_s_plan_comes_from_its_settings_staff_and_facilities() {
        let mut team = domain::team::Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        );
        team.training_focus = TrainingFocus::Technical;
        team.facilities.medical = 4;
        team.training_groups = vec![domain::team::TrainingGroup {
            id: "g".into(),
            name: "Backs".into(),
            focus: TrainingFocus::Defending,
            player_ids: vec!["back".into()],
        }];
        let plan = team_training_plan(&team, &[], Some(Taper::NearMatch));
        assert_eq!(plan.default_focus, TrainingFocus::Technical);
        assert_eq!(
            plan.group_overrides.get("back"),
            Some(&TrainingFocus::Defending)
        );
        assert_eq!(plan.taper, Some(Taper::NearMatch));
        assert_eq!(
            plan.medical_facility_mult,
            crate::facilities::condition_recovery_mult(4)
        );
        assert_eq!(plan.bonus.coaching_mult, coaching_mult(&[]));
        assert!(team_training_plan(&team, &[], None).taper.is_none());
    }

    /// Given a tired player on a rest day,
    /// when his online day gives two more rest days,
    /// then he ends where the day and two rest days one after another leave him.
    #[test]
    fn an_online_day_adds_its_rest_days_to_the_session() {
        let team = domain::team::Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        );
        let plan = team_training_plan(&team, &[], None);
        let day = TrainingDay {
            weekday_num: 6,
            year: 2026,
            date: "2026-07-01".into(),
            development_multiplier: 10.0,
        };
        let mut online = tired_player();
        train_online_day(&mut online, &plan, &day, 2, &mut session_rng(1, "p", "d"));
        let mut by_hand = tired_player();
        train_player(&mut by_hand, &plan, &day, &mut session_rng(1, "p", "d"));
        let age = crate::age::age_on(&by_hand.date_of_birth, &day.date).unwrap() as u32;
        let recovery = (plan.bonus.physio_mult, plan.medical_facility_mult);
        for _ in 0..2 {
            by_hand.condition =
                rest_day_condition(&by_hand, by_hand.condition, age, recovery.0, recovery.1);
        }
        assert_eq!(online.condition, by_hand.condition);
        assert!(online.condition > tired_player().condition);
    }

    /// A player as data, to compare two players field by field (`Player` has no `PartialEq`).
    fn as_json(player: &Player) -> serde_json::Value {
        serde_json::to_value(player).expect("a player")
    }

    fn online_plan(schedule: TrainingSchedule, intensity: TrainingIntensity) -> TeamTrainingPlan {
        let mut team = domain::team::Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        );
        team.training_schedule = schedule;
        team.training_intensity = intensity;
        team.training_focus = TrainingFocus::Technical;
        team_training_plan(&team, &[], None)
    }

    fn online_day(weekday_num: u32) -> TrainingDay {
        TrainingDay {
            weekday_num,
            year: 2026,
            date: "2026-09-01".into(),
            development_multiplier: 16.0,
        }
    }

    fn young_player(condition: u8, injured: bool) -> Player {
        let mut player = tired_player();
        player.date_of_birth = "2008-03-01".into();
        player.condition = condition;
        player.potential = 95;
        if injured {
            player.injury = Some(domain::player::Injury {
                name: "Knock".into(),
                days_remaining: 3,
            });
        }
        player
    }

    /// The players the session tests run through: tired and fresh, either side of the fatigue
    /// guard, injured or not.
    fn grid() -> Vec<Player> {
        [20, 39, 40, 80, 100]
            .into_iter()
            .flat_map(|c| [young_player(c, false), young_player(c, true)])
            .collect()
    }

    /// Given every player of the grid, every weekday, schedule and intensity,
    /// when the automatic online session is held,
    /// then it is the game's own day to the bit, the dice left where the game leaves them.
    #[test]
    fn scheduled_session_is_train_player() {
        use rand::RngExt;
        for schedule in [
            TrainingSchedule::Intense,
            TrainingSchedule::Balanced,
            TrainingSchedule::Light,
        ] {
            for intensity in [
                TrainingIntensity::Low,
                TrainingIntensity::Medium,
                TrainingIntensity::High,
            ] {
                let plan = online_plan(schedule.clone(), intensity.clone());
                for weekday in 0..7 {
                    for player in grid() {
                        let (mut online, mut game) = (player.clone(), player);
                        let (mut online_dice, mut game_dice) =
                            (session_rng(7, "p", "d"), session_rng(7, "p", "d"));
                        let day = online_day(weekday);
                        online_session(
                            &mut online,
                            &plan,
                            &day,
                            SessionKind::Scheduled,
                            &mut online_dice,
                        );
                        train_player(&mut game, &plan, &day, &mut game_dice);
                        assert_eq!(as_json(&online), as_json(&game));
                        assert_eq!(online_dice.random::<u64>(), game_dice.random::<u64>());
                    }
                }
            }
        }
    }

    /// Given a club whose schedule rests on Wednesday,
    /// when its coach presses for a session that Wednesday,
    /// then the player is trained exactly as on a Monday of the same plan: a pressed session is a
    /// training day whatever the schedule says.
    #[test]
    fn manual_session_is_a_training_day() {
        let plan = online_plan(TrainingSchedule::Balanced, TrainingIntensity::High);
        assert!(!plan.schedule.is_training_day(2) && plan.schedule.is_training_day(0));
        for player in grid() {
            let (mut pressed, mut monday) = (player.clone(), player);
            online_session(
                &mut pressed,
                &plan,
                &online_day(2),
                SessionKind::Manual,
                &mut session_rng(3, "p", "d"),
            );
            train_player(
                &mut monday,
                &plan,
                &online_day(0),
                &mut session_rng(3, "p", "d"),
            );
            assert_eq!(as_json(&pressed), as_json(&monday));
        }
        let mut fresh = young_player(80, false);
        online_session(
            &mut fresh,
            &plan,
            &online_day(2),
            SessionKind::Manual,
            &mut session_rng(3, "p", "d"),
        );
        assert!(
            fresh.condition < 80,
            "a High session costs more than it gives back"
        );
    }

    /// Given every player of the grid,
    /// when a day passes with no session,
    /// then it is the game's rest day on a scheduled day off, injured or not, and no die is cast.
    #[test]
    fn rest_is_a_rest_day() {
        use rand::RngExt;
        let plan = online_plan(TrainingSchedule::Balanced, TrainingIntensity::High);
        for player in grid() {
            let (mut rested, mut day_off) = (player.clone(), player);
            let mut dice = session_rng(5, "p", "d");
            online_session(
                &mut rested,
                &plan,
                &online_day(0),
                SessionKind::Rest,
                &mut dice,
            );
            train_player(
                &mut day_off,
                &plan,
                &online_day(2),
                &mut session_rng(5, "p", "d"),
            );
            assert_eq!(as_json(&rested), as_json(&day_off));
            assert_eq!(
                dice.random::<u64>(),
                session_rng(5, "p", "d").random::<u64>()
            );
        }
    }

    /// Given a player just under the fatigue guard,
    /// when his coach presses a High session,
    /// then it is recovery work: nothing taken, something given back, no attribute built.
    #[test]
    fn fatigue_guard_holds_for_manual() {
        let plan = online_plan(TrainingSchedule::Balanced, TrainingIntensity::High);
        let mut player = young_player(FATIGUE_GUARD_CONDITION - 1, false);
        let before = serde_json::to_value(&player.attributes).expect("attributes");
        online_session(
            &mut player,
            &plan,
            &online_day(2),
            SessionKind::Manual,
            &mut session_rng(9, "p", "d"),
        );
        assert!(player.condition > FATIGUE_GUARD_CONDITION - 1);
        assert_eq!(
            serde_json::to_value(&player.attributes).expect("attributes"),
            before
        );
    }

    /// One number for what every existing kind of day does to the grid: each focus, schedule,
    /// intensity, taper and weekday, through `train_player`, a pressed `online_session` and
    /// `train_online_day`, with the die each leaves next. Players and dice are hashed as JSON.
    fn existing_days_fingerprint() -> u64 {
        use rand::RngExt;
        let mut hash = 0;
        let mut fold = |bytes: &[u8]| hash = crate::stable_hash::stable_hash(bytes, hash);
        let focuses = [
            TrainingFocus::Physical,
            TrainingFocus::Technical,
            TrainingFocus::Tactical,
            TrainingFocus::Defending,
            TrainingFocus::Attacking,
            TrainingFocus::Recovery,
        ];
        let schedules = [
            TrainingSchedule::Intense,
            TrainingSchedule::Balanced,
            TrainingSchedule::Light,
        ];
        let intensities = [
            TrainingIntensity::Low,
            TrainingIntensity::Medium,
            TrainingIntensity::High,
        ];
        for focus in focuses {
            for schedule in &schedules {
                for intensity in &intensities {
                    for taper in [None, Some(Taper::NearMatch), Some(Taper::Congested)] {
                        let mut plan = online_plan(schedule.clone(), intensity.clone());
                        plan.default_focus = focus.clone();
                        plan.taper = taper;
                        for weekday in 0..7 {
                            let day = online_day(weekday);
                            for (index, player) in grid().into_iter().enumerate() {
                                let id = format!("p{index}");
                                let mut game = player.clone();
                                let mut dice = session_rng(11, &id, &day.date);
                                train_player(&mut game, &plan, &day, &mut dice);
                                fold(as_json(&game).to_string().as_bytes());
                                fold(&dice.random::<u64>().to_le_bytes());
                                let mut pressed = player.clone();
                                let mut dice = session_rng(12, &id, &day.date);
                                online_session(
                                    &mut pressed,
                                    &plan,
                                    &day,
                                    SessionKind::Manual,
                                    &mut dice,
                                );
                                fold(as_json(&pressed).to_string().as_bytes());
                                fold(&dice.random::<u64>().to_le_bytes());
                                let mut online = player;
                                let mut dice = session_rng(13, &id, &day.date);
                                train_online_day(&mut online, &plan, &day, 2, &mut dice);
                                fold(as_json(&online).to_string().as_bytes());
                                fold(&dice.random::<u64>().to_le_bytes());
                            }
                        }
                    }
                }
            }
        }
        hash
    }

    /// Given every focus, schedule, intensity, taper, weekday and player of the grid,
    /// when a scheduled session, a pressed one and an online day are held,
    /// then players and dice end exactly where they did before extra sessions shared the
    /// development step (E5-4, T6): the number is pinned from the code before the split.
    #[test]
    fn existing_sessions_are_unchanged_by_extra_sessions() {
        assert_eq!(existing_days_fingerprint(), 510_125_767_469_623_704);
    }

    const INTENSITIES: [TrainingIntensity; 3] = [
        TrainingIntensity::Low,
        TrainingIntensity::Medium,
        TrainingIntensity::High,
    ];

    fn cost_of(intensity: &TrainingIntensity) -> u8 {
        match intensity {
            TrainingIntensity::Low => 3,
            TrainingIntensity::Medium => 6,
            TrainingIntensity::High => 10,
        }
    }

    /// An extra session of `player` on the Technical plan, with `params`, from `dice`.
    fn extra(
        player: &mut Player,
        intensity: TrainingIntensity,
        params: &ExtraParams,
        dice: &mut rand_chacha::ChaCha12Rng,
    ) -> ExtraOutcome {
        let plan = online_plan(TrainingSchedule::Balanced, TrainingIntensity::Low);
        extra_session(player, &plan, &online_day(2), intensity, params, dice)
    }

    /// Given players of every condition across the floor, injured or not, on a Technical or a
    /// Recovery plan, at every intensity,
    /// when an extra session is pressed,
    /// then no one ends fresher than he began, and whoever trains loses exactly 3, 6 or 10 (T1).
    #[test]
    fn an_extra_session_never_raises_condition() {
        for condition in [0, 29, 39, 40, 41, 50, 75, 100] {
            for injured in [false, true] {
                for focus in [TrainingFocus::Technical, TrainingFocus::Recovery] {
                    for intensity in INTENSITIES {
                        let mut player = young_player(condition, injured);
                        let mut plan = online_plan(TrainingSchedule::Balanced, intensity.clone());
                        plan.default_focus = focus.clone();
                        let outcome = extra_session(
                            &mut player,
                            &plan,
                            &online_day(2),
                            intensity.clone(),
                            &ExtraParams::PROPOSED,
                            &mut extra_session_rng(1, "p", "d", 1),
                        );
                        assert_eq!(outcome.condition_before, condition);
                        assert_eq!(outcome.condition_after, player.condition);
                        assert!(player.condition <= condition);
                        if outcome.sat_out.is_none() {
                            assert_eq!(player.condition, condition - cost_of(&intensity));
                        } else {
                            assert_eq!(player.condition, condition);
                        }
                    }
                }
            }
        }
        let mut at_41 = young_player(41, false);
        let mut dice = extra_session_rng(1, "p", "d", 1);
        extra(
            &mut at_41,
            TrainingIntensity::High,
            &ExtraParams::PROPOSED,
            &mut dice,
        );
        assert_eq!(at_41.condition, 31);
        let mut at_floor = young_player(FATIGUE_GUARD_CONDITION, false);
        extra(
            &mut at_floor,
            TrainingIntensity::High,
            &ExtraParams::PROPOSED,
            &mut dice,
        );
        assert_eq!(at_floor.condition, 30);
    }

    /// Given an injured player, a tired one, one in a Recovery group and one at his potential,
    /// when an extra session is pressed for each,
    /// then each sits out for his reason, ends exactly as he began, and casts no die (T2).
    #[test]
    fn those_who_sit_out_are_untouched_and_cast_no_die() {
        use rand::RngExt;
        let mut in_recovery_group = young_player(80, false);
        in_recovery_group.id = "resting".into();
        let mut peaked = young_player(80, false);
        refresh_player_derived(&mut peaked, 2026);
        peaked.potential = peaked.ovr;
        let cases = [
            (young_player(80, true), SitOut::Injured),
            (
                young_player(FATIGUE_GUARD_CONDITION - 1, false),
                SitOut::Tired,
            ),
            (in_recovery_group, SitOut::Resting),
            (peaked, SitOut::Peaked),
        ];
        let mut plan = online_plan(TrainingSchedule::Balanced, TrainingIntensity::Low);
        plan.group_overrides
            .insert("resting".into(), TrainingFocus::Recovery);
        for (player, why) in cases {
            for intensity in INTENSITIES {
                let mut pressed = player.clone();
                let mut dice = extra_session_rng(2, &player.id, "d", 1);
                assert_eq!(
                    extra_sit_out(&pressed, &plan, &ExtraParams::PROPOSED),
                    Some(why)
                );
                let outcome = extra_session(
                    &mut pressed,
                    &plan,
                    &online_day(2),
                    intensity,
                    &ExtraParams::PROPOSED,
                    &mut dice,
                );
                assert_eq!(outcome.sat_out, Some(why));
                assert_eq!(outcome.gains, 0);
                assert_eq!(as_json(&pressed), as_json(&player));
                assert_eq!(
                    dice.random::<u64>(),
                    extra_session_rng(2, &player.id, "d", 1).random::<u64>()
                );
            }
        }
    }

    /// Given a regular starter of 18 with room to grow, on a Technical plan at 16×,
    /// when he takes a High extra session, whose chance per attribute is over one,
    /// then every Technical attribute goes up by one and `gains` counts them; and given one a
    /// point under his potential, the session leaves his potential where it was (T3).
    #[test]
    fn an_extra_session_builds_what_a_session_builds() {
        let mut starter = young_player(80, false);
        starter.playing_time = 80;
        let outcome = extra(
            &mut starter,
            TrainingIntensity::High,
            &ExtraParams::PROPOSED,
            &mut extra_session_rng(3, "p", "d", 1),
        );
        let technical = |p: &Player| {
            let a = &p.attributes;
            [
                a.passing,
                a.shooting,
                a.dribbling,
                a.long_passing,
                a.crossing,
                a.curve,
                a.free_kick,
                a.long_shots,
                a.first_touch,
            ]
        };
        assert_eq!(technical(&starter), [71; 9]);
        assert_eq!(outcome.gains, 9);
        assert_eq!(starter.attributes.tackling, 70);

        let mut near_ceiling = young_player(80, false);
        near_ceiling.playing_time = 80;
        refresh_player_derived(&mut near_ceiling, 2026);
        near_ceiling.potential = near_ceiling.ovr + 1;
        let potential = near_ceiling.potential;
        for n in 1..=20 {
            extra(
                &mut near_ceiling,
                TrainingIntensity::Low,
                &ExtraParams::PROPOSED,
                &mut extra_session_rng(3, "p", "d", n),
            );
            near_ceiling.condition = 80;
            assert_eq!(near_ceiling.potential, potential);
            assert!(near_ceiling.ovr <= near_ceiling.potential);
        }
        assert_eq!(
            near_ceiling.ovr, potential,
            "twenty sessions take him to his ceiling, and the last ones sit out"
        );
    }

    /// Given a player of 30, whose chance per attribute is well under one,
    /// when he takes the first and the second extra session of a day, and the first again,
    /// then the two sessions cast different dice and the same session casts the same ones (T4).
    #[test]
    fn each_extra_session_of_a_day_has_its_own_dice() {
        let veteran = || {
            let mut player = young_player(100, false);
            player.date_of_birth = "1996-03-01".into();
            player
        };
        let after = |n| {
            let mut player = veteran();
            for _ in 0..3 {
                player.condition = 100;
                extra(
                    &mut player,
                    TrainingIntensity::Medium,
                    &ExtraParams::PROPOSED,
                    &mut extra_session_rng(4, "p", "2026-09-01", n),
                );
            }
            as_json(&player)
        };
        let draws = |n| {
            use rand::RngExt;
            let mut dice = extra_session_rng(4, "p", "2026-09-01", n);
            [dice.random::<u64>(), dice.random::<u64>()]
        };
        assert_ne!(draws(1), draws(2));
        assert_ne!(
            draws(1),
            {
                use rand::RngExt;
                let mut dice = session_rng(4, "p", "2026-09-01");
                [dice.random::<u64>(), dice.random::<u64>()]
            },
            "an extra session does not reuse the day's own session's dice"
        );
        assert_eq!(after(1), after(1));
        assert_ne!(after(1), after(2));
    }

    /// Given two players of a club,
    /// when each takes an extra session on his own dice, in one order and then the other,
    /// then each ends the same either way (T5).
    #[test]
    fn extra_sessions_do_not_depend_on_who_goes_first() {
        let pair = || {
            let mut first = young_player(90, false);
            first.id = "a".into();
            let mut second = young_player(90, false);
            second.id = "b".into();
            second.date_of_birth = "1995-01-01".into();
            (first, second)
        };
        let press = |player: &mut Player| {
            let mut dice = extra_session_rng(5, &player.id.clone(), "d", 1);
            extra(
                player,
                TrainingIntensity::Medium,
                &ExtraParams::PROPOSED,
                &mut dice,
            );
        };
        let (mut a1, mut b1) = pair();
        press(&mut a1);
        press(&mut b1);
        let (mut a2, mut b2) = pair();
        press(&mut b2);
        press(&mut a2);
        assert_eq!(as_json(&a1), as_json(&a2));
        assert_eq!(as_json(&b1), as_json(&b2));
    }

    /// Given a floor of 60 and a development of nothing,
    /// when players either side of the floor and a regular starter are pressed,
    /// then 59 sits out tired and 60 trains, a session of no development still costs its price
    /// and builds nothing, 1000‰ is the proposed rule, and out-of-range settings are refused (T7).
    #[test]
    fn extra_session_settings_move_the_floor_and_the_development() {
        let high_floor = ExtraParams {
            floor: 60,
            dev_permille: 1000,
        };
        let plan = online_plan(TrainingSchedule::Balanced, TrainingIntensity::Low);
        assert_eq!(
            extra_sit_out(&young_player(59, false), &plan, &high_floor),
            Some(SitOut::Tired)
        );
        assert_eq!(
            extra_sit_out(&young_player(60, false), &plan, &high_floor),
            None
        );

        let starter = || {
            let mut player = young_player(80, false);
            player.playing_time = 80;
            player
        };
        let mut idle = starter();
        let no_development = ExtraParams {
            floor: 40,
            dev_permille: 0,
        };
        let outcome = extra(
            &mut idle,
            TrainingIntensity::High,
            &no_development,
            &mut extra_session_rng(6, "p", "d", 1),
        );
        assert_eq!(outcome.gains, 0);
        assert_eq!(idle.condition, 70);
        assert_eq!(
            serde_json::to_value(idle.attributes).expect("attributes"),
            serde_json::to_value(starter().attributes).expect("attributes")
        );

        let (mut proposed, mut by_hand) = (starter(), starter());
        extra(
            &mut proposed,
            TrainingIntensity::Medium,
            &ExtraParams::PROPOSED,
            &mut extra_session_rng(6, "p", "d", 2),
        );
        extra(
            &mut by_hand,
            TrainingIntensity::Medium,
            &ExtraParams {
                floor: FATIGUE_GUARD_CONDITION,
                dev_permille: 1000,
            },
            &mut extra_session_rng(6, "p", "d", 2),
        );
        assert_eq!(as_json(&proposed), as_json(&by_hand));

        assert_eq!(ExtraParams::PROPOSED.validate(), Ok(()));
        let refused = [
            (
                ExtraParams {
                    floor: 0,
                    dev_permille: 1000,
                },
                ExtraIssue::Floor,
            ),
            (
                ExtraParams {
                    floor: 101,
                    dev_permille: 1000,
                },
                ExtraIssue::Floor,
            ),
            (
                ExtraParams {
                    floor: 40,
                    dev_permille: 2001,
                },
                ExtraIssue::DevPermille,
            ),
        ];
        for (params, issue) in refused {
            assert_eq!(params.validate(), Err(issue));
        }
        assert_eq!(
            ExtraParams {
                floor: 100,
                dev_permille: 2000
            }
            .validate(),
            Ok(())
        );
    }

    /// Given the proposed settings as a ruleset carries them,
    /// when they are written and read back,
    /// then the names are camelCase and nothing is lost.
    #[test]
    fn extra_session_settings_read_as_a_ruleset_writes_them() {
        let json = serde_json::to_value(ExtraParams::PROPOSED).expect("params");
        assert_eq!(
            json,
            serde_json::json!({ "floor": 40, "devPermille": 1000 })
        );
        let back: ExtraParams = serde_json::from_value(json).expect("params");
        assert_eq!(back, ExtraParams::PROPOSED);
    }

    /// Given a full player and a tired one whose recovery rounds to nothing,
    /// when they rest for months,
    /// then the full one stays full and the other where he was, as day after day would leave
    /// them: a long rest stops counting once a day gives nothing back.
    #[test]
    fn full_condition_stops_early() {
        let player = tired_player();
        assert_eq!(
            condition_after_rest(&player, 100, 27, (1.0, 1.0), 24 * 4_000),
            100
        );
        let stalled = condition_after_rest(&player, 35, 27, (0.0, 1.0), u32::MAX);
        assert_eq!(stalled, 35);
    }
}
