//! Play in the attacking third (phase 2, GĐ3, P3.4;
//! GĐ3-tech-spec §9, decisions X54–X56).
//!
//! ```text
//! ball in the attacking third, lane L
//!   (P2.5) a shot from distance — less often from a flank (λ_flank)
//!   Early, L a flank: an early cross p_early of the time, no one-on-one
//!   one-on-one: carrier and defender by presence (P3.2), κ
//!   won:  centre → into the box
//!         flank  → cut inside (P_cut, by role and foot): a curler or into the box
//!                  else cross (p_cross_flank) or to the byline and into the box
//!   lost: as ever, but a foul's free kick goes by lane: a shot from the
//!         centre, a cross from out wide
//! ```
//!
//! A cross must first reach the contest: `P_reach` from its delivery, as a
//! corner's. In the air it is the two-stage header of P2.2; along the ground
//! it is met first time by whoever is best placed. `Mixed` (the default) puts
//! a third of crosses on the ground.

use rand::{Rng, RngExt};

use crate::duel;
use crate::event::{EventType, Lane, MatchEvent, TacticalContext};
use crate::shared::PlayerSnap;
use crate::types::{CrossStyle, DefensiveLine, Foot, PlayerRole, Position, Side, Zone};

use super::LiveMatchState;
use super::presence::Column;
use super::set_pieces::{contest_help, delivery_skill};
use super::zone_resolution::scale_odds;

/// How often a one-on-one won on a flank, and not cut inside, ends in a
/// cross; the rest go to the byline and into the box. Calibrated at P3.4 for
/// the crosses a real match sees (22 a match, StatsBomb 2015/16).
pub(crate) const P_CROSS_FLANK: f64 = 0.93;
/// How often an average open-play cross reaches the contest (X54).
pub(crate) const P0_CROSS: f64 = 0.60;
const REACH_SPREAD: f64 = 200.0;
const REACH_MIN: f64 = 0.35;
const REACH_MAX: f64 = 0.85;
const DELIVERY_REFERENCE: f64 = 65.0;
/// The `Crosser` trait lifts a delivery.
const CROSSER_DELIVERY: f64 = 1.05;
/// Of a `Mixed` side's crosses, the share in the air.
const HIGH_SHARE: f64 = 0.65;
/// The ground contest's anchor: between equals the man meeting a low cross
/// wins about 40%, as a forward does in the air (P2.2). Calibrated at P3.4.
const K_LOW: f64 = 0.667;
/// A first-time shot from a low cross, with no touch to set it.
const LOW_CROSS_FINISH: f64 = 0.95;
/// How often an `Early` side crosses straight away from a flank.
const P_EARLY: f64 = 0.40;
/// An early cross comes from further out.
const EARLY_DELIVERY: f64 = 0.85;
/// A free kick in the attacking third's centre lane: a shot at goal this
/// often (X56). Calibrated for 0.8–1.0 a match.
pub(crate) const P_DFK_CENTRE: f64 = 0.60;
/// A free kick out wide: crossed in this often, as a corner (X56).
const P_IFK: f64 = 0.20;

/// The chance an open-play cross of quality `q` reaches the contest.
fn cross_reach(q: f64, base: f64) -> f64 {
    (base + (q - DELIVERY_REFERENCE) / REACH_SPREAD).clamp(REACH_MIN, REACH_MAX)
}

/// The share of the defence's positioning an early cross takes away: the
/// gap between a back line and its keeper. 0.20 on the break; otherwise by
/// how high the line stands (X55).
fn early_gap(on_the_break: bool, line: DefensiveLine) -> f64 {
    if on_the_break {
        return 0.20;
    }
    match line {
        DefensiveLine::High => 0.15,
        DefensiveLine::Medium => 0.08,
        DefensiveLine::Low | DefensiveLine::VeryLow => 0.0,
    }
}

/// The chance a wide player who has beaten his man on `lane` cuts inside
/// rather than going outside (S2 §3.3). On his weaker side — a right-footer
/// on the left — his stronger foot is inside; a two-footed player is on it
/// half the time. Inside forwards and inverted wingers do it most.
pub(super) fn cut_inside_chance(
    footedness: Foot,
    lane: Lane,
    role: PlayerRole,
    curve: u8,
    dribbling: u8,
) -> f64 {
    let inside_foot = match (footedness, lane) {
        (_, Lane::Centre) => return 0.0,
        (Foot::Both, _) => 0.5,
        (Foot::Right, Lane::Left) | (Foot::Left, Lane::Right) => 1.0,
        _ => 0.0,
    };
    let skill = ((f64::from(curve) + f64::from(dribbling) - 140.0) / 40.0).clamp(0.0, 1.0);
    let cuts_in = matches!(role, PlayerRole::InsideForward | PlayerRole::InvertedWinger);
    let on_inside_foot = if cuts_in {
        0.50 + 0.35 * skill
    } else {
        0.25 + 0.20 * skill
    };
    let on_outside_foot = if cuts_in { 0.30 + 0.20 * skill } else { 0.08 };
    inside_foot * on_inside_foot + (1.0 - inside_foot) * on_outside_foot
}

