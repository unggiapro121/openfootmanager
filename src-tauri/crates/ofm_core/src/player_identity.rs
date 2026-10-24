use crate::game::Game;
use crate::player_rating::formation_slots;
use chrono::Datelike;
use domain::player::{Player, Position};
pub use ofm_rules::player_identity::upgrade_player_identity;
use std::collections::HashMap;

pub fn upgrade_game_player_identities(game: &mut Game) -> bool {
    let slot_map = build_assigned_slot_map(game);
    let reputations = crate::economy::club_reputations(game);
    let today = game.clock.current_date.date_naive();
    let mut changed = false;

    for player in &mut game.players {
        let natural_before = player.natural_position.clone();
        if upgrade_player_identity(player, slot_map.get(&player.id)) {
            changed = true;
            if player.natural_position != natural_before {
                let reputation = player
                    .team_id
                    .as_deref()
                    .and_then(|team_id| reputations.get(team_id).copied());
                rate_at_new_natural_position(player, reputation, today);
            }
        }
    }

    changed
}

/// Settle a player's ratings on the natural position he was just given.
///
/// A player known only by his group was rated, given a ceiling and priced as the
/// position that group stands for (a defender as a centre-back). Once he has a
/// position of his own, those figures have to follow it, or his profile shows an
/// overall no slot on the pitch gives him. His ceiling moves by as much as his
/// overall, so the room he has to grow is the room he was drawn with. His wage is
/// a contract term and stays as agreed.
fn rate_at_new_natural_position(
    player: &mut Player,
    club_reputation: Option<u32>,
    today: chrono::NaiveDate,
) {
    let old_ovr = i16::from(player.ovr);
    let new_ovr = crate::player_rating::natural_ovr(player).round() as u8;
    if old_ovr > 0 && player.potential > 0 {
        let shifted = i16::from(player.potential) + i16::from(new_ovr) - old_ovr;
        player.potential = shifted.clamp(i16::from(new_ovr.max(1)), 99) as u8;
    }
    crate::player_rating::refresh_player_derived(player, today.year().unsigned_abs());
    player.market_value = crate::economy::valuation::market_value(player, club_reputation, today);
}

