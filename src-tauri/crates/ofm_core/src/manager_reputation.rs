//! The user's reputation, reviewed once a season (phase 2 lane M, package M-1).
//!
//! AI managers keep the reputation they were created with; only the user's
//! moves. Constants and the rule are in `fm-document/game-engine/phase 2/
//! làn-M-tech-spec.md` §5.

use crate::game::Game;
use domain::league::{FixtureCompetition, StandingEntry};
use domain::manager::{Honour, HonourKind, ReputationChange};
use domain::message::{InboxMessage, MessageCategory, MessagePriority};
use std::collections::HashMap;

/// Reputation per league place finished above (or below) where the club's
/// standing said it would, at the top tier.
const PERFORMANCE_PER_PLACE: f64 = 10.0;
/// The share of the gap to a bigger club's reputation that leading it earns
/// in a season. Never pulls down: a good manager at a small club is not
/// marked down for the club's size.
const CLUB_PULL: f64 = 0.25;
/// A league title at the top tier; lower tiers scale it like performance.
const LEAGUE_TITLE: f64 = 30.0;
const DOMESTIC_CUP: i32 = 20;
const CONTINENTAL_CUP: i32 = 50;
const CLUB_WORLD_CUP: i32 = 30;
const PROMOTION: f64 = 20.0;
const RELEGATION: f64 = -30.0;
/// One season can lift a reputation by at most this much, or cut it by at
/// most `SEASON_CHANGE_FLOOR`, so a single run cannot make or end a career.
const SEASON_CHANGE_CEILING: i32 = 120;
const SEASON_CHANGE_FLOOR: i32 = -100;
/// What a dismissal costs, taken the day it happens (`firing::execute_firing`).
pub(crate) const DISMISSAL: i32 = -40;
const MAX_REPUTATION: u32 = 1000;

/// How much a tier's results count: the top division in full, the second at
/// three quarters, anything lower at half.
fn tier_weight(tier: u32) -> f64 {
    match tier {
        0 => 1.0,
        1 => 0.75,
        _ => 0.5,
    }
}

/// The user's league season as it stood before club reputations moved.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SeasonReview {
    pub team_id: String,
    /// Where the club's reputation ranked it within its own division.
    pub expected_position: u32,
    pub final_position: u32,
    /// 0 for the top division of the club's pyramid.
    pub tier: u32,
    pub club_reputation: u32,
    /// League matches the club played this season.
    pub league_matches_played: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DivisionMove {
    Promoted,
    Relegated,
}

/// The season's change to `reputation`, with the parts the season-end
/// message shows.
///
/// `review` is `None` when the user is out of work at the review: only
/// trophies won earlier in the season count then. `matches_led` is how many of
/// the club's league matches the user led, so a manager who arrived in March
/// carries only their own share of the table and of promotion or relegation.
/// Trophies always count in full: they were won by the manager.
/// `dismissal` was already taken off when it happened; it is only recorded.
pub(crate) fn season_change(
    season: u32,
    reputation: u32,
    review: Option<&SeasonReview>,
    matches_led: u32,
    division_move: Option<DivisionMove>,
    honours: &[Honour],
    dismissal: i32,
) -> ReputationChange {
    let tier = review.map_or(0, |review| review.tier);
    let trophies: i32 = honours
        .iter()
        .map(|honour| trophy_worth(honour.kind, tier))
        .sum();

    let (performance, division, club_pull, matches_played) = match review {
        Some(review) => {
            let share = share_led(matches_led, review.league_matches_played);
            let places_above =
                f64::from(review.expected_position) - f64::from(review.final_position);
            let performance = places_above * PERFORMANCE_PER_PLACE * tier_weight(review.tier);
            let division = match division_move {
                Some(DivisionMove::Promoted) => PROMOTION,
                Some(DivisionMove::Relegated) => RELEGATION,
                None => 0.0,
            };
            let gap_to_club = f64::from(review.club_reputation.saturating_sub(reputation));
            (
                rounded(performance * share),
                rounded(division * share),
                rounded(gap_to_club * CLUB_PULL),
                review.league_matches_played,
            )
        }
        None => (0, 0, 0, 0),
    };

    let honours_total = trophies + division;
    let change =
        (performance + honours_total + club_pull).clamp(SEASON_CHANGE_FLOOR, SEASON_CHANGE_CEILING);
    let after = (i64::from(reputation) + i64::from(change)).clamp(0, i64::from(MAX_REPUTATION));

    ReputationChange {
        season,
        team_id: review.map(|review| review.team_id.clone()),
        before: reputation,
        after: u32::try_from(after).unwrap_or(reputation),
        performance,
        honours: honours_total,
        club_pull,
        dismissal,
        league_matches_led: matches_led,
        league_matches_played: matches_played,
    }
}