/// The ground contest after a low cross: the man meeting it (positioning
/// and first touch) against a centre back (positioning and tackling).
fn low_cross_win(att: &PlayerSnap, def: &PlayerSnap) -> f64 {
    let attack = 0.60 * f64::from(att.positioning) + 0.40 * f64::from(att.first_touch);
    let defence = 0.50 * f64::from(def.positioning) + 0.50 * f64::from(def.tackling);
    let logit = 2.0 * (attack.max(1.0) / defence.max(1.0)).ln() + K_LOW.ln();
    1.0 / (1.0 + (-logit).exp())
}

impl LiveMatchState {
    /// The attacking third; see the module docs.
    pub(super) fn resolve_attacking_third<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        if let Some(exploit) = self.take_exploit(att_side) {
            return self.exploit_open_flank(minute, att_side, def_side, &exploit, rng);
        }
        let lane = self.lane_for(att_side);
        let on_flank = lane != Lane::Centre;
        if on_flank
            && self.team_ref(att_side).tactics.cross_style == CrossStyle::Early
            && rng.random_range(0.0..1.0f64) < P_EARLY
        {
            let crosser = self
                .pick_by_presence(att_side, Column::Attack, lane, rng)
                .map_or_else(
                    || self.snap_player(att_side, Position::Forward, rng),
                    |picked| picked.player,
                );
            self.note_full_back_push(att_side, lane, &crosser.id, rng);
            return self.resolve_open_cross(minute, att_side, crosser, true, rng);
        }

        let (attacker, defender, out_of_lane) =
            self.attacking_third_duelists(att_side, def_side, rng);
        if on_flank {
            self.note_full_back_push(att_side, lane, &attacker.id, rng);
        }
        if let Some(long_shot) = self.try_long_shot(minute, att_side, &attacker, rng) {
            return long_shot;
        }
        let success =
            self.one_v_one_success(att_side, def_side, &attacker, &defender, out_of_lane, 1.0);
        if rng.random_range(0.0..1.0f64) >= success {
            return self
                .one_v_one_lost(minute, att_side, def_side, &attacker, &defender, None, rng);
        }

