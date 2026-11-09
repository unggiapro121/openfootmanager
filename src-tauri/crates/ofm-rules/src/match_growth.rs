//! "Tập tích — trận trả" (E5-12): part of what a regular's sessions build is banked, and his
//! official matches pay it out.
//!
//! A session in a season with match growth develops a regular at a lower chance and banks the
//! difference, in expected attribute points, in his pool (`Player::match_xp_pending`, 100 = one
//! point). Each official match moves a share of the pool, by minutes played, to his bar
//! (`Player::match_xp`); a full bar is one point on one attribute. Neutral by construction: a
//! session's expected points and the pool's together are what the session gave before
//! (§3.4, T-2), and the bar's points land on the session's attributes in the proportion the
//! session's dice would have put them (PO review P1, T-8). No dice are cast, so the training
//! streams fall as they always have.
//!
//! The pool is a hidden balancing rule: it never reaches a player (`domain::persisted`).

use crate::player_rating::{attribute_mut, refresh_player_derived};
use crate::stable_hash::stable_hash;
use crate::training::{
    KeeperDrill, TrainingDay, best_focus, can_rise, focus_rolls, gate_open, is_keeper,
};
use domain::player::Player;
use domain::team::TrainingFocus;
use serde::{Deserialize, Serialize};

/// The season ruleset's `matchGrowth` (E5-12 E512-1): the share of a regular's development,
/// in thousandths, his sessions bank for his matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchGrowth {
    pub share_permille: u16,
}

/// Why a [`MatchGrowth`] cannot be run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchGrowthIssue {
    /// A share outside 1–600: none at all is None, and past 600 a regular would train slower
    /// than a player who never plays (the floor of 0.4).
    OutOfRange,
}

const MOST_SHARE_PERMILLE: u16 = 600;

impl MatchGrowth {
    /// Analysis-match-growth bản 3 (D-MG4): a quarter of a regular's rate.
    pub const PROPOSED: Self = Self {
        share_permille: 250,
    };

    /// Whether a season can run this share: 1..=600.
    pub fn validate(&self) -> Result<(), MatchGrowthIssue> {
        if (1..=MOST_SHARE_PERMILLE).contains(&self.share_permille) {
            Ok(())
        } else {
            Err(MatchGrowthIssue::OutOfRange)
        }
    }

    /// The share as a fraction of a regular's rate.
    pub(crate) fn share(&self) -> f64 {
        f64::from(self.share_permille) / 1000.0
    }
}

/// A full bar: one attribute point.
pub const BAR_FULL: u8 = 100;
/// The most a pool holds. A session that would bank past it banks nothing and rolls as the game
/// always has (D-MG10), so a player who seldom plays loses nothing.
pub const POOL_CAP: u8 = 150;
/// The most a bar may reach in one payout: one point and 99 over, so a match never gives two.
const BAR_MOST_IN_ONE_MATCH: u8 = 2 * BAR_FULL - 1;
/// A full match: more minutes pay no more.
const FULL_MATCH_MINUTES: u8 = 90;

/// One attribute a session rolls, as the pool weighs it: a focus attribute at a whole or half
/// chance, or one of the keeper's drill at its permille of a focus attribute's chance.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Candidate {
    pub key: &'static str,
    pub weight: f64,
    pub drill: bool,
}

impl Candidate {
    /// The chance of this attribute's roll in a session at `gain`, as the session takes it.
    pub(crate) fn chance(&self, gain: f64) -> f64 {
        if self.drill {
            self.weight * gain.min(1.0)
        } else {
            (self.weight * gain).min(1.0)
        }
    }
}

/// The attributes a session of `focus` rolls in `player` that can still rise, with their
/// weights; the keeper's `drill` adds handling, reflexes and aerial for a keeper unless the
/// focus is Recovery. No focus (None) is the drill alone.
pub(crate) fn candidates(
    player: &Player,
    focus: Option<&TrainingFocus>,
    drill: Option<KeeperDrill>,
) -> Vec<Candidate> {
    let attributes = &player.attributes;
    let mut list: Vec<Candidate> = focus
        .map(focus_rolls)
        .unwrap_or_default()
        .iter()
        .filter(|roll| {
            can_rise(
                crate::player_rating::attribute_value(attributes, roll.key),
                roll.split,
            )
        })
        .map(|roll| Candidate {
            key: roll.key,
            weight: if roll.half { 0.5 } else { 1.0 },
            drill: false,
        })
        .collect();
    let Some(drill) = drill else {
        return list;
    };
    if focus == Some(&TrainingFocus::Recovery) || !is_keeper(player) {
        return list;
    }
    for (key, value, permille) in [
        ("handling", attributes.handling, drill.handling_permille),
        ("reflexes", attributes.reflexes, drill.reflexes_permille),
        ("aerial", attributes.aerial, drill.aerial_permille),
    ] {
        if value < 99 && permille > 0 {
            list.push(Candidate {
                key,
                weight: f64::from(permille) / 1000.0,
                drill: true,
            });
        }
    }
    list
}

