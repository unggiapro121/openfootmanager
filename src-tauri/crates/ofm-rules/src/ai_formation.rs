//! Which shape an AI club lines up in (phase 2, GĐ5 P5.1, decision X83).
//!
//! Until P5.1 every AI club played the default 4-4-2 and never changed it
//! outside a match (`Team::new`; only the engine's in-match `bolder_formation`
//! moved off it), so the real world was 4-4-2 against 4-4-2 and everything
//! GĐ5 calibrates on it would have shifted the day clubs started choosing.
//!
//! A club scores each of the nine shapes the game offers as
//!
//! ```text
//! fit(f)   = mean slot rating of the eleven it would pick for f
//!            (the AI's own first-choice eleven, `first_choice_eleven`)
//! score(f) = fit(f) + STYLE_FORMATION_BONUS[style][f]
//! ```
//!
//! and plays the best. **The style decides most of it** (X83, condition 2):
//! on the real-world package the best shape beats 4-4-2 by a median 0.54 of
//! an OVR point (p90 1.55), so a one-point bonus outweighs the squad for most
//! clubs. The fit is what keeps the choice sane — a squad with no wide
//! players does not end up in a shape that needs four of them — not what
//! drives it.
//!
//! Deterministic: the same squad gives the same shape whatever order it is
//! stored in, and ties go to the earlier shape in [`AI_FORMATIONS`].

use domain::player::Player;
use domain::team::PlayStyle;

use crate::player_rating::{formation_slots, positional_fit_for_assignment};
use crate::squad::first_choice_eleven;

/// The shapes an AI club chooses between: the nine the game offers
/// (`ui/components/match/types.ts`), in the order ties are broken.
pub const AI_FORMATIONS: [&str; 9] = engine::FORMATIONS;

/// How far, in OVR points, a new shape must beat the one a club already plays
/// before it changes. The weekly review is already a hysteresis against
/// day-to-day noise; this one is against a knock to one player swinging a
/// shape the squad was built for (X83).
pub const HYSTERESIS: f64 = 0.5;

/// What a style adds to a shape's fit, in OVR points (X83).
///
/// This is the main lever, on purpose: fits differ by about half a point
/// between shapes, so the full bonus picks the shape for most clubs, and the
/// fit only overrules it when the squad really cannot play it. If a shape
/// proves too weak in the engine for how often clubs reach for it (5-3-2 is
/// the one to watch, X83 condition 3), it is cut here, not in the engine.
fn style_formation_bonus(style: &PlayStyle, formation: &str) -> f64 {
    const FULL: f64 = 1.0;
    const HALF: f64 = 0.5;
    let (full, half): (&[&str], &[&str]) = match style {
        PlayStyle::Balanced => (&[], &[]),
        PlayStyle::Attacking => (&["4-3-3", "3-4-3"], &["4-2-3-1"]),
        PlayStyle::Defensive => (&["5-3-2", "4-5-1"], &["4-1-4-1"]),
        PlayStyle::Possession => (&["4-3-3", "4-2-3-1"], &["4-1-4-1"]),
        PlayStyle::Counter => (&["4-4-2", "4-2-3-1"], &["3-5-2"]),
        PlayStyle::HighPress => (&["4-3-3", "4-2-3-1"], &["3-4-2-1"]),
    };
    if full.contains(&formation) {
        FULL
    } else if half.contains(&formation) {
        HALF
    } else {
        0.0
    }
}

/// The mean slot rating of the eleven the club would pick for `formation`
/// from `available`: the same eleven its matchday selection starts from, so
/// the shape and the side that takes the field never disagree. An empty slot
/// counts as zero, which is what a squad that cannot fill a shape deserves.
pub fn formation_fit(available: &[&Player], formation: &str) -> f64 {
    let slots = formation_slots(formation);
    if slots.is_empty() {
        return 0.0;
    }
    let eleven = first_choice_eleven(available, formation);
    let total: f64 = slots
        .iter()
        .zip(eleven.iter())
        .map(|(slot, player)| positional_fit_for_assignment(player, slot))
        .sum();
    total / slots.len() as f64
}

