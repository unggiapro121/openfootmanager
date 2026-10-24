//! Tactical identity for clubs the player does not manage (phase 3, E3-5a: pure, shared with
//! the online server's bot clubs; `ofm_core::ai_tactics` runs the weekly review over a save).
//!
//! `TacticsPhaseSettings` is nine dials, fully wired into both match engines,
//! and until now it had exactly one writer in the whole backend: the user's own
//! `set_tactics_phase` command. Every other club in every save ran
//! `TacticsPhaseSettings::default()`, which is neutral by construction — so the
//! nine-dial system was a single-team feature and every rival in the world
//! played the same way.
//!
//! This module gives each club a blueprint derived from its play style, applied
//! once when the club is built. A HighPress club now actually presses.
//!
//! # Why the dials are not spent evenly
//!
//! The engine does not price these dials symmetrically, and pretending
//! otherwise would hide a real balance problem behind a tidy-looking table.
//! Measured over 4000 matches per option against a neutral opponent
//! (`sim-bench --phase-sweep`), as goals for / goals against against a 1.98 /
//! 1.78 baseline:
//!
//! - **No measurable effect: `build_up_style`, `marking_style`, `tempo`.** Each
//!   is hooked on both match paths, so this is a small-coefficient result rather
//!   than dead code — but it makes them free identity space. They are what a
//!   club's style says about itself at no competitive cost, and they are spent
//!   here freely.
//! - **Honest trades: `pressing_intensity`, `break_speed`.** Fast breaks buy
//!   shots and concede them (2.12 / 1.84). Aggressive pressing buys possession
//!   and pays in fouls, plus a stamina cost that only the live path currently
//!   charges — so its price is real but under-collected until every match runs
//!   through that path.
//! - **Were one-sided in the club's favour: `defensive_line` low,
//!   `defensive_shape` compact, `width` narrow, `counter_press_duration` long.**
//!   When the blueprints were written, a very low line conceded 1.54 against
//!   1.78 and gave up nothing, and a long counter-press bought 55.4% possession
//!   and 2.12 goals for at no cost at all. The engine now charges the other half
//!   of each trade (`engine::shared`'s `tactics_defensive_line_recovery`,
//!   `tactics_break_distance`, `tactics_counter_press_exposure` and
//!   `tactics_width_versus_shape`), and the identity probe's spread between the
//!   best and worst style fell from 6.3 points to about 4.
//!
//! The blueprints still **ration** those four — a style gets one where the
//! football demands it and neutral elsewhere — rather than budgeting to
//! equalise net value. The pricing narrowed the gap; it has not been shown to
//! close it, and budgeting against numbers that move every time the engine is
//! re-priced would be wrong again at the next change. The ration is a pin to
//! revisit after a fresh `--phase-sweep`: if that run shows the four dials
//! trading evenly, it can go. `tests/tactical_identity_probe.rs` is what says
//! whether it has become urgent either way.

use crate::ai_math::mean_u8;
use crate::licence::{LicenceControls, fit_team};
use crate::stable_hash::stable_hash;
use domain::manager::PlayStyleMastery;
use domain::player::{Player, Position};
use domain::team::{
    BreakSpeed, BuildUpStyle, CounterPressDuration, CrossStyle, DefensiveLine, DefensiveShape,
    MarkingStyle, OffsideTrap, PitchWidth, PlayStyle, PressingIntensity, TacticsPhaseSettings,
    Tempo,
};

