//! One training session of one player (phase 3, E3-5b): what it costs him, what it gives back,
//! and what it builds, by the club's plan, its staff and its facilities. Shared with the online
//! server, whose daily job runs it for every club (Q6); `ofm_core::training` runs it for a save.
//! The coaching bonus is read off the club's staff as passed in, the taper off its calendar by
//! the caller. Online, a coach may also press extra sessions on top of the day's (E5-4,
//! `extra_session`): as many as condition allows, each at full cost with nothing given back.

use crate::growth_cap::GrowthCap;
use crate::match_growth::MatchGrowth;
use crate::player_rating::{attribute_mut, refresh_player_derived};
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
    /// A keeper's own drill (E5-6, the season ruleset's `keeperDrill`); None offline and in every
    /// season without it, which trains as the game always has.
    pub keeper_drill: Option<KeeperDrill>,
    /// The brake on young stars (E5-5, the season ruleset's `growthCap`); None offline and in
    /// every season without it, which develops players as the game always has.
    pub growth_cap: Option<GrowthCap>,
    /// "Tập tích — trận trả" (E5-12, the season ruleset's `matchGrowth`): the share of a
    /// regular's development his sessions bank for his matches to pay out. None offline and in
    /// every season without it, which develops players as the game always has, to the bit.
    pub match_growth: Option<MatchGrowth>,
}

/// A keeper's own drill (E5-6 PD-GK-C): handling, reflexes and aerial, which no focus trains,
/// rolled in every session he develops in, on top of his focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeeperDrill {
    /// Each attribute's chance, in thousandths of a focus attribute's chance in that session.
    pub handling_permille: u16,
    pub reflexes_permille: u16,
    pub aerial_permille: u16,
}

/// Why a [`KeeperDrill`] cannot be run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeeperDrillIssue {
    /// A chance above a focus attribute's own.
    OverAFocus,
    /// Every chance 0: the way to turn the drill off is None, so there is only one.
    AllZero,
}

/// A drill attribute's chance may reach a focus attribute's, never pass it.
const MOST_DRILL_PERMILLE: u16 = 1000;

impl KeeperDrill {
    /// Before measuring (E5-6 §2.4): a keeper on Tactical builds about 44 % of his OVR a
    /// session, and a bot's keeper about what a bot's outfielder does.
    pub const PROPOSED: Self = Self {
        handling_permille: 300,
        reflexes_permille: 300,
        aerial_permille: 300,
    };

