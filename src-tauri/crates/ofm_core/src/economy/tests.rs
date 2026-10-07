use super::*;
use crate::clock::GameClock;
use chrono::{TimeZone, Utc};
use domain::manager::Manager;
use domain::player::{Player, Position};
use domain::team::Team;

fn club(id: &str, reputation: u32) -> Team {
    let mut team = Team::new(
        id.to_string(),
        format!("{id} FC"),
        id.to_uppercase(),
        "ENG".to_string(),
        "City".to_string(),
        "Ground".to_string(),
        50_000,
    );
    team.reputation = reputation;
    team.finance = 1_000_000;
    team
}

fn signed_player(id: &str, team_id: &str, ovr: u8, wage: u32) -> Player {
    let mut player = Player::new(
        id.to_string(),
        id.to_string(),
        format!("Player {id}"),
        "2000-01-01".to_string(),
        "England".to_string(),
        Position::CentralMidfielder,
        crate::test_support::uniform_attributes(ovr),
    );
    player.natural_position = Position::CentralMidfielder;
    player.ovr = ovr;
    player.potential = ovr;
    player.team_id = Some(team_id.to_string());
    player.market_value = 1_000_000;
    player.stage_contract_end(Some("2029-06-30".to_string()));
    player.stage_wage(wage);
    player
}

/// A Monday, so the weekly refresh runs.
fn game_on_monday(teams: Vec<Team>, players: Vec<Player>) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 3, 0, 0, 0).unwrap());
    let manager = Manager::new(
        "mgr".to_string(),
        "Alex".to_string(),
        "Boss".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    Game::new(clock, manager, teams, players, vec![], vec![])
}

fn squad(team_id: &str, size: usize, ovr: u8) -> Vec<Player> {
    (0..size)
        .map(|index| signed_player(&format!("{team_id}-{index}"), team_id, ovr, 20_000))
        .collect()
}

/// Given a player whose stored value is still the one generation gave him,
/// When the week turns over on a Monday,
/// Then his value moves toward what he is worth now.
#[test]
fn a_monday_moves_values_toward_the_current_price() {
    let mut game = game_on_monday(
        vec![club("big", 850)],
        vec![signed_player("p", "big", 84, 20_000)],
    );

    refresh_weekly_player_values(&mut game);

    assert!(game.players[0].market_value > 1_000_000);
}

/// Given the same player on a Tuesday,
/// When the day's refresh runs,
/// Then nothing is repriced: values move once a week.
#[test]
fn values_are_only_refreshed_on_mondays() {
    let mut game = game_on_monday(
        vec![club("big", 850)],
        vec![signed_player("p", "big", 84, 20_000)],
    );
    game.clock.current_date = Utc.with_ymd_and_hms(2026, 8, 4, 0, 0, 0).unwrap();

    refresh_weekly_player_values(&mut game);

    assert_eq!(game.players[0].market_value, 1_000_000);
}

/// Given a retired player,
/// When values are refreshed,
/// Then he is left alone.
#[test]
fn retired_players_are_not_repriced() {
    let mut retired = signed_player("old", "big", 80, 20_000);
    retired.retired = true;
    let mut game = game_on_monday(vec![club("big", 850)], vec![retired]);

    refresh_weekly_player_values(&mut game);

    assert_eq!(game.players[0].market_value, 1_000_000);
}

/// Given a rich club and a poor one with equally good squads on the same wages,
/// When the world's economy opens,
/// Then the rich club pays more than the poor one, and each wage bill fits the
/// club's means.
#[test]
fn opening_wages_follow_each_clubs_means() {
    let mut players = squad("rich", 23, 72);
    players.extend(squad("poor", 23, 72));
    let mut game = game_on_monday(vec![club("rich", 850), club("poor", 120)], players);

    open_world_economy(&mut game);

    let rich_wage = game.players[0].wage();
    let poor_wage = game.players[23].wage();
    assert!(
        rich_wage > poor_wage * 3,
        "rich {rich_wage} poor {poor_wage}"
    );
    for team in &game.teams {
        let bill = crate::finances::calc_wages(&game, &team.id);
        assert!(
            bill <= revenue::weekly_wage_capacity(team).max(23 * 500),
            "{} bill {bill}",
            team.id
        );
    }
}

/// Given a world about to open,
/// When its economy opens,
/// Then every player is priced exactly and every club has the cash and budgets
/// its income supports.
#[test]
fn opening_prices_players_and_funds_clubs() {
    let mut game = game_on_monday(vec![club("big", 850)], squad("big", 20, 75));

    open_world_economy(&mut game);

    let today = game.clock.current_date.date_naive();
    let expected = valuation::market_value(&game.players[0], Some(850), today);
    assert_eq!(game.players[0].market_value, expected);
    let team = &game.teams[0];
    assert!(team.finance >= revenue::opening_cash(team));
    assert_eq!(team.transfer_budget, team.finance / 2);
    assert!(team.wage_budget >= crate::finances::calc_wages(&game, &team.id));
    assert!(crate::finances::journal_matches_cash(&game));
}