/// The blueprint a club of this play style takes the field with. Its cross
/// style follows S2 §3.2 (phase 2, P3.4): a side that attacks or sits deep
/// goes in the air, a possession side along the ground, a counter-attacking
/// side early; `match_plan` brings `High` down when the side has nobody to
/// win the ball in the air.
///
/// Balanced is the neutral blueprint, deliberately: it is the style that has no
/// argument to make, and it is the control every other identity is measured
/// against.
pub fn blueprint_for(play_style: &PlayStyle) -> TacticsPhaseSettings {
    match play_style {
        // Nothing to say, said neutrally.
        PlayStyle::Balanced => TacticsPhaseSettings::default(),

        // Get the ball forward and get bodies wide. Gambles a high line to keep
        // the game in the opponent's half and accepts what that concedes.
        PlayStyle::Attacking => TacticsPhaseSettings {
            build_up_style: BuildUpStyle::Short,
            width: PitchWidth::Wide,
            tempo: Tempo::Direct,
            defensive_line: DefensiveLine::High,
            pressing_intensity: PressingIntensity::Medium,
            defensive_shape: DefensiveShape::Normal,
            marking_style: MarkingStyle::Zonal,
            counter_press_duration: CounterPressDuration::Short,
            break_speed: BreakSpeed::Fast,
            cross_style: CrossStyle::High,
            offside_trap: OffsideTrap::Off,
        },

        // Deep, compact, man-oriented, and in no hurry. Concedes the ball and
        // the tempo on purpose; the low block is the whole idea.
        PlayStyle::Defensive => TacticsPhaseSettings {
            build_up_style: BuildUpStyle::Long,
            width: PitchWidth::Normal,
            tempo: Tempo::Patient,
            defensive_line: DefensiveLine::Low,
            pressing_intensity: PressingIntensity::Passive,
            defensive_shape: DefensiveShape::Compact,
            marking_style: MarkingStyle::ManToMan,
            counter_press_duration: CounterPressDuration::None,
            break_speed: BreakSpeed::Slow,
            cross_style: CrossStyle::High,
            offside_trap: OffsideTrap::Off,
        },

        // Keep it, circulate it, and win it back immediately when it goes. The
        // long counter-press is the dial that makes possession football work,
        // and it is paid for with a high line and a slow break.
        PlayStyle::Possession => TacticsPhaseSettings {
            build_up_style: BuildUpStyle::Short,
            width: PitchWidth::Wide,
            tempo: Tempo::Patient,
            defensive_line: DefensiveLine::High,
            pressing_intensity: PressingIntensity::Medium,
            defensive_shape: DefensiveShape::Normal,
            marking_style: MarkingStyle::Zonal,
            counter_press_duration: CounterPressDuration::Long,
            break_speed: BreakSpeed::Slow,
            cross_style: CrossStyle::Low,
            offside_trap: OffsideTrap::Off,
        },

        // Sit off, let them come, and go the moment the ball turns over. No
        // counter-press at all — winning it back high is the opposite of the
        // plan.
        PlayStyle::Counter => TacticsPhaseSettings {
            build_up_style: BuildUpStyle::Long,
            width: PitchWidth::Normal,
            tempo: Tempo::Direct,
            defensive_line: DefensiveLine::Low,
            pressing_intensity: PressingIntensity::Passive,
            defensive_shape: DefensiveShape::Normal,
            marking_style: MarkingStyle::Zonal,
            counter_press_duration: CounterPressDuration::None,
            break_speed: BreakSpeed::Fast,
            cross_style: CrossStyle::Early,
            offside_trap: OffsideTrap::Off,
        },

        // Hunt the ball high up the pitch and squeeze the space behind. The
        // most expensive blueprint to run: a high line, aggressive pressing and
        // a long counter-press all at once, and the line steps up to catch
        // runners offside.
        PlayStyle::HighPress => TacticsPhaseSettings {
            build_up_style: BuildUpStyle::Short,
            width: PitchWidth::Normal,
            tempo: Tempo::Direct,
            defensive_line: DefensiveLine::High,
            pressing_intensity: PressingIntensity::Aggressive,
            defensive_shape: DefensiveShape::Compact,
            marking_style: MarkingStyle::ManToMan,
            counter_press_duration: CounterPressDuration::Long,
            break_speed: BreakSpeed::Fast,
            cross_style: CrossStyle::Mixed,
            offside_trap: OffsideTrap::On,
        },
    }
}