    /// Whether this drill can run a season: each chance 0..=1000, at least one above 0.
    pub fn validate(&self) -> Result<(), KeeperDrillIssue> {
        let chances = [
            self.handling_permille,
            self.reflexes_permille,
            self.aerial_permille,
        ];
        if chances.iter().any(|c| *c > MOST_DRILL_PERMILLE) {
            return Err(KeeperDrillIssue::OverAFocus);
        }
        if chances.iter().all(|c| *c == 0) {
            return Err(KeeperDrillIssue::AllZero);
        }
        Ok(())
    }
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
    /// "Auto" as the club's focus (E5-6 E56-9): a player with no focus of his own and no group
    /// trains the focus that lifts his OVR most. Only the online server turns it on.
    pub auto_focus: bool,
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
        auto_focus: false,
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
        planned_focus(player, plan)
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
    develop(
        player,
        plan,
        day,
        player_focus,
        Session {
            intensity_mult,
            dev_scale: 1.0,
        },
        rng,
    );

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
/// group's, else, with the club on "Auto", the one that lifts his OVR most, else the club's.
fn planned_focus(player: &Player, plan: &TeamTrainingPlan) -> TrainingFocus {
    if let Some(focus) = player
        .training_focus
        .as_ref()
        .or_else(|| plan.group_overrides.get(&player.id))
    {
        return focus.clone();
    }
    if plan.auto_focus
        && let Some(best) = best_focus(player, None)
    {
        return best;
    }
    plan.default_focus.clone()
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

/// How hard a session works and how much of a session's development it gives.
#[derive(Clone, Copy)]
struct Session {
    intensity_mult: f64,
    /// 1.0 for every session but an extra one (E5-4).
    dev_scale: f64,
}

/// A session's chance per attribute before the gate, with `playing_time_factor` for what his
/// playing time is worth. Multiplied in the order the game always has, so the game's own factor
/// gives the game's own chance to the bit.
fn session_gain(
    player: &Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    session: Session,
    playing_time_factor: f64,
) -> f64 {
    // Base gain per attribute per session, boosted by coaching staff and the
    // training facility, held back for a player who is not getting games, and
    // nudged by how well he is playing; younger players grow faster.
    BASE_TRAINING_GAIN
        * day.development_multiplier
        * session.intensity_mult
        * age_factor(age_on_day(player, day))
        * plan.bonus.coaching_mult
        * plan.bonus.specialization_mult
        * plan.training_facility_mult
        * playing_time_factor
        * crate::match_form::development_factor(player.match_form)
        * session.dev_scale
}

/// Whether `player` may develop on `day`, and at what chance from `gain`.
///
/// Peaked players (ovr == potential) get no attribute gains. Without this
/// gate, attribute drift lifts ovr, and `refresh_player_derived`'s
/// `potential = max(potential, ovr)` invariant silently raises the career
/// ceiling in lockstep — the ceiling stops being a ceiling. Under a growth cap the
/// brake decides instead (E5-5).
fn gate(player: &Player, day: &TrainingDay, gain: f64) -> (bool, f64) {
    match day.growth_cap {
        Some(cap) => braked(player, &cap, age_on_day(player, day), gain),
        None => (player.potential > player.ovr, gain),
    }
}

/// Whether `player` may develop on `day` at all: the gate of a session, which a match's payout
/// reads too (E5-12 §3.5).
pub(crate) fn gate_open(player: &Player, day: &TrainingDay) -> bool {
    gate(player, day, 0.0).0
}

/// What a session on `focus` builds in `player`: his attributes and match fitness, then his
/// overall rating. `session.dev_scale` scales the chance per attribute (1.0 for every session but
/// an extra one, E5-4); it multiplies last, so at 1.0 not a bit of the chance changes. In a
/// season with match growth (E5-12 §3.4) the session may bank part of its development for his
/// matches and roll at the lower chance left; the dice are the same in number and order either
/// way. The dice fall in the same order as ever: the focus's attributes as written, then
/// fitness. Returns how many attributes went up.
fn develop(
    player: &mut Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    focus: &TrainingFocus,
    session: Session,
    rng: &mut impl Rng,
) -> u8 {
    let full = crate::playing_time::development_factor(player.playing_time);
    let gain = session_gain(player, plan, day, session, full);

    // The gate is read once, before any attribute moves, for the focus and the keeper's drill.
    let (open, gain) = gate(player, day, gain);
    let gain = match day.match_growth {
        Some(growth) if open => {
            let kept =
                crate::playing_time::development_factor_kept(player.playing_time, growth.share());
            let (_, kept_gain) = gate(player, day, session_gain(player, plan, day, session, kept));
            crate::match_growth::bank(player, focus, day.keeper_drill, gain, kept_gain)
        }
        _ => gain,
    };
    let mut gains = if open {
        apply_focus_gains(&mut player.attributes, focus, gain, rng)
    } else {
        0
    };
    apply_fitness_change(&mut player.fitness, focus, session.intensity_mult, rng);
    // The drill's dice fall after fitness's, so every other attribute and fitness land as they
    // would without it (E5-6 E56-4).
    if open
        && *focus != TrainingFocus::Recovery
        && let Some(drill) = day.keeper_drill
        && is_keeper(player)
    {
        gains += apply_keeper_drill(&mut player.attributes, &drill, gain, rng);
    }

    // Refresh position-weighted OVR and traits after attribute gains.
    refresh_player_derived(player, day.year);
    gains
}

/// The gate and the chance of a session under a growth cap (E55-3): a player with a brake
/// develops only under his ceiling, at a chance no higher than his pace there; one without (25 and
/// over, or a potential at most the cap's base) takes the gate and the chance as they were, so
/// not a bit of his session changes. Never takes an attribute away (E55-4).
fn braked(player: &Player, cap: &GrowthCap, age: u32, gain: f64) -> (bool, f64) {
    let potential = player.potential;
    if cap.brake(potential, age) == 0 {
        return (potential > player.ovr, gain);
    }
    let open = player.ovr < cap.ceiling(potential, age);
    let pace = cap.pace(player.ovr, potential, age);
    // Far from the ceiling the pace is 1 and the chance stays whole, so a fast developer's
    // half-chance attributes rise as today (E55-3).
    let gain = if pace < 1.0 { gain.min(pace) } else { gain };
    (open, gain)
}

pub(crate) fn is_keeper(player: &Player) -> bool {
    crate::player_rating::primary_position(player) == domain::player::Position::Goalkeeper
}

/// The keeper's drill of one session (E5-6 E56-3): handling, reflexes, aerial in that order, each
/// at its permille of a focus attribute's chance, that chance taken no higher than certain so a
/// fast developer's drill never outruns the target.
fn apply_keeper_drill(
    attrs: &mut PlayerAttributes,
    drill: &KeeperDrill,
    gain: f64,
    rng: &mut impl Rng,
) -> u8 {
    let chance = |permille: u16| f64::from(permille) / 1000.0 * gain.min(1.0);
    let mut rose = 0;
    for (attribute, permille) in [
        (&mut attrs.handling, drill.handling_permille),
        (&mut attrs.reflexes, drill.reflexes_permille),
        (&mut attrs.aerial, drill.aerial_permille),
    ] {
        rose += u8::from(try_gain(attribute, chance(permille), rng));
    }
    rose
}

/// The focuses a session can build, in the enum's order (ties go by it).
const BUILDING_FOCUSES: [TrainingFocus; 5] = [
    TrainingFocus::Physical,
    TrainingFocus::Technical,
    TrainingFocus::Tactical,
    TrainingFocus::Defending,
    TrainingFocus::Attacking,
];

/// One attribute a focus rolls (`apply_focus_gains`): at the session's chance or half of it,
/// and whether it is one of the seven split attributes (`try_gain_split`).
pub(crate) struct FocusRoll {
    pub key: &'static str,
    pub half: bool,
    pub split: bool,
}

const fn roll(key: &'static str, half: bool, split: bool) -> FocusRoll {
    FocusRoll { key, half, split }
}

const PHYSICAL_ROLLS: [FocusRoll; 4] = [
    roll("pace", false, false),
    roll("stamina", false, false),
    roll("strength", false, false),
    roll("agility", false, false),
];
// Each split attribute trains in the focus of the blend it came out of, so a position's OVR
// grows at the same speed (phase 2, rule R1).
const TECHNICAL_ROLLS: [FocusRoll; 9] = [
    roll("passing", false, false),
    roll("shooting", false, false),
    roll("dribbling", false, false),
    roll("long_passing", false, true),
    roll("crossing", false, true),
    roll("curve", false, true),
    roll("free_kick", false, true),
    roll("long_shots", false, true),
    roll("first_touch", false, true),
];
const TACTICAL_ROLLS: [FocusRoll; 4] = [
    roll("positioning", false, false),
    roll("vision", false, false),
    roll("decisions", false, false),
    roll("composure", false, false),
];
const DEFENDING_ROLLS: [FocusRoll; 5] = [
    roll("tackling", false, false),
    roll("defending", false, false),
    roll("strength", true, false),
    roll("positioning", true, false),
    roll("heading", true, true),
];
const ATTACKING_ROLLS: [FocusRoll; 6] = [
    roll("shooting", false, false),
    roll("dribbling", false, false),
    roll("pace", true, false),
    roll("long_shots", false, true),
    roll("first_touch", false, true),
    roll("heading", true, true),
];

/// The attributes a session on `focus` rolls, in the order the dice fall.
pub(crate) fn focus_rolls(focus: &TrainingFocus) -> &'static [FocusRoll] {
    match focus {
        TrainingFocus::Physical => &PHYSICAL_ROLLS,
        TrainingFocus::Technical => &TECHNICAL_ROLLS,
        TrainingFocus::Tactical => &TACTICAL_ROLLS,
        TrainingFocus::Defending => &DEFENDING_ROLLS,
        TrainingFocus::Attacking => &ATTACKING_ROLLS,
        TrainingFocus::Recovery => &[],
    }
}

/// Whether a session can still raise `value`: under 99, and a split attribute only when the
/// player has it (`try_gain`, `try_gain_split`).
pub(crate) fn can_rise(value: u8, split: bool) -> bool {
    value < 99 && !(split && value == 0)
}

/// `attributes` with one point more on every attribute `focus` rolls that can still rise.
/// A half-chance attribute counts a whole point, as E54-13 measured.
fn one_more_of(attributes: &PlayerAttributes, focus: &TrainingFocus) -> PlayerAttributes {
    let mut a = attributes.clone();
    for roll in focus_rolls(focus) {
        if let Some(value) = attribute_mut(&mut a, roll.key)
            && can_rise(*value, roll.split)
        {
            *value += 1;
        }
    }
    a
}

fn rise_of(
    attributes: &PlayerAttributes,
    position: &domain::player::Position,
    focus: &TrainingFocus,
) -> f64 {
    use crate::player_rating::ovr_from_attributes;
    ovr_from_attributes(&one_more_of(attributes, focus), position)
        - ovr_from_attributes(attributes, position)
}

/// Rises closer than this are a tie.
const RISE_EPSILON: f64 = 1e-9;

/// How much `focus` lifts `player`'s OVR at his position if each attribute it rolls that can still
/// rise goes up by one (E54-13, E5-6 E56-6). It never reads his potential or a growth cap, and
/// leaves the keeper's drill out: the drill is the same under every focus.
pub fn focus_rise(player: &Player, focus: &TrainingFocus) -> f64 {
    let position = crate::player_rating::primary_position(player);
    rise_of(&player.attributes, &position, focus)
}

fn best_by(
    rise: impl Fn(&TrainingFocus) -> f64,
    keep: Option<&TrainingFocus>,
) -> Option<TrainingFocus> {
    let mut best: Option<(TrainingFocus, f64)> = keep
        .filter(|focus| **focus != TrainingFocus::Recovery)
        .map(|focus| (focus.clone(), rise(focus)));
    for focus in &BUILDING_FOCUSES {
        let value = rise(focus);
        if best
            .as_ref()
            .is_none_or(|(_, top)| value > top + RISE_EPSILON)
        {
            best = Some((focus.clone(), value));
        }
    }
    best.filter(|(_, top)| *top > RISE_EPSILON)
        .map(|(focus, _)| focus)
}

/// The focus (never Recovery) with the largest [`focus_rise`]; a tie keeps `keep` when given,
/// then goes by the enum's order; None when no focus lifts his OVR at all.
pub fn best_focus(player: &Player, keep: Option<&TrainingFocus>) -> Option<TrainingFocus> {
    best_by(|focus| focus_rise(player, focus), keep)
}

/// How a player's focus does against the best one (E5-6 PD-F-A).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusVerdict {
    /// The focus that lifts his OVR most (or as much).
    Best,
    /// At least `FAIR_PERMILLE` of the best one's lift.
    Fair,
    /// Less than that.
    Poor,
    /// It lifts his OVR not at all while another focus would.
    Nothing,
    /// Recovery: nothing to build, by choice.
    Resting,
}

