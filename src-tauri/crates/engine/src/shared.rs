use rand::{Rng, RngExt};

use crate::knobs::CalibrationKnobs;

use crate::types::{
    BreakSpeed, CounterPressDuration, DefensiveLine, DefensiveShape, Foot, MarkingStyle,
    MatchConfig, PlayStyle, PlayerData, PlayerRole, Position, PressingIntensity, Side,
    TacticsConfig, TacticsPitchWidth, TeamData, Tempo,
};

// ---------------------------------------------------------------------------
// PlayerSnap — lightweight snapshot of a player to avoid borrow conflicts
// ---------------------------------------------------------------------------

#[derive(Clone)]
#[allow(dead_code)]
pub(crate) struct PlayerSnap {
    pub id: String,
    pub pace: u8,
    pub stamina: u8,
    pub strength: u8,
    pub agility: u8,
    pub passing: u8,
    pub shooting: u8,
    pub tackling: u8,
    pub dribbling: u8,
    pub defending: u8,
    pub positioning: u8,
    pub vision: u8,
    pub decisions: u8,
    pub composure: u8,
    pub aggression: u8,
    pub teamwork: u8,
    pub leadership: u8,
    pub handling: u8,
    pub reflexes: u8,
    pub aerial: u8,
    /// Heading technique: where a won header goes (phase 2, P2.2).
    pub heading: u8,
    /// Delivery from wide and from a corner (phase 2, P2.3).
    pub crossing: u8,
    pub curve: u8,
    /// Striking a dead ball at goal (phase 2, P2.4).
    pub free_kick: u8,
    /// Shooting from outside the box (phase 2, P2.5).
    pub long_shots: u8,
    /// A long ball: how often play is switched to the far flank (phase 2,
    /// P3.3).
    pub long_passing: u8,
    /// Meeting a low cross first time (phase 2, P3.4).
    pub first_touch: u8,
    pub height_cm: u16,
    /// His stronger foot (phase 2, P3.0); read by the wing play of P3.4.
    pub footedness: Foot,
    pub traits: Vec<String>,
    pub role: PlayerRole,
}

impl PlayerSnap {
    /// The pre-split blend of `dribbling` (see `legacy_blend`).
    pub fn legacy_dribbling(&self) -> u8 {
        crate::legacy_blend::legacy_dribbling(self.dribbling, self.first_touch)
    }

    /// Nobody — every attribute at zero and no id.
    ///
    /// A side with no players cannot play, and `simulate` refuses such a match
    /// before a single minute runs, so this should never reach a match report.
    /// It exists so that the picker has something to return instead of indexing
    /// an empty squad: a blank name in an event is a bug worth reporting, a
    /// panic in a Tauri command is a window that stops responding.
    pub fn nobody() -> Self {
        Self {
            id: String::new(),
            pace: 0,
            stamina: 0,
            strength: 0,
            agility: 0,
            passing: 0,
            shooting: 0,
            tackling: 0,
            dribbling: 0,
            defending: 0,
            positioning: 0,
            vision: 0,
            decisions: 0,
            composure: 0,
            aggression: 0,
            teamwork: 0,
            leadership: 0,
            handling: 0,
            reflexes: 0,
            aerial: 0,
            heading: 0,
            crossing: 0,
            curve: 0,
            free_kick: 0,
            long_shots: 0,
            long_passing: 0,
            first_touch: 0,
            height_cm: 0,
            footedness: Foot::Right,
            traits: Vec::new(),
            role: PlayerRole::Standard,
        }
    }

    pub fn from(p: &PlayerData) -> Self {
        Self {
            id: p.id.clone(),
            pace: p.pace,
            stamina: p.stamina,
            strength: p.strength,
            agility: p.agility,
            passing: p.passing,
            shooting: p.shooting,
            tackling: p.tackling,
            dribbling: p.dribbling,
            defending: p.defending,
            positioning: p.positioning,
            vision: p.vision,
            decisions: p.decisions,
            composure: p.composure,
            aggression: p.aggression,
            teamwork: p.teamwork,
            leadership: p.leadership,
            handling: p.handling,
            reflexes: p.reflexes,
            aerial: p.aerial,
            heading: p.heading,
            crossing: p.crossing,
            curve: p.curve,
            free_kick: p.free_kick,
            long_shots: p.long_shots,
            long_passing: p.long_passing,
            first_touch: p.first_touch,
            height_cm: p.height_cm,
            footedness: p.footedness,
            traits: p.traits.clone(),
            role: p.role,
        }
    }

    pub fn has_trait(&self, name: &str) -> bool {
        self.traits.iter().any(|t| t == name)
    }
}

// ---------------------------------------------------------------------------
// TraitContext — which game action context we're computing a bonus for
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub(crate) enum TraitContext {
    Shooting,
    Dribbling,
    Passing,
    Tackling,
    Goalkeeping,
    Foul,
    Midfield,
}

