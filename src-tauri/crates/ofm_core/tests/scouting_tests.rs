use chrono::{TimeZone, Utc};
use domain::manager::Manager;
use domain::message::*;
use domain::player::{Player, PlayerAttributes, Position};
use domain::staff::{Staff, StaffAttributes, StaffRole};
use domain::team::Team;
use ofm_core::clock::GameClock;
use ofm_core::game::{Game, YouthScoutingObjective, YouthScoutingRegion};
use ofm_core::scouting::{
    apply_youth_recruitment_response, process_scouting, scout_max_assignments, send_scout,
    start_youth_scouting,
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

fn default_attrs() -> PlayerAttributes {
    PlayerAttributes {
        pace: 70,
        stamina: 65,
        strength: 60,
        agility: 68,
        passing: 72,
        shooting: 66,
        tackling: 58,
        dribbling: 74,
        defending: 55,
        positioning: 62,
        vision: 70,
        decisions: 64,
        composure: 60,
        aggression: 50,
        teamwork: 66,
        leadership: 55,
        handling: 30,
        reflexes: 30,
        aerial: 58,
    }
}

fn make_player(id: &str, name: &str, team_id: &str) -> Player {
    let mut p = Player::new(
        id.to_string(),
        name.to_string(),
        name.to_string(),
        "1998-03-15".to_string(),
        "BR".to_string(),
        Position::Midfielder,
        default_attrs(),
    );
    p.team_id = Some(team_id.to_string());
    p.morale = 75;
    p.condition = 90;
    p
}

fn make_team(id: &str, name: &str) -> Team {
    Team::new(
        id.to_string(),
        name.to_string(),
        name[..3].to_string(),
        "England".to_string(),
        "London".to_string(),
        "Stadium".to_string(),
        40_000,
    )
}

fn make_scout(id: &str, team_id: &str, judging_ability: u8, judging_potential: u8) -> Staff {
    let mut s = Staff::new(
        id.to_string(),
        "Scout".to_string(),
        format!("Nr{}", id),
        "1985-01-01".to_string(),
        StaffRole::Scout,
        StaffAttributes {
            coaching: 30,
            judging_ability,
            judging_potential,
            physiotherapy: 20,
        },
    );
    s.team_id = Some(team_id.to_string());
    s
}

fn make_game() -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "mgr1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team1".to_string());

    let team1 = make_team("team1", "Test FC");
    let team2 = make_team("team2", "Rival FC");
    let players = vec![
        make_player("p1", "Own Player", "team1"),
        make_player("p2", "Target Player", "team2"),
        make_player("p3", "Another Target", "team2"),
    ];
    let scout = make_scout("scout1", "team1", 80, 75);

    let mut game = Game::new(
        clock,
        manager,
        vec![team1, team2],
        players,
        vec![scout],
        vec![],
    );
    stock_pool(&mut game, 5);
    game
}

const GROUPS: [Position; 4] = [
    Position::Goalkeeper,
    Position::Defender,
    Position::Midfielder,
    Position::Forward,
];

/// A youngster of the season's pool: unattached, in the academy age.
fn pool_kid(id: &str, position: Position, potential: u8) -> Player {
    let mut kid = make_player(id, id, "none");
    kid.team_id = None;
    kid.squad_role = domain::player::SquadRole::Youth;
    kid.position = position;
    kid.date_of_birth = "2008-01-01".to_string();
    kid.potential = potential;
    kid
}

/// The club's nation in the season's pool.
fn home(game: &Game) -> String {
    ofm_core::youth_pool::nation_of(&game.teams[0]).to_string()
}

/// A pool of `per_group` youngsters in every position group at home and in
/// Spain, and no AI club demand, so nobody signs from it but the player.
fn stock_pool(game: &mut Game, per_group: usize) {
    let mut pool = ofm_core::youth_pool::YouthPool {
        generated_on: "2025-06-15".to_string(),
        ends_on: "2026-06-14".to_string(),
        ..Default::default()
    };
    for (nation, tag) in [(home(game), "home"), ("Spain".to_string(), "abroad")] {
        let kids = GROUPS
            .iter()
            .flat_map(|group| {
                (0..per_group).map(move |n| {
                    pool_kid(&format!("{tag}-{group:?}-{n}"), group.clone(), 70 + n as u8)
                })
            })
            .collect();
        pool.nations.insert(nation, kids);
    }
    game.youth_pool = Some(pool);
}

fn in_pool(game: &Game, prospect_id: &str) -> bool {
    game.youth_pool.as_ref().is_some_and(|pool| {
        pool.nations
            .values()
            .flatten()
            .any(|kid| kid.id == prospect_id)
    })
}

fn search(game: &mut Game, region: YouthScoutingRegion, position: Option<Position>) {
    start_youth_scouting(
        game,
        "scout1",
        region,
        YouthScoutingObjective::Balanced,
        position,
    )
    .unwrap();
    complete_scouting(game);
}

// ---------------------------------------------------------------------------
// scout_max_assignments
// ---------------------------------------------------------------------------