fn score(available: &[&Player], style: &PlayStyle, formation: &str) -> f64 {
    formation_fit(available, formation) + style_formation_bonus(style, formation)
}

/// The shape a club with these players and this style would choose with no
/// shape of its own yet: at world creation, and for a national side.
pub fn best_formation(available: &[&Player], style: &PlayStyle) -> &'static str {
    best_formation_among(available, style, &AI_FORMATIONS).unwrap_or(AI_FORMATIONS[0])
}

/// The best of `shapes` for these players and this style; `None` when there is none to choose.
fn best_formation_among<'a>(
    available: &[&Player],
    style: &PlayStyle,
    shapes: &[&'a str],
) -> Option<&'a str> {
    let mut best = None;
    let mut best_score = f64::NEG_INFINITY;
    for formation in shapes {
        let value = score(available, style, formation);
        // Strictly greater: a tie keeps the earlier shape.
        if value > best_score {
            best = Some(*formation);
            best_score = value;
        }
    }
    best
}

/// Fewer available players than this and a club has nothing to judge a shape
/// by: every fit would be mostly empty slots, and the style bonus alone would
/// move it. It keeps what it has.
const ENOUGH_TO_JUDGE: usize = 11;

/// The shape a club opens a world in: the best one for its squad and style,
/// with no hysteresis, because the default it was built with is nobody's
/// choice. A club that cannot field eleven keeps the default.
pub fn opening_formation(current: &str, available: &[&Player], style: &PlayStyle) -> String {
    if available.len() < ENOUGH_TO_JUDGE {
        return current.to_string();
    }
    best_formation(available, style).to_string()
}

/// The shape a club playing `current` moves to at its weekly review: the best
/// shape if it beats the current one by [`HYSTERESIS`], otherwise the current
/// one. A shape outside [`AI_FORMATIONS`] (an old save, a hand-edited world)
/// is always replaced. A club that cannot field eleven keeps its shape.
pub fn reviewed_formation(current: &str, available: &[&Player], style: &PlayStyle) -> String {
    reviewed_formation_within(current, available, style, &AI_FORMATIONS)
}

