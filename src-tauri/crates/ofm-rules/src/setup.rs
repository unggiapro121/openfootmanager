//! A manager's choice of shape, eleven, roles and tactics for his club, checked before it is
//! kept (phase 3, E3-7). The game takes these from its own screens one setting at a time; the
//! online server takes them from a client it does not trust, so every name in them must be one
//! the club has and every id a player of its squad.

use std::collections::{BTreeSet, HashMap};

use domain::player::Player;
use domain::team::{MatchRoles, PlayStyle, PlayerRole, TacticsPhaseSettings, Team};
use serde::{Deserialize, Serialize};

use crate::licence::LicenceControls;

/// The players starting a match.
pub const STARTING_ELEVEN: usize = 11;

/// Everything about how a club lines up that its manager decides.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub struct ClubSetup {
    pub formation: String,
    pub play_style: PlayStyle,
    pub starting_xi_ids: Vec<String>,
    #[serde(default)]
    pub player_roles: HashMap<String, PlayerRole>,
    pub tactics_phase: TacticsPhaseSettings,
    #[serde(default)]
    pub match_roles: MatchRoles,
}

/// Why a setup cannot be kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "issue", content = "playerId")]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export_to = "rules/"))]
pub enum SetupIssue {
    /// Not one of the shapes the engine plays (`engine::FORMATIONS`).
    UnknownFormation,
    /// Not exactly eleven starters.
    StartingElevenSize,
    /// A starter named twice.
    DuplicateStarter(String),
    /// An id in the eleven, the roles or the match roles that is not a player of the squad.
    NotInSquad(String),
    /// A shape the coach's licence does not open (phase 3, S-9).
    LockedFormation,
    /// A play style the coach's licence does not open.
    LockedPlayStyle,
    /// A role, given to this player, that the coach's licence does not open.
    LockedRole(String),
    /// At least one dial the licence does not open is set away from its default. Which ones the
    /// client reads from the licence: the content of this enum is a player id.
    LockedTactics,
}

/// `team` with `setup` applied, when every name and id in it is the club's and `controls` (the
/// coach's licence; everything open offline) opens every choice in it. A role a player can no
/// longer play where he now stands is dropped, as the game drops it (`squad::reconcile_roles`);
/// returns how many were. Nothing is changed when there is an issue.
pub fn apply_setup(
    team: &mut Team,
    squad: &[&Player],
    setup: ClubSetup,
    controls: &LicenceControls,
) -> Result<usize, Vec<SetupIssue>> {
    let mut issues = setup_issues(squad, &setup);
    issues.extend(crate::licence::setup_issues(&setup, controls));
    if !issues.is_empty() {
        return Err(issues);
    }
    team.formation = setup.formation;
    team.play_style = setup.play_style;
    team.starting_xi_ids = setup.starting_xi_ids;
    team.player_roles = setup.player_roles;
    team.tactics_phase = setup.tactics_phase;
    team.match_roles = setup.match_roles;
    let natural_positions: HashMap<String, domain::player::Position> = squad
        .iter()
        .map(|player| (player.id.clone(), player.natural_position.clone()))
        .collect();
    Ok(crate::squad::reconcile_roles(team, &natural_positions))
}

