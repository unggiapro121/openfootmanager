//! What an item does when a coach uses it online (phase 4, E4-1-tech-spec.md §3.5; PRD mục 6).
//! Pure, and none of it draws a random number, so a match replays the same. Every number is a
//! parameter the server's item catalogue passes (S-17); the constants here are the PRD's defaults.
//! The server checks ownership, the lineup lock and the daily and season caps before it calls.

use domain::manager::{PlayStyleMastery, StyleXp};
use domain::player::Player;
use domain::team::PlayStyle;
use serde::{Deserialize, Serialize};

use crate::mastery_xp::{MASTERY_XP_CAP, MasteryGain, bank_style_xp};
use crate::player_wear::recover_injury;

/// Condition never goes above this.
pub const MAX_CONDITION: u8 = 100;

/// Add `amount` to `player`'s condition, never above [`MAX_CONDITION`]; returns the new condition.
/// Added as it stands: a club in a league is not rested lazily first, its day's training already
/// is its recovery (PRD mục 6, bước 5). For a resting club the server rests the player first.
pub fn boost_condition(player: &mut Player, amount: u8) -> u8 {
    player.condition = player.condition.saturating_add(amount).min(MAX_CONDITION);
    player.condition
}

/// How an item treats an injury: cured at once with at most `cure_at_most` days left, otherwise
/// `reduce_days` fewer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Treatment {
    #[serde(default)]
    pub cure_at_most: Option<u32>,
    pub reduce_days: u32,
}

impl Treatment {
    /// `medkitBandage`: a day off (P4-D25).
    pub const BANDAGE: Self = Self {
        cure_at_most: None,
        reduce_days: 1,
    };
    /// `medkitAdvanced`: cured with three days or fewer left, else three days off (P4-D25).
    pub const ADVANCED: Self = Self {
        cure_at_most: Some(3),
        reduce_days: 3,
    };
}

/// Why an item could not be used.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemRefusal {
    /// A treatment on a player who is not injured.
    NotInjured,
    /// A study note on a style already at the mastery cap.
    AtCap,
    /// A study note for another tier of mastery.
    WrongTier,
}

/// Treat `player`'s injury; returns the days left, `None` once cured.
pub fn treat_injury(
    player: &mut Player,
    treatment: &Treatment,
) -> Result<Option<u32>, ItemRefusal> {
    let days = player
        .injury
        .as_ref()
        .map(|injury| injury.days_remaining)
        .ok_or(ItemRefusal::NotInjured)?;
    if treatment.cure_at_most.is_some_and(|most| days <= most) {
        player.injury = None;
    } else {
        recover_injury(player, treatment.reduce_days);
    }
    Ok(player.injury.as_ref().map(|injury| injury.days_remaining))
}

/// A study note's tier: it applies to a style whose mastery is in `[from, until)`, and gives `xp`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteTier {
    pub from: u8,
    pub until: u8,
    pub xp: u32,
}

impl NoteTier {
    /// `tacticalNoteBasic`: below 70, +100 XP.
    pub const BASIC: Self = Self {
        from: 0,
        until: 70,
        xp: 100,
    };
    /// `tacticalNoteAdvanced`: 70 to 84, +250 XP.
    pub const ADVANCED: Self = Self {
        from: 70,
        until: 85,
        xp: 250,
    };
    /// `tacticalNoteMaster`: 85 to the cap, +500 XP.
    pub const MASTER: Self = Self {
        from: 85,
        until: MASTERY_XP_CAP,
        xp: 500,
    };
}

/// Bank a study note's XP in `style`, as a match's XP is banked. Not counted in the daily match
/// cap (that counts matches); the server counts the season cap per style before it calls (P4-D22).
/// A style at the cap is refused first, so a note is never spent for nothing.
pub fn study_note(
    mastery: &mut PlayStyleMastery,
    style_xp: &mut StyleXp,
    style: &PlayStyle,
    tier: &NoteTier,
) -> Result<MasteryGain, ItemRefusal> {
    let before = mastery.for_style(style);
    if before >= MASTERY_XP_CAP {
        return Err(ItemRefusal::AtCap);
    }
    if !(tier.from..tier.until).contains(&before) {
        return Err(ItemRefusal::WrongTier);
    }
    let (mastery_before, mastery_after) = bank_style_xp(mastery, style_xp, style, tier.xp);
    Ok(MasteryGain {
        style: style.clone(),
        xp: tier.xp,
        mastery_before,
        mastery_after,
    })
}

#[cfg(test)]
mod tests {
    use domain::player::{Injury, PlayerAttributes, Position};

    use super::*;
    use crate::mastery_xp::xp_to_next;

