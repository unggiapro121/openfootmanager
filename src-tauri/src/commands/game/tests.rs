//! End-to-end tests for the game commands.
//!
//! Every test here drives a whole career opening: load or build a world, found
//! its competitions, bootstrap a manager into it, and assert on the result.
//! They live together rather than in the submodule they happen to touch first
//! because each one crosses three or more of them, and splitting them by first
//! contact would make the seams look tighter than they are.

use super::testkit::*;
use super::{
    build_game_from_world_data, game_clock_for_world, StartupOptions,
    DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
};
use domain::news::NewsCategory;
use ofm_core::career::{begin_career, CareerScope, StartPhase};

#[test]
#[ignore = "perf harness; run: cargo test -p openfootmanager perf_baseline -- --ignored --nocapture"]
fn perf_baseline() {
    use std::time::Instant;

    let t = Instant::now();
    let world = ofm_core::generator::generate_world_data(
        &ofm_core::generator::DefinitionSources::embedded_only(),
    );
    let gen = t.elapsed();
    let teams = world.teams.len();
    let players = world.players.len();

    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2026,
        start_phase: StartPhase::SeasonStart,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();

    let t = Instant::now();
    let (mut game, _stats) = build_game_from_world_data(clock, manager, &startup_options, world);
    let build = t.elapsed();

    let competitions = game.competitions.len();
    let active = game.active_competition_ids.len();

    const DAYS: u32 = 30;
    let t = Instant::now();
    for _ in 0..DAYS {
        ofm_core::turn::process_day(&mut game);
    }
    let days = t.elapsed();

    eprintln!(
        "PERF teams={teams} players={players} competitions={competitions} active_competition_ids={active}"
    );
    eprintln!("PERF world-gen         = {gen:?}");
    eprintln!("PERF build-game        = {build:?}  (foundations + history)");
    eprintln!(
        "PERF {DAYS}x process_day   = {days:?}  ({:?}/day)",
        days / DAYS
    );
}

/// Given a career started at ×2.5, when the world is built, then the new game
/// develops players at ×2.5.
#[test]
fn a_new_career_takes_the_development_speed_chosen_at_creation() {
    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2032,
        start_phase: StartPhase::MidSeason,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::from_percent(250)
            .expect("×2.5 is on the scale"),
    };
    let world = make_historical_snapshot_world();
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();

    let (game, _stats) = build_game_from_world_data(clock, manager, &startup_options, world);

    assert_eq!(game.development_speed.percent(), 250);
}

#[test]
fn historical_snapshot_startup_preserves_league_news_history_and_stats() {
    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2032,
        start_phase: StartPhase::MidSeason,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let world = make_historical_snapshot_world();
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();

    let (game, stats_state) = build_game_from_world_data(clock, manager, &startup_options, world);

    assert_eq!(
        game.clock.start_date.to_rfc3339(),
        "2031-07-01T00:00:00+00:00"
    );
    assert_eq!(
        game.clock.current_date.to_rfc3339(),
        "2031-11-20T00:00:00+00:00"
    );
    assert_eq!(game.league.as_ref().map(|league| league.season), Some(2031));
    assert_eq!(game.news.len(), 1);
    assert_eq!(game.world_history.season_awards.len(), 1);
    assert_eq!(stats_state.team_matches.len(), 1);
    assert_eq!(stats_state.player_matches.len(), 1);
    assert!(game
        .managers
        .iter()
        .any(|manager| manager.id == "mgr-incumbent"));
}

#[test]
fn imported_roster_baseline_bootstrap_backfills_staff_market_and_opening_youth() {
    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2032,
        start_phase: StartPhase::SeasonStart,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let mut world = make_imported_baseline_world_without_staff();
    ofm_core::generator::normalize_imported_world_for_career_start(
        &mut world,
        startup_options.start_year as u32,
    );
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();

    let (game, stats_state) = build_game_from_world_data(clock, manager, &startup_options, world);

    assert!(stats_state.team_matches.is_empty());
    assert_eq!(
        game.staff
            .iter()
            .filter(|staff_member| staff_member.team_id.is_none())
            .count(),
        12
    );
    for team_id in ["team1", "team2"] {
        for role in [
            domain::staff::StaffRole::AssistantManager,
            domain::staff::StaffRole::Coach,
            domain::staff::StaffRole::Scout,
            domain::staff::StaffRole::Physio,
        ] {
            let count = game
                .staff
                .iter()
                .filter(|staff_member| {
                    staff_member.team_id.as_deref() == Some(team_id) && staff_member.role == role
                })
                .count();
            assert_eq!(count, 1);
        }
        let youth_count = game
            .players
            .iter()
            .filter(|player| {
                player.team_id.as_deref() == Some(team_id)
                    && player.squad_role == domain::player::SquadRole::Youth
            })
            .count();
        assert_eq!(youth_count, 3);
    }
    assert_eq!(
        game.available_staff_market_last_activity_date.as_deref(),
        Some("2032-07-01")
    );
}

