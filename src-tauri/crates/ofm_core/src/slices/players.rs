use crate::game::Game;
use crate::slices::teams::league_member_ids;
use domain::player::{Player, Position};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlayerSortKey {
    Name,
    Position,
    Age,
    Ovr,
    Value,
    Team,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PlayerStatusFilter {
    All,
    Transfer,
    Loan,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlayersPageQuery {
    pub search: Option<String>,
    pub position: Option<Position>,
    pub team_id: Option<String>,
    /// Restrict to players whose club is in this competition.
    #[serde(default)]
    pub league_id: Option<String>,
    /// Restrict to players of these clubs: a competition scope the caller
    /// resolved to its clubs. Empty matches nobody; absent restricts nothing.
    #[serde(default)]
    pub team_ids: Option<Vec<String>>,
    /// Restrict to players whose natural position is one of these exact
    /// positions (a left back is not a centre back). Empty restricts nothing.
    #[serde(default)]
    pub positions: Vec<Position>,
    /// Inclusive age range on the game date; each bound is optional.
    #[serde(default)]
    pub age_min: Option<u8>,
    #[serde(default)]
    pub age_max: Option<u8>,
    /// Inclusive OVR range; each bound is optional.
    #[serde(default)]
    pub ovr_min: Option<u8>,
    #[serde(default)]
    pub ovr_max: Option<u8>,
    pub status: PlayerStatusFilter,
    pub sort_key: PlayerSortKey,
    pub sort_asc: bool,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PlayerSummary {
    pub id: String,
    pub full_name: String,
    pub match_name: String,
    pub date_of_birth: String,
    pub nationality: String,
    pub position: Position,
    pub natural_position: Position,
    pub team_id: Option<String>,
    pub team_name: Option<String>,
    pub market_value: u64,
    pub ovr: u8,
    pub transfer_listed: bool,
    pub loan_listed: bool,
    pub injured: bool,
    pub retired: bool,
    pub media: PlayerSummaryMedia,
}

/// Artwork paths for a row in the players table.
///
/// Kept separate from `domain::player::PlayerMedia` so the wire shape belongs to
/// this projection: the domain type skips `face` when it is empty, which would
/// leave the key absent rather than null. Mirrors `TeamCardMedia` in the teams
/// slice.
#[derive(Debug, Default, Serialize, PartialEq, Eq)]
pub struct PlayerSummaryMedia {
    pub face: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PlayersPage {
    pub items: Vec<PlayerSummary>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

type TeamLookup<'a> = HashMap<&'a str, &'a str>;

pub fn query_page(game: &Game, query: &PlayersPageQuery) -> PlayersPage {
    let teams: TeamLookup = game
        .teams
        .iter()
        .map(|team| (team.id.as_str(), team.name.as_str()))
        .collect();

    let needle = query
        .search
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_ascii_lowercase);

    let league_members = query
        .league_id
        .as_deref()
        .map(|league_id| league_clubs(game, league_id));
    let scope_members: Option<HashSet<&str>> = query
        .team_ids
        .as_ref()
        .map(|ids| ids.iter().map(String::as_str).collect());
    let today = game.clock.current_date.date_naive();

    let mut matches: Vec<&Player> = game
        .players
        .iter()
        .filter(|player| matches_filters(player, query, needle.as_deref()))
        .filter(|player| matches_ranges(player, query, today))
        .filter(|player| plays_for_one_of(player, league_members.as_ref()))
        .filter(|player| plays_for_one_of(player, scope_members.as_ref()))
        .collect();

    sort_matches(&mut matches, query, &teams);

    let total = matches.len();
    let page = query.page.max(1);
    let start = (page - 1).saturating_mul(query.page_size);
    let end = start.saturating_add(query.page_size).min(total);
    let items = matches
        .get(start..end)
        .unwrap_or(&[])
        .iter()
        .map(|player| project_summary(player, &teams))
        .collect();

    PlayersPage {
        items,
        total,
        page,
        page_size: query.page_size,
    }
}

/// Clubs in a competition. An unknown id yields none, so the filter matches nobody.
fn league_clubs<'a>(game: &'a Game, league_id: &str) -> HashSet<&'a str> {
    game.competitions
        .iter()
        .find(|c| c.id == league_id)
        .map(|league| league_member_ids(league).into_iter().collect())
        .unwrap_or_default()
}

/// Whether the player is at one of `clubs`; no set restricts nothing, and a
/// free agent is at none.
fn plays_for_one_of(player: &Player, clubs: Option<&HashSet<&str>>) -> bool {
    clubs.is_none_or(|clubs| {
        player
            .team_id
            .as_deref()
            .is_some_and(|id| clubs.contains(id))
    })
}

/// The query's exact positions and its age and OVR ranges, each bound inclusive
/// and optional. Age is taken on `today`, the game date.
fn matches_ranges(player: &Player, query: &PlayersPageQuery, today: chrono::NaiveDate) -> bool {
    let within = |value: i32, min: Option<u8>, max: Option<u8>| {
        min.is_none_or(|min| value >= i32::from(min))
            && max.is_none_or(|max| value <= i32::from(max))
    };
    if !query.positions.is_empty() && !query.positions.contains(&player.natural_position) {
        return false;
    }
    if !within(i32::from(player.ovr), query.ovr_min, query.ovr_max) {
        return false;
    }
    if query.age_min.is_some() || query.age_max.is_some() {
        let age = crate::aging::player_age_on(today, &player.date_of_birth);
        return within(age, query.age_min, query.age_max);
    }
    true
}

fn matches_filters(player: &Player, query: &PlayersPageQuery, needle: Option<&str>) -> bool {
    if let Some(needle) = needle
        && !matches_search(player, needle)
    {
        return false;
    }

    if let Some(filter_pos) = &query.position
        && player.natural_position.to_group_position() != filter_pos.to_group_position()
    {
        return false;
    }

    if let Some(filter_team) = &query.team_id
        && player.team_id.as_deref() != Some(filter_team.as_str())
    {
        return false;
    }

    match query.status {
        PlayerStatusFilter::All => true,
        PlayerStatusFilter::Transfer => player.transfer_listed,
        PlayerStatusFilter::Loan => player.loan_listed,
    }
}

fn matches_search(player: &Player, needle: &str) -> bool {
    [&player.full_name, &player.match_name, &player.nationality]
        .iter()
        .any(|haystack| haystack.to_ascii_lowercase().contains(needle))
}

fn sort_matches(matches: &mut [&Player], query: &PlayersPageQuery, teams: &TeamLookup) {
    matches.sort_by(|a, b| {
        let primary = compare_by_key(a, b, query.sort_key, teams);
        if query.sort_asc {
            primary
        } else {
            primary.reverse()
        }
    });
}

fn compare_by_key(a: &Player, b: &Player, sort_key: PlayerSortKey, teams: &TeamLookup) -> Ordering {
    match sort_key {
        PlayerSortKey::Name => a.full_name.cmp(&b.full_name),
        PlayerSortKey::Position => {
            position_rank(&a.natural_position).cmp(&position_rank(&b.natural_position))
        }
        // Ascending age = youngest first, equivalent to ascending by NEGATED birth year.
        PlayerSortKey::Age => {
            parse_birth_year(&b.date_of_birth).cmp(&parse_birth_year(&a.date_of_birth))
        }
        PlayerSortKey::Ovr => a.ovr.cmp(&b.ovr),
        PlayerSortKey::Value => a.market_value.cmp(&b.market_value),
        PlayerSortKey::Team => team_name_for(a, teams).cmp(team_name_for(b, teams)),
    }
}

fn project_summary(player: &Player, teams: &TeamLookup) -> PlayerSummary {
    let team_name = player
        .team_id
        .as_deref()
        .and_then(|id| teams.get(id).copied())
        .map(str::to_string);
    PlayerSummary {
        id: player.id.clone(),
        full_name: player.full_name.clone(),
        match_name: player.match_name.clone(),
        date_of_birth: player.date_of_birth.clone(),
        nationality: player.nationality.clone(),
        position: player.position.clone(),
        natural_position: player.natural_position.clone(),
        team_id: player.team_id.clone(),
        team_name,
        market_value: player.market_value,
        ovr: player.ovr,
        transfer_listed: player.transfer_listed,
        loan_listed: player.loan_listed,
        injured: player.injury.is_some(),
        retired: player.retired,
        media: PlayerSummaryMedia {
            face: player.media.face.clone(),
        },
    }
}

fn team_name_for<'a>(player: &'a Player, teams: &'a TeamLookup) -> &'a str {
    player
        .team_id
        .as_deref()
        .and_then(|id| teams.get(id).copied())
        .unwrap_or("")
}

fn parse_birth_year(dob: &str) -> i32 {
    dob.split('-')
        .next()
        .and_then(|segment| segment.parse().ok())
        .unwrap_or(2000)
}

fn position_rank(pos: &Position) -> u8 {
    use Position::*;
    match pos {
        Goalkeeper => 1,
        Defender | RightBack | CenterBack | LeftBack | RightWingBack | LeftWingBack => 2,
        Midfielder | DefensiveMidfielder | CentralMidfielder | AttackingMidfielder
        | RightMidfielder | LeftMidfielder => 3,
        Forward | RightWinger | LeftWinger | Striker => 4,
    }
}