/// Compute a multiplicative trait bonus for a specific action context.
/// Returns a modifier >= 1.0 (bonus) based on relevant traits.
/// Pick a player from `players`, preferring `preferred` and skipping anyone
/// already sent off. `None` only when the side has nobody at all.
///
/// One definition on purpose. `engine` and `live_match` each carried a
/// byte-identical copy of this, and both ended with `players[0]` when the pool
/// came up empty — which is an index out of bounds on a club with no players.
/// That panic unwound out of the engine, through the day loop, and out of the
/// Tauri command running it, which then never returned a response at all.
pub(crate) fn snap_from_squad<R: Rng>(
    players: &[PlayerData],
    sent_off: &std::collections::HashSet<String>,
    preferred: Position,
    rng: &mut R,
) -> Option<PlayerSnap> {
    let available: Vec<&PlayerData> = players
        .iter()
        .filter(|player| !sent_off.contains(&player.id))
        .collect();
    let candidates: Vec<&PlayerData> = available
        .iter()
        .filter(|player| player.position == preferred)
        .copied()
        .collect();

    let pool = if candidates.is_empty() {
        &available
    } else {
        &candidates
    };
    if !pool.is_empty() {
        return Some(PlayerSnap::from(pool[rng.random_range(0..pool.len())]));
    }
    // Everyone available has been sent off: anyone on the teamsheet will do.
    players.first().map(PlayerSnap::from)
}

/// The player who meets a cross: a forward other than the one who crossed it,
/// a midfielder when no other forward is on, else any outfielder but him.
/// `None` only when the crosser is all his side has left.
pub(crate) fn snap_header_target<R: Rng>(
    players: &[PlayerData],
    sent_off: &std::collections::HashSet<String>,
    crosser_id: &str,
    rng: &mut R,
) -> Option<PlayerSnap> {
    let available: Vec<&PlayerData> = players
        .iter()
        .filter(|player| {
            !sent_off.contains(&player.id)
                && player.id != crosser_id
                && player.position != Position::Goalkeeper
        })
        .collect();
    for preferred in [Position::Forward, Position::Midfielder] {
        let pool: Vec<&PlayerData> = available
            .iter()
            .filter(|player| player.position == preferred)
            .copied()
            .collect();
        if !pool.is_empty() {
            return Some(PlayerSnap::from(pool[rng.random_range(0..pool.len())]));
        }
    }
    if available.is_empty() {
        None
    } else {
        Some(PlayerSnap::from(
            available[rng.random_range(0..available.len())],
        ))
    }
}

pub(crate) fn trait_bonus(snap: &PlayerSnap, context: TraitContext) -> f64 {
    let mut bonus = 1.0;
    match context {
        TraitContext::Shooting => {
            if snap.has_trait("Sharpshooter") {
                bonus *= 1.08;
            }
            if snap.has_trait("CoolHead") {
                bonus *= 1.04;
            }
            if snap.has_trait("CompleteForward") {
                bonus *= 1.05;
            }
        }
        TraitContext::Dribbling => {
            if snap.has_trait("Dribbler") {
                bonus *= 1.08;
            }
            if snap.has_trait("Speedster") {
                bonus *= 1.04;
            }
            if snap.has_trait("Agile") {
                bonus *= 1.04;
            }
        }
        TraitContext::Passing => {
            if snap.has_trait("Playmaker") {
                bonus *= 1.08;
            }
            if snap.has_trait("Visionary") {
                bonus *= 1.05;
            }
            // The set-piece specialist's passing edge carries over to the trait
            // that replaced him; its own set-piece effects arrive with P2.3–P2.4.
            if snap.has_trait("DeadBallSpecialist") {
                bonus *= 1.03;
            }
        }
        TraitContext::Tackling => {
            if snap.has_trait("BallWinner") {
                bonus *= 1.08;
            }
            if snap.has_trait("Rock") {
                bonus *= 1.05;
            }
            if snap.has_trait("Tank") {
                bonus *= 1.04;
            }
        }
        TraitContext::Goalkeeping => {
            if snap.has_trait("SafeHands") {
                bonus *= 1.08;
            }
            if snap.has_trait("CatReflexes") {
                bonus *= 1.06;
            }
            if snap.has_trait("AerialDominance") {
                bonus *= 1.04;
            }
        }
        TraitContext::Foul => {
            if snap.has_trait("HotHead") {
                bonus *= 1.25;
            }
            if snap.has_trait("CoolHead") {
                bonus *= 0.70;
            }
        }
        TraitContext::Midfield => {
            if snap.has_trait("Engine") {
                bonus *= 1.06;
            }
            if snap.has_trait("TeamPlayer") {
                bonus *= 1.04;
            }
            if snap.has_trait("Tireless") {
                bonus *= 1.03;
            }
        }
    }
    bonus
}

// ---------------------------------------------------------------------------
// Play-style modifiers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub(crate) enum PlayStylePhase {
    Midfield,
    Attack,
    Defense,
    Press,
}