#[test]
fn imported_roster_baseline_bootstrap_allows_ai_manager_seeding_without_imported_staff() {
    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2032,
        start_phase: StartPhase::SeasonStart,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let mut world = make_imported_baseline_world_without_staff();
    ofm_core::generator::normalize_imported_world_for_career_start(
        &mut world,
        startup_options.start_year as u32,
    );
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();
    let (mut game, stats_state) =
        build_game_from_world_data(clock, manager, &startup_options, world);

    begin_career(&mut game, "team1", CareerScope::default(), stats_state).unwrap();

    assert_eq!(
        game.teams
            .iter()
            .find(|team| team.id == "team1")
            .and_then(|team| team.manager_id.as_deref()),
        Some("mgr-user")
    );
    assert!(game
        .teams
        .iter()
        .filter(|team| team.id != "team1")
        .all(|team| team.manager_id.is_some()));
}

/// Given a world that was generated from a seed,
/// When a new game is built from it,
/// Then the game has that seed — one number says both how the world was made and
///      how its days will go.
#[test]
fn a_new_game_keeps_the_seed_its_world_was_made_from() {
    let mut world = make_imported_baseline_world_without_staff();
    world.generation_seed = Some(0xA11C_E5ED_0000_0007);

    let game = game_from(world);

    assert_eq!(game.seed, 0xA11C_E5ED_0000_0007);
}

/// Given a world that was not generated here — an import, a package — so nothing
///       gave it a seed,
/// When a new game is built from it,
/// Then the game draws one of its own, rather than starting on 0 like every other.
#[test]
fn a_world_without_a_seed_gives_its_game_one_of_its_own() {
    let world = make_imported_baseline_world_without_staff();
    assert_eq!(world.generation_seed, None);

    let game = game_from(world);

    assert_ne!(game.seed, 0);
}

fn game_from(world: ofm_core::generator::WorldData) -> ofm_core::game::Game {
    let startup_options = StartupOptions {
        start_year: 2032,
        start_phase: StartPhase::SeasonStart,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();
    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    build_game_from_world_data(clock, manager, &startup_options, world).0
}

#[test]
fn a_new_career_starts_with_own_choices_clear_and_rivals_identity_intact() {
    use domain::team::{PlayStyle, PlayerRole, TacticsPhaseSettings};

    let mut game = make_bootstrap_test_game();
    let identity = ofm_core::ai_tactics::blueprint_for(&PlayStyle::HighPress);
    assert_ne!(identity, TacticsPhaseSettings::default());
    for team in &mut game.teams {
        team.play_style = PlayStyle::HighPress;
        team.tactics_phase = identity.clone();
        team.player_roles
            .insert(format!("{}-player-0", team.id), PlayerRole::BallWinner);
    }

    begin_career(
        &mut game,
        "team1",
        CareerScope::default(),
        domain::stats::StatsState::default(),
    )
    .unwrap();

    let own = game.teams.iter().find(|team| team.id == "team1").unwrap();
    let rival = game.teams.iter().find(|team| team.id == "team2").unwrap();
    assert_eq!(own.tactics_phase, TacticsPhaseSettings::default());
    assert!(own.player_roles.is_empty());
    assert_eq!(rival.tactics_phase, identity);
    assert_eq!(rival.player_roles.len(), 1);
}

#[test]
fn beginning_a_career_seeds_the_ai_loan_market() {
    let mut game = make_bootstrap_test_game();
    game.teams
        .iter_mut()
        .find(|team| team.id == "team2")
        .unwrap()
        .starting_xi_ids = (0..11)
        .map(|index| format!("team2-player-{index}"))
        .collect();

    for (id, date_of_birth) in [
        ("team2-loan-1", "2007-01-01"),
        ("team2-loan-2", "2006-01-01"),
        ("team2-loan-3", "2005-01-01"),
    ] {
        let mut player = domain::player::Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            date_of_birth.to_string(),
            "England".to_string(),
            domain::player::Position::Midfielder,
            default_player_attributes(),
        );
        player.team_id = Some("team2".to_string());
        player.stage_contract_end(Some("2035-06-30".to_string()));
        game.players.push(player);
    }

    begin_career(
        &mut game,
        "team1",
        CareerScope::default(),
        domain::stats::StatsState::default(),
    )
    .unwrap();

    assert_eq!(
        game.players
            .iter()
            .filter(|player| { player.team_id.as_deref() == Some("team2") && player.loan_listed })
            .count(),
        2
    );
    assert!(game
        .players
        .iter()
        .filter(|player| player.team_id.as_deref() == Some("team1"))
        .all(|player| !player.loan_listed));
}

