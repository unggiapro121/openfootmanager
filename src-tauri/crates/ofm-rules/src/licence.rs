//! The online coach's licence (phase 3, S-9): which tactical controls a coach may use, by the
//! licence his online coach level earns him. Offline everything is open (X13), so the game never
//! asks; the online server asks for every setup it keeps and every order a match takes.
//!
//! A licence closes *controls*, never the rules of the match (X14): a closed control stands at its
//! neutral default, and both sides play by one set of laws. The licences nest, the highest opens
//! everything, and a later release may open more but never close what is open
//! (`tests/licence_table.json`, S9-21), so a setup that was allowed stays allowed.

use std::collections::BTreeSet;

use domain::manager::PlayStyleMastery;
use domain::team::{PlayStyle, PlayerRole, TacticsPhaseSettings, Team};
use engine::{MatchCommand, TacticalDial};
use serde::{Deserialize, Serialize};

use crate::setup::{ClubSetup, SetupIssue};
use crate::squad::{domain_play_style, domain_to_engine_role};

/// The highest licence: everything open.
pub const ELITE: u8 = 4;

/// The coach levels at which the second, third and fourth licences start (S9-1). Level 1 is
/// always the first licence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub struct LicenceLevels {
    pub national: u16,
    pub continental: u16,
    pub elite: u16,
}

impl Default for LicenceLevels {
    /// Two, four and seven: an average coach in a full region reaches the second licence in about
    /// three seasons and the fourth in about twenty (S-9 §2.3).
    fn default() -> Self {
        Self {
            national: 2,
            continental: 4,
            elite: 7,
        }
    }
}

impl LicenceLevels {
    /// The licence of a coach at `level`, 1 to 4.
    pub fn tier(&self, level: u16) -> u8 {
        if level >= self.elite {
            4
        } else if level >= self.continental {
            3
        } else if level >= self.national {
            2
        } else {
            1
        }
    }

    /// The coach level `tier` starts at; `None` past the highest.
    pub fn starts_at(&self, tier: u8) -> Option<u16> {
        match tier {
            0 | 1 => Some(1),
            2 => Some(self.national),
            3 => Some(self.continental),
            4 => Some(self.elite),
            _ => None,
        }
    }
}

/// One of the tactical dials a club sets before and during a match: the fields of
/// [`TacticsPhaseSettings`], named as that type serialises them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub enum Dial {
    BuildUpStyle,
    Width,
    Tempo,
    DefensiveLine,
    PressingIntensity,
    DefensiveShape,
    MarkingStyle,
    CounterPressDuration,
    BreakSpeed,
    CrossStyle,
    OffsideTrap,
}

impl Dial {
    pub const ALL: [Dial; 11] = [
        Dial::BuildUpStyle,
        Dial::Width,
        Dial::Tempo,
        Dial::DefensiveLine,
        Dial::PressingIntensity,
        Dial::DefensiveShape,
        Dial::MarkingStyle,
        Dial::CounterPressDuration,
        Dial::BreakSpeed,
        Dial::CrossStyle,
        Dial::OffsideTrap,
    ];

    /// The dial a match order turns.
    pub fn of(order: &TacticalDial) -> Dial {
        match order {
            TacticalDial::BuildUpStyle(_) => Dial::BuildUpStyle,
            TacticalDial::Width(_) => Dial::Width,
            TacticalDial::Tempo(_) => Dial::Tempo,
            TacticalDial::DefensiveLine(_) => Dial::DefensiveLine,
            TacticalDial::PressingIntensity(_) => Dial::PressingIntensity,
            TacticalDial::DefensiveShape(_) => Dial::DefensiveShape,
            TacticalDial::MarkingStyle(_) => Dial::MarkingStyle,
            TacticalDial::CounterPressDuration(_) => Dial::CounterPressDuration,
            TacticalDial::BreakSpeed(_) => Dial::BreakSpeed,
            TacticalDial::CrossStyle(_) => Dial::CrossStyle,
            TacticalDial::OffsideTrap(_) => Dial::OffsideTrap,
        }
    }