/// The multiplier a side's play style puts on its rating in `phase`, as its
/// head coach gets the style across.
///
/// Applied to whichever side the phase belongs to, attacking or defending.
pub(crate) fn play_style_modifier(
    team: &TeamData,
    phase: PlayStylePhase,
    knobs: &CalibrationKnobs,
) -> f64 {
    coached_modifier(
        style_table(team.play_style, phase),
        team.coach.for_style(team.play_style),
        knobs,
    )
}

/// A phase of play a style can be priced in, as the outside world names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum StylePhase {
    Midfield,
    Attack,
    Defense,
    Press,
}

/// What `style` does to its side in each phase it changes, coached at
/// `mastery`: the very multipliers the match applies with the game's default
/// knobs, for display. Phases the style leaves at 1.0 are left out, so
/// Balanced has none.
pub fn play_style_effects(style: PlayStyle, mastery: u8) -> Vec<(StylePhase, f64)> {
    let knobs = CalibrationKnobs::default();
    [
        (StylePhase::Midfield, PlayStylePhase::Midfield),
        (StylePhase::Attack, PlayStylePhase::Attack),
        (StylePhase::Defense, PlayStylePhase::Defense),
        (StylePhase::Press, PlayStylePhase::Press),
    ]
    .into_iter()
    .filter_map(|(named, phase)| {
        let table_value = style_table(style, phase);
        (table_value != 1.0).then(|| (named, coached_modifier(table_value, mastery, &knobs)))
    })
    .collect()
}

/// The mastery curve's defaults, `k = MASTERY_K_BASE + mastery / MASTERY_K_SPAN`.
/// The knobs carry the values a match uses (`CalibrationKnobs::mastery_k_*`).
pub(crate) const MASTERY_K_BASE: f64 = 0.5;
pub(crate) const MASTERY_K_SPAN: f64 = 100.0;

/// Scale a style by how well the coach gets it across, `k = 0.5 + mastery/100`
/// with the default knobs:
/// the style's edge (a value above 1.0) by `k`, its cost (below 1.0) by `2 − k`.
/// A neutral coach (50) plays the table as it is; the best widens the edge by
/// half and halves the cost, the weakest the reverse.
///
/// Edge and cost move in opposite directions on purpose. Scaling both by `k`
/// was measured to make a better Counter, Defensive or HighPress coach *lose*
/// more: their cost lands on every possession, their edge on a single phase.
fn coached_modifier(table_value: f64, mastery: u8, knobs: &CalibrationKnobs) -> f64 {
    let k = knobs.mastery_k_base + f64::from(mastery.min(100)) / knobs.mastery_k_span;
    let scale = if table_value >= 1.0 { k } else { 2.0 - k };
    1.0 + (table_value - 1.0) * scale
}

/// What each play style is worth in each phase, with a neutral coach.
///
/// The defending side used to be passed a flag that returned a neutral 1.0, so
/// the Defense column was never read: Defensive paid its attacking penalty for
/// no defensive return, and Attacking and HighPress paid nothing for theirs.
fn style_table(style: PlayStyle, phase: PlayStylePhase) -> f64 {
    match (style, phase) {
        (PlayStyle::Attacking, PlayStylePhase::Attack) => 1.12,
        (PlayStyle::Attacking, PlayStylePhase::Defense) => 0.93,
        (PlayStyle::Defensive, PlayStylePhase::Defense) => 1.12,
        (PlayStyle::Defensive, PlayStylePhase::Attack) => 0.93,
        (PlayStyle::Possession, PlayStylePhase::Midfield) => 1.15,
        (PlayStyle::Possession, PlayStylePhase::Attack) => 0.97,
        (PlayStyle::Counter, PlayStylePhase::Attack) => 1.18,
        (PlayStyle::Counter, PlayStylePhase::Midfield) => 0.92,
        (PlayStyle::HighPress, PlayStylePhase::Press) => 1.20,
        (PlayStyle::HighPress, PlayStylePhase::Defense) => 0.95,
        _ => 1.0,
    }
}

// ---------------------------------------------------------------------------
// Role attribute modifier — applied per-player during zone resolution
// ---------------------------------------------------------------------------

