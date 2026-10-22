//! The squad bridge (phase 3, E3-5a): who a club puts out and how the engine sees them. Pick the XI
//! (by hand for a manager's club, by a reputation-aware policy for an AI club), seat it slot by
//! slot, convert players, roles and dials to the engine's mirror types, and name the set-piece
//! takers. Pure: the caller gathers the club's players, its head coach and the day's seed —
//! `ofm_core::turn::squad` from the save, the online server from its tables.

use crate::ai_roles::role_for_position;
use crate::player_rating::{
    SlotFamiliarity, effective_rating_for_assignment, formation_slots, natural_ovr,
    positional_fit_for_assignment, slot_familiarity,
};
use crate::stable_hash::stable_hash;
use domain::player::Position as DomainPosition;
use engine::{
    BreakSpeed, CounterPressDuration, DefensiveLine, DefensiveShape, MarkingStyle, MatchCommand,
    MatchSnapshot, PitchPosition, PlayStyle, PlayerData, PlayerRole as EnginePlayerRole, Position,
    PositionFit, PositionRating, PressingIntensity, Side, TacticsBuildUpStyle, TacticsConfig,
    TacticsPitchWidth, TeamData, Tempo,
};
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// Domain → Engine conversion with starting XI / bench split
// ---------------------------------------------------------------------------

/// Everything a club's side for one match is picked from.
pub struct SideSelection<'a> {
    pub team_id: &'a str,
    /// The club; `None` plays an unknown 4-4-2 side as the engine's defaults.
    pub team: Option<&'a domain::team::Team>,
    /// The club's fit players, in the save's order.
    pub available: &'a [&'a domain::player::Player],
    /// The club's injured players, in the save's order: a short XI is made up from them.
    pub injured: &'a [&'a domain::player::Player],
    /// A manager picks this club's XI by hand; otherwise the AI policy does.
    pub is_user_team: bool,
    /// The head coach's command of each style ([`coach_mastery_of`]).
    pub head_coach: engine::CoachMastery,
    /// The AI policy's judgement, 0.0–1.0 ([`management_quality`]).
    pub management_quality: f64,
    /// The AI's misjudgements for this matchday ([`selection_seed`]).
    pub selection_seed: u64,
    pub load: FixtureLoad,
}