// ---------------------------------------------------------------------------
// The weekly review
// ---------------------------------------------------------------------------

/// How many of the engine's under-priced dials this plan holds.
///
/// The rule — which four dials, and that a club may hold at most
/// [`engine::ai::MAX_UNDER_PRICED_DIALS`] of them — belongs to the engine, which
/// prices them and applies the same ration to the dials a manager turns during
/// a match. The review asks it rather than keeping a copy. Adaptation has to
/// obey the ration at run time as well as the blueprints, because "we keep
/// conceding" pushes a club straight at the deep line and the compact block.
pub fn under_priced_dials(settings: &TacticsPhaseSettings) -> usize {
    engine::ai::under_priced_dials(&crate::squad::domain_to_engine_tactics(settings))
}

/// A club sits down to look at itself once a week, on a day of its own.
///
/// Not every club on the same day: the review is a sweep over every squad in the
/// world, and spreading it over the week keeps that off any single day's
/// advance. Not on a fixed rota either — the day is derived from the club's id,
/// so it survives a save and a reload and does not depend on where the club sits
/// in the list.
///
/// A week is also the hysteresis. The plan is recomputed from scratch each time
/// rather than nudged from where it was, so a club cannot drift; what a weekly
/// cadence buys is that it cannot flip-flop on a Tuesday either.
pub const REVIEW_CYCLE_DAYS: u64 = 7;

/// Distinct from the lineup builder's stream, which hashes the same club ids for
/// a different question.
pub const REVIEW_SEED: u64 = 0x7461_6374_6963_7300; // "tactics\0"

/// The weekday (0 = Monday) a club reviews how it plays, from its id alone.
pub fn review_weekday(team_id: &str) -> u32 {
    (stable_hash(team_id.as_bytes(), REVIEW_SEED) % REVIEW_CYCLE_DAYS) as u32
}

// --- What the manager looks at ---------------------------------------------

/// How many of the eleven best available players the legs reading is taken over.
pub const LIKELY_STARTERS: usize = 11;
/// How many defenders decide whether the line can be pushed up.
pub const BACK_LINE: usize = 4;

// Both caps are placed at roughly the twentieth percentile of a generated world
// (`tests/tactical_adaptation_probe.rs`, 440 clubs), so the rule they encode is
// one sentence: the least equipped fifth of the world cannot run the most
// demanding version of its style. A cap at the median is not a cap, it is a
// second blueprint; a cap below the tenth percentile never fires.

/// Below this mean stamina across the likely eleven, a squad cannot sustain a
/// pressing game for ninety minutes however much its manager would like to.
/// The world's likely-XI stamina runs 62.1 at p10 and 68.6 at the median.
pub const LEGS_FOR_A_PRESS: f64 = 64.0;
/// Below this mean pace across the back line, the space behind a high line is
/// not space this defence can cover. The world's back-four pace runs 55.8 at
/// p10 and 66.0 at the median — it is far more spread than stamina, which is
/// why the same percentile lands on a much lower number.
pub const PACE_FOR_A_HIGH_LINE: f64 = 59.0;
/// Below this, the two players a side's crosses are aimed at cannot win
/// enough of them in the air to make every cross a high one (phase 2, P3.4,
/// S2 §3.2): the engine's aerial rating at the 25th percentile of the two
/// leading strikers of every club in the real-world package (68.0; median
/// 74.2). Measured once rather than read off the league each week.
pub const AIR_THRESHOLD: f64 = 68.0;
/// A side that cannot win it in the air but can get on the end of it along
/// the ground crosses low instead (S2 §3.2).
pub const GROUND_FOR_LOW: f64 = 70.0;
/// How many of the side's likeliest finishers its crosses are judged for.
pub const FINISHERS: usize = 2;