/// Returns a multiplier (0.85–1.15) applied to the player's effective skill
/// calculation based on their assigned tactical role. Values reflect the
/// attribute biases described in domain::team::PlayerRole documentation.
/// The ball-playing keeper and centre back lost their midfield lifts at
/// P4.4: neither ever plays in midfield; they play out from the back
/// instead (`build_up_role`, `long_ball_role`).
pub(crate) fn role_attribute_modifier(role: PlayerRole, phase: PlayStylePhase) -> f64 {
    match (role, phase) {
        // Center Backs
        (PlayerRole::Stopper, PlayStylePhase::Defense) => 1.08,
        (PlayerRole::CoverCB, PlayStylePhase::Defense) => 1.05,
        // Full Backs
        (PlayerRole::AttackingFB, PlayStylePhase::Attack) => 1.08,
        (PlayerRole::AttackingFB, PlayStylePhase::Defense) => 0.93,
        (PlayerRole::DefensiveFB, PlayStylePhase::Defense) => 1.08,
        (PlayerRole::DefensiveFB, PlayStylePhase::Attack) => 0.93,
        (PlayerRole::WingBack, PlayStylePhase::Attack) => 1.10,
        (PlayerRole::WingBack, PlayStylePhase::Defense) => 0.97,
        // Defensive Midfielders
        (PlayerRole::AnchorMan, PlayStylePhase::Defense) => 1.10,
        (PlayerRole::AnchorMan, PlayStylePhase::Attack) => 0.90,
        (PlayerRole::BallWinner, PlayStylePhase::Defense) => 1.08,
        (PlayerRole::DeepLyingPlaymaker, PlayStylePhase::Midfield) => 1.10,
        (PlayerRole::DeepLyingPlaymaker, PlayStylePhase::Attack) => 0.93,
        // Central Midfielders
        (PlayerRole::BoxToBox, PlayStylePhase::Midfield) => 1.06,
        (PlayerRole::BoxToBox, PlayStylePhase::Attack) => 1.05,
        (PlayerRole::Mezzala, PlayStylePhase::Attack) => 1.08,
        (PlayerRole::Carrilero, PlayStylePhase::Defense) => 1.06,
        // Attacking Midfielders
        (PlayerRole::AdvancedPlaymaker, PlayStylePhase::Attack) => 1.10,
        (PlayerRole::ShadowStriker, PlayStylePhase::Attack) => 1.08,
        (PlayerRole::ShadowStriker, PlayStylePhase::Defense) => 0.92,
        // Wide
        (PlayerRole::WideForward, PlayStylePhase::Attack) => 1.08,
        // 1.10 until P4.6: at left wing it beat `Standard` by 5.5 points.
        (PlayerRole::InsideForward, PlayStylePhase::Attack) => 1.07,
        (PlayerRole::InvertedWinger, PlayStylePhase::Midfield) => 1.08,
        // Strikers
        (PlayerRole::Poacher, PlayStylePhase::Attack) => 1.12,
        (PlayerRole::Poacher, PlayStylePhase::Defense) => 0.85,
        (PlayerRole::TargetMan, PlayStylePhase::Attack) => 1.08,
        (PlayerRole::DeepLyingForward, PlayStylePhase::Midfield) => 1.06,
        (PlayerRole::False9, PlayStylePhase::Midfield) => 1.08,
        (PlayerRole::False9, PlayStylePhase::Attack) => 1.05,
        (PlayerRole::PressingForward, PlayStylePhase::Press) => 1.15,
        (PlayerRole::CompleteForward, PlayStylePhase::Attack) => 1.10,
        (PlayerRole::CompleteForward, PlayStylePhase::Defense) => 1.03,
        _ => 1.0,
    }
}

// ---------------------------------------------------------------------------
// Tactics modifiers — translate TacticsConfig settings to simulation multipliers
// ---------------------------------------------------------------------------

/// Foul rate multiplier from the defensive team's pressing + marking style.
pub(crate) fn tactics_foul_modifier(tactics: &TacticsConfig) -> f64 {
    let press = match tactics.pressing_intensity {
        PressingIntensity::Aggressive => 1.25,
        PressingIntensity::Passive => 0.80,
        PressingIntensity::Medium => 1.0,
    };
    let marking = match tactics.marking_style {
        MarkingStyle::ManToMan => 1.15,
        MarkingStyle::Mixed => 1.05,
        MarkingStyle::Zonal => 1.0,
    };
    press * marking
}

/// Shot conversion multiplier from the defending team's defensive line depth.
/// High line = more space in behind = easier for attackers to score.
pub(crate) fn tactics_defensive_conversion_mod(
    tactics: &TacticsConfig,
    knobs: &crate::knobs::CalibrationKnobs,
) -> f64 {
    match tactics.defensive_line {
        DefensiveLine::High => knobs.conversion_high_line,
        DefensiveLine::Low => 0.92,
        DefensiveLine::VeryLow => knobs.conversion_very_low_line,
        DefensiveLine::Medium => 1.0,
    }
}

// --- Extended phase dials (tempo / shape / pressing-possession / transitions) ---
//
// These cover dimensions the original five dials don't touch. Each neutral
// (#[default]) option returns ×1.0 — and the transition rolls return 0.0 — so a
// team on its defaults leaves the simulation (and the RNG stream) unchanged.
// build_up / width / def_line / marking are intentionally NOT re-hooked here:
// they already have live effects above, and re-hooking would double-count.

/// Tempo's progression side: Direct breaks through midfield faster, Patient is
/// more measured. Applied to the attacker's midfield contest.
pub(crate) fn tactics_tempo_progression(tactics: &TacticsConfig) -> f64 {
    match tactics.tempo {
        Tempo::Direct => 1.0,
        Tempo::Patient => 0.92,
    }
}