/// A player's focus, the best one, and how the first does against the second.
#[derive(Debug, Clone, PartialEq)]
pub struct FocusFit {
    pub current: TrainingFocus,
    /// None when no focus lifts his OVR.
    pub best: Option<TrainingFocus>,
    pub verdict: FocusVerdict,
}

/// A focus is fair at this share of the best focus's lift or more (Qe56-3).
pub const FAIR_PERMILLE: u32 = 700;

fn fit_by(rise: impl Fn(&TrainingFocus) -> f64, current: TrainingFocus) -> FocusFit {
    let best = best_by(&rise, Some(&current));
    let verdict = if current == TrainingFocus::Recovery {
        FocusVerdict::Resting
    } else {
        let mine = rise(&current);
        let top = best.as_ref().map_or(0.0, &rise);
        if mine <= RISE_EPSILON {
            FocusVerdict::Nothing
        } else if mine + RISE_EPSILON >= top {
            FocusVerdict::Best
        } else if mine * 1000.0 + RISE_EPSILON >= top * f64::from(FAIR_PERMILLE) {
            FocusVerdict::Fair
        } else {
            FocusVerdict::Poor
        }
    };
    FocusFit {
        current,
        best,
        verdict,
    }
}

/// How `player`'s focus under `plan` does against the best one for him (E5-6 E56-7). It reads
/// his position and attributes only, never his potential or a growth cap.
pub fn focus_fit(player: &Player, plan: &TeamTrainingPlan) -> FocusFit {
    fit_by(
        |focus| focus_rise(player, focus),
        planned_focus(player, plan),
    )
}

/// [`focus_fit`] for an academy youngster, whose attributes are not public: by his position's
/// weights alone, as if every attribute could still rise.
pub fn focus_fit_by_position(
    position: &domain::player::Position,
    current: &TrainingFocus,
) -> FocusFit {
    let attributes = every_attribute_at(50);
    fit_by(
        |focus| rise_of(&attributes, position, focus),
        current.clone(),
    )
}