#[test]
fn imported_historical_snapshot_preserves_state_while_backfilling_staff() {
    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2032,
        start_phase: StartPhase::MidSeason,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let mut world = make_historical_snapshot_world();
    world.staff.clear();
    let original_news_len = world.news.len();
    let original_season = world.league.as_ref().map(|league| league.season);
    let original_awards = world.world_history.season_awards.len();
    ofm_core::generator::normalize_imported_world_for_career_start(
        &mut world,
        startup_options.start_year as u32,
    );
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();

    let (game, stats_state) = build_game_from_world_data(clock, manager, &startup_options, world);

    assert_eq!(
        game.league.as_ref().map(|league| league.season),
        original_season
    );
    assert_eq!(game.news.len(), original_news_len);
    assert_eq!(game.world_history.season_awards.len(), original_awards);
    assert_eq!(stats_state.team_matches.len(), 1);
    assert_eq!(
        game.staff
            .iter()
            .filter(|staff_member| staff_member.team_id.is_none())
            .count(),
        12
    );
    for team_id in ["team1", "team2"] {
        let has_assistant = game.staff.iter().any(|staff_member| {
            staff_member.team_id.as_deref() == Some(team_id)
                && staff_member.role == domain::staff::StaffRole::AssistantManager
        });
        assert!(has_assistant);
    }
}

#[test]
fn embedded_competition_definitions_replace_the_auto_built_competitions() {
    use ofm_core::generator::{
        CompetitionDefinition, CompetitionDefinitionFile, FormatDef, ParticipantSpec,
    };

    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2032,
        start_phase: StartPhase::MidSeason,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let mut world = make_historical_snapshot_world();
    let team_ids: Vec<String> = world.teams.iter().map(|t| t.id.clone()).collect();
    assert!(team_ids.len() >= 2);
    world.competition_definitions = Some(CompetitionDefinitionFile {
        format_version: 1,
        competitions: vec![CompetitionDefinition {
            id: "custom-league".to_string(),
            name: "Custom League".to_string(),
            r#type: domain::league::CompetitionType::League,
            scope: domain::league::CompetitionScope::Domestic,
            region_id: None,
            country_id: None,
            required_region_ids: vec![],
            priority: 0,
            format: FormatDef {
                kind: domain::league::CompetitionFormat::LeagueTable,
                legs: None,
                group_size: None,
                qualifiers_per_group: None,
                best_third_qualifiers: None,
            },
            participants: ParticipantSpec {
                explicit: Some(team_ids.clone()),
                selector: None,
            },
            berths: Vec::new(),
            season_start_month: None,
            season_start_day: None,
            name_key: None,
            logo: None,
        }],
    });
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();

    let (game, _stats) = build_game_from_world_data(clock, manager, &startup_options, world);

    let custom = game
        .competitions
        .iter()
        .find(|c| c.id == "custom-league")
        .expect("authored competition replaces the auto-built ones");
    assert_eq!(custom.participant_ids, team_ids);
    assert!(
        game.competitions.iter().all(|c| c.id == "custom-league"
            || c.kind == domain::league::CompetitionType::InternationalNation),
        "no auto-generated club competitions when definitions are supplied"
    );
}

#[test]
fn beginning_a_career_preserves_an_imported_snapshot() {
    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2032,
        start_phase: StartPhase::MidSeason,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let world = make_historical_snapshot_world();
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();
    let (mut game, stats_state) =
        build_game_from_world_data(clock, manager, &startup_options, world);

    let updated_stats =
        begin_career(&mut game, "team1", CareerScope::default(), stats_state).unwrap();

    assert_eq!(game.league.as_ref().map(|league| league.season), Some(2031));
    assert_eq!(updated_stats.team_matches.len(), 1);
    assert_eq!(updated_stats.player_matches.len(), 1);
    assert_eq!(
        game.teams
            .iter()
            .find(|team| team.id == "team1")
            .and_then(|team| team.manager_id.as_deref()),
        Some("mgr-user")
    );
    assert!(game
        .news
        .iter()
        .any(|article| article.category == NewsCategory::ManagerialChange));
}

