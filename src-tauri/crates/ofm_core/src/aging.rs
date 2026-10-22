//! The season's aging over a save: every player's age worked out on the day, the attribute curve
//! and the retirement roll applied (`ofm_rules::aging`), retirees taken off their clubs.

use crate::contracts::{iso, record_movement};
use crate::game::Game;
use chrono::{Datelike, NaiveDate};
use domain::player::{Player, PlayerMovementEntry, PlayerMovementKind};
use ofm_rules::aging::apply_attribute_curve;
#[cfg(test)]
use ofm_rules::aging::{technical_growth, veteran_pace_loss};

pub(crate) fn player_age_on(current_date: NaiveDate, date_of_birth: &str) -> i32 {
    // The one age rule (`ofm_rules::age`); 30 when the date of birth cannot be read.
    ofm_rules::age::age_on_day(
        date_of_birth,
        current_date.year(),
        current_date.month(),
        current_date.day(),
    )
    .unwrap_or(30)
}

fn has_expired_contract(player: &Player, current_date: NaiveDate) -> bool {
    player
        .contract_end()
        .and_then(|value| NaiveDate::parse_from_str(value, "%Y-%m-%d").ok())
        .is_some_and(|contract_end| contract_end < current_date)
}

fn should_retire(player: &Player, age: i32, current_date: NaiveDate, season: u32) -> bool {
    ofm_rules::aging::should_retire(
        player,
        age,
        has_expired_contract(player, current_date),
        season,
    )
}

fn retire_player(player: &mut Player, current_date: NaiveDate) {
    // Recorded first, while his club is still known. It ends the contract: the dates
    // and the wage follow it.
    record_movement(
        player,
        PlayerMovementEntry {
            from_team_id: player.contract_club_id().map(str::to_string),
            ..PlayerMovementEntry::new(iso(current_date), PlayerMovementKind::Retired)
        },
    );
    player.retired = true;
    player.team_id = None;
    player.transfer_listed = false;
    player.loan_listed = false;
    player.transfer_offers.clear();
}

