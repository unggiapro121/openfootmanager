//! The watchlist: players the user follows week by week. Most are youngsters
//! from the season's pool, who are nobody's yet and live outside
//! `Game::players`; the rest are ordinary players of other clubs, watched from
//! a scout's report. A scout the user assigns narrows what the club knows of
//! each, one judgement band a week, and reports each Monday.

use crate::game::Game;
use domain::message::ProspectEstimate;
use domain::player::Player;
use serde::{Deserialize, Serialize};

/// What kind of player a watchlist entry follows.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum WatchKind {
    /// A youngster of the season's pool.
    #[default]
    Prospect,
    /// A player in `Game::players`, watched from his scout report: `prospect`
    /// is a copy refreshed each Monday.
    Player,
}

/// A player on the user's watchlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedProspect {
    #[serde(default)]
    pub kind: WatchKind,
    pub prospect: Player,
    /// What the club knows of him: the ranges and how wide they are.
    pub estimate: ProspectEstimate,
    /// The scout following him; none until the user assigns one.
    #[serde(default)]
    pub scout_id: Option<String>,
    pub added_on: String,
    /// Weekly reports a scout has sent on him.
    #[serde(default)]
    pub weeks_followed: u32,
    /// His player card as the club reads him now, redrawn whenever the read
    /// changes; what the watchlist shows when he is opened.
    #[serde(default)]
    pub report: Option<domain::message::ScoutReportData>,
    /// The club that signed him from the pool before the user did, by name
    /// and id: he stays on the list, no longer followed and no longer
    /// signable, until the user lets him go.
    #[serde(default)]
    pub signed_by: Option<String>,
    #[serde(default)]
    pub signed_by_team_id: Option<String>,
}

impl WatchedProspect {
    /// Redraw the card from the current read.
    fn restate(&mut self) {
        self.report = Some(crate::scouting::prospect_report(
            &self.prospect,
            &self.estimate,
        ));
    }
}

/// Most prospects one scout can follow at once.
pub const MAX_WATCHED_PER_SCOUT: usize = 3;

/// The bands a followed prospect's ranges step down through, a step a week.
const BAND_STEPS: [u8; 5] = [12, 8, 5, 2, 0];

/// How many more attributes a scout of `judging_ability` reads each week.
fn reveals_per_week(judging_ability: u8) -> usize {
    match judging_ability {
        80.. => 4,
        60..=79 => 3,
        _ => 2,
    }
}

/// The order a following scout reads `prospect`'s attributes in: the heaviest
/// in his position's overall first, then the rest, ties in an order fixed for
/// him. Only a keeper has handling and reflexes to read.
pub(crate) fn reveal_order(prospect: &Player) -> Vec<&'static str> {
    use crate::player_rating::{ATTRIBUTE_KEYS, attribute_weights};
    let position = crate::player_rating::primary_position(prospect);
    let keeper = position == domain::player::Position::Goalkeeper;
    let weights = attribute_weights(&position);
    let weight = |key: &str| {
        weights
            .iter()
            .find(|(weighted, _)| *weighted == key)
            .map_or(0, |(_, weight)| *weight)
    };
    let seed = crate::stable_hash::stable_hash(prospect.id.as_bytes(), 0);
    let mut keys: Vec<&'static str> = ATTRIBUTE_KEYS
        .iter()
        .copied()
        .filter(|key| keeper || !matches!(*key, "handling" | "reflexes"))
        .collect();
    keys.sort_by_key(|key| {
        (
            std::cmp::Reverse(weight(key)),
            crate::stable_hash::stable_hash(key.as_bytes(), seed),
        )
    });
    keys
}

const ERR_NOT_WATCHED: &str = "be.error.scouting.prospectNotWatched";
const ERR_ALREADY_WATCHED: &str = "be.error.scouting.prospectAlreadyWatched";
const ERR_SCOUT_WATCHLIST_FULL: &str = "be.error.scouting.scoutWatchlistFull";
const ERR_NOT_PROSPECT: &str = "be.error.scouting.watchedPlayerNotProspect";
const ERR_PLAYER_NOT_FOUND: &str = "be.error.playerNotFound";
const ERR_OWN_PLAYER: &str = "be.error.scouting.cannotScoutOwnPlayer";

/// Put a prospect from a report on the watchlist, as the report read him, with
/// no scout yet. He must still be in the season's pool; he stays on the list
/// until he signs somewhere, the user lets him go, or the season ends.
pub(crate) fn watch(
    game: &mut Game,
    prospect: Player,
    estimate: ProspectEstimate,
) -> Result<(), String> {
    if game
        .youth_watchlist
        .iter()
        .any(|entry| entry.prospect.id == prospect.id)
    {
        return Err(ERR_ALREADY_WATCHED.to_string());
    }
    crate::youth_pool::locate(game, &prospect.id)?;
    let today = game.clock.current_date.date_naive();
    let mut entry = WatchedProspect {
        kind: WatchKind::Prospect,
        prospect,
        estimate,
        scout_id: None,
        added_on: today.format("%Y-%m-%d").to_string(),
        weeks_followed: 0,
        report: None,
        signed_by: None,
        signed_by_team_id: None,
    };
    entry.restate();
    game.youth_watchlist.push(entry);
    Ok(())
}

/// Put a player of another club (or a free agent) on the watchlist from his
/// scout report, as the report read him, with no scout yet. He stays until the
/// user lets him go, he joins the user's club, or he retires.
pub(crate) fn watch_player(
    game: &mut Game,
    player_id: &str,
    estimate: ProspectEstimate,
) -> Result<(), String> {
    if game
        .youth_watchlist
        .iter()
        .any(|entry| entry.prospect.id == player_id)
    {
        return Err(ERR_ALREADY_WATCHED.to_string());
    }
    let player = followable_player(game, player_id)?.clone();
    let today = game.clock.current_date.date_naive();
    let mut entry = WatchedProspect {
        kind: WatchKind::Player,
        prospect: player,
        estimate,
        scout_id: None,
        added_on: today.format("%Y-%m-%d").to_string(),
        weeks_followed: 0,
        report: None,
        signed_by: None,
        signed_by_team_id: None,
    };
    entry.restate();
    game.youth_watchlist.push(entry);
    Ok(())
}

