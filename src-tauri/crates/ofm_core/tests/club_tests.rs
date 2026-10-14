use chrono::{TimeZone, Utc};
use domain::manager::Manager;
use domain::team::{Facilities, FacilityType, Team};
use ofm_core::clock::GameClock;
use ofm_core::club;
use ofm_core::game::Game;

fn make_team(id: &str, name: &str) -> Team {
    let mut team = Team::new(
        id.to_string(),
        name.to_string(),
        name[..3].to_string(),
        "England".to_string(),
        "London".to_string(),
        "Stadium".to_string(),
        40_000,
    );
    team.finance = 20_000_000;
    team
}

fn make_game() -> Game {
    let date = Utc.with_ymd_and_hms(2025, 6, 16, 12, 0, 0).unwrap();
    let clock = GameClock::new(date);
    let mut manager = Manager::new(
        "mgr1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team1".to_string());

    let team1 = make_team("team1", "Test FC");

    Game::new(clock, manager, vec![team1], vec![], vec![], vec![])
}

/// Given a club with €20M and its medical facility at level 1,
/// When it upgrades the facility,
/// Then €2.5M is booked out of its cash and the facility reaches level 2.
#[test]
fn upgrade_facility_deducts_funds_and_increments_level() {
    let mut game = make_game();
    let initial_finance = game.teams[0].finance;

    let cost = club::upgrade_facility(&mut game, "team1", FacilityType::Medical).unwrap();

    assert_eq!(cost, 2_500_000);
    assert_eq!(game.teams[0].finance, initial_finance - cost);
    assert_eq!(game.teams[0].facilities.medical, 2);
    assert_eq!(game.cash_journal.cash_for("team1"), game.teams[0].finance);
    assert!(
        game.cash_journal
            .iter()
            .any(|post| post.kind == domain::finance::CashKind::Facilities && post.amount == -cost)
    );
}

/// Given a club with €1M and its training facility at level 1,
/// When it tries to upgrade the facility, which costs €2.5M,
/// Then the upgrade is refused with the cost and nothing changes.
#[test]
fn upgrade_facility_rejects_when_funds_are_insufficient() {
    let mut game = make_game();
    game.teams[0].finance = 1_000_000;
    game.teams[0].facilities = Facilities {
        training: 1,
        medical: 1,
        scouting: 1,
    };

    let result = club::upgrade_facility(&mut game, "team1", FacilityType::Training);

    assert_eq!(
        result.unwrap_err(),
        "be.error.finance.facilityUpgradeInsufficientFunds?amount=2500000"
    );
    assert_eq!(game.teams[0].finance, 1_000_000);
    assert_eq!(game.teams[0].facilities.training, 1);
}

/// Given a club with €10M of transfer budget,
/// When it upgrades a facility for €2.5M,
/// Then the upgrade comes out of the transfer budget as well as the cash,
/// so the budget never promises money the club has spent.
#[test]
fn upgrade_facility_spends_from_the_transfer_budget() {
    let mut game = make_game();
    game.teams[0].transfer_budget = 10_000_000;

    let cost = club::upgrade_facility(&mut game, "team1", FacilityType::Training).unwrap();

    assert_eq!(game.teams[0].transfer_budget, 10_000_000 - cost);
}

/// Given a club with €1M of transfer budget but enough cash,
/// When it upgrades a facility for €2.5M,
/// Then the upgrade goes ahead and the transfer budget stops at zero.
#[test]
fn upgrade_facility_floors_the_transfer_budget_at_zero() {
    let mut game = make_game();
    game.teams[0].transfer_budget = 1_000_000;

    club::upgrade_facility(&mut game, "team1", FacilityType::Training).unwrap();

    assert_eq!(game.teams[0].transfer_budget, 0);
    assert_eq!(game.teams[0].facilities.training, 2);
}

/// Given a club with plenty of cash and its scouting department at level 10,
/// When it tries to upgrade the department again,
/// Then the upgrade is refused as at the top level and no money moves.
#[test]
fn upgrade_facility_refuses_past_the_top_level() {
    let mut game = make_game();
    game.teams[0].finance = 100_000_000;
    game.teams[0].facilities.scouting = 10;

    let result = club::upgrade_facility(&mut game, "team1", FacilityType::Scouting);

    assert_eq!(
        result.unwrap_err(),
        "be.error.finance.facilityUpgradeMaxLevel"
    );
    assert_eq!(game.teams[0].finance, 100_000_000);
    assert_eq!(game.teams[0].facilities.scouting, 10);
}

/// Given a club with its medical facility at level 9,
/// When it upgrades the facility,
/// Then it pays €22.5M and reaches the top level.
#[test]
fn upgrade_facility_reaches_the_top_level() {
    let mut game = make_game();
    game.teams[0].finance = 100_000_000;
    game.teams[0].facilities.medical = 9;

    let cost = club::upgrade_facility(&mut game, "team1", FacilityType::Medical).unwrap();

    assert_eq!(cost, 22_500_000);
    assert_eq!(game.teams[0].facilities.medical, 10);
}

/// Given a club whose medical facility is at level 4,
/// When it previews the next upgrade,
/// Then it sees the €10M price and every medical effect at level 4 and level 5.
#[test]
fn upgrade_preview_shows_the_cost_and_each_effect_before_and_after() {
    let mut game = make_game();
    game.teams[0].facilities.medical = 4;

    let preview = club::upgrade_preview(&game.teams[0], FacilityType::Medical);

    assert_eq!(preview.level, 4);
    assert_eq!(preview.max_level, 10);
    assert_eq!(preview.cost, Some(10_000_000));
    type Line<'a> = (&'a str, Vec<f64>, Option<Vec<f64>>);
    let lines: Vec<Line> = preview
        .effects
        .iter()
        .map(|effect| (effect.key, effect.current.clone(), effect.next.clone()))
        .collect();
    assert_eq!(
        lines,
        vec![
            (
                "finances.facilityEffects.conditionRecovery",
                vec![1.3],
                Some(vec![1.4])
            ),
            (
                "finances.facilityEffects.injuryDays",
                vec![-12.0],
                Some(vec![-16.0])
            ),
            (
                "finances.facilityEffects.matchInjurySeverity",
                vec![64.2, 27.3, 8.5],
                Some(vec![65.6, 26.4, 8.0])
            ),
            (
                "finances.facilityEffects.trainingInjuries",
                vec![-9.0],
                Some(vec![-12.0])
            ),
        ]
    );
}

/// Given a club whose scouting department is at the top level,
/// When it previews an upgrade,
/// Then there is no price and no "after" for any effect.
#[test]
fn upgrade_preview_at_the_top_level_offers_nothing_more() {
    let mut game = make_game();
    game.teams[0].facilities.scouting = 10;

    let preview = club::upgrade_preview(&game.teams[0], FacilityType::Scouting);

    assert_eq!(preview.cost, None);
    assert!(preview.effects.iter().all(|effect| effect.next.is_none()));
    assert!(!preview.effects.is_empty());
}