/// The expected points a session at `kept` instead of `full` leaves unrolled: what it banks.
pub(crate) fn banked_points(candidates: &[Candidate], full: f64, kept: f64) -> f64 {
    candidates
        .iter()
        .map(|candidate| candidate.chance(full) - candidate.chance(kept))
        .sum()
}

/// One open session of `player` on `focus` in a season with match growth (E5-12 §3.4): banks
/// what rolling at `kept` instead of `full` leaves, in hundredths of a point, and returns the
/// chance to roll at. A pool that would pass [`POOL_CAP`] banks nothing, and the session rolls
/// at `full` as the game always has.
pub(crate) fn bank(
    player: &mut Player,
    focus: &TrainingFocus,
    drill: Option<KeeperDrill>,
    full: f64,
    kept: f64,
) -> f64 {
    let points = banked_points(&candidates(player, Some(focus), drill), full, kept);
    let add = (points * 100.0).round();
    if add <= 0.0 || f64::from(player.match_xp_pending) + add > f64::from(POOL_CAP) {
        return full;
    }
    // At most POOL_CAP, checked above.
    player.match_xp_pending += add as u8;
    player.match_xp_focus = Some(focus.clone());
    kept
}

/// What one official match paid one player (E5-12 E512-6), for the post-match page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MatchXp {
    /// The bar before the match.
    pub before: u8,
    /// What moved from the pool to the bar.
    pub gained: u8,
    /// The bar after the match, less the 100 of a point when one was given.
    pub after: u8,
    /// The attribute that rose by one, by `PlayerAttributes` field name.
    pub attribute_up: Option<&'static str>,
    /// A full bar that cannot give its point: his gate is shut (his ceiling, or the growth cap)
    /// or every attribute it could raise is at 99.
    pub ready: bool,
}

/// Pays `player`'s pool for one official match he played `minutes` in, on `day` (E5-12 §3.5):
/// the pool's share by minutes moves to his bar, and a full bar gives one point, at most one a
/// match. A bar his gate holds shut stops at full, "ready", and what it cannot take stays in the
/// pool. None in a season without match growth, the player untouched. No dice.
pub fn pay(player: &mut Player, minutes: u8, day: &TrainingDay) -> Option<MatchXp> {
    day.match_growth?;
    let before = player.match_xp;
    let mut paid = MatchXp {
        before,
        gained: 0,
        after: before,
        attribute_up: None,
        ready: before >= BAR_FULL,
    };
    if minutes == 0 {
        return Some(paid);
    }
    let due = (u16::from(player.match_xp_pending) * u16::from(minutes.min(FULL_MATCH_MINUTES))
        + u16::from(FULL_MATCH_MINUTES / 2))
        / u16::from(FULL_MATCH_MINUTES);
    let focus = payout_focus(player);
    let candidates = candidates(player, focus.as_ref(), day.keeper_drill);
    let rises = gate_open(player, day) && !candidates.is_empty();
    let most = if rises {
        BAR_MOST_IN_ONE_MATCH
    } else {
        BAR_FULL
    };
    // `due` is at most the pool, so at most POOL_CAP.
    let gained = (due as u8).min(most.saturating_sub(before));
    player.match_xp_pending -= gained;
    player.match_xp = before + gained;
    paid.gained = gained;
    if rises && player.match_xp >= BAR_FULL {
        let key = pick(player, &candidates);
        if let Some(value) = attribute_mut(&mut player.attributes, key) {
            *value = (*value + 1).min(99);
        }
        player.match_xp -= BAR_FULL;
        player.match_xp_picks = player.match_xp_picks.wrapping_add(1);
        refresh_player_derived(player, day.year);
        paid.attribute_up = Some(key);
    }
    paid.after = player.match_xp;
    paid.ready = player.match_xp >= BAR_FULL;
    Some(paid)
}

