//! How a contested moment between two players is decided — shared by the
//! instant and the live engine so the two can never drift apart.
//!
//! Every duel compares one or more *components* (technique, physique, the air)
//! between the two players, each with its own sensitivity γ:
//!
//! ```text
//! logit P(attacker wins) = Σ γᵢ · ln(attackerᵢ / defenderᵢ)
//!                        + ln(M_attacker / M_defender)   every existing modifier
//!                        + ln k                          the duel's anchor
//! ```
//!
//! With one component, γ = 1 and k = 1 this is exactly the old
//! `a / (a + d)`; γ above 1 lets attribute differences matter while two equal
//! players still meet at 50/50. Each anchor `k` holds the league-wide share of
//! duels the attacker wins where it was before the formulas changed, so goals
//! per game do not drift — only *who* wins does.
//!
//! The figures and how they were chosen:
//! `fm-document/game-engine/player-physique-duel-formulas.md` (§6–8).

use crate::shared::PlayerSnap;

/// Sensitivity of the aerial duel after a cross.
pub(crate) const GAMMA_AERIAL: f64 = 2.0;
/// Sensitivity of the technical half of a one-on-one in the attacking third.
pub(crate) const GAMMA_ONE_V_ONE_TECHNICAL: f64 = 2.0;
/// Sensitivity of the physical half. Its valid band is 1.75–2.2: below it a
/// fast forward barely beats a slow defender, above it pace outweighs
/// dribbling by more than 1.5×, the "pace is king" the design rules out.
pub(crate) const GAMMA_ONE_V_ONE_PHYSICAL: f64 = 2.0;
/// Sensitivity of the midfield duel, left where it always was. About ninety of
/// these are played a match, so any sensitivity above 1 compounds into the
/// result: at 2 a side four to seven OVR stronger won 69% of real-world
/// matches instead of 57%. The midfield duel still gains its physical third
/// (the weights below); it just does not amplify differences.
pub(crate) const GAMMA_MIDFIELD: f64 = 1.0;

/// Anchors: hold each duel's league-wide attacker win share where it was.
/// Measured on 2,400 live-engine matches between generated clubs, picked as
/// the game picks them: midfield 51.1%, one-on-one 50.2%, aerial 44.2% before
/// the change and within 0.3 points of each after it.
///
/// The aerial anchor is the exception: phase 2 (P2.2, decision X22) moved it
/// from 0.955 to 0.64 so defenders win 58% of the duels after a cross, as they
/// do in real football, where they had won 48%. Measured on the lan-can sweep
/// (`ofm-sim-bench --guardrails`): 57.5–57.8% over four seeds.
pub(crate) const ANCHOR_AERIAL: f64 = 0.64;
/// The open-play cross's aerial anchor (phase 2, P3.5). The cross is met by
/// the attacker best placed for it (ω × aerial rating) and contested by a
/// centre back, not any defender, which tilts the duel towards the defence;
/// this holds the defenders' share at about 59%. Corners keep
/// `ANCHOR_AERIAL`: their picks did not change.
pub(crate) const ANCHOR_AERIAL_OPEN_PLAY_CROSS: f64 = 0.80;
/// The one-on-one's anchor. Phase 2 GĐ3 (P3.2, X49) moved it from 1.14 to
/// 0.94: picking the duel's players by presence in the ball's lane puts
/// quicker attackers against weaker tacklers on the flanks and some
/// defenders out of lane, and 0.94 keeps the attacker's average win rate
/// where it was (56.9% against 56.4% on the guardrail sweep's nine
/// formations).
pub(crate) const ANCHOR_ONE_V_ONE: f64 = 0.94;
pub(crate) const ANCHOR_MIDFIELD: f64 = 1.015;

/// The average height of a professional footballer, the neutral point of the
/// height factor.
const HEIGHT_REFERENCE_CM: f64 = 182.0;
const HEIGHT_FACTOR_PER_CM: f64 = 0.004;
const HEIGHT_FACTOR_MIN: f64 = 0.92;
const HEIGHT_FACTOR_MAX: f64 = 1.08;

