//! What a player is worth on the market, and what his ability earns him a week.
//!
//! Prices sit on a real-world scale. A first-team regular costs a few million, a
//! star tens of millions and the best handful of players near the record fees,
//! because value climbs exponentially with ability. The quadratic it replaces
//! made a 90-rated player barely twice the price of a 60-rated one.

use chrono::NaiveDate;
use domain::player::{Player, Position};

use crate::contracts::{MINIMUM_DEFAULT_WAGE, player_age_on};

/// Value of a player rated [`VALUE_ANCHOR_OVR`], at his peak, at a club of
/// ordinary standing.
const VALUE_AT_ANCHOR: f64 = 15_000_000.0;
const VALUE_ANCHOR_OVR: f64 = 75.0;
/// Growth per rating point: about ×2.3 every five points, the way fees climb
/// from squad player to star.
const VALUE_GROWTH_PER_POINT: f64 = 0.17;
/// Above this rating the curve flattens, so the few world-class players land
/// near real record fees (about €220M) instead of running away from them.
const ELITE_OVR: f64 = 85.0;
const ELITE_GROWTH_PER_POINT: f64 = 0.08;
/// The most growth room the market pays for. A ceiling far above a player's
/// current level is a scout's hope, not a fee anyone pays in full.
const MAX_PRICED_GROWTH_ROOM: u8 = 12;
const MINIMUM_MARKET_VALUE: u64 = 25_000;

/// A year's pay as a share of what the player's ability is worth: about what a
/// top-flight regular earns against his fee.
const ANNUAL_WAGE_SHARE_OF_VALUE: f64 = 0.12;
const WEEKS_PER_YEAR: f64 = 52.0;

/// Reputation at which a club counts as the top of the game. Reputation runs
/// to about 950 in a generated world.
pub(crate) const TOP_REPUTATION: f64 = 900.0;
/// Standing of a player with no club: he is priced as if he were at a modest one.
const FREE_AGENT_STANDING_FACTOR: f64 = 0.85;

/// Market-value bands that decide how important, newsworthy or expensive to keep
/// a player is. They replace thresholds that were written for the old scale, on
/// which nearly every professional counted as a star.
pub(crate) const STAR_VALUE: u64 = 30_000_000;
pub(crate) const NOTABLE_VALUE: u64 = 10_000_000;
pub(crate) const REGULAR_VALUE: u64 = 3_000_000;
pub(crate) const LOW_VALUE: u64 = 500_000;

/// What the player is worth on `date`, playing for a club of `club_reputation`
/// (`None` for a free agent).
pub fn market_value(player: &Player, club_reputation: Option<u32>, date: NaiveDate) -> u64 {
    let age = player_age_on(date, &player.date_of_birth);
    let value = ability_value(effective_rating(player, age))
        * age_factor(age)
        * position_factor(&crate::player_rating::primary_position(player))
        * standing_factor(club_reputation)
        * form_factor(player.match_form);
    round_value(value as u64).max(MINIMUM_MARKET_VALUE)
}

/// The weekly wage the player's current ability commands at a club of
/// `club_reputation`, before the club's own means are taken into account.
///
/// Age and potential are left out on purpose. An ageing star still earns like a
/// star, and a prospect is paid for what he can do today.
pub(crate) fn market_wage(player: &Player, club_reputation: Option<u32>) -> u32 {
    let weekly = ability_value(f64::from(current_rating(player)))
        * position_factor(&crate::player_rating::primary_position(player))
        * standing_factor(club_reputation)
        * ANNUAL_WAGE_SHARE_OF_VALUE
        / WEEKS_PER_YEAR;
    weekly_wage_from(weekly)
}

fn weekly_wage_from(weekly: f64) -> u32 {
    let floor = MINIMUM_DEFAULT_WAGE as f64;
    weekly.clamp(floor, f64::from(u32::MAX)) as u32
}

/// Move a stored value part of the way toward a freshly computed one. A week of
/// good form or a growth spurt nudges the price instead of jumping it.
pub(crate) fn drift_toward(current: u64, target: u64) -> u64 {
    const SHARE_OF_GAP_CLOSED: f64 = 0.4;
    if current == 0 {
        return target;
    }
    let gap = target as f64 - current as f64;
    let moved = round_value((current as f64 + gap * SHARE_OF_GAP_CLOSED).max(0.0) as u64)
        .max(MINIMUM_MARKET_VALUE);
    // Rounding can pin a value one step short of its target forever.
    if moved == current { target } else { moved }
}