/// The player `player_id` if the user's club can still follow him: he exists,
/// has not retired and does not play for the user's club.
fn followable_player<'a>(game: &'a Game, player_id: &str) -> Result<&'a Player, String> {
    let player = game
        .players
        .iter()
        .find(|player| player.id == player_id && !player.retired)
        .ok_or(ERR_PLAYER_NOT_FOUND)?;
    if player.team_id.is_some() && player.team_id == game.manager.team_id {
        return Err(ERR_OWN_PLAYER.to_string());
    }
    Ok(player)
}

fn index_of(game: &Game, prospect_id: &str) -> Result<usize, String> {
    game.youth_watchlist
        .iter()
        .position(|entry| entry.prospect.id == prospect_id)
        .ok_or_else(|| ERR_NOT_WATCHED.to_string())
}

/// Put `scout_id` on the prospect, or take his scout off with `None`. A better
/// scout narrows him to his own band at once; a worse one never widens him.
pub fn assign_scout(
    game: &mut Game,
    prospect_id: &str,
    scout_id: Option<&str>,
) -> Result<(), String> {
    let index = index_of(game, prospect_id)?;
    let Some(scout_id) = scout_id else {
        game.youth_watchlist[index].scout_id = None;
        return Ok(());
    };
    // A youngster another club has signed can no longer be followed; a
    // watched player can while he is still someone else's.
    match game.youth_watchlist[index].kind {
        WatchKind::Prospect => {
            crate::youth_pool::locate(game, prospect_id)?;
        }
        WatchKind::Player => {
            followable_player(game, prospect_id)?;
        }
    }
    let scout = crate::scouting::resolve_user_scout(game, scout_id)?;
    let (ovr_band, potential_band) = (
        crate::scouting::judgement_band(scout.attributes.judging_ability),
        crate::scouting::judgement_band(scout.attributes.judging_potential),
    );
    let already_following = game
        .youth_watchlist
        .iter()
        .filter(|entry| entry.scout_id.as_deref() == Some(scout_id))
        .filter(|entry| entry.prospect.id != prospect_id)
        .count();
    if already_following >= MAX_WATCHED_PER_SCOUT {
        return Err(ERR_SCOUT_WATCHLIST_FULL.to_string());
    }

    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let mut rng = game.rng_for(&format!("youth-watchlist/assign/{prospect_id}"), &today);
    let entry = &mut game.youth_watchlist[index];
    entry.scout_id = Some(scout_id.to_string());
    let attribute_band = ovr_band;
    let ovr_band = ovr_band.min(entry.estimate.ovr_band);
    let potential_band = potential_band.min(entry.estimate.potential_band);
    narrow_reads(entry, |band| band.min(attribute_band), &mut rng);
    narrow(entry, ovr_band, potential_band, &mut rng);
    Ok(())
}

/// Read the prospect again within the new bands and keep only what both reads
/// agree on, so the ranges never widen and always hold the truth.
fn narrow(entry: &mut WatchedProspect, ovr_band: u8, potential_band: u8, rng: &mut impl rand::Rng) {
    let estimate = &mut entry.estimate;
    if ovr_band < estimate.ovr_band {
        let (low, high) = crate::scouting::read_rating(entry.prospect.ovr, ovr_band, rng);
        estimate.ovr_low = estimate.ovr_low.max(low);
        estimate.ovr_high = estimate.ovr_high.min(high);
        estimate.ovr_band = ovr_band;
    }
    if potential_band < estimate.potential_band {
        let (low, high) =
            crate::scouting::read_rating(entry.prospect.potential, potential_band, rng);
        estimate.potential_low = estimate.potential_low.max(low);
        estimate.potential_high = estimate.potential_high.min(high);
        estimate.potential_band = potential_band;
    }
    entry.restate();
}

/// Read each attribute already read again, within the band `to` gives for its
/// current one, keeping only what both reads agree on.
fn narrow_reads(entry: &mut WatchedProspect, to: impl Fn(u8) -> u8, rng: &mut impl rand::Rng) {
    for read in &mut entry.estimate.attributes {
        let band = to(read.band);
        if band < read.band {
            let truth =
                crate::player_rating::attribute_value(&entry.prospect.attributes, &read.key);
            let (low, high) = crate::scouting::read_rating(truth, band, rng);
            read.low = read.low.max(low);
            read.high = read.high.min(high);
            read.band = band;
        }
    }
}

/// Read `count` attributes not read yet, next in his reveal order, each within
/// his overall's current band.
fn reveal(entry: &mut WatchedProspect, count: usize, rng: &mut impl rand::Rng) {
    let band = entry.estimate.ovr_band;
    let next: Vec<&str> = reveal_order(&entry.prospect)
        .into_iter()
        .filter(|key| {
            !entry
                .estimate
                .attributes
                .iter()
                .any(|read| read.key == *key)
        })
        .take(count)
        .collect();
    for key in next {
        let truth = crate::player_rating::attribute_value(&entry.prospect.attributes, key);
        let (low, high) = crate::scouting::read_rating(truth, band, rng);
        entry
            .estimate
            .attributes
            .push(domain::message::AttributeRead {
                key: key.to_string(),
                low,
                high,
                band,
            });
    }
}