/// Given a career saved on the old scale, a club in debt and a player whose
/// contract is already recorded,
/// When the save adopts the real-world scale,
/// Then the club is lifted to its reserve through the books, prices are set, and
/// the signed wage is kept.
#[test]
fn an_old_save_is_lifted_without_rewriting_signed_contracts() {
    let mut player = signed_player("p", "big", 80, 14_000);
    player
        .open_initial_contract("2026-07-01", Some("2026-07-01".to_string()))
        .expect("contract opens");
    let mut team = club("big", 850);
    team.finance = -4_000_000;
    let mut game = game_on_monday(vec![team], vec![player]);
    crate::finances::backfill_opening_balances(&mut game);

    adopt_real_world_scale(&mut game);

    let team = &game.teams[0];
    assert_eq!(team.finance, revenue::opening_cash(team));
    assert!(crate::finances::journal_matches_cash(&game));
    assert_eq!(game.players[0].wage(), 14_000);
    assert!(game.players[0].market_value > 10_000_000);
}

/// Given a club whose wage bill is above what its income carries,
/// When the season's budgets are set,
/// Then its wage budget covers the contracts it already has, with the bill
/// using 93% of the budget as generation always left it.
#[test]
fn a_wage_budget_never_falls_below_the_contracts_already_signed() {
    let mut game = game_on_monday(vec![club("small", 120)], squad("small", 23, 75));
    let bill = crate::finances::calc_wages(&game, "small");
    assert!(
        bill > revenue::weekly_wage_capacity(&game.teams[0]),
        "the scenario needs a bill above what income carries"
    );

    set_season_budgets(&mut game);

    let wage_budget = game.teams[0].wage_budget;
    assert!(wage_budget >= bill, "budget {wage_budget} bill {bill}");
    assert_eq!(wage_budget, bill * 100 / 93);
}

/// Given an old save in which a small club carries a wage bill far beyond what
/// its income now supports,
/// When the save adopts the real-world scale,
/// Then the club is given its reserve plus a season of that shortfall, so it can
/// pay its inherited contracts until they come up for renewal.
#[test]
fn an_old_save_carries_a_small_clubs_inherited_wages_for_a_season() {
    let mut players = squad("small", 23, 72);
    for player in &mut players {
        player
            .open_initial_contract("2026-07-01", Some("2026-07-01".to_string()))
            .expect("contract opens");
    }
    let mut team = club("small", 110);
    team.finance = 0;
    let mut game = game_on_monday(vec![team], players);
    crate::finances::backfill_opening_balances(&mut game);

    adopt_real_world_scale(&mut game);

    let team = &game.teams[0];
    let bill = crate::finances::calc_wages(&game, "small");
    let weekly_shortfall = bill - revenue::projected_season_revenue(team) / 52;
    assert!(
        weekly_shortfall > 0,
        "the scenario needs a club living beyond its means"
    );
    assert_eq!(
        team.finance,
        revenue::opening_cash(team) + weekly_shortfall * 52
    );
    assert!(crate::finances::journal_matches_cash(&game));
}

fn club_staff(team_id: &str, rating: u8) -> Vec<domain::staff::Staff> {
    use domain::staff::{Staff, StaffAttributes, StaffRole};
    [
        StaffRole::AssistantManager,
        StaffRole::Coach,
        StaffRole::Scout,
        StaffRole::Physio,
    ]
    .into_iter()
    .enumerate()
    .map(|(index, role)| {
        let mut staff = Staff::new(
            format!("{team_id}-staff-{index}"),
            "Sam".to_string(),
            "Staff".to_string(),
            "1975-01-01".to_string(),
            role,
            StaffAttributes {
                coaching: rating,
                judging_ability: rating,
                judging_potential: rating,
                physiotherapy: rating,
            },
        );
        staff.team_id = Some(team_id.to_string());
        staff
    })
    .collect()
}

/// Given a poor club whose generated staff happen to be elite,
/// When the world's economy opens,
/// Then its staff are paid and under contract, and players and staff together
/// still fit what the club's income can carry.
#[test]
fn opening_wages_leave_room_for_each_clubs_staff() {
    let mut game = game_on_monday(vec![club("poor", 120)], squad("poor", 23, 72));
    game.staff = club_staff("poor", 90);

    open_world_economy(&mut game);

    assert!(game.staff.iter().all(|staff| staff.wage > 0));
    assert!(game.staff.iter().all(|staff| staff.contract_end.is_some()));
    let team = &game.teams[0];
    let bill = crate::finances::calc_wages(&game, &team.id);
    let capacity = revenue::weekly_wage_capacity(team);
    // The minimum wage lifts the cheapest contracts above their scaled price, so
    // the bill may land a fraction over; leaving staff out put it ~19% over.
    assert!(
        bill <= capacity * 101 / 100,
        "bill {bill} capacity {capacity}"
    );
}