/// The focus a full bar's point goes to: the one that banked last, or, when none did or it was
/// Recovery, the focus that lifts his OVR most (§3.6).
fn payout_focus(player: &Player) -> Option<TrainingFocus> {
    player
        .match_xp_focus
        .clone()
        .filter(|focus| *focus != TrainingFocus::Recovery)
        .or_else(|| best_focus(player, None))
}

/// φ − 1: steps of it around the unit circle spread as evenly as any sequence can (a Weyl
/// sequence of the golden ratio), so a player's picks follow the weights within a pick or two.
const GOLDEN_STEP: f64 = 0.618_033_988_749_894_9;
/// The seed of each player's starting point on that circle.
const PICK_SEED: u64 = 0x6535_3132_6170_6963;

/// The attribute a full bar raises (PO review P1, replacing E512-8): one of `candidates` with a
/// probability in proportion to its weight, as a session's dice would put the banked points, but
/// read off a fixed sequence instead of dice (D-MG1). The sequence starts at a point of the
/// player's own id, so a squad's first points do not all land on the same attribute.
pub(crate) fn pick(player: &Player, candidates: &[Candidate]) -> &'static str {
    let start = stable_hash(player.id.as_bytes(), PICK_SEED) as f64 / 2f64.powi(64);
    let point = (start + f64::from(player.match_xp_picks) * GOLDEN_STEP).fract();
    let total: f64 = candidates.iter().map(|candidate| candidate.weight).sum();
    let target = point * total;
    let mut reached = 0.0;
    for candidate in candidates {
        reached += candidate.weight;
        if target < reached {
            return candidate.key;
        }
    }
    candidates.last().map_or("", |candidate| candidate.key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::growth_cap::GrowthCap;
    use crate::player_rating::refresh_player_derived;
    use crate::player_rating::{attribute_value, ovr_from_attributes};
    use crate::playing_time::{development_factor, development_factor_kept};
    use crate::stable_hash::stable_hash;
    use crate::test_support::uniform_attributes;
    use crate::training::{
        ExtraParams, SessionKind, TeamTrainingPlan, extra_session, extra_session_rng,
        online_session, session_rng, team_training_plan,
    };
    use domain::persisted::Persisted;
    use domain::player::Position;
    use domain::team::{Team, TrainingIntensity};
    use rand::RngExt;

    const FOCUSES: [TrainingFocus; 6] = [
        TrainingFocus::Physical,
        TrainingFocus::Technical,
        TrainingFocus::Tactical,
        TrainingFocus::Defending,
        TrainingFocus::Attacking,
        TrainingFocus::Recovery,
    ];

    fn plan() -> TeamTrainingPlan {
        plan_at(TrainingIntensity::High)
    }

    fn plan_at(intensity: TrainingIntensity) -> TeamTrainingPlan {
        let mut team = Team::new(
            "club".into(),
            "Club".into(),
            "CLB".into(),
            "England".into(),
            "Town".into(),
            "Ground".into(),
            10_000,
        );
        team.training_intensity = intensity;
        team_training_plan(&team, &[], None)
    }

    fn day(growth_cap: Option<GrowthCap>, keeper_drill: Option<KeeperDrill>) -> TrainingDay {
        TrainingDay {
            weekday_num: 2,
            year: 2026,
            date: "2026-09-01".into(),
            development_multiplier: 6.0,
            keeper_drill,
            growth_cap,
            match_growth: None,
        }
    }

    /// `day` in a season with the proposed match growth.
    fn growth_day(growth_cap: Option<GrowthCap>, keeper_drill: Option<KeeperDrill>) -> TrainingDay {
        TrainingDay {
            match_growth: Some(MatchGrowth::PROPOSED),
            ..day(growth_cap, keeper_drill)
        }
    }

    /// A player of `born` at `position`, rated, with `potential` and `playing_time`; a few
    /// attributes near the top and one split attribute undeclared, so every edge of a session
    /// is reached.
    fn player(id: &str, born: &str, position: Position, potential: u8, playing_time: u8) -> Player {
        let mut player = Player::new(
            id.into(),
            id.into(),
            id.into(),
            born.into(),
            "England".into(),
            position,
            uniform_attributes(55),
        );
        player.attributes.tackling = 98;
        player.attributes.vision = 99;
        player.attributes.heading = 0;
        player.attributes.handling = 62;
        player.attributes.reflexes = 97;
        refresh_player_derived(&mut player, 2026);
        player.potential = potential;
        player.playing_time = playing_time;
        player
    }

    /// Sixty sessions of every focus in turn, every fifth followed by an extra one, and a
    /// fingerprint of the player at the end (through `Persisted`: the potential too).
    fn sixty_sessions(mut player: Player, day: &TrainingDay) -> u64 {
        let plan = plan();
        let id = player.id.clone();
        for session in 0..60u32 {
            player.condition = 90;
            player.training_focus = Some(FOCUSES[session as usize % FOCUSES.len()].clone());
            let date = format!("s{session}");
            online_session(
                &mut player,
                &plan,
                day,
                SessionKind::Manual,
                &mut session_rng(7, &id, &date),
            );
            if session % 5 == 4 {
                extra_session(
                    &mut player,
                    &plan,
                    day,
                    TrainingIntensity::Medium,
                    &ExtraParams::PROPOSED,
                    &mut extra_session_rng(7, &id, &date, 1),
                );
            }
        }
        let json = serde_json::to_string(&Persisted(&player)).expect("a player");
        stable_hash(json.as_bytes(), 0)
    }

    /// Every player and day of T-1: three ages, a keeper with and without his drill, a growth
    /// cap on and off, a regular and a fringe player.
    fn t1_fingerprints() -> Vec<u64> {
        let mut prints = Vec::new();
        for (growth_cap, drill) in [
            (None, None),
            (Some(GrowthCap::PROPOSED), None),
            (None, Some(KeeperDrill::PROPOSED)),
            (Some(GrowthCap::PROPOSED), Some(KeeperDrill::PROPOSED)),
        ] {
            let day = day(growth_cap, drill);
            for (id, born, position, potential, playing_time) in [
                ("young-mid", "2007-03-01", Position::Midfielder, 90, 80),
                ("mid-cb", "2002-03-01", Position::CenterBack, 80, 30),
                ("old-fw", "1995-03-01", Position::Forward, 70, 100),
                ("young-gk", "2008-03-01", Position::Goalkeeper, 93, 80),
                ("peaked", "2000-03-01", Position::Midfielder, 0, 80),
            ] {
                prints.push(sixty_sessions(
                    player(id, born, position, potential, playing_time),
                    &day,
                ));
            }
        }
        prints
    }

    /// The fingerprints of `t1_fingerprints` taken on `staging` 090a5bfed, before match growth.
    const T1_FINGERPRINTS: [u64; 20] = [
        4299727084871187147,
        17607177385359079725,
        1894262024519057475,
        12534601407162895232,
        5714961664107665427,
        8816367282075036082,
        17607177385359079725,
        1894262024519057475,
        4476135210742898695,
        5714961664107665427,
        4299727084871187147,
        17607177385359079725,
        1894262024519057475,
        12662139821964524614,
        5714961664107665427,
        8816367282075036082,
        17607177385359079725,
        1894262024519057475,
        15677293396832025586,
        5714961664107665427,
    ];

    /// Given players of every age, focus, gate and keeper's drill,
    /// when sixty sessions and twelve extra sessions are held in a season without match growth,
    /// then every one of them ends exactly as the game has always left him (T-1).
    #[test]
    fn without_match_growth_training_is_unchanged_to_the_bit() {
        assert_eq!(t1_fingerprints(), T1_FINGERPRINTS);
    }

    /// Given every share from 0 to 601,
    /// when a season's match growth is checked,
    /// then 1 to 600 can run and 0 and 601 cannot (S-1's rule, here at its source).
    #[test]
    fn a_share_runs_from_one_to_six_hundred_permille() {
        for (share_permille, runs) in [
            (0, false),
            (1, true),
            (250, true),
            (600, true),
            (601, false),
        ] {
            assert_eq!(
                MatchGrowth { share_permille }.validate().is_ok(),
                runs,
                "{share_permille}"
            );
        }
    }

    /// Defending's attributes at their weights, written out apart from the game's table, with
    /// whether each is split.
    const DEFENDING_BY_HAND: [(&str, f64, bool); 5] = [
        ("tackling", 1.0, false),
        ("defending", 1.0, false),
        ("strength", 0.5, false),
        ("positioning", 0.5, false),
        ("heading", 0.5, true),
    ];

    /// A session's expected points on Defending at `gain`, from the table by hand.
    fn defending_points(player: &Player, gain: f64) -> f64 {
        DEFENDING_BY_HAND
            .iter()
            .filter(|(key, _, split)| {
                let value = attribute_value(&player.attributes, key);
                value < 99 && !(*split && value == 0)
            })
            .map(|(_, weight, _)| (weight * gain).min(1.0))
            .sum()
    }

    /// Given a centre-back with tackling at 99 and no heading yet, on Defending (whole and half
    /// chances), at chances from 0.05 to 2.0 and playing times from 0 to 100,
    /// when a session's points at the kept chance and what it banks are added up,
    /// then they are the session's points at the full chance (T-2, neutral by construction).
    #[test]
    fn what_a_session_banks_makes_up_what_it_no_longer_rolls() {
        let mut player = player("cb", "2002-03-01", Position::CenterBack, 90, 80);
        player.attributes.tackling = 99;
        let candidates = candidates(&player, Some(&TrainingFocus::Defending), None);
        assert_eq!(
            candidates.iter().map(|c| c.key).collect::<Vec<_>>(),
            ["defending", "strength", "positioning"],
            "99 and an undeclared split attribute are not rolled"
        );
        for full in [0.05, 0.3, 0.9, 1.2, 2.0] {
            for playing_time in [0, 40, 80, 100] {
                let kept = full * development_factor_kept(playing_time, 0.25)
                    / development_factor(playing_time);
                let total =
                    defending_points(&player, kept) + banked_points(&candidates, full, kept);
                assert!(
                    (total - defending_points(&player, full)).abs() < 1e-9,
                    "chance {full}, playing time {playing_time}"
                );
            }
        }
    }

    /// Given a regular midfielder and his twin, both with 140 banked,
    /// when each has the same session, one in a season with match growth and one without,
    /// then a session that would bank past 150 banks nothing and rolls as the game always has:
    /// the two end the same to the bit (T-3, D-MG10).
    #[test]
    fn a_full_pool_banks_nothing_and_rolls_as_ever() {
        let mut banking = player("mid", "2002-03-01", Position::Midfielder, 90, 80);
        banking.training_focus = Some(TrainingFocus::Tactical);
        let mut empty = banking.clone();
        online_session(
            &mut empty,
            &plan(),
            &growth_day(None, None),
            SessionKind::Manual,
            &mut session_rng(3, "mid", "d"),
        );
        assert!(
            empty.match_xp_pending > 10,
            "the session banks {} from an empty pool",
            empty.match_xp_pending
        );

        banking.match_xp_pending = 140;
        let mut twin = banking.clone();
        online_session(
            &mut banking,
            &plan(),
            &growth_day(None, None),
            SessionKind::Manual,
            &mut session_rng(3, "mid", "d"),
        );
        online_session(
            &mut twin,
            &plan(),
            &day(None, None),
            SessionKind::Manual,
            &mut session_rng(3, "mid", "d"),
        );
        assert_eq!(banking.match_xp_pending, 140);
        assert_eq!(
            serde_json::to_value(Persisted(&banking)).unwrap(),
            serde_json::to_value(Persisted(&twin)).unwrap()
        );
    }

    /// Given a player developing so fast that his kept chance is still certain, on Tactical
    /// (every attribute at a whole chance),
    /// when he has a session in a season with match growth,
    /// then nothing is banked: a certain roll leaves nothing to bank (T-3).
    #[test]
    fn a_certain_roll_banks_nothing() {
        let mut star = player("star", "2007-03-01", Position::Midfielder, 99, 80);
        star.training_focus = Some(TrainingFocus::Tactical);
        let fast = TrainingDay {
            development_multiplier: 100.0,
            ..growth_day(None, None)
        };
        online_session(
            &mut star,
            &plan(),
            &fast,
            SessionKind::Manual,
            &mut session_rng(3, "star", "d"),
        );
        assert_eq!(star.match_xp_pending, 0);
    }

    /// Given a regular and his twin,
    /// when one has a session in a season with match growth and the other the same session
    /// without,
    /// then the one banks, and both streams stand at the same die afterwards: banking changes
    /// the chances, never the number of dice (§3.4).
    #[test]
    fn banking_casts_the_same_dice() {
        let mut banking = player("mid", "2002-03-01", Position::Midfielder, 90, 80);
        banking.training_focus = Some(TrainingFocus::Defending);
        let mut twin = banking.clone();
        let mut banking_dice = session_rng(5, "mid", "d");
        let mut twin_dice = session_rng(5, "mid", "d");
        online_session(
            &mut banking,
            &plan(),
            &growth_day(None, Some(KeeperDrill::PROPOSED)),
            SessionKind::Manual,
            &mut banking_dice,
        );
        online_session(
            &mut twin,
            &plan(),
            &day(None, Some(KeeperDrill::PROPOSED)),
            SessionKind::Manual,
            &mut twin_dice,
        );
        assert!(banking.match_xp_pending > 0);
        assert_eq!(banking.match_xp_focus, Some(TrainingFocus::Defending));
        assert_eq!(banking_dice.random::<u64>(), twin_dice.random::<u64>());
    }

    /// Given a regular at Medium, once in the day's session and once in an extra session,
    /// when both are held in a season with match growth,
    /// then the extra session banks what the day's banks (T-7, Qe512-1).
    #[test]
    fn an_extra_session_banks_as_the_days_does() {
        let mut scheduled = player("mid", "2002-03-01", Position::Midfielder, 90, 80);
        scheduled.training_focus = Some(TrainingFocus::Technical);
        let mut extra = scheduled.clone();
        let plan = plan_at(TrainingIntensity::Medium);
        let day = growth_day(None, None);
        online_session(
            &mut scheduled,
            &plan,
            &day,
            SessionKind::Manual,
            &mut session_rng(1, "mid", "d"),
        );
        let outcome = extra_session(
            &mut extra,
            &plan,
            &day,
            TrainingIntensity::Medium,
            &ExtraParams::PROPOSED,
            &mut extra_session_rng(1, "mid", "d", 1),
        );
        assert_eq!(outcome.sat_out, None);
        assert!(scheduled.match_xp_pending > 0);
        assert_eq!(extra.match_xp_pending, scheduled.match_xp_pending);
        assert_eq!(extra.match_xp_focus, Some(TrainingFocus::Technical));
    }

    /// A 24-year-old midfielder with room to grow, `pending` banked on Tactical and his bar at
    /// `bar`.
    fn banked(pending: u8, bar: u8) -> Player {
        let mut player = player("mid", "2002-03-01", Position::Midfielder, 90, 80);
        player.match_xp_pending = pending;
        player.match_xp = bar;
        player.match_xp_focus = Some(TrainingFocus::Tactical);
        player
    }

    fn attribute_total(player: &Player) -> u32 {
        crate::player_rating::ATTRIBUTE_KEYS
            .iter()
            .map(|key| u32::from(attribute_value(&player.attributes, key)))
            .sum()
    }

    /// Given 60 banked and the bar at 70,
    /// when he plays 90 minutes, then 30, then none,
    /// then the full match moves all 60 (the bar passes 100: one point, 30 left), the half
    /// hour a third of what is left, and no minutes nothing (T-4).
    #[test]
    fn a_match_pays_the_pool_by_minutes() {
        let day = growth_day(None, None);
        let mut player = banked(60, 70);
        let before = attribute_total(&player);
        let paid = pay(&mut player, 90, &day).unwrap();
        assert_eq!((paid.before, paid.gained, paid.after), (70, 60, 30));
        assert!(paid.attribute_up.is_some());
        assert!(!paid.ready);
        assert_eq!(attribute_total(&player), before + 1);
        assert_eq!((player.match_xp_pending, player.match_xp_picks), (0, 1));

        let mut player = banked(60, 0);
        let paid = pay(&mut player, 30, &day).unwrap();
        assert_eq!(
            (paid.gained, player.match_xp, player.match_xp_pending),
            (20, 20, 40)
        );

        let mut player = banked(60, 10);
        let paid = pay(&mut player, 0, &day).unwrap();
        assert_eq!(
            (paid.gained, player.match_xp, player.match_xp_pending),
            (0, 10, 60)
        );
    }

    /// Given a full pool and the bar at 95,
    /// when he plays a full match,
    /// then the bar takes 104, to 199, gives one point and keeps 99; the pool keeps 46: never
    /// two points in a match (T-4).
    #[test]
    fn a_match_never_gives_two_points() {
        let mut player = banked(150, 95);
        let before = attribute_total(&player);
        let paid = pay(&mut player, 90, &growth_day(None, None)).unwrap();
        assert_eq!((paid.gained, paid.after), (104, 99));
        assert_eq!(player.match_xp_pending, 46);
        assert_eq!(attribute_total(&player), before + 1);
    }

    /// Given a season without match growth and a player with a pool,
    /// when he plays,
    /// then nothing is paid and he is left as he was.
    #[test]
    fn without_match_growth_a_match_pays_nothing() {
        let mut player = banked(60, 70);
        let before = serde_json::to_value(Persisted(&player)).unwrap();
        assert_eq!(pay(&mut player, 90, &day(None, None)), None);
        assert_eq!(serde_json::to_value(Persisted(&player)).unwrap(), before);
    }

    /// Given an 18-year-old on his ceiling under the growth cap, 60 banked and the bar at 90,
    /// when he plays a full match, and later one more with the gate open again,
    /// then the first fills the bar to 100, "ready", with no point and 50 left in the pool; the
    /// second gives the point (T-5).
    #[test]
    fn a_ceiling_holds_a_full_bar_ready() {
        let mut player = player("kid", "2008-03-01", Position::Midfielder, 93, 80);
        player.attributes = uniform_attributes(81);
        refresh_player_derived(&mut player, 2026);
        player.potential = 93;
        player.match_xp_pending = 60;
        player.match_xp = 90;
        player.match_xp_focus = Some(TrainingFocus::Tactical);
        let before = attribute_total(&player);

        let paid = pay(
            &mut player,
            90,
            &growth_day(Some(GrowthCap::PROPOSED), None),
        )
        .unwrap();
        assert_eq!((paid.gained, paid.after, paid.ready), (10, 100, true));
        assert_eq!(paid.attribute_up, None);
        assert_eq!(player.match_xp_pending, 50);
        assert_eq!(attribute_total(&player), before);

        let paid = pay(&mut player, 90, &growth_day(None, None)).unwrap();
        assert!(paid.attribute_up.is_some());
        assert!(!paid.ready);
        assert_eq!(attribute_total(&player), before + 1);
    }

    /// Given a player whose every attribute is at 99,
    /// when a full match pays him with his gate open,
    /// then the bar stops at full, "ready": there is nothing to raise (T-6).
    #[test]
    fn nothing_left_to_raise_holds_the_bar_ready() {
        let mut player = banked(60, 90);
        player.attributes = uniform_attributes(99);
        player.potential = 99;
        player.ovr = 90;
        let paid = pay(&mut player, 90, &growth_day(None, None)).unwrap();
        assert_eq!(
            (paid.after, paid.ready, paid.attribute_up),
            (100, true, None)
        );
    }

    /// Given a centre-back's Defending candidates and a keeper's Tactical ones with his drill,
    /// when three hundred points are picked one after another,
    /// then only candidates are picked, each about in proportion to its weight, the keeper's
    /// drill attributes among them, and the same player always picks the same way (T-6, P1).
    #[test]
    fn picks_follow_the_session_weights_without_dice() {
        let player = player("cb", "2002-03-01", Position::CenterBack, 90, 80);
        let defending = candidates(&player, Some(&TrainingFocus::Defending), None);
        let keeper = player_at("gk", Position::Goalkeeper);
        let tactical = candidates(
            &keeper,
            Some(&TrainingFocus::Tactical),
            Some(KeeperDrill::PROPOSED),
        );
        assert!(
            ["handling", "aerial"]
                .iter()
                .all(|key| tactical.iter().any(|c| c.key == *key && c.drill)),
            "the drill's attributes are candidates"
        );
        for (player, list) in [(player, defending), (keeper, tactical)] {
            let shares = pick_shares(&player, &list, 300);
            let total: f64 = list.iter().map(|c| c.weight).sum();
            for candidate in &list {
                let share = shares[candidate.key];
                assert!(
                    (share - candidate.weight / total).abs() < 0.02,
                    "{} picked {share}",
                    candidate.key
                );
            }
            assert_eq!(pick(&player, &list), pick(&player, &list));
        }
    }

    /// Given a player with no focus banked yet,
    /// when his bar's point is placed,
    /// then it goes to the focus that lifts his OVR most.
    #[test]
    fn with_no_banked_focus_the_point_goes_to_the_best_one() {
        let mut player = banked(60, 70);
        player.match_xp_focus = None;
        assert_eq!(payout_focus(&player), best_focus(&player, None));
        player.match_xp_focus = Some(TrainingFocus::Recovery);
        assert_eq!(payout_focus(&player), best_focus(&player, None));
    }

    /// A 22-year-old at `position` with every attribute at 60 and room to grow.
    fn player_at(id: &str, position: Position) -> Player {
        let mut player = player(id, "2004-03-01", position, 95, 80);
        player.attributes = uniform_attributes(60);
        refresh_player_derived(&mut player, 2026);
        player.potential = 95;
        player
    }

    /// The share of `count` picks one after another that lands on each candidate.
    fn pick_shares(
        player: &Player,
        candidates: &[Candidate],
        count: u32,
    ) -> std::collections::HashMap<&'static str, f64> {
        let mut player = player.clone();
        let mut shares = std::collections::HashMap::new();
        for step in 0..count {
            player.match_xp_picks = step;
            *shares.entry(pick(&player, candidates)).or_insert(0.0) += 1.0 / f64::from(count);
        }
        for candidate in candidates {
            shares.entry(candidate.key).or_insert(0.0);
        }
        shares
    }

    /// Given twelve players, position by focus, keepers with their drill,
    /// when a regular's session is weighed in OVR, before match growth and after it (the session
    /// at the kept chance plus what it banks, placed as two thousand picks place it),
    /// then the two expectations are within 1 % of each other (T-8, PO review P1).
    #[test]
    fn a_session_and_its_pool_build_the_ovr_a_session_did() {
        let pairs = [
            (Position::Goalkeeper, TrainingFocus::Tactical),
            (Position::Goalkeeper, TrainingFocus::Physical),
            (Position::CenterBack, TrainingFocus::Defending),
            (Position::CenterBack, TrainingFocus::Physical),
            (Position::RightBack, TrainingFocus::Defending),
            (Position::LeftWingBack, TrainingFocus::Attacking),
            (Position::DefensiveMidfielder, TrainingFocus::Tactical),
            (Position::CentralMidfielder, TrainingFocus::Technical),
            (Position::AttackingMidfielder, TrainingFocus::Technical),
            (Position::RightWinger, TrainingFocus::Attacking),
            (Position::Striker, TrainingFocus::Attacking),
            (Position::Striker, TrainingFocus::Technical),
        ];
        let full = 0.4;
        let kept = full * development_factor_kept(80, 0.25) / development_factor(80);
        for (position, focus) in pairs {
            let player = player_at(&format!("{position:?}"), position.clone());
            let list = candidates(&player, Some(&focus), Some(KeeperDrill::PROPOSED));
            let rise = |key: &str| {
                let mut lifted = player.attributes.clone();
                if let Some(value) = attribute_mut(&mut lifted, key) {
                    *value += 1;
                }
                ovr_from_attributes(&lifted, &position)
                    - ovr_from_attributes(&player.attributes, &position)
            };
            let session = |gain: f64| -> f64 {
                list.iter()
                    .map(|candidate| candidate.chance(gain) * rise(candidate.key))
                    .sum()
            };
            let shares = pick_shares(&player, &list, 2000);
            let per_point: f64 = list
                .iter()
                .map(|candidate| shares[candidate.key] * rise(candidate.key))
                .sum();
            let before = session(full);
            let after = session(kept) + banked_points(&list, full, kept) * per_point;
            assert!(before > 0.0, "{position:?} on {focus:?} builds nothing");
            assert!(
                ((after - before) / before).abs() <= 0.01,
                "{position:?} on {focus:?}: {before} before, {after} after"
            );
        }
    }

    /// Given a fresh regular on Tactical, two thousand times over,
    /// when each has one session with match growth and one without, on the same dice,
    /// then the banking sessions raise about three quarters of what the others do: a session
    /// that banks rolls at the kept chance (§3.4).
    #[test]
    fn a_banking_session_rolls_at_the_kept_chance() {
        let plan = plan_at(TrainingIntensity::Medium);
        let rises = |day: &TrainingDay| {
            let mut rose = 0u32;
            for n in 0..2000u64 {
                let mut player = player_at("mid", Position::CentralMidfielder);
                player.training_focus = Some(TrainingFocus::Tactical);
                let before = attribute_total(&player);
                online_session(
                    &mut player,
                    &plan,
                    day,
                    SessionKind::Manual,
                    &mut session_rng(n, "mid", "d"),
                );
                rose += attribute_total(&player) - before;
            }
            f64::from(rose)
        };
        let ratio = rises(&growth_day(None, None)) / rises(&day(None, None));
        assert!((ratio - 0.75).abs() < 0.04, "ratio {ratio}");
    }
}