#[test]
fn max_assignments_is_one_for_all_scouts() {
    assert_eq!(scout_max_assignments(90), 1);
    assert_eq!(scout_max_assignments(80), 1);
    assert_eq!(scout_max_assignments(79), 1);
    assert_eq!(scout_max_assignments(60), 1);
    assert_eq!(scout_max_assignments(59), 1);
    assert_eq!(scout_max_assignments(40), 1);
    assert_eq!(scout_max_assignments(39), 1);
    assert_eq!(scout_max_assignments(20), 1);
    assert_eq!(scout_max_assignments(19), 1);
    assert_eq!(scout_max_assignments(0), 1);
}

// ---------------------------------------------------------------------------
// send_scout
// ---------------------------------------------------------------------------

#[test]
fn send_scout_creates_assignment() {
    let mut game = make_game();
    let result = send_scout(&mut game, "scout1", "p2");
    assert!(result.is_ok());
    assert_eq!(game.scouting_assignments.len(), 1);
    assert_eq!(game.scouting_assignments[0].player_id, "p2");
    assert_eq!(game.scouting_assignments[0].scout_id, "scout1");
}

#[test]
fn send_scout_rejects_own_player() {
    let mut game = make_game();
    let result = send_scout(&mut game, "scout1", "p1");
    assert!(result.is_err());
    assert_eq!(
        result.unwrap_err(),
        "be.error.scouting.cannotScoutOwnPlayer"
    );
}

#[test]
fn send_scout_rejects_unknown_player() {
    let mut game = make_game();
    let result = send_scout(&mut game, "scout1", "nonexistent");
    assert_eq!(result.unwrap_err(), "be.error.playerNotFound");
}

#[test]
fn send_scout_rejects_duplicate_assignment() {
    let mut game = make_game();
    send_scout(&mut game, "scout1", "p2").unwrap();
    game.staff.push(make_scout("scout2", "team1", 70, 70));
    let result = send_scout(&mut game, "scout2", "p2");
    assert_eq!(
        result.unwrap_err(),
        "be.error.scouting.playerAlreadyScouted"
    );
}

#[test]
fn send_scout_rejects_non_scout_staff() {
    let mut game = make_game();
    // Replace scout with a coach
    game.staff[0].role = StaffRole::Coach;
    let result = send_scout(&mut game, "scout1", "p2");
    assert_eq!(result.unwrap_err(), "be.error.scouting.staffMemberNotScout");
}

#[test]
fn start_youth_scouting_creates_assignment() {
    let mut game = make_game();

    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Defender),
    )
    .unwrap();

    assert_eq!(game.youth_scouting_assignments.len(), 1);
    assert_eq!(game.youth_scouting_assignments[0].scout_id, "scout1");
    assert_eq!(
        game.youth_scouting_assignments[0].region,
        YouthScoutingRegion::Domestic
    );
    assert_eq!(
        game.youth_scouting_assignments[0].objective,
        YouthScoutingObjective::Balanced
    );
    assert_eq!(
        game.youth_scouting_assignments[0].target_position,
        Some(Position::Defender)
    );
}

#[test]
fn start_youth_scouting_respects_shared_scout_capacity() {
    let mut game = make_game();
    send_scout(&mut game, "scout1", "p2").unwrap();
    let result = start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Forward),
    );

    assert_eq!(
        result.unwrap_err(),
        "be.error.scouting.scoutAssignmentFull?currentCount=1&maxSlots=1"
    );
}

#[test]
fn send_scout_rejects_when_scout_has_youth_assignment() {
    let mut game = make_game();
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Forward),
    )
    .unwrap();

    let result = send_scout(&mut game, "scout1", "p2");

    assert_eq!(
        result.unwrap_err(),
        "be.error.scouting.scoutAssignmentFull?currentCount=1&maxSlots=1"
    );
}

#[test]
fn start_youth_scouting_rejects_duplicate_search_profile() {
    let mut game = make_game();
    game.staff.push(make_scout("scout2", "team1", 70, 70));

    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Defender),
    )
    .unwrap();

    let result = start_youth_scouting(
        &mut game,
        "scout2",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Defender),
    );

    assert_eq!(
        result.unwrap_err(),
        "be.error.scouting.youthSearchAlreadyActive"
    );
}

// ---------------------------------------------------------------------------
// process_scouting — report generation
// ---------------------------------------------------------------------------

fn complete_scouting(game: &mut Game) {
    // Advance enough days for the assignment to complete
    for _ in 0..10 {
        process_scouting(game);
        game.clock.advance_days(1);
    }
}

#[test]
fn process_scouting_generates_report_message() {
    let mut game = make_game();
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let scout_msgs: Vec<&InboxMessage> = game
        .messages
        .iter()
        .filter(|m| m.category == MessageCategory::ScoutReport)
        .collect();
    assert_eq!(
        scout_msgs.len(),
        1,
        "Should produce exactly one scout report"
    );
}

