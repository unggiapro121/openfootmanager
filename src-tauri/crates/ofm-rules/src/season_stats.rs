//! A player's season in numbers (phase 3, E3-7): what one match adds to it, and how a season goes
//! into his career when it ends. The game and the online server keep the same tally.

use domain::player::{CareerEntry, Player, PlayerSeasonStats, Position};
use engine::PlayerMatchStats;

/// `player`'s season after a match in which he had `stats`, his side conceding `conceded`. A
/// rating of 0 means the engine did not rate him (too few minutes to judge): it is an appearance,
/// not a rating, so a five-minute cameo is not averaged in as a 0/10 game. A goalkeeper whose side
/// kept the ball out has a clean sheet.
pub fn record_match(player: &mut Player, stats: &PlayerMatchStats, conceded: u8) {
    let season = &mut player.stats;
    season.appearances += 1;
    season.goals += u32::from(stats.goals);
    season.assists += u32::from(stats.assists);
    season.yellow_cards += u32::from(stats.yellow_cards);
    season.red_cards += u32::from(stats.red_cards);
    season.minutes_played += u32::from(stats.minutes_played);
    season.shots += u32::from(stats.shots);
    season.shots_on_target += u32::from(stats.shots_on_target);
    season.passes_completed += u32::from(stats.passes_completed);
    season.passes_attempted += u32::from(stats.passes_attempted);
    season.tackles_won += u32::from(stats.tackles_won);
    season.interceptions += u32::from(stats.interceptions);
    season.fouls_committed += u32::from(stats.fouls_committed);

    if stats.rating > 0.0 {
        season.rated_appearances += 1;
        let n = season.rated_appearances as f32;
        season.avg_rating = (season.avg_rating * (n - 1.0) + stats.rating) / n;
    }

    if matches!(player.position, Position::Goalkeeper) && conceded == 0 {
        season.clean_sheets += 1;
    }
}

/// `player`'s season `season` put into his career, at the club `team_id` named `team_name`, if he
/// played in it. The season's numbers stay until [`reset_season`]: retirement reads them first.
pub fn archive_season(player: &mut Player, season: u32, team_id: &str, team_name: &str) {
    if player.stats.appearances == 0 {
        return;
    }
    player.career.push(CareerEntry {
        season,
        team_id: team_id.to_string(),
        team_name: team_name.to_string(),
        appearances: player.stats.appearances,
        goals: player.stats.goals,
        assists: player.stats.assists,
    });
}

/// `player` at the start of a new season: no appearances yet.
pub fn reset_season(player: &mut Player) {
    player.stats = PlayerSeasonStats::default();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::uniform_attributes;

    fn player(id: &str, position: Position) -> Player {
        Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "England".to_string(),
            position,
            uniform_attributes(60),
        )
    }

    fn stats(minutes: u8, goals: u8, rating: f32) -> PlayerMatchStats {
        PlayerMatchStats {
            minutes_played: minutes,
            goals,
            assists: 1,
            shots: 3,
            shots_on_target: 2,
            passes_completed: 20,
            passes_attempted: 25,
            tackles_won: 2,
            interceptions: 1,
            fouls_committed: 1,
            yellow_cards: 1,
            red_cards: 0,
            rating,
        }
    }

    /// Given a striker,
    /// when he plays two rated matches and one unrated cameo,
    /// then every count adds up, the average is over the two rated games only, and a striker has
    /// no clean sheet.
    #[test]
    fn a_season_adds_up_and_averages_rated_games_only() {
        let mut striker = player("s", Position::Forward);
        record_match(&mut striker, &stats(90, 2, 8.0), 0);
        record_match(&mut striker, &stats(90, 0, 6.0), 1);
        record_match(&mut striker, &stats(5, 0, 0.0), 0);
        let season = &striker.stats;
        assert_eq!(season.appearances, 3);
        assert_eq!(season.rated_appearances, 2);
        assert!((season.avg_rating - 7.0).abs() < 1e-6);
        assert_eq!(season.goals, 2);
        assert_eq!(season.minutes_played, 185);
        assert_eq!(season.passes_attempted, 75);
        assert_eq!(season.clean_sheets, 0);
    }

    /// Given a goalkeeper,
    /// when his side concedes none and then one,
    /// then he has one clean sheet.
    #[test]
    fn a_goalkeeper_keeps_a_clean_sheet_when_nothing_goes_in() {
        let mut keeper = player("g", Position::Goalkeeper);
        record_match(&mut keeper, &stats(90, 0, 7.0), 0);
        record_match(&mut keeper, &stats(90, 0, 6.5), 1);
        assert_eq!(keeper.stats.clean_sheets, 1);
    }

    /// Given a player who played and one who did not,
    /// when the season is archived and reset,
    /// then only the first has a career line, and both start the next season at zero.
    #[test]
    fn a_season_played_goes_into_the_career() {
        let mut regular = player("r", Position::Midfielder);
        record_match(&mut regular, &stats(90, 1, 7.0), 0);
        let mut unused = player("u", Position::Midfielder);
        for p in [&mut regular, &mut unused] {
            archive_season(p, 3, "club-1", "Club One");
            reset_season(p);
        }
        assert_eq!(regular.career.len(), 1);
        assert_eq!(regular.career[0].season, 3);
        assert_eq!(regular.career[0].goals, 1);
        assert!(unused.career.is_empty());
        assert_eq!(regular.stats.appearances, 0);
    }
}