        let cuts_inside = on_flank
            && rng.random_range(0.0..1.0f64)
                < cut_inside_chance(
                    attacker.footedness,
                    lane,
                    attacker.role,
                    attacker.curve,
                    attacker.legacy_dribbling(),
                );
        let mut events = Vec::new();
        let mut dribble = MatchEvent::new(
            minute,
            EventType::Dribble,
            att_side,
            Zone::attacking_third(att_side),
        )
        .with_player(&attacker.id);
        if cuts_inside {
            dribble = dribble.with_tactical_context(TacticalContext::CutInside);
        }
        self.emit(&mut events, dribble);
        // Through on the break: a sweeper keeper comes for it first.
        if self.active_break
            && let Some(sweeper_events) = self.try_sweeper_keeper(minute, att_side, &attacker, rng)
        {
            events.extend(sweeper_events);
            return events;
        }
        if cuts_inside {
            self.set_lane_for(att_side, Lane::Centre);
            let outer = self.active_context.replace(TacticalContext::CutInside);
            let shot = self.try_cut_inside_shot(minute, att_side, &attacker, rng);
            self.active_context = outer;
            if let Some(shot) = shot {
                events.extend(shot);
                return events;
            }
        } else if on_flank && rng.random_range(0.0..1.0f64) < self.config.knobs.p_cross_flank {
            events.extend(self.resolve_open_cross(minute, att_side, attacker, false, rng));
            return events;
        }
        self.carry_into_box(att_side);
        events
    }

    /// A break into the flank `exploit.flank` the other side left open
    /// (P3.6): the one-on-one is down it, the full back who went up is not
    /// there, whoever comes across plays out of lane (κ), and the attacker has
    /// the space behind (`S_SPACE`). Won, he is straight into the box. Only
    /// the duel's events carry `FlankExposed`.
    fn exploit_open_flank<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        exploit: &super::flanks::PendingExploit,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let lane = self.lane_for(att_side);
        let attacker = self
            .pick_by_presence(att_side, Column::Attack, lane, rng)
            .map_or_else(
                || self.snap_player(att_side, Position::Forward, rng),
                |picked| picked.player,
            );
        let def_lane = self.lane_for(def_side);
        let (defender, out_of_lane) = match self.pick_by_presence_without(
            def_side,
            Column::Defence,
            def_lane,
            Some(&exploit.absent),
            rng,
        ) {
            Some(picked) => (
                picked.player,
                super::presence::out_of_lane_factor(picked.slot, def_lane),
            ),
            None => (self.snap_player(def_side, Position::Defender, rng), 1.0),
        };
        let success = self.one_v_one_success(
            att_side,
            def_side,
            &attacker,
            &defender,
            out_of_lane,
            super::flanks::S_SPACE,
        );
        if rng.random_range(0.0..1.0f64) >= success {
            return self.one_v_one_lost(
                minute,
                att_side,
                def_side,
                &attacker,
                &defender,
                Some(TacticalContext::FlankExposed),
                rng,
            );
        }
        let mut events = Vec::new();
        let dribble = MatchEvent::new(
            minute,
            EventType::Dribble,
            att_side,
            Zone::attacking_third(att_side),
        )
        .with_player(&attacker.id)
        .with_tactical_context(TacticalContext::FlankExposed);
        self.emit(&mut events, dribble);
        if self.active_break
            && let Some(sweeper_events) = self.try_sweeper_keeper(minute, att_side, &attacker, rng)
        {
            events.extend(sweeper_events);
            return events;
        }
        self.carry_into_box(att_side);
        events
    }

    /// The ball is carried into the box; on the break, the shot that follows
    /// is still part of the break.
    fn carry_into_box(&mut self, side: Side) {
        self.ball_zone = Zone::attacking_box(side);
        if self.active_break {
            self.on_the_break = Some(side);
        }
    }

    /// An open-play cross from `crosser`, early or after beating his man.
    fn resolve_open_cross<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        crosser: PlayerSnap,
        early: bool,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let def_side = att_side.opposite();
        let zone = Zone::attacking_third(att_side);
        let in_the_air = match self.team_ref(att_side).tactics.cross_style {
            CrossStyle::High => true,
            CrossStyle::Low => false,
            CrossStyle::Mixed | CrossStyle::Early => rng.random_range(0.0..1.0f64) < HIGH_SHARE,
        };
        let crosser_trait = if crosser.has_trait("Crosser") {
            CROSSER_DELIVERY
        } else {
            1.0
        };
        let delivery = self
            .condition_adjusted_skill(&crosser.id, delivery_skill(crosser.crossing, crosser.curve))
            * crosser_trait
            * if early { EARLY_DELIVERY } else { 1.0 };
        let target = if in_the_air {
            self.cross_target(att_side, &crosser.id, rng)
        } else {
            self.low_cross_target(att_side, &crosser.id, rng)
        };
        let defender = self.cross_defender(def_side, rng);
        let context = if early {
            Some(TacticalContext::EarlyCross)
        } else if in_the_air {
            None
        } else {
            Some(TacticalContext::LowCross)
        };
        // A cross that never reaches the contest names nobody it was for, so
        // a reader can tell it from a duel lost (`EventTally`).
        let reached = rng.random_range(0.0..1.0f64)
            < cross_reach(delivery, self.config.knobs.open_play_cross_reach);
        let mut cross =
            MatchEvent::new(minute, EventType::Cross, att_side, zone).with_player(&crosser.id);
        if reached {
            cross = cross.with_secondary(&target.id);
        }
        if let Some(c) = context {
            cross = cross.with_tactical_context(c);
        }
        self.emit(&mut events, cross);

        let won = reached && {
            let gap = if early {
                early_gap(
                    self.active_break,
                    self.team_ref(def_side).tactics.defensive_line,
                )
            } else {
                0.0
            };
            let mut marker = defender.clone();
            marker.positioning = (f64::from(marker.positioning) * (1.0 - gap)).round() as u8;
            let around = (self.line_strength(att_side, Position::Forward)
                * self.slot_effectiveness(&target.id))
                / (self.line_strength(def_side, Position::Defender)
                    * self.slot_effectiveness(&marker.id));
            let chance = if in_the_air {
                scale_odds(
                    duel::aerial_win_probability_anchored(
                        &target,
                        &marker,
                        self.config.knobs.anchor_aerial_open_play_cross,
                    ),
                    contest_help(delivery) * around,
                )
            } else {
                scale_odds(low_cross_win(&target, &marker), around)
            };
            rng.random_range(0.0..1.0f64) < chance
        };
        if !won {
            let mut clearance = MatchEvent::new(minute, EventType::Clearance, def_side, zone)
                .with_player(&defender.id);
            // Every event of a ground contest carries `LowCross`, so the
            // clearance is not read as an aerial duel lost.
            if reached && !in_the_air {
                clearance = clearance.with_tactical_context(TacticalContext::LowCross);
            }
            self.emit(&mut events, clearance);
            self.after_defensive_win(def_side, Some(&defender), rng);
            return events;
        }
        self.ball_zone = Zone::attacking_box(att_side);
        if in_the_air {
            // He won it in the air, so the header is his; the cross is the assist.
            let outer = if early {
                self.active_context.replace(TacticalContext::EarlyCross)
            } else {
                self.active_context
            };
            events.extend(self.resolve_header(minute, att_side, target, crosser.id, rng));
            self.active_context = outer;
        } else {
            events.extend(self.strike_in_box(
                minute,
                att_side,
                &target,
                &crosser.id,
                LOW_CROSS_FINISH,
                Some(TacticalContext::LowCross),
                rng,
            ));
        }
        events
    }

    /// A free kick to `att_side` in its attacking third (X56): from the
    /// centre lane a shot at goal `P_DFK_CENTRE` of the time, from out wide a
    /// cross `P_IFK` of the time; otherwise the side plays on with the ball.
    pub(super) fn lane_free_kick<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        if self.lane_for(att_side) == Lane::Centre {
            if rng.random_range(0.0..1.0f64) < self.config.knobs.p_dfk_centre {
                return self.resolve_direct_free_kick(minute, att_side, rng);
            }
        } else if rng.random_range(0.0..1.0f64) < P_IFK {
            return self.resolve_crossed_free_kick(minute, att_side, rng);
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::types::MatchConfig;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    /// Every event of `matches` matches, the home side crossing `style`.
    fn grid_events(style: CrossStyle, matches: u64) -> Vec<MatchEvent> {
        (0..matches)
            .flat_map(|seed| {
                let mut home = make_team("home");
                home.tactics.cross_style = style;
                let mut state = LiveMatchState::new(
                    home,
                    make_team("away"),
                    MatchConfig::default(),
                    Vec::new(),
                    Vec::new(),
                    false,
                );
                let mut rng = StdRng::seed_from_u64(seed);
                for _ in 0..200 {
                    if state.is_finished() {
                        break;
                    }
                    state.step_minute(&mut rng);
                }
                state.into_report().events
            })
            .collect()
    }

    /// Given forty matches,
    /// when their open-play crosses are read,
    /// then every one comes from a flank, and there are crosses at all.
    #[test]
    fn open_play_crosses_come_only_from_the_flanks() {
        let events = grid_events(CrossStyle::Mixed, 40);
        let crosses: Vec<&MatchEvent> = events
            .iter()
            .filter(|e| e.event_type == EventType::Cross && e.set_piece.is_none())
            .collect();
        assert!(crosses.len() > 100, "only {} crosses", crosses.len());
        assert!(crosses.iter().all(|e| e.lane != Some(Lane::Centre)));
    }

    /// Given eighty matches between sides whose full backs bomb on,
    /// when their breaks into an open flank are read,
    /// then there are some; `FlankExposed` sits only on the duel's events
    /// (the carrier's one-on-one and the clearance that may end it), and a
    /// duel won goes straight on to a shot, never a cross (P3.6).
    #[test]
    fn a_break_into_an_open_flank_goes_straight_for_goal() {
        let events: Vec<MatchEvent> = (0..80)
            .flat_map(|seed| {
                let attacking_full_backs = |id: &str| {
                    let mut team = make_team(id);
                    for player in &mut team.players {
                        if player.position == crate::types::Position::Defender {
                            player.role = PlayerRole::AttackingFB;
                        }
                    }
                    team
                };
                let mut state = LiveMatchState::new(
                    attacking_full_backs("home"),
                    attacking_full_backs("away"),
                    MatchConfig::default(),
                    Vec::new(),
                    Vec::new(),
                    false,
                );
                let mut rng = StdRng::seed_from_u64(seed);
                for _ in 0..200 {
                    if state.is_finished() {
                        break;
                    }
                    state.step_minute(&mut rng);
                }
                state.into_report().events
            })
            .collect();
        let mut won = 0;
        for (i, e) in events.iter().enumerate() {
            if e.tactical_context != Some(TacticalContext::FlankExposed) {
                continue;
            }
            assert!(
                matches!(
                    e.event_type,
                    EventType::Dribble | EventType::DribbleTackled | EventType::Clearance
                ),
                "FlankExposed on a {:?}",
                e.event_type
            );
            if e.event_type == EventType::Dribble {
                won += 1;
                let next = events[i + 1..].iter().find(|n| n.side == e.side);
                assert!(
                    next.is_none_or(|n| n.event_type != EventType::Cross),
                    "a break into an open flank was crossed"
                );
            }
        }
        assert!(won > 10, "only {won} breaks won");
    }

    /// Given a side crossing early over forty matches,
    /// when its early crosses are read,
    /// then there are some, and none follows a one-on-one it won: an early
    /// cross skips the duel.
    #[test]
    fn an_early_cross_never_takes_the_full_back_on() {
        let events = grid_events(CrossStyle::Early, 40);
        let mut early = 0;
        for (i, e) in events.iter().enumerate() {
            if e.event_type == EventType::Cross
                && e.tactical_context == Some(TacticalContext::EarlyCross)
            {
                early += 1;
                let before = i.checked_sub(1).map(|j| &events[j]);
                assert!(
                    !before.is_some_and(|b| b.event_type == EventType::Dribble
                        && b.minute == e.minute
                        && b.side == e.side),
                    "an early cross at minute {} came after a one-on-one",
                    e.minute
                );
            }
        }
        assert!(early > 20, "only {early} early crosses");
    }

    /// Given a right-footer on the left and on the right, and a left-footer
    /// on the left, each an inside forward and each a plain winger,
    /// when their chance to cut inside is read,
    /// then the one on his weaker side cuts in more, an inside forward most.
    #[test]
    fn a_player_on_his_weaker_side_cuts_inside_more() {
        let chance = |foot, lane, role| cut_inside_chance(foot, lane, role, 75, 75);
        let inside_forward = PlayerRole::InsideForward;
        let plain = PlayerRole::Standard;
        assert!(
            chance(Foot::Right, Lane::Left, inside_forward)
                > chance(Foot::Left, Lane::Left, inside_forward)
        );
        assert!(chance(Foot::Right, Lane::Left, plain) > chance(Foot::Right, Lane::Right, plain));
        assert!(
            chance(Foot::Right, Lane::Left, inside_forward)
                > chance(Foot::Right, Lane::Left, plain)
        );
        assert_eq!(chance(Foot::Right, Lane::Centre, inside_forward), 0.0);
        assert!((chance(Foot::Left, Lane::Left, plain) - 0.08).abs() < 1e-9);
    }

    /// Given a back line standing at each height, and one on the break,
    /// when an early cross's gap is read,
    /// then a deep line leaves none, a high one the most, a break 20%.
    #[test]
    fn an_early_cross_finds_a_gap_only_behind_a_line_that_stands_up() {
        assert_eq!(early_gap(false, DefensiveLine::VeryLow), 0.0);
        assert_eq!(early_gap(false, DefensiveLine::Low), 0.0);
        assert_eq!(early_gap(false, DefensiveLine::Medium), 0.08);
        assert_eq!(early_gap(false, DefensiveLine::High), 0.15);
        assert_eq!(early_gap(true, DefensiveLine::Low), 0.20);
    }

    /// Given a man meeting a low cross and a centre back alike in every way
    /// but height,
    /// when the ground contest is read,
    /// then height plays no part, and the attacker wins about 40%.
    #[test]
    fn a_low_cross_ignores_height() {
        let mut att = PlayerSnap::nobody();
        att.positioning = 70;
        att.first_touch = 70;
        att.tackling = 70;
        let mut def = att.clone();
        def.height_cm = 195;
        let mut short = att.clone();
        short.height_cm = 165;
        assert_eq!(low_cross_win(&att, &def), low_cross_win(&short, &def));
        assert!((low_cross_win(&att, &def) - 0.40).abs() < 0.01);
    }

    /// Given deliveries from poor to great,
    /// when their chance to reach the contest is read,
    /// then it rises with the delivery, within 35–85%.
    #[test]
    fn a_better_cross_reaches_the_contest_more_often() {
        assert!(cross_reach(80.0, P0_CROSS) > cross_reach(60.0, P0_CROSS));
        assert_eq!(cross_reach(0.0, P0_CROSS), REACH_MIN);
        assert_eq!(cross_reach(200.0, P0_CROSS), REACH_MAX);
    }
}