fn build_assigned_slot_map(game: &Game) -> HashMap<String, Position> {
    let mut slot_map = HashMap::new();

    for team in &game.teams {
        let slots = formation_slots(&team.formation);
        for (index, player_id) in team.starting_xi_ids.iter().enumerate() {
            if let Some(slot) = slots.get(index) {
                slot_map.insert(player_id.clone(), slot.clone());
            }
        }
    }

    slot_map
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::player::PlayerAttributes;
    use domain::team::Team;

    fn make_player(id: &str, position: Position, attrs: PlayerAttributes) -> Player {
        Player::new(
            id.to_string(),
            format!("{}. Test", id),
            format!("{} Test", id),
            "2000-01-01".to_string(),
            "GB".to_string(),
            position,
            attrs,
        )
    }

    fn make_team() -> Team {
        Team::new(
            "team-1".to_string(),
            "Test FC".to_string(),
            "TFC".to_string(),
            "GB".to_string(),
            "London".to_string(),
            "Test Stadium".to_string(),
            25000,
        )
    }

    fn make_manager() -> Manager {
        Manager::new(
            "mgr-1".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "GB".to_string(),
        )
    }

    #[test]
    fn upgrade_game_player_identities_uses_team_slot_context() {
        let start = Utc.with_ymd_and_hms(2026, 7, 1, 0, 0, 0).unwrap();
        let clock = GameClock::new(start);
        let mut team = make_team();
        team.formation = "4-4-2".to_string();
        team.starting_xi_ids = vec![
            "p-gk".to_string(),
            "p-lb".to_string(),
            "p-cb1".to_string(),
            "p-cb2".to_string(),
            "p-rb".to_string(),
            "p-lm".to_string(),
            "p-cm1".to_string(),
            "p-cm2".to_string(),
            "p-rm".to_string(),
            "p-st1".to_string(),
            "p-st2".to_string(),
        ];

        let mut right_back = make_player(
            "p-rb",
            Position::Defender,
            PlayerAttributes {
                pace: 84,
                stamina: 82,
                strength: 63,
                agility: 72,
                passing: 64,
                shooting: 40,
                tackling: 77,
                dribbling: 62,
                defending: 72,
                positioning: 66,
                vision: 58,
                decisions: 64,
                composure: 60,
                aggression: 64,
                teamwork: 74,
                leadership: 44,
                handling: 20,
                reflexes: 20,
                aerial: 46,
                long_passing: 0,
                crossing: 0,
                curve: 0,
                free_kick: 0,
                long_shots: 0,
                first_touch: 0,
                heading: 0,
            },
        );
        right_back.team_id = Some("team-1".to_string());

        let mut striker = make_player(
            "p-st1",
            Position::Forward,
            PlayerAttributes {
                pace: 78,
                stamina: 70,
                strength: 76,
                agility: 68,
                passing: 56,
                shooting: 84,
                tackling: 32,
                dribbling: 71,
                defending: 36,
                positioning: 83,
                vision: 58,
                decisions: 74,
                composure: 70,
                aggression: 66,
                teamwork: 62,
                leadership: 40,
                handling: 20,
                reflexes: 20,
                aerial: 68,
                long_passing: 0,
                crossing: 0,
                curve: 0,
                free_kick: 0,
                long_shots: 0,
                first_touch: 0,
                heading: 0,
            },
        );
        striker.team_id = Some("team-1".to_string());

        let game = &mut Game::new(
            clock,
            make_manager(),
            vec![team],
            vec![right_back, striker],
            vec![],
            vec![],
        );

        let changed = upgrade_game_player_identities(game);

        assert!(changed);
        assert_eq!(game.players[0].natural_position, Position::RightBack);
        assert_eq!(game.players[1].natural_position, Position::Striker);
    }

    fn hill_attributes() -> PlayerAttributes {
        PlayerAttributes {
            pace: 70,
            stamina: 91,
            strength: 80,
            agility: 86,
            passing: 41,
            shooting: 92,
            tackling: 88,
            dribbling: 41,
            defending: 80,
            positioning: 95,
            vision: 43,
            decisions: 90,
            composure: 63,
            aggression: 79,
            teamwork: 70,
            leadership: 54,
            handling: 27,
            reflexes: 46,
            aerial: 76,
            // Each split attribute at its family's value, so the blends read
            // exactly as the attributes this fixture was written with.
            long_passing: 41,
            crossing: 41,
            curve: 41,
            free_kick: 41,
            long_shots: 92,
            first_touch: 41,
            heading: 76,
        }
    }

    /// A club whose left-back slot holds `player`, on 4 Aug 2026.
    fn game_with_left_back(player: Player) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 8, 4, 0, 0, 0).unwrap());
        let mut team = make_team();
        team.formation = "4-4-2".to_string();
        team.reputation = 700;
        team.starting_xi_ids = vec!["p-gk".to_string(), player.id.clone()];
        Game::new(
            clock,
            make_manager(),
            vec![team],
            vec![player],
            vec![],
            vec![],
        )
    }

    /// A defender known only by his group, rated as the centre-back the group
    /// stands for (83, potential 99).
    fn group_rated_defender() -> Player {
        let mut player = make_player("p-hill", Position::Defender, hill_attributes());
        player.team_id = Some("team-1".to_string());
        player.potential = 99;
        crate::player_rating::refresh_player_derived(&mut player, 2026);
        player.market_value = 76_000_000;
        player.stage_wage(97_442);
        player
    }

    /// Given a defender rated as a centre-back (83) while he stands in the
    /// left-back slot, when his position is made granular, then he is a left-back
    /// rated as one, and his potential drops by as much as his overall did.
    #[test]
    fn a_defender_made_a_left_back_is_rated_as_one() {
        let player = group_rated_defender();
        assert_eq!(player.ovr, 83, "fixture: rated as a centre-back");
        let left_back_rating =
            crate::player_rating::ovr_for_position(&player, &Position::LeftBack).round() as u8;
        let mut game = game_with_left_back(player);

        upgrade_game_player_identities(&mut game);

        let hill = &game.players[0];
        assert_eq!(hill.natural_position, Position::LeftBack);
        assert_eq!(hill.ovr, left_back_rating);
        assert_eq!(hill.potential, 99 - (83 - left_back_rating));
    }

    /// Given the same defender, when his position is made granular, then his
    /// market value is priced again at once from his new overall, and the wage
    /// on his contract is left as it was.
    #[test]
    fn a_defender_made_a_left_back_is_repriced_but_keeps_his_wage() {
        let mut game = game_with_left_back(group_rated_defender());

        upgrade_game_player_identities(&mut game);

        let hill = &game.players[0];
        let today = game.clock.current_date.date_naive();
        assert_eq!(
            hill.market_value,
            crate::economy::valuation::market_value(hill, Some(700), today)
        );
        assert_eq!(hill.wage(), 97_442);
    }

    /// Given a player whose natural position is already granular and whose
    /// stored ratings disagree with it, when identities are upgraded, then
    /// nothing about him is recomputed: only a change of position does that.
    #[test]
    fn a_player_already_granular_keeps_his_ratings() {
        let mut player = group_rated_defender();
        player.natural_position = Position::LeftBack;
        player.alternate_positions = vec![Position::CenterBack];
        let mut game = game_with_left_back(player);

        upgrade_game_player_identities(&mut game);

        let hill = &game.players[0];
        assert_eq!(
            (hill.ovr, hill.potential, hill.market_value),
            (83, 99, 76_000_000)
        );
    }
}