    /// Whether `settings` hold this dial at its neutral default.
    fn is_default(self, settings: &TacticsPhaseSettings) -> bool {
        let neutral = TacticsPhaseSettings::default();
        match self {
            Dial::BuildUpStyle => settings.build_up_style == neutral.build_up_style,
            Dial::Width => settings.width == neutral.width,
            Dial::Tempo => settings.tempo == neutral.tempo,
            Dial::DefensiveLine => settings.defensive_line == neutral.defensive_line,
            Dial::PressingIntensity => settings.pressing_intensity == neutral.pressing_intensity,
            Dial::DefensiveShape => settings.defensive_shape == neutral.defensive_shape,
            Dial::MarkingStyle => settings.marking_style == neutral.marking_style,
            Dial::CounterPressDuration => {
                settings.counter_press_duration == neutral.counter_press_duration
            }
            Dial::BreakSpeed => settings.break_speed == neutral.break_speed,
            Dial::CrossStyle => settings.cross_style == neutral.cross_style,
            Dial::OffsideTrap => settings.offside_trap == neutral.offside_trap,
        }
    }

    /// Put this dial of `settings` back to its neutral default.
    fn reset(self, settings: &mut TacticsPhaseSettings) {
        let neutral = TacticsPhaseSettings::default();
        match self {
            Dial::BuildUpStyle => settings.build_up_style = neutral.build_up_style,
            Dial::Width => settings.width = neutral.width,
            Dial::Tempo => settings.tempo = neutral.tempo,
            Dial::DefensiveLine => settings.defensive_line = neutral.defensive_line,
            Dial::PressingIntensity => settings.pressing_intensity = neutral.pressing_intensity,
            Dial::DefensiveShape => settings.defensive_shape = neutral.defensive_shape,
            Dial::MarkingStyle => settings.marking_style = neutral.marking_style,
            Dial::CounterPressDuration => {
                settings.counter_press_duration = neutral.counter_press_duration;
            }
            Dial::BreakSpeed => settings.break_speed = neutral.break_speed,
            Dial::CrossStyle => settings.cross_style = neutral.cross_style,
            Dial::OffsideTrap => settings.offside_trap = neutral.offside_trap,
        }
    }

    /// The licence that opens this dial (S-9 §3.2).
    fn opens_at(self) -> u8 {
        match self {
            Dial::BuildUpStyle | Dial::Width | Dial::DefensiveLine => 2,
            Dial::BreakSpeed
            | Dial::CounterPressDuration
            | Dial::CrossStyle
            | Dial::PressingIntensity
            | Dial::Tempo => 3,
            Dial::DefensiveShape | Dial::MarkingStyle | Dial::OffsideTrap => 4,
        }
    }
}

/// The shapes the first licence plays.
const GRASSROOTS_FORMATIONS: [&str; 3] = ["4-4-2", "4-3-3", "3-5-2"];

fn formation_opens_at(formation: &str) -> u8 {
    if GRASSROOTS_FORMATIONS.contains(&formation) {
        1
    } else {
        2
    }
}

const STYLES: [PlayStyle; 6] = [
    PlayStyle::Balanced,
    PlayStyle::Attacking,
    PlayStyle::Defensive,
    PlayStyle::Possession,
    PlayStyle::Counter,
    PlayStyle::HighPress,
];

fn style_opens_at(style: &PlayStyle) -> u8 {
    match style {
        PlayStyle::Balanced | PlayStyle::Attacking | PlayStyle::Defensive => 1,
        PlayStyle::Possession | PlayStyle::Counter | PlayStyle::HighPress => 2,
    }
}

/// Every role but `Standard`, in the order a licence lists them.
const ROLES: [PlayerRole; 28] = [
    PlayerRole::BallPlayingKeeper,
    PlayerRole::SweeperKeeper,
    PlayerRole::Stopper,
    PlayerRole::CoverCB,
    PlayerRole::BallPlayingCB,
    PlayerRole::AttackingFB,
    PlayerRole::DefensiveFB,
    PlayerRole::InvertedFB,
    PlayerRole::WingBack,
    PlayerRole::AnchorMan,
    PlayerRole::BallWinner,
    PlayerRole::HalfBack,
    PlayerRole::DeepLyingPlaymaker,
    PlayerRole::BoxToBox,
    PlayerRole::Carrilero,
    PlayerRole::Mezzala,
    PlayerRole::AdvancedPlaymaker,
    PlayerRole::ShadowStriker,
    PlayerRole::WideForward,
    PlayerRole::DefensiveWinger,
    PlayerRole::InsideForward,
    PlayerRole::InvertedWinger,
    PlayerRole::Poacher,
    PlayerRole::TargetMan,
    PlayerRole::DeepLyingForward,
    PlayerRole::False9,
    PlayerRole::PressingForward,
    PlayerRole::CompleteForward,
];

