//! The youth watchlist: scouted youngsters the user follows week by week until
//! the club signs them, lets them go, or another club signs them first.
//!
//! A prospect on the list is not in `Game::players`: he is nobody's yet. A scout
//! the user assigns narrows the ranges in which his overall and potential lie,
//! one judgement band a week, and reports each Monday.

use crate::game::Game;
use domain::message::ProspectEstimate;
use domain::player::Player;
use serde::{Deserialize, Serialize};

/// A youngster on the user's watchlist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchedProspect {
    pub prospect: Player,
    /// What the club knows of him: the ranges and how wide they are.
    pub estimate: ProspectEstimate,
    /// The scout following him; none until the user assigns one.
    #[serde(default)]
    pub scout_id: Option<String>,
    pub added_on: String,
    /// The day he drops off the list if he has not been signed.
    pub expires_on: String,
    /// Weekly reports a scout has sent on him.
    #[serde(default)]
    pub weeks_followed: u32,
}

/// Most prospects one scout can follow at once.
pub const MAX_WATCHED_PER_SCOUT: usize = 3;

/// How long a prospect stays on the list unsigned.
const WATCH_WEEKS: i64 = 12;

/// The bands a followed prospect's ranges step down through, a step a week.
const BAND_STEPS: [u8; 5] = [12, 8, 5, 2, 0];

/// The headline attributes a weekly report can reveal, as the player scout
/// report names them.
const HEADLINE_ATTRIBUTES: [&str; 6] = [
    "Pace",
    "Shooting",
    "Passing",
    "Dribbling",
    "Defending",
    "Physical",
];

const ERR_NOT_WATCHED: &str = "be.error.scouting.prospectNotWatched";
const ERR_ALREADY_WATCHED: &str = "be.error.scouting.prospectAlreadyWatched";
const ERR_SCOUT_WATCHLIST_FULL: &str = "be.error.scouting.scoutWatchlistFull";

/// Put a prospect from a report on the watchlist, as the report read him, for
/// twelve weeks and with no scout yet.
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
    let today = game.clock.current_date.date_naive();
    let expires = today + chrono::Duration::weeks(WATCH_WEEKS);
    game.youth_watchlist.push(WatchedProspect {
        prospect,
        estimate,
        scout_id: None,
        added_on: today.format("%Y-%m-%d").to_string(),
        expires_on: expires.format("%Y-%m-%d").to_string(),
        weeks_followed: 0,
    });
    Ok(())
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
    let ovr_band = ovr_band.min(entry.estimate.ovr_band);
    let potential_band = potential_band.min(entry.estimate.potential_band);
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
    index_of(game, prospect_id)?;
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
/// him, he leaves the list and the user is told where he went.
pub(crate) fn signed_by_club(game: &mut Game, prospect_id: &str, club_name: &str) {
    let Some(index) = game
        .youth_watchlist
        .iter()
        .position(|entry| entry.prospect.id == prospect_id)
    else {
        return;
    };
    let entry = game.youth_watchlist.remove(index);
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    messages::signed_elsewhere(
        game,
        &entry.prospect.id,
        &entry.prospect.full_name,
        Some(club_name),
        &today,
    );
}

/// The week's watchlist business, on Mondays: prospects whose time is up leave,
/// others may be signed by another club first, and the rest who have a scout
/// narrow a band and get a report.
pub fn process_youth_watchlist(game: &mut Game) {
    use chrono::Datelike;
    if game.clock.current_date.weekday() != chrono::Weekday::Mon {
        return;
    }
    let today = game.clock.current_date.date_naive();
    let today_text = today.format("%Y-%m-%d").to_string();
    let entries = std::mem::take(&mut game.youth_watchlist);
    for mut entry in entries {
        let expired = chrono::NaiveDate::parse_from_str(&entry.expires_on, "%Y-%m-%d")
            .is_ok_and(|expires| today >= expires);
        if expired {
            messages::expired(game, &entry, &today_text);
            continue;
        }
        let mut rng = game.rng_for(
            &format!("youth-watchlist/{}", entry.prospect.id),
            &today_text,
        );
        if rand::RngExt::random_bool(&mut rng, interception_chance(entry.prospect.potential)) {
            let player_name = entry.prospect.full_name.clone();
            let prospect_id = entry.prospect.id.clone();
            let club = signed_elsewhere(game, entry, &mut rng);
            messages::signed_elsewhere(
                game,
                &prospect_id,
                &player_name,
                club.as_deref(),
                &today_text,
            );
            continue;
        }
        if let Some(scout) = entry
            .scout_id
            .as_deref()
            .and_then(|id| game.staff.iter().find(|staff| staff.id == id))
            .cloned()
        {
            let ovr_band = next_band(entry.estimate.ovr_band);
            let potential_band = next_band(entry.estimate.potential_band);
            narrow(&mut entry, ovr_band, potential_band, &mut rng);
            entry.weeks_followed += 1;
            if entry.weeks_followed >= 2 {
                entry.estimate.attributes =
                    read_attributes(&entry, scout.attributes.judging_ability, &mut rng);
            }
            messages::weekly_report(game, &entry, &scout, &today_text);
        }
        game.youth_watchlist.push(entry);
    }
}