/// What the squad can be asked to do, as opposed to what the badge says.
pub struct SquadReading {
    /// Mean stamina of the eleven best available players.
    pub legs: f64,
    /// Mean pace of the four best defenders.
    pub defensive_pace: f64,
    /// Mean aerial rating, and mean `0.6·positioning + 0.4·first_touch`, of
    /// the two players in the likely eleven the box favours most (ω).
    pub aerial_threat: f64,
    pub ground_threat: f64,
}

pub fn read_squad(squad: &[&Player]) -> Option<SquadReading> {
    if squad.is_empty() {
        return None;
    }

    // Ties broken on id so the reading does not depend on storage order.
    let by_standing = |candidates: &mut Vec<&&Player>| {
        candidates.sort_by(|a, b| b.ovr.cmp(&a.ovr).then_with(|| a.id.cmp(&b.id)));
    };

    let mut available: Vec<&&Player> = squad.iter().filter(|p| p.injury.is_none()).collect();
    if available.is_empty() {
        // An entire squad in the treatment room is still the squad the manager
        // has to plan around.
        available = squad.iter().collect();
    }
    by_standing(&mut available);
    let eleven = &available[..LIKELY_STARTERS.min(available.len())];
    let legs = mean_u8(eleven.iter().map(|p| p.attributes.stamina));

    let mut defenders: Vec<&&Player> = available
        .iter()
        .copied()
        .filter(|p| p.position.to_group_position() == Position::Defender)
        .collect();
    by_standing(&mut defenders);
    let defensive_pace = if defenders.is_empty() {
        // No recognised defenders is a broken squad, not a fast one. Read the
        // eleven rather than claim the back line can do anything.
        mean_u8(eleven.iter().map(|p| p.attributes.pace))
    } else {
        mean_u8(
            defenders[..BACK_LINE.min(defenders.len())]
                .iter()
                .map(|p| p.attributes.pace),
        )
    };

    let (aerial_threat, ground_threat) = read_finishers(eleven);
    Some(SquadReading {
        legs,
        defensive_pace,
        aerial_threat,
        ground_threat,
    })
}

/// How the two likeliest finishers in `eleven` meet a cross: in the air (the
/// engine's aerial rating) and along the ground. Likeliest by the engine's
/// ω at their natural position (a striker over a wide or attacking
/// midfielder), then by standing.
pub fn read_finishers(eleven: &[&&Player]) -> (f64, f64) {
    let omega = |p: &Player| {
        crate::squad::PITCH_POSITIONS
            .iter()
            .find(|(position, _)| *position == p.natural_position)
            .map_or(0.0, |(_, slot)| {
                engine::shot_weight(*slot, engine::PlayerRole::Standard)
            })
    };
    let mut finishers: Vec<&&Player> = eleven.to_vec();
    finishers.sort_by(|a, b| {
        omega(b)
            .total_cmp(&omega(a))
            .then_with(|| b.ovr.cmp(&a.ovr))
            .then_with(|| a.id.cmp(&b.id))
    });
    finishers.truncate(FINISHERS);
    if finishers.is_empty() {
        return (0.0, 0.0);
    }
    let n = finishers.len() as f64;
    let aerial = finishers
        .iter()
        .map(|p| {
            let a = &p.attributes;
            engine::aerial_rating_of(
                a.aerial,
                a.positioning,
                a.strength,
                p.height_cm,
                p.traits
                    .contains(&domain::player::PlayerTrait::AerialDominance),
            )
        })
        .sum::<f64>()
        / n;
    let ground = finishers
        .iter()
        .map(|p| {
            0.60 * f64::from(p.attributes.positioning) + 0.40 * f64::from(p.attributes.first_touch)
        })
        .sum::<f64>()
        / n;
    (aerial, ground)
}

/// How many recent matches the manager judges the plan on.
pub const FORM_WINDOW: usize = 5;
/// Fewer results than this is not evidence, it is a new season.
pub const FORM_MINIMUM: usize = 3;