/// Tempo's retention side: Patient circulates and holds possession longer.
/// Applied to the possessing side's weight in the per-minute possession contest.
pub(crate) fn tactics_tempo_retention(
    tactics: &TacticsConfig,
    knobs: &crate::knobs::CalibrationKnobs,
) -> f64 {
    match tactics.tempo {
        Tempo::Patient => knobs.tempo_retention_patient,
        Tempo::Direct => 1.0,
    }
}

/// Pressing's ball-winning side in the per-minute possession contest: harder
/// pressing recovers the ball more often. Applied to the defending side's weight.
pub(crate) fn tactics_pressing_contest(tactics: &TacticsConfig) -> f64 {
    match tactics.pressing_intensity {
        PressingIntensity::Passive => 0.97,
        PressingIntensity::Medium => 1.0,
        PressingIntensity::Aggressive => 1.05,
    }
}

/// Pressing scales the effectiveness of the press that opposes the opponent's
/// build-up (a higher press forces more build-up turnovers).
pub(crate) fn tactics_pressing_press(tactics: &TacticsConfig) -> f64 {
    match tactics.pressing_intensity {
        PressingIntensity::Passive => 0.96,
        PressingIntensity::Medium => 1.0,
        PressingIntensity::Aggressive => 1.06,
    }
}

/// How high a side's press stands, by its defensive line (phase 2, GĐ4,
/// P4.1, X68): a block that sits deep leaves its front low too, and the other
/// side plays out unhurried. The price of a low block the engine lacked (P3.9
/// measured `VeryLow` 5.6 points above the default). `VeryLow` sits at the
/// bottom of the spec's 0.75–0.85: it moves that edge by less than a point,
/// because a deep block's gain is in the goals it does not concede, not in
/// its press (P4.1); the rest is GĐ5's.
pub(crate) fn tactics_line_press(tactics: &TacticsConfig) -> f64 {
    match tactics.defensive_line {
        DefensiveLine::VeryLow => 0.75,
        DefensiveLine::Low => 0.90,
        DefensiveLine::Medium => 1.0,
        DefensiveLine::High => 1.08,
    }
}

/// Pressing's energy cost: aggressive pressing tires a side faster. Applies only
/// to the live engine, which tracks in-match condition.
pub(crate) fn tactics_pressing_fatigue(tactics: &TacticsConfig) -> f64 {
    match tactics.pressing_intensity {
        PressingIntensity::Passive => 0.96,
        PressingIntensity::Medium => 1.0,
        PressingIntensity::Aggressive => 1.08,
    }
}

/// Defensive shape scales how hard it is to create chances against the team.
/// Applied to the defender's rating in the attacking third.
pub(crate) fn tactics_shape_modifier(tactics: &TacticsConfig) -> f64 {
    match tactics.defensive_shape {
        DefensiveShape::Stretched => 0.93,
        DefensiveShape::Normal => 1.0,
        DefensiveShape::Compact => 1.07,
    }
}

/// Counter-press duration: chance for the side that just lost the ball to win it
/// straight back at the possession flip. None ⇒ no roll (neutral, RNG-safe).
pub(crate) fn tactics_counter_press_rewin(tactics: &TacticsConfig) -> f64 {
    match tactics.counter_press_duration {
        CounterPressDuration::None => 0.0,
        CounterPressDuration::Short => 0.06,
        CounterPressDuration::Long => 0.12,
    }
}

/// Break speed: chance for the side that just won the ball to spring a fast
/// counter into its attacking third instead of resetting to midfield. Neutral
/// (Medium/Slow) ⇒ no roll; only Fast enables counters.
/// `Fast` was 0.10 until P4.6, when it won by more than five points over the
/// default (`dial-balance-p46.txt`).
pub(crate) fn tactics_break_speed_counter(tactics: &TacticsConfig) -> f64 {
    match tactics.break_speed {
        BreakSpeed::Slow => 0.0,
        BreakSpeed::Medium => 0.0,
        BreakSpeed::Fast => 0.08,
    }
}

// --- What the defensive dials cost ---
//
// Three of the dials above used to only ever help the side that set them, which
// made them free wins rather than choices. Measured between equal squads, a
// club that sat deep and countered took about eight more league points a season
// than one that attacked — off a play style the world generator assigns at
// random and shows to nobody. The three functions below are the other half of
// those trades. Each is neutral (×1.0, or 0.0 for a roll) on a default config,
// so a side that has set nothing still simulates exactly as before.

/// What a deep line concedes: the ball. A side defending on its own box wins it
/// back less often than one squeezing high up the pitch. Applied to the
/// defending side's weight in the possession contest, opposite
/// [`tactics_defensive_conversion_mod`], which is what a deep line buys.
pub(crate) fn tactics_defensive_line_recovery(tactics: &TacticsConfig) -> f64 {
    match tactics.defensive_line {
        DefensiveLine::VeryLow => 0.88,
        DefensiveLine::Low => 0.93,
        DefensiveLine::Medium => 1.0,
        DefensiveLine::High => 1.06,
    }
}