#[test]
fn authored_group_size_reaches_the_game_built_from_a_loaded_world() {
    for (size, expected_groups, expected_fixtures) in [(Some(2), 4, 8), (None, 2, 24)] {
        let template = make_historical_snapshot_world().teams[0].clone();
        let world = ofm_core::generator::WorldData {
            teams: (0..8)
                .map(|i| {
                    let mut team = template.clone();
                    team.id = format!("authored-club-{i}");
                    team
                })
                .collect(),
            ..Default::default()
        };
        let mut json = serde_json::to_value(&world).unwrap();
        let mut format = serde_json::json!({"kind":"GroupAndKnockout"});
        if let Some(size) = size {
            format["groupSize"] = size.into();
        }
        json["competitionDefinitions"] = serde_json::json!({"competitions":[{
            "id":"authored-cup", "name":"Authored Cup", "type":"Cup", "scope":"Domestic",
            "format":format, "participants":{"explicit":world.teams.iter().map(|t| &t.id).collect::<Vec<_>>()}
        }]});
        let loaded = ofm_core::generator::load_world_from_json(&json.to_string()).unwrap();
        let manager = domain::manager::Manager::new(
            "mgr-user".into(),
            "Alex".into(),
            "Manager".into(),
            "1980-01-01".into(),
            "England".into(),
        );
        let options = StartupOptions {
            start_year: 2031,
            start_phase: StartPhase::SeasonStart,
            history_depth_years: 0,
            development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
        };
        let clock = game_clock_for_world(&options, &loaded.metadata).unwrap();
        let (game, _) = build_game_from_world_data(clock, manager, &options, loaded);
        let cup = game
            .competitions
            .iter()
            .find(|c| c.id == "authored-cup")
            .unwrap();
        assert_eq!(cup.groups.len(), expected_groups);
        assert_eq!(cup.fixtures.len(), expected_fixtures);
        assert!(cup
            .groups
            .iter()
            .all(|g| g.team_ids.len() == size.unwrap_or(4)));
    }
}