#[test]
fn report_has_scout_report_data() {
    let mut game = make_game();
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let msg = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .expect("Should have a scout report");

    let report = msg
        .context
        .scout_report
        .as_ref()
        .expect("Should have scout_report data in context");

    assert_eq!(report.player_id, "p2");
    assert_eq!(report.player_name, "Target Player");
    assert_eq!(report.nationality, "BR");
    assert!(report.team_name.is_some(), "Should have team name");
    assert_eq!(report.team_name.as_deref(), Some("Rival FC"));
}

fn youth_report(game: &Game) -> &domain::message::InboxMessage {
    game.messages
        .iter()
        .find(|message| {
            message.subject_key.as_deref() == Some("be.msg.youthRecruitmentReport.subject")
        })
        .expect("expected a youth recruitment report")
}

fn run_youth_search(judging_ability: u8, judging_potential: u8) -> Game {
    let mut game = make_game();
    game.staff[0].attributes.judging_ability = judging_ability;
    game.staff[0].attributes.judging_potential = judging_potential;
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        None,
    )
    .unwrap();
    complete_scouting(&mut game);
    game
}

/// Given youth searches by scouts good and poor,
/// When their reports arrive,
/// Then every prospect carries the scout's ranges, and each true overall and
/// potential lies inside its range.
#[test]
fn a_youth_report_carries_ranges_that_hold_the_truth() {
    for (ability, potential) in [(90, 90), (50, 50), (10, 10)] {
        let game = run_youth_search(ability, potential);
        let context = &youth_report(&game).context;
        let prospects = context.youth_prospects.as_ref().expect("prospects");

        assert_eq!(context.youth_prospect_estimates.len(), prospects.len());
        for prospect in prospects {
            let estimate = context
                .youth_prospect_estimates
                .iter()
                .find(|estimate| estimate.prospect_id == prospect.id)
                .expect("an estimate for every prospect");
            assert!((estimate.ovr_low..=estimate.ovr_high).contains(&prospect.ovr));
            assert!(
                (estimate.potential_low..=estimate.potential_high).contains(&prospect.potential)
            );
        }
    }
}

/// Given a scout who judges well and one who judges poorly,
/// When their reports arrive,
/// Then the good scout's ranges are ±2 and the poor scout's ±12.
#[test]
fn a_better_scout_reports_narrower_ranges() {
    for (rating, band) in [(90, 2), (20, 12)] {
        let game = run_youth_search(rating, rating);
        let estimates = &youth_report(&game).context.youth_prospect_estimates;
        assert!(!estimates.is_empty());
        for estimate in estimates {
            assert_eq!((estimate.ovr_band, estimate.potential_band), (band, band));
        }
    }
}

// ---------------------------------------------------------------------------
// Youth search fee and the scout's rest
// ---------------------------------------------------------------------------

fn start_search(
    game: &mut Game,
    region: YouthScoutingRegion,
    objective: YouthScoutingObjective,
) -> Result<(), String> {
    start_youth_scouting(game, "scout1", region, objective, None)
}

/// Given each region and objective,
/// When a youth search starts,
/// Then the club pays its fee at once: 15,000 at home, 50,000 abroad, half as
/// much again for a high-potential search.
#[test]
fn a_youth_search_charges_its_fee_when_it_starts() {
    use YouthScoutingObjective::*;
    use YouthScoutingRegion::*;
    for (region, objective, fee) in [
        (Domestic, Balanced, 15_000),
        (Domestic, HighPotential, 22_500),
        (International, ReadySoon, 50_000),
        (International, HighPotential, 75_000),
    ] {
        let mut game = make_game();
        let cash = game.teams[0].finance;

        start_search(&mut game, region, objective).expect("search starts");

        assert_eq!(
            game.teams[0].finance,
            cash - fee,
            "{region:?} {objective:?}"
        );
        assert!(game.cash_journal.iter().any(|post| {
            post.kind == ofm_core::finances::CashKind::ScoutingExpenses && post.amount == -fee
        }));
    }
}

/// Given a club that cannot cover the fee,
/// When it tries to start a youth search,
/// Then it is refused, and neither the search nor any payment is made.
#[test]
fn a_club_that_cannot_pay_the_fee_cannot_search() {
    let mut game = make_game();
    game.teams[0].finance = 10_000;

    let result = start_search(
        &mut game,
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
    );

    assert_eq!(
        result,
        Err("be.error.scouting.insufficientFunds?fee=15000".to_string())
    );
    assert!(game.youth_scouting_assignments.is_empty());
    assert_eq!(game.teams[0].finance, 10_000);
}

/// Given a scout who has just finished a youth search,
/// When he is sent on another,
/// Then he is refused for seven days, told how many are left, and goes again
/// once they have passed.
#[test]
fn a_scout_rests_seven_days_after_a_youth_search() {
    let mut game = make_game();
    start_search(
        &mut game,
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
    )
    .unwrap();
    // The fixture's scout judges potential at 75, so a domestic balanced search
    // takes 5 days; process the day it finishes and stop there.
    for _ in 0..5 {
        game.clock.advance_days(1);
        process_scouting(&mut game);
    }
    assert!(game.youth_scouting_assignments.is_empty());

    let refused = start_search(
        &mut game,
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
    );
    assert_eq!(
        refused,
        Err("be.error.scouting.scoutResting?days=7".to_string())
    );

    game.clock.advance_days(6);
    let still_resting = start_search(
        &mut game,
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
    );
    assert_eq!(
        still_resting,
        Err("be.error.scouting.scoutResting?days=1".to_string())
    );

    game.clock.advance_days(1);
    start_search(
        &mut game,
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
    )
    .expect("rested");
}