/// The side a club puts out: its XI as the engine plays it, slot-aligned, and its bench, best
/// first.
pub fn build_side(selection: &SideSelection<'_>) -> (TeamData, Vec<PlayerData>) {
    let team = selection.team;
    let team_id = selection.team_id;
    let (name, formation, play_style, tactics, saved_xi_ids) = match team {
        Some(t) => (
            t.name.clone(),
            t.formation.clone(),
            engine_play_style(&t.play_style),
            domain_to_engine_tactics(&t.tactics_phase),
            t.starting_xi_ids.as_slice(),
        ),
        None => (
            "Unknown".into(),
            "4-4-2".into(),
            PlayStyle::Balanced,
            TacticsConfig::default(),
            &[] as &[String],
        ),
    };

    let available_players = selection.available;
    let player_roles = team.map(|t| &t.player_roles);
    // `deployed` is the granular slot the player occupies; `None` for the bench,
    // where the player's own position is used instead. The engine's coarse
    // position is derived from this so a player fielded out of position (e.g. a
    // striker at centre-back) is simulated in the position they actually play.
    // A role counts only where the position a player is playing admits it: his
    // slot if he starts, his natural position on the bench — the same rule the
    // player's own role command enforces. Stored roles can outlive it: AI roles
    // are chosen against a coarse bucket (`Forward` admits `WideForward`, a
    // striker's slot does not), and anyone's can go stale when the side changes.
    let convert_player = |p: &domain::player::Player, deployed: Option<&DomainPosition>| {
        let playing_at = deployed.unwrap_or(&p.natural_position);
        let role = player_roles
            .and_then(|roles| roles.get(&p.id))
            .filter(|role| playing_at.admits_role(role))
            .map(domain_to_engine_role)
            .unwrap_or(EnginePlayerRole::Standard);
        to_engine_player(p, role, deployed)
    };

    // The user manages their own XI by hand (saved_xi_ids); AI clubs are managed
    // by a reputation-driven policy that picks a first-choice XI and rotates for
    // load management. Gate on the user team explicitly, NOT on "saved XI empty",
    // so the human's early-career auto-built XI stays reputation-independent.
    let is_user_team = selection.is_user_team;
    let mut starting_players = if is_user_team {
        select_starting_xi(saved_xi_ids, available_players, &formation)
    } else {
        ai_select_starting_xi(
            available_players,
            &formation,
            selection.management_quality,
            selection.selection_seed,
            selection.load,
        )
    };
    // Both select_starting_xi and ai_select_starting_xi return a slot-aligned XI
    // (entry i plays formation slot i), so the list index is the deployed slot.
    let slots = formation_slots(&formation);
    fill_from_the_treatment_room(selection.injured, &slots, &mut starting_players);
    let used_ids: HashSet<String> = starting_players
        .iter()
        .map(|player| player.id.clone())
        .collect();
    let mut starting_xi: Vec<PlayerData> = starting_players
        .iter()
        .enumerate()
        .map(|(slot_index, p)| convert_player(p, slots.get(slot_index)))
        .collect();
    if !is_user_team {
        split_ai_centre_back_pair(&mut starting_xi, &starting_players, &slots);
    }

    let mut bench_domain: Vec<&domain::player::Player> = available_players
        .iter()
        .copied()
        .filter(|player| !used_ids.contains(&player.id))
        .collect();
    bench_domain.sort_by(|left, right| {
        natural_ovr(right)
            .partial_cmp(&natural_ovr(left))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let bench = bench_domain
        .into_iter()
        .map(|p| convert_player(p, None))
        .collect();

    let team_data = TeamData {
        id: team_id.to_string(),
        name,
        formation,
        play_style,
        coach: selection.head_coach,
        players: starting_xi,
        tactics,
    };

    (team_data, bench)
}

/// A head coach's command of each style, as the engine sees it. A club with nobody in the dugout
/// plays its style as the table prices it.
pub fn coach_mastery_of(manager: Option<&domain::manager::Manager>) -> engine::CoachMastery {
    manager
        .map(|manager| {
            let mastery = &manager.play_style_mastery;
            engine::CoachMastery {
                balanced: mastery.balanced,
                attacking: mastery.attacking,
                defensive: mastery.defensive,
                possession: mastery.possession,
                counter: mastery.counter,
                high_press: mastery.high_press,
            }
        })
        .unwrap_or_default()
}

/// Make a short XI up to the number of slots the formation asks for, drawing on
/// players who are carrying an injury.
///
/// Selection proper only ever considers fit players, so this runs on what it
/// leaves behind: it can add nobody a manager would have picked anyway. It
/// exists because a side has to be put out. Handed a side with nobody in it the
/// engine indexes a player who is not there and brings the whole day down; and
/// handed a short one it never counts the missing men, since an absent position
/// group falls back to a fixed rating and absent roles borrow whoever is left.
/// So neither fielding nobody nor fielding four is a thing the simulation can
/// be trusted to punish. A club that cannot name eleven fit players plays its
/// walking wounded instead, least serious knock first.
///
/// A club with no registered players at all still comes back empty. That is a
/// broken save rather than an injury crisis, and papering over it here would
/// only hide it.
fn fill_from_the_treatment_room<'a>(
    injured: &[&'a domain::player::Player],
    slots: &[DomainPosition],
    starting_players: &mut Vec<&'a domain::player::Player>,
) {
    let wanted = slots.len().min(11);
    if starting_players.len() >= wanted {
        return;
    }

    let mut used: HashSet<&str> = starting_players.iter().map(|p| p.id.as_str()).collect();
    let already_named = starting_players.len();
    for slot in slots.iter().take(wanted).skip(already_named) {
        let best = injured
            .iter()
            .copied()
            .filter(|p| p.injury.is_some() && !used.contains(p.id.as_str()))
            .min_by(|left, right| {
                let days = |p: &domain::player::Player| {
                    p.injury.as_ref().map_or(0, |injury| injury.days_remaining)
                };
                days(left).cmp(&days(right)).then_with(|| {
                    effective_rating_for_assignment(right, slot)
                        .partial_cmp(&effective_rating_for_assignment(left, slot))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
            });

        let Some(player) = best else {
            break; // The treatment room is empty too — field what we have.
        };
        used.insert(player.id.as_str());
        starting_players.push(player);
    }

    reseat_by_position(slots, starting_players);
}

/// Put a topped-up eleven back into the slots its players actually fit.
///
/// Selection filled the formation from the front with the fit players it had,
/// so the vacancies a top-up fills are whatever slots were left over at the
/// back — in a 4-4-2, up front. Appending there would play an injured keeper at
/// centre-forward with an outfielder in goal in his place. Who plays is already
/// decided; this only decides where, slot by slot, by the same condition-free
/// fit the AI's first-choice eleven is picked on.
fn reseat_by_position(
    slots: &[DomainPosition],
    starting_players: &mut Vec<&domain::player::Player>,
) {
    let mut unseated = std::mem::take(starting_players);
    for slot in slots.iter().take(unseated.len()) {
        let best = unseated
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| {
                positional_fit_for_assignment(left, slot)
                    .partial_cmp(&positional_fit_for_assignment(right, slot))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(index, _)| index);
        if let Some(index) = best {
            starting_players.push(unseated.remove(index));
        }
    }
}

pub fn select_starting_xi<'a>(
    saved_xi_ids: &[String],
    available_players: &[&'a domain::player::Player],
    formation: &str,
) -> Vec<&'a domain::player::Player> {
    let players_by_id: HashMap<&str, &domain::player::Player> = available_players
        .iter()
        .map(|player| (player.id.as_str(), *player))
        .collect();

    // Count the distinct saved starters that are still available.
    let mut seen_saved = HashSet::new();
    let valid_saved = saved_xi_ids
        .iter()
        .filter(|id| players_by_id.contains_key(id.as_str()) && seen_saved.insert((*id).clone()))
        .count();

    // Too few of the saved XI remain valid — rebuild a fresh, slot-aligned XI.
    if valid_saved < 8 {
        return auto_select_starting_xi(available_players, formation);
    }

    let slots = formation_slots(formation);
    let slot_count = slots.len().min(11);
    let mut chosen: Vec<Option<&domain::player::Player>> = vec![None; slot_count];
    let mut used_ids: HashSet<String> = HashSet::new();

    // Pass 1: keep each available saved starter at the slot it was saved in, so
    // the result is indexed by slot (chosen[i] plays formation slot i).
    for (slot_index, chosen_slot) in chosen.iter_mut().enumerate() {
        if let Some(player) = saved_xi_ids
            .get(slot_index)
            .and_then(|id| players_by_id.get(id.as_str()))
            && used_ids.insert(player.id.clone())
        {
            *chosen_slot = Some(*player);
        }
    }

    // Pass 2: fill any slot vacated by an unavailable saved starter (e.g. an
    // injured goalkeeper) with the best-fit remaining player FOR THAT SLOT, so
    // the lineup never loses a position and stays slot-aligned.
    for (slot_index, chosen_slot) in chosen.iter_mut().enumerate() {
        if chosen_slot.is_some() {
            continue;
        }
        let slot = &slots[slot_index];
        let best = available_players
            .iter()
            .copied()
            .filter(|player| !used_ids.contains(&player.id))
            .max_by(|left, right| {
                effective_rating_for_assignment(left, slot)
                    .partial_cmp(&effective_rating_for_assignment(right, slot))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        if let Some(player) = best {
            used_ids.insert(player.id.clone());
            *chosen_slot = Some(player);
        }
    }

    // If a slot could not be filled (fewer available players than slots), fall
    // back to a contiguous slot-aligned selection. flatten()ing a list with a
    // gap would shift later starters into earlier slots and break the caller's
    // index->slot mapping.
    if chosen.iter().any(Option::is_none) {
        return auto_select_starting_xi(available_players, formation);
    }

    chosen.into_iter().map(Option::unwrap).collect()
}

pub fn auto_select_starting_xi<'a>(
    available_players: &[&'a domain::player::Player],
    formation: &str,
) -> Vec<&'a domain::player::Player> {
    let slots = formation_slots(formation);
    let mut used_ids = HashSet::new();
    let mut starting_xi = Vec::with_capacity(11);

    for slot in slots.iter().take(11) {
        let best_player = available_players
            .iter()
            .copied()
            .filter(|player| !used_ids.contains(&player.id))
            .max_by(|left, right| {
                effective_rating_for_assignment(left, slot)
                    .partial_cmp(&effective_rating_for_assignment(right, slot))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

        let Some(player) = best_player else {
            break;
        };

        used_ids.insert(player.id.clone());
        starting_xi.push(player);
    }

    starting_xi
}

/// Maps a club's reputation to a 0.0–1.0 management-quality score. Generated club
/// reputations span roughly 300 (lower divisions) to 900 (elite). Quality drives
/// how proactively the AI rotates for player freshness.
pub fn management_quality(reputation: u32) -> f64 {
    (((reputation as f64) - 300.0) / 600.0).clamp(0.0, 1.0)
}

/// Maps a manager's overall rating (≈30–95) to a 0.0–1.0 management-quality score.
pub fn management_quality_from_rating(rating: u8) -> f64 {
    ((f64::from(rating) - 30.0) / 65.0).clamp(0.0, 1.0)
}

/// Whether this club plays again soon after the match it is picking a side for.
///
/// This is what makes resting a merely tired player worth fielding a weaker one.
/// On a normal week the next match is seven days off and a tired first eleven
/// recovers by then; on a congested run it is three or four, and it does not.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FixtureLoad {
    Normal,
    Congested,
}

/// One club's judgement for one matchday. Derived rather than rolled, so asking
/// for the same fixture's lineup twice gives the same answer — the builder runs
/// on both match paths and must not name a different side each time.
pub fn selection_seed(team_id: &str, date: &str) -> u64 {
    stable_hash(date.as_bytes(), stable_hash(team_id.as_bytes(), 0))
}

/// How wrong this manager is about this player today, as −1.0 ..= 1.0.
fn judgement_noise(seed: u64, player_id: &str) -> f64 {
    let hash = stable_hash(player_id.as_bytes(), seed);
    let unit = (hash >> 11) as f64 / (1u64 << 53) as f64;
    unit * 2.0 - 1.0
}

/// The eleven a club would pick if nobody were tired: for each formation slot in
/// turn, the best condition-free positional fit not already chosen, returned in
/// slot order.
///
/// Step one of the AI's team selection, and also what AI training reads to judge
/// how fresh its first eleven is — the two must agree on who that eleven is, or
/// the controller steers on players who never start (a spare keeper, most
/// often). Ties break on id so the answer does not depend on the order the
/// squad happens to be stored in.
pub fn first_choice_eleven<'a>(
    available_players: &[&'a domain::player::Player],
    formation: &str,
) -> Vec<&'a domain::player::Player> {
    let mut chosen: Vec<&'a domain::player::Player> = Vec::with_capacity(11);
    for slot in formation_slots(formation).iter().take(11) {
        let best = available_players
            .iter()
            .copied()
            .filter(|player| !chosen.iter().any(|picked| picked.id == player.id))
            .max_by(|left, right| {
                positional_fit_for_assignment(left, slot)
                    .partial_cmp(&positional_fit_for_assignment(right, slot))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| right.id.cmp(&left.id))
            });
        let Some(player) = best else {
            break;
        };
        chosen.push(player);
    }
    chosen
}

/// Reputation-aware AI lineup selection.
///
/// Step 1 picks the first-choice XI purely on condition-free positional fit, so a
/// club always fields its best players when fresh. Step 2 rests the tired ones.
///
/// What management quality buys is **judgement, not willingness**. A weak manager
/// notices fatigue later (`rest_threshold`) and is a worse judge of who can
/// deputise (`misjudgement`) — but every manager wants to win, so none of them
/// deliberately sends out a player who cannot run. Two rules keep that honest:
///
/// - The quality drop a manager will accept in order to rest someone is bounded
///   below. It used to be `12 × quality`, which handed the worst manager a
///   tolerance of exactly zero: since step 1 has already taken the best player
///   for the slot, no remaining deputy can match them, so rotation was
///   arithmetically impossible however exhausted the XI became. That was not a
///   gradient, it was self-harm.
/// - Below `EXHAUSTED` there is no gradient at all. A player that spent is
///   visibly unfit to start and comes out for anyone adequate.
///
/// Where judgement does bite is *which* deputy gets the shirt: the adequacy gate
/// is applied to a player's real standard, so no manager talks themselves into
/// fielding someone hopeless, but the choice between adequate options is made on
/// what the manager believes, which a poor one gets wrong.
pub fn ai_select_starting_xi<'a>(
    available_players: &[&'a domain::player::Player],
    formation: &str,
    quality: f64,
    seed: u64,
    load: FixtureLoad,
) -> Vec<&'a domain::player::Player> {
    /// A rotation candidate must be at least this fresh to be worth considering.
    const FRESH_FLOOR: f64 = 60.0;
    /// And meaningfully fresher than the starter it would replace.
    const MIN_FRESHNESS_GAIN: i16 = 10;
    /// Below this a player is not fit to start, whatever their manager makes of
    /// the alternatives. This is the floor the quality gradient stands on.
    const EXHAUSTED: f64 = 45.0;
    /// Quality drop a manager will accept to rest someone, worst and best. Never
    /// zero: a manager who will accept no drop can never rotate at all.
    const MIN_FIT_TOLERANCE: f64 = 6.0;
    const MAX_FIT_TOLERANCE: f64 = 12.0;
    /// On a congested run every manager rests earlier, and accepts a little more
    /// of a drop to do it — a tired first eleven asked to play twice in four days
    /// arrives spent at the second match however good it is. Manager quality
    /// still shades both: a better one rests sooner. See [`FixtureLoad`].
    const CONGESTED_REST_THRESHOLD: f64 = 90.0;
    const CONGESTED_REST_BY_QUALITY: f64 = 10.0;
    const CONGESTED_MIN_FIT_TOLERANCE: f64 = 10.0;
    /// And what any of them will accept to get an exhausted player off the pitch.
    const EXHAUSTED_FIT_TOLERANCE: f64 = 20.0;
    /// How far the worst manager can misread a player's standard, either way.
    const MAX_MISJUDGEMENT: f64 = 9.0;

    let slots = formation_slots(formation);

    // Step 1: first-choice XI by condition-free positional fit.
    // (slot index, chosen player) so the rotation step can re-evaluate per slot.
    let mut selected: Vec<(usize, &'a domain::player::Player)> =
        first_choice_eleven(available_players, formation)
            .into_iter()
            .enumerate()
            .collect();
    let mut used_ids: HashSet<String> = selected
        .iter()
        .map(|(_, player)| player.id.clone())
        .collect();

    // Step 2: load management.
    let (rest_threshold, min_tolerance) = match load {
        // 50 (poor) .. 75 (elite); tolerance 6 .. 12.
        FixtureLoad::Normal => (50.0 + 25.0 * quality, MIN_FIT_TOLERANCE),
        // 90 (poor) .. 100 (elite); tolerance 10 .. 12.
        FixtureLoad::Congested => (
            CONGESTED_REST_THRESHOLD + CONGESTED_REST_BY_QUALITY * quality,
            CONGESTED_MIN_FIT_TOLERANCE,
        ),
    };
    let fit_tolerance = min_tolerance + (MAX_FIT_TOLERANCE - min_tolerance) * quality;
    let misjudgement = MAX_MISJUDGEMENT * (1.0 - quality); // 9 (poor) .. 0 (elite)

    // What the manager believes a player is worth in this slot, which is the
    // truth only for the very best of them. Stable per player per matchday, so a
    // manager holds one opinion for the whole team sheet rather than a fresh one
    // per comparison.
    let perceived_fit = |player: &domain::player::Player, slot: &DomainPosition| {
        positional_fit_for_assignment(player, slot)
            + judgement_noise(seed, &player.id) * misjudgement
    };

    for entry in selected.iter_mut() {
        let slot = &slots[entry.0];
        let starter = entry.1;

        let condition = f64::from(starter.condition);
        if condition >= rest_threshold {
            continue; // Fresh enough — no reason to rotate.
        }
        // A spent player comes out for anyone adequate; a merely tired one only
        // for someone close to their own standard.
        let tolerance = if condition < EXHAUSTED {
            EXHAUSTED_FIT_TOLERANCE
        } else {
            fit_tolerance
        };

        let starter_fit = positional_fit_for_assignment(starter, slot);
        let starter_group = starter.position.to_group_position();
        let fresh_alternative = available_players
            .iter()
            .copied()
            .filter(|player| !used_ids.contains(&player.id))
            // Only rotate within the same position group, so load management never
            // skews the formation's distribution (e.g. fielding a 5th midfielder
            // in place of a defender, which would leave the XI a man short).
            .filter(|player| player.position.to_group_position() == starter_group)
            .filter(|player| f64::from(player.condition) >= FRESH_FLOOR)
            .filter(|player| {
                i16::from(player.condition) - i16::from(starter.condition) >= MIN_FRESHNESS_GAIN
            })
            // Adequacy is measured against what the deputy can actually do. A
            // manager may misjudge which of two capable players is better; none of
            // them mistakes a reserve-team player for a first-choice one.
            .filter(|player| positional_fit_for_assignment(player, slot) >= starter_fit - tolerance)
            // The choice between adequate options, though, is the manager's read.
            .max_by(|left, right| {
                perceived_fit(left, slot)
                    .partial_cmp(&perceived_fit(right, slot))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });

        if let Some(fresh) = fresh_alternative {
            used_ids.remove(&starter.id);
            used_ids.insert(fresh.id.clone());
            entry.1 = fresh;
        }
    }

    selected.into_iter().map(|(_, player)| player).collect()
}

pub fn domain_to_engine_role(role: &domain::team::PlayerRole) -> EnginePlayerRole {
    match role {
        domain::team::PlayerRole::Standard => EnginePlayerRole::Standard,
        domain::team::PlayerRole::BallPlayingKeeper => EnginePlayerRole::BallPlayingKeeper,
        domain::team::PlayerRole::SweeperKeeper => EnginePlayerRole::SweeperKeeper,
        domain::team::PlayerRole::Stopper => EnginePlayerRole::Stopper,
        domain::team::PlayerRole::CoverCB => EnginePlayerRole::CoverCB,
        domain::team::PlayerRole::BallPlayingCB => EnginePlayerRole::BallPlayingCB,
        domain::team::PlayerRole::AttackingFB => EnginePlayerRole::AttackingFB,
        domain::team::PlayerRole::DefensiveFB => EnginePlayerRole::DefensiveFB,
        domain::team::PlayerRole::InvertedFB => EnginePlayerRole::InvertedFB,
        domain::team::PlayerRole::WingBack => EnginePlayerRole::WingBack,
        domain::team::PlayerRole::AnchorMan => EnginePlayerRole::AnchorMan,
        domain::team::PlayerRole::BallWinner => EnginePlayerRole::BallWinner,
        domain::team::PlayerRole::DeepLyingPlaymaker => EnginePlayerRole::DeepLyingPlaymaker,
        domain::team::PlayerRole::BoxToBox => EnginePlayerRole::BoxToBox,
        domain::team::PlayerRole::Carrilero => EnginePlayerRole::Carrilero,
        domain::team::PlayerRole::Mezzala => EnginePlayerRole::Mezzala,
        domain::team::PlayerRole::AdvancedPlaymaker => EnginePlayerRole::AdvancedPlaymaker,
        domain::team::PlayerRole::ShadowStriker => EnginePlayerRole::ShadowStriker,
        domain::team::PlayerRole::WideForward => EnginePlayerRole::WideForward,
        domain::team::PlayerRole::InsideForward => EnginePlayerRole::InsideForward,
        domain::team::PlayerRole::InvertedWinger => EnginePlayerRole::InvertedWinger,
        domain::team::PlayerRole::Poacher => EnginePlayerRole::Poacher,
        domain::team::PlayerRole::TargetMan => EnginePlayerRole::TargetMan,
        domain::team::PlayerRole::DeepLyingForward => EnginePlayerRole::DeepLyingForward,
        domain::team::PlayerRole::False9 => EnginePlayerRole::False9,
        domain::team::PlayerRole::HalfBack => EnginePlayerRole::HalfBack,
        domain::team::PlayerRole::DefensiveWinger => EnginePlayerRole::DefensiveWinger,
        domain::team::PlayerRole::PressingForward => EnginePlayerRole::PressingForward,
        domain::team::PlayerRole::CompleteForward => EnginePlayerRole::CompleteForward,
    }
}

pub fn domain_to_engine_tactics(t: &domain::team::TacticsPhaseSettings) -> TacticsConfig {
    TacticsConfig {
        pressing_intensity: match t.pressing_intensity {
            domain::team::PressingIntensity::Passive => PressingIntensity::Passive,
            domain::team::PressingIntensity::Medium => PressingIntensity::Medium,
            domain::team::PressingIntensity::Aggressive => PressingIntensity::Aggressive,
        },
        defensive_line: match t.defensive_line {
            domain::team::DefensiveLine::VeryLow => DefensiveLine::VeryLow,
            domain::team::DefensiveLine::Low => DefensiveLine::Low,
            domain::team::DefensiveLine::Medium => DefensiveLine::Medium,
            domain::team::DefensiveLine::High => DefensiveLine::High,
        },
        width: match t.width {
            domain::team::PitchWidth::Narrow => TacticsPitchWidth::Narrow,
            domain::team::PitchWidth::Normal => TacticsPitchWidth::Normal,
            domain::team::PitchWidth::Wide => TacticsPitchWidth::Wide,
        },
        build_up_style: match t.build_up_style {
            domain::team::BuildUpStyle::Short => TacticsBuildUpStyle::Short,
            domain::team::BuildUpStyle::Mixed => TacticsBuildUpStyle::Mixed,
            domain::team::BuildUpStyle::Long => TacticsBuildUpStyle::Long,
        },
        marking_style: match t.marking_style {
            domain::team::MarkingStyle::Zonal => MarkingStyle::Zonal,
            domain::team::MarkingStyle::Mixed => MarkingStyle::Mixed,
            domain::team::MarkingStyle::ManToMan => MarkingStyle::ManToMan,
        },
        tempo: match t.tempo {
            domain::team::Tempo::Patient => Tempo::Patient,
            domain::team::Tempo::Direct => Tempo::Direct,
        },
        defensive_shape: match t.defensive_shape {
            domain::team::DefensiveShape::Stretched => DefensiveShape::Stretched,
            domain::team::DefensiveShape::Normal => DefensiveShape::Normal,
            domain::team::DefensiveShape::Compact => DefensiveShape::Compact,
        },
        counter_press_duration: match t.counter_press_duration {
            domain::team::CounterPressDuration::None => CounterPressDuration::None,
            domain::team::CounterPressDuration::Short => CounterPressDuration::Short,
            domain::team::CounterPressDuration::Long => CounterPressDuration::Long,
        },
        break_speed: match t.break_speed {
            domain::team::BreakSpeed::Slow => BreakSpeed::Slow,
            domain::team::BreakSpeed::Medium => BreakSpeed::Medium,
            domain::team::BreakSpeed::Fast => BreakSpeed::Fast,
        },
        cross_style: match t.cross_style {
            domain::team::CrossStyle::Mixed => engine::CrossStyle::Mixed,
            domain::team::CrossStyle::High => engine::CrossStyle::High,
            domain::team::CrossStyle::Low => engine::CrossStyle::Low,
            domain::team::CrossStyle::Early => engine::CrossStyle::Early,
        },
        offside_trap: match t.offside_trap {
            domain::team::OffsideTrap::Off => engine::OffsideTrap::Off,
            domain::team::OffsideTrap::On => engine::OffsideTrap::On,
        },
    }
}

pub fn to_engine_player(
    p: &domain::player::Player,
    role: EnginePlayerRole,
    deployed: Option<&DomainPosition>,
) -> PlayerData {
    // Fall back to the player's natural position (not `p.position`, which on
    // legacy saves can still hold a stale coarse bucket written by the old
    // set_formation stat-ranking).
    let group = deployed
        .cloned()
        .unwrap_or_else(|| p.natural_position.clone())
        .to_group_position();
    let pos = match group {
        DomainPosition::Goalkeeper => Position::Goalkeeper,
        DomainPosition::Defender => Position::Defender,
        DomainPosition::Midfielder => Position::Midfielder,
        DomainPosition::Forward => Position::Forward,
        _ => Position::Midfielder,
    };
    // Every attribute goes over raw (phase 2, P4.0, X64). The rules still
    // tuned on the pre-split blends of `passing` and `dribbling` rebuild them
    // in the engine (`engine::legacy_passing`, `legacy_dribbling`), so that
    // reading `long_passing` or `first_touch` on its own never counts it twice.

    PlayerData {
        id: p.id.clone(),
        name: p.match_name.clone(),
        position: pos,
        ovr: p.ovr,
        condition: p.condition,
        fitness: p.fitness,
        pace: p.attributes.pace,
        stamina: p.attributes.stamina,
        strength: p.attributes.strength,
        agility: p.attributes.agility,
        passing: p.attributes.passing,
        shooting: p.attributes.shooting,
        tackling: p.attributes.tackling,
        dribbling: p.attributes.dribbling,
        defending: p.attributes.defending,
        positioning: p.attributes.positioning,
        vision: p.attributes.vision,
        decisions: p.attributes.decisions,
        composure: p.attributes.composure,
        aggression: p.attributes.aggression,
        teamwork: p.attributes.teamwork,
        leadership: p.attributes.leadership,
        handling: p.attributes.handling,
        reflexes: p.attributes.reflexes,
        aerial: p.attributes.aerial,
        long_passing: p.attributes.long_passing,
        crossing: p.attributes.crossing,
        curve: p.attributes.curve,
        free_kick: p.attributes.free_kick,
        long_shots: p.attributes.long_shots,
        first_touch: p.attributes.first_touch,
        heading: p.attributes.heading,
        height_cm: p.height_cm,
        footedness: match p.footedness {
            domain::player::Footedness::Left => engine::Foot::Left,
            domain::player::Footedness::Right => engine::Foot::Right,
            domain::player::Footedness::Both => engine::Foot::Both,
        },
        // Live-match snapshots reach the client, and Wonderkid would give the
        // ceiling away; the engine has no use for it.
        traits: p
            .traits
            .iter()
            .filter(|t| **t != domain::player::PlayerTrait::Wonderkid)
            .map(|t| format!("{:?}", t))
            .collect(),
        role,
        position_ratings: position_ratings(p),
    }
}

/// An AI club does not field two Stoppers, or two Cover CBs, side by side:
/// the engine makes either pair pay for the gap it leaves (phase 2, P2.6).
/// The change is to the side the engine plays; the club's stored roles stay.
fn split_ai_centre_back_pair(
    xi: &mut [PlayerData],
    starters: &[&domain::player::Player],
    slots: &[DomainPosition],
) {
    let mut centre_backs: Vec<(usize, &domain::player::Player, domain::team::PlayerRole)> = slots
        .iter()
        .enumerate()
        .filter(|(_, slot)| **slot == DomainPosition::CenterBack)
        .filter_map(|(index, _)| {
            let role = match xi.get(index)?.role {
                EnginePlayerRole::Stopper => domain::team::PlayerRole::Stopper,
                EnginePlayerRole::CoverCB => domain::team::PlayerRole::CoverCB,
                _ => domain::team::PlayerRole::Standard,
            };
            Some((index, *starters.get(index)?, role))
        })
        .collect();
    // Each change takes one player out of the shared role, so this ends.
    loop {
        let pairs: Vec<(&domain::player::Player, domain::team::PlayerRole)> = centre_backs
            .iter()
            .map(|(_, player, role)| (*player, role.clone()))
            .collect();
        let Some((at, instead)) = crate::ai_roles::split_matching_centre_backs(&pairs) else {
            break;
        };
        let slot_index = centre_backs[at].0;
        xi[slot_index].role = domain_to_engine_role(&instead);
        centre_backs[at].2 = instead;
    }
}

/// The engine's pitch position for each granular domain position.
pub const PITCH_POSITIONS: [(DomainPosition, PitchPosition); 14] = [
    (DomainPosition::Goalkeeper, PitchPosition::Goalkeeper),
    (DomainPosition::RightBack, PitchPosition::RightBack),
    (DomainPosition::CenterBack, PitchPosition::CenterBack),
    (DomainPosition::LeftBack, PitchPosition::LeftBack),
    (DomainPosition::RightWingBack, PitchPosition::RightWingBack),
    (DomainPosition::LeftWingBack, PitchPosition::LeftWingBack),
    (
        DomainPosition::DefensiveMidfielder,
        PitchPosition::DefensiveMidfielder,
    ),
    (
        DomainPosition::CentralMidfielder,
        PitchPosition::CentralMidfielder,
    ),
    (
        DomainPosition::AttackingMidfielder,
        PitchPosition::AttackingMidfielder,
    ),
    (
        DomainPosition::RightMidfielder,
        PitchPosition::RightMidfielder,
    ),
    (
        DomainPosition::LeftMidfielder,
        PitchPosition::LeftMidfielder,
    ),
    (DomainPosition::RightWinger, PitchPosition::RightWinger),
    (DomainPosition::LeftWinger, PitchPosition::LeftWinger),
    (DomainPosition::Striker, PitchPosition::Striker),
];

/// The player rated at every pitch position, with the same rule AI lineups are
/// picked by (`positional_fit_for_assignment`: attributes weighted for the
/// position, less what an unfamiliar position and the wrong foot cost him), so
/// the engine plays him where he stands as well as the lineup picker thinks he
/// would.
pub fn position_ratings(p: &domain::player::Player) -> Vec<PositionRating> {
    PITCH_POSITIONS
        .iter()
        .map(|(domain_position, pitch_position)| PositionRating {
            position: *pitch_position,
            ovr: positional_fit_for_assignment(p, domain_position)
                .round()
                .clamp(1.0, 99.0) as u8,
            fit: match slot_familiarity(p, domain_position) {
                SlotFamiliarity::Natural => PositionFit::Natural,
                // A wing-back conversion costs nothing but is not his natural
                // slot: one natural slot each, the engine's reference.
                SlotFamiliarity::WingBackConversion
                | SlotFamiliarity::Alternate
                | SlotFamiliarity::SameGroup => PositionFit::Adapted,
                SlotFamiliarity::OtherGroup => PositionFit::Unfamiliar,
            },
        })
        .collect()
}

/// Set-piece takers picked from `players`:
/// (captain_id, penalty_taker_id, free_kick_taker_id, corner_taker_id).
pub fn pick_set_piece_takers(
    players: &[&domain::player::Player],
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
) {
    if players.is_empty() {
        return (None, None, None, None);
    }

    // Captain: highest leadership + teamwork
    let captain = players
        .iter()
        .max_by_key(|p| (p.attributes.leadership as u16) + (p.attributes.teamwork as u16))
        .map(|p| p.id.clone());

    // Penalty taker: highest shooting + composure (exclude GK). The match takes
    // its penalties from this pick, so it reads the pre-split shooting blend the
    // penalty model was tuned on (phase 2 moves penalties over in P2.4).
    let penalty = players
        .iter()
        .filter(|p| p.position != DomainPosition::Goalkeeper)
        .max_by_key(|p| {
            u16::from(p.attributes.legacy_blends(false).shooting)
                + u16::from(p.attributes.composure)
        })
        .map(|p| p.id.clone());

    // Free kick taker: 0.65·free kicks + 0.35·curve, in hundredths (exclude GK).
    let free_kick = players
        .iter()
        .filter(|p| p.position != DomainPosition::Goalkeeper)
        .max_by_key(|p| 65 * u16::from(p.attributes.free_kick) + 35 * u16::from(p.attributes.curve))
        .map(|p| p.id.clone());

    // Corner taker: 0.70·crossing + 0.30·curve, in hundredths (exclude GK,
    // prefer someone other than the free-kick taker).
    let corner = players
        .iter()
        .filter(|p| p.position != DomainPosition::Goalkeeper)
        .max_by_key(|p| {
            let base = 70 * u16::from(p.attributes.crossing) + 30 * u16::from(p.attributes.curve);
            // Small penalty if same as free kick taker to encourage variety
            if free_kick.as_ref() == Some(&p.id) {
                base.saturating_sub(500)
            } else {
                base
            }
        })
        .map(|p| p.id.clone());

    (captain, penalty, free_kick, corner)
}

/// Drop any assigned player function (role) that is no longer valid for the
/// granular field position the player now occupies, and return how many went.
///
/// A starter's position is his slot (the formation and the XI's order, the same
/// mapping the UI uses); anyone else's is his natural position, from
/// `natural_positions`. This keeps player functions dependent on the player's
/// *current* field position: e.g. a striker's `Poacher` is cleared when they are
/// moved into a defensive slot. EVERY assigned role is checked, not just starters':
/// a role that was valid in a player's slot must be cleared once he is benched,
/// otherwise the stale assignment persists and leaks back into match simulation.
pub fn reconcile_roles(
    team: &mut domain::team::Team,
    natural_positions: &HashMap<String, DomainPosition>,
) -> usize {
    if team.player_roles.is_empty() {
        return 0;
    }
    let slots = formation_slots(&team.formation);
    let invalid: Vec<String> = team
        .player_roles
        .iter()
        .filter_map(|(player_id, role)| {
            let position = team
                .starting_xi_ids
                .iter()
                .position(|id| id == player_id)
                .and_then(|slot_index| slots.get(slot_index).cloned())
                .or_else(|| natural_positions.get(player_id).cloned())?;
            (!position.admits_role(role)).then(|| player_id.clone())
        })
        .collect();
    for player_id in &invalid {
        team.player_roles.remove(player_id);
    }
    invalid.len()
}

// --- Before kick-off ---------------------------------------------------------

/// The roles two starters take after trading slots before kick-off
/// ([`MatchCommand::PreMatchSwapPositions`]), as commands to apply on top of it.
///
/// Each player gets the job his attributes argue for in the slot he moved
/// into, by the same rule AI squads are given roles. The commands touch this
/// match only: the club's saved roles, like its saved XI, are left alone.
pub fn pre_match_swap_roles(
    players: &[&domain::player::Player],
    snapshot: &MatchSnapshot,
    side: Side,
    player_ids: [&str; 2],
) -> Vec<MatchCommand> {
    let team = match side {
        Side::Home => &snapshot.home_team,
        Side::Away => &snapshot.away_team,
    };
    // The XI is slot-aligned only when every slot is filled.
    let slots = formation_slots(&team.formation);
    if slots.len() != team.players.len() {
        return Vec::new();
    }
    let play_style = domain_play_style(team.play_style);

    player_ids
        .into_iter()
        .filter_map(|player_id| {
            let slot_index = team.players.iter().position(|p| p.id == player_id)?;
            let player = players.iter().copied().find(|p| p.id == player_id)?;
            let role = role_for_position(player, &slots[slot_index], &play_style);
            Some(MatchCommand::ChangePlayerRole {
                side,
                player_id: player_id.to_string(),
                role: domain_to_engine_role(&role),
            })
        })
        .collect()
}

/// The commands that turn `side`'s XI, before kick-off, into the strongest
/// lineup for its formation from the players in the match (XI and bench).
///
/// Players are seated so the XI's summed rating is highest, each rated in his
/// slot by the AI lineup rule (`effective_rating_for_assignment`: fit for the
/// slot, weighed by condition); on a tie the player already standing in a slot
/// keeps it, so an XI that is already the best is left alone. Starters who
/// trade slots do so with `PreMatchSwapPositions`, a bench player comes on with
/// `PreMatchSwap`; neither is a substitution. Every player who moves or comes on
/// then takes the role his new slot suits, as after a manual slot trade.
pub fn strongest_pre_match_lineup(
    players: &[&domain::player::Player],
    snapshot: &MatchSnapshot,
    side: Side,
) -> Vec<MatchCommand> {
    let (team, bench) = match side {
        Side::Home => (&snapshot.home_team, &snapshot.home_bench),
        Side::Away => (&snapshot.away_team, &snapshot.away_bench),
    };
    let slots = formation_slots(&team.formation);
    if slots.len() != team.players.len() {
        return Vec::new();
    }
    let candidates: Vec<&domain::player::Player> = team
        .players
        .iter()
        .chain(bench.iter())
        .filter_map(|engine_player| players.iter().copied().find(|p| p.id == engine_player.id))
        .filter(|player| player.injury.is_none())
        .collect();

    let mut current: Vec<String> = team.players.iter().map(|p| p.id.clone()).collect();
    // The whole XI at once, not slot by slot (see `lineup_assignment`). A hair
    // of weight for the player already in a slot keeps him there on a tie.
    const KEEP_ON_TIE: f64 = 1e-6;
    let weights: Vec<Vec<f64>> = slots
        .iter()
        .enumerate()
        .map(|(index, slot)| {
            candidates
                .iter()
                .map(|player| {
                    let keep = if player.id == current[index] {
                        KEEP_ON_TIE
                    } else {
                        0.0
                    };
                    effective_rating_for_assignment(player, slot) + keep
                })
                .collect()
        })
        .collect();
    let assignment = crate::lineup_assignment::best_assignment(&weights);
    if assignment.len() != slots.len() {
        return Vec::new();
    }

    let mut commands = Vec::new();
    let mut moved = Vec::new();
    for (index, candidate) in assignment.into_iter().enumerate() {
        let best = candidates[candidate];
        if best.id == current[index] {
            continue;
        }
        let occupant = current[index].clone();
        match current.iter().position(|id| *id == best.id) {
            Some(other) => {
                commands.push(MatchCommand::PreMatchSwapPositions {
                    side,
                    player_a_id: occupant.clone(),
                    player_b_id: best.id.clone(),
                });
                current.swap(index, other);
                moved.push(occupant);
            }
            None => {
                commands.push(MatchCommand::PreMatchSwap {
                    side,
                    player_off_id: occupant,
                    player_on_id: best.id.clone(),
                });
                current[index] = best.id.clone();
            }
        }
        moved.push(best.id.clone());
    }

    let play_style = domain_play_style(team.play_style);
    for player_id in moved {
        let Some(index) = current.iter().position(|id| *id == player_id) else {
            continue;
        };
        if let Some(player) = players.iter().copied().find(|p| p.id == player_id) {
            let role = role_for_position(player, &slots[index], &play_style);
            commands.push(MatchCommand::ChangePlayerRole {
                side,
                player_id,
                role: domain_to_engine_role(&role),
            });
        }
    }
    commands
}

/// The engine's mirror of a club's play style.
pub fn engine_play_style(play_style: &domain::team::PlayStyle) -> engine::PlayStyle {
    match play_style {
        domain::team::PlayStyle::Balanced => engine::PlayStyle::Balanced,
        domain::team::PlayStyle::Attacking => engine::PlayStyle::Attacking,
        domain::team::PlayStyle::Defensive => engine::PlayStyle::Defensive,
        domain::team::PlayStyle::Possession => engine::PlayStyle::Possession,
        domain::team::PlayStyle::Counter => engine::PlayStyle::Counter,
        domain::team::PlayStyle::HighPress => engine::PlayStyle::HighPress,
    }
}

/// A club's play style from the engine's mirror.
pub fn domain_play_style(play_style: engine::PlayStyle) -> domain::team::PlayStyle {
    match play_style {
        engine::PlayStyle::Balanced => domain::team::PlayStyle::Balanced,
        engine::PlayStyle::Attacking => domain::team::PlayStyle::Attacking,
        engine::PlayStyle::Defensive => domain::team::PlayStyle::Defensive,
        engine::PlayStyle::Possession => domain::team::PlayStyle::Possession,
        engine::PlayStyle::Counter => domain::team::PlayStyle::Counter,
        engine::PlayStyle::HighPress => domain::team::PlayStyle::HighPress,
    }
}