/// The licence that opens a role; `Standard` is open to every coach (S-9 §3.2). The match has no
/// wildcard on purpose: a new role does not compile until it is given a licence.
fn role_opens_at(role: &PlayerRole) -> u8 {
    match role {
        PlayerRole::Standard => 1,
        PlayerRole::Stopper
        | PlayerRole::CoverCB
        | PlayerRole::AnchorMan
        | PlayerRole::Poacher
        | PlayerRole::TargetMan
        | PlayerRole::WideForward
        | PlayerRole::AttackingFB
        | PlayerRole::DefensiveFB
        | PlayerRole::WingBack => 2,
        PlayerRole::SweeperKeeper
        | PlayerRole::InvertedFB
        | PlayerRole::DeepLyingPlaymaker
        | PlayerRole::BoxToBox
        | PlayerRole::Mezzala
        | PlayerRole::InsideForward
        | PlayerRole::BallPlayingCB
        | PlayerRole::BallWinner
        | PlayerRole::AdvancedPlaymaker
        | PlayerRole::InvertedWinger
        | PlayerRole::DeepLyingForward
        | PlayerRole::PressingForward => 3,
        PlayerRole::BallPlayingKeeper
        | PlayerRole::HalfBack
        | PlayerRole::ShadowStriker
        | PlayerRole::DefensiveWinger
        | PlayerRole::False9
        | PlayerRole::Carrilero
        | PlayerRole::CompleteForward => 4,
    }
}

/// What a side may set: the controls its licence opens. Each list holds the open ones, in the
/// order of the game's own lists. A match keeps the lists, not the licence number, so a later
/// release that opens more does not change a match already played (S9-5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub struct LicenceControls {
    pub tier: u8,
    pub formations: Vec<String>,
    pub play_styles: Vec<PlayStyle>,
    pub dials: Vec<Dial>,
    /// Roles beyond `Standard`, which is always open.
    pub roles: Vec<PlayerRole>,
}

/// The controls licence `tier` opens; a tier past the highest opens everything.
pub fn controls(tier: u8) -> LicenceControls {
    let tier = tier.clamp(1, ELITE);
    LicenceControls {
        tier,
        formations: engine::FORMATIONS
            .iter()
            .filter(|formation| formation_opens_at(formation) <= tier)
            .map(|formation| (*formation).to_string())
            .collect(),
        play_styles: STYLES
            .iter()
            .filter(|style| style_opens_at(style) <= tier)
            .cloned()
            .collect(),
        dials: Dial::ALL
            .iter()
            .copied()
            .filter(|dial| dial.opens_at() <= tier)
            .collect(),
        roles: ROLES
            .iter()
            .filter(|role| role_opens_at(role) <= tier)
            .cloned()
            .collect(),
    }
}

impl LicenceControls {
    /// Everything open: the highest licence.
    pub fn all_open() -> Self {
        controls(ELITE)
    }

    fn opens_formation(&self, formation: &str) -> bool {
        self.formations.iter().any(|open| open == formation)
    }

    fn opens_role(&self, role: &PlayerRole) -> bool {
        *role == PlayerRole::Standard || self.roles.contains(role)
    }

    /// Whether a side may give `command`. Only shape, style, dial and role orders are ever closed;
    /// substitutions, swaps, captains and set-piece takers are management, not tactical depth
    /// (S9-4).
    pub fn allows_command(&self, command: &MatchCommand) -> bool {
        match command {
            MatchCommand::ChangeFormation { formation, .. } => self.opens_formation(formation),
            MatchCommand::ChangePlayStyle { play_style, .. } => {
                self.play_styles.contains(&domain_play_style(*play_style))
            }
            MatchCommand::ChangeTacticalDial { dial, .. } => self.dials.contains(&Dial::of(dial)),
            MatchCommand::ChangePlayerRole { role, .. } => {
                *role == engine::PlayerRole::Standard
                    || self
                        .roles
                        .iter()
                        .any(|open| domain_to_engine_role(open) == *role)
            }
            MatchCommand::Substitute { .. }
            | MatchCommand::SetFreeKickTaker { .. }
            | MatchCommand::SetCornerTaker { .. }
            | MatchCommand::SetPenaltyTaker { .. }
            | MatchCommand::SetCaptain { .. }
            | MatchCommand::PreMatchSwap { .. }
            | MatchCommand::PreMatchSwapPositions { .. }
            | MatchCommand::SwapPositions { .. } => true,
        }
    }
}

