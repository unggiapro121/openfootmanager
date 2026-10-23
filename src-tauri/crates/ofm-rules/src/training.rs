//! One training session of one player (phase 3, E3-5b): what it costs him, what it gives back,
//! and what it builds, by the club's plan, its staff and its facilities. Shared with the online
//! server, whose daily job runs it for every club (Q6); `ofm_core::training` runs it for a save.
//! The coaching bonus is read off the club's staff as passed in, the taper off its calendar by
//! the caller.

use crate::player_rating::refresh_player_derived;
use domain::player::{Player, PlayerAttributes};
use domain::staff::{CoachingSpecialization, Staff, StaffRole};
use domain::team::{TrainingFocus, TrainingIntensity, TrainingSchedule};
use rand::Rng;

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

    // The taper: with a fixture close, today's session runs one step lighter than
    // the manager's standing setting. The setting itself is untouched — the club's
    // stored plan is the manager's, and a taper is not a change of plan.
    let intensity = match plan.taper {
        Some(Taper::Congested) if is_training_day => TrainingIntensity::Low,
        Some(Taper::NearMatch) if is_training_day => downgrade_intensity(&plan.intensity),
        _ => plan.intensity.clone(),
    };
    let intensity_mult = match &intensity {
        TrainingIntensity::Low => 0.5,
        TrainingIntensity::Medium => 1.0,
        TrainingIntensity::High => 1.5,
    };

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
    let recovery_focus = TrainingFocus::Recovery;
    let is_resting = is_training_day
        && player.injury.is_none()
        && (player.condition < FATIGUE_GUARD_CONDITION
            || (plan.taper.is_some() && intensity == TrainingIntensity::Low));
    let player_focus = if is_resting {
        &recovery_focus
    } else {
        // Determine this player's effective focus:
        // player override > group override > team default
        player
            .training_focus
            .as_ref()
            .or_else(|| plan.group_overrides.get(&player.id))
            .unwrap_or(&plan.default_focus)
    };

    // On rest days or Recovery focus: no training cost
    let condition_cost: u8 = if !is_training_day {
        0
    } else {
        match (player_focus, &intensity) {
            (TrainingFocus::Recovery, _) => 0,
            (_, TrainingIntensity::Low) => 3,
            (_, TrainingIntensity::Medium) => 6,
            (_, TrainingIntensity::High) => 10,
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
    let age =
        crate::age::age_on(&player.date_of_birth, &day.date).map_or(25, |age| age.max(0) as u32);
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

    // Age factor for attribute gains: younger players grow faster, older players slower
    let age_factor = age_factor(age);

    // Base gain per attribute per session, boosted by coaching staff and the
    // training facility, held back for a player who is not getting games, and
    // nudged by how well he is playing.
    let gain = BASE_TRAINING_GAIN
        * day.development_multiplier
        * intensity_mult
        * age_factor
        * plan.bonus.coaching_mult
        * plan.bonus.specialization_mult
        * plan.training_facility_mult
        * crate::playing_time::development_factor(player.playing_time)
        * crate::match_form::development_factor(player.match_form);

    // Peaked players (ovr == potential) get no attribute gains. Without this
    // gate, attribute drift lifts ovr, and `refresh_player_derived`'s
    // `potential = max(potential, ovr)` invariant silently raises the career
    // ceiling in lockstep — the ceiling stops being a ceiling.
    if player.potential > player.ovr {
        apply_focus_gains(&mut player.attributes, player_focus, gain, rng);
    }
    apply_fitness_change(&mut player.fitness, player_focus, intensity_mult, rng);

    // Refresh position-weighted OVR and traits after attribute gains.
    refresh_player_derived(player, day.year);

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
        condition = rest_day_condition(player, condition, age, physio_mult, medical_mult);
    }
    let next_day =
        rest_day_condition(player, condition, age, physio_mult, medical_mult) - condition;
    let share = u32::from(next_day) * (hours % 24) / 24;
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
fn try_gain_split(current: &mut u8, gain: f64, rng: &mut impl Rng) {
    if *current != 0 {
        try_gain(current, gain, rng);
    }
}

fn try_gain(current: &mut u8, gain: f64, rng: &mut impl Rng) {
    use rand::RngExt;
    if *current >= 99 {
        return;
    }
    let roll: f64 = rng.random_range(0.0..1.0);
    if roll < gain {
        *current = (*current + 1).min(99);
    }
}

/// Apply attribute gains based on training focus.
fn apply_focus_gains(
    attrs: &mut PlayerAttributes,
    focus: &TrainingFocus,
    gain: f64,
    rng: &mut impl Rng,
) {
    match focus {
        TrainingFocus::Physical => {
            try_gain(&mut attrs.pace, gain, rng);
            try_gain(&mut attrs.stamina, gain, rng);
            try_gain(&mut attrs.strength, gain, rng);
            try_gain(&mut attrs.agility, gain, rng);
        }
        TrainingFocus::Technical => {
            try_gain(&mut attrs.passing, gain, rng);
            try_gain(&mut attrs.shooting, gain, rng);
            try_gain(&mut attrs.dribbling, gain, rng);
            // Each split attribute trains in the focus of the blend it came out
            // of, so a position's OVR grows at the same speed (phase 2, rule R1).
            try_gain_split(&mut attrs.long_passing, gain, rng);
            try_gain_split(&mut attrs.crossing, gain, rng);
            try_gain_split(&mut attrs.curve, gain, rng);
            try_gain_split(&mut attrs.free_kick, gain, rng);
            try_gain_split(&mut attrs.long_shots, gain, rng);
            try_gain_split(&mut attrs.first_touch, gain, rng);
        }
        TrainingFocus::Tactical => {
            try_gain(&mut attrs.positioning, gain, rng);
            try_gain(&mut attrs.vision, gain, rng);
            try_gain(&mut attrs.decisions, gain, rng);
            try_gain(&mut attrs.composure, gain, rng);
        }
        TrainingFocus::Defending => {
            try_gain(&mut attrs.tackling, gain, rng);
            try_gain(&mut attrs.defending, gain, rng);
            try_gain(&mut attrs.strength, gain * 0.5, rng);
            try_gain(&mut attrs.positioning, gain * 0.5, rng);
            try_gain_split(&mut attrs.heading, gain * 0.5, rng);
        }
        TrainingFocus::Attacking => {
            try_gain(&mut attrs.shooting, gain, rng);
            try_gain(&mut attrs.dribbling, gain, rng);
            try_gain(&mut attrs.pace, gain * 0.5, rng);
            try_gain_split(&mut attrs.long_shots, gain, rng);
            try_gain_split(&mut attrs.first_touch, gain, rng);
            try_gain_split(&mut attrs.heading, gain * 0.5, rng);
        }
        TrainingFocus::Recovery => {
            // No attribute gains on recovery days
        }
    }
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
    /// then half a day gives about half a day's recovery, nothing exceeds 100, and no rest
    /// leaves him as he was.
    #[test]
    fn rest_by_the_hour_is_proportional_and_capped() {
        let player = tired_player();
        let day = condition_after_rest(&player, 35, 27, (1.0, 1.0), 24) - 35;
        let half = condition_after_rest(&player, 35, 27, (1.0, 1.0), 12) - 35;
        assert_eq!(half, day / 2);
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
}