/// How far a break has to travel, from the depth the side was defending at.
///
/// Scales [`tactics_break_speed_counter`]: springing a counter from your own
/// box means eighty yards of open field, and fewer of those arrive than the
/// same break launched from halfway. Without this a deep line was pure profit
/// for a counter-attacking side — the ball-recovery cost above does not touch
/// it, because a side that lives on turnovers is not hurt by conceding
/// possession. This is the cost it actually pays.
pub(crate) fn tactics_break_distance(tactics: &TacticsConfig) -> f64 {
    match tactics.defensive_line {
        DefensiveLine::VeryLow => 0.70,
        DefensiveLine::Low => 0.80,
        DefensiveLine::Medium => 1.0,
        DefensiveLine::High => 1.15,
    }
}

/// What a counter-press costs when it fails: shape. A side that commits bodies
/// to winning the ball back immediately and does not get it is played through,
/// so the opponent breaks away whatever its own break-speed setting says.
/// Added to [`tactics_break_speed_counter`] on the turnover the counter-press
/// lost, and the mirror of [`tactics_counter_press_rewin`], which is what it
/// buys.
pub(crate) fn tactics_counter_press_exposure(tactics: &TacticsConfig) -> f64 {
    match tactics.counter_press_duration {
        CounterPressDuration::None => 0.0,
        CounterPressDuration::Short => 0.05,
        CounterPressDuration::Long => 0.11,
    }
}

/// Width against shape, as a matchup rather than two separate dials.
///
/// A compact block defends the middle and can be pulled apart by width; a
/// narrow attack plays straight into it. Without this, `Compact` was a free
/// defensive gain and `Wide` a pure handicap — the engine charged for the
/// crosses width produces without modelling the space it creates.
///
/// Multiplies the defender's rating in the attacking third, so below 1.0 means
/// the attack has the better of the matchup.
pub(crate) fn tactics_width_versus_shape(
    attacking: &TacticsConfig,
    defending: &TacticsConfig,
) -> f64 {
    match (&attacking.width, &defending.defensive_shape) {
        (TacticsPitchWidth::Wide, DefensiveShape::Compact) => 0.93,
        (TacticsPitchWidth::Wide, DefensiveShape::Normal) => 0.97,
        (TacticsPitchWidth::Narrow, DefensiveShape::Compact) => 1.05,
        (TacticsPitchWidth::Narrow, DefensiveShape::Normal) => 1.02,
        // A stretched block has no middle to overload and no width to exploit,
        // and a normal attack has no shape preference to reward either way.
        _ => 1.0,
    }
}

// ---------------------------------------------------------------------------
// Home advantage modifier
// ---------------------------------------------------------------------------

pub(crate) fn home_mod(side: Side, config: &MatchConfig) -> f64 {
    match side {
        Side::Home => config.home_advantage,
        Side::Away => 1.0,
    }
}

#[cfg(test)]
mod play_style_modifier_tests {
    use super::*;

    /// Given each style's defensive trade-off in the table,
    /// When the defending side's modifier is read,
    /// Then it is the table's value, not a neutral 1.0: a style counts when its side defends.
    #[test]
    fn the_defending_side_gets_its_own_style() {
        assert_eq!(
            style_table(PlayStyle::Defensive, PlayStylePhase::Defense),
            1.12
        );
        assert_eq!(
            style_table(PlayStyle::Attacking, PlayStylePhase::Defense),
            0.93
        );
        assert_eq!(
            style_table(PlayStyle::HighPress, PlayStylePhase::Defense),
            0.95
        );
        assert_eq!(
            style_table(PlayStyle::Counter, PlayStylePhase::Midfield),
            0.92
        );
    }

    fn close(actual: f64, expected: f64) -> bool {
        (actual - expected).abs() < 0.0005
    }

    /// Given knobs that move the curve's base and span,
    /// When a style is coached,
    /// Then `k = base + mastery / span` follows them, and the defaults give the
    /// game's curve bit for bit.
    #[test]
    fn the_mastery_curve_follows_its_knobs() {
        let mut knobs = CalibrationKnobs::default();
        assert_eq!(
            coached_modifier(1.18, 77, &knobs),
            1.0 + 0.18 * (0.5 + 77.0 / 100.0)
        );
        knobs.mastery_k_span = 200.0;
        assert!(close(coached_modifier(1.18, 100, &knobs), 1.18));
        knobs.mastery_k_base = 0.3;
        knobs.mastery_k_span = 100.0;
        assert!(close(coached_modifier(1.18, 50, &knobs), 1.144));
    }

    /// Given a coach of neutral mastery (50),
    /// When any style's value is coached,
    /// Then it is the table's value unchanged.
    #[test]
    fn a_neutral_coach_plays_the_style_as_the_table_prices_it() {
        for value in [1.18, 0.92, 1.12, 0.93, 1.0] {
            assert!(
                close(
                    coached_modifier(value, 50, &CalibrationKnobs::default()),
                    value
                ),
                "{value}"
            );
        }
    }