/// The user's league season as it stands at the end of the season, read
/// before the end-of-season loop moves club reputations: the user is judged
/// against what their club was expected to do going in.
///
/// `None` when the user is out of work or their club is not in `final_standings`.
pub(crate) fn capture_season_review(
    game: &Game,
    user_team_id: &str,
    final_standings: &[StandingEntry],
    tier: u32,
) -> Option<SeasonReview> {
    if game.manager.team_id.as_deref() != Some(user_team_id) {
        return None;
    }
    let index = final_standings
        .iter()
        .position(|standing| standing.team_id == user_team_id)?;
    let standing = &final_standings[index];
    let club_reputation = game
        .teams
        .iter()
        .find(|team| team.id == user_team_id)?
        .reputation;
    let expected_position = crate::reputation::expected_positions(game, final_standings)
        .get(user_team_id)
        .copied()
        .unwrap_or(index + 1);
    Some(SeasonReview {
        team_id: user_team_id.to_string(),
        expected_position: u32::try_from(expected_position).unwrap_or(u32::MAX),
        final_position: u32::try_from(index + 1).unwrap_or(u32::MAX),
        tier,
        club_reputation,
        league_matches_played: standing.won + standing.drawn + standing.lost,
    })
}

/// When the fixture just recorded was the final of a cup the user's club has
/// now won, keep the trophy as the user's honour for the season and in their
/// career record. Only club cups count: the league title is taken at season
/// end, and national-team tournaments are not the user's.
pub(crate) fn record_cup_won(game: &mut Game, fixture_index: usize) {
    let Some(user_team_id) = game.manager.team_id.clone() else {
        return;
    };
    let Some(cup) = game.league.as_ref() else {
        return;
    };
    let Some(fixture) = cup.fixtures.get(fixture_index) else {
        return;
    };
    let is_the_final = cup
        .knockout_rounds
        .last()
        .is_some_and(|round| round.fixture_ids.contains(&fixture.id));
    if !is_the_final || cup.knockout_champion() != Some(user_team_id.as_str()) {
        return;
    }
    let kind = match fixture.competition {
        FixtureCompetition::Cup => HonourKind::DomesticCup,
        FixtureCompetition::ContinentalClub => HonourKind::Continental,
        FixtureCompetition::InternationalClub => HonourKind::ClubWorld,
        _ => return,
    };
    let honour = Honour {
        competition_id: cup.id.clone(),
        kind,
        team_id: user_team_id,
    };
    game.manager.progression.season_honours.push(honour);
    game.manager.career_stats.trophies += 1;
    if game.account_id.is_some() {
        game.pending_coach_reports
            .push(crate::coach_progress::CoachRecord::Honour(kind));
    }
}

/// Review the user's season: move their reputation, log the change, start
/// the season's tallies again and tell the user.
pub(crate) fn review_user_season(
    game: &mut Game,
    season: u32,
    review: Option<&SeasonReview>,
    division_move: Option<DivisionMove>,
    date: &str,
) {
    let progression = &game.manager.progression;
    // Out of work, the season handed in is the fallback competition's, which
    // may run on another calendar; the user's own record carries on instead.
    let season = match (review, progression.reputation_log.last()) {
        (None, Some(last)) => last.season + 1,
        _ => season,
    };
    let change = season_change(
        season,
        game.manager.reputation,
        review,
        progression.season_league_matches_led,
        division_move,
        &progression.season_honours,
        progression.season_dismissal,
    );

    game.manager.reputation = change.after;
    let progression = &mut game.manager.progression;
    progression.reputation_log.push(change.clone());
    progression.season_honours.clear();
    progression.season_league_matches_led = 0;
    progression.season_dismissal = 0;
    game.sync_user_manager_record();

    let message_id = format!("manager_reputation_{season}");
    if !crate::inbox::already_emitted(game, &message_id) {
        crate::inbox::emit(game, review_message(message_id, &change, date));
    }
}

