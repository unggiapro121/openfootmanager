//! A manager's command of each play style, rolled once when they are created.

use domain::manager::{ALL_PLAY_STYLES, Manager, PlayStyleMastery};
use domain::team::PlayStyle;
use rand::rngs::StdRng;
use rand::{RngExt, SeedableRng};

/// Keeps this stream apart from every other draw keyed on a manager's id —
/// `generated_manager_for` seeds the person from the same id, and sharing its
/// stream would change who gets generated.
const MASTERY_SEED: u64 = 0x4d41_5354_4552_5931;

/// How far above the manager's rating their preferred style lands.
const PREFERRED_ABOVE_RATING: std::ops::RangeInclusive<i16> = 10..=20;
/// Where every other style lands around the rating. Its top stays below the
/// preferred style's bottom, so the preferred style is always strictly the best
/// and `best_style` names it — short of a rating above 90, where clamping at 100
/// can level them and `best_style` falls back to list order.
const OTHER_AROUND_RATING: std::ops::RangeInclusive<i16> = -10..=9;

/// Give `manager` a play style mastery around their overall rating
/// (`Manager::rating`), strongest in `preferred` — or, when `None`, in a style
/// of their own, drawn at random.
///
/// Seeded by the manager's id, so the same manager always rolls the same.
pub(crate) fn roll_play_style_mastery(manager: &mut Manager, preferred: Option<PlayStyle>) {
    let mut rng = StdRng::seed_from_u64(crate::stable_hash::stable_hash(
        manager.id.as_bytes(),
        MASTERY_SEED,
    ));
    let preferred = preferred
        .unwrap_or_else(|| ALL_PLAY_STYLES[rng.random_range(0..ALL_PLAY_STYLES.len())].clone());
    let rating = i16::from(manager.rating());

    let mut mastery = PlayStyleMastery::default();
    for style in ALL_PLAY_STYLES {
        let offset = if style == preferred {
            rng.random_range(PREFERRED_ABOVE_RATING)
        } else {
            rng.random_range(OTHER_AROUND_RATING)
        };
        mastery.set(&style, (rating + offset).clamp(1, 100) as u8);
    }
    manager.play_style_mastery = mastery;
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::manager::ALL_PLAY_STYLES;

    fn manager(id: &str, reputation: u32) -> Manager {
        let mut manager = Manager::new(
            id.to_string(),
            "Sam".to_string(),
            "Boss".to_string(),
            "1975-01-01".to_string(),
            "England".to_string(),
        );
        manager.reputation = reputation;
        manager
    }

    /// Given a manager appointed to a club that plays Counter,
    /// When their mastery is rolled with Counter preferred,
    /// Then Counter is strictly their best style, 10–20 above their rating,
    /// and every other style sits within 10 below to 9 above it.
    #[test]
    fn the_preferred_style_is_strictly_the_strongest() {
        for index in 0..50 {
            let mut manager = manager(&format!("mgr_{index}"), 500);
            let base = i16::from(manager.rating());

            roll_play_style_mastery(&mut manager, Some(PlayStyle::Counter));

            let mastery = manager.play_style_mastery;
            assert_eq!(mastery.best_style(), PlayStyle::Counter);
            let counter = i16::from(mastery.for_style(&PlayStyle::Counter));
            assert!(
                (base + 10..=base + 20).contains(&counter),
                "{counter} vs {base}"
            );
            for style in ALL_PLAY_STYLES.iter().filter(|s| **s != PlayStyle::Counter) {
                let value = i16::from(mastery.for_style(style));
                assert!(
                    (base - 10..=base + 9).contains(&value),
                    "{style:?} {value} vs {base}"
                );
            }
        }
    }

    /// Given the same manager rolled twice,
    /// When their mastery is rolled,
    /// Then it comes out the same: it is seeded by the manager's id.
    #[test]
    fn the_same_manager_rolls_the_same_mastery() {
        let mut first = manager("mgr_team-7", 450);
        let mut second = manager("mgr_team-7", 450);

        roll_play_style_mastery(&mut first, None);
        roll_play_style_mastery(&mut second, None);

        assert_eq!(first.play_style_mastery, second.play_style_mastery);
        assert_ne!(
            first.play_style_mastery,
            manager("x", 450).play_style_mastery
        );
    }

    /// Given many managers left to choose their own style,
    /// When their mastery is rolled,
    /// Then they do not all prefer the same style.
    #[test]
    fn managers_choosing_their_own_style_do_not_all_choose_the_same() {
        let preferred: std::collections::HashSet<_> = (0..30)
            .map(|index| {
                let mut manager = manager(&format!("mgr_{index}"), 500);
                roll_play_style_mastery(&mut manager, None);
                format!("{:?}", manager.play_style_mastery.best_style())
            })
            .collect();

        assert!(preferred.len() >= 4, "{preferred:?}");
    }

    /// Given a decorated manager whose rating is near the top of the scale,
    /// When their mastery is rolled,
    /// Then no style goes past 100.
    #[test]
    fn mastery_never_exceeds_one_hundred() {
        let mut manager = manager("mgr_legend", 900);
        manager.career_stats.matches_managed = 600;
        manager.career_stats.wins = 450;
        manager.career_stats.trophies = 20;

        roll_play_style_mastery(&mut manager, Some(PlayStyle::Possession));

        assert!(manager.rating() >= 90);
        for style in ALL_PLAY_STYLES {
            assert!(manager.play_style_mastery.for_style(&style) <= 100);
        }
        assert_eq!(manager.play_style_mastery.possession, 100);
    }
}
