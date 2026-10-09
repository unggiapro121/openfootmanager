//! A player's true ceiling is the one figure the manager never sees: the club
//! knows it only through its scouts' reads. So a `Player` serializes without
//! it — `potential` as 0 and no `Wonderkid` trait, which is derived from it —
//! everywhere the game sends players out: Tauri commands, MCP tools, `json!`
//! responses. Only storage sees the truth, and storage must ask for it by
//! serializing through [`Persisted`].
//!
//! Hiding by default is deliberate: a send that forgets to hide would leak the
//! ceiling with nothing to catch it, while a save that forgets to persist loses
//! it in a round-trip test.

use crate::player::PlayerTrait;
use serde::{Serialize, Serializer};
use std::cell::Cell;

thread_local! {
    static PERSISTING: Cell<bool> = const { Cell::new(false) };
}

/// `value` serialized for storage: players keep their true ceilings and every
/// trait. Use it for anything written to a save or a world file, never for
/// what is sent to the client.
#[derive(Debug)]
pub struct Persisted<T>(pub T);

impl<T: Serialize> Serialize for Persisted<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let _persisting = PersistingGuard::enter();
        self.0.serialize(serializer)
    }
}

/// Restores the previous state on drop, so an error part-way through — or a
/// `Persisted` nested in another — leaves the thread as it found it.
struct PersistingGuard(bool);

impl PersistingGuard {
    fn enter() -> Self {
        Self(PERSISTING.replace(true))
    }
}

impl Drop for PersistingGuard {
    fn drop(&mut self) {
        PERSISTING.set(self.0);
    }
}

fn persisting() -> bool {
    PERSISTING.get()
}

/// `Player::potential` on the wire: the truth for storage, 0 for everyone else.
pub(crate) fn potential<S: Serializer>(potential: &u8, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_u8(if persisting() { *potential } else { 0 })
}

/// `Player::traits` on the wire: all of them for storage; without `Wonderkid`,
/// which would give the ceiling away, for everyone else.
pub(crate) fn traits<S: Serializer>(
    traits: &[PlayerTrait],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if persisting() {
        traits.serialize(serializer)
    } else {
        serializer.collect_seq(
            traits
                .iter()
                .filter(|player_trait| **player_trait != PlayerTrait::Wonderkid),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::Persisted;
    use crate::player::{Player, PlayerAttributes, PlayerTrait, Position};

    fn wonderkid() -> Player {
        let attributes: PlayerAttributes = serde_json::from_value(serde_json::json!({
            "pace": 60, "stamina": 60, "strength": 60, "agility": 60, "passing": 60,
            "shooting": 60, "tackling": 60, "dribbling": 60, "defending": 60,
            "positioning": 60, "vision": 60, "decisions": 60, "composure": 60,
            "aggression": 60, "teamwork": 60, "leadership": 60, "handling": 20,
            "reflexes": 20, "aerial": 60
        }))
        .unwrap();
        let mut player = Player::new(
            "kid".to_string(),
            "Kid".to_string(),
            "Kid One".to_string(),
            "2009-01-01".to_string(),
            "GB".to_string(),
            Position::Striker,
            attributes,
        );
        player.potential = 94;
        player.traits = vec![PlayerTrait::Speedster, PlayerTrait::Wonderkid];
        player
    }

    /// Given a wonderkid with a ceiling of 94,
    /// When he is serialized as the game sends players out,
    /// Then his ceiling reads 0 and the Wonderkid trait is gone, other traits kept.
    #[test]
    fn a_player_sent_out_hides_his_ceiling() {
        let sent = serde_json::to_value(wonderkid()).unwrap();

        assert_eq!(sent["potential"], 0);
        assert_eq!(sent["traits"], serde_json::json!(["Speedster"]));
    }

    /// Given the same wonderkid,
    /// When he is serialized for storage, alone and inside a list,
    /// Then his ceiling and every trait survive a round trip.
    #[test]
    fn a_persisted_player_keeps_his_ceiling() {
        let stored = serde_json::to_string(&Persisted(&wonderkid())).unwrap();
        let loaded: Player = serde_json::from_str(&stored).unwrap();
        assert_eq!(loaded.potential, 94);
        assert_eq!(
            loaded.traits,
            vec![PlayerTrait::Speedster, PlayerTrait::Wonderkid]
        );

        let squad = serde_json::to_value(Persisted(vec![wonderkid()])).unwrap();
        assert_eq!(squad[0]["potential"], 94);
    }

    /// Given a player stored through `Persisted`,
    /// When he is serialized again afterwards without it,
    /// Then the ceiling is hidden once more: storage does not leak into sends.
    #[test]
    fn persisting_ends_with_the_write() {
        serde_json::to_value(Persisted(wonderkid())).unwrap();

        assert_eq!(serde_json::to_value(wonderkid()).unwrap()["potential"], 0);
    }
}