fn review_message(id: String, change: &ReputationChange, date: &str) -> InboxMessage {
    let led_part_of_the_season = change.league_matches_played > 0
        && change.league_matches_led < change.league_matches_played;
    let body_key = if led_part_of_the_season {
        "be.msg.managerReputation.bodyPartial"
    } else {
        "be.msg.managerReputation.body"
    };
    let delta = i64::from(change.after) - i64::from(change.before);
    let params: HashMap<String, String> = [
        ("season", change.season.to_string()),
        ("before", change.before.to_string()),
        ("after", change.after.to_string()),
        ("delta", signed(delta)),
        ("performance", signed(i64::from(change.performance))),
        ("honours", signed(i64::from(change.honours))),
        ("clubPull", signed(i64::from(change.club_pull))),
        ("led", change.league_matches_led.to_string()),
        ("played", change.league_matches_played.to_string()),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_string(), value))
    .collect();

    InboxMessage::new(
        id,
        String::new(),
        String::new(),
        String::new(),
        date.to_string(),
    )
    .with_category(MessageCategory::BoardDirective)
    .with_priority(MessagePriority::Normal)
    .with_sender_role("")
    .with_i18n("be.msg.managerReputation.subject", body_key, params)
    .with_sender_i18n("be.sender.boardOfDirectors", "be.role.chairman")
}

fn signed(value: i64) -> String {
    if value > 0 {
        format!("+{value}")
    } else {
        value.to_string()
    }
}

/// The share of the club's league season the user led, 0 when it has played none.
fn share_led(matches_led: u32, matches_played: u32) -> f64 {
    if matches_played == 0 {
        return 0.0;
    }
    (f64::from(matches_led) / f64::from(matches_played)).min(1.0)
}

fn trophy_worth(kind: HonourKind, tier: u32) -> i32 {
    match kind {
        HonourKind::League => rounded(LEAGUE_TITLE * tier_weight(tier)),
        HonourKind::DomesticCup => DOMESTIC_CUP,
        HonourKind::Continental => CONTINENTAL_CUP,
        HonourKind::ClubWorld => CLUB_WORLD_CUP,
    }
}