// Both triggers sit at the same tail of the same measured distribution: p85 of
// goals conceded and p15 of goals scored, over every five-match window a probe
// season produces (`tests/tactical_adaptation_probe.rs`). The two tails mirror
// each other because every match is counted from both ends. So these are the
// worst and best sixth of runs a club actually lives through.
//
// They are measurements, and they move when the football does. First set at 2.8
// and 1.2 when a club scored 2.06 a game; fielding a real, rested eleven instead
// of a whole tired squad lifted that to about 2.29, where 2.8 conceded sits near
// p70 and a third of clubs read as leaking; they moved to 3.2 and 1.4. Playing
// every active fixture on the live engine, with benches and managers, lifted
// scoring again to about 2.52, and six probe seasons put the pooled p85 at 3.4
// and p15 at 1.6. Resolving duels on height and weight brought it back down to
// about 2.26, and eight probe seasons put p85 at 3.2 and p15 at 1.4. Phase 2
// (aerial duels, set pieces and shots from distance in GĐ2, the lanes of GĐ3)
// brought a club down to about 1.81 a game; three probe seasons (seeds 1–3)
// put p85 conceded at 2.4 / 2.6 / 2.6 and p15 scored at 1.2 in each, so
// 2.6 and 1.2 (phase 2, P3.9), and 2.2 and 1.0 after GĐ4 brought clubs down
// to about 1.53 goals a game (P4.6). GĐ5 (P5.7) brought them to 1.42, and the
// table put p85 conceded at 2.0 and p15 scored at 0.8. Anything that changes
// how many goals are scored should re-read that table before trusting these.
//
// The first pass (at 2.26 goals a game) used 2.2 and 0.8, which read like a
// matched pair and were nothing of the kind: 2.2 sat just above the median and fired for two clubs in
// five, while 0.8 sat below the fifth percentile and fired for almost nobody.
// Every club in the world was permanently "leaking" and none was ever blunt,
// and the reaction table came out as one column of compact blocks.

/// Conceding at this rate says the plan is not holding, whatever the badge says.
pub const LEAKY: f64 = 2.0;
/// Scoring at this rate says the same about the other end.
pub const BLUNT: f64 = 0.8;

pub struct FormReading {
    pub conceded_per_game: f64,
    pub scored_per_game: f64,
}

/// Every club's recent form, from its completed results: `(club id, ISO date, scored,
/// conceded)`, one entry per club per match — both clubs of a fixture appear. A club with fewer
/// than [`FORM_MINIMUM`] results has no reading yet.
pub fn read_form<'a>(
    results: impl IntoIterator<Item = (&'a str, &'a str, u32, u32)>,
) -> std::collections::HashMap<String, FormReading> {
    let mut by_club: std::collections::HashMap<&str, Vec<(&str, u32, u32)>> = Default::default();
    for (team_id, date, scored, conceded) in results {
        by_club
            .entry(team_id)
            .or_default()
            .push((date, scored, conceded));
    }

    by_club
        .into_iter()
        .filter_map(|(team_id, mut played)| {
            if played.len() < FORM_MINIMUM {
                return None;
            }
            // ISO dates sort lexicographically, so ordering them needs no parsing.
            played.sort_by(|a, b| b.0.cmp(a.0));
            let window = &played[..FORM_WINDOW.min(played.len())];
            let games = window.len() as f64;
            Some((
                team_id.to_string(),
                FormReading {
                    scored_per_game: window.iter().map(|(_, s, _)| f64::from(*s)).sum::<f64>()
                        / games,
                    conceded_per_game: window.iter().map(|(_, _, c)| f64::from(*c)).sum::<f64>()
                        / games,
                },
            ))
        })
        .collect()
}

// --- What he does about it -------------------------------------------------

