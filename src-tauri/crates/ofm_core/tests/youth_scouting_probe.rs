//! How much a scout's judgement is worth on a youth search: the true overall and
//! potential of the three youngsters he recommends, by scout and by facilities.
//!
//! Run it explicitly — it plays thousands of searches:
//!
//! ```text
//! cargo test -p ofm_core --test youth_scouting_probe --release -- --ignored --nocapture
//! ```
//!
//! A scout looks at more youngsters the better he judges ability and the better
//! the club's scouting facility, then recommends three on his own estimates. The
//! world generates the same youngsters for everyone, so any rise in the columns
//! below is the scout choosing better, not better youngsters existing.

use chrono::{TimeZone, Utc};
use domain::manager::Manager;
use domain::staff::{Staff, StaffAttributes, StaffRole};
use domain::team::Team;
use ofm_core::clock::GameClock;
use ofm_core::game::{Game, YouthScoutingObjective, YouthScoutingRegion};
use ofm_core::scouting::{process_scouting, start_youth_scouting};

fn searches_per_row() -> usize {
    std::env::var("OFM_PROBE_SEARCHES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(2_000)
}

fn game_with_scout(rating: u8, facility_level: u8, search: usize) -> Game {
    let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
    let mut manager = Manager::new(
        "mgr1".to_string(),
        "Test".to_string(),
        "Manager".to_string(),
        "1980-01-01".to_string(),
        "England".to_string(),
    );
    manager.hire("team1".to_string());
    let mut team = Team::new(
        "team1".to_string(),
        "Test FC".to_string(),
        "TST".to_string(),
        "England".to_string(),
        "London".to_string(),
        "Stadium".to_string(),
        40_000,
    );
    team.facilities.scouting = facility_level;
    team.finance = 100_000_000;
    let mut scout = Staff::new(
        "scout1".to_string(),
        "Scout".to_string(),
        "One".to_string(),
        "1985-01-01".to_string(),
        StaffRole::Scout,
        StaffAttributes {
            coaching: 30,
            judging_ability: rating,
            judging_potential: rating,
            physiotherapy: 20,
        },
    );
    scout.team_id = Some("team1".to_string());
    let mut game = Game::new(clock, manager, vec![team], vec![], vec![scout], vec![]);
    // A different save seed per search, so each search draws its own youngsters.
    game.seed = search as u64;
    game
}

/// The recommended youngsters' true (overall, potential) from one search.
fn one_search(rating: u8, facility_level: u8, search: usize) -> Vec<(u8, u8)> {
    let mut game = game_with_scout(rating, facility_level, search);
    start_youth_scouting(
        &mut game,
        "scout1",
        YouthScoutingRegion::Domestic,
        YouthScoutingObjective::HighPotential,
        None,
    )
    .expect("search starts");
    for _ in 0..12 {
        process_scouting(&mut game);
        game.clock.advance_days(1);
    }
    game.messages
        .iter()
        .filter_map(|message| message.context.youth_prospects.as_ref())
        .flatten()
        .map(|prospect| (prospect.ovr, prospect.potential))
        .collect()
}

#[test]
#[ignore]
fn report_recommended_youngsters_by_scout_and_facility() {
    let searches = searches_per_row();
    println!();
    println!("High-potential searches, {searches} per row; true ratings of the three recommended.");
    println!(
        "{:>6} {:>9} {:>9} {:>11} {:>14}",
        "scout", "facility", "mean OVR", "mean pot.", "pot. >= 85 %"
    );
    for (rating, facility_level) in [(20, 1), (50, 1), (80, 1), (80, 3)] {
        let mut ovr = 0u64;
        let mut potential = 0u64;
        let mut elite = 0u64;
        let mut count = 0u64;
        for search in 0..searches {
            for (o, p) in one_search(rating, facility_level, search) {
                ovr += u64::from(o);
                potential += u64::from(p);
                elite += u64::from(p >= 85);
                count += 1;
            }
        }
        let count = count.max(1) as f64;
        println!(
            "{:>6} {:>9} {:>9.1} {:>11.1} {:>13.1}%",
            rating,
            facility_level,
            ovr as f64 / count,
            potential as f64 / count,
            100.0 * elite as f64 / count
        );
    }
}
