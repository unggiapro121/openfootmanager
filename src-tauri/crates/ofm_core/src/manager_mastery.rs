//! A manager's command of each play style: rolled once when an AI manager is
//! created, and grown by the user's own matches (phase 2 lane M, M-2).

use domain::manager::{ALL_PLAY_STYLES, Manager, NEUTRAL_MASTERY, PlayStyleMastery, StyleXp};
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

// ---------------------------------------------------------------------------
// The user's mastery, earned by use (làn-M-tech-spec §6)
// ---------------------------------------------------------------------------

/// XP a match is worth before its result and opponent are weighed.
const MATCH_BASE_XP: f64 = 10.0;
const WIN_MULTIPLIER: f64 = 1.5;
const DRAW_MULTIPLIER: f64 = 1.0;
const LOSS_MULTIPLIER: f64 = 0.7;
/// Strength points (`S`) of difference that move a match's XP by its whole
/// base: beating a side 10 stronger is worth ×1.25, one 10 weaker ×0.75. At 40
/// every club earns about the same XP a match over a season (analysis F1).
const OPPONENT_STRENGTH_SCALE: f64 = 40.0;
const OPPONENT_MULTIPLIER_MIN: f64 = 0.5;
const OPPONENT_MULTIPLIER_MAX: f64 = 1.5;
/// The two pieces of the cost curve, chosen so that at about 11 XP a match
/// mastery reaches 60 in a season (~51 matches), 80 in ~400 and 99 in ~1,800
/// (Q-M1). They meet at 80, where a point costs 397 XP either side.
const XP_LOW_BASE: f64 = 37.7;
const XP_LOW_RATE: f64 = 0.0785;
const XP_HIGH_BASE: f64 = 397.0;
const XP_HIGH_RATE: f64 = 0.071;
const XP_CURVE_BREAK: u8 = 80;
/// Use takes mastery this far; 100 is only ever rolled for an AI manager.
const MASTERY_XP_CAP: u8 = 99;

/// A match's result, from the user's side, as XP weighs it. A shootout does
/// not count: a tie level after extra time is a draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MatchOutcome {
    Won,
    Drawn,
    Lost,
}

/// XP it costs to raise `mastery` by one point. A mastery below neutral costs
/// as neutral does.
pub(crate) fn xp_to_next(mastery: u8) -> u32 {
    let mastery = f64::from(mastery.max(NEUTRAL_MASTERY));
    let cost = if mastery < f64::from(XP_CURVE_BREAK) {
        XP_LOW_BASE * (XP_LOW_RATE * (mastery - f64::from(NEUTRAL_MASTERY))).exp()
    } else {
        XP_HIGH_BASE * (XP_HIGH_RATE * (mastery - f64::from(XP_CURVE_BREAK))).exp()
    };
    cost.round() as u32
}

/// XP a match the user managed is worth.
pub(crate) fn match_xp(outcome: MatchOutcome, own_strength: f64, opponent_strength: f64) -> u32 {
    let result = match outcome {
        MatchOutcome::Won => WIN_MULTIPLIER,
        MatchOutcome::Drawn => DRAW_MULTIPLIER,
        MatchOutcome::Lost => LOSS_MULTIPLIER,
    };
    let opponent = (1.0 + (opponent_strength - own_strength) / OPPONENT_STRENGTH_SCALE)
        .clamp(OPPONENT_MULTIPLIER_MIN, OPPONENT_MULTIPLIER_MAX);
    (MATCH_BASE_XP * result * opponent).round() as u32
}

/// Bank `xp` in `style` for `manager` and raise its mastery a point at a time
/// while the bank covers the next point, up to the cap. Returns the mastery
/// before and after.
pub(crate) fn add_style_xp(manager: &mut Manager, style: &PlayStyle, xp: u32) -> (u8, u8) {
    bank_style_xp(
        &mut manager.play_style_mastery,
        &mut manager.progression.style_xp,
        style,
        xp,
    )
}

/// [`add_style_xp`] on a mastery and its XP wherever they are kept: a manager
/// in a save, or a coach account (`coach_progress`).
pub(crate) fn bank_style_xp(
    mastery: &mut PlayStyleMastery,
    style_xp: &mut StyleXp,
    style: &PlayStyle,
    xp: u32,
) -> (u8, u8) {
    let before = mastery.for_style(style);
    let progress = style_xp.for_style_mut(style);
    progress.xp = progress.xp.saturating_add(xp);

    let mut level = before;
    while level < MASTERY_XP_CAP && progress.xp >= xp_to_next(level) {
        progress.xp -= xp_to_next(level);
        level += 1;
    }
    mastery.set(style, level);
    (before, level)
}