/// What in `setup` the licence does not open, in a stable order: the shape, the style, each
/// player's role by id, and once for any closed dial set away from its default. A shape the
/// engine does not play at all is `setup::setup_issues`' to report, not this.
pub fn setup_issues(setup: &ClubSetup, controls: &LicenceControls) -> Vec<SetupIssue> {
    let mut issues = Vec::new();
    if engine::FORMATIONS.contains(&setup.formation.as_str())
        && !controls.opens_formation(&setup.formation)
    {
        issues.push(SetupIssue::LockedFormation);
    }
    if !controls.play_styles.contains(&setup.play_style) {
        issues.push(SetupIssue::LockedPlayStyle);
    }
    let closed_roles: BTreeSet<&str> = setup
        .player_roles
        .iter()
        .filter(|(_, role)| !controls.opens_role(role))
        .map(|(id, _)| id.as_str())
        .collect();
    issues.extend(
        closed_roles
            .into_iter()
            .map(|id| SetupIssue::LockedRole(id.to_string())),
    );
    let closed_dial_set = Dial::ALL
        .iter()
        .any(|dial| !controls.dials.contains(dial) && !dial.is_default(&setup.tactics_phase));
    if closed_dial_set {
        issues.push(SetupIssue::LockedTactics);
    }
    issues
}

/// One control moved by [`fit_team`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub struct Change<T> {
    pub from: T,
    pub to: T,
}

/// What [`fit_team`] moved: the shape and style when they changed, and how many dials and roles
/// went back to their defaults. The server counts it and tells the club's coach.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub struct Fitted {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub formation: Option<Change<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub play_style: Option<Change<PlayStyle>>,
    pub dials: u8,
    pub roles: u8,
}

impl Fitted {
    /// Whether nothing moved.
    pub fn is_empty(&self) -> bool {
        *self == Fitted::default()
    }
}

/// The open shape a closed one becomes: the nearest, keeping the back line where it can. Only the
/// first licence closes shapes, and its three are each a target here.
fn nearest_open_formation(formation: &str, controls: &LicenceControls) -> Option<String> {
    let nearest = match formation {
        "4-2-3-1" => "4-3-3",
        "4-5-1" | "4-1-4-1" => "4-4-2",
        "3-4-3" | "3-4-2-1" | "5-3-2" => "3-5-2",
        _ => "",
    };
    if controls.opens_formation(nearest) {
        Some(nearest.to_string())
    } else {
        controls.formations.first().cloned()
    }
}

/// The open style a closed one becomes. A bot plays the open style its coach knows best; a
/// person's choice moves to the open style nearest in spirit.
fn open_style(
    style: &PlayStyle,
    controls: &LicenceControls,
    mastery: Option<&PlayStyleMastery>,
) -> Option<PlayStyle> {
    if let Some(mastery) = mastery {
        // The first of the best, in the game's own order of styles.
        let mut best: Option<&PlayStyle> = None;
        for open in &controls.play_styles {
            if best.is_none_or(|current| mastery.for_style(open) > mastery.for_style(current)) {
                best = Some(open);
            }
        }
        return best.cloned();
    }
    let nearest = match style {
        PlayStyle::Possession => PlayStyle::Balanced,
        PlayStyle::Counter => PlayStyle::Defensive,
        PlayStyle::HighPress => PlayStyle::Attacking,
        other => other.clone(),
    };
    if controls.play_styles.contains(&nearest) {
        Some(nearest)
    } else {
        controls.play_styles.first().cloned()
    }
}

