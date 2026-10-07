//! How fast players develop in a career: a per-save rule the player picks.
//!
//! The training formula is calibrated so that 1× is a realistic pace — a
//! regular starter of 18 gains a few points of overall a season and reaches his
//! ceiling in his mid-twenties. Higher settings exist for players who would
//! rather watch a prospect bloom in two seasons than in seven. It applies to
//! every player in the world, so it changes the pace of the game, not the
//! balance between clubs.

use serde::{Deserialize, Serialize};

const STEP_PERCENT: u16 = 50;
const SLOWEST_PERCENT: u16 = 100;
const FASTEST_PERCENT: u16 = 500;

/// A development pace as a percentage of the realistic one: 100 is 1×, 150 is
/// 1.5×, up to 500 (5×) in steps of 50. Stored and sent as that whole number so
/// neither a save nor the IPC boundary ever carries a float.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "u16", into = "u16")]
pub struct DevelopmentSpeed(u16);

impl DevelopmentSpeed {
    /// 1×, the realistic pace, and what every career starts with.
    pub const REALISTIC: Self = Self(SLOWEST_PERCENT);

    /// The speed for `percent`, or `None` if it is not one the game offers.
    pub fn from_percent(percent: u16) -> Option<Self> {
        let on_the_scale = (SLOWEST_PERCENT..=FASTEST_PERCENT).contains(&percent)
            && percent.is_multiple_of(STEP_PERCENT);
        on_the_scale.then_some(Self(percent))
    }

    pub fn percent(self) -> u16 {
        self.0
    }

    /// What training gains are multiplied by.
    pub fn multiplier(self) -> f64 {
        f64::from(self.0) / 100.0
    }
}

impl Default for DevelopmentSpeed {
    fn default() -> Self {
        Self::REALISTIC
    }
}

impl TryFrom<u16> for DevelopmentSpeed {
    type Error = String;

    fn try_from(percent: u16) -> Result<Self, Self::Error> {
        Self::from_percent(percent)
            .ok_or_else(|| format!("{percent}% is not a development speed the game offers"))
    }
}

impl From<DevelopmentSpeed> for u16 {
    fn from(speed: DevelopmentSpeed) -> Self {
        speed.0
    }
}

#[cfg(test)]
mod tests {
    use super::DevelopmentSpeed;

    /// Given the nine speeds on the settings scale, 1× to 5× in half steps,
    /// When each is asked for by its percentage,
    /// Then each is accepted and multiplies gains by its own factor.
    #[test]
    fn every_half_step_from_one_to_five_times_is_offered() {
        for (percent, multiplier) in [
            (100, 1.0),
            (150, 1.5),
            (200, 2.0),
            (250, 2.5),
            (300, 3.0),
            (350, 3.5),
            (400, 4.0),
            (450, 4.5),
            (500, 5.0),
        ] {
            let speed = DevelopmentSpeed::from_percent(percent)
                .unwrap_or_else(|| panic!("{percent}% should be offered"));
            assert_eq!(speed.percent(), percent);
            assert!((speed.multiplier() - multiplier).abs() < 1e-9);
        }
    }

    /// Given percentages off the scale — below 1×, above 5×, or between steps,
    /// When they are asked for,
    /// Then none is accepted.
    #[test]
    fn speeds_off_the_scale_are_refused() {
        for percent in [0, 50, 99, 125, 175, 501, 550, 1000] {
            assert_eq!(
                DevelopmentSpeed::from_percent(percent),
                None,
                "{percent}% should be refused"
            );
        }
    }

    /// Given a career that has never chosen a speed,
    /// When its speed is read,
    /// Then it is the realistic 1×.
    #[test]
    fn a_career_starts_at_the_realistic_pace() {
        assert_eq!(DevelopmentSpeed::default().percent(), 100);
        assert!((DevelopmentSpeed::default().multiplier() - 1.0).abs() < 1e-9);
    }

    /// Given a speed,
    /// When it is serialized,
    /// Then it is the bare percentage, and reads back as the same speed.
    #[test]
    fn a_speed_serializes_as_its_percentage() {
        let speed = DevelopmentSpeed::from_percent(250).expect("2.5× is offered");

        let json = serde_json::to_value(speed).expect("serializes");

        assert_eq!(json, serde_json::json!(250));
        assert_eq!(
            serde_json::from_value::<DevelopmentSpeed>(json).expect("reads back"),
            speed
        );
    }

    /// Given a stored percentage the game does not offer,
    /// When it is read,
    /// Then reading fails rather than inventing a speed.
    #[test]
    fn a_stored_speed_off_the_scale_does_not_load() {
        assert!(serde_json::from_value::<DevelopmentSpeed>(serde_json::json!(125)).is_err());
    }

    /// Given a game saved before development speed existed,
    /// When it is loaded,
    /// Then it plays at the realistic 1×.
    #[test]
    fn a_game_saved_before_development_speed_loads_at_the_realistic_pace() {
        use crate::clock::GameClock;
        use crate::game::Game;
        use chrono::{TimeZone, Utc};
        use domain::manager::Manager;

        let manager = Manager::new(
            "m1".to_string(),
            "Alex".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 7, 1, 12, 0, 0).unwrap());
        let mut game_json =
            serde_json::to_value(Game::new(clock, manager, vec![], vec![], vec![], vec![]))
                .expect("a game serializes");
        game_json
            .as_object_mut()
            .expect("a game is an object")
            .remove("development_speed");

        let game: Game = serde_json::from_value(game_json).expect("an older game loads");

        assert_eq!(game.development_speed, DevelopmentSpeed::REALISTIC);
    }
}