/// What a match the user managed did for their mastery of the style their
/// side started it in.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct MasteryGain {
    pub style: PlayStyle,
    pub xp: u32,
    pub mastery_before: u8,
    pub mastery_after: u8,
}

/// Credit a match the user managed themselves to the style their side kicked
/// off in (X99), when it is a competitive club match their club played (X97).
/// Only the "go to the field" path calls this (X106): a match handed to the
/// assistant or watched as a spectator earns nothing.
pub fn credit_managed_match(
    game: &mut crate::game::Game,
    report: &engine::MatchReport,
    competition: &domain::league::FixtureCompetition,
    home_team_id: &str,
    away_team_id: &str,
) -> Option<MasteryGain> {
    let earns_mastery = crate::manager_career::is_official(competition);
    let user_team_id = game.manager.team_id.clone()?;
    if !earns_mastery {
        return None;
    }
    let (own_goals, opponent_goals, own_sheet, opponent_id) = if user_team_id == home_team_id {
        (
            report.home_goals,
            report.away_goals,
            report.home_sheet.as_ref(),
            away_team_id,
        )
    } else if user_team_id == away_team_id {
        (
            report.away_goals,
            report.home_goals,
            report.away_sheet.as_ref(),
            home_team_id,
        )
    } else {
        return None;
    };

    let style = match own_sheet {
        Some(sheet) => crate::live_match_manager::domain_play_style(sheet.play_style),
        None => game
            .teams
            .iter()
            .find(|team| team.id == user_team_id)?
            .play_style
            .clone(),
    };
    let outcome = match own_goals.cmp(&opponent_goals) {
        std::cmp::Ordering::Greater => MatchOutcome::Won,
        std::cmp::Ordering::Equal => MatchOutcome::Drawn,
        std::cmp::Ordering::Less => MatchOutcome::Lost,
    };
    // A side whose strength cannot be read weighs as an equal one.
    let own_strength = crate::team_strength::club_strength(game, &user_team_id);
    let opponent_strength = crate::team_strength::club_strength(game, opponent_id);
    let (own, opponent) = match (own_strength, opponent_strength) {
        (Some(own), Some(opponent)) => (own.strength, opponent.strength),
        _ => (0.0, 0.0),
    };
    let xp = match_xp(outcome, own, opponent);

    let (mastery_before, mastery_after) = add_style_xp(&mut game.manager, &style, xp);
    game.manager
        .progression
        .style_xp
        .for_style_mut(&style)
        .matches += 1;
    announce_mastery_milestone(game, &style, mastery_before, mastery_after);
    game.sync_user_manager_record();

    Some(MasteryGain {
        style,
        xp,
        mastery_before,
        mastery_after,
    })
}

/// Mastery milestones the user is told about: every fifth point. One match can
/// cross several points early on, so it sends at most one message, for the
/// highest milestone it reached.
const MASTERY_MILESTONE: u8 = 5;

fn announce_mastery_milestone(
    game: &mut crate::game::Game,
    style: &PlayStyle,
    before: u8,
    after: u8,
) {
    let milestone = after - after % MASTERY_MILESTONE;
    if milestone <= before {
        return;
    }
    let message_id = format!("style_mastery_{style:?}_{milestone}");
    if crate::inbox::already_emitted(game, &message_id) {
        return;
    }
    let params: std::collections::HashMap<String, String> = [
        ("style".to_string(), format!("common.playStyles.{style:?}")),
        ("mastery".to_string(), milestone.to_string()),
    ]
    .into_iter()
    .collect();
    let today = game.clock.current_date.format("%Y-%m-%d").to_string();
    let message = domain::message::InboxMessage::new(
        message_id,
        String::new(),
        String::new(),
        String::new(),
        today,
    )
    .with_category(domain::message::MessageCategory::Training)
    .with_priority(domain::message::MessagePriority::Normal)
    .with_sender_role("")
    .with_i18n(
        "be.msg.styleMastery.subject",
        "be.msg.styleMastery.body",
        params,
    )
    .with_sender_i18n("be.sender.assistantManager", "be.role.assistantManager");
    crate::inbox::emit(game, message);
}

