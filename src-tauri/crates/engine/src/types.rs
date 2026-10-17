use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Position — mirrors domain::player::Position but kept independent
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Position {
    Goalkeeper,
    Defender,
    Midfielder,
    Forward,
}

// ---------------------------------------------------------------------------
// PlayStyle — mirrors domain::team::PlayStyle
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlayStyle {
    Balanced,
    Attacking,
    Defensive,
    Possession,
    Counter,
    HighPress,
}

// ---------------------------------------------------------------------------
// PlayerRole — mirrors domain::team::PlayerRole, kept independent
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum PlayerRole {
    // Goalkeeper
    #[default]
    Standard,
    BallPlayingKeeper,
    SweeperKeeper,
    // Center Back
    Stopper,
    CoverCB,
    BallPlayingCB,
    // Full Back / Wing Back
    AttackingFB,
    DefensiveFB,
    InvertedFB,
    WingBack,
    // Defensive Midfielder
    AnchorMan,
    // Phase 2: carried, but no role modifier yet and no position admits them.
    HalfBack,
    DefensiveWinger,
    BallWinner,
    DeepLyingPlaymaker,
    // Central Midfielder
    BoxToBox,
    Carrilero,
    Mezzala,
    // Attacking Midfielder
    AdvancedPlaymaker,
    ShadowStriker,
    // Wide
    WideForward,
    InsideForward,
    InvertedWinger,
    // Striker
    Poacher,
    TargetMan,
    DeepLyingForward,
    False9,
    PressingForward,
    CompleteForward,
}

// ---------------------------------------------------------------------------
// PlayerData — a snapshot of a player for engine consumption
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerData {
    pub id: String,
    pub name: String,
    pub position: Position,
    #[serde(default)]
    pub ovr: u8,
    pub condition: u8, // 0-100
    /// Long-term physical shape (0-100). Multiplies stamina depletion rate in-match.
    #[serde(default = "default_fitness")]
    pub fitness: u8,

    // Physical
    pub pace: u8,
    pub stamina: u8,
    pub strength: u8,
    #[serde(default = "default_engine_attr")]
    pub agility: u8,

    // Technical
    pub passing: u8,
    pub shooting: u8,
    pub tackling: u8,
    pub dribbling: u8,
    pub defending: u8,

    // Mental
    pub positioning: u8,
    pub vision: u8,
    pub decisions: u8,
    #[serde(default = "default_engine_attr")]
    pub composure: u8,
    #[serde(default = "default_engine_attr")]
    pub aggression: u8,
    #[serde(default = "default_engine_attr")]
    pub teamwork: u8,
    #[serde(default = "default_engine_attr")]
    pub leadership: u8,

    // Goalkeeper
    #[serde(default = "default_engine_attr")]
    pub handling: u8,
    #[serde(default = "default_engine_attr")]
    pub reflexes: u8,
    #[serde(default = "default_engine_attr")]
    pub aerial: u8,

    // The seven attributes `ofm_core` splits out of passing, shooting, dribbling
    // and aerial. Until each mechanism moves over, the field it splits from
    // keeps the old blended meaning (the bridge rebuilds it). Moved so far:
    // `aerial` and `heading` (P2.2), `shooting` and `long_shots` (P2.5).
    #[serde(default)]
    pub long_passing: u8,
    #[serde(default)]
    pub crossing: u8,
    #[serde(default)]
    pub curve: u8,
    #[serde(default)]
    pub free_kick: u8,
    #[serde(default)]
    pub long_shots: u8,
    #[serde(default)]
    pub first_touch: u8,
    #[serde(default)]
    pub heading: u8,

    /// Height in cm; 0 means not known and counts as average in the air.
    #[serde(default)]
    pub height_cm: u16,

    /// His stronger foot. Carried from phase 2 P3.0; the wing play of P3.4
    /// reads it to decide who cuts inside.
    #[serde(default)]
    pub footedness: Foot,

    // Traits (string names matching domain::player::PlayerTrait variants)
    #[serde(default)]
    pub traits: Vec<String>,

    #[serde(default)]
    pub role: PlayerRole,

    /// His rating at each pitch position, worked out by `ofm_core` before the
    /// match. Read for the slot he stands in (see `pitch_position`); empty for
    /// synthetic players, who then play every slot as themselves.
    #[serde(default)]
    pub position_ratings: Vec<crate::pitch_position::PositionRating>,
}