/// Given a youth search the club has paid for,
/// When it is cancelled,
/// Then the fee is not returned.
#[test]
fn a_cancelled_youth_search_keeps_its_fee() {
    let mut game = make_game();
    let cash = game.teams[0].finance;
    start_search(
        &mut game,
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
    )
    .unwrap();
    let assignment_id = game.youth_scouting_assignments[0].id.clone();

    ofm_core::scouting::cancel_youth_scouting(&mut game, &assignment_id).unwrap();

    assert_eq!(game.teams[0].finance, cash - 15_000);
}

/// Given the fixture's scout, who judges potential at 75,
/// When a high-potential search abroad is quoted,
/// Then the quote gives its fee, how many days it takes and that he is free.
#[test]
fn a_youth_search_quote_gives_fee_days_and_rest() {
    let game = make_game();

    let quote = ofm_core::scouting::quote_youth_search(
        &game,
        "scout1",
        YouthScoutingRegion::International,
        YouthScoutingObjective::HighPotential,
    )
    .expect("quote");

    assert_eq!(quote.fee, 75_000);
    assert_eq!(quote.days, 7);
    assert_eq!(quote.rest_days_left, 0);
}

// ---------------------------------------------------------------------------
// Searching the season's pool
// ---------------------------------------------------------------------------

/// Given a pool at home and abroad,
/// When the scout searches at home,
/// Then everyone he reports is one of the home pool's youngsters.
#[test]
fn a_domestic_search_reports_youngsters_of_the_home_pool() {
    let mut game = make_game();
    search(&mut game, YouthScoutingRegion::Domestic, None);

    let prospects = youth_report(&game).context.youth_prospects.clone().unwrap();
    assert_eq!(prospects.len(), 3);
    assert!(prospects.iter().all(|kid| kid.id.starts_with("home-")));
}

/// Given a youth search,
/// When its report arrives,
/// Then each prospect comes with the player card his estimate gives: the
/// middle of each range, and no attribute read yet.
#[test]
fn a_youth_report_carries_a_player_card_for_each_prospect() {
    let mut game = make_game();
    search(&mut game, YouthScoutingRegion::Domestic, None);

    let context = &youth_report(&game).context;
    let prospects = context.youth_prospects.as_ref().unwrap();
    assert_eq!(context.youth_prospect_reports.len(), prospects.len());
    for (card, estimate) in context
        .youth_prospect_reports
        .iter()
        .zip(&context.youth_prospect_estimates)
    {
        assert_eq!(card.player_id, estimate.prospect_id);
        let rating = card.avg_rating.unwrap() as u8;
        assert!((estimate.ovr_low..=estimate.ovr_high).contains(&rating));
        assert_eq!(card.pace, None);
    }
}

/// Given a pool at home and abroad,
/// When the scout searches abroad,
/// Then he never reports a youngster of the home pool.
#[test]
fn an_international_search_looks_only_abroad() {
    let mut game = make_game();
    search(&mut game, YouthScoutingRegion::International, None);

    let prospects = youth_report(&game).context.youth_prospects.clone().unwrap();
    assert!(!prospects.is_empty());
    assert!(prospects.iter().all(|kid| kid.id.starts_with("abroad-")));
}

/// Given a home pool with two defenders left,
/// When the scout searches for defenders,
/// Then he reports those two and no more.
#[test]
fn a_search_reports_no_more_than_the_pool_holds() {
    let mut game = make_game();
    stock_pool(&mut game, 2);
    search(
        &mut game,
        YouthScoutingRegion::Domestic,
        Some(Position::Defender),
    );

    let report = youth_report(&game);
    assert_eq!(report.context.youth_prospects.as_ref().unwrap().len(), 2);
    assert_eq!(report.actions.len(), 2);
}

/// Given a pool with nobody left,
/// When a search completes,
/// Then the report says so and offers nothing, and the fee stays spent and the
/// scout rests all the same.
#[test]
fn an_empty_pool_gives_an_empty_report() {
    let mut game = make_game();
    stock_pool(&mut game, 0);
    let cash = game.teams[0].finance;
    search(&mut game, YouthScoutingRegion::Domestic, None);

    let report = youth_report(&game);
    assert_eq!(
        report.body_key.as_deref(),
        Some("be.msg.youthRecruitmentReport.bodyEmpty")
    );
    assert!(report.actions.is_empty());
    assert!(game.teams[0].finance < cash);
    assert!(game.scout_youth_rest_until.contains_key("scout1"));
}