/// The headline attributes `judging_ability` reveals, each read within the
/// prospect's current overall band. Which ones a scout sees is fixed per
/// prospect, so the list only grows with a better scout.
fn read_attributes(
    entry: &WatchedProspect,
    judging_ability: u8,
    rng: &mut impl rand::Rng,
) -> Vec<domain::message::AttributeRead> {
    let attributes = &entry.prospect.attributes;
    let values = [
        attributes.pace,
        attributes.shooting,
        attributes.passing,
        attributes.dribbling,
        attributes.defending,
        attributes.strength,
    ];
    let mut order: Vec<usize> = (0..HEADLINE_ATTRIBUTES.len()).collect();
    let seed = crate::stable_hash::stable_hash(entry.prospect.id.as_bytes(), 0);
    order.sort_by_key(|index| crate::stable_hash::stable_hash(&[*index as u8], seed));
    order.truncate(crate::scouting::revealed_attribute_count(judging_ability));
    order.sort_unstable();
    order
        .into_iter()
        .map(|index| {
            let (low, high) =
                crate::scouting::read_rating(values[index], entry.estimate.ovr_band, rng);
            domain::message::AttributeRead {
                key: HEADLINE_ATTRIBUTES[index].to_string(),
                low,
                high,
            }
        })
        .collect()
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

/// The weekly chance another club signs a watched prospect first: 3%, rising to
/// 7% for a prospect of true potential 90 or more.
fn interception_chance(potential: u8) -> f64 {
    let pull = ((f64::from(potential) - 60.0) / 30.0).clamp(0.0, 1.0);
    0.03 + 0.04 * pull
}

/// Another club signs the prospect into its academy: an AI club of his football
/// nation if one will pay him, otherwise any AI club that will. Returns the
/// club's name, or `None` when nobody would, and he leaves the market.
fn signed_elsewhere(
    game: &mut Game,
    entry: WatchedProspect,
    rng: &mut impl rand::Rng,
) -> Option<String> {
    use rand::seq::SliceRandom;
    let user_team = game.manager.team_id.clone();
    let nation = entry.prospect.football_nation.clone();
    let (mut home, mut abroad): (Vec<usize>, Vec<usize>) = game
        .teams
        .iter()
        .enumerate()
        .filter(|(_, team)| Some(&team.id) != user_team.as_ref())
        .map(|(index, _)| index)
        .partition(|index| game.teams[*index].football_nation == nation);
    home.shuffle(rng);
    abroad.shuffle(rng);
    let date = game.clock.current_date.date_naive();
    for index in home.into_iter().chain(abroad) {
        if crate::youth_intake::sign_into_academy(game, index, entry.prospect.clone(), date) {
            return Some(game.teams[index].name.clone());
        }
    }
    None
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

    pub(super) fn expired(game: &mut Game, entry: &WatchedProspect, date: &str) {
        let message = notice(
            format!("youth-watch-expired-{}", entry.prospect.id),
            date,
            "be.msg.youthWatchExpired.subject",
            "be.msg.youthWatchExpired.body",
            &[("player", &entry.prospect.full_name)],
        );
        crate::inbox::emit(game, message);
    }

    pub(super) fn signed_elsewhere(
        game: &mut Game,
        prospect_id: &str,
        player_name: &str,
        club: Option<&str>,
        date: &str,
    ) {
        let message = match club {
            Some(club) => notice(
                format!("youth-watch-taken-{prospect_id}"),
                date,
                "be.msg.youthWatchTaken.subject",
                "be.msg.youthWatchTaken.body",
                &[("player", player_name), ("team", club)],
            ),
            None => notice(
                format!("youth-watch-taken-{prospect_id}"),
                date,
                "be.msg.youthWatchGone.subject",
                "be.msg.youthWatchGone.body",
                &[("player", player_name)],
            ),
        };
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
    ) {
        let scout_name = format!("{} {}", scout.first_name, scout.last_name);
        let option = |id: &str| ActionOption {
            id: id.to_string(),
            label: String::new(),
            description: String::new(),
            label_key: Some(format!("be.msg.youthRecruitment.option.{id}.label")),
            description_key: Some(format!("be.msg.youthRecruitment.option.{id}.description")),
        };
        let mut message = InboxMessage::new(
            format!("youth-watch-report-{}-{date}", entry.prospect.id),
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
            ..MessageContext::default()
        })
        .with_i18n(
            "be.msg.youthWatchReport.subject",
            "be.msg.youthWatchReport.body",
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
    use chrono::{TimeZone, Utc};
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
    /// Then he is on the list with no scout, the report's ranges, and twelve
    /// weeks to run; watching him twice is refused.
    #[test]
    fn watching_puts_a_prospect_on_the_list_for_twelve_weeks() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);

        let entry = entry(&game, "p1");
        assert_eq!(entry.scout_id, None);
        assert_eq!(entry.estimate.ovr_band, 12);
        assert_eq!(entry.added_on, "2026-08-03");
        assert_eq!(entry.expires_on, "2026-10-26");
        let again = prospect("p1", 60, 80);
        let estimate = wide_estimate(&again);
        assert_eq!(
            watch(&mut game, again, estimate),
            Err("be.error.scouting.prospectAlreadyWatched".to_string())
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

    /// Given a followed prospect,
    /// When the first and second Mondays pass,
    /// Then the scout reports each week, and from the second report adds the
    /// headline attributes his judgement reveals: all six for a good scout.
    #[test]
    fn a_scout_reports_weekly_and_reveals_attributes_from_the_second_week() {
        let mut game = world();
        watched(&mut game, "p1", 60, 80);
        assign_scout(&mut game, "p1", Some("good")).unwrap();

        next_monday(&mut game);
        let reports = |game: &Game| -> Vec<ProspectEstimate> {
            game.messages
                .iter()
                .filter(|message| message.id.starts_with("youth-watch-report-p1-"))
                .flat_map(|message| message.context.youth_prospect_estimates.clone())
                .collect()
        };
        assert_eq!(reports(&game).len(), 1);
        assert!(reports(&game)[0].attributes.is_empty());

        next_monday(&mut game);
        let second = reports(&game);
        assert_eq!(second.len(), 2);
        assert_eq!(second[1].attributes.len(), 6);
        assert!(
            second[1]
                .attributes
                .iter()
                .all(|read| read.low <= 60 && 60 <= read.high)
        );
    }

    /// Given a prospect nobody signs,
    /// When twelve weeks pass,
    /// Then he drops off the list and the user is told.
    #[test]
    fn an_unsigned_prospect_expires_after_twelve_weeks() {
        let mut game = world();
        watched(&mut game, "p1", 40, 45);
        game.clock.advance_days(7 * 12);

        process_youth_watchlist(&mut game);

        assert!(game.youth_watchlist.is_empty());
        assert!(
            game.messages
                .iter()
                .any(|message| message.id == "youth-watch-expired-p1")
        );
    }

    /// Given prospects of rising true potential,
    /// When the weekly chance of another club signing them first is read,
    /// Then it runs from 3% to 7%.
    #[test]
    fn better_prospects_are_more_likely_to_be_signed_elsewhere() {
        assert!((interception_chance(50) - 0.03).abs() < 1e-9);
        assert!((interception_chance(75) - 0.05).abs() < 1e-9);
        assert!((interception_chance(95) - 0.07).abs() < 1e-9);
    }

    /// Given an English prospect another club moves for,
    /// When he is signed elsewhere,
    /// Then he joins the English AI club's academy and becomes a real player.
    #[test]
    fn a_prospect_signed_elsewhere_joins_an_ai_academy_of_his_nation() {
        let mut game = world();
        let player = prospect("p1", 60, 80);
        let entry = WatchedProspect {
            estimate: wide_estimate(&player),
            prospect: player,
            scout_id: None,
            added_on: "2026-08-03".to_string(),
            expires_on: "2026-10-26".to_string(),
            weeks_followed: 0,
        };
        let mut rng = rand::rngs::StdRng::seed_from_u64(1);

        let club = signed_elsewhere(&mut game, entry, &mut rng);

        assert_eq!(club.as_deref(), Some("ai-eng FC"));
        let joined = game
            .players
            .iter()
            .find(|player| player.id == "p1")
            .expect("a real player now");
        assert_eq!(joined.team_id.as_deref(), Some("ai-eng"));
        assert_eq!(joined.squad_role, domain::player::SquadRole::Youth);
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

    use rand::SeedableRng;
}