/// One step deeper, or `false` if the side is already on its own goal line.
pub fn sit_deeper(settings: &mut TacticsPhaseSettings) -> bool {
    settings.defensive_line = match settings.defensive_line {
        DefensiveLine::High => DefensiveLine::Medium,
        DefensiveLine::Medium => DefensiveLine::Low,
        DefensiveLine::Low => DefensiveLine::VeryLow,
        DefensiveLine::VeryLow => return false,
    };
    true
}

pub fn close_the_gaps(settings: &mut TacticsPhaseSettings) -> bool {
    if settings.defensive_shape == DefensiveShape::Compact {
        return false;
    }
    settings.defensive_shape = DefensiveShape::Compact;
    true
}

pub fn press_less(settings: &mut TacticsPhaseSettings) -> bool {
    settings.pressing_intensity = match settings.pressing_intensity {
        PressingIntensity::Aggressive => PressingIntensity::Medium,
        PressingIntensity::Medium => PressingIntensity::Passive,
        PressingIntensity::Passive => return false,
    };
    true
}

/// Win it back closer to their goal. The answer for a side that is already as
/// fast, as wide and as direct as it can get — which every attacking blueprint
/// is on the day it is written.
pub fn press_higher(settings: &mut TacticsPhaseSettings) -> bool {
    settings.pressing_intensity = match settings.pressing_intensity {
        PressingIntensity::Passive => PressingIntensity::Medium,
        PressingIntensity::Medium => PressingIntensity::Aggressive,
        PressingIntensity::Aggressive => return false,
    };
    true
}

pub fn break_faster(settings: &mut TacticsPhaseSettings) -> bool {
    settings.break_speed = match settings.break_speed {
        // The engine gives Slow and Medium the same zero counter chance. A
        // blunt side must reach Fast to change what happens on the pitch.
        BreakSpeed::Slow => BreakSpeed::Fast,
        BreakSpeed::Medium => BreakSpeed::Fast,
        BreakSpeed::Fast => return false,
    };
    true
}

pub fn stretch_the_pitch(settings: &mut TacticsPhaseSettings) -> bool {
    if settings.width == PitchWidth::Wide {
        return false;
    }
    settings.width = PitchWidth::Wide;
    true
}

pub fn go_more_direct(settings: &mut TacticsPhaseSettings) -> bool {
    if settings.tempo == Tempo::Direct {
        return false;
    }
    settings.tempo = Tempo::Direct;
    true
}

/// Apply the first change on the list that does something and does not push the
/// club past its ration of under-priced dials.
///
/// One change per problem, deliberately. A manager reacting to a bad run moves
/// one thing; a policy that moved all three would have rebuilt the blueprint,
/// and the club's identity would last exactly one bad month.
pub fn shade(settings: &mut TacticsPhaseSettings, moves: &[fn(&mut TacticsPhaseSettings) -> bool]) {
    for change in moves {
        let mut trial = settings.clone();
        if change(&mut trial) && under_priced_dials(&trial) <= engine::ai::MAX_UNDER_PRICED_DIALS {
            *settings = trial;
            return;
        }
    }
}