/// Every attribute at `value`: a player with room everywhere, for weights alone.
fn every_attribute_at(value: u8) -> PlayerAttributes {
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

/// Whether a session on `focus` can lift `player`'s OVR (E5-6 E56-8): an attribute it rolls, or
/// the keeper's drill rolls, that can still rise and weighs at his position.
pub fn session_builds(player: &Player, focus: &TrainingFocus, drill: Option<KeeperDrill>) -> bool {
    if focus_rise(player, focus) > RISE_EPSILON {
        return true;
    }
    let Some(drill) = drill else {
        return false;
    };
    if *focus == TrainingFocus::Recovery || !is_keeper(player) {
        return false;
    }
    let position = crate::player_rating::primary_position(player);
    let now = crate::player_rating::ovr_from_attributes(&player.attributes, &position);
    let a = &player.attributes;
    [
        (a.handling, drill.handling_permille),
        (a.reflexes, drill.reflexes_permille),
        (a.aerial, drill.aerial_permille),
    ]
    .iter()
    .enumerate()
    .any(|(slot, (value, permille))| {
        if *value >= 99 || *permille == 0 {
            return false;
        }
        let mut lifted = player.attributes.clone();
        match slot {
            0 => lifted.handling += 1,
            1 => lifted.reflexes += 1,
            _ => lifted.aerial += 1,
        }
        crate::player_rating::ovr_from_attributes(&lifted, &position) > now + RISE_EPSILON
    })
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
    /// Nothing his session rolls can still rise and count at his position (E5-6 E56-8): the
    /// session would only cost condition.
    FocusMaxed,
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
    drill: Option<KeeperDrill>,
) -> Option<SitOut> {
    if player.injury.is_some() {
        return Some(SitOut::Injured);
    }
    if player.condition < params.floor {
        return Some(SitOut::Tired);
    }
    let focus = planned_focus(player, plan);
    if focus == TrainingFocus::Recovery {
        Some(SitOut::Resting)
    } else if player.ovr >= player.potential {
        Some(SitOut::Peaked)
    } else if !session_builds(player, &focus, drill) {
        Some(SitOut::FocusMaxed)
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
    if let Some(why) = extra_sit_out(player, plan, params, day.keeper_drill) {
        return ExtraOutcome {
            sat_out: Some(why),
            condition_before,
            condition_after: condition_before,
            gains: 0,
        };
    }
    let focus = planned_focus(player, plan);
    let dev_scale = f64::from(params.dev_permille) / 1000.0;
    // An extra session banks for matches as the day's does (Qe512-1).
    let gains = develop(
        player,
        plan,
        day,
        &focus,
        Session {
            intensity_mult: intensity_mult(&intensity),
            dev_scale,
        },
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
/// rolled in the order written (`focus_rolls`), every roll counted, so the dice fall as they
/// always have.
fn apply_focus_gains(
    attrs: &mut PlayerAttributes,
    focus: &TrainingFocus,
    gain: f64,
    rng: &mut impl Rng,
) -> u8 {
    let mut rose = 0;
    for roll in focus_rolls(focus) {
        let chance = if roll.half { gain * 0.5 } else { gain };
        let Some(current) = attribute_mut(attrs, roll.key) else {
            continue;
        };
        let up = if roll.split {
            try_gain_split(current, chance, rng)
        } else {
            try_gain(current, chance, rng)
        };
        rose += u8::from(up);
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
            keeper_drill: None,
            growth_cap: None,
            match_growth: None,
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
            keeper_drill: None,
            growth_cap: None,
            match_growth: None,
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
        days_fingerprint(grid(), None)
    }

    /// The grid's players as goalkeepers: the drill's grid (E5-6 T4c).
    fn keeper_grid() -> Vec<Player> {
        grid()
            .into_iter()
            .map(|mut player| {
                player.position = Position::Goalkeeper;
                player.natural_position = Position::Goalkeeper;
                player
            })
            .collect()
    }

    fn days_fingerprint(players: Vec<Player>, drill: Option<KeeperDrill>) -> u64 {
        capped_days_fingerprint(players, drill, None)
    }

    fn capped_days_fingerprint(
        players: Vec<Player>,
        drill: Option<KeeperDrill>,
        cap: Option<GrowthCap>,
    ) -> u64 {
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
                            let day = TrainingDay {
                                keeper_drill: drill,
                                growth_cap: cap,
                                match_growth: None,
                                ..online_day(weekday)
                            };
                            for (index, player) in players.clone().into_iter().enumerate() {
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

    /// Given the grid, then the grid with the keeper's drill on, then the grid as goalkeepers,
    /// when every existing kind of day is held,
    /// then the outfield grid is the same number either way (the drill is a keeper's alone), and
    /// the keepers without the drill are the number pinned from `staging` before E5-6a (T4).
    #[test]
    fn the_keeper_s_drill_leaves_every_existing_day_as_it_was() {
        assert_eq!(
            days_fingerprint(grid(), Some(KeeperDrill::PROPOSED)),
            510_125_767_469_623_704
        );
        assert_eq!(
            days_fingerprint(keeper_grid(), None),
            5_820_658_210_097_898_736
        );
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
                    extra_sit_out(&pressed, &plan, &ExtraParams::PROPOSED, None),
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
            extra_sit_out(&young_player(59, false), &plan, &high_floor, None),
            Some(SitOut::Tired)
        );
        assert_eq!(
            extra_sit_out(&young_player(60, false), &plan, &high_floor, None),
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

    // ---- E5-6a: the keeper's drill, the best focus, FocusMaxed, "Auto" ----

    /// A goalkeeper of 18, every attribute 60, potential 85, rated at his position.
    fn keeper() -> Player {
        let mut player = young_player(80, false);
        player.position = Position::Goalkeeper;
        player.natural_position = Position::Goalkeeper;
        player.attributes = uniform_attributes(60);
        player.potential = 0;
        refresh_player_derived(&mut player, 2026);
        player.potential = 85;
        player
    }

    /// A player of 18 at `position`, every attribute `value`, potential 95, rated there.
    fn player_at(position: Position, value: u8) -> Player {
        let mut player = young_player(80, false);
        player.position = position.clone();
        player.natural_position = position;
        player.attributes = uniform_attributes(value);
        player.potential = 0;
        refresh_player_derived(&mut player, 2026);
        player.potential = 95;
        player
    }

    fn plan_on(focus: TrainingFocus) -> TeamTrainingPlan {
        let mut plan = online_plan(TrainingSchedule::Intense, TrainingIntensity::Medium);
        plan.default_focus = focus;
        plan
    }

    fn day_with(drill: Option<KeeperDrill>) -> TrainingDay {
        TrainingDay {
            keeper_drill: drill,
            growth_cap: None,
            match_growth: None,
            ..online_day(1)
        }
    }

    /// `player` after one session of `kind` on `focus`, and the next die his stream gives.
    fn session_of(
        player: &Player,
        focus: TrainingFocus,
        kind: SessionKind,
        drill: Option<KeeperDrill>,
    ) -> (serde_json::Value, u64) {
        use rand::RngExt;
        let mut trained = player.clone();
        let mut dice = session_rng(21, "k", "2026-09-01");
        online_session(
            &mut trained,
            &plan_on(focus),
            &day_with(drill),
            kind,
            &mut dice,
        );
        (as_json(&trained), dice.random::<u64>())
    }

    /// Given the proposed drill, one chance over a focus attribute's, no chance at all, and one
    /// chance of a thousandth,
    /// when each is validated and the proposed one written as JSON,
    /// then only the second and third are refused, and the JSON is the ruleset's camelCase (T1).
    #[test]
    fn a_keeper_drill_is_checked_and_reads_as_the_ruleset_writes_it() {
        assert_eq!(KeeperDrill::PROPOSED.validate(), Ok(()));
        let over = KeeperDrill {
            reflexes_permille: 1001,
            ..KeeperDrill::PROPOSED
        };
        assert_eq!(over.validate(), Err(KeeperDrillIssue::OverAFocus));
        let none = KeeperDrill {
            handling_permille: 0,
            reflexes_permille: 0,
            aerial_permille: 0,
        };
        assert_eq!(none.validate(), Err(KeeperDrillIssue::AllZero));
        let one = KeeperDrill {
            aerial_permille: 1,
            ..none
        };
        assert_eq!(one.validate(), Ok(()));
        let json = r#"{"handlingPermille":300,"reflexesPermille":300,"aerialPermille":300}"#;
        assert_eq!(
            serde_json::to_string(&KeeperDrill::PROPOSED).expect("json"),
            json
        );
        assert_eq!(
            serde_json::from_str::<KeeperDrill>(json).expect("a drill"),
            KeeperDrill::PROPOSED
        );
    }

    /// Given a keeper on Recovery, on a rest day, injured, under the fatigue guard, and at his
    /// potential,
    /// when he trains with the drill and without,
    /// then he ends the same and his dice stand at the same place: the drill does not run (T2).
    #[test]
    fn the_drill_does_not_run_when_the_session_builds_nothing() {
        let mut injured = keeper();
        injured.injury = Some(domain::player::Injury {
            name: "Knock".into(),
            days_remaining: 3,
        });
        let mut tired = keeper();
        tired.condition = 39;
        let mut peaked = keeper();
        peaked.potential = peaked.ovr;
        let cases = [
            (keeper(), TrainingFocus::Recovery, SessionKind::Manual),
            (keeper(), TrainingFocus::Tactical, SessionKind::Rest),
            (injured, TrainingFocus::Tactical, SessionKind::Manual),
            (tired, TrainingFocus::Tactical, SessionKind::Manual),
            (peaked, TrainingFocus::Tactical, SessionKind::Manual),
        ];
        for (player, focus, kind) in cases {
            assert_eq!(
                session_of(&player, focus.clone(), kind, Some(KeeperDrill::PROPOSED)),
                session_of(&player, focus, kind, None),
            );
        }
    }

    /// How often handling goes up in 2,000 drills at `gain`.
    fn handling_rate(gain: f64) -> f64 {
        let mut rose = 0;
        for trial in 0..2000u32 {
            let mut attrs = uniform_attributes(50);
            let mut dice = session_rng(31, &format!("k{trial}"), "2026-09-01");
            apply_keeper_drill(&mut attrs, &KeeperDrill::PROPOSED, gain, &mut dice);
            rose += u32::from(attrs.handling > 50);
        }
        f64::from(rose) / 2000.0
    }

    /// Given the proposed drill,
    /// when it is rolled 2,000 times at a focus chance of 1, of 2.26 and of 0.5,
    /// then handling rises about 30 %, still about 30 % (never more than certain), and about
    /// 15 % of the time (T3).
    #[test]
    fn the_drill_follows_the_focus_chance_up_to_certain() {
        assert!((handling_rate(1.0) - 0.30).abs() < 0.04);
        assert!((handling_rate(2.26) - 0.30).abs() < 0.04);
        assert!((handling_rate(0.5) - 0.15).abs() < 0.04);
    }

    /// Given a keeper of 18 under a pace where a session's chance stays under one,
    /// when 2,000 extra sessions are held at devPermille 1000 and 500,
    /// then the drill at 500 rises about half as often: it takes the extra session's scale (T3).
    #[test]
    fn the_drill_takes_the_extra_session_s_scale() {
        let rate = |dev_permille: u32| {
            let params = ExtraParams {
                floor: 40,
                dev_permille,
            };
            let day = TrainingDay {
                development_multiplier: 16.0,
                ..day_with(Some(KeeperDrill::PROPOSED))
            };
            let mut rose = 0;
            for n in 1..=2000u32 {
                let mut player = keeper();
                let before = player.attributes.handling;
                let mut dice = extra_session_rng(5, "k", "2026-09-01", n);
                extra_session(
                    &mut player,
                    &plan_on(TrainingFocus::Tactical),
                    &day,
                    TrainingIntensity::Medium,
                    &params,
                    &mut dice,
                );
                rose += u32::from(player.attributes.handling > before);
            }
            f64::from(rose) / 2000.0
        };
        let (full, half) = (rate(1000), rate(500));
        assert!(full > 0.05 && full < 0.29, "a chance under certain: {full}");
        assert!(
            (half * 2.0 - full).abs() < 0.04,
            "{half} is about half of {full}"
        );
    }

    /// Given a keeper on each focus but Recovery, handling at 99 the second time,
    /// when he trains with the drill and without,
    /// then every attribute but handling, reflexes and aerial, and his fitness, are the same;
    /// the drill draws once for each of its attributes still under 99, after everything else (T5).
    #[test]
    fn the_drill_draws_after_everything_else() {
        use rand::RngExt;
        for handling in [60, 99] {
            for focus in BUILDING_FOCUSES {
                let mut player = keeper();
                player.attributes.handling = handling;
                let train = |drill| {
                    let mut trained = player.clone();
                    let mut dice = session_rng(41, "k", "2026-09-01");
                    online_session(
                        &mut trained,
                        &plan_on(focus.clone()),
                        &day_with(drill),
                        SessionKind::Manual,
                        &mut dice,
                    );
                    (trained, dice)
                };
                let (with, mut with_dice) = train(Some(KeeperDrill::PROPOSED));
                let (without, mut without_dice) = train(None);
                let outside = |p: &Player| {
                    let mut a = p.attributes.clone();
                    (a.handling, a.reflexes, a.aerial) = (0, 0, 0);
                    (serde_json::to_value(&a).expect("attributes"), p.fitness)
                };
                assert_eq!(outside(&with), outside(&without), "{focus:?}");
                let draws = if handling == 99 { 2 } else { 3 };
                for _ in 0..draws {
                    let _: u64 = without_dice.random();
                }
                assert_eq!(
                    with_dice.random::<u64>(),
                    without_dice.random::<u64>(),
                    "{focus:?}"
                );
            }
        }
    }

    /// The best focus as the E5-4b measurement chose it (E54-13), kept to check the rule against.
    fn measured_best_focus(player: &Player, current: &TrainingFocus) -> TrainingFocus {
        let rise = |focus: &TrainingFocus| focus_rise(player, focus);
        let mut best = (current.clone(), rise(current));
        for focus in &BUILDING_FOCUSES {
            let value = rise(focus);
            if value > best.1 + 1e-9 {
                best = (focus.clone(), value);
            }
        }
        best.0
    }

    /// Given 200 players, ten positions with seeded attributes (some at 99, some split ones at 0),
    /// when the best focus is chosen keeping each focus in turn,
    /// then it is the measurement's choice whenever some focus lifts OVR (T6); and a keeper of 60
    /// takes Tactical, a centre-back Defending.
    #[test]
    fn the_best_focus_is_the_measurement_s() {
        use rand::RngExt;
        let positions = [
            Position::Goalkeeper,
            Position::RightBack,
            Position::CenterBack,
            Position::LeftWingBack,
            Position::DefensiveMidfielder,
            Position::CentralMidfielder,
            Position::AttackingMidfielder,
            Position::LeftWinger,
            Position::RightMidfielder,
            Position::Striker,
        ];
        let mut dice = session_rng(51, "best", "focus");
        for position in positions {
            for _ in 0..20 {
                let mut player = player_at(position.clone(), 60);
                let a = &mut player.attributes;
                for value in [
                    &mut a.pace,
                    &mut a.stamina,
                    &mut a.strength,
                    &mut a.passing,
                    &mut a.shooting,
                    &mut a.tackling,
                    &mut a.dribbling,
                    &mut a.defending,
                    &mut a.positioning,
                    &mut a.vision,
                    &mut a.decisions,
                    &mut a.composure,
                    &mut a.handling,
                    &mut a.reflexes,
                ] {
                    *value = if dice.random_bool(0.2) {
                        99
                    } else {
                        dice.random_range(30..99)
                    };
                }
                for value in [&mut a.crossing, &mut a.curve, &mut a.heading] {
                    *value = if dice.random_bool(0.3) {
                        0
                    } else {
                        dice.random_range(30..=99)
                    };
                }
                for current in &BUILDING_FOCUSES {
                    let chosen = best_focus(&player, Some(current));
                    let measured = measured_best_focus(&player, current);
                    assert_eq!(chosen.clone().unwrap_or(current.clone()), measured);
                }
            }
        }
        assert_eq!(
            best_focus(&player_at(Position::Goalkeeper, 60), None),
            Some(TrainingFocus::Tactical)
        );
        assert_eq!(
            best_focus(&player_at(Position::CenterBack, 60), None),
            Some(TrainingFocus::Defending)
        );
    }

    fn fit_on(player: &Player, focus: TrainingFocus) -> FocusFit {
        focus_fit(player, &plan_on(focus))
    }

    /// Given a central midfielder on Technical, a full-back on Tactical, a keeper on Attacking,
    /// anyone on Recovery, and a keeper with every weighted attribute at 99,
    /// when their focus is judged,
    /// then fair, poor, nothing, resting, and no best focus at all (T7).
    #[test]
    fn a_focus_is_judged_against_the_best_one() {
        let midfielder = player_at(Position::CentralMidfielder, 60);
        assert_eq!(
            fit_on(&midfielder, TrainingFocus::Technical).verdict,
            FocusVerdict::Fair
        );
        assert_eq!(
            fit_on(&midfielder, TrainingFocus::Tactical).verdict,
            FocusVerdict::Best
        );
        let full_back = player_at(Position::RightBack, 60);
        assert_eq!(
            fit_on(&full_back, TrainingFocus::Tactical).verdict,
            FocusVerdict::Poor
        );
        let keeper = player_at(Position::Goalkeeper, 60);
        let attacking = fit_on(&keeper, TrainingFocus::Attacking);
        assert_eq!(attacking.verdict, FocusVerdict::Nothing);
        assert_eq!(attacking.best, Some(TrainingFocus::Tactical));
        assert_eq!(
            fit_on(&keeper, TrainingFocus::Recovery).verdict,
            FocusVerdict::Resting
        );
        let full = player_at(Position::Goalkeeper, 99);
        assert_eq!(fit_on(&full, TrainingFocus::Tactical).best, None);
    }

    /// Given only a position,
    /// when the academy's focus is judged by weights alone,
    /// then a centre-back's best is Defending, a winger's Attacking, a keeper's Tactical (T8).
    #[test]
    fn an_academy_focus_is_judged_by_position_alone() {
        let best = |position| focus_fit_by_position(&position, &TrainingFocus::Physical).best;
        assert_eq!(best(Position::CenterBack), Some(TrainingFocus::Defending));
        assert_eq!(best(Position::RightWinger), Some(TrainingFocus::Attacking));
        assert_eq!(best(Position::Goalkeeper), Some(TrainingFocus::Tactical));
    }

    /// Given a club on "Auto" and a centre-back with no focus or group, one in a group, and one
    /// with his own focus,
    /// when their focus is read,
    /// then the first trains his best focus, the others their group's and their own (T9).
    #[test]
    fn auto_gives_the_best_focus_to_who_has_no_other() {
        let mut plan = plan_on(TrainingFocus::Physical);
        plan.auto_focus = true;
        let free = player_at(Position::CenterBack, 60);
        assert_eq!(planned_focus(&free, &plan), TrainingFocus::Defending);
        let mut grouped = free.clone();
        grouped.id = "grouped".into();
        plan.group_overrides
            .insert("grouped".into(), TrainingFocus::Technical);
        assert_eq!(planned_focus(&grouped, &plan), TrainingFocus::Technical);
        let mut own = free.clone();
        own.training_focus = Some(TrainingFocus::Attacking);
        assert_eq!(planned_focus(&own, &plan), TrainingFocus::Attacking);
        plan.auto_focus = false;
        assert_eq!(planned_focus(&free, &plan), TrainingFocus::Physical);
    }

    /// Given a club on "Auto" and a centre-back whose Defending focus has one point left, his
    /// chance certain,
    /// when three extra sessions are pressed,
    /// then the first takes his last Defending point and the next ones train another focus (T9).
    #[test]
    fn auto_moves_on_once_a_focus_is_full() {
        let mut plan = plan_on(TrainingFocus::Physical);
        plan.auto_focus = true;
        let mut player = player_at(Position::CenterBack, 60);
        let a = &mut player.attributes;
        (
            a.tackling,
            a.defending,
            a.strength,
            a.positioning,
            a.heading,
        ) = (98, 99, 99, 99, 99);
        player.potential = 99;
        let day = TrainingDay {
            development_multiplier: 100.0,
            ..day_with(None)
        };
        assert_eq!(planned_focus(&player, &plan), TrainingFocus::Defending);
        let mut seen = Vec::new();
        for n in 1..=3 {
            seen.push(planned_focus(&player, &plan));
            extra_session(
                &mut player,
                &plan,
                &day,
                TrainingIntensity::High,
                &ExtraParams::PROPOSED,
                &mut extra_session_rng(6, "cb", "2026-09-01", n),
            );
        }
        assert_eq!(player.attributes.tackling, 99);
        assert_eq!(seen[0], TrainingFocus::Defending);
        assert_ne!(seen[1], TrainingFocus::Defending);
    }

    /// Given a full-back on Tactical with every Tactical attribute at 99, a keeper on Attacking
    /// with and without the drill, and a player at his potential,
    /// when the extra session's sit-out is read,
    /// then the full-back's focus is maxed, the keeper's too without the drill and not with it,
    /// and the peaked player is Peaked first; a maxed player is left as he was, no die cast (T10).
    #[test]
    fn a_session_that_cannot_lift_ovr_sits_out() {
        let mut full_back = player_at(Position::RightBack, 60);
        let a = &mut full_back.attributes;
        (a.positioning, a.vision, a.decisions, a.composure) = (99, 99, 99, 99);
        let tactical = plan_on(TrainingFocus::Tactical);
        let params = ExtraParams::PROPOSED;
        assert_eq!(
            extra_sit_out(&full_back, &tactical, &params, None),
            Some(SitOut::FocusMaxed)
        );
        let keeper = player_at(Position::Goalkeeper, 60);
        let attacking = plan_on(TrainingFocus::Attacking);
        assert_eq!(
            extra_sit_out(&keeper, &attacking, &params, None),
            Some(SitOut::FocusMaxed)
        );
        assert_eq!(
            extra_sit_out(&keeper, &attacking, &params, Some(KeeperDrill::PROPOSED)),
            None
        );
        let mut peaked = full_back.clone();
        peaked.potential = peaked.ovr;
        assert_eq!(
            extra_sit_out(&peaked, &tactical, &params, None),
            Some(SitOut::Peaked)
        );
        use rand::RngExt;
        let mut sitting = full_back.clone();
        let mut dice = extra_session_rng(7, "fb", "2026-09-01", 1);
        let outcome = extra_session(
            &mut sitting,
            &tactical,
            &day_with(None),
            TrainingIntensity::High,
            &params,
            &mut dice,
        );
        assert_eq!(outcome.sat_out, Some(SitOut::FocusMaxed));
        assert_eq!(as_json(&sitting), as_json(&full_back));
        assert_eq!(
            dice.random::<u64>(),
            extra_session_rng(7, "fb", "2026-09-01", 1).random::<u64>()
        );
    }

    /// The proposed growth cap on an online day: the season's brake on young stars (E5-5).
    fn capped_day(development_multiplier: f64) -> TrainingDay {
        TrainingDay {
            development_multiplier,
            growth_cap: Some(GrowthCap::PROPOSED),
            ..online_day(2)
        }
    }

    /// A fresh 18-year-old on 2026-09-01 with every attribute at `attribute`, OVR refreshed, and
    /// `potential`.
    fn star(attribute: u8, potential: u8) -> Player {
        let mut player = young_player(100, false);
        player.attributes = uniform_attributes(attribute);
        refresh_player_derived(&mut player, 2026);
        player.potential = potential;
        player
    }

    /// Given an 18-year-old of potential 93 on his ceiling (81), and one above it (85),
    /// when a High session and an extra session are held under the proposed cap,
    /// then no attribute moves either way, condition is still paid, and his potential stays 93
    /// (E5-5 T4, E55-4).
    #[test]
    fn a_player_on_his_ceiling_stands_still() {
        for attribute in [81, 85] {
            let mut player = star(attribute, 93);
            assert_eq!(player.ovr, attribute, "the test's player is rated as built");
            let before = player.attributes.clone();
            let plan = online_plan(TrainingSchedule::Intense, TrainingIntensity::High);
            train_player(
                &mut player,
                &plan,
                &capped_day(100.0),
                &mut session_rng(1, "s", "d"),
            );
            assert_eq!(
                as_json_attributes(&player),
                serde_json::to_value(&before).expect("a")
            );
            assert_eq!(player.potential, 93);
            assert_eq!(
                player.condition,
                100 - cost_of(&TrainingIntensity::High) + 3
            );

            let mut pressed = star(attribute, 93);
            let outcome = extra_session(
                &mut pressed,
                &plan,
                &capped_day(100.0),
                TrainingIntensity::High,
                &ExtraParams::PROPOSED,
                &mut extra_session_rng(1, "s", "d", 1),
            );
            assert!(outcome.sat_out.is_none());
            assert_eq!(
                as_json_attributes(&pressed),
                serde_json::to_value(&before).expect("a")
            );
            assert_eq!(pressed.condition, 100 - cost_of(&TrainingIntensity::High));
            assert_eq!(pressed.potential, 93);
        }
    }

    fn as_json_attributes(player: &Player) -> serde_json::Value {
        serde_json::to_value(&player.attributes).expect("attributes")
    }

    /// Given a star on his age ceiling and one on his potential,
    /// when the reason to sit an extra session out is read,
    /// then the first takes part (the cap is never shown) and the second is Peaked as ever
    /// (E5-5 T5, E55-5).
    #[test]
    fn the_age_ceiling_is_never_a_reason_to_sit_out() {
        let plan = online_plan(TrainingSchedule::Balanced, TrainingIntensity::Medium);
        let on_ceiling = star(81, 93);
        assert_eq!(
            extra_sit_out(&on_ceiling, &plan, &ExtraParams::PROPOSED, None),
            None
        );
        let peaked = star(81, 81);
        assert_eq!(
            extra_sit_out(&peaked, &plan, &ExtraParams::PROPOSED, None),
            Some(SitOut::Peaked)
        );
    }

    /// Given a star 20 under his ceiling (pace 0,5) and one far under it (pace 1),
    /// when the session's chance is braked,
    /// then a sure chance falls to the pace, a far one keeps its whole chance, and a chance
    /// already under the pace is not cut again (E5-5 T6, E55-3: min, never a product).
    #[test]
    fn the_brake_takes_the_lower_of_the_chance_and_the_pace() {
        let close = |a: f64, b: f64| (a - b).abs() < 1e-9;
        let cap = GrowthCap::PROPOSED;
        let (open, gain) = braked(&star(61, 93), &cap, 18, 2.26);
        assert!(open);
        assert!(close(gain, 0.5));
        let (open, gain) = braked(&star(61, 93), &cap, 18, 0.3);
        assert!(open);
        assert!(close(gain, 0.3));
        let (open, gain) = braked(&star(30, 93), &cap, 18, 2.26);
        assert!(open);
        assert!(close(gain, 2.26));
        let (open, _) = braked(&star(81, 93), &cap, 18, 2.26);
        assert!(!open);
    }

    /// Given a star 20 under his ceiling, whose chance is sure without the cap,
    /// when 2.000 Tactical sessions are held under the cap,
    /// then about half of each attribute's rolls rise, not all of them; and a star far under it on
    /// Defending still raises his half-chance attributes every time (E5-5 T6).
    #[test]
    fn a_star_near_his_ceiling_rises_at_his_pace() {
        let plan = online_plan(TrainingSchedule::Intense, TrainingIntensity::High);
        let day = capped_day(100.0);
        let mut rises = 0;
        for n in 0..2000 {
            let mut player = star(61, 93);
            let mut dice = session_rng(n, "s", "d");
            rises += u32::from(develop(
                &mut player,
                &plan,
                &day,
                &TrainingFocus::Tactical,
                Session {
                    intensity_mult: 1.5,
                    dev_scale: 1.0,
                },
                &mut dice,
            ));
        }
        let rate = f64::from(rises) / (2000.0 * 4.0);
        assert!((rate - 0.5).abs() < 0.03, "rate {rate}");

        for n in 0..50 {
            let mut player = star(30, 93);
            let strength = player.attributes.strength;
            develop(
                &mut player,
                &plan,
                &day,
                &TrainingFocus::Defending,
                Session {
                    intensity_mult: 1.5,
                    dev_scale: 1.0,
                },
                &mut session_rng(n, "s", "d"),
            );
            assert_eq!(player.attributes.strength, strength + 1);
        }
    }

    /// Given the fingerprint's grid as grown players, as players of potential 65 and as players
    /// of potential 70 at 24, none with a brake,
    /// when every existing kind of day is held with the proposed cap and without it,
    /// then both give the same number: an unbraked player develops as today to the bit
    /// (E5-5 T7, T8).
    #[test]
    fn players_without_a_brake_develop_as_they_did() {
        assert_eq!(existing_days_fingerprint(), 510_125_767_469_623_704);
        let regrown = |dob: &'static str, attribute: u8, potential: u8| {
            grid()
                .into_iter()
                .map(|mut player| {
                    player.date_of_birth = dob.into();
                    player.attributes = uniform_attributes(attribute);
                    refresh_player_derived(&mut player, 2026);
                    player.potential = potential;
                    player
                })
                .collect::<Vec<_>>()
        };
        for players in [
            regrown("2000-03-01", 70, 95),
            regrown("2008-03-01", 60, 65),
            regrown("2002-03-01", 60, 70),
        ] {
            assert_eq!(
                capped_days_fingerprint(players.clone(), None, Some(GrowthCap::PROPOSED)),
                capped_days_fingerprint(players, None, None)
            );
        }
    }
}