/// A player's stronger foot — mirrors `domain::player::Footedness`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Foot {
    Left,
    #[default]
    Right,
    Both,
}

fn default_engine_attr() -> u8 {
    50
}

fn default_fitness() -> u8 {
    75
}

impl PlayerData {
    /// Overall rating (simple mean of core 11 attributes).
    pub fn overall(&self) -> f64 {
        (self.pace as f64
            + self.stamina as f64
            + self.strength as f64
            + self.passing as f64
            + self.shooting as f64
            + self.tackling as f64
            + self.dribbling as f64
            + self.defending as f64
            + self.positioning as f64
            + self.vision as f64
            + self.decisions as f64)
            / 11.0
    }

    /// Effective rating accounting for current condition (0-100).
    pub fn effective_overall(&self) -> f64 {
        self.overall() * (self.condition as f64 / 100.0)
    }

    /// Give each of the seven split attributes still at 0 (not declared) a
    /// value read off the field it was split from, shifted by how far the
    /// two sit apart on average for the position group.
    ///
    /// A player from a game always arrives with all seven: `ofm_core` splits
    /// them before the bridge. This is for synthetic players (sim-bench,
    /// SimLab, the golden fixtures, unit tests), which set only the old
    /// fields, so a mechanism that reads `heading` does not meet a forward who
    /// cannot head the ball at all. The offsets are the group means measured on
    /// the real-world package (`fm-document/comon/sim-bench/reference/
    /// gd1-split-offsets.txt`, "d theo nhóm thô"). No random draw is made, so
    /// a match plays out the same whether or not it ran.
    pub fn declare_split_attributes(&mut self) {
        // long_passing, crossing, curve, free_kick, long_shots, first_touch, heading
        let offsets: [i16; 7] = match self.position {
            Position::Goalkeeper => [37, -11, -11, -11, 2, 3, -47],
            Position::Defender => [-1, -6, -11, -18, 2, 2, -5],
            Position::Midfielder => [-1, -5, -5, -10, 2, 0, -5],
            Position::Forward => [-6, -5, -1, -7, -2, 0, -4],
        };
        let (passing, shooting, dribbling, aerial) =
            (self.passing, self.shooting, self.dribbling, self.aerial);
        let fields = [
            (&mut self.long_passing, passing),
            (&mut self.crossing, passing),
            (&mut self.curve, passing),
            (&mut self.free_kick, passing),
            (&mut self.long_shots, shooting),
            (&mut self.first_touch, dribbling),
            (&mut self.heading, aerial),
        ];
        for ((field, parent), offset) in fields.into_iter().zip(offsets) {
            if *field == 0 {
                *field = (i16::from(parent) + offset).clamp(1, 99) as u8;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// TacticsConfig — tactical settings that influence simulation modifiers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum PressingIntensity {
    Passive,
    #[default]
    Medium,
    Aggressive,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum DefensiveLine {
    VeryLow,
    Low,
    #[default]
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum TacticsPitchWidth {
    Narrow,
    #[default]
    Normal,
    Wide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum TacticsBuildUpStyle {
    Short,
    #[default]
    Mixed,
    Long,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum MarkingStyle {
    #[default]
    Zonal,
    Mixed,
    ManToMan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Tempo {
    Patient,
    #[default]
    Direct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum DefensiveShape {
    Stretched,
    #[default]
    Normal,
    Compact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum CounterPressDuration {
    #[default]
    None,
    Short,
    Long,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum BreakSpeed {
    Slow,
    #[default]
    Medium,
    Fast,
}

/// How a side crosses from the flank (phase 2, P3.4, decisions X6, X55).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum CrossStyle {
    /// Two crosses in three in the air, the third along the ground.
    #[default]
    Mixed,
    /// Every cross in the air.
    High,
    /// Every cross along the ground.
    Low,
    /// As `Mixed`, and often early, before the full back is taken on.
    Early,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TacticsConfig {
    pub pressing_intensity: PressingIntensity,
    pub defensive_line: DefensiveLine,
    pub width: TacticsPitchWidth,
    pub build_up_style: TacticsBuildUpStyle,
    pub marking_style: MarkingStyle,
    // Phase-blueprint dials added on top of the original five. Each defaults to
    // the neutral option so existing `TacticsConfig::default()` callers and
    // serialized saves are unaffected.
    #[serde(default)]
    pub tempo: Tempo,
    #[serde(default)]
    pub defensive_shape: DefensiveShape,
    #[serde(default)]
    pub counter_press_duration: CounterPressDuration,
    #[serde(default)]
    pub break_speed: BreakSpeed,
    /// Read only under `EngineModel::Grid15` (P3.4).
    #[serde(default)]
    pub cross_style: CrossStyle,
}

/// One dial of a side's tactical plan, and the setting to put it on.
///
/// A play style is a label for a whole approach; these are the ten settings
/// underneath it. Until now the only thing a manager could change during a match
/// was the label, which is a blunt instrument — "push the line up" and "start
/// the whole side attacking" are not the same instruction, and a side that is
/// already attacking had nothing left to say.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TacticalDial {
    PressingIntensity(PressingIntensity),
    DefensiveLine(DefensiveLine),
    Width(TacticsPitchWidth),
    BuildUpStyle(TacticsBuildUpStyle),
    MarkingStyle(MarkingStyle),
    Tempo(Tempo),
    DefensiveShape(DefensiveShape),
    CounterPressDuration(CounterPressDuration),
    BreakSpeed(BreakSpeed),
    CrossStyle(CrossStyle),
}

impl TacticalDial {
    /// Turn this one dial, leaving the other nine where they are.
    pub fn set_on(self, tactics: &mut TacticsConfig) {
        match self {
            Self::PressingIntensity(value) => tactics.pressing_intensity = value,
            Self::DefensiveLine(value) => tactics.defensive_line = value,
            Self::Width(value) => tactics.width = value,
            Self::BuildUpStyle(value) => tactics.build_up_style = value,
            Self::MarkingStyle(value) => tactics.marking_style = value,
            Self::Tempo(value) => tactics.tempo = value,
            Self::DefensiveShape(value) => tactics.defensive_shape = value,
            Self::CounterPressDuration(value) => tactics.counter_press_duration = value,
            Self::BreakSpeed(value) => tactics.break_speed = value,
            Self::CrossStyle(value) => tactics.cross_style = value,
        }
    }
}

// ---------------------------------------------------------------------------
// TeamData — everything the engine needs to know about one side
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamData {
    pub id: String,
    pub name: String,
    pub formation: String,
    pub play_style: PlayStyle,
    pub players: Vec<PlayerData>,
    #[serde(default)]
    pub tactics: TacticsConfig,
    /// The head coach's command of each play style. Neutral by default, so a
    /// side built without a coach plays every style exactly as the table prices it.
    #[serde(default)]
    pub coach: CoachMastery,
}

/// How well a side's head coach gets each play style across, 1–100.
///
/// The engine's own mirror of `domain::manager::PlayStyleMastery`, filled in by
/// `ofm_core::turn`; 50 is neutral.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CoachMastery {
    pub balanced: u8,
    pub attacking: u8,
    pub defensive: u8,
    pub possession: u8,
    pub counter: u8,
    pub high_press: u8,
}

impl CoachMastery {
    pub const NEUTRAL: u8 = 50;

    pub fn for_style(&self, style: PlayStyle) -> u8 {
        match style {
            PlayStyle::Balanced => self.balanced,
            PlayStyle::Attacking => self.attacking,
            PlayStyle::Defensive => self.defensive,
            PlayStyle::Possession => self.possession,
            PlayStyle::Counter => self.counter,
            PlayStyle::HighPress => self.high_press,
        }
    }
}

impl Default for CoachMastery {
    fn default() -> Self {
        Self {
            balanced: Self::NEUTRAL,
            attacking: Self::NEUTRAL,
            defensive: Self::NEUTRAL,
            possession: Self::NEUTRAL,
            counter: Self::NEUTRAL,
            high_press: Self::NEUTRAL,
        }
    }
}

impl TeamData {
    /// Count players by position.
    pub fn count_position(&self, pos: Position) -> usize {
        self.players.iter().filter(|p| p.position == pos).count()
    }

    /// Average of a specific attribute among players in the given position.
    pub fn position_attr_avg(&self, pos: Position, attr_fn: fn(&PlayerData) -> u8) -> f64 {
        let players: Vec<_> = self.players.iter().filter(|p| p.position == pos).collect();
        if players.is_empty() {
            return 40.0; // fallback
        }
        players.iter().map(|p| attr_fn(p) as f64).sum::<f64>() / players.len() as f64
    }

    /// Composite defense rating (from defenders + goalkeeper).
    pub fn defense_rating(&self) -> f64 {
        let def_avg = self.position_attr_avg(Position::Defender, |p| {
            ((p.defending as u16 + p.tackling as u16 + p.positioning as u16 + p.strength as u16)
                / 4) as u8
        });
        let gk_avg = self.position_attr_avg(Position::Goalkeeper, |p| {
            ((p.positioning as u16 + p.decisions as u16 + p.strength as u16 + p.pace as u16) / 4)
                as u8
        });
        def_avg * 0.7 + gk_avg * 0.3
    }

    /// Composite midfield rating.
    pub fn midfield_rating(&self) -> f64 {
        self.position_attr_avg(Position::Midfielder, |p| {
            ((p.passing as u16 + p.vision as u16 + p.decisions as u16 + p.stamina as u16) / 4) as u8
        })
    }

    /// Composite attack rating (from forwards + midfielders).
    pub fn attack_rating(&self) -> f64 {
        let fwd_avg = self.position_attr_avg(Position::Forward, |p| {
            ((p.shooting as u16 + p.dribbling as u16 + p.pace as u16 + p.positioning as u16) / 4)
                as u8
        });
        let mid_contrib = self.position_attr_avg(Position::Midfielder, |p| {
            ((p.shooting as u16 + p.passing as u16 + p.vision as u16) / 3) as u8
        });
        fwd_avg * 0.75 + mid_contrib * 0.25
    }

    /// Goalkeeper save rating.
    pub fn goalkeeper_rating(&self) -> f64 {
        self.position_attr_avg(Position::Goalkeeper, |p| {
            ((p.positioning as u16 + p.decisions as u16 + p.pace as u16 + p.strength as u16) / 4)
                as u8
        })
    }
}

// ---------------------------------------------------------------------------
// MatchConfig — tuneable simulation parameters
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchConfig {
    /// Multiplier applied to the home team's ratings (e.g. 1.08 = 8% boost).
    pub home_advantage: f64,
    /// Base probability that a shot from the box is on target (0.0–1.0).
    pub shot_accuracy_base: f64,
    /// Base probability that an on-target shot beats the keeper (0.0–1.0).
    pub goal_conversion_base: f64,
    /// Per-minute fatigue factor applied to condition.
    pub fatigue_per_minute: f64,
    /// Probability of a foul on any defensive action (0.0–1.0).
    pub foul_probability: f64,
    /// Probability a foul results in a yellow card.
    pub yellow_card_probability: f64,
    /// Probability a yellow-card foul is upgraded to red (second yellow or serious foul).
    pub red_card_probability: f64,
    /// Probability that a foul inside the attacking box is adjudicated as a penalty kick.
    /// Conditional on a box foul occurring — not a per-game rate. ~50% in real football.
    pub penalty_probability: f64,
    /// Minutes of stoppage time per half (0 = none).
    pub stoppage_time_max: u8,
    /// Probability of an injury per foul event.
    pub injury_probability: f64,
    /// Which match model plays the game (phase 2, GĐ3, X47). Every rule GĐ3
    /// adds runs only under `Grid15`; `Zones5` plays exactly as before GĐ3.
    #[serde(default)]
    pub engine_model: EngineModel,
}

/// The match model: the five zones of GĐ2, or the 5×3 grid of GĐ3 in which
/// the ball also has a lane. `Zones5` goes once `Grid15` passes the GĐ3 gate
/// (P3.8); until then the two run side by side for A/B comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum EngineModel {
    #[default]
    Zones5,
    Grid15,
}

impl EngineModel {
    /// Reads `"zones5"` / `"grid15"` (any case), as the bench flag and the
    /// probe's `OFM_ENGINE_MODEL` spell it.
    pub fn parse(name: &str) -> Option<Self> {
        match name.to_ascii_lowercase().as_str() {
            "zones5" => Some(Self::Zones5),
            "grid15" => Some(Self::Grid15),
            _ => None,
        }
    }
}

impl Default for MatchConfig {
    fn default() -> Self {
        Self {
            home_advantage: 1.08,
            shot_accuracy_base: 0.35,
            goal_conversion_base: 0.36,
            fatigue_per_minute: 0.20,
            foul_probability: 0.40,
            yellow_card_probability: 0.11,
            red_card_probability: 0.04,
            penalty_probability: 0.50,
            stoppage_time_max: 4,
            injury_probability: 0.03,
            engine_model: EngineModel::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// Side — which side of the match
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Side {
    Home,
    Away,
}

impl Side {
    pub fn opposite(self) -> Side {
        match self {
            Side::Home => Side::Away,
            Side::Away => Side::Home,
        }
    }
}

// ---------------------------------------------------------------------------
// Zone — regions of the pitch from the perspective of the match (not a team)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Zone {
    HomeBox,
    HomeDefense,
    Midfield,
    AwayDefense,
    AwayBox,
}

impl Zone {
    /// The attacking zone for a given side (where they score).
    pub fn attacking_box(side: Side) -> Zone {
        match side {
            Side::Home => Zone::AwayBox,
            Side::Away => Zone::HomeBox,
        }
    }

    /// The attacking third for a given side.
    pub fn attacking_third(side: Side) -> Zone {
        match side {
            Side::Home => Zone::AwayDefense,
            Side::Away => Zone::HomeDefense,
        }
    }

    /// The defensive third for a given side.
    pub fn defensive_third(side: Side) -> Zone {
        match side {
            Side::Home => Zone::HomeDefense,
            Side::Away => Zone::AwayDefense,
        }
    }

    /// Advance the ball one zone towards the given side's goal.
    pub fn advance_towards(self, attacking_side: Side) -> Zone {
        match attacking_side {
            Side::Home => match self {
                Zone::HomeBox => Zone::HomeDefense,
                Zone::HomeDefense => Zone::Midfield,
                Zone::Midfield => Zone::AwayDefense,
                Zone::AwayDefense => Zone::AwayBox,
                Zone::AwayBox => Zone::AwayBox,
            },
            Side::Away => match self {
                Zone::AwayBox => Zone::AwayDefense,
                Zone::AwayDefense => Zone::Midfield,
                Zone::Midfield => Zone::HomeDefense,
                Zone::HomeDefense => Zone::HomeBox,
                Zone::HomeBox => Zone::HomeBox,
            },
        }
    }

    /// Is this zone the attacking box for the given side?
    pub fn is_box_for(self, attacking_side: Side) -> bool {
        self == Zone::attacking_box(attacking_side)
    }
}
