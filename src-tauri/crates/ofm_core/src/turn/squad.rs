//! The squad bridge's reading of the save (phase 3, E3-5a). The rules of who a club puts out and
//! how the engine sees them are `ofm_rules::squad`, shared with the online server; this module
//! gathers what they need from `Game` — the club's players, its head coach, the day — and the
//! calendar question of whether the club plays again soon.

use crate::game::Game;
use domain::manager::Manager;
use domain::player::Player;
use domain::team::Team;
use engine::{PlayerData, TeamData};
#[cfg(test)]
pub(crate) use ofm_rules::squad::PITCH_POSITIONS;
pub(crate) use ofm_rules::squad::{FixtureLoad, first_choice_eleven, position_ratings};
use ofm_rules::squad::{
    SideSelection, build_side, coach_mastery_of, management_quality,
    management_quality_from_rating, pick_set_piece_takers, selection_seed,
};
#[cfg(test)]
use ofm_rules::squad::{ai_select_starting_xi, select_starting_xi, to_engine_player};

/// The side `team_id` puts out today: its XI as the engine plays it and its bench.
pub(crate) fn build_team_with_bench(game: &Game, team_id: &str) -> (TeamData, Vec<PlayerData>) {
    let team = game.teams.iter().find(|t| t.id == team_id);
    let squad: Vec<&Player> = game
        .players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(team_id))
        .collect();
    let available: Vec<&Player> = squad
        .iter()
        .copied()
        .filter(|p| p.injury.is_none())
        .collect();
    let injured: Vec<&Player> = squad
        .iter()
        .copied()
        .filter(|p| p.injury.is_some())
        .collect();
    let is_user_team = game.manager.team_id.as_deref() == Some(team_id);
    // Only the AI policy reads these; the manager picks his own XI, and scanning the calendar
    // for him would be wasted on every match in the world.
    let (quality, seed, load) = if is_user_team {
        (0.0, 0, FixtureLoad::Normal)
    } else {
        // The same club must name the same side however often this is called for
        // one fixture, so the manager's misjudgements are seeded from the club and
        // the date rather than rolled fresh. A new matchday is a new judgement.
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        (
            team_management_quality(game, team),
            selection_seed(team_id, &today),
            fixture_load(game, team_id),
        )
    };
    build_side(&SideSelection {
        team_id,
        team,
        available: &available,
        injured: &injured,
        is_user_team,
        head_coach: coach_mastery_of(head_coach_of(game, team)),
        management_quality: quality,
        selection_seed: seed,
        load,
    })
}

/// The club's head coach.
///
/// The user's club reads the user (`game.manager`), never the copy of them in
/// `game.managers`, which is only re-synced at career events and can be stale.
fn head_coach_of<'a>(game: &'a Game, team: Option<&Team>) -> Option<&'a Manager> {
    let team = team?;
    if game.manager.team_id.as_deref() == Some(team.id.as_str()) {
        Some(&game.manager)
    } else {
        team.manager_id
            .as_deref()
            .and_then(|id| game.managers.iter().find(|manager| manager.id == id))
    }
}

/// Resolves the AI management quality for a team: the linked manager's rating when
/// one is hired (manager-specific skill), otherwise the club's reputation as a
/// proxy. Defaults to a mid value when the team can't be found.
fn team_management_quality(game: &Game, team: Option<&Team>) -> f64 {
    let Some(team) = team else {
        return management_quality(500);
    };

    if let Some(manager_id) = &team.manager_id
        && let Some(manager) = game.managers.iter().find(|m| &m.id == manager_id)
    {
        return management_quality_from_rating(manager.rating());
    }

    management_quality(team.reputation)
}

/// A club that plays again within this many days of a match is on a congested
/// run. Midweek to weekend is three or four days; weekend to weekend is seven.
///
/// Deliberately not training's congestion rule ("two fixtures in the coming
/// week"). That is counted the morning *after* a match, when the day's fixture
/// has already been played; asked at kick-off it would count today's match as
/// well, and every ordinary weekend-to-weekend season would read as congested.
const CONGESTED_WITHIN_DAYS: i64 = 4;

/// See [`FixtureLoad`]. Compares ISO dates as strings — they sort and match
/// correctly that way — so nothing is parsed per fixture: this runs twice for
/// every match in the world, and a populated world holds tens of thousands of
/// fixtures.
pub(crate) fn fixture_load(game: &Game, team_id: &str) -> FixtureLoad {
    use domain::league::FixtureStatus;

    let today = game.clock.current_date;
    let soon: Vec<String> = (1..=CONGESTED_WITHIN_DAYS)
        .map(|days| {
            (today + chrono::Duration::days(days))
                .format("%Y-%m-%d")
                .to_string()
        })
        .collect();
    // Both collections, not the usual "competitions, else the legacy slot". A
    // side is picked *during* simulation, and `simulate_competition_day_with_capture`
    // moves the competition being played out of `game.competitions` into
    // `game.league` for the length of it, leaving an empty default behind. Reading
    // `competitions` alone would miss that competition's own next round — a
    // league's midweek fixture — which is the commonest congested run there is.
    // Outside simulation the legacy slot mirrors one of the competitions, and a
    // fixture seen twice cannot change an `any`.
    //
    // Only competitions in the active scope count: a dormant one is resolved by a
    // scoreline-only model that charges nobody any condition, so its next round
    // is no reason to rest a player for this one.
    let plays_again_soon = game
        .competitions
        .iter()
        .chain(game.league.iter())
        .filter(|competition| game.competition_in_active_scope(competition))
        .flat_map(|competition| competition.fixtures.iter())
        .filter(|fixture| fixture.status == FixtureStatus::Scheduled)
        .filter(|fixture| soon.contains(&fixture.date))
        .any(|fixture| fixture.home_team_id == team_id || fixture.away_team_id == team_id);

    if plays_again_soon {
        FixtureLoad::Congested
    } else {
        FixtureLoad::Normal
    }
}

/// Auto-select set-piece takers from a set of player IDs.
/// Returns (captain_id, penalty_taker_id, free_kick_taker_id, corner_taker_id).
pub fn auto_select_set_pieces(
    game: &Game,
    player_ids: &[String],
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    let players: Vec<&Player> = player_ids
        .iter()
        .filter_map(|id| game.players.iter().find(|p| &p.id == id))
        .collect();
    pick_set_piece_takers(&players)
}

#[cfg(test)]
mod tests;