/// One play style as the manager screen shows it: where the user stands, how
/// far the next point is, and what the style does to the side at this mastery.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct StyleProgressView {
    pub style: PlayStyle,
    pub mastery: u8,
    /// XP banked toward the next point.
    pub xp: u32,
    /// What the next point costs; `None` once use can take it no further.
    pub xp_to_next: Option<u32>,
    pub matches: u32,
    /// The style's multipliers at this mastery, as percentages off neutral.
    pub effects: Vec<StyleEffectView>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct StyleEffectView {
    pub phase: engine::StylePhase,
    /// `+15.3` for ×1.153, `-2.94` for ×0.9706: two decimals, so every point
    /// of mastery shows — a whole percent hides most of them.
    pub percent: f64,
}

/// The user's mastery of every play style, with what one managed match against
/// an equal side is worth for each result.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ManagerProgressionView {
    pub styles: Vec<StyleProgressView>,
    pub xp_for_a_win: u32,
    pub xp_for_a_draw: u32,
    pub xp_for_a_loss: u32,
}

pub fn manager_progression_view(manager: &Manager) -> ManagerProgressionView {
    let styles = ALL_PLAY_STYLES
        .iter()
        .map(|style| {
            let mastery = manager.play_style_mastery.for_style(style);
            let progress = manager.progression.style_xp.for_style(style);
            let effects = engine::play_style_effects(
                crate::live_match_manager::engine_play_style(style),
                mastery,
            )
            .into_iter()
            .map(|(phase, multiplier)| StyleEffectView {
                phase,
                percent: ((multiplier - 1.0) * 10_000.0).round() / 100.0,
            })
            .collect();
            StyleProgressView {
                style: style.clone(),
                mastery,
                xp: progress.xp,
                xp_to_next: (mastery < MASTERY_XP_CAP).then(|| xp_to_next(mastery)),
                matches: progress.matches,
                effects,
            }
        })
        .collect();
    ManagerProgressionView {
        styles,
        xp_for_a_win: match_xp(MatchOutcome::Won, 0.0, 0.0),
        xp_for_a_draw: match_xp(MatchOutcome::Drawn, 0.0, 0.0),
        xp_for_a_loss: match_xp(MatchOutcome::Lost, 0.0, 0.0),
    }
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

    // ── Mastery earned by use ───────────────────────────────────────────────

    fn neutral_manager() -> Manager {
        manager("mgr_user", 500)
    }

    /// Given the cost curve,
    /// When the price of a point is read at its anchors,
    /// Then 50 costs 38, 79 costs 367, and 80 costs 397 (the two pieces meet).
    #[test]
    fn the_cost_of_a_point_follows_the_curve() {
        assert_eq!(xp_to_next(50), 38);
        assert_eq!(xp_to_next(79), 367);
        assert_eq!(xp_to_next(80), 397);
        assert_eq!(xp_to_next(30), 38, "below neutral costs as neutral");
    }

    /// Given a user at 50 earning 11 XP a match,
    /// When matches are played,
    /// Then mastery reaches 60 after 51 matches, 80 after 401 and 99 after
    /// 1,800 — the milestones of Q-M1 to within the rounding of each point.
    #[test]
    fn mastery_reaches_the_milestones_at_eleven_xp_a_match() {
        let mastery_after = |matches: u32| {
            let mut manager = neutral_manager();
            for _ in 0..matches {
                add_style_xp(&mut manager, &PlayStyle::Counter, 11);
            }
            manager.play_style_mastery.counter
        };

        assert_eq!(mastery_after(50), 59);
        assert_eq!(mastery_after(51), 60);
        assert_eq!(mastery_after(400), 79);
        assert_eq!(mastery_after(401), 80);
        assert_eq!(mastery_after(1_800), 99);
    }

    /// Given a user at 99,
    /// When they earn more XP,
    /// Then mastery stays at 99 and the XP is still banked.
    #[test]
    fn use_never_takes_mastery_past_ninety_nine() {
        let mut manager = neutral_manager();
        manager.play_style_mastery.possession = 99;

        let (before, after) = add_style_xp(&mut manager, &PlayStyle::Possession, 5_000);

        assert_eq!((before, after), (99, 99));
        assert_eq!(manager.progression.style_xp.possession.xp, 5_000);
    }

    /// Given XP banked in one style,
    /// When it is spent,
    /// Then only that style moves and the remainder carries over.
    #[test]
    fn xp_carries_over_within_its_own_style() {
        let mut manager = neutral_manager();

        let (before, after) = add_style_xp(&mut manager, &PlayStyle::Defensive, 40);

        assert_eq!((before, after), (50, 51));
        assert_eq!(manager.progression.style_xp.defensive.xp, 2);
        assert_eq!(manager.play_style_mastery.attacking, 50);
    }

    /// Given two sides of equal strength,
    /// When a match is won, drawn or lost,
    /// Then it is worth 15, 10 or 7 XP.
    #[test]
    fn the_result_sets_a_matchs_worth() {
        assert_eq!(match_xp(MatchOutcome::Won, 75.0, 75.0), 15);
        assert_eq!(match_xp(MatchOutcome::Drawn, 75.0, 75.0), 10);
        assert_eq!(match_xp(MatchOutcome::Lost, 75.0, 75.0), 7);
    }

    /// Given a win,
    /// When the opponent is 10 stronger, 10 weaker, or far beyond either way,
    /// Then it is worth ×1.25, ×0.75, and never more than ×1.5 or less than ×0.5.
    #[test]
    fn the_opponents_strength_weighs_a_win() {
        assert_eq!(match_xp(MatchOutcome::Won, 70.0, 80.0), 19);
        assert_eq!(match_xp(MatchOutcome::Won, 80.0, 70.0), 11);
        assert_eq!(match_xp(MatchOutcome::Won, 50.0, 90.0), 23);
        assert_eq!(match_xp(MatchOutcome::Won, 90.0, 50.0), 8);
    }

    /// Given a new user manager,
    /// When their progression is shown,
    /// Then every style is at 50 with 38 XP to the next point, Counter shows
    /// its real effect (+18% attack, -8% midfield) and Balanced none.
    #[test]
    fn a_new_managers_progression_view_is_neutral() {
        let view = manager_progression_view(&neutral_manager());

        assert_eq!(view.styles.len(), 6);
        assert!(view.styles.iter().all(|style| style.mastery == 50));
        assert!(view.styles.iter().all(|style| style.xp_to_next == Some(38)));
        let counter = view
            .styles
            .iter()
            .find(|style| style.style == PlayStyle::Counter)
            .unwrap();
        assert!(counter.effects.contains(&StyleEffectView {
            phase: engine::StylePhase::Attack,
            percent: 18.0,
        }));
        assert!(counter.effects.contains(&StyleEffectView {
            phase: engine::StylePhase::Midfield,
            percent: -8.0,
        }));
        let balanced = view
            .styles
            .iter()
            .find(|style| style.style == PlayStyle::Balanced)
            .unwrap();
        assert!(balanced.effects.is_empty());
        assert_eq!(
            (view.xp_for_a_win, view.xp_for_a_draw, view.xp_for_a_loss),
            (15, 10, 7)
        );
    }

    /// Given a Possession coach at 52, then at 100,
    /// When the progression is shown,
    /// Then each effect is given to two decimals, not rounded to a whole
    /// percent: +15.3% midfield and -2.94% attack, then +22.5% and -1.5%.
    #[test]
    fn effects_are_shown_to_two_decimals() {
        let effects_at = |mastery: u8| {
            let mut manager = neutral_manager();
            manager.play_style_mastery.possession = mastery;
            manager_progression_view(&manager)
                .styles
                .into_iter()
                .find(|style| style.style == PlayStyle::Possession)
                .unwrap()
                .effects
        };

        assert_eq!(
            effects_at(52),
            vec![
                StyleEffectView {
                    phase: engine::StylePhase::Midfield,
                    percent: 15.3,
                },
                StyleEffectView {
                    phase: engine::StylePhase::Attack,
                    percent: -2.94,
                },
            ]
        );
        assert_eq!(
            effects_at(100),
            vec![
                StyleEffectView {
                    phase: engine::StylePhase::Midfield,
                    percent: 22.5,
                },
                StyleEffectView {
                    phase: engine::StylePhase::Attack,
                    percent: -1.5,
                },
            ]
        );
    }

    /// Given a style at 99,
    /// When the progression is shown,
    /// Then it has no next point to work toward.
    #[test]
    fn a_style_at_the_cap_has_no_next_point() {
        let mut manager = neutral_manager();
        manager.play_style_mastery.counter = 99;

        let view = manager_progression_view(&manager);

        let counter = view
            .styles
            .iter()
            .find(|style| style.style == PlayStyle::Counter)
            .unwrap();
        assert_eq!(counter.xp_to_next, None);
    }
}