fn rounded(value: f64) -> i32 {
    value.round() as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn review(
        expected: u32,
        finished: u32,
        tier: u32,
        club_reputation: u32,
        played: u32,
    ) -> SeasonReview {
        SeasonReview {
            team_id: "club".to_string(),
            expected_position: expected,
            final_position: finished,
            tier,
            club_reputation,
            league_matches_played: played,
        }
    }

    fn honour(kind: HonourKind) -> Honour {
        Honour {
            competition_id: "comp".to_string(),
            kind,
            team_id: "club".to_string(),
        }
    }

    /// Given a second-tier club ranked 10th that finishes 4th under a manager
    /// at 500 who led every match,
    /// When the season is reviewed,
    /// Then six places at three quarters weight earn 45.
    #[test]
    fn finishing_above_expectation_in_the_second_tier_earns_three_quarters() {
        let review = review(10, 4, 1, 410, 46);

        let change = season_change(2026, 500, Some(&review), 46, None, &[], 0);

        assert_eq!(change.performance, 45);
        assert_eq!(change.after, 545);
        assert_eq!(change.team_id.as_deref(), Some("club"));
    }

    /// Given the same club finishing 2nd and going up,
    /// When the season is reviewed,
    /// Then eight places (60) and promotion (20) make 80.
    #[test]
    fn promotion_adds_to_the_finish() {
        let review = review(10, 2, 1, 410, 46);

        let change = season_change(
            2026,
            500,
            Some(&review),
            46,
            Some(DivisionMove::Promoted),
            &[],
            0,
        );

        assert_eq!(change.performance, 60);
        assert_eq!(change.honours, 20);
        assert_eq!(change.after, 580);
    }

    /// Given a top-flight club with reputation 760 ranked 8th that finishes
    /// 5th under a manager at 600,
    /// When the season is reviewed,
    /// Then the finish earns 30 and the club's bigger name pulls 40 more.
    #[test]
    fn a_bigger_club_pulls_the_manager_up() {
        let review = review(8, 5, 0, 760, 38);

        let change = season_change(2026, 600, Some(&review), 38, None, &[], 0);

        assert_eq!(change.performance, 30);
        assert_eq!(change.club_pull, 40);
        assert_eq!(change.after, 670);
    }

    /// Given a manager at 500 who wins the title at a club of 940, as expected,
    /// When the season is reviewed,
    /// Then 30 for the title and 110 of pull are capped at 120.
    #[test]
    fn a_season_gain_is_capped() {
        let review = review(1, 1, 0, 940, 38);

        let change = season_change(
            2026,
            500,
            Some(&review),
            38,
            None,
            &[honour(HonourKind::League)],
            0,
        );

        assert_eq!(change.honours, 30);
        assert_eq!(change.club_pull, 110);
        assert_eq!(change.after, 620);
    }

    /// Given a club of 600 ranked 10th that finishes 18th and goes down under
    /// a manager at 500,
    /// When the season is reviewed,
    /// Then −80 and −30 against 25 of pull leave −85.
    #[test]
    fn relegation_after_a_poor_season_costs_reputation() {
        let review = review(10, 18, 0, 600, 38);

        let change = season_change(
            2026,
            500,
            Some(&review),
            38,
            Some(DivisionMove::Relegated),
            &[],
            0,
        );

        assert_eq!(change.performance, -80);
        assert_eq!(change.honours, -30);
        assert_eq!(change.club_pull, 25);
        assert_eq!(change.after, 415);
    }

    /// Given a manager already at their club's reputation who finishes where
    /// the club was expected to,
    /// When the season is reviewed,
    /// Then nothing changes.
    #[test]
    fn meeting_expectation_at_ones_own_level_changes_nothing() {
        let review = review(6, 6, 0, 760, 38);

        let change = season_change(2026, 760, Some(&review), 38, None, &[], 0);

        assert_eq!(change.after, 760);
    }

    /// Given a manager who arrived in March and led 10 of the club's 38 league
    /// matches before it finished 18th (ranked 10th) and went down,
    /// When the season is reviewed,
    /// Then only their 10/38 share of the finish and of relegation counts,
    /// while the club's pull counts in full.
    #[test]
    fn a_mid_season_arrival_carries_only_their_share() {
        let review = review(10, 18, 0, 600, 38);

        let change = season_change(
            2026,
            500,
            Some(&review),
            10,
            Some(DivisionMove::Relegated),
            &[],
            0,
        );

        assert_eq!(change.performance, -21);
        assert_eq!(change.honours, -8);
        assert_eq!(change.club_pull, 25);
        assert_eq!(change.league_matches_led, 10);
        assert_eq!(change.league_matches_played, 38);
        assert_eq!(change.after, 496);
    }

    /// Given a manager out of work at the review who won a domestic cup
    /// earlier in the season,
    /// When the season is reviewed,
    /// Then the cup still counts, and nothing else does.
    #[test]
    fn a_manager_out_of_work_keeps_the_trophies_they_won() {
        let change = season_change(
            2026,
            460,
            None,
            0,
            None,
            &[honour(HonourKind::DomesticCup)],
            -40,
        );

        assert_eq!(change.honours, 20);
        assert_eq!(change.team_id, None);
        assert_eq!(change.dismissal, -40);
        assert_eq!(change.after, 480);
    }

    /// Given each kind of trophy,
    /// When a top-flight season is reviewed,
    /// Then each is worth its own amount.
    #[test]
    fn each_trophy_has_its_own_worth() {
        let review = review(5, 5, 0, 500, 38);
        let worth =
            |kind| season_change(2026, 500, Some(&review), 38, None, &[honour(kind)], 0).honours;

        assert_eq!(worth(HonourKind::League), 30);
        assert_eq!(worth(HonourKind::DomesticCup), 20);
        assert_eq!(worth(HonourKind::Continental), 50);
        assert_eq!(worth(HonourKind::ClubWorld), 30);
    }

    /// Given a third-tier club,
    /// When it finishes four places above expectation and wins the title,
    /// Then both count at half weight.
    #[test]
    fn the_third_tier_and_below_count_at_half() {
        let review = review(5, 1, 2, 300, 46);

        let change = season_change(
            2026,
            500,
            Some(&review),
            46,
            None,
            &[honour(HonourKind::League)],
            0,
        );

        assert_eq!(change.performance, 20);
        assert_eq!(change.honours, 15);
    }

    /// Given a catastrophic season,
    /// When it is reviewed,
    /// Then the loss stops at 100, and reputation never goes below zero.
    #[test]
    fn a_season_loss_is_capped_and_reputation_stays_above_zero() {
        let review = review(1, 20, 0, 300, 38);

        let heavy = season_change(
            2026,
            600,
            Some(&review),
            38,
            Some(DivisionMove::Relegated),
            &[],
            0,
        );
        let near_zero = season_change(
            2026,
            40,
            Some(&review),
            38,
            Some(DivisionMove::Relegated),
            &[],
            0,
        );

        assert_eq!(heavy.after, 500);
        assert_eq!(near_zero.after, 0);
    }

    /// Given a club that has played no league match yet,
    /// When the season is reviewed,
    /// Then its table counts for nothing rather than dividing by zero.
    #[test]
    fn a_club_with_no_league_matches_contributes_no_performance() {
        let review = review(10, 1, 0, 500, 0);

        let change = season_change(2026, 500, Some(&review), 0, None, &[], 0);

        assert_eq!(change.performance, 0);
    }
}