/// A watched player who has retired leaves the list, and the user is told; one
/// who has joined the user's club leaves it quietly. Checked every day.
fn drop_departed_players(game: &mut Game, date: &str) {
    let user_team = game.manager.team_id.clone();
    let mut retired = Vec::new();
    game.youth_watchlist.retain(|entry| {
        if entry.kind != WatchKind::Player {
            return true;
        }
        match game.players.iter().find(|p| p.id == entry.prospect.id) {
            Some(player) if player.retired => {
                retired.push(entry.clone());
                false
            }
            Some(player) => player.team_id.is_none() || player.team_id != user_team,
            None => false,
        }
    });
    for entry in retired {
        messages::retired(game, &entry, date);
    }
}

/// A player keeps developing while he is watched: a range that no longer
/// holds his true value is read again at its own band, so every range always
/// does. A pool youngster never changes, so this never fires for him.
fn follow_the_truth(entry: &mut WatchedProspect, rng: &mut impl rand::Rng) {
    let outside = |value: u8, low: u8, high: u8| !(low..=high).contains(&value);
    let estimate = &mut entry.estimate;
    let player = &entry.prospect;
    if outside(player.ovr, estimate.ovr_low, estimate.ovr_high) {
        (estimate.ovr_low, estimate.ovr_high) =
            crate::scouting::read_rating(player.ovr, estimate.ovr_band, rng);
    }
    if outside(
        player.potential,
        estimate.potential_low,
        estimate.potential_high,
    ) {
        (estimate.potential_low, estimate.potential_high) =
            crate::scouting::read_rating(player.potential, estimate.potential_band, rng);
    }
    for read in &mut estimate.attributes {
        let value = crate::player_rating::attribute_value(&player.attributes, &read.key);
        if outside(value, read.low, read.high) {
            (read.low, read.high) = crate::scouting::read_rating(value, read.band, rng);
        }
    }
}

/// Whether the club knows the prospect exactly: overall, potential and every
/// attribute read, all down to no error.
fn fully_known(entry: &WatchedProspect) -> bool {
    let estimate = &entry.estimate;
    estimate.ovr_band == 0
        && estimate.potential_band == 0
        && estimate.attributes.len() == reveal_order(&entry.prospect).len()
        && estimate.attributes.iter().all(|read| read.band == 0)
}

/// The band after `band` in the weekly narrowing.
fn next_band(band: u8) -> u8 {
    BAND_STEPS
        .iter()
        .copied()
        .find(|step| *step < band)
        .unwrap_or(0)
}

/// Sign a watched prospect into the user's academy and take him off the list.
pub fn sign(game: &mut Game, prospect_id: &str) -> Result<Player, String> {
    let index = index_of(game, prospect_id)?;
    if game.youth_watchlist[index].kind == WatchKind::Player {
        return Err(ERR_NOT_PROSPECT.to_string());
    }
    let signed = crate::scouting::sign_youth_prospect(game, prospect_id)?;
    forget(game, prospect_id);
    Ok(signed)
}

/// Let a watched prospect go.
pub fn unwatch(game: &mut Game, prospect_id: &str) -> Result<(), String> {
    index_of(game, prospect_id)?;
    forget(game, prospect_id);
    Ok(())
}

/// Take a prospect off the list, if he is on it.
pub(crate) fn forget(game: &mut Game, prospect_id: &str) {
    game.youth_watchlist
        .retain(|entry| entry.prospect.id != prospect_id);
}

/// An AI club signed `prospect_id` from the pool: if the user was watching
/// him, he stays on the list marked with his new club and his scout stops
/// following him, and the user is told where he went.
pub(crate) fn signed_by_club(game: &mut Game, prospect_id: &str, team_id: &str, club_name: &str) {
    let Some(entry) = game
        .youth_watchlist
        .iter_mut()
        .find(|entry| entry.prospect.id == prospect_id)
    else {
        return;
    };
    entry.signed_by = Some(club_name.to_string());
    entry.signed_by_team_id = Some(team_id.to_string());
    entry.scout_id = None;
    let (id, name) = (entry.prospect.id.clone(), entry.prospect.full_name.clone());
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    messages::signed_by_club(game, &id, &name, club_name, &today);
}

/// The season's pool is closing on `date`: every prospect still free leaves
/// the market with it, and the user is told of each. Those a club has signed
/// stay until the user lets them go.
pub(crate) fn pool_closed(game: &mut Game, date: chrono::NaiveDate) {
    let date = date.format("%Y-%m-%d").to_string();
    let (signed, free): (Vec<_>, Vec<_>) = std::mem::take(&mut game.youth_watchlist)
        .into_iter()
        .partition(|entry| entry.signed_by.is_some() || entry.kind == WatchKind::Player);
    game.youth_watchlist = signed;
    for entry in free {
        messages::left_market(game, &entry, &date);
    }
}

/// The week's watchlist business, on Mondays, after the AI clubs have signed
/// from the pool: each prospect with a scout narrows a band and gets a report.
pub fn process_youth_watchlist(game: &mut Game) {
    use chrono::Datelike;
    let today_text = game.clock.current_date.format("%Y-%m-%d").to_string();
    drop_departed_players(game, &today_text);
    if game.clock.current_date.weekday() != chrono::Weekday::Mon {
        return;
    }
    let entries = std::mem::take(&mut game.youth_watchlist);
    for mut entry in entries {
        if entry.kind == WatchKind::Player
            && let Some(live) = game.players.iter().find(|p| p.id == entry.prospect.id)
        {
            entry.prospect = live.clone();
        }
        if let Some(scout) = entry
            .scout_id
            .as_deref()
            .and_then(|id| game.staff.iter().find(|staff| staff.id == id))
            .cloned()
        {
            let mut rng = game.rng_for(
                &format!("youth-watchlist/{}", entry.prospect.id),
                &today_text,
            );
            follow_the_truth(&mut entry, &mut rng);
            let ovr_band = next_band(entry.estimate.ovr_band);
            let potential_band = next_band(entry.estimate.potential_band);
            narrow(&mut entry, ovr_band, potential_band, &mut rng);
            narrow_reads(&mut entry, next_band, &mut rng);
            reveal(
                &mut entry,
                reveals_per_week(scout.attributes.judging_ability),
                &mut rng,
            );
            entry.weeks_followed += 1;
            entry.restate();
            // Once there is nothing left to learn, the scout files a last report
            // and stops, freeing his slot; the prospect stays on the list.
            let complete = fully_known(&entry);
            messages::weekly_report(game, &entry, &scout, &today_text, complete);
            if complete {
                entry.scout_id = None;
            }
        }
        game.youth_watchlist.push(entry);
    }
}