/// The plan this club takes into its next match.
///
/// Recomputed from the style blueprint every time rather than nudged from
/// whatever is stored, which is what keeps it honest: the answer is a pure
/// function of style, squad and form, so a club cannot ratchet its way to
/// something no manager ever chose, and running the review twice in a day
/// changes nothing.
pub fn match_plan(
    play_style: &PlayStyle,
    squad: Option<&SquadReading>,
    form: Option<&FormReading>,
) -> TacticsPhaseSettings {
    let mut settings = blueprint_for(play_style);

    if let Some(form) = form {
        if form.conceded_per_game >= LEAKY {
            shade(&mut settings, &[close_the_gaps, sit_deeper, press_less]);
        }
        if form.scored_per_game <= BLUNT {
            shade(
                &mut settings,
                &[
                    break_faster,
                    stretch_the_pitch,
                    press_higher,
                    go_more_direct,
                ],
            );
        }
    }

    // What the players can actually do has the last word. A bad run is a reason
    // to try something; it is not a reason to ask a squad for something it does
    // not have, so the caps close over the reaction as well as the blueprint.
    // They only ever ask for less, so nothing here can breach the ration.
    if let Some(squad) = squad {
        if squad.legs < LEGS_FOR_A_PRESS {
            if settings.pressing_intensity == PressingIntensity::Aggressive {
                settings.pressing_intensity = PressingIntensity::Medium;
            }
            if settings.counter_press_duration == CounterPressDuration::Long {
                settings.counter_press_duration = CounterPressDuration::Short;
            }
        }
        if squad.defensive_pace < PACE_FOR_A_HIGH_LINE
            && settings.defensive_line == DefensiveLine::High
        {
            settings.defensive_line = DefensiveLine::Medium;
        }
        // Nobody to head it: keep it on the ground if they can finish there.
        if settings.cross_style == CrossStyle::High && squad.aerial_threat < AIR_THRESHOLD {
            settings.cross_style = if squad.ground_threat >= GROUND_FOR_LOW {
                CrossStyle::Low
            } else {
                CrossStyle::Mixed
            };
        }
    }

    settings
}

/// A club's weekly look at how it plays (phase 3, E3-7: the game's AI clubs and the online world's
/// bot clubs review alike): its dials from its style, squad and form ([`match_plan`]), its shape
/// from who can play this week (`ai_formation::reviewed_formation`, GĐ5 P5.1), and its players'
/// roles (`ai_roles::assign_squad_roles`). `squad` is the whole squad; the injured do not count
/// towards the shape. Running it twice in a day changes nothing.
pub fn weekly_review(team: &mut domain::team::Team, squad: &[&Player], form: Option<&FormReading>) {
    review_among(team, squad, form, &crate::ai_formation::AI_FORMATIONS);
}

/// [`weekly_review`] for an online bot club whose licence closes some controls (phase 3, S-9
/// S9-11): it plays the open style its coach knows best (`mastery`), chooses its shape among the
/// open ones, and its dials and roles stand where the licence allows. Running it twice in a day
/// changes nothing.
pub fn weekly_review_within(
    team: &mut domain::team::Team,
    squad: &[&Player],
    form: Option<&FormReading>,
    controls: &LicenceControls,
    mastery: &PlayStyleMastery,
) {
    // The style first: the blueprint and the shape are both read from it.
    fit_team(team, controls, Some(mastery));
    let open: Vec<&str> = controls.formations.iter().map(String::as_str).collect();
    review_among(team, squad, form, &open);
    // The blueprint and the role assignment know nothing of licences; what they set beyond it
    // goes back to its default.
    fit_team(team, controls, Some(mastery));
}

fn review_among(
    team: &mut domain::team::Team,
    squad: &[&Player],
    form: Option<&FormReading>,
    shapes: &[&str],
) {
    let reading = read_squad(squad);
    let available: Vec<&Player> = squad
        .iter()
        .copied()
        .filter(|player| player.injury.is_none())
        .collect();
    team.tactics_phase = match_plan(&team.play_style, reading.as_ref(), form);
    team.formation = crate::ai_formation::reviewed_formation_within(
        &team.formation,
        &available,
        &team.play_style,
        shapes,
    );
    crate::ai_roles::assign_squad_roles(team, squad.iter().copied());
}

#[cfg(test)]
mod weekly_review_tests {
    use domain::player::Position;
    use domain::team::{PlayStyle, TacticsPhaseSettings, Team};

    use super::*;
    use crate::test_support::uniform_attributes;