/// Given a report, and an AI club that has since signed one of its prospects,
/// When the manager tries to sign him,
/// Then he is told where the youngster went, and nobody joins.
#[test]
fn a_prospect_an_ai_club_signed_cannot_be_signed_from_the_report() {
    let mut game = make_game();
    search(&mut game, YouthScoutingRegion::Domestic, None);
    let message = youth_report(&game).clone();
    let action_id = message.actions[0].id.clone();
    let prospect_id = action_id.trim_start_matches("prospect:").to_string();
    // The AI club takes him from the pool.
    let pool = game.youth_pool.as_mut().unwrap();
    let mut taken = None;
    for kids in pool.nations.values_mut() {
        if let Some(index) = kids.iter().position(|kid| kid.id == prospect_id) {
            taken = Some(kids.remove(index));
        }
    }
    let mut taken = taken.unwrap();
    taken.team_id = Some("team2".to_string());
    game.players.push(taken);

    for option in ["sign", "watch"] {
        let effect = apply_youth_recruitment_response(&mut game, &message.id, &action_id, option)
            .expect("an effect explaining why");
        assert_eq!(effect.i18n_key, "be.msg.youthRecruitment.effect.joinedClub");
        assert_eq!(
            effect.i18n_params.get("team").map(String::as_str),
            Some("Rival FC")
        );
    }
    let signed = game.players.iter().find(|p| p.id == prospect_id).unwrap();
    assert_eq!(signed.team_id.as_deref(), Some("team2"));
    assert!(game.youth_watchlist.is_empty());
}

/// Given a report whose prospect has left the market,
/// When the manager tries to sign him,
/// Then he is told the youngster is gone.
#[test]
fn a_prospect_who_left_the_market_cannot_be_signed() {
    let mut game = make_game();
    search(&mut game, YouthScoutingRegion::Domestic, None);
    let message = youth_report(&game).clone();
    let action_id = message.actions[0].id.clone();
    stock_pool(&mut game, 0);

    let effect = apply_youth_recruitment_response(&mut game, &message.id, &action_id, "sign")
        .expect("an effect explaining why");

    assert_eq!(effect.i18n_key, "be.msg.youthRecruitment.effect.offMarket");
}

/// Given a report,
/// When the manager signs one prospect and discards another,
/// Then the signed one leaves the pool and the discarded one stays in it.
#[test]
fn signing_takes_a_youngster_from_the_pool_and_discarding_does_not() {
    let mut game = make_game();
    search(&mut game, YouthScoutingRegion::Domestic, None);
    let message = youth_report(&game).clone();
    let signed_id = message.actions[0]
        .id
        .trim_start_matches("prospect:")
        .to_string();
    let discarded_id = message.actions[1]
        .id
        .trim_start_matches("prospect:")
        .to_string();

    apply_youth_recruitment_response(&mut game, &message.id, &message.actions[0].id, "sign")
        .unwrap();
    apply_youth_recruitment_response(&mut game, &message.id, &message.actions[1].id, "discard")
        .unwrap();

    assert!(!in_pool(&game, &signed_id));
    assert!(in_pool(&game, &discarded_id));
}

#[test]
fn process_scouting_completes_youth_recruitment_report() {
    let mut game = make_game();
    let initial_player_count = game.players.len();

    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Defender),
    )
    .unwrap();
    complete_scouting(&mut game);

    assert_eq!(game.players.len(), initial_player_count);
    assert!(game.youth_scouting_assignments.is_empty());

    let msg = game
        .messages
        .iter()
        .find(|message| {
            message.subject_key.as_deref() == Some("be.msg.youthRecruitmentReport.subject")
        })
        .expect("expected a youth recruitment report");
    assert_eq!(msg.category, MessageCategory::ScoutReport);
    assert_eq!(
        msg.subject_key.as_deref(),
        Some("be.msg.youthRecruitmentReport.subject")
    );
    assert!(matches!(
        msg.body_key.as_deref(),
        Some("be.msg.youthRecruitmentReport.bodyTargeted")
    ));
    assert!(msg.context.player_id.is_none());
    assert_eq!(
        msg.context.youth_target_position.as_deref(),
        Some("Defender")
    );
    assert_eq!(msg.context.youth_search_region.as_deref(), Some("Domestic"));
    assert_eq!(
        msg.context.youth_search_objective.as_deref(),
        Some("Balanced")
    );
    assert_eq!(msg.sender_role_key.as_deref(), Some("be.role.scout"));
    assert_eq!(
        msg.i18n_params.get("regionLabel"),
        Some(&"scouting.regionDomestic".to_string())
    );
    assert_eq!(
        msg.i18n_params.get("objectiveLabel"),
        Some(&"scouting.objectiveBalanced".to_string())
    );
    let prospects = msg
        .context
        .youth_prospects
        .as_ref()
        .expect("expected youth prospects in message context");
    assert_eq!(prospects.len(), 3);
    assert!(prospects.iter().all(|prospect| prospect.team_id.is_none()));
    assert!(
        prospects
            .iter()
            .all(|prospect| prospect.position.to_group_position() == Position::Defender)
    );
    assert_eq!(msg.actions.len(), 3);
    assert!(
        msg.actions
            .iter()
            .all(|action| matches!(action.action_type, ActionType::ChooseOption { .. }))
    );
}