/// A scout the user's club no longer employs stops following his prospects;
/// they stay on the list for the user to hand to someone else.
pub(crate) fn scout_left(game: &mut Game, scout_id: &str) {
    let mut handed_back = 0;
    for entry in &mut game.youth_watchlist {
        if entry.scout_id.as_deref() == Some(scout_id) {
            entry.scout_id = None;
            handed_back += 1;
        }
    }
    if handed_back > 0 {
        let scout_name = game
            .staff
            .iter()
            .find(|staff| staff.id == scout_id)
            .map(|staff| format!("{} {}", staff.first_name, staff.last_name))
            .unwrap_or_default();
        let today = game.clock.current_date.format("%Y-%m-%d").to_string();
        messages::scout_left(game, scout_id, &scout_name, handed_back, &today);
    }
}

mod messages {
    use super::WatchedProspect;
    use crate::game::Game;
    use domain::message::{
        ActionOption, ActionType, InboxMessage, MessageAction, MessageCategory, MessageContext,
        MessagePriority,
    };
    use domain::staff::Staff;
    use std::collections::HashMap;

    fn params(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect()
    }

    fn notice(
        id: String,
        date: &str,
        subject_key: &str,
        body_key: &str,
        values: &[(&str, &str)],
    ) -> InboxMessage {
        let mut message = InboxMessage::new(
            id,
            String::new(),
            String::new(),
            String::new(),
            date.to_string(),
        )
        .with_category(MessageCategory::ScoutReport)
        .with_priority(MessagePriority::Normal)
        .with_sender_role("")
        .with_i18n(subject_key, body_key, params(values));
        message.sender_role_key = Some("be.role.scout".to_string());
        message
    }

    pub(super) fn left_market(game: &mut Game, entry: &WatchedProspect, date: &str) {
        let message = notice(
            format!("youth-watch-gone-{}", entry.prospect.id),
            date,
            "be.msg.youthWatchGone.subject",
            "be.msg.youthWatchGone.body",
            &[("player", &entry.prospect.full_name)],
        );
        crate::inbox::emit(game, message);
    }

    pub(super) fn retired(game: &mut Game, entry: &WatchedProspect, date: &str) {
        let message = notice(
            format!("youth-watch-retired-{}-{date}", entry.prospect.id),
            date,
            "be.msg.youthWatchRetired.subject",
            "be.msg.youthWatchRetired.body",
            &[("player", &entry.prospect.full_name)],
        );
        crate::inbox::emit(game, message);
    }

    pub(super) fn signed_by_club(
        game: &mut Game,
        prospect_id: &str,
        player_name: &str,
        club: &str,
        date: &str,
    ) {
        let message = notice(
            format!("youth-watch-taken-{prospect_id}"),
            date,
            "be.msg.youthWatchTaken.subject",
            "be.msg.youthWatchTaken.body",
            &[("player", player_name), ("team", club)],
        );
        crate::inbox::emit(game, message);
    }

    pub(super) fn scout_left(
        game: &mut Game,
        scout_id: &str,
        scout_name: &str,
        count: usize,
        date: &str,
    ) {
        let message = notice(
            format!("youth-watch-scout-left-{scout_id}-{date}"),
            date,
            "be.msg.youthWatchScoutLeft.subject",
            "be.msg.youthWatchScoutLeft.body",
            &[("scout", scout_name), ("count", &count.to_string())],
        );
        crate::inbox::emit(game, message);
    }

