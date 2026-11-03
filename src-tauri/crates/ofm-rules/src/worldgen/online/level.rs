//! A player drawn for an online bot's levelling (phase 4, S-34 S34-4, `crate::bot_level`): a
//! senior of a given group, age and overall, from the world seed by the key
//! `level/<season>/<club>/<n>`, named from the online pack like every online person. His
//! potential is drawn for his overall and age as a generated player's is, and kept under the
//! season's ceiling.
//!
//! The draws come in a fixed order; changing it changes the players a levelling signs.

use domain::player::Player;
use rand::RngExt;

use super::{GenError, Generator};
use crate::bot_level::SigningSpec;
use crate::seed::rng_for_seed;
use crate::worldgen::as_free_agent;
use crate::worldgen::calibration::calibrate_level_player;
use crate::worldgen::generation::{generate_random_player_from_def, senior_slot_for};

impl Generator<'_> {
    /// The player `spec` asks for, drawn from the stream `level/<key>` at `football_year`, his
    /// potential at most `potential_max`. Unattached: the server signs him to the bot.
    pub fn level_signing(
        &self,
        key: &str,
        spec: &SigningSpec,
        region: &str,
        football_year: u32,
        potential_max: u8,
    ) -> Result<Player, GenError> {
        let mut rng = rng_for_seed(self.seed, &format!("level/{key}"), &self.pack.version);
        // 1. nationality, by the free agents' path, from the bot's own region
        let (local, _) = self.nation_of(region, rng.random_range(0..10_000))?;
        let nation = self.nationality(region, &local)?.draw(&mut rng);
        // 2. the raw player at his age (his id from the stream)
        let mut player = generate_random_player_from_def(
            "level",
            senior_slot_for(&spec.group),
            &nation,
            football_year,
            Some(spec.age),
            &self.names_def,
            &mut rng,
        );
        // His own position before he is calibrated, so his overall is the one at it.
        crate::player_identity::upgrade_player_identity(&mut player, None);
        // 3. his overall, potential, traits, value and wage
        calibrate_level_player(
            &mut player,
            f64::from(spec.ovr),
            potential_max,
            football_year,
            &mut rng,
        );
        let mut players = [as_free_agent(player)];
        self.name_people(&mut players, &mut [])?;
        let [player] = players;
        Ok(player)
    }
}

#[cfg(test)]
mod tests {
    use domain::player::Position;

    use super::*;
    use crate::player_rating::player_age;
    use crate::worldgen::online::OnlineContentPack;

    const REGION: &str = "AsiaSoutheast";

    fn spec(group: Position, ovr: u8, age: u32) -> SigningSpec {
        SigningSpec { group, ovr, age }
    }

    /// Given the shipped pack and a spec for a 26-year-old midfielder of 77,
    /// when he is drawn,
    /// then he is a midfielder of 26, rated 76–78, his potential above his overall and at most 90,
    /// unattached and with a value.
    #[test]
    fn a_levelling_draws_the_player_it_asks_for() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(11, &pack).expect("a generator");
        let player = generator
            .level_signing(
                "13/club/0",
                &spec(Position::Midfielder, 77, 26),
                REGION,
                2038,
                90,
            )
            .expect("a player");

        assert_eq!(player.position.to_group_position(), Position::Midfielder);
        assert_eq!(player_age(&player.date_of_birth, 2038), 26);
        assert!((76..=78).contains(&player.ovr), "ovr {}", player.ovr);
        assert!(
            player.potential >= player.ovr + 2 && player.potential <= 90,
            "{}",
            player.potential
        );
        assert!(player.team_id.is_none());
        assert!(player.market_value > 0);
        assert!(!player.full_name.is_empty());
    }

    /// Given the same key twice and another key,
    /// when the player is drawn,
    /// then the same key draws the same player and another key another.
    #[test]
    fn the_same_key_draws_the_same_player() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(11, &pack).expect("a generator");
        let draw = |key: &str| {
            generator
                .level_signing(key, &spec(Position::Defender, 70, 24), REGION, 2030, 90)
                .expect("a player")
        };
        assert_eq!(draw("3/c/1").id, draw("3/c/1").id);
        assert_ne!(draw("3/c/1").id, draw("3/c/2").id);
    }

    /// Given a goalkeeper of 82 and a ceiling of 84,
    /// when many are drawn,
    /// then no potential passes 84 nor sits under his overall plus two.
    #[test]
    fn a_levelling_keeps_potential_under_its_ceiling() {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(5, &pack).expect("a generator");
        for n in 0..30 {
            let player = generator
                .level_signing(
                    &format!("9/c/{n}"),
                    &spec(Position::Goalkeeper, 82, 22),
                    REGION,
                    2034,
                    84,
                )
                .expect("a player");
            assert_eq!(player.position, Position::Goalkeeper);
            assert!(
                player.potential <= 84 && player.potential >= player.ovr + 2,
                "{} / {}",
                player.ovr,
                player.potential
            );
        }
    }
}