#[test]
fn youth_recruitment_response_signs_selected_prospect() {
    let mut game = make_game();
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Defender),
    )
    .unwrap();
    complete_scouting(&mut game);

    let message = game
        .messages
        .iter()
        .find(|candidate| {
            candidate.subject_key.as_deref() == Some("be.msg.youthRecruitmentReport.subject")
        })
        .expect("expected youth recruitment report")
        .clone();
    let action_id = message.actions[0].id.clone();
    let prospect_id = action_id.trim_start_matches("prospect:").to_string();

    let effect = apply_youth_recruitment_response(&mut game, &message.id, &action_id, "sign")
        .expect("expected sign effect");

    assert_eq!(effect.message, "");
    assert_eq!(effect.i18n_key, "be.msg.youthRecruitment.effect.sign");
    let signed_player = game
        .players
        .iter()
        .find(|player| player.id == prospect_id)
        .expect("expected signed player in game state");
    assert_eq!(signed_player.team_id.as_deref(), Some("team1"));
    assert_eq!(signed_player.squad_role, domain::player::SquadRole::Youth);
    let updated_message = game
        .messages
        .iter()
        .find(|candidate| candidate.id == message.id)
        .expect("expected updated report message");
    assert!(updated_message.actions[0].resolved);
    assert!(!updated_message.actions[1].resolved);
    let updated_prospects = updated_message
        .context
        .youth_prospects
        .as_ref()
        .expect("expected remaining prospects in report");
    let signed_prospect = updated_prospects
        .iter()
        .find(|player| player.id == prospect_id)
        .expect("expected signed prospect to remain visible");
    assert_eq!(signed_prospect.team_id.as_deref(), Some("team1"));
}

/// Given a club whose board will not add a single euro to its wage bill,
/// When the manager signs a scouted prospect,
/// Then the board refuses: he is not signed and the choice stays open.
#[test]
fn signing_a_scouted_prospect_needs_the_boards_wage_approval() {
    let mut game = make_game();
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        None,
    )
    .unwrap();
    complete_scouting(&mut game);
    game.teams[0].wage_budget = 0;
    let message = youth_report(&game).clone();
    let action_id = message.actions[0].id.clone();
    let prospect_id = action_id.trim_start_matches("prospect:").to_string();

    let effect = apply_youth_recruitment_response(&mut game, &message.id, &action_id, "sign")
        .expect("an effect explaining the refusal");

    assert_eq!(effect.i18n_key, "be.msg.youthRecruitment.effect.wagePolicy");
    assert!(!game.players.iter().any(|player| player.id == prospect_id));
    assert!(!youth_report(&game).actions[0].resolved);
    assert!(in_pool(&game, &prospect_id));
}

/// Given a youth report,
/// When the manager watches one of its prospects,
/// Then he goes on the watchlist with the report's ranges and no scout, and
/// stays in the report with his choice made.
#[test]
fn youth_recruitment_response_watches_selected_prospect() {
    let mut game = make_game();
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Defender),
    )
    .unwrap();
    complete_scouting(&mut game);
    let message = youth_report(&game).clone();
    let action_id = message.actions[1].id.clone();
    let prospect_id = action_id.trim_start_matches("prospect:").to_string();

    let effect = apply_youth_recruitment_response(&mut game, &message.id, &action_id, "watch")
        .expect("expected watch effect");

    assert_eq!(effect.i18n_key, "be.msg.youthRecruitment.effect.watch");
    let watched = game
        .youth_watchlist
        .iter()
        .find(|entry| entry.prospect.id == prospect_id)
        .expect("on the watchlist");
    assert!(watched.scout_id.is_none());
    let report_estimate = message
        .context
        .youth_prospect_estimates
        .iter()
        .find(|estimate| estimate.prospect_id == prospect_id)
        .unwrap();
    assert_eq!(&watched.estimate, report_estimate);
    let updated = youth_report(&game);
    assert!(updated.actions[1].resolved);
    assert_eq!(updated.context.youth_prospects.as_ref().unwrap().len(), 3);
    assert!(
        message.actions[1]
            .action_type
            .clone()
            .eq_options(&["sign", "watch", "discard"])
    );
}

/// Given a prospect on the watchlist and his scout's weekly report,
/// When the manager signs him from the report,
/// Then he joins the academy and leaves the watchlist.
#[test]
fn signing_from_a_report_takes_a_prospect_off_the_watchlist() {
    let mut game = make_game();
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        None,
    )
    .unwrap();
    complete_scouting(&mut game);
    let message = youth_report(&game).clone();
    let action_id = message.actions[0].id.clone();
    apply_youth_recruitment_response(&mut game, &message.id, &action_id, "watch").unwrap();
    assert_eq!(game.youth_watchlist.len(), 1);
    let message = youth_report(&game).clone();

    apply_youth_recruitment_response(&mut game, &message.id, &action_id, "sign").unwrap();

    assert!(game.youth_watchlist.is_empty());
}

