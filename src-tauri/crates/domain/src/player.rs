use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Player {
    pub id: String,
    pub match_name: String,
    pub full_name: String,
    pub date_of_birth: String,
    pub nationality: String,
    #[serde(default)]
    pub football_nation: String,
    #[serde(default)]
    pub birth_country: Option<String>,
    #[serde(default)]
    pub media: PlayerMedia,

    pub position: Position,

    // The player's natural/preferred position (never changed by formation logic)
    #[serde(default)]
    pub natural_position: Position,

    // Alternate positions this player can also play (with reduced effectiveness)
    #[serde(default)]
    pub alternate_positions: Vec<Position>,

    #[serde(default)]
    pub footedness: Footedness,

    #[serde(default = "default_weak_foot")]
    pub weak_foot: u8,

    // Core attributes 0-100
    pub attributes: PlayerAttributes,

    // Dynamic match/season values
    pub condition: u8, // 0-100 (short-term energy; depletes during matches, recovers daily)
    pub morale: u8,    // 0-100
    /// Long-term physical shape (0–100). Determines how fast condition depletes and
    /// recovers, and modulates injury risk. Changes slowly over weeks.
    #[serde(default = "default_fitness")]
    pub fitness: u8,
    /// Recent share of his club's minutes (0–100): 100 for a player who starts and
    /// finishes every game, 0 for one who has not been on the pitch for weeks. A
    /// moving average over the club's last matches, so it survives the close season.
    #[serde(default = "default_playing_time")]
    pub playing_time: u8,
    /// Recent match form: a moving average of his match ratings, in tenths of
    /// a point (60 = 6.0, an ordinary game). Moves only when he is rated, so a
    /// spell out of the side leaves it where his last games put it.
    #[serde(default = "default_match_form")]
    pub match_form: u8,

    pub injury: Option<Injury>,
    pub team_id: Option<String>,
    #[serde(default)]
    pub retired: bool,
    #[serde(default)]
    pub squad_role: SquadRole,

    // Traits / flairs derived from attributes. Sent out without `Wonderkid`,
    // which would give the ceiling away; see `crate::persisted`.
    #[serde(default, serialize_with = "crate::persisted::traits")]
    pub traits: Vec<PlayerTrait>,

    // Derived ratings (set by ofm_core, backend is source of truth)
    /// Position-weighted overall rating (1–99). Computed from natural position.
    #[serde(default)]
    pub ovr: u8,
    /// Player's ceiling rating (1–99). Set at generation; higher than ovr for young players.
    /// Serialized as 0 except through `crate::persisted::Persisted`: the manager
    /// knows it only through a scout's read.
    #[serde(default, serialize_with = "crate::persisted::potential")]
    pub potential: u8,

    // Contract & value
    //
    // A player's contract is not a field. It is the latest entry in `movement_history`
    // (see `contract_ledger`): read it with `wage()`, `contract_start()` and
    // `contract_end()`, and change it by recording a movement. The ledger still writes
    // `wage`, `contract_start` and `contract_end` when a player is serialized, so the
    // frontend and the save columns keep the shape they always had.
    pub market_value: u64,

    // Season stats
    pub stats: PlayerSeasonStats,

    // Career history
    pub career: Vec<CareerEntry>,
    /// Every move and every contract. Flattened so the wire and the saves keep their
    /// keys: it reads and writes `movement_history`, `wage`, `contract_start` and
    /// `contract_end` itself.
    #[serde(flatten)]
    pub movement_history: crate::contract_ledger::MovementLedger,

    // Individual training focus override (takes priority over group and team default)
    #[serde(default)]
    pub training_focus: Option<crate::team::TrainingFocus>,

    // Transfer status
    #[serde(default)]
    pub transfer_listed: bool,
    #[serde(default)]
    pub loan_listed: bool,
    #[serde(default)]
    pub transfer_offers: Vec<TransferOffer>,
    #[serde(default)]
    pub loan_offers: Vec<LoanOffer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_loan: Option<ActiveLoan>,
    #[serde(default)]
    pub morale_core: PlayerMoraleCore,

    /// Jersey/squad number (1–99). None means unassigned.
    #[serde(default)]
    pub jersey_number: Option<u8>,

    /// Height in cm, drawn when the player is generated and fixed for his
    /// career. `DEFAULT_HEIGHT_CM` (0) means not known.
    #[serde(default)]
    pub height_cm: u16,
    /// Weight in kg, drawn with the height and fixed for his career.
    /// `DEFAULT_WEIGHT_KG` (0) means not known.
    #[serde(default)]
    pub weight_kg: u8,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlayerMedia {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub face: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
pub enum Position {
    #[default]
    Goalkeeper,
    Defender,
    Midfielder,
    Forward,
    RightBack,
    CenterBack,
    LeftBack,
    RightWingBack,
    LeftWingBack,
    DefensiveMidfielder,
    CentralMidfielder,
    AttackingMidfielder,
    RightMidfielder,
    LeftMidfielder,
    RightWinger,
    LeftWinger,
    Striker,
}

impl Position {
    /// Every role a player in this position may be given, `Standard` first.
    ///
    /// This is the canonical backend table. It lived in the Tauri command layer,
    /// which put it out of reach of anything below the commands — so a second
    /// backend copy was the only way for `ofm_core` to assign a role, and there
    /// were already two more (the engine's own mirror, which the crate-boundary
    /// rule requires, and `src/lib/playerRoles.ts` on the front end). Which
    /// roles a position admits is a property of the two types, in the same way
    /// `TrainingSchedule::is_training_day` is a property of a schedule, so it
    /// belongs here where every layer can reach it.
    ///
    /// **The front-end mirror must stay in lock-step, and nothing checks that
    /// mechanically.** `role_valid_for_position_matches_canonical_table` in
    /// `commands/squad.rs` pins this table to a literal copy of it, and
    /// `src/lib/playerRoles.test.ts` pins the TypeScript mirror to its own; no
    /// test compares the two. Change one side, change the other.
    ///
    /// The four coarse buckets are the legacy position groups, and they admit
    /// every role of every granular position beneath them — a squad generated
    /// today is entirely coarse (`generation.rs` hands out `Goalkeeper`,
    /// `Defender`, `Midfielder`, `Forward` and nothing finer), so these are the
    /// arms that get the most use, not the least.
    pub fn valid_roles(&self) -> &'static [crate::team::PlayerRole] {
        use crate::team::PlayerRole as R;
        match self {
            Position::Goalkeeper => &[R::Standard, R::BallPlayingKeeper, R::SweeperKeeper],
            Position::CenterBack => &[R::Standard, R::Stopper, R::CoverCB, R::BallPlayingCB],
            Position::RightBack
            | Position::LeftBack
            | Position::RightWingBack
            | Position::LeftWingBack => &[
                R::Standard,
                R::AttackingFB,
                R::DefensiveFB,
                R::InvertedFB,
                R::WingBack,
            ],
            Position::DefensiveMidfielder => &[
                R::Standard,
                R::AnchorMan,
                R::BallWinner,
                R::DeepLyingPlaymaker,
                R::HalfBack,
            ],
            Position::CentralMidfielder => &[R::Standard, R::BoxToBox, R::Carrilero, R::Mezzala],
            Position::AttackingMidfielder => &[R::Standard, R::AdvancedPlaymaker, R::ShadowStriker],
            Position::RightMidfielder
            | Position::LeftMidfielder
            | Position::RightWinger
            | Position::LeftWinger => &[
                R::Standard,
                R::WideForward,
                R::InsideForward,
                R::InvertedWinger,
                R::DefensiveWinger,
            ],
            Position::Striker => &[
                R::Standard,
                R::Poacher,
                R::TargetMan,
                R::DeepLyingForward,
                R::False9,
                R::PressingForward,
                R::CompleteForward,
            ],
            // Coarse buckets: the union of the granular positions they cover.
            Position::Defender => &[
                R::Standard,
                R::Stopper,
                R::CoverCB,
                R::BallPlayingCB,
                R::AttackingFB,
                R::DefensiveFB,
                R::InvertedFB,
                R::WingBack,
            ],
            Position::Midfielder => &[
                R::Standard,
                R::AnchorMan,
                R::BallWinner,
                R::DeepLyingPlaymaker,
                R::BoxToBox,
                R::Carrilero,
                R::Mezzala,
                R::AdvancedPlaymaker,
                R::ShadowStriker,
                R::WideForward,
                R::InsideForward,
                R::InvertedWinger,
                R::HalfBack,
                R::DefensiveWinger,
            ],
            Position::Forward => &[
                R::Standard,
                R::WideForward,
                R::InsideForward,
                R::InvertedWinger,
                R::DefensiveWinger,
                R::Poacher,
                R::TargetMan,
                R::DeepLyingForward,
                R::False9,
                R::PressingForward,
                R::CompleteForward,
            ],
        }
    }

    /// Whether this position admits that role. See [`Position::valid_roles`].
    pub fn admits_role(&self, role: &crate::team::PlayerRole) -> bool {
        self.valid_roles().contains(role)
    }

    pub fn is_legacy_bucket(&self) -> bool {
        matches!(
            self,
            Position::Goalkeeper | Position::Defender | Position::Midfielder | Position::Forward
        )
    }

    pub fn to_group_position(&self) -> Position {
        match self {
            Position::Goalkeeper => Position::Goalkeeper,
            Position::Defender
            | Position::RightBack
            | Position::CenterBack
            | Position::LeftBack
            | Position::RightWingBack
            | Position::LeftWingBack => Position::Defender,
            Position::Midfielder
            | Position::DefensiveMidfielder
            | Position::CentralMidfielder
            | Position::AttackingMidfielder
            | Position::RightMidfielder
            | Position::LeftMidfielder => Position::Midfielder,
            Position::Forward
            | Position::RightWinger
            | Position::LeftWinger
            | Position::Striker => Position::Forward,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Footedness {
    Left,
    #[default]
    Right,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum SquadRole {
    #[default]
    Senior,
    Youth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerAttributes {
    // Physical
    pub pace: u8,
    pub stamina: u8,
    pub strength: u8,
    #[serde(default = "default_attr")]
    pub agility: u8,

    // Technical
    /// Short passing, combination play (≤ 20 m). Before the 26-attribute split
    /// this was a blend of short and long passing, crossing and curve.
    pub passing: u8,
    /// Finishing inside the box. The long-range part now lives in `long_shots`.
    pub shooting: u8,
    pub tackling: u8,
    /// Running with the ball past a man. Ball control now lives in `first_touch`.
    pub dribbling: u8,
    pub defending: u8,

    // The seven attributes split out of `passing`, `shooting`, `dribbling` and
    // `aerial`. 0 means "not declared": a package or generator that predates
    // them leaves 0, and `ofm_core::attribute_split` derives them from the old
    // blends. Every real value is 1–99, so 0 is never ambiguous.
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

    // Mental
    pub positioning: u8,
    pub vision: u8,
    pub decisions: u8,
    #[serde(default = "default_attr")]
    pub composure: u8,
    #[serde(default = "default_attr")]
    pub aggression: u8,
    #[serde(default = "default_attr")]
    pub teamwork: u8,
    #[serde(default = "default_attr")]
    pub leadership: u8,

    // Goalkeeper
    #[serde(default = "default_attr")]
    pub handling: u8,
    #[serde(default = "default_attr")]
    pub reflexes: u8,
    /// Jumping and contesting a high ball (a keeper's claiming for a GK). The
    /// technique of heading it now lives in `heading`.
    #[serde(default = "default_attr")]
    pub aerial: u8,
}

/// `passing`, `shooting`, `dribbling` and `aerial` as they were measured before
/// the 26-attribute split: one blended number each.
///
/// Every rule tuned on the blends (the match engine, the pre-split OVR table,
/// role and position fit, trait thresholds) reads these until it is moved onto
/// the split attributes, so the split changes the data without changing the
/// game. The formulas are the ones the package build used to blend with; a
/// rule that has moved over stops reading its blend, and this goes when none
/// is left.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LegacyBlends {
    pub passing: u8,
    pub shooting: u8,
    pub dribbling: u8,
    pub aerial: u8,
}

fn blend(parts: &[(u8, f64)]) -> u8 {
    let value: f64 = parts.iter().map(|&(v, w)| f64::from(v) * w).sum();
    value.round().clamp(1.0, 99.0) as u8
}

impl PlayerAttributes {
    /// The pre-split blends of these attributes. A family whose split
    /// attributes are still 0 (undeclared) reads its stored field unchanged.
    /// A goalkeeper's aerial never mixed in heading, so it stays his own.
    pub fn legacy_blends(&self, is_goalkeeper: bool) -> LegacyBlends {
        let passing = if self.long_passing == 0 || self.crossing == 0 || self.curve == 0 {
            self.passing
        } else {
            blend(&[
                (self.passing, 0.45),
                (self.long_passing, 0.30),
                (self.crossing, 0.15),
                (self.curve, 0.10),
            ])
        };
        let shooting = if self.long_shots == 0 {
            self.shooting
        } else {
            blend(&[(self.shooting, 0.8), (self.long_shots, 0.2)])
        };
        let dribbling = if self.first_touch == 0 {
            self.dribbling
        } else {
            blend(&[(self.dribbling, 0.5), (self.first_touch, 0.5)])
        };
        let aerial = if is_goalkeeper || self.heading == 0 {
            self.aerial
        } else {
            blend(&[(self.aerial, 0.5), (self.heading, 0.5)])
        };
        LegacyBlends {
            passing,
            shooting,
            dribbling,
            aerial,
        }
    }
    /// A copy with `passing`, `shooting`, `dribbling` and `aerial` holding their
    /// legacy blends, for a rule written field by field against the blends.
    pub fn with_legacy_blends(&self, is_goalkeeper: bool) -> PlayerAttributes {
        let blends = self.legacy_blends(is_goalkeeper);
        PlayerAttributes {
            passing: blends.passing,
            shooting: blends.shooting,
            dribbling: blends.dribbling,
            aerial: blends.aerial,
            ..self.clone()
        }
    }
}

fn default_attr() -> u8 {
    50
}

/// The range a weak-foot skill is held to. `Player::weak_foot` is a bare `u8`, so
/// nothing in the type stops a 0 or a 200; the rating clamps to this, and package
/// validation refuses a value outside it, from the one definition.
pub const WEAK_FOOT_MIN: u8 = 1;
pub const WEAK_FOOT_MAX: u8 = 5;

fn default_weak_foot() -> u8 {
    2
}

fn default_fitness() -> u8 {
    75
}

/// Neutral, not zero: a player with no minutes on record yet — a new world, a
/// save from before this was tracked — is unknown, not frozen out. The `db`
/// column default must match.
pub const DEFAULT_PLAYING_TIME: u8 = 50;

fn default_playing_time() -> u8 {
    DEFAULT_PLAYING_TIME
}

/// An ordinary 6.0, in tenths: what a player with no rated matches on record is
/// taken to be. The `db` column default must match.
pub const DEFAULT_MATCH_FORM: u8 = 60;

fn default_match_form() -> u8 {
    DEFAULT_MATCH_FORM
}

/// Not known: a player built outside the generator, or saved before players
/// carried a body. Everything that reads a height treats 0 as average. The
/// `db` column default must match.
pub const DEFAULT_HEIGHT_CM: u16 = 0;

/// Not known, as for the height. The `db` column default must match.
pub const DEFAULT_WEIGHT_KG: u8 = 0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Injury {
    pub name: String,
    pub days_remaining: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PlayerIssueCategory {
    Contract,
    PlayingTime,
    Morale,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlayerIssue {
    pub category: PlayerIssueCategory,
    pub severity: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default)]
pub struct RecentTreatmentMemory {
    pub action_key: String,
    pub times_recently_used: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PlayerPromiseKind {
    PlayingTime,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum RenewalSessionStatus {
    #[default]
    Idle,
    Open,
    Agreed,
    Blocked,
    Stalled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum RenewalSessionOutcome {
    #[default]
    None,
    AcceptedByManager,
    AcceptedByAssistant,
    RejectedByPlayer,
    BlockedByManager,
    Stalled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ContractExitIntent {
    LetExpire {
        set_on: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ContractRenewalState {
    pub status: RenewalSessionStatus,
    pub manager_blocked_until: Option<String>,
    pub last_attempt_date: Option<String>,
    pub last_assistant_attempt_date: Option<String>,
    pub last_outcome: Option<RenewalSessionOutcome>,
    pub conversation_round: u8,
    pub exit_intent: Option<ContractExitIntent>,
}

impl Default for ContractRenewalState {
    fn default() -> Self {
        Self {
            status: RenewalSessionStatus::Idle,
            manager_blocked_until: None,
            last_attempt_date: None,
            last_assistant_attempt_date: None,
            last_outcome: None,
            conversation_round: 0,
            exit_intent: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct PlayerPromise {
    pub kind: PlayerPromiseKind,
    pub matches_remaining: u8,
}

impl Default for PlayerPromise {
    fn default() -> Self {
        Self {
            kind: PlayerPromiseKind::PlayingTime,
            matches_remaining: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct PlayerMoraleCore {
    pub manager_trust: u8,
    pub unresolved_issue: Option<PlayerIssue>,
    pub recent_treatment: Option<RecentTreatmentMemory>,
    pub pending_promise: Option<PlayerPromise>,
    pub talk_cooldown_until: Option<String>,
    pub renewal_state: Option<ContractRenewalState>,
}

impl Default for PlayerMoraleCore {
    fn default() -> Self {
        Self {
            manager_trust: 50,
            unresolved_issue: None,
            recent_treatment: None,
            pending_promise: None,
            talk_cooldown_until: None,
            renewal_state: None,
        }
    }
}

fn default_transfer_offer_status() -> TransferOfferStatus {
    TransferOfferStatus::Pending
}

fn default_transfer_offer_date() -> String {
    String::new()
}

fn default_transfer_offer_round() -> u8 {
    0
}

fn default_loan_offer_round() -> u8 {
    0
}

fn default_loan_offer_status() -> LoanOfferStatus {
    LoanOfferStatus::Pending
}

fn default_loan_offer_date() -> String {
    String::new()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct PlayerSeasonStats {
    pub appearances: u32,
    pub goals: u32,
    pub assists: u32,
    pub clean_sheets: u32,
    pub yellow_cards: u32,
    pub red_cards: u32,
    /// Mean of the match ratings this season, over `rated_appearances` only: a
    /// cameo too short to be rated is an appearance but not a rating.
    pub avg_rating: f32,
    /// Appearances long enough to be rated — what `avg_rating` is averaged over.
    pub rated_appearances: u32,
    pub minutes_played: u32,
    pub shots: u32,
    pub shots_on_target: u32,
    pub passes_completed: u32,
    pub passes_attempted: u32,
    pub tackles_won: u32,
    pub interceptions: u32,
    pub fouls_committed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CareerEntry {
    pub season: u32,
    pub team_id: String,
    pub team_name: String,
    pub appearances: u32,
    pub goals: u32,
    pub assists: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlayerMovementKind {
    PermanentTransfer,
    LoanStart,
    LoanReturn,
    LoanToBuy,
    FreeAgentSigning,
    Released,
    /// A new agreement with the club he is already at.
    Renewal,
    Retired,
    /// The contract in force when a career opened, or made from a save that
    /// predates the ledger.
    InitialContract,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlayerMovementEntry {
    pub date: String,
    pub kind: PlayerMovementKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_team_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_team_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_team_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_team_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fee: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loan_end_date: Option<String>,
    /// Present when this entry establishes a contract. See `contract_ledger`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<crate::contract_ledger::ContractRecord>,
    /// Present on a `Released` entry.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_reason: Option<crate::contract_ledger::ReleaseReason>,
}

impl PlayerMovementEntry {
    /// An entry with nothing but its date and kind; the rest is filled by struct
    /// update at the call site, so a new optional field does not touch every caller.
    pub fn new(date: impl Into<String>, kind: PlayerMovementKind) -> Self {
        Self {
            date: date.into(),
            kind,
            from_team_id: None,
            from_team_name: None,
            to_team_id: None,
            to_team_name: None,
            fee: None,
            loan_end_date: None,
            contract: None,
            release_reason: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferOffer {
    pub id: String,
    pub from_team_id: String,
    pub fee: u64,
    pub wage_offered: u32,
    #[serde(default)]
    pub last_manager_fee: Option<u64>,
    #[serde(default = "default_transfer_offer_round")]
    pub negotiation_round: u8,
    #[serde(default)]
    pub suggested_counter_fee: Option<u64>,
    #[serde(default = "default_transfer_offer_status")]
    pub status: TransferOfferStatus,
    #[serde(default = "default_transfer_offer_date")]
    pub date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registration_date: Option<String>,
    /// When talks ended, for offers that were rejected or withdrawn.
    ///
    /// Distinct from `date`, which is when the offer *arrived* and is rewritten whenever a club
    /// re-opens talks — so it can never answer "how long ago was this club turned away".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TransferOfferStatus {
    Pending,
    PendingRegistration,
    Accepted,
    Rejected,
    Withdrawn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoanOffer {
    pub id: String,
    pub from_team_id: String,
    pub parent_team_id: String,
    pub start_date: String,
    pub end_date: String,
    pub wage_contribution_pct: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buy_option_fee: Option<u64>,
    #[serde(default)]
    pub last_manager_wage_contribution_pct: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_manager_end_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_manager_buy_option_fee: Option<u64>,
    #[serde(default = "default_loan_offer_round")]
    pub negotiation_round: u8,
    #[serde(default)]
    pub suggested_wage_contribution_pct: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_end_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_buy_option_fee: Option<u64>,
    #[serde(default = "default_loan_offer_status")]
    pub status: LoanOfferStatus,
    #[serde(default = "default_loan_offer_date")]
    pub date: String,
    /// When talks ended, for offers that were rejected or withdrawn. See
    /// [`TransferOffer::closed_on`] for why `date` cannot serve this purpose.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub closed_on: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LoanOfferStatus {
    Pending,
    PendingRegistration,
    Accepted,
    Rejected,
    Withdrawn,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveLoan {
    pub parent_team_id: String,
    pub loan_team_id: String,
    pub start_date: String,
    pub end_date: String,
    pub wage_contribution_pct: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buy_option_fee: Option<u64>,
    #[serde(default)]
    pub loan_start_minutes: u32,
    #[serde(default)]
    pub loan_start_appearances: u32,
    #[serde(default)]
    pub development_reported_minutes: u32,
    #[serde(default)]
    pub development_reported_appearances: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PlayerTrait {
    // Physical
    Speedster, // pace >= 85
    Tank,      // strength >= 85 && stamina >= 75
    Agile,     // agility >= 85
    Tireless,  // stamina >= 90
    // Technical
    Playmaker,    // passing >= 80 && vision >= 80
    Sharpshooter, // shooting >= 85
    Dribbler,     // dribbling >= 85
    BallWinner,   // tackling >= 80 && aggression >= 70
    Rock,         // defending >= 85 && positioning >= 75
    // Mental
    Leader,     // leadership >= 85 && teamwork >= 75
    CoolHead,   // composure >= 85 && decisions >= 80
    Visionary,  // vision >= 85
    HotHead,    // aggression >= 85 && composure < 50
    TeamPlayer, // teamwork >= 85
    // Goalkeeper
    SafeHands,       // handling >= 85 (GK only)
    CatReflexes,     // reflexes >= 85 (GK only)
    AerialDominance, // outfield: aerial >= 88 && strength >= 80; GK: aerial >= 85
    // Combo / Special
    CompleteForward, // FWD: shooting >= 75 && dribbling >= 75 && pace >= 70 && strength >= 70
    Engine,          // MID: stamina >= 85 && pace >= 70 && teamwork >= 75
    // Split technique (phase 2). They show on the profile now; their match
    // effects arrive with the mechanics that read them (GĐ2–GĐ4).
    LongPasser,         // long_passing >= 80 && vision >= 70
    Crosser,            // crossing >= 80
    Curler,             // curve >= 80 && (shooting >= 70 || long_shots >= 70)
    LongShooter,        // long_shots >= 80
    PowerHeader,        // heading >= 80 && aerial >= 70
    PressResistant,     // first_touch >= 80 && composure >= 75
    DeadBallSpecialist, // free_kick >= 80 && curve >= 75 (replaces SetPieceSpecialist)
    TikiTaka,           // passing >= 85 && teamwork >= 75
    // Habit: assigned once when the player enters the world (see
    // `Player::assigned_traits`), never read off attributes.
    ShootsFromDistance,
    // Potential / Star
    Wonderkid, // age <= 21 && potential >= 85 && (potential - ovr) >= 10
}

impl PlayerTrait {
    /// A habit given once (see `ofm_core::assigned_traits`), which recomputing
    /// traits from attributes must keep rather than drop.
    pub fn is_assigned(&self) -> bool {
        matches!(self, PlayerTrait::ShootsFromDistance)
    }
}

/// Derive traits purely from a player's attributes. The position only tells a
/// keeper apart, whose aerial blend is his own.
pub fn compute_traits(attrs: &PlayerAttributes, position: &Position) -> Vec<PlayerTrait> {
    let mut traits = Vec::new();
    // The original traits' thresholds, and their match effects, were tuned on
    // the pre-split blends, so they read those until the mechanics they feed
    // move onto the split attributes (GĐ2–GĐ4).
    let blends = attrs.legacy_blends(matches!(position, Position::Goalkeeper));

    // Physical
    if attrs.pace >= 85 {
        traits.push(PlayerTrait::Speedster);
    }
    if attrs.strength >= 85 && attrs.stamina >= 75 {
        traits.push(PlayerTrait::Tank);
    }
    if attrs.agility >= 85 {
        traits.push(PlayerTrait::Agile);
    }
    if attrs.stamina >= 90 {
        traits.push(PlayerTrait::Tireless);
    }

    // Technical
    if blends.passing >= 80 && attrs.vision >= 80 {
        traits.push(PlayerTrait::Playmaker);
    }
    if blends.shooting >= 85 {
        traits.push(PlayerTrait::Sharpshooter);
    }
    if blends.dribbling >= 85 {
        traits.push(PlayerTrait::Dribbler);
    }
    if attrs.tackling >= 80 && attrs.aggression >= 70 {
        traits.push(PlayerTrait::BallWinner);
    }
    if attrs.defending >= 85 && attrs.positioning >= 75 {
        traits.push(PlayerTrait::Rock);
    }

    // Mental
    if attrs.leadership >= 85 && attrs.teamwork >= 75 {
        traits.push(PlayerTrait::Leader);
    }
    if attrs.composure >= 85 && attrs.decisions >= 80 {
        traits.push(PlayerTrait::CoolHead);
    }
    if attrs.vision >= 85 {
        traits.push(PlayerTrait::Visionary);
    }
    if attrs.aggression >= 85 && attrs.composure < 50 {
        traits.push(PlayerTrait::HotHead);
    }
    if attrs.teamwork >= 85 {
        traits.push(PlayerTrait::TeamPlayer);
    }

    // Goalkeeper-oriented (any player with high GK stats can earn these)
    if attrs.handling >= 85 {
        traits.push(PlayerTrait::SafeHands);
    }
    if attrs.reflexes >= 85 {
        traits.push(PlayerTrait::CatReflexes);
    }
    let dominates_the_air = if matches!(position, Position::Goalkeeper) {
        attrs.aerial >= 85
    } else {
        attrs.aerial >= 88 && attrs.strength >= 80
    };
    if dominates_the_air {
        traits.push(PlayerTrait::AerialDominance);
    }

    // Combo / Special — purely attribute-based
    if blends.shooting >= 75 && blends.dribbling >= 75 && attrs.pace >= 70 && attrs.strength >= 70 {
        traits.push(PlayerTrait::CompleteForward);
    }
    if attrs.stamina >= 85 && attrs.pace >= 70 && attrs.teamwork >= 75 {
        traits.push(PlayerTrait::Engine);
    }

    // Split technique. These read the split attributes themselves.
    if attrs.long_passing >= 80 && attrs.vision >= 70 {
        traits.push(PlayerTrait::LongPasser);
    }
    if attrs.crossing >= 80 {
        traits.push(PlayerTrait::Crosser);
    }
    if attrs.curve >= 80 && (attrs.shooting >= 70 || attrs.long_shots >= 70) {
        traits.push(PlayerTrait::Curler);
    }
    if attrs.long_shots >= 80 {
        traits.push(PlayerTrait::LongShooter);
    }
    if attrs.heading >= 80 && attrs.aerial >= 70 {
        traits.push(PlayerTrait::PowerHeader);
    }
    if attrs.first_touch >= 80 && attrs.composure >= 75 {
        traits.push(PlayerTrait::PressResistant);
    }
    if attrs.free_kick >= 80 && attrs.curve >= 75 {
        traits.push(PlayerTrait::DeadBallSpecialist);
    }
    if attrs.passing >= 85 && attrs.teamwork >= 75 {
        traits.push(PlayerTrait::TikiTaka);
    }

    traits
}

impl Player {
    pub fn new(
        id: String,
        match_name: String,
        full_name: String,
        date_of_birth: String,
        nationality: String,
        position: Position,
        attributes: PlayerAttributes,
    ) -> Self {
        let traits = compute_traits(&attributes, &position);
        let football_nation = crate::identity::normalize_football_nation_code(&nationality);
        let birth_country = crate::identity::derive_birth_country_code(&nationality);
        Self {
            id,
            match_name,
            full_name,
            date_of_birth,
            nationality,
            football_nation,
            birth_country,
            media: PlayerMedia::default(),
            natural_position: position.clone(),
            position,
            alternate_positions: Vec::new(),
            footedness: Footedness::default(),
            weak_foot: default_weak_foot(),
            attributes,
            condition: 100,
            morale: 100,
            fitness: 75,
            playing_time: default_playing_time(),
            match_form: default_match_form(),
            injury: None,
            team_id: None,
            retired: false,
            squad_role: SquadRole::Senior,
            traits,
            ovr: 0,
            potential: 0,
            market_value: 0,
            stats: PlayerSeasonStats::default(),
            career: Vec::new(),
            movement_history: Default::default(),
            training_focus: None,
            transfer_listed: false,
            loan_listed: false,
            transfer_offers: Vec::new(),
            loan_offers: Vec::new(),
            active_loan: None,
            morale_core: PlayerMoraleCore::default(),
            jersey_number: None,
            height_cm: DEFAULT_HEIGHT_CM,
            weight_kg: DEFAULT_WEIGHT_KG,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every attribute, split ones included, at an unremarkable 50.
    fn plain() -> PlayerAttributes {
        let mut a = sample_attributes();
        for v in [
            &mut a.pace,
            &mut a.stamina,
            &mut a.strength,
            &mut a.agility,
            &mut a.passing,
            &mut a.shooting,
            &mut a.tackling,
            &mut a.dribbling,
            &mut a.defending,
            &mut a.positioning,
            &mut a.vision,
            &mut a.decisions,
            &mut a.composure,
            &mut a.aggression,
            &mut a.teamwork,
            &mut a.leadership,
            &mut a.handling,
            &mut a.reflexes,
            &mut a.aerial,
            &mut a.long_passing,
            &mut a.crossing,
            &mut a.curve,
            &mut a.free_kick,
            &mut a.long_shots,
            &mut a.first_touch,
            &mut a.heading,
        ] {
            *v = 50;
        }
        a
    }

    fn traits_of(a: &PlayerAttributes, position: Position) -> Vec<PlayerTrait> {
        compute_traits(a, &position)
    }

    /// Given a player one point under and then exactly at each new trait's
    /// thresholds,
    /// when traits are computed,
    /// then the trait appears only at the threshold.
    #[test]
    fn each_split_attribute_trait_starts_at_its_threshold() {
        type Setter = fn(&mut PlayerAttributes, u8);
        let cases: [(PlayerTrait, Setter); 8] = [
            (PlayerTrait::LongPasser, |a, d| {
                (a.long_passing, a.vision) = (80 - d, 70)
            }),
            (PlayerTrait::Crosser, |a, d| a.crossing = 80 - d),
            (PlayerTrait::Curler, |a, d| {
                (a.curve, a.long_shots) = (80 - d, 70)
            }),
            (PlayerTrait::LongShooter, |a, d| a.long_shots = 80 - d),
            (PlayerTrait::PowerHeader, |a, d| {
                (a.heading, a.aerial) = (80 - d, 70)
            }),
            (PlayerTrait::PressResistant, |a, d| {
                (a.first_touch, a.composure) = (80 - d, 75)
            }),
            (PlayerTrait::DeadBallSpecialist, |a, d| {
                (a.free_kick, a.curve) = (80 - d, 75)
            }),
            (PlayerTrait::TikiTaka, |a, d| {
                (a.passing, a.teamwork) = (85 - d, 75)
            }),
        ];
        for (expected, set) in cases {
            let mut below = plain();
            set(&mut below, 1);
            assert!(
                !traits_of(&below, Position::CentralMidfielder).contains(&expected),
                "{expected:?} below"
            );
            let mut at = plain();
            set(&mut at, 0);
            assert!(
                traits_of(&at, Position::CentralMidfielder).contains(&expected),
                "{expected:?} at"
            );
        }
    }

    /// Given an outfielder who jumps at 90 but is not strong, and a keeper at 85,
    /// when traits are computed,
    /// then only the keeper dominates the air: an outfielder needs strength 80 too.
    #[test]
    fn aerial_dominance_asks_an_outfielder_for_strength() {
        let mut jumper = plain();
        jumper.aerial = 90;
        assert!(!traits_of(&jumper, Position::CenterBack).contains(&PlayerTrait::AerialDominance));
        jumper.strength = 80;
        jumper.aerial = 88;
        assert!(traits_of(&jumper, Position::CenterBack).contains(&PlayerTrait::AerialDominance));
        let mut keeper = plain();
        keeper.aerial = 85;
        assert!(traits_of(&keeper, Position::Goalkeeper).contains(&PlayerTrait::AerialDominance));
    }

    /// Given a player with outstanding long shots,
    /// when traits are computed,
    /// then he is a long shooter but never "shoots from distance": that habit is
    /// assigned once, not read off attributes.
    #[test]
    fn shooting_from_distance_is_never_computed() {
        let mut a = plain();
        a.long_shots = 99;
        let traits = traits_of(&a, Position::AttackingMidfielder);
        assert!(traits.contains(&PlayerTrait::LongShooter));
        assert!(!traits.contains(&PlayerTrait::ShootsFromDistance));
    }

    /// Given attributes from before the split (the seven new fields 0),
    /// when the legacy blends are read,
    /// then they are the stored fields unchanged.
    #[test]
    fn legacy_blends_of_undeclared_attributes_are_the_stored_fields() {
        let attrs = sample_attributes();
        let blends = attrs.legacy_blends(false);
        assert_eq!(
            (
                blends.passing,
                blends.shooting,
                blends.dribbling,
                blends.aerial
            ),
            (attrs.passing, attrs.shooting, attrs.dribbling, attrs.aerial)
        );
    }

    /// Given split attributes,
    /// when the legacy blends are read,
    /// then each is rebuilt by the pre-split formula (0.45/0.30/0.15/0.10 for
    /// passing, 0.8/0.2 for shooting, halves for dribbling and aerial).
    #[test]
    fn legacy_blends_rebuild_the_pre_split_formulas() {
        let mut attrs = sample_attributes();
        attrs.passing = 80;
        attrs.long_passing = 60;
        attrs.crossing = 40;
        attrs.curve = 50;
        attrs.shooting = 70;
        attrs.long_shots = 50;
        attrs.dribbling = 60;
        attrs.first_touch = 80;
        attrs.aerial = 70;
        attrs.heading = 50;
        let blends = attrs.legacy_blends(false);
        // 36 + 18 + 6 + 5 = 65; 56 + 10 = 66; 70; 60.
        assert_eq!(
            (
                blends.passing,
                blends.shooting,
                blends.dribbling,
                blends.aerial
            ),
            (65, 66, 70, 60)
        );
    }

    /// Given a goalkeeper with a heading value,
    /// when the aerial blend is read,
    /// then it is the keeper's aerial alone: a keeper's aerial never mixed in heading.
    #[test]
    fn a_goalkeepers_aerial_blend_ignores_heading() {
        let mut attrs = sample_attributes();
        attrs.aerial = 80;
        attrs.heading = 20;
        attrs.long_passing = 60;
        attrs.crossing = 30;
        attrs.curve = 30;
        assert_eq!(attrs.legacy_blends(true).aerial, 80);
        assert_eq!(attrs.legacy_blends(false).aerial, 50);
    }

    fn sample_attributes() -> PlayerAttributes {
        PlayerAttributes {
            pace: 70,
            stamina: 72,
            strength: 65,
            agility: 68,
            passing: 74,
            shooting: 61,
            tackling: 58,
            dribbling: 69,
            defending: 56,
            positioning: 67,
            vision: 73,
            decisions: 71,
            composure: 66,
            aggression: 54,
            teamwork: 76,
            leadership: 49,
            handling: 20,
            reflexes: 24,
            aerial: 44,
            long_passing: 0,
            crossing: 0,
            curve: 0,
            free_kick: 0,
            long_shots: 0,
            first_touch: 0,
            heading: 0,
        }
    }

    #[test]
    fn player_new_defaults_footedness_and_weak_foot() {
        let player = Player::new(
            "p-001".to_string(),
            "J. Smith".to_string(),
            "John Smith".to_string(),
            "2000-01-15".to_string(),
            "GB".to_string(),
            Position::Midfielder,
            sample_attributes(),
        );

        assert_eq!(player.footedness, Footedness::Right);
        assert_eq!(player.weak_foot, 2);
        assert_eq!(player.squad_role, SquadRole::Senior);
        assert_eq!(player.squad_role, SquadRole::Senior);
    }

    #[test]
    fn position_group_conversion_maps_granular_positions_back_to_legacy_groups() {
        assert_eq!(Position::RightBack.to_group_position(), Position::Defender);
        assert_eq!(
            Position::AttackingMidfielder.to_group_position(),
            Position::Midfielder,
        );
        assert_eq!(Position::LeftWinger.to_group_position(), Position::Forward);
    }

    #[test]
    fn player_deserialization_defaults_missing_foot_fields() {
        let player: Player = serde_json::from_value(serde_json::json!({
            "id": "p-legacy",
            "match_name": "J. Legacy",
            "full_name": "John Legacy",
            "date_of_birth": "2000-01-15",
            "nationality": "GB",
            "position": "Midfielder",
            "natural_position": "Midfielder",
            "alternate_positions": [],
            "attributes": sample_attributes(),
            "condition": 100,
            "morale": 100,
            "injury": null,
            "team_id": null,
            "traits": [],
            "contract_end": null,
            "wage": 0,
            "market_value": 0,
            "stats": {},
            "career": [],
            "transfer_listed": false,
            "loan_listed": false,
            "transfer_offers": [],
            "morale_core": {}
        }))
        .expect("legacy player json should deserialize");

        assert_eq!(player.footedness, Footedness::Right);
        assert_eq!(player.weak_foot, 2);
        assert_eq!(player.natural_position, Position::Midfielder);
        assert!(!player.retired);
        assert!(player.movement_history.is_empty());
    }

    /// Given a player who has just been created,
    /// When nothing about his minutes is known yet,
    /// Then his playing time sits at the neutral midpoint rather than at zero.
    #[test]
    fn a_new_player_starts_at_neutral_playing_time() {
        let player = Player::new(
            "p-002".to_string(),
            "A. New".to_string(),
            "Alex New".to_string(),
            "2007-02-01".to_string(),
            "GB".to_string(),
            Position::Forward,
            sample_attributes(),
        );

        assert_eq!(player.playing_time, 50);
    }

    /// Given a player who has just been created,
    /// When nothing about his matches is known yet,
    /// Then his form is an ordinary 6.0.
    #[test]
    fn a_new_player_starts_in_ordinary_form() {
        let player = Player::new(
            "p-003".to_string(),
            "F. Orm".to_string(),
            "Frank Orm".to_string(),
            "2006-05-01".to_string(),
            "GB".to_string(),
            Position::Midfielder,
            sample_attributes(),
        );

        assert_eq!(player.match_form, 60);
    }

    /// Given a save written before match form was tracked,
    /// When a player from it is loaded,
    /// Then his form is an ordinary 6.0, the same as a new player's.
    #[test]
    fn a_player_from_an_older_save_loads_in_ordinary_form() {
        let player: Player = serde_json::from_value(serde_json::json!({
            "id": "p-legacy",
            "match_name": "J. Legacy",
            "full_name": "John Legacy",
            "date_of_birth": "2000-01-15",
            "nationality": "GB",
            "position": "Midfielder",
            "attributes": sample_attributes(),
            "condition": 100,
            "morale": 100,
            "injury": null,
            "team_id": null,
            "market_value": 0,
            "stats": {},
            "career": [],
        }))
        .expect("a player saved before match form existed should deserialize");

        assert_eq!(player.match_form, 60);
    }

    /// Given a save written before players carried a body,
    /// When a player from it is loaded,
    /// Then his height and weight read as not known.
    #[test]
    fn a_player_from_an_older_save_has_no_known_height_or_weight() {
        let player: Player = serde_json::from_value(serde_json::json!({
            "id": "p-legacy",
            "match_name": "J. Legacy",
            "full_name": "John Legacy",
            "date_of_birth": "2000-01-15",
            "nationality": "GB",
            "position": "Midfielder",
            "attributes": sample_attributes(),
            "condition": 100,
            "morale": 100,
            "injury": null,
            "team_id": null,
            "market_value": 0,
            "stats": {},
            "career": [],
        }))
        .expect("a player saved before height and weight existed should deserialize");

        assert_eq!(player.height_cm, DEFAULT_HEIGHT_CM);
        assert_eq!(player.weight_kg, DEFAULT_WEIGHT_KG);
    }

    /// Given a save written before playing time was tracked,
    /// When a player from it is loaded,
    /// Then he reads as neutral playing time, the same as a new player.
    #[test]
    fn a_player_from_an_older_save_loads_with_neutral_playing_time() {
        let player: Player = serde_json::from_value(serde_json::json!({
            "id": "p-legacy",
            "match_name": "J. Legacy",
            "full_name": "John Legacy",
            "date_of_birth": "2000-01-15",
            "nationality": "GB",
            "position": "Midfielder",
            "attributes": sample_attributes(),
            "condition": 100,
            "morale": 100,
            "injury": null,
            "team_id": null,
            "market_value": 0,
            "stats": {},
            "career": [],
        }))
        .expect("a player saved before playing time existed should deserialize");

        assert_eq!(player.playing_time, 50);
    }
}