    /// Given Counter's attacking edge (1.18) and midfield cost (0.92),
    /// When coached by a coach of 90 and of 20,
    /// Then the better coach widens the edge and softens the cost, and the weaker
    /// one the reverse: a better coach makes every style better.
    #[test]
    fn a_better_coach_widens_the_edge_and_softens_the_cost() {
        assert!(close(
            coached_modifier(1.18, 90, &CalibrationKnobs::default()),
            1.252
        ));
        assert!(close(
            coached_modifier(1.18, 20, &CalibrationKnobs::default()),
            1.126
        ));
        assert!(close(
            coached_modifier(0.92, 90, &CalibrationKnobs::default()),
            0.952
        ));
        assert!(close(
            coached_modifier(0.92, 20, &CalibrationKnobs::default()),
            0.896
        ));
    }

    /// Given the extremes of the mastery scale,
    /// When Counter's edge and cost are coached,
    /// Then the weakest coach keeps about half of the edge and half again of the
    /// cost, and the best the reverse.
    /// Given Counter coached at 50 and at 99, and Balanced,
    /// When the style's effects are read for display,
    /// Then they are the same multipliers the match uses, and Balanced has none.
    #[test]
    fn a_styles_effects_are_the_multipliers_the_match_uses() {
        let neutral = play_style_effects(PlayStyle::Counter, 50);
        assert_eq!(neutral.len(), 2);
        assert!(neutral.contains(&(StylePhase::Attack, 1.18)));
        assert!(neutral.contains(&(StylePhase::Midfield, 0.92)));

        let mastered = play_style_effects(PlayStyle::Counter, 99);
        let attack = mastered
            .iter()
            .find(|(phase, _)| *phase == StylePhase::Attack)
            .unwrap()
            .1;
        assert!(close(
            attack,
            coached_modifier(1.18, 99, &CalibrationKnobs::default())
        ));

        assert!(play_style_effects(PlayStyle::Balanced, 99).is_empty());
    }

    #[test]
    fn the_coach_scales_a_style_between_half_and_one_and_a_half() {
        assert!(close(
            coached_modifier(1.18, 1, &CalibrationKnobs::default()),
            1.0918
        ));
        assert!(close(
            coached_modifier(1.18, 100, &CalibrationKnobs::default()),
            1.27
        ));
        assert!(close(
            coached_modifier(0.92, 1, &CalibrationKnobs::default()),
            0.8808
        ));
        assert!(close(
            coached_modifier(0.92, 100, &CalibrationKnobs::default()),
            0.96
        ));
    }
}

#[cfg(test)]
mod phase_modifier_tests {
    use super::*;

    fn cfg(f: impl FnOnce(&mut TacticsConfig)) -> TacticsConfig {
        let mut c = TacticsConfig::default();
        f(&mut c);
        c
    }

    /// The load-bearing invariant: a default TacticsConfig must leave every new
    /// dial neutral (×1.0 for ratings, 0.0 for the probabilistic transitions),
    /// so default teams simulate byte-identically to the pre-dial engine.
    #[test]
    fn default_config_is_fully_neutral() {
        let d = TacticsConfig::default();
        assert_eq!(tactics_tempo_progression(&d), 1.0);
        assert_eq!(
            tactics_tempo_retention(&d, &crate::knobs::CalibrationKnobs::default()),
            1.0
        );
        assert_eq!(tactics_pressing_contest(&d), 1.0);
        assert_eq!(tactics_pressing_press(&d), 1.0);
        assert_eq!(tactics_pressing_fatigue(&d), 1.0);
        assert_eq!(tactics_shape_modifier(&d), 1.0);
        assert_eq!(tactics_counter_press_rewin(&d), 0.0);
        assert_eq!(tactics_break_speed_counter(&d), 0.0);
    }

    #[test]
    fn tempo_directions() {
        // Direct is neutral; Patient progresses slower but retains more.
        assert!(tactics_tempo_progression(&cfg(|c| c.tempo = Tempo::Patient)) < 1.0);
        assert_eq!(
            tactics_tempo_progression(&cfg(|c| c.tempo = Tempo::Direct)),
            1.0
        );
        assert!(
            tactics_tempo_retention(
                &cfg(|c| c.tempo = Tempo::Patient),
                &crate::knobs::CalibrationKnobs::default()
            ) > 1.0
        );
        assert_eq!(
            tactics_tempo_retention(
                &cfg(|c| c.tempo = Tempo::Direct),
                &crate::knobs::CalibrationKnobs::default()
            ),
            1.0
        );
    }