pub fn apply_seasonal_aging(game: &mut Game, current_date: NaiveDate, season: u32) {
    for player in game.players.iter_mut() {
        if player.retired {
            continue;
        }

        let age = player_age_on(current_date, &player.date_of_birth);
        apply_attribute_curve(player, age, season);

        if should_retire(player, age, current_date, season) {
            if let Some(team_id) = player.team_id.clone()
                && let Some(team) = game.teams.iter_mut().find(|team| team.id == team_id)
            {
                team.remove_player_references(&player.id);
            }
            retire_player(player, current_date);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        apply_seasonal_aging, player_age_on, should_retire, technical_growth, veteran_pace_loss,
    };
    use crate::clock::GameClock;
    use crate::game::Game;
    use chrono::{NaiveDate, TimeZone, Utc};
    use domain::manager::Manager;
    use domain::player::{Player, PlayerAttributes, PlayerSeasonStats, Position};
    use domain::team::Team;

    fn make_player(id: &str, dob: &str) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            format!("Player {id}"),
            dob.to_string(),
            "England".to_string(),
            Position::Forward,
            PlayerAttributes {
                pace: 70,
                stamina: 70,
                strength: 70,
                agility: 70,
                passing: 70,
                shooting: 70,
                tackling: 70,
                dribbling: 70,
                defending: 70,
                positioning: 70,
                vision: 70,
                decisions: 70,
                composure: 70,
                aggression: 70,
                teamwork: 70,
                leadership: 70,
                handling: 20,
                reflexes: 20,
                aerial: 70,
                long_passing: 0,
                crossing: 0,
                curve: 0,
                free_kick: 0,
                long_shots: 0,
                first_touch: 0,
                heading: 0,
            },
        );
        player.team_id = Some("team1".to_string());
        player
    }

    fn make_game(players: Vec<Player>) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 5, 20, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr1".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("team1".to_string());

        let team = Team::new(
            "team1".to_string(),
            "Test FC".to_string(),
            "TFC".to_string(),
            "England".to_string(),
            "London".to_string(),
            "Ground".to_string(),
            20_000,
        );

        Game::new(clock, manager, vec![team], players, vec![], vec![])
    }

    #[test]
    fn veteran_pace_loss_stays_within_supported_range() {
        let loss = veteran_pace_loss("veteran", 34, 5);
        assert!((1..=3).contains(&loss));
        assert_eq!(veteran_pace_loss("prospect", 24, 5), 0);
    }

    #[test]
    fn technical_growth_stops_after_age_32() {
        assert!(technical_growth("player", 31, 3) <= 1);
        assert_eq!(technical_growth("player", 33, 3), 0);
    }

    #[test]
    fn deterministic_retirement_favors_older_out_of_contract_players() {
        let current_date = NaiveDate::from_ymd_opt(2026, 5, 20).unwrap();
        let mut player = make_player("older-pro", "1988-01-01");
        player.stage_contract_end(Some("2026-05-01".to_string()));
        player.stats = PlayerSeasonStats {
            appearances: 6,
            avg_rating: 6.1,
            ..PlayerSeasonStats::default()
        };

        let age = player_age_on(current_date, &player.date_of_birth);
        assert!(should_retire(&player, age, current_date, 1));
    }

    #[test]
    fn apply_seasonal_aging_retires_veteran_and_reduces_pace() {
        let mut veteran = make_player("older-pro", "1988-01-01");
        veteran.stage_contract_start(Some("2023-07-01".to_string()));
        veteran.stage_contract_end(Some("2026-05-01".to_string()));
        veteran.attributes.pace = 20;
        veteran.transfer_listed = true;
        veteran.stats = PlayerSeasonStats {
            appearances: 6,
            avg_rating: 6.1,
            ..PlayerSeasonStats::default()
        };

        let mut game = make_game(vec![veteran]);
        game.teams[0].starting_xi_ids = vec!["older-pro".to_string()];
        game.teams[0].training_groups = vec![domain::team::TrainingGroup {
            id: "group-1".to_string(),
            name: "Core".to_string(),
            focus: domain::team::TrainingFocus::Tactical,
            player_ids: vec!["older-pro".to_string()],
        }];
        game.teams[0].match_roles.captain = Some("older-pro".to_string());
        let current_date = game.clock.current_date.date_naive();

        apply_seasonal_aging(&mut game, current_date, 1);

        let veteran = &game.players[0];
        assert!(veteran.retired);
        assert_eq!(veteran.team_id, None);
        assert_eq!(
            veteran.contract_start(),
            None,
            "a retired player has no agreement, so neither date survives"
        );
        assert_eq!(veteran.contract_end(), None);
        assert!(!veteran.transfer_listed);
        assert!(veteran.attributes.pace < 20);
        assert!(game.teams[0].starting_xi_ids.is_empty());
        assert!(game.teams[0].training_groups[0].player_ids.is_empty());
        assert_eq!(game.teams[0].match_roles.captain, None);
    }

    /// Retirement ends the contract like any other exit: it is in the history, and
    /// the wage goes with it instead of being left on a player who will never play.
    #[test]
    fn retirement_appends_a_retired_entry_and_zeroes_the_wage() {
        use domain::player::PlayerMovementKind;
        let mut veteran = make_player("older-pro", "1988-01-01");
        veteran.stage_contract_start(Some("2023-07-01".to_string()));
        veteran.stage_contract_end(Some("2026-05-01".to_string()));
        veteran.stage_wage(9_000);
        veteran.stats = PlayerSeasonStats {
            appearances: 6,
            avg_rating: 6.1,
            ..PlayerSeasonStats::default()
        };
        let mut game = make_game(vec![veteran]);
        let current_date = game.clock.current_date.date_naive();

        apply_seasonal_aging(&mut game, current_date, 1);

        let veteran = &game.players[0];
        assert!(veteran.retired);
        let entry = veteran
            .movement_history
            .last()
            .expect("retirement is recorded");
        assert_eq!(entry.kind, PlayerMovementKind::Retired);
        assert_eq!(entry.from_team_id.as_deref(), Some("team1"));
        assert_eq!(veteran.wage(), 0, "no wage left on a retired player");
    }
}