    /// The scout's Monday report: the prospect's ranges as they now stand, with
    /// the choice to sign him or let him go.
    pub(super) fn weekly_report(
        game: &mut Game,
        entry: &WatchedProspect,
        scout: &Staff,
        date: &str,
        complete: bool,
    ) {
        let (id_prefix, subject_key, body_key) = if complete {
            (
                "youth-watch-complete",
                "be.msg.youthWatchComplete.subject",
                "be.msg.youthWatchComplete.body",
            )
        } else {
            (
                "youth-watch-report",
                "be.msg.youthWatchReport.subject",
                "be.msg.youthWatchReport.body",
            )
        };
        let scout_name = format!("{} {}", scout.first_name, scout.last_name);
        let option = |id: &str| ActionOption {
            id: id.to_string(),
            label: String::new(),
            description: String::new(),
            label_key: Some(format!("be.msg.youthRecruitment.option.{id}.label")),
            description_key: Some(format!("be.msg.youthRecruitment.option.{id}.description")),
        };
        let mut message = InboxMessage::new(
            format!("{id_prefix}-{}-{date}", entry.prospect.id),
            String::new(),
            String::new(),
            scout_name.clone(),
            date.to_string(),
        )
        .with_category(MessageCategory::ScoutReport)
        .with_sender_role("")
        .with_action(MessageAction {
            id: format!("prospect:{}", entry.prospect.id),
            label: entry.prospect.full_name.clone(),
            action_type: ActionType::ChooseOption {
                options: vec![option("sign"), option("unwatch")],
            },
            resolved: false,
            label_key: None,
        })
        .with_context(MessageContext {
            team_id: game.manager.team_id.clone(),
            youth_prospects: Some(vec![entry.prospect.clone()]),
            youth_prospect_estimates: vec![entry.estimate.clone()],
            youth_prospect_reports: entry.report.clone().into_iter().collect(),
            ..MessageContext::default()
        })
        .with_i18n(
            subject_key,
            body_key,
            params(&[
                ("player", &entry.prospect.full_name),
                ("scout", &scout_name),
                ("weeks", &entry.weeks_followed.to_string()),
            ]),
        );
        message.sender_role_key = Some("be.role.scout".to_string());
        crate::inbox::emit(game, message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use chrono::{NaiveDate, TimeZone, Utc};
    use domain::manager::Manager;
    use domain::player::Position;
    use domain::staff::{Staff, StaffAttributes, StaffRole};
    use domain::team::Team;

    const USER: &str = "user";

    fn club(id: &str, nation: &str) -> Team {
        let mut team = Team::new(
            id.to_string(),
            format!("{id} FC"),
            "CLB".to_string(),
            nation.to_string(),
            "City".to_string(),
            "Ground".to_string(),
            20_000,
        );
        team.football_nation = nation.to_string();
        team
    }

    fn scout(id: &str, judging: u8) -> Staff {
        let mut scout = Staff::new(
            id.to_string(),
            "Sam".to_string(),
            id.to_string(),
            "1980-01-01".to_string(),
            StaffRole::Scout,
            StaffAttributes {
                coaching: 20,
                judging_ability: judging,
                judging_potential: judging,
                physiotherapy: 10,
            },
        );
        scout.team_id = Some(USER.to_string());
        scout
    }

    /// The user's club and two AI clubs, on Monday 3 August 2026, with a good
    /// scout (90) and a poor one (20).
    fn world() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 3, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire(USER.to_string());
        Game::new(
            clock,
            manager,
            vec![
                club(USER, "ENG"),
                club("ai-eng", "ENG"),
                club("ai-esp", "ESP"),
            ],
            vec![],
            vec![scout("good", 90), scout("poor", 20)],
            vec![],
        )
    }

    fn prospect(id: &str, ovr: u8, potential: u8) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            format!("Kid {id}"),
            "2009-01-01".to_string(),
            "ENG".to_string(),
            Position::Midfielder,
            crate::test_support::uniform_attributes(ovr),
        );
        player.football_nation = "ENG".to_string();
        player.ovr = ovr;
        player.potential = potential;
        player.squad_role = domain::player::SquadRole::Youth;
        player.stage_wage(500);
        player.stage_contract_end(Some("2029-06-30".to_string()));
        player
    }

    /// The widest read a poor scout gives: ±12 either side.
    fn wide_estimate(player: &Player) -> ProspectEstimate {
        ProspectEstimate {
            prospect_id: player.id.clone(),
            ovr_low: player.ovr - 12,
            ovr_high: player.ovr + 12,
            ovr_band: 12,
            potential_low: player.potential - 12,
            potential_high: player.potential + 12,
            potential_band: 12,
            attributes: Vec::new(),
        }
    }

    /// Put a prospect in the season's pool, as a scout's report found him, and
    /// on the watchlist.
    fn watched(game: &mut Game, id: &str, ovr: u8, potential: u8) {
        let player = prospect(id, ovr, potential);
        let estimate = wide_estimate(&player);
        game.youth_pool
            .get_or_insert_with(Default::default)
            .nations
            .entry("ENG".to_string())
            .or_default()
            .push(player.clone());
        watch(game, player, estimate).expect("watched");
    }

    fn entry<'a>(game: &'a Game, id: &str) -> &'a WatchedProspect {
        game.youth_watchlist
            .iter()
            .find(|entry| entry.prospect.id == id)
            .expect("on the watchlist")
    }

    fn next_monday(game: &mut Game) {
        game.clock.advance_days(7);
        process_youth_watchlist(game);
    }

    /// Given a prospect from a report,
    /// When the user watches him,
    /// Then he is on the list with no scout and the report's ranges; watching
    /// him twice is refused, and so is watching a youngster no longer in the
    /// pool.
    #[test]
    fn watching_puts_a_prospect_on_the_list() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);

        let entry = entry(&game, "p1");
        assert_eq!(entry.scout_id, None);
        assert_eq!(entry.estimate.ovr_band, 12);
        assert_eq!(entry.added_on, "2026-08-03");
        let again = prospect("p1", 60, 80);
        let estimate = wide_estimate(&again);
        assert_eq!(
            watch(&mut game, again, estimate),
            Err("be.error.scouting.prospectAlreadyWatched".to_string())
        );
        let gone = prospect("gone", 60, 80);
        let estimate = wide_estimate(&gone);
        assert_eq!(
            watch(&mut game, gone, estimate),
            Err("be.error.scouting.prospectOffMarket".to_string())
        );
    }

    /// Given a scout already following three prospects,
    /// When he is given a fourth,
    /// Then it is refused.
    #[test]
    fn a_scout_follows_at_most_three_prospects() {
        let mut game = world();
        for id in ["p1", "p2", "p3", "p4"] {
            watched(&mut game, id, 60, 80);
        }
        for id in ["p1", "p2", "p3"] {
            assign_scout(&mut game, id, Some("good")).expect("room");
        }

        assert_eq!(
            assign_scout(&mut game, "p4", Some("good")),
            Err("be.error.scouting.scoutWatchlistFull".to_string())
        );
        assert_eq!(entry(&game, "p4").scout_id, None);
    }

    /// Given a prospect read at ±12,
    /// When a good scout takes him on, then a poor one,
    /// Then the good scout narrows him to ±2 at once, and the poor one does not
    /// widen him again; the truth stays inside throughout.
    #[test]
    fn a_better_scout_narrows_at_once_and_a_worse_one_never_widens() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);

        assign_scout(&mut game, "p1", Some("good")).unwrap();
        let after_good = entry(&game, "p1").estimate.clone();
        assign_scout(&mut game, "p1", Some("poor")).unwrap();
        let after_poor = entry(&game, "p1").estimate.clone();

        assert_eq!((after_good.ovr_band, after_good.potential_band), (2, 2));
        assert_eq!(after_poor.ovr_band, 2);
        assert!(after_good.ovr_high - after_good.ovr_low <= 4);
        assert!((after_good.ovr_low..=after_good.ovr_high).contains(&60));
        assert!((after_good.potential_low..=after_good.potential_high).contains(&80));
        assert_eq!(after_poor, after_good);
    }

    /// Given a prospect followed by the poor scout,
    /// When four Mondays pass,
    /// Then his ranges step down a band a week (12, 8, 5, 2, 0), never widen,
    /// always hold the truth, and end exact.
    #[test]
    fn a_followed_prospect_narrows_one_band_a_week_to_the_truth() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        assign_scout(&mut game, "p1", Some("poor")).unwrap();
        let mut previous = entry(&game, "p1").estimate.clone();

        for band in [8, 5, 2, 0] {
            next_monday(&mut game);
            let estimate = entry(&game, "p1").estimate.clone();
            assert_eq!((estimate.ovr_band, estimate.potential_band), (band, band));
            assert!(estimate.ovr_low >= previous.ovr_low && estimate.ovr_high <= previous.ovr_high);
            assert!((estimate.ovr_low..=estimate.ovr_high).contains(&60));
            assert!((estimate.potential_low..=estimate.potential_high).contains(&80));
            previous = estimate;
        }
        assert_eq!((previous.ovr_low, previous.ovr_high), (60, 60));
        assert_eq!((previous.potential_low, previous.potential_high), (80, 80));
    }

    /// Given a prospect nobody follows,
    /// When a Monday passes,
    /// Then his ranges stay as they were.
    #[test]
    fn an_unfollowed_prospect_does_not_narrow() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        let before = entry(&game, "p1").estimate.clone();

        next_monday(&mut game);

        assert_eq!(entry(&game, "p1").estimate, before);
    }

    /// Given a central midfielder and a keeper,
    /// When their reveal order is drawn,
    /// Then each starts with what matters most for his position, the keeper's
    /// with handling and reflexes, and only a keeper's includes them.
    #[test]
    fn attributes_come_out_in_the_order_the_position_weighs_them() {
        let mut midfielder = prospect("m", 60, 80);
        midfielder.position = Position::CentralMidfielder;
        let mut keeper = prospect("k", 60, 80);
        keeper.position = Position::Goalkeeper;

        let order = reveal_order(&midfielder);
        assert_eq!(order[0], "passing");
        assert!(order[1..3].contains(&"vision") && order[1..3].contains(&"decisions"));
        assert_eq!(order.len(), 17);
        assert!(!order.contains(&"handling") && !order.contains(&"reflexes"));
        let keeper_order = reveal_order(&keeper);
        assert_eq!(keeper_order.len(), 19);
        assert!(keeper_order[..2].contains(&"handling") && keeper_order[..2].contains(&"reflexes"));
    }

    fn reads(game: &Game, id: &str) -> Vec<domain::message::AttributeRead> {
        entry(game, id).estimate.attributes.clone()
    }

    /// Given a prospect followed by a scout who judges ability at 90,
    /// When the Mondays pass,
    /// Then he reveals four attributes a week until all are known, each new
    /// one at the overall band of the day, narrowing a step a week after, and
    /// every range holds the truth.
    #[test]
    fn a_good_scout_reveals_four_attributes_a_week() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        assign_scout(&mut game, "p1", Some("good")).unwrap();
        let total = reveal_order(&entry(&game, "p1").prospect).len();

        next_monday(&mut game);
        let first = reads(&game, "p1");
        assert_eq!(first.len(), 4);
        let band = entry(&game, "p1").estimate.ovr_band;
        assert!(first.iter().all(|read| read.band == band));

        next_monday(&mut game);
        let second = reads(&game, "p1");
        assert_eq!(second.len(), 8);
        assert!(second[..4].iter().all(|read| read.band == next_band(band)));

        for _ in 0..4 {
            next_monday(&mut game);
        }
        let all = reads(&game, "p1");
        assert_eq!(all.len(), total);
        for read in &all {
            assert!(read.low <= 60 && 60 <= read.high, "{read:?}");
        }
    }

    /// Given a prospect a good scout follows until he knows everything,
    /// When the Monday that completes him passes,
    /// Then the scout sends one "assessment complete" report, stops following
    /// him to free his slot, and sends nothing more; he stays on the list.
    #[test]
    fn a_fully_known_prospect_frees_his_scout() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        assign_scout(&mut game, "p1", Some("good")).unwrap();

        for _ in 0..8 {
            next_monday(&mut game);
        }

        let entry = entry(&game, "p1");
        assert_eq!(entry.scout_id, None);
        assert_eq!(
            entry.estimate.attributes.len(),
            reveal_order(&entry.prospect).len()
        );
        let complete: Vec<_> = game
            .messages
            .iter()
            .filter(|message| message.id.starts_with("youth-watch-complete-p1"))
            .collect();
        assert_eq!(complete.len(), 1);
        assert_eq!(complete[0].context.youth_prospect_reports.len(), 1);
        let reports = game
            .messages
            .iter()
            .filter(|message| message.id.starts_with("youth-watch-report-p1-"))
            .count();
        assert!(reports < 8, "{reports} weekly reports");
    }

    /// Given a prospect followed by a poor scout,
    /// When a Monday passes,
    /// Then only two attributes come out.
    #[test]
    fn a_poor_scout_reveals_two_attributes_a_week() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        assign_scout(&mut game, "p1", Some("poor")).unwrap();

        next_monday(&mut game);

        assert_eq!(reads(&game, "p1").len(), 2);
    }

    /// Given a watched prospect and his scout,
    /// When the weeks pass,
    /// Then each weekly report carries his player card as read that week, and
    /// the watchlist holds the latest card: attributes from the second week,
    /// and more confidence as the band narrows.
    #[test]
    fn the_weekly_report_and_the_watchlist_carry_the_latest_card() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        let first = entry(&game, "p1")
            .report
            .clone()
            .expect("a card from the start");
        assert_eq!(first.confidence_key, "common.scoutConfidence.low");
        assert!(first.attribute_reads.is_empty());
        assert_eq!(first.height_cm, Some(entry(&game, "p1").prospect.height_cm));
        assign_scout(&mut game, "p1", Some("good")).unwrap();

        next_monday(&mut game);
        next_monday(&mut game);

        let cards: Vec<_> = game
            .messages
            .iter()
            .filter(|message| message.id.starts_with("youth-watch-report-p1-"))
            .flat_map(|message| message.context.youth_prospect_reports.clone())
            .collect();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].attribute_reads.len(), 4);
        assert_eq!(cards[1].attribute_reads.len(), 8);
        let latest = entry(&game, "p1").report.clone().unwrap();
        assert_eq!(latest.attribute_reads.len(), 8);
        assert_eq!(latest.confidence_key, "common.scoutConfidence.exact");
        assert_eq!(latest.avg_rating, Some(60));
    }

    /// Given a prospect nobody signs,
    /// When twenty weeks pass,
    /// Then he is still on the list: only the season's end takes him off it.
    #[test]
    fn a_watched_prospect_does_not_expire() {
        let mut game = world();
        watched(&mut game, "p1", 40, 45);

        for _ in 0..20 {
            next_monday(&mut game);
        }

        assert_eq!(game.youth_watchlist.len(), 1);
    }

    /// A watched prospect followed by the good scout, and an English AI club
    /// that needs a midfielder on the season's last Monday, which signs him.
    fn signed_by_ai() -> Game {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        assign_scout(&mut game, "p1", Some("good")).unwrap();
        let pool = game.youth_pool.as_mut().unwrap();
        pool.ends_on = "2026-08-03".to_string();
        pool.demand
            .insert("ai-eng".to_string(), vec![Position::Midfielder]);
        crate::youth_pool::process_ai_signings(&mut game);
        game
    }

    /// Given a watched prospect an AI club moves for,
    /// When it signs him,
    /// Then he stays on the list marked with his new club, his scout stops
    /// following him, and the user is told where he went.
    #[test]
    fn an_ai_club_signing_a_watched_prospect_marks_him_signed() {
        let game = signed_by_ai();

        let entry = entry(&game, "p1");
        assert_eq!(entry.signed_by.as_deref(), Some("ai-eng FC"));
        assert_eq!(entry.signed_by_team_id.as_deref(), Some("ai-eng"));
        assert_eq!(entry.scout_id, None);
        let joined = game
            .players
            .iter()
            .find(|player| player.id == "p1")
            .unwrap();
        assert_eq!(joined.team_id.as_deref(), Some("ai-eng"));
        let told = game
            .messages
            .iter()
            .find(|message| message.id == "youth-watch-taken-p1")
            .expect("the user is told");
        assert_eq!(
            told.i18n_params.get("team").map(String::as_str),
            Some("ai-eng FC")
        );
    }

    /// Given a watched prospect another club has signed,
    /// When the weeks pass and the user tries to give him a scout or sign him,
    /// Then no scout reports on him, and both are refused with his club named.
    #[test]
    fn a_prospect_signed_elsewhere_is_no_longer_followed_or_signable() {
        let mut game = signed_by_ai();
        let estimate = entry(&game, "p1").estimate.clone();

        next_monday(&mut game);
        next_monday(&mut game);

        assert_eq!(entry(&game, "p1").estimate, estimate);
        assert!(
            !game
                .messages
                .iter()
                .any(|message| message.id.starts_with("youth-watch-report-p1-2026-08-1"))
        );
        let refused = "be.error.scouting.prospectJoinedClub?team=ai-eng FC".to_string();
        assert_eq!(
            assign_scout(&mut game, "p1", Some("good")),
            Err(refused.clone())
        );
        assert_eq!(sign(&mut game, "p1").map(|player| player.id), Err(refused));
        assert!(unwatch(&mut game, "p1").is_ok());
    }

    /// Given a free prospect and one another club signed,
    /// When the season ends and its pool gives way to the next,
    /// Then the free one leaves the market and the list, with a message, and
    /// the signed one stays on the list for the user to let go.
    #[test]
    fn the_seasons_end_takes_only_the_free_prospects() {
        let mut game = signed_by_ai();
        watched(&mut game, "p2", 55, 75);
        let season_end = NaiveDate::from_ymd_opt(2027, 5, 30).unwrap();

        crate::youth_pool::roll_over(&mut game, season_end);

        let left: Vec<&str> = game
            .youth_watchlist
            .iter()
            .map(|entry| entry.prospect.id.as_str())
            .collect();
        assert_eq!(left, ["p1"]);
        assert!(
            game.messages
                .iter()
                .any(|message| message.id == "youth-watch-gone-p2")
        );
        assert!(
            !game
                .messages
                .iter()
                .any(|message| message.id == "youth-watch-gone-p1")
        );
    }

    /// A rival's senior midfielder, rated 60 everywhere, watched from a
    /// report that read him within ±12 and revealed nothing.
    fn watched_player(game: &mut Game) {
        let mut player = prospect("pro", 60, 70);
        player.team_id = Some("ai-eng".to_string());
        player.squad_role = domain::player::SquadRole::Senior;
        game.players.push(player.clone());
        watch_player(game, "pro", wide_estimate(&player)).expect("watched");
    }

    /// Given a rival's player watched from his report,
    /// When a good scout follows him,
    /// Then he is watched as a player, reads more each week like a youngster,
    /// and is not refused for being outside the pool.
    #[test]
    fn a_watched_player_is_followed_like_a_prospect() {
        let mut game = world();
        watched_player(&mut game);
        assert_eq!(entry(&game, "pro").kind, WatchKind::Player);

        assign_scout(&mut game, "pro", Some("good")).unwrap();
        next_monday(&mut game);

        assert_eq!(reads(&game, "pro").len(), 4);
        assert!(entry(&game, "pro").report.is_some());
    }

    /// Given a scout already following two youngsters and a watched player,
    /// When he is given a third youngster,
    /// Then he is refused: the three-a-scout limit counts players too.
    #[test]
    fn players_count_towards_a_scouts_three() {
        let mut game = world();
        watched_player(&mut game);
        assign_scout(&mut game, "pro", Some("good")).unwrap();
        for id in ["p1", "p2", "p3"] {
            watched(&mut game, id, 60, 80);
        }
        assign_scout(&mut game, "p1", Some("good")).unwrap();
        assign_scout(&mut game, "p2", Some("good")).unwrap();

        assert_eq!(
            assign_scout(&mut game, "p3", Some("good")),
            Err("be.error.scouting.scoutWatchlistFull".to_string())
        );
    }

    /// Given a watched player whose attributes grow while he is followed,
    /// When the next Monday's read comes,
    /// Then every range still holds his true value.
    #[test]
    fn a_watched_players_ranges_follow_him_as_he_develops() {
        let mut game = world();
        watched_player(&mut game);
        assign_scout(&mut game, "pro", Some("good")).unwrap();
        next_monday(&mut game);
        let player = game.players.iter_mut().find(|p| p.id == "pro").unwrap();
        player.attributes.passing = 75;
        player.attributes.vision = 75;
        player.ovr = 66;

        next_monday(&mut game);

        let entry = entry(&game, "pro");
        assert!((entry.estimate.ovr_low..=entry.estimate.ovr_high).contains(&66));
        let live = game.players.iter().find(|p| p.id == "pro").unwrap();
        for read in &entry.estimate.attributes {
            let truth = crate::player_rating::attribute_value(&live.attributes, &read.key);
            assert!(read.low <= truth && truth <= read.high, "{read:?}");
        }
    }

    /// Given a watched player,
    /// When he retires,
    /// Then he leaves the list the next day and the user is told.
    #[test]
    fn a_watched_player_who_retires_leaves_the_list() {
        let mut game = world();
        watched_player(&mut game);
        game.players
            .iter_mut()
            .find(|p| p.id == "pro")
            .unwrap()
            .retired = true;
        game.clock.advance_days(1);

        process_youth_watchlist(&mut game);

        assert!(game.youth_watchlist.is_empty());
        assert!(
            game.messages
                .iter()
                .any(|m| m.id.starts_with("youth-watch-retired-pro"))
        );
    }

    /// Given a watched player,
    /// When he signs for the user's club,
    /// Then he leaves the list quietly.
    #[test]
    fn a_watched_player_who_joins_the_users_club_leaves_quietly() {
        let mut game = world();
        watched_player(&mut game);
        game.players
            .iter_mut()
            .find(|p| p.id == "pro")
            .unwrap()
            .team_id = Some(USER.to_string());
        game.clock.advance_days(1);

        process_youth_watchlist(&mut game);

        assert!(game.youth_watchlist.is_empty());
        assert!(!game.messages.iter().any(|m| m.id.contains("pro")));
    }

    /// Given a watched player and a free youngster,
    /// When the season's pool closes,
    /// Then only the youngster leaves; the player was never in the pool.
    #[test]
    fn the_seasons_end_keeps_watched_players() {
        let mut game = world();
        watched_player(&mut game);
        watched(&mut game, "p1", 60, 80);

        crate::youth_pool::roll_over(&mut game, NaiveDate::from_ymd_opt(2027, 5, 30).unwrap());

        let left: Vec<&str> = game
            .youth_watchlist
            .iter()
            .map(|entry| entry.prospect.id.as_str())
            .collect();
        assert_eq!(left, ["pro"]);
    }

    /// Given a watched player,
    /// When something tries to sign him as a youngster,
    /// Then it is refused.
    #[test]
    fn a_watched_player_cannot_be_signed_as_a_prospect() {
        let mut game = world();
        watched_player(&mut game);

        assert_eq!(
            sign(&mut game, "pro").map(|p| p.id),
            Err("be.error.scouting.watchedPlayerNotProspect".to_string())
        );
    }

    /// Given a followed prospect,
    /// When the user signs him,
    /// Then he joins the academy and leaves the list.
    #[test]
    fn signing_a_watched_prospect_takes_him_off_the_list() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        assign_scout(&mut game, "p1", Some("good")).unwrap();

        let signed = sign(&mut game, "p1").expect("signed");

        assert_eq!(signed.team_id.as_deref(), Some(USER));
        assert!(game.youth_watchlist.is_empty());
        assert!(game.players.iter().any(|player| player.id == "p1"));
    }

    /// Given a scout following two prospects,
    /// When he leaves the club,
    /// Then both stay on the list without a scout, and the user is told.
    #[test]
    fn a_scout_who_leaves_hands_his_prospects_back() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        watched(&mut game, "p2", 55, 75);
        assign_scout(&mut game, "p1", Some("good")).unwrap();
        assign_scout(&mut game, "p2", Some("good")).unwrap();

        scout_left(&mut game, "good");

        assert_eq!(game.youth_watchlist.len(), 2);
        assert!(
            game.youth_watchlist
                .iter()
                .all(|entry| entry.scout_id.is_none())
        );
        assert!(
            game.messages
                .iter()
                .any(|message| message.id.starts_with("youth-watch-scout-left-good"))
        );
    }

    /// Given a watched prospect,
    /// When the user lets him go,
    /// Then he is off the list; letting go of someone not on it is refused.
    #[test]
    fn unwatching_lets_a_prospect_go() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);

        unwatch(&mut game, "p1").expect("unwatched");

        assert!(game.youth_watchlist.is_empty());
        assert_eq!(
            unwatch(&mut game, "p1"),
            Err("be.error.scouting.prospectNotWatched".to_string())
        );
    }
}