    #[test]
    fn pressing_directions_monotonic() {
        let passive = cfg(|c| c.pressing_intensity = PressingIntensity::Passive);
        let medium = cfg(|c| c.pressing_intensity = PressingIntensity::Medium);
        let aggressive = cfg(|c| c.pressing_intensity = PressingIntensity::Aggressive);
        for f in [
            tactics_pressing_contest,
            tactics_pressing_press,
            tactics_pressing_fatigue,
        ] {
            assert!(f(&passive) < f(&medium), "passive should be < medium");
            assert!(f(&medium) < f(&aggressive), "medium should be < aggressive");
            assert_eq!(f(&medium), 1.0, "medium must be neutral");
        }
    }

    #[test]
    fn shape_directions_monotonic() {
        let stretched = cfg(|c| c.defensive_shape = DefensiveShape::Stretched);
        let normal = cfg(|c| c.defensive_shape = DefensiveShape::Normal);
        let compact = cfg(|c| c.defensive_shape = DefensiveShape::Compact);
        assert!(tactics_shape_modifier(&stretched) < 1.0);
        assert_eq!(tactics_shape_modifier(&normal), 1.0);
        assert!(tactics_shape_modifier(&compact) > 1.0);
    }

    /// A dial that only ever helps is not a tactic, it is a free win. These
    /// three cover the ones that used to be exactly that.
    #[test]
    fn every_advantage_is_paid_for_somewhere() {
        // Sitting deep is safer to defend against and concedes the ball for it.
        let very_low = cfg(|c| c.defensive_line = DefensiveLine::VeryLow);
        let high = cfg(|c| c.defensive_line = DefensiveLine::High);
        assert!(
            tactics_defensive_conversion_mod(&very_low, &crate::knobs::CalibrationKnobs::default())
                < tactics_defensive_conversion_mod(
                    &high,
                    &crate::knobs::CalibrationKnobs::default()
                ),
            "a deep line must be the safer one to defend with"
        );
        assert!(
            tactics_defensive_line_recovery(&very_low) < tactics_defensive_line_recovery(&high),
            "and must win the ball back less often, or it costs nothing"
        );
        assert!(
            tactics_break_distance(&very_low) < tactics_break_distance(&high),
            "and must complete fewer breaks, because the ball has further to go — \
             conceding possession is not a cost to a side that lives on turnovers"
        );

        // Counter-pressing wins the ball back and leaves space behind when it
        // does not.
        let long = cfg(|c| c.counter_press_duration = CounterPressDuration::Long);
        let short = cfg(|c| c.counter_press_duration = CounterPressDuration::Short);
        assert!(tactics_counter_press_rewin(&long) > tactics_counter_press_rewin(&short));
        assert!(
            tactics_counter_press_exposure(&long) > tactics_counter_press_exposure(&short),
            "the longer the press, the further out of shape when it is beaten"
        );

        // Width is a matchup, not a handicap: going wide pulls a compact block
        // apart, going narrow plays straight into it.
        let wide = cfg(|c| c.width = TacticsPitchWidth::Wide);
        let narrow = cfg(|c| c.width = TacticsPitchWidth::Narrow);
        let compact = cfg(|c| c.defensive_shape = DefensiveShape::Compact);
        assert!(
            tactics_width_versus_shape(&wide, &compact) < 1.0,
            "a compact block must be vulnerable to width, or Compact is free"
        );
        assert!(
            tactics_width_versus_shape(&narrow, &compact) > 1.0,
            "attacking narrow into a compact block must be the hard way to play"
        );
    }

    /// The neutrality invariant extends to the new dials: nothing new may fire
    /// for a side that has set nothing.
    #[test]
    fn the_new_costs_are_neutral_by_default() {
        let d = TacticsConfig::default();
        assert_eq!(tactics_defensive_line_recovery(&d), 1.0);
        assert_eq!(tactics_break_distance(&d), 1.0);
        assert_eq!(tactics_counter_press_exposure(&d), 0.0);
        assert_eq!(tactics_width_versus_shape(&d, &d), 1.0);
    }

    #[test]
    fn transition_dials_are_probabilities_with_neutral_zero() {
        // Counter-press: None rolls nothing; Long > Short > 0.
        assert_eq!(
            tactics_counter_press_rewin(&cfg(
                |c| c.counter_press_duration = CounterPressDuration::None
            )),
            0.0
        );
        let short = tactics_counter_press_rewin(&cfg(|c| {
            c.counter_press_duration = CounterPressDuration::Short
        }));
        let long = tactics_counter_press_rewin(&cfg(|c| {
            c.counter_press_duration = CounterPressDuration::Long
        }));
        assert!(0.0 < short && short < long && long < 1.0);
        // Break speed: only Fast rolls; Slow and Medium are no-ops.
        assert_eq!(
            tactics_break_speed_counter(&cfg(|c| c.break_speed = BreakSpeed::Slow)),
            0.0
        );
        assert_eq!(
            tactics_break_speed_counter(&cfg(|c| c.break_speed = BreakSpeed::Medium)),
            0.0
        );
        let fast = tactics_break_speed_counter(&cfg(|c| c.break_speed = BreakSpeed::Fast));
        assert!(0.0 < fast && fast < 1.0);
    }
}