/// Every issue with `setup` for a club whose squad is `squad`, in a stable order.
pub fn setup_issues(squad: &[&Player], setup: &ClubSetup) -> Vec<SetupIssue> {
    let in_squad: BTreeSet<&str> = squad.iter().map(|player| player.id.as_str()).collect();
    let mut issues = Vec::new();
    if !engine::FORMATIONS.contains(&setup.formation.as_str()) {
        issues.push(SetupIssue::UnknownFormation);
    }
    if setup.starting_xi_ids.len() != STARTING_ELEVEN {
        issues.push(SetupIssue::StartingElevenSize);
    }
    let mut seen = BTreeSet::new();
    for id in &setup.starting_xi_ids {
        if !seen.insert(id.as_str()) {
            issues.push(SetupIssue::DuplicateStarter(id.clone()));
        }
    }
    let roles: BTreeSet<&str> = setup.player_roles.keys().map(String::as_str).collect();
    let match_roles = &setup.match_roles;
    let named = setup
        .starting_xi_ids
        .iter()
        .map(String::as_str)
        .chain(roles)
        .chain(
            [
                &match_roles.captain,
                &match_roles.vice_captain,
                &match_roles.penalty_taker,
                &match_roles.free_kick_taker,
                &match_roles.corner_taker,
            ]
            .into_iter()
            .flatten()
            .map(String::as_str),
        );
    let mut strangers = BTreeSet::new();
    for id in named {
        if !in_squad.contains(id) && strangers.insert(id) {
            issues.push(SetupIssue::NotInSquad(id.to_string()));
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use domain::player::Position;

    use super::*;
    use crate::test_support::uniform_attributes;

    fn squad() -> Vec<Player> {
        let positions = [
            Position::Goalkeeper,
            Position::Defender,
            Position::Defender,
            Position::Defender,
            Position::Defender,
            Position::Midfielder,
            Position::Midfielder,
            Position::Midfielder,
            Position::Midfielder,
            Position::Forward,
            Position::Forward,
            Position::Forward,
        ];
        positions
            .into_iter()
            .enumerate()
            .map(|(i, position)| {
                Player::new(
                    format!("p{i}"),
                    format!("P{i}"),
                    format!("P{i}"),
                    "2000-01-01".into(),
                    "England".into(),
                    position,
                    uniform_attributes(60),
                )
            })
            .collect()
    }

    fn setup(ids: &[&str]) -> ClubSetup {
        ClubSetup {
            formation: "4-4-2".into(),
            play_style: PlayStyle::Counter,
            starting_xi_ids: ids.iter().map(|id| id.to_string()).collect(),
            player_roles: HashMap::new(),
            tactics_phase: TacticsPhaseSettings::default(),
            match_roles: MatchRoles::default(),
        }
    }

    fn eleven() -> Vec<String> {
        (0..11).map(|i| format!("p{i}")).collect()
    }

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

    /// Given a squad of twelve and a 4-4-2 of eleven of them with a captain from the squad,
    /// when the setup is applied,
    /// then the club takes every setting.
    #[test]
    fn a_setup_of_the_club_s_own_players_is_kept() {
        let players = squad();
        let squad: Vec<&Player> = players.iter().collect();
        let ids = eleven();
        let mut chosen = setup(&ids.iter().map(String::as_str).collect::<Vec<_>>());
        chosen.match_roles.captain = Some("p11".into());
        let mut club = team();
        assert_eq!(
            apply_setup(&mut club, &squad, chosen, &LicenceControls::all_open()),
            Ok(0)
        );
        assert_eq!(club.formation, "4-4-2");
        assert_eq!(club.play_style, PlayStyle::Counter);
        assert_eq!(club.starting_xi_ids, ids);
        assert_eq!(club.match_roles.captain.as_deref(), Some("p11"));
    }

    /// Given setups with an unknown shape, ten starters, a starter twice, and a stranger in the
    /// eleven and as penalty taker,
    /// when they are checked,
    /// then each issue is named once and the club is left as it was.
    #[test]
    fn a_setup_naming_what_the_club_does_not_have_is_refused_whole() {
        let players = squad();
        let squad: Vec<&Player> = players.iter().collect();
        let mut wrong = setup(&["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p8"]);
        wrong.formation = "2-2-6".into();
        wrong.starting_xi_ids.push("stranger".into());
        wrong.match_roles.penalty_taker = Some("stranger".into());
        let mut club = team();
        let before = club.formation.clone();
        let issues =
            apply_setup(&mut club, &squad, wrong, &LicenceControls::all_open()).unwrap_err();
        assert_eq!(
            issues,
            vec![
                SetupIssue::UnknownFormation,
                SetupIssue::DuplicateStarter("p8".into()),
                SetupIssue::NotInSquad("stranger".into()),
            ]
        );
        assert_eq!(club.formation, before);
        let short = setup(&["p0", "p1"]);
        assert_eq!(
            setup_issues(&squad, &short),
            vec![SetupIssue::StartingElevenSize]
        );
    }

    /// Given a first-licence coach's otherwise sound 4-4-2 that sets the offside trap,
    /// when it is applied,
    /// then it is refused for the closed dial and the club is left as it was; the same setup is
    /// kept with every control open.
    #[test]
    fn a_setup_the_licence_closes_is_not_kept() {
        let players = squad();
        let squad: Vec<&Player> = players.iter().collect();
        let ids = eleven();
        let mut chosen = setup(&ids.iter().map(String::as_str).collect::<Vec<_>>());
        chosen.play_style = PlayStyle::Balanced;
        chosen.tactics_phase.offside_trap = domain::team::OffsideTrap::On;
        let mut club = team();
        let before = club.tactics_phase.clone();
        assert_eq!(
            apply_setup(
                &mut club,
                &squad,
                chosen.clone(),
                &crate::licence::controls(1)
            ),
            Err(vec![SetupIssue::LockedTactics])
        );
        assert_eq!(club.tactics_phase, before);
        assert_eq!(
            apply_setup(&mut club, &squad, chosen, &LicenceControls::all_open()),
            Ok(0)
        );
    }

    /// Given a goalkeeper's role handed to a forward standing up front,
    /// when the setup is applied,
    /// then it is kept but the role is dropped, as the game drops it.
    #[test]
    fn a_role_the_player_cannot_play_there_is_dropped() {
        let players = squad();
        let squad: Vec<&Player> = players.iter().collect();
        let ids = eleven();
        let mut chosen = setup(&ids.iter().map(String::as_str).collect::<Vec<_>>());
        chosen
            .player_roles
            .insert("p10".into(), PlayerRole::SweeperKeeper);
        let mut club = team();
        assert_eq!(
            apply_setup(&mut club, &squad, chosen, &LicenceControls::all_open()),
            Ok(1)
        );
        assert!(club.player_roles.is_empty());
    }
}