/// Ratings below 1 (a side down to nobody) would break the logarithm.
const RATING_FLOOR: f64 = 1.0;

/// One compared component of a duel.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DuelTerm {
    pub gamma: f64,
    pub attacker: f64,
    pub defender: f64,
}

/// The chance the attacker wins. `modifier_ratio` is the product of every
/// modifier on the attacker's side over the defender's (condition, traits,
/// style, role, home, tactics), applied exactly as strongly as before.
pub(crate) fn duel_probability(terms: &[DuelTerm], modifier_ratio: f64, anchor: f64) -> f64 {
    let mut logit = anchor.max(f64::MIN_POSITIVE).ln() + modifier_ratio.max(f64::MIN_POSITIVE).ln();
    for term in terms {
        logit +=
            term.gamma * (term.attacker.max(RATING_FLOOR) / term.defender.max(RATING_FLOOR)).ln();
    }
    1.0 / (1.0 + (-logit).exp())
}

/// How much a player's height helps him in the air: ±8% across ±20 cm of the
/// average. Zero means the height is not known and counts as average.
pub(crate) fn height_factor(height_cm: u16) -> f64 {
    if height_cm == 0 {
        return 1.0;
    }
    (1.0 + HEIGHT_FACTOR_PER_CM * (f64::from(height_cm) - HEIGHT_REFERENCE_CM))
        .clamp(HEIGHT_FACTOR_MIN, HEIGHT_FACTOR_MAX)
}

/// How much further a player dominant in the air reaches (phase 2, X36). Only
/// outfielders contest a header after a cross, so a keeper's `AerialDominance`
/// never meets this; it counts in his own goalkeeping instead.
const AERIAL_DOMINANCE_REACH: f64 = 1.08;

/// A player's strength in a contested header: reach and timing (`aerial`,
/// which since phase 2 is jumping and strength, not heading), reading where
/// the ball drops (`positioning`), holding his ground (`strength`), then his
/// height and `AerialDominance`. The same for attacker and defender.
pub(crate) fn aerial_rating(p: &PlayerSnap) -> f64 {
    aerial_rating_of(
        p.aerial,
        p.positioning,
        p.strength,
        p.height_cm,
        p.has_trait("AerialDominance"),
    )
}

/// A player's rating in the air from the attributes it reads. Public so the
/// AI judges its forwards with the engine's own yardstick (phase 2, P3.4).
pub fn aerial_rating_of(
    aerial: u8,
    positioning: u8,
    strength: u8,
    height_cm: u16,
    aerial_dominance: bool,
) -> f64 {
    let dominance = if aerial_dominance {
        AERIAL_DOMINANCE_REACH
    } else {
        1.0
    };
    (0.55 * f64::from(aerial) + 0.20 * f64::from(positioning) + 0.25 * f64::from(strength))
        * height_factor(height_cm)
        * dominance
}

/// The two halves of a one-on-one in the attacking third:
/// `(attacker technique, defender technique, attacker physique, defender physique)`.
///
/// The physical weights lean apart on purpose: the forward goes past on pace
/// and a change of direction, the defender stands him up with his body.
pub(crate) fn one_v_one_ratings(att: &PlayerSnap, def: &PlayerSnap) -> [f64; 4] {
    let technique_att = 0.70 * f64::from(att.dribbling) + 0.30 * f64::from(att.composure);
    let technique_def = 0.45 * f64::from(def.tackling)
        + 0.35 * f64::from(def.defending)
        + 0.20 * f64::from(def.positioning);
    let physique_att =
        0.50 * f64::from(att.pace) + 0.30 * f64::from(att.agility) + 0.20 * f64::from(att.strength);
    let physique_def =
        0.45 * f64::from(def.pace) + 0.25 * f64::from(def.agility) + 0.30 * f64::from(def.strength);
    [technique_att, technique_def, physique_att, physique_def]
}