    fn a_player() -> Player {
        Player::new(
            "p1".to_string(),
            "A. Nguyen".to_string(),
            "An Nguyen".to_string(),
            "2004-01-01".to_string(),
            "VN".to_string(),
            Position::Midfielder,
            PlayerAttributes {
                pace: 60,
                stamina: 60,
                strength: 60,
                agility: 60,
                passing: 60,
                shooting: 60,
                tackling: 60,
                dribbling: 60,
                defending: 60,
                positioning: 60,
                vision: 60,
                decisions: 60,
                composure: 60,
                aggression: 60,
                teamwork: 60,
                leadership: 60,
                handling: 30,
                reflexes: 30,
                aerial: 60,
                long_passing: 0,
                crossing: 0,
                curve: 0,
                free_kick: 0,
                long_shots: 0,
                first_touch: 0,
                heading: 0,
            },
        )
    }

    fn injured(days: u32) -> Player {
        let mut player = a_player();
        player.injury = Some(Injury {
            name: "be.injury.hamstring".to_string(),
            days_remaining: days,
        });
        player
    }

    /// Given players at condition 60 and 90,
    /// when 35 is added to each,
    /// then the first reaches 95 and the second stops at 100.
    #[test]
    fn condition_rises_by_the_amount_and_stops_at_a_hundred() {
        let mut tired = a_player();
        tired.condition = 60;
        let mut fresh = a_player();
        fresh.condition = 90;

        assert_eq!(boost_condition(&mut tired, 35), 95);
        assert_eq!(boost_condition(&mut fresh, 35), 100);
        assert_eq!(fresh.condition, 100);
    }

    /// Given players out for 1, 2, 3 and 5 days and one not injured,
    /// when the bandage and the advanced kit are used,
    /// then the bandage takes a day off (1 day: cured), the advanced kit cures 2 and 3 days at
    /// once and takes 3 off 5, and treating a fit player is refused.
    #[test]
    fn a_treatment_cures_or_takes_days_off() {
        assert_eq!(treat_injury(&mut injured(1), &Treatment::BANDAGE), Ok(None));
        assert_eq!(
            treat_injury(&mut injured(2), &Treatment::BANDAGE),
            Ok(Some(1))
        );
        assert_eq!(
            treat_injury(&mut injured(2), &Treatment::ADVANCED),
            Ok(None)
        );
        assert_eq!(
            treat_injury(&mut injured(3), &Treatment::ADVANCED),
            Ok(None)
        );
        assert_eq!(
            treat_injury(&mut injured(5), &Treatment::ADVANCED),
            Ok(Some(2))
        );
        let mut fit = a_player();
        assert_eq!(
            treat_injury(&mut fit, &Treatment::BANDAGE),
            Err(ItemRefusal::NotInjured)
        );
    }

    /// Given a coach at 50 in Counter, 75 in Possession and 99 in Attacking,
    /// when a basic note is used on Counter, and on Possession, and a master note on Attacking,
    /// then Counter banks 100 XP and rises as a match's XP would make it; Possession is the wrong
    /// tier; Attacking is at the cap (refused before its tier is looked at); nothing else moves.
    #[test]
    fn a_study_note_banks_its_xp_in_its_tier_only() {
        let mut mastery = PlayStyleMastery {
            counter: 50,
            possession: 75,
            attacking: 99,
            ..PlayStyleMastery::default()
        };
        let mut style_xp = StyleXp::default();

        let gain = study_note(
            &mut mastery,
            &mut style_xp,
            &PlayStyle::Counter,
            &NoteTier::BASIC,
        )
        .expect("in its tier");

        let mut expected = 50u8;
        let mut bank = 100u32;
        while bank >= xp_to_next(expected) {
            bank -= xp_to_next(expected);
            expected += 1;
        }
        assert_eq!(gain.mastery_before, 50);
        assert_eq!(gain.mastery_after, expected);
        assert_eq!(gain.xp, 100);
        assert_eq!(style_xp.for_style(&PlayStyle::Counter).xp, bank);
        assert_eq!(
            study_note(
                &mut mastery,
                &mut style_xp,
                &PlayStyle::Possession,
                &NoteTier::BASIC
            ),
            Err(ItemRefusal::WrongTier)
        );
        assert_eq!(
            study_note(
                &mut mastery,
                &mut style_xp,
                &PlayStyle::Attacking,
                &NoteTier::BASIC
            ),
            Err(ItemRefusal::AtCap)
        );
        assert_eq!(mastery.possession, 75);
        assert_eq!(mastery.attacking, 99);
    }

    /// Given the item numbers,
    /// when they go to JSON and back,
    /// then they are the same, in camelCase.
    #[test]
    fn item_numbers_travel_as_camel_case_json() {
        let json = serde_json::to_value(Treatment::ADVANCED).expect("serialises");
        assert_eq!(json["cureAtMost"], 3);
        let back: Treatment = serde_json::from_value(json).expect("deserialises");
        assert_eq!(back, Treatment::ADVANCED);
        let tier: NoteTier =
            serde_json::from_value(serde_json::json!({"from": 70, "until": 85, "xp": 250}))
                .expect("deserialises");
        assert_eq!(tier, NoteTier::ADVANCED);
    }
}