/// `team` with everything its licence does not open put back where the licence allows: a closed
/// dial to its default, a closed role to `Standard`, a closed style and shape to the nearest open
/// one (`mastery`, a bot coach's, picks a bot's style). Running it twice changes nothing more. The
/// eleven is kept: the squad bridge slots it into a new shape as it does any setup, and drops a
/// stored role the slot no longer admits.
pub fn fit_team(
    team: &mut Team,
    controls: &LicenceControls,
    mastery: Option<&PlayStyleMastery>,
) -> Fitted {
    let mut fitted = Fitted::default();
    if engine::FORMATIONS.contains(&team.formation.as_str())
        && !controls.opens_formation(&team.formation)
        && let Some(to) = nearest_open_formation(&team.formation, controls)
    {
        fitted.formation = Some(Change {
            from: std::mem::replace(&mut team.formation, to.clone()),
            to,
        });
    }
    if !controls.play_styles.contains(&team.play_style)
        && let Some(to) = open_style(&team.play_style, controls, mastery)
    {
        fitted.play_style = Some(Change {
            from: std::mem::replace(&mut team.play_style, to.clone()),
            to,
        });
    }
    for dial in Dial::ALL {
        if !controls.dials.contains(&dial) && !dial.is_default(&team.tactics_phase) {
            dial.reset(&mut team.tactics_phase);
            fitted.dials += 1;
        }
    }
    let before = team.player_roles.len();
    team.player_roles
        .retain(|_, role| controls.opens_role(role));
    fitted.roles = u8::try_from(before - team.player_roles.len()).unwrap_or(u8::MAX);
    fitted
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use domain::team::{
        BreakSpeed, BuildUpStyle, DefensiveLine, MarkingStyle, MatchRoles, OffsideTrap, PitchWidth,
    };
    use engine::Side;

    use super::*;

    fn team() -> Team {
        Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        )
    }

    fn setup(formation: &str, style: PlayStyle) -> ClubSetup {
        ClubSetup {
            formation: formation.into(),
            play_style: style,
            starting_xi_ids: Vec::new(),
            player_roles: HashMap::new(),
            tactics_phase: TacticsPhaseSettings::default(),
            match_roles: MatchRoles::default(),
        }
    }

    fn open_items(controls: &LicenceControls) -> BTreeSet<String> {
        let mut items = BTreeSet::new();
        items.extend(controls.formations.iter().map(|f| format!("formation:{f}")));
        items.extend(controls.play_styles.iter().map(|s| format!("style:{s:?}")));
        items.extend(controls.dials.iter().map(|d| format!("dial:{d:?}")));
        items.extend(controls.roles.iter().map(|r| format!("role:{r:?}")));
        items
    }

    /// Given the four licences,
    /// when each is compared with the next,
    /// then everything the lower one opens the higher one opens too.
    #[test]
    fn every_licence_opens_all_the_one_below_does() {
        for tier in 1..ELITE {
            let lower = open_items(&controls(tier));
            let higher = open_items(&controls(tier + 1));
            assert!(lower.is_subset(&higher), "licence {tier} → {}", tier + 1);
            assert!(
                lower.len() < higher.len(),
                "licence {} adds nothing",
                tier + 1
            );
        }
    }

    /// Given the highest licence,
    /// when its lists are read,
    /// then it opens every shape the engine plays, the six styles, the eleven dials and every role.
    #[test]
    fn the_highest_licence_opens_everything() {
        let elite = controls(ELITE);
        assert_eq!(elite.formations, engine::FORMATIONS.to_vec());
        assert_eq!(elite.play_styles, STYLES.to_vec());
        assert_eq!(elite.dials, Dial::ALL.to_vec());
        assert_eq!(elite.roles, ROLES.to_vec());
        assert_eq!(LicenceControls::all_open(), elite);
        let names: BTreeSet<String> = ROLES.iter().map(|role| format!("{role:?}")).collect();
        assert_eq!(names.len(), ROLES.len(), "a role listed twice");
        for role in &ROLES {
            assert_eq!(format!("{role:?}").parse::<PlayerRole>().as_ref(), Ok(role));
        }
    }

    /// Given the first licence,
    /// when its lists are read,
    /// then it plays three shapes and three styles, turns no dial and gives no role.
    #[test]
    fn the_first_licence_opens_only_the_basics() {
        let grassroots = controls(1);
        assert_eq!(grassroots.formations, vec!["4-4-2", "4-3-3", "3-5-2"]);
        assert_eq!(
            grassroots.play_styles,
            vec![
                PlayStyle::Balanced,
                PlayStyle::Attacking,
                PlayStyle::Defensive
            ]
        );
        assert!(grassroots.dials.is_empty());
        assert!(grassroots.roles.is_empty());
    }

    /// Given the default thresholds and a custom set,
    /// when coaches of several levels are given a licence,
    /// then each licence starts exactly at its threshold.
    #[test]
    fn a_licence_starts_at_its_level() {
        let levels = LicenceLevels::default();
        let tiers: Vec<u8> = [1, 2, 3, 4, 6, 7, 40]
            .iter()
            .map(|level| levels.tier(*level))
            .collect();
        assert_eq!(tiers, vec![1, 2, 2, 3, 3, 4, 4]);
        let custom = LicenceLevels {
            national: 3,
            continental: 6,
            elite: 10,
        };
        assert_eq!(custom.tier(2), 1);
        assert_eq!(custom.tier(3), 2);
        assert_eq!(custom.tier(9), 3);
        assert_eq!(custom.tier(10), 4);
        assert_eq!(levels.starts_at(1), Some(1));
        assert_eq!(levels.starts_at(3), Some(4));
        assert_eq!(levels.starts_at(5), None);
    }

    /// Given a first-licence coach,
    /// when he would give a closed shape, style, dial or role in a match, or a substitution,
    /// then the closed orders are refused and the substitution is not.
    #[test]
    fn a_licence_allows_only_its_open_orders() {
        let grassroots = controls(1);
        let closed = [
            MatchCommand::ChangeFormation {
                side: Side::Home,
                formation: "4-2-3-1".into(),
            },
            MatchCommand::ChangePlayStyle {
                side: Side::Home,
                play_style: engine::PlayStyle::HighPress,
            },
            MatchCommand::ChangeTacticalDial {
                side: Side::Home,
                dial: TacticalDial::DefensiveLine(engine::DefensiveLine::High),
            },
            MatchCommand::ChangePlayerRole {
                side: Side::Home,
                player_id: "p".into(),
                role: engine::PlayerRole::Poacher,
            },
        ];
        for command in &closed {
            assert!(!grassroots.allows_command(command), "{command:?}");
            assert!(
                LicenceControls::all_open().allows_command(command),
                "{command:?}"
            );
        }
        let open = [
            MatchCommand::ChangeFormation {
                side: Side::Home,
                formation: "4-3-3".into(),
            },
            MatchCommand::ChangePlayerRole {
                side: Side::Home,
                player_id: "p".into(),
                role: engine::PlayerRole::Standard,
            },
            MatchCommand::Substitute {
                side: Side::Home,
                player_off_id: "a".into(),
                player_on_id: "b".into(),
            },
        ];
        for command in &open {
            assert!(grassroots.allows_command(command), "{command:?}");
        }
    }

    /// Given a setup with a closed shape, style, two closed roles and a closed dial off its
    /// default, and the same setup under the highest licence,
    /// when it is checked,
    /// then each closed choice is an issue, roles by id in order, and the highest licence finds
    /// none.
    #[test]
    fn each_closed_choice_in_a_setup_is_an_issue() {
        let mut chosen = setup("4-2-3-1", PlayStyle::Possession);
        chosen.player_roles.insert("p9".into(), PlayerRole::Poacher);
        chosen.player_roles.insert("p2".into(), PlayerRole::Stopper);
        chosen
            .player_roles
            .insert("p5".into(), PlayerRole::Standard);
        chosen.tactics_phase.marking_style = MarkingStyle::ManToMan;
        assert_eq!(
            setup_issues(&chosen, &controls(1)),
            vec![
                SetupIssue::LockedFormation,
                SetupIssue::LockedPlayStyle,
                SetupIssue::LockedRole("p2".into()),
                SetupIssue::LockedRole("p9".into()),
                SetupIssue::LockedTactics,
            ]
        );
        assert_eq!(setup_issues(&chosen, &LicenceControls::all_open()), vec![]);
    }

    /// Given a second-licence coach who left a closed dial at its default and turned an open one,
    /// when his setup is checked,
    /// then nothing is wrong: only a closed dial moved off its default is an issue.
    #[test]
    fn a_closed_dial_at_its_default_is_no_issue() {
        let mut chosen = setup("4-2-3-1", PlayStyle::Counter);
        chosen.tactics_phase.defensive_line = DefensiveLine::High;
        chosen.tactics_phase.build_up_style = BuildUpStyle::Long;
        assert_eq!(setup_issues(&chosen, &controls(2)), vec![]);
        chosen.tactics_phase.break_speed = BreakSpeed::Fast;
        assert_eq!(
            setup_issues(&chosen, &controls(2)),
            vec![SetupIssue::LockedTactics]
        );
    }

    fn overreaching_team() -> Team {
        let mut club = team();
        club.formation = "4-2-3-1".into();
        club.play_style = PlayStyle::HighPress;
        club.player_roles.insert("p9".into(), PlayerRole::False9);
        club.player_roles.insert("p2".into(), PlayerRole::Stopper);
        club.tactics_phase.width = PitchWidth::Wide;
        club.tactics_phase.offside_trap = OffsideTrap::On;
        club
    }

    /// Given a club set up beyond the first licence,
    /// when it is fitted to it,
    /// then the shape, style, every dial and every role move to what the licence opens, the move
    /// is reported, and the result is a setup with no issue.
    #[test]
    fn fitting_a_club_moves_every_closed_choice_to_an_open_one() {
        let mut club = overreaching_team();
        let fitted = fit_team(&mut club, &controls(1), None);
        assert_eq!(
            fitted,
            Fitted {
                formation: Some(Change {
                    from: "4-2-3-1".into(),
                    to: "4-3-3".into()
                }),
                play_style: Some(Change {
                    from: PlayStyle::HighPress,
                    to: PlayStyle::Attacking
                }),
                dials: 2,
                roles: 2,
            }
        );
        assert_eq!(club.tactics_phase, TacticsPhaseSettings::default());
        assert!(club.player_roles.is_empty());
        let as_setup = ClubSetup {
            formation: club.formation.clone(),
            play_style: club.play_style.clone(),
            starting_xi_ids: Vec::new(),
            player_roles: club.player_roles.clone(),
            tactics_phase: club.tactics_phase.clone(),
            match_roles: MatchRoles::default(),
        };
        assert_eq!(setup_issues(&as_setup, &controls(1)), vec![]);
    }

    /// Given a club fitted to a licence once,
    /// when it is fitted again, and a club already within its licence is fitted,
    /// then nothing moves either time.
    #[test]
    fn fitting_twice_moves_nothing_more() {
        for tier in 1..=ELITE {
            let mut club = overreaching_team();
            fit_team(&mut club, &controls(tier), None);
            let once = club.clone();
            assert!(
                fit_team(&mut club, &controls(tier), None).is_empty(),
                "{tier}"
            );
            assert_eq!(club.formation, once.formation);
            assert_eq!(club.player_roles, once.player_roles);
        }
        let mut club = overreaching_team();
        assert!(fit_team(&mut club, &LicenceControls::all_open(), None).is_empty());
    }

    /// Given every shape the first licence closes,
    /// when a club in it is fitted,
    /// then it moves to one of the three open shapes.
    #[test]
    fn every_closed_shape_has_an_open_one_to_move_to() {
        let grassroots = controls(1);
        for formation in engine::FORMATIONS {
            let mut club = team();
            club.formation = formation.to_string();
            fit_team(&mut club, &grassroots, None);
            assert!(
                grassroots.formations.contains(&club.formation),
                "{formation} → {}",
                club.formation
            );
        }
    }

    /// Given a bot whose coach knows Defensive best among the open styles, set up to counter,
    /// when it is fitted to the first licence,
    /// then it plays Defensive, the open style its coach knows best.
    #[test]
    fn a_bot_plays_the_open_style_its_coach_knows_best() {
        let mut club = team();
        club.play_style = PlayStyle::Counter;
        let mastery = PlayStyleMastery {
            balanced: 40,
            attacking: 55,
            defensive: 70,
            possession: 20,
            counter: 90,
            high_press: 10,
        };
        let fitted = fit_team(&mut club, &controls(1), Some(&mastery));
        assert_eq!(club.play_style, PlayStyle::Defensive);
        assert_eq!(
            fitted.play_style.map(|change| change.from),
            Some(PlayStyle::Counter)
        );
    }
}