trait OptionIds {
    fn eq_options(self, ids: &[&str]) -> bool;
}

impl OptionIds for ActionType {
    fn eq_options(self, ids: &[&str]) -> bool {
        match self {
            ActionType::ChooseOption { options } => {
                options
                    .iter()
                    .map(|option| option.id.as_str())
                    .collect::<Vec<_>>()
                    == ids
            }
            _ => false,
        }
    }
}

#[test]
fn youth_recruitment_response_discard_removes_only_selected_prospect() {
    let mut game = make_game();
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::ReadySoon,
        Some(Position::Midfielder),
    )
    .unwrap();
    complete_scouting(&mut game);

    let message = game
        .messages
        .iter()
        .find(|candidate| {
            candidate.subject_key.as_deref() == Some("be.msg.youthRecruitmentReport.subject")
        })
        .expect("expected youth recruitment report")
        .clone();
    let action_id = message.actions[0].id.clone();

    apply_youth_recruitment_response(&mut game, &message.id, &action_id, "discard")
        .expect("expected discard effect");

    let updated_message = game
        .messages
        .iter()
        .find(|candidate| candidate.id == message.id)
        .expect("expected updated report message");
    assert_eq!(updated_message.actions.len(), 2);
    assert_eq!(
        updated_message
            .context
            .youth_prospects
            .as_ref()
            .expect("expected remaining prospects")
            .len(),
        2
    );
}

#[test]
fn report_has_i18n_keys() {
    let mut game = make_game();
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let msg = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .unwrap();

    assert!(msg.subject_key.is_some());
    assert!(msg.body_key.is_some());
    assert!(msg.sender_key.is_some());
    assert!(msg.sender_role_key.is_some());

    let report = msg.context.scout_report.as_ref().unwrap();
    assert!(
        report.rating_key.starts_with("common.scoutRatings."),
        "rating_key should be an i18n key: {}",
        report.rating_key
    );
    assert!(
        report.potential_key.starts_with("common.scoutPotential."),
        "potential_key should be an i18n key: {}",
        report.potential_key
    );
    assert!(
        report.confidence_key.starts_with("common.scoutConfidence."),
        "confidence_key should be an i18n key: {}",
        report.confidence_key
    );
}

// ---------------------------------------------------------------------------
// Discovery mechanic — attribute reveal count
// ---------------------------------------------------------------------------

fn count_revealed(report: &ScoutReportData) -> usize {
    [
        report.pace,
        report.shooting,
        report.passing,
        report.dribbling,
        report.defending,
        report.physical,
    ]
    .iter()
    .filter(|a| a.is_some())
    .count()
}

#[test]
fn high_ability_scout_reveals_all_attrs() {
    let mut game = make_game();
    // Scout already has judging_ability = 80
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let report = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .unwrap()
        .context
        .scout_report
        .as_ref()
        .unwrap();

    assert_eq!(
        count_revealed(report),
        6,
        "High ability scout should reveal all 6 attrs"
    );
    assert!(
        report.condition.is_some(),
        "High ability should reveal condition"
    );
    assert!(report.morale.is_some(), "High ability should reveal morale");
    assert_eq!(report.confidence_key, "common.scoutConfidence.high");
}

#[test]
fn medium_ability_scout_reveals_5_attrs() {
    let mut game = make_game();
    game.staff[0].attributes.judging_ability = 65;
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let report = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .unwrap()
        .context
        .scout_report
        .as_ref()
        .unwrap();

    assert_eq!(
        count_revealed(report),
        5,
        "Medium ability scout should reveal 5 attrs"
    );
    assert!(
        report.condition.is_some(),
        "Medium ability should reveal condition"
    );
    assert!(
        report.morale.is_none(),
        "Medium ability should NOT reveal morale"
    );
    assert_eq!(report.confidence_key, "common.scoutConfidence.moderate");
}

#[test]
fn low_ability_scout_reveals_3_attrs() {
    let mut game = make_game();
    game.staff[0].attributes.judging_ability = 45;
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let report = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .unwrap()
        .context
        .scout_report
        .as_ref()
        .unwrap();

    assert_eq!(
        count_revealed(report),
        3,
        "Low ability scout should reveal 3 attrs"
    );
    assert!(
        report.condition.is_none(),
        "Low ability should NOT reveal condition"
    );
    assert!(
        report.morale.is_none(),
        "Low ability should NOT reveal morale"
    );
    assert_eq!(report.confidence_key, "common.scoutConfidence.low");
}

#[test]
fn very_low_ability_scout_reveals_2_attrs() {
    let mut game = make_game();
    game.staff[0].attributes.judging_ability = 25;
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let report = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .unwrap()
        .context
        .scout_report
        .as_ref()
        .unwrap();

    assert_eq!(
        count_revealed(report),
        2,
        "Very low ability scout should reveal 2 attrs"
    );
    assert_eq!(report.confidence_key, "common.scoutConfidence.low");
}

// ---------------------------------------------------------------------------
// Fuzzed attribute accuracy
// ---------------------------------------------------------------------------