fn current_rating(player: &Player) -> u8 {
    if player.ovr > 0 {
        player.ovr
    } else {
        crate::player_rating::natural_ovr(player).round() as u8
    }
}

/// Ability plus the share of the player's remaining growth the market already
/// pays for. The younger he is, the more of his ceiling is priced in.
fn effective_rating(player: &Player, age: i32) -> f64 {
    let ovr = current_rating(player);
    let growth_room = player
        .potential
        .saturating_sub(ovr)
        .min(MAX_PRICED_GROWTH_ROOM);
    f64::from(ovr) + f64::from(growth_room) * potential_weight(age)
}

fn potential_weight(age: i32) -> f64 {
    match age {
        ..=19 => 0.6,
        20..=21 => 0.45,
        22..=23 => 0.25,
        24 => 0.1,
        _ => 0.0,
    }
}

fn ability_value(rating: f64) -> f64 {
    let ordinary_points = rating.min(ELITE_OVR) - VALUE_ANCHOR_OVR;
    let elite_points = (rating - ELITE_OVR).max(0.0);
    VALUE_AT_ANCHOR
        * (VALUE_GROWTH_PER_POINT * ordinary_points + ELITE_GROWTH_PER_POINT * elite_points).exp()
}

/// Peak years are 20–27. The youngest carry a risk discount even after their
/// potential is priced in, and value falls away fast past thirty.
fn age_factor(age: i32) -> f64 {
    match age {
        ..=17 => 0.7,
        18 => 0.85,
        19 => 0.9,
        20..=27 => 1.0,
        28 => 0.92,
        29 => 0.82,
        30 => 0.7,
        31 => 0.55,
        32 => 0.42,
        33 => 0.3,
        34 => 0.2,
        _ => 0.12,
    }
}

/// Goalscorers and creators fetch the highest fees and keepers the lowest, at
/// the same level of ability.
fn position_factor(position: &Position) -> f64 {
    match position {
        Position::Goalkeeper => 0.6,
        Position::Defender
        | Position::CenterBack
        | Position::RightBack
        | Position::LeftBack
        | Position::RightWingBack
        | Position::LeftWingBack => 0.85,
        Position::DefensiveMidfielder => 0.9,
        Position::Midfielder
        | Position::CentralMidfielder
        | Position::RightMidfielder
        | Position::LeftMidfielder => 1.0,
        Position::AttackingMidfielder | Position::RightWinger | Position::LeftWinger => 1.1,
        Position::Forward | Position::Striker => 1.15,
    }
}

/// The premium of playing for a big club in a rich league: up to a fifth on top
/// at the very top, a quarter off at the bottom.
fn standing_factor(club_reputation: Option<u32>) -> f64 {
    match club_reputation {
        Some(reputation) => (0.75 + 0.45 * f64::from(reputation) / TOP_REPUTATION).clamp(0.75, 1.2),
        None => FREE_AGENT_STANDING_FACTOR,
    }
}

/// Recent form moves the price a little: up to 15% for a player in excellent
/// form, down to 10% for one in a poor run. Ordinary form (6.0) is neutral.
fn form_factor(match_form: u8) -> f64 {
    const ORDINARY_FORM: f64 = 60.0;
    (1.0 + (f64::from(match_form) - ORDINARY_FORM) * 0.01).clamp(0.9, 1.15)
}