/// The midfield duel, a third of it physical: strength to shield and to
/// win the ball, agility to slip a press, pace to close one down.
pub(crate) fn midfield_ratings(att: &PlayerSnap, def: &PlayerSnap) -> (f64, f64) {
    let attacker = 0.25 * f64::from(att.passing)
        + 0.20 * f64::from(att.dribbling)
        + 0.15 * f64::from(att.vision)
        + 0.10 * f64::from(att.teamwork)
        + 0.15 * f64::from(att.agility)
        + 0.15 * f64::from(att.strength);
    let defender = 0.25 * f64::from(def.tackling)
        + 0.20 * f64::from(def.positioning)
        + 0.15 * f64::from(def.decisions)
        + 0.10 * f64::from(def.teamwork)
        + 0.15 * f64::from(def.pace)
        + 0.15 * f64::from(def.strength);
    (attacker, defender)
}

/// The aerial duel after a cross.
pub(crate) fn aerial_win_probability(att: &PlayerSnap, def: &PlayerSnap) -> f64 {
    aerial_win_probability_anchored(att, def, ANCHOR_AERIAL)
}

/// [`aerial_win_probability`] at another anchor: the open-play cross's.
pub(crate) fn aerial_win_probability_anchored(
    att: &PlayerSnap,
    def: &PlayerSnap,
    anchor: f64,
) -> f64 {
    duel_probability(
        &[DuelTerm {
            gamma: GAMMA_AERIAL,
            attacker: aerial_rating(att),
            defender: aerial_rating(def),
        }],
        1.0,
        anchor,
    )
}

/// The one-on-one in the attacking third, given every existing modifier.
pub(crate) fn one_v_one_win_probability(
    att: &PlayerSnap,
    def: &PlayerSnap,
    modifier_ratio: f64,
) -> f64 {
    let [technique_att, technique_def, physique_att, physique_def] = one_v_one_ratings(att, def);
    duel_probability(
        &[
            DuelTerm {
                gamma: GAMMA_ONE_V_ONE_TECHNICAL,
                attacker: technique_att,
                defender: technique_def,
            },
            DuelTerm {
                gamma: GAMMA_ONE_V_ONE_PHYSICAL,
                attacker: physique_att,
                defender: physique_def,
            },
        ],
        modifier_ratio,
        ANCHOR_ONE_V_ONE,
    )
}