/// Transfer-market probe on the real-world package: one summer window of a
/// career at Como, every club run by the AI but Como.
///
/// ```text
/// OFM_PACKAGE=/path/to/real-world-2025-26.ofm \
///   cargo test --release -p openfootmanager transfer_market_probe -- --ignored --nocapture
/// ```
///
/// Reports, per AI club, the signings and sales of the window (the design aims
/// for a median of three to seven), by nation; the offers the manager's players
/// drew, listed and unlisted; and how many clubs end the window in debt.
#[test]
#[ignore = "measurement probe on the real-world package; see the doc comment"]
fn transfer_market_probe() {
    use std::collections::{BTreeMap, HashMap};

    let path = std::env::var("OFM_PACKAGE")
        .unwrap_or_else(|_| "../../ofm-packages/real-world-2025-26.ofm".to_string());
    let (package, errors) =
        ofm_core::generator::load_world_package_from_ofm(std::path::Path::new(&path));
    assert!(errors.is_empty(), "package errors: {errors:?}");
    let world = ofm_core::generator::build_world_from_package(
        &package,
        None,
        &ofm_core::generator::DefinitionSources::embedded_only(),
    )
    .expect("the package builds a world");

    let manager = domain::manager::Manager::new(
        "mgr-user".to_string(),
        "Alex".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    let startup_options = StartupOptions {
        start_year: 2026,
        start_phase: StartPhase::SeasonStart,
        history_depth_years: DEFAULT_GENERATED_HISTORY_DEPTH_YEARS,
        development_speed: ofm_core::development_speed::DevelopmentSpeed::REALISTIC,
    };
    let clock = game_clock_for_world(&startup_options, &world.metadata).unwrap();
    let (mut game, stats) = build_game_from_world_data(clock, manager, &startup_options, world);
    let user_club = std::env::var("OFM_CLUB").unwrap_or_else(|_| "como".to_string());
    begin_career(&mut game, &user_club, CareerScope::default(), stats).expect("career opens");

    let in_debt_at_start = game.teams.iter().filter(|team| team.finance < 0).count();
    // Play until the window has opened and closed again.
    let mut seen_open = false;
    let mut window = (String::new(), String::new());
    for _ in 0..400 {
        ofm_core::turn::process_day(&mut game);
        let context = &game.season_context.transfer_window;
        let open = matches!(
            context.status,
            domain::season::TransferWindowStatus::Open
                | domain::season::TransferWindowStatus::DeadlineDay
        );
        if open && !seen_open {
            seen_open = true;
            window = (
                context.opens_on.clone().unwrap_or_default(),
                context.closes_on.clone().unwrap_or_default(),
            );
        }
        if seen_open && !open {
            break;
        }
    }
    assert!(seen_open, "the window never opened");

    // Deals of the window, counted once each.
    let mut seen = std::collections::HashSet::new();
    let mut bought: HashMap<String, usize> = HashMap::new();
    let mut sold: HashMap<String, usize> = HashMap::new();
    let deals = game
        .competitions
        .iter()
        .chain(game.league.iter())
        .flat_map(|competition| competition.transfer_log.iter())
        .filter(|deal| deal.date >= window.0 && deal.date <= window.1)
        .filter(|deal| seen.insert((deal.date.clone(), deal.player_id.clone())))
        .collect::<Vec<_>>();
    for deal in &deals {
        *bought.entry(deal.to_team_id.clone()).or_default() += 1;
        *sold.entry(deal.from_team_id.clone()).or_default() += 1;
    }

    let ai: Vec<&domain::team::Team> = game
        .teams
        .iter()
        .filter(|team| team.id != user_club)
        .collect();
    let mut buys: Vec<usize> = ai
        .iter()
        .map(|t| bought.get(&t.id).copied().unwrap_or(0))
        .collect();
    let mut sales: Vec<usize> = ai
        .iter()
        .map(|t| sold.get(&t.id).copied().unwrap_or(0))
        .collect();
    buys.sort_unstable();
    sales.sort_unstable();
    let pct = |v: &[usize], q: f64| v[((v.len() - 1) as f64 * q) as usize];
    eprintln!("WINDOW {} → {}  deals {}", window.0, window.1, deals.len());
    eprintln!(
        "BUYS per AI club: p10 {} median {} p90 {} max {}  clubs with none {}/{}",
        pct(&buys, 0.1),
        pct(&buys, 0.5),
        pct(&buys, 0.9),
        buys.last().unwrap(),
        buys.iter().filter(|b| **b == 0).count(),
        buys.len()
    );
    eprintln!(
        "SALES per AI club: p10 {} median {} p90 {} max {}  clubs with none {}/{}",
        pct(&sales, 0.1),
        pct(&sales, 0.5),
        pct(&sales, 0.9),
        sales.last().unwrap(),
        sales.iter().filter(|s| **s == 0).count(),
        sales.len()
    );

    let mut by_nation: BTreeMap<String, (usize, usize, usize, u32)> = BTreeMap::new();
    for team in &ai {
        let entry = by_nation.entry(team.football_nation.clone()).or_default();
        entry.0 += 1;
        entry.1 += bought.get(&team.id).copied().unwrap_or(0);
        entry.2 += sold.get(&team.id).copied().unwrap_or(0);
        entry.3 += team.reputation;
    }
    for (nation, (clubs, b, s, reputation)) in &by_nation {
        eprintln!(
            "NATION {nation:4} clubs {clubs:3}  buys/club {:.1}  sales/club {:.1}  reputation {}",
            *b as f64 / *clubs as f64,
            *s as f64 / *clubs as f64,
            reputation / *clubs as u32
        );
    }

    let user_players: Vec<&domain::player::Player> = game
        .players
        .iter()
        .filter(|p| p.team_id.as_deref() == Some(user_club.as_str()))
        .collect();
    let offers_in_window = |p: &domain::player::Player| {
        p.transfer_offers
            .iter()
            .filter(|offer| offer.date >= window.0 && offer.date <= window.1)
            .count()
    };
    let listed: Vec<&&domain::player::Player> =
        user_players.iter().filter(|p| p.transfer_listed).collect();
    let unlisted: Vec<&&domain::player::Player> =
        user_players.iter().filter(|p| !p.transfer_listed).collect();
    let per = |group: &[&&domain::player::Player]| {
        group.iter().map(|p| offers_in_window(p)).sum::<usize>() as f64 / group.len().max(1) as f64
    };
    eprintln!(
        "USER offers per player: listed {:.2} ({} players)  unlisted {:.2} ({} players)",
        per(&listed),
        listed.len(),
        per(&unlisted),
        unlisted.len()
    );
    eprintln!(
        "DEBT clubs in debt: at career start {in_debt_at_start}, after the window {}",
        game.teams.iter().filter(|team| team.finance < 0).count()
    );
}