/// Prices are quoted the way the market quotes them: to the nearest 25k under a
/// million, 100k under ten million, 500k under a hundred million, then millions.
fn round_value(value: u64) -> u64 {
    let step = match value {
        ..1_000_000 => 25_000,
        1_000_000..10_000_000 => 100_000,
        10_000_000..100_000_000 => 500_000,
        _ => 1_000_000,
    };
    (value + step / 2) / step * step
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 1).expect("valid date")
    }

    fn player(position: Position, born: &str, ovr: u8, potential: u8) -> Player {
        let mut player = Player::new(
            "p1".to_string(),
            "P. One".to_string(),
            "Player One".to_string(),
            born.to_string(),
            "GB".to_string(),
            position.clone(),
            crate::test_support::uniform_attributes(60),
        );
        player.natural_position = position;
        player.ovr = ovr;
        player.potential = potential;
        player
    }

    /// Given two peak-age midfielders at the same club, rated 70 and 85,
    /// When both are valued,
    /// Then the 85 costs well over ten times as much, as real fees do.
    #[test]
    fn value_climbs_exponentially_with_ability() {
        let squad_player = player(Position::CentralMidfielder, "2001-01-01", 70, 70);
        let star = player(Position::CentralMidfielder, "2001-01-01", 85, 85);

        let squad_value = market_value(&squad_player, Some(500), date());
        let star_value = market_value(&star, Some(500), date());

        assert!(
            star_value > squad_value * 10,
            "star {star_value} vs squad player {squad_value}"
        );
    }

    /// Given a peak-age striker rated 85 at a top club,
    /// When he is valued,
    /// Then he is priced on the real-world scale, between €60M and €150M.
    #[test]
    fn a_star_is_priced_on_the_real_world_scale() {
        let striker = player(Position::Striker, "2001-01-01", 85, 85);

        let value = market_value(&striker, Some(850), date());

        assert!((60_000_000..=150_000_000).contains(&value), "{value}");
    }

    /// Given two 18-year-olds of the same ability, one with a far higher ceiling,
    /// When both are valued,
    /// Then the market pays for the higher potential.
    #[test]
    fn potential_raises_a_young_players_value() {
        let limited = player(Position::LeftWinger, "2008-01-01", 70, 72);
        let prospect = player(Position::LeftWinger, "2008-01-01", 70, 90);

        assert!(
            market_value(&prospect, Some(500), date())
                > market_value(&limited, Some(500), date()) * 5 / 2
        );
    }

    /// Given two 18-year-olds of the same ability, one with a ceiling twelve
    /// points up and one with a ceiling near the very top,
    /// When both are valued,
    /// Then they cost the same: the market pays for twelve points of growth at most.
    #[test]
    fn only_twelve_points_of_growth_are_priced() {
        let promising = player(Position::LeftWinger, "2008-01-01", 70, 82);
        let dreamer = player(Position::LeftWinger, "2008-01-01", 70, 99);

        assert_eq!(
            market_value(&dreamer, Some(500), date()),
            market_value(&promising, Some(500), date())
        );
    }

    /// Given a 33-year-old and a 25-year-old of the same ability,
    /// When both are valued,
    /// Then the veteran is worth well under half as much.
    #[test]
    fn value_falls_away_past_thirty() {
        let veteran = player(Position::Striker, "1993-01-01", 78, 78);
        let peak = player(Position::Striker, "2001-01-01", 78, 78);

        assert!(
            market_value(&veteran, Some(500), date()) * 2 < market_value(&peak, Some(500), date())
        );
    }

    /// Given a keeper and a striker of the same age and ability,
    /// When both are valued,
    /// Then the keeper is the cheaper.
    #[test]
    fn keepers_are_cheaper_than_strikers_of_the_same_level() {
        let keeper = player(Position::Goalkeeper, "2001-01-01", 80, 80);
        let striker = player(Position::Striker, "2001-01-01", 80, 80);

        assert!(
            market_value(&keeper, Some(500), date()) < market_value(&striker, Some(500), date())
        );
    }

    /// Given the same player in excellent form and in a poor run,
    /// When he is valued each way,
    /// Then form moves the price, up when he is playing well.
    #[test]
    fn form_moves_the_price() {
        let mut in_form = player(Position::Striker, "2001-01-01", 75, 75);
        in_form.match_form = 75;
        let mut out_of_form = in_form.clone();
        out_of_form.match_form = 50;

        assert!(
            market_value(&in_form, Some(500), date())
                > market_value(&out_of_form, Some(500), date())
        );
    }

    /// Given a player who has improved since he was last priced,
    /// When his stored value drifts toward the new one,
    /// Then it moves part of the way, and lands on the target once close enough.
    #[test]
    fn value_drifts_toward_the_new_price() {
        let moved = drift_toward(10_000_000, 20_000_000);
        assert!(moved > 10_000_000 && moved < 20_000_000, "{moved}");

        assert_eq!(drift_toward(20_000_000, 20_100_000), 20_100_000);
        assert_eq!(drift_toward(0, 5_000_000), 5_000_000);
    }

    /// Given a player of modest ability,
    /// When his market wage is worked out,
    /// Then it never falls below the game's minimum wage.
    #[test]
    fn market_wage_has_a_floor() {
        let journeyman = player(Position::CenterBack, "1990-01-01", 30, 30);

        assert_eq!(
            market_wage(&journeyman, Some(100)),
            MINIMUM_DEFAULT_WAGE as u32
        );
    }

    /// Given an 85-rated striker at a top club,
    /// When his market wage is worked out,
    /// Then it is a star's wage, in the hundreds of thousands a week.
    #[test]
    fn a_stars_market_wage_is_on_the_real_world_scale() {
        let striker = player(Position::Striker, "2001-01-01", 85, 85);

        let wage = market_wage(&striker, Some(850));

        assert!((150_000..=400_000).contains(&wage), "{wage}");
    }
}