    fn squad() -> Vec<Player> {
        let positions = [
            (Position::Goalkeeper, 2),
            (Position::Defender, 6),
            (Position::Midfielder, 6),
            (Position::Forward, 4),
        ];
        positions
            .into_iter()
            .flat_map(|(position, count)| std::iter::repeat_n(position, count))
            .enumerate()
            .map(|(i, position)| {
                Player::new(
                    format!("p{i:02}"),
                    format!("P{i}"),
                    format!("P{i}"),
                    "2000-01-01".into(),
                    "England".into(),
                    position,
                    uniform_attributes(55 + (i % 20) as u8),
                )
            })
            .collect()
    }

    /// Given a counter-attacking club with no plan and a squad of 18,
    /// when it reviews its week twice,
    /// then its dials are the counter plan for that squad, its shape one the AI plays, and a
    /// second review the same day changes nothing.
    #[test]
    fn a_club_reviews_its_dials_shape_and_roles() {
        let players = squad();
        let squad: Vec<&Player> = players.iter().collect();
        let mut team = Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        );
        team.play_style = PlayStyle::Counter;
        weekly_review(&mut team, &squad, None);
        assert_eq!(
            team.tactics_phase,
            match_plan(&PlayStyle::Counter, read_squad(&squad).as_ref(), None)
        );
        assert!(
            engine::FORMATIONS.contains(&team.formation.as_str()),
            "{}",
            team.formation
        );
        let once = team.clone();
        weekly_review(&mut team, &squad, None);
        assert_eq!(team.tactics_phase, once.tactics_phase);
        assert_eq!(team.formation, once.formation);
        assert_eq!(team.player_roles, once.player_roles);
    }

    /// Given a counter-attacking bot of the first licence, whose coach knows Defensive best of the
    /// open styles, set up in a closed shape,
    /// when it reviews its week twice,
    /// then it plays Defensive in one of the three open shapes, every dial at its default and no
    /// role, and the second review changes nothing.
    #[test]
    fn a_bot_reviews_its_week_within_its_licence() {
        let players = squad();
        let squad: Vec<&Player> = players.iter().collect();
        let mut team = Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        );
        team.play_style = PlayStyle::Counter;
        team.formation = "4-2-3-1".into();
        let mastery = PlayStyleMastery {
            balanced: 40,
            attacking: 30,
            defensive: 75,
            possession: 20,
            counter: 90,
            high_press: 10,
        };
        let grassroots = crate::licence::controls(1);
        weekly_review_within(&mut team, &squad, None, &grassroots, &mastery);
        assert_eq!(team.play_style, PlayStyle::Defensive);
        assert!(
            grassroots.formations.contains(&team.formation),
            "{}",
            team.formation
        );
        assert_eq!(team.tactics_phase, TacticsPhaseSettings::default());
        assert!(team.player_roles.is_empty());
        let once = team.clone();
        weekly_review_within(&mut team, &squad, None, &grassroots, &mastery);
        assert_eq!(team.play_style, once.play_style);
        assert_eq!(team.formation, once.formation);
        assert_eq!(team.tactics_phase, once.tactics_phase);
    }

    /// Given a bot holding every licence,
    /// when it reviews its week through the licensed review and, separately, the plain one,
    /// then the two come out the same.
    #[test]
    fn a_bot_with_every_licence_reviews_as_before() {
        let players = squad();
        let squad: Vec<&Player> = players.iter().collect();
        let mut plain = Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        );
        plain.play_style = PlayStyle::HighPress;
        let mut licensed = plain.clone();
        weekly_review(&mut plain, &squad, None);
        weekly_review_within(
            &mut licensed,
            &squad,
            None,
            &crate::licence::LicenceControls::all_open(),
            &PlayStyleMastery::default(),
        );
        assert_eq!(licensed.play_style, plain.play_style);
        assert_eq!(licensed.formation, plain.formation);
        assert_eq!(licensed.tactics_phase, plain.tactics_phase);
        assert_eq!(licensed.player_roles, plain.player_roles);
    }
}