#[test]
fn high_ability_scout_attrs_are_close_to_real() {
    // With judging_ability 80+, noise range is ±2
    // Run multiple times to check range statistically
    for _ in 0..10 {
        let mut game = make_game();
        send_scout(&mut game, "scout1", "p2").unwrap();
        complete_scouting(&mut game);

        let report = game
            .messages
            .iter()
            .find(|m| m.category == MessageCategory::ScoutReport)
            .unwrap()
            .context
            .scout_report
            .as_ref()
            .unwrap();

        // Real pace is 70, with noise ±2 → should be in [68, 72]
        if let Some(pace) = report.pace {
            assert!(
                (65..=75).contains(&pace),
                "High-ability fuzzed pace {} should be close to real value 70",
                pace
            );
        }
    }
}

#[test]
fn low_ability_scout_attrs_have_more_noise() {
    // With judging_ability 25, noise range is ±12
    let mut game = make_game();
    game.staff[0].attributes.judging_ability = 25;
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let report = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .unwrap()
        .context
        .scout_report
        .as_ref()
        .unwrap();

    // Just verify values are in valid range (1-99)
    for v in [
        report.pace,
        report.shooting,
        report.passing,
        report.dribbling,
        report.defending,
        report.physical,
    ]
    .into_iter()
    .flatten()
    {
        assert!(
            (1..=99).contains(&v),
            "Fuzzed value {} should be in [1, 99]",
            v
        );
    }
}

// ---------------------------------------------------------------------------
// Potential assessment depends on judging_potential
// ---------------------------------------------------------------------------

#[test]
fn high_judging_potential_gives_specific_assessment() {
    let mut game = make_game();
    game.staff[0].attributes.judging_potential = 75;
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let report = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .unwrap()
        .context
        .scout_report
        .as_ref()
        .unwrap();

    // With high judging_potential (>=70), should get a specific potential key
    assert!(
        report.potential_key != "common.scoutPotential.unclear",
        "High judging_potential should give a specific assessment, got: {}",
        report.potential_key
    );
}

#[test]
fn low_judging_potential_gives_unclear_assessment() {
    let mut game = make_game();
    game.staff[0].attributes.judging_potential = 40;
    send_scout(&mut game, "scout1", "p2").unwrap();
    complete_scouting(&mut game);

    let report = game
        .messages
        .iter()
        .find(|m| m.category == MessageCategory::ScoutReport)
        .unwrap()
        .context
        .scout_report
        .as_ref()
        .unwrap();

    assert_eq!(
        report.potential_key, "common.scoutPotential.unclear",
        "Low judging_potential should give unclear assessment"
    );
}

// ---------------------------------------------------------------------------
// Assignment removal after completion
// ---------------------------------------------------------------------------

#[test]
fn completed_assignment_is_removed() {
    let mut game = make_game();
    send_scout(&mut game, "scout1", "p2").unwrap();
    assert_eq!(game.scouting_assignments.len(), 1);
    complete_scouting(&mut game);
    assert_eq!(
        game.scouting_assignments.len(),
        0,
        "Completed assignments should be removed"
    );
}

/// Signing a scouted youth is a contract made in the middle of a career. It has to
/// be in his history like any other signing, or he carries a wage and an end date
/// that nothing in his ledger explains.
#[test]
fn signing_a_scouted_youth_records_a_free_agent_contract() {
    let mut game = make_game();
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::Balanced,
        Some(Position::Defender),
    )
    .unwrap();
    complete_scouting(&mut game);
    let message = game
        .messages
        .iter()
        .find(|candidate| {
            candidate.subject_key.as_deref() == Some("be.msg.youthRecruitmentReport.subject")
        })
        .expect("expected youth recruitment report")
        .clone();
    let action_id = message.actions[0].id.clone();
    let prospect_id = action_id.trim_start_matches("prospect:").to_string();
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();

    apply_youth_recruitment_response(&mut game, &message.id, &action_id, "sign")
        .expect("expected sign effect");

    let signed = game
        .players
        .iter()
        .find(|player| player.id == prospect_id)
        .expect("expected signed player in game state");
    let entry = signed
        .movement_history
        .last()
        .expect("the signing is in his history");
    assert_eq!(
        entry.kind,
        domain::player::PlayerMovementKind::FreeAgentSigning
    );
    assert_eq!(entry.to_team_id.as_deref(), Some("team1"));
    let record = entry
        .contract
        .as_ref()
        .expect("the entry carries the contract");
    assert_eq!(
        record.source,
        domain::contract_ledger::ContractSource::FreeAgent
    );
    assert_eq!(record.start.as_deref(), Some(today.as_str()));
    assert!(
        record
            .end
            .as_deref()
            .is_some_and(|end| end > today.as_str()),
        "a youth contract ends after it starts: {:?}",
        record.end
    );
    assert!(record.weekly_wage > 0);
    assert_eq!(signed.wage(), record.weekly_wage);
    assert_eq!(signed.contract_start(), Some(today.as_str()));
}