/// [`reviewed_formation`] choosing only among `open`, the shapes a licence opens (phase 3, S-9).
/// A shape the licence closes is always replaced, even by a squad too thin to judge: the licence,
/// not the squad, rules it out. With every shape open this is [`reviewed_formation`] exactly.
pub fn reviewed_formation_within(
    current: &str,
    available: &[&Player],
    style: &PlayStyle,
    open: &[&str],
) -> String {
    let closed_by_licence = AI_FORMATIONS.contains(&current) && !open.contains(&current);
    if closed_by_licence {
        return best_formation_among(available, style, open)
            .unwrap_or(current)
            .to_string();
    }
    if available.len() < ENOUGH_TO_JUDGE {
        return current.to_string();
    }
    let Some(best) = best_formation_among(available, style, open) else {
        return current.to_string();
    };
    if !open.contains(&current) {
        return best.to_string();
    }
    if best == current {
        return current.to_string();
    }
    let gain = score(available, style, best) - score(available, style, current);
    if gain >= HYSTERESIS {
        best.to_string()
    } else {
        current.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::uniform_attributes;
    use domain::player::{Footedness, Position};

    fn player(id: &str, position: Position, value: u8) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "1998-01-01".to_string(),
            "GB".to_string(),
            position,
            uniform_attributes(value),
        );
        // Either foot: the shapes differ in how many left-sided slots they
        // have, and the tests are about the squad, not the feet.
        player.footedness = Footedness::Both;
        player
    }

    fn squad(positions: &[(Position, u8)]) -> Vec<Player> {
        positions
            .iter()
            .enumerate()
            .map(|(i, (position, value))| player(&format!("p{i:02}"), position.clone(), *value))
            .collect()
    }

    fn refs(players: &[Player]) -> Vec<&Player> {
        players.iter().collect()
    }

    /// A squad that suits every shape about as well: two of each slot type.
    fn rounded_squad() -> Vec<Player> {
        use Position::*;
        squad(&[
            (Goalkeeper, 70),
            (LeftBack, 70),
            (RightBack, 70),
            (CenterBack, 70),
            (CenterBack, 70),
            (CenterBack, 70),
            (DefensiveMidfielder, 70),
            (CentralMidfielder, 70),
            (CentralMidfielder, 70),
            (AttackingMidfielder, 70),
            (AttackingMidfielder, 70),
            (LeftMidfielder, 70),
            (RightMidfielder, 70),
            (LeftWinger, 70),
            (RightWinger, 70),
            (Striker, 70),
            (Striker, 70),
        ])
    }

    /// Given one squad stored in two orders,
    /// when each style chooses a shape for it,
    /// then both orders choose the same shape.
    #[test]
    fn the_same_squad_chooses_the_same_shape_in_any_order() {
        let players = rounded_squad();
        let forward = refs(&players);
        let mut backward = forward.clone();
        backward.reverse();
        for style in [
            PlayStyle::Balanced,
            PlayStyle::Attacking,
            PlayStyle::Defensive,
            PlayStyle::Possession,
            PlayStyle::Counter,
            PlayStyle::HighPress,
        ] {
            assert_eq!(
                best_formation(&forward, &style),
                best_formation(&backward, &style),
                "{style:?}"
            );
        }
    }

    /// Given a squad with full backs and a central core but nobody who plays wide,
    /// when a balanced club chooses a shape,
    /// then it is neither of the shapes built on two wide midfielders and two strikers or five across.
    #[test]
    fn a_squad_with_no_wide_players_avoids_the_shapes_that_need_four() {
        use Position::*;
        // Full backs and a central core, nobody who plays wide in midfield or
        // up front.
        let players = squad(&[
            (Goalkeeper, 70),
            (LeftBack, 70),
            (RightBack, 70),
            (CenterBack, 70),
            (CenterBack, 70),
            (CenterBack, 70),
            (DefensiveMidfielder, 70),
            (CentralMidfielder, 70),
            (CentralMidfielder, 70),
            (CentralMidfielder, 70),
            (AttackingMidfielder, 70),
            (Striker, 70),
            (Striker, 70),
        ]);
        let chosen = best_formation(&refs(&players), &PlayStyle::Balanced);
        assert_ne!(chosen, "4-4-2");
        assert_ne!(chosen, "4-5-1");
    }

    /// Given three strong centre backs and two natural wing-backs,
    /// when a balanced club chooses a shape,
    /// then it plays a back three with wing-backs.
    #[test]
    fn three_good_centre_backs_and_two_wing_backs_earn_a_back_three() {
        use Position::*;
        let players = squad(&[
            (Goalkeeper, 70),
            (LeftWingBack, 72),
            (RightWingBack, 72),
            (CenterBack, 74),
            (CenterBack, 74),
            (CenterBack, 74),
            (DefensiveMidfielder, 70),
            (CentralMidfielder, 70),
            (CentralMidfielder, 70),
            (AttackingMidfielder, 70),
            (Striker, 70),
            (Striker, 70),
            (CentralMidfielder, 62),
            (Striker, 62),
        ]);
        let chosen = best_formation(&refs(&players), &PlayStyle::Balanced);
        assert!(
            ["5-3-2", "3-4-2-1"].contains(&chosen),
            "expected a back three with wing-backs, got {chosen}"
        );
    }

    /// Given a squad that fills every shape about equally,
    /// when a defensive and an attacking club choose,
    /// then each lands on one of the shapes its style rewards.
    #[test]
    fn the_style_decides_between_shapes_the_squad_plays_equally_well() {
        let players = rounded_squad();
        let available = refs(&players);
        let defensive = best_formation(&available, &PlayStyle::Defensive);
        let attacking = best_formation(&available, &PlayStyle::Attacking);
        assert!(["5-3-2", "4-5-1"].contains(&defensive), "{defensive}");
        assert!(["4-3-3", "3-4-3"].contains(&attacking), "{attacking}");
    }

    /// Given a club already playing each shape in turn,
    /// when it reviews its shape,
    /// then it moves to the best one only when that one wins by the hysteresis.
    #[test]
    fn a_shape_is_kept_unless_the_new_one_beats_it_by_the_hysteresis() {
        let players = rounded_squad();
        let available = refs(&players);
        let style = PlayStyle::Balanced;
        let best = best_formation(&available, &style);
        for formation in AI_FORMATIONS {
            let gain = score(&available, &style, best) - score(&available, &style, formation);
            let reviewed = reviewed_formation(formation, &available, &style);
            if gain < HYSTERESIS {
                assert_eq!(reviewed, formation, "kept {formation} (gain {gain:.2})");
            } else {
                assert_eq!(reviewed, best, "moved off {formation} (gain {gain:.2})");
            }
        }
    }

    /// Given a squad whose best shape beats 4-4-2 by less than the hysteresis,
    /// when it opens a world and when it reviews from 4-4-2,
    /// then it opens in the best shape but a review keeps 4-4-2.
    #[test]
    fn a_new_club_takes_its_best_shape_without_the_hysteresis() {
        use Position::*;
        // 4-4-2's eleven, plus one spare centre back: a back three is barely
        // worse than a back four, so whichever wins, it wins narrowly.
        let players = squad(&[
            (Goalkeeper, 70),
            (LeftBack, 70),
            (RightBack, 70),
            (CenterBack, 70),
            (CenterBack, 70),
            (CenterBack, 70),
            (LeftMidfielder, 70),
            (CentralMidfielder, 70),
            (CentralMidfielder, 70),
            (RightMidfielder, 70),
            (Striker, 70),
            (Striker, 70),
        ]);
        let available = refs(&players);
        let style = PlayStyle::Counter;
        let best = best_formation(&available, &style);
        assert_eq!(opening_formation("4-4-2", &available, &style), best);
        let gain = score(&available, &style, best) - score(&available, &style, "4-4-2");
        if gain < HYSTERESIS {
            assert_eq!(reviewed_formation("4-4-2", &available, &style), "4-4-2");
        }
    }

    /// Given a club with ten players,
    /// when it opens a world or reviews its shape,
    /// then it keeps the shape it has.
    #[test]
    fn a_club_that_cannot_field_eleven_keeps_its_shape() {
        let players: Vec<Player> = rounded_squad().into_iter().take(10).collect();
        let available = refs(&players);
        assert_eq!(
            opening_formation("4-4-2", &available, &PlayStyle::Defensive),
            "4-4-2"
        );
        assert_eq!(
            reviewed_formation("4-4-2", &available, &PlayStyle::Defensive),
            "4-4-2"
        );
    }

    /// Given a club whose stored shape the game does not offer,
    /// when it reviews its shape,
    /// then it moves to one the game offers.
    #[test]
    fn a_shape_the_game_does_not_offer_is_replaced() {
        let players = rounded_squad();
        let available = refs(&players);
        let reviewed = reviewed_formation("4-2-4", &available, &PlayStyle::Balanced);
        assert!(AI_FORMATIONS.contains(&reviewed.as_str()));
    }

    /// Given three players,
    /// when their fit for a 4-4-2 is taken,
    /// then the eight empty slots count as zero.
    #[test]
    fn a_squad_that_cannot_fill_a_shape_scores_its_empty_slots_as_zero() {
        use Position::*;
        let players = squad(&[(Goalkeeper, 70), (CenterBack, 70), (Striker, 70)]);
        let fit = formation_fit(&refs(&players), "4-4-2");
        assert!(fit < 70.0 * 3.0 / 11.0 + 1.0, "fit {fit}");
    }

    /// Given the shapes an AI club chooses between,
    /// when their slots are listed,
    /// then each has eleven.
    #[test]
    fn every_offered_shape_has_eleven_slots() {
        for formation in AI_FORMATIONS {
            assert_eq!(formation_slots(formation).len(), 11, "{formation}");
        }
    }
}