/// The midfield duel, given every existing modifier.
pub(crate) fn midfield_win_probability(
    att: &PlayerSnap,
    def: &PlayerSnap,
    modifier_ratio: f64,
) -> f64 {
    let (attacker, defender) = midfield_ratings(att, def);
    duel_probability(
        &[DuelTerm {
            gamma: GAMMA_MIDFIELD,
            attacker,
            defender,
        }],
        modifier_ratio,
        ANCHOR_MIDFIELD,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(value: u8) -> PlayerSnap {
        let mut snap = PlayerSnap::nobody();
        snap.id = "p".to_string();
        snap.pace = value;
        snap.stamina = value;
        snap.strength = value;
        snap.agility = value;
        snap.passing = value;
        snap.shooting = value;
        snap.tackling = value;
        snap.dribbling = value;
        snap.defending = value;
        snap.positioning = value;
        snap.vision = value;
        snap.decisions = value;
        snap.composure = value;
        snap.teamwork = value;
        snap.aerial = value;
        snap
    }

    /// Given one component, γ = 1 and no anchor, when a duel is decided, then
    /// the chance is exactly the old `a / (a + d)`.
    #[test]
    fn one_component_at_unit_sensitivity_is_the_old_formula() {
        let p = duel_probability(
            &[DuelTerm {
                gamma: 1.0,
                attacker: 70.0,
                defender: 50.0,
            }],
            1.2,
            1.0,
        );
        let old = 70.0 * 1.2 / (70.0 * 1.2 + 50.0);
        assert!((p - old).abs() < 1e-12);
    }

    /// Given two identical players and neutral modifiers, when any duel is
    /// decided, then it is a coin toss before the anchor.
    #[test]
    fn equal_players_meet_at_even_odds() {
        let a = player(70);
        let d = player(70);
        let even = |p: f64, k: f64| (p - k / (1.0 + k)).abs() < 1e-12;
        assert!(even(aerial_win_probability(&a, &d), ANCHOR_AERIAL));
        assert!(even(
            one_v_one_win_probability(&a, &d, 1.0),
            ANCHOR_ONE_V_ONE
        ));
        assert!(even(midfield_win_probability(&a, &d, 1.0), ANCHOR_MIDFIELD));
    }

    /// Given a side reduced to nobody, when a duel is decided, then the chance
    /// is a real probability, not NaN.
    #[test]
    fn a_side_of_nobody_still_gives_a_probability() {
        let nobody = PlayerSnap::nobody();
        let p = one_v_one_win_probability(&nobody, &player(80), 1.0);
        assert!(p.is_finite() && (0.0..=1.0).contains(&p));
        let p = aerial_win_probability(&player(80), &nobody);
        assert!(p.is_finite() && p > 0.5);
    }

    /// Given an unknown height, when the height factor is taken, then it is
    /// neutral; a tall player gains and a short one loses, within ±8%.
    #[test]
    fn height_helps_in_the_air_within_bounds() {
        assert_eq!(height_factor(0), 1.0);
        assert_eq!(height_factor(182), 1.0);
        assert!((height_factor(192) - 1.04).abs() < 1e-12);
        assert_eq!(height_factor(230), HEIGHT_FACTOR_MAX);
        assert_eq!(height_factor(150), HEIGHT_FACTOR_MIN);
    }

    /// Given a quick forward against a slow, strong defender of equal
    /// technique, when they meet one-on-one, then the forward is favoured,
    /// and more so than under the old averaged formula.
    #[test]
    fn pace_wins_a_one_on_one_against_a_slow_defender() {
        let mut forward = player(70);
        forward.pace = 90;
        forward.agility = 85;
        forward.strength = 60;
        let mut defender = player(70);
        defender.pace = 58;
        defender.agility = 60;
        defender.strength = 85;
        let p = one_v_one_win_probability(&forward, &defender, 1.0);
        assert!(p > 0.55, "p = {p}");
    }

    /// Given two equal players, one of them dominant in the air,
    /// when they contest a header,
    /// then the dominant one's reach counts 8% more, so his odds of winning
    /// grow by 1.08² (the aerial duel's γ is 2), whichever side he is on.
    #[test]
    fn aerial_dominance_reaches_eight_percent_higher() {
        let plain = player(70);
        let mut dominant = player(70);
        dominant.traits = vec!["AerialDominance".to_string()];
        let odds = |p: f64| p / (1.0 - p);
        let base = odds(aerial_win_probability(&plain, &plain));
        let attacking = odds(aerial_win_probability(&dominant, &plain));
        let defending = odds(aerial_win_probability(&plain, &dominant));
        assert!((attacking / base - 1.08_f64.powi(2)).abs() < 1e-9);
        assert!((base / defending - 1.08_f64.powi(2)).abs() < 1e-9);
    }

    /// Given a short striker who reads the ball well against a tall defender
    /// who does not, when they contest a header, then the striker still wins
    /// it more often than two evenly matched players would: reading the ball
    /// makes up for the height. (Since P2.2 the even contest itself favours the
    /// defender, 61/39, so "more often than not" is no longer the bar.)
    #[test]
    fn a_short_striker_who_reads_the_ball_can_win_in_the_air() {
        let mut striker = player(70);
        striker.height_cm = 172;
        striker.positioning = 90;
        striker.strength = 65;
        let mut defender = player(65);
        defender.height_cm = 190;
        defender.positioning = 55;
        defender.strength = 75;
        let p = aerial_win_probability(&striker, &defender);
        let even = ANCHOR_AERIAL / (1.0 + ANCHOR_AERIAL);
        assert!(p > even, "p = {p}, even = {even}");
    }
}
