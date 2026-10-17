//! Set pieces: corners (phase 2, P2.3; `pass-cure-heading-freekick-enhancement.md`
//! §6.2, decision X37) and direct free kicks (P2.4; §6.1, X38).
//!
//! A corner used to be a 30% chance of the ball landing in the box for an
//! ordinary shot by any forward: nobody took it, nobody headed it. Now it has a
//! taker, the club's `corner_taker` or the best deliverer on the pitch, and the
//! delivery decides how often the ball reaches the aerial contest:
//!
//! ```text
//! Q        = (0.70·crossing + 0.30·curve) × condition × 1.04 for DeadBallSpecialist
//! reaches  = clamp(0.70 + (Q − 65)/200, 0.40, 0.85)
//!   not reached: 70% cleared by the defence, 30% kept by the attackers short
//! contest  = the aerial duel (`duel::aerial_win_probability`), odds × clamp(1 + (Q − 65)/250, 0.92, 1.08)
//!   won: the header (`resolve_header`), the taker credited with the assist
//!   lost: cleared
//! ```
//!
//! The two centre-backs (by formation slot) who head the ball best go up for
//! it: the man meeting it is drawn from the forwards (weight 1.0), those two
//! (0.9) and the midfielders (0.5), never the taker or a keeper. Full-backs and
//! wing-backs stay back, however well they head. `REACH_BASE` is set so a corner is worth
//! about 3% of a goal, as in real football (2.5–3%); it had been worth 5.7%.
//!
//! A foul in the attacking third's centre lane becomes a shot at goal
//! `P_DFK_CENTRE` of the time (`wing_play`, GĐ3), from the club's
//! `free_kick_taker` or the best striker of a dead ball on the pitch:
//!
//! ```text
//! FK        = (0.65·free_kick + 0.35·curve) × condition × 1.08 for DeadBallSpecialist
//! wall      = 25% blocked: half cleared, half behind for a corner
//! on target = clamp(0.35 + (FK − 50)/180, 0.15, 0.75)
//! goal      = clamp(0.18 + (FK − keeper)/200, 0.04, 0.40),  keeper = (reflexes + positioning)/2
//! ```
//!
//! An average taker scores about 6% of them, as in real football (5.6%); the
//! wall is what brings the design's formula down to that.

use rand::{Rng, RngExt};

use crate::duel;
use crate::event::{EventDetail, EventType, MatchEvent, SetPiece, ShotKind};
use crate::pitch_position::PitchPosition;
use crate::shared::{PlayerSnap, TraitContext, trait_bonus};
use crate::types::{PlayerData, Position, Side, Zone};

use super::LiveMatchState;
use super::helpers::{danger_band, save_quality};
use super::zone_resolution::scale_odds;

const DELIVERY_CROSSING: f64 = 0.70;
const DELIVERY_CURVE: f64 = 0.30;
/// `DeadBallSpecialist` lifts a corner's delivery.
const DEAD_BALL_SPECIALIST_DELIVERY: f64 = 1.04;
/// The delivery an average corner taker puts in.
const DELIVERY_REFERENCE: f64 = 65.0;
/// How often an average delivery reaches the aerial contest. Calibrated on the
/// lan-can sweep for about 3% of a goal per corner.
const REACH_BASE: f64 = 0.70;
const REACH_SPREAD: f64 = 200.0;
const REACH_MIN: f64 = 0.40;
const REACH_MAX: f64 = 0.85;
/// Of the deliveries that never reach the contest, the share the defence
/// clears; the rest the attackers keep, short.
const UNREACHED_CLEARED: f64 = 0.70;
const CONTEST_SPREAD: f64 = 250.0;
const CONTEST_MIN: f64 = 0.92;
const CONTEST_MAX: f64 = 1.08;
/// Who goes up for the corner, by weight.
const FORWARD_WEIGHT: f64 = 1.0;
const CENTRE_BACK_WEIGHT: f64 = 0.9;
const MIDFIELDER_WEIGHT: f64 = 0.5;
/// How many centre-backs join the attack for a corner.
const CENTRE_BACKS_UP: usize = 2;

const FREE_KICK_STRIKE: f64 = 0.65;
const FREE_KICK_CURVE: f64 = 0.35;
/// `DeadBallSpecialist` strikes a free kick better.
const DEAD_BALL_SPECIALIST_STRIKE: f64 = 1.08;
/// The share of direct free kicks the wall stops.
const WALL_BLOCK: f64 = 0.25;
/// Of the free kicks the wall stops, the share deflected behind for a corner.
const WALL_TO_CORNER: f64 = 0.50;
const FREE_KICK_ON_TARGET_BASE: f64 = 0.35;
const FREE_KICK_ON_TARGET_SPREAD: f64 = 180.0;
const FREE_KICK_ON_TARGET_MIN: f64 = 0.15;
const FREE_KICK_ON_TARGET_MAX: f64 = 0.75;
const FREE_KICK_GOAL_BASE: f64 = 0.18;
const FREE_KICK_GOAL_SPREAD: f64 = 200.0;
const FREE_KICK_GOAL_MIN: f64 = 0.04;
const FREE_KICK_GOAL_MAX: f64 = 0.40;

/// A player's delivery from a corner, before condition and traits.
pub(super) fn delivery_skill(crossing: u8, curve: u8) -> f64 {
    DELIVERY_CROSSING * f64::from(crossing) + DELIVERY_CURVE * f64::from(curve)
}

/// The chance a delivery of quality `q` reaches the aerial contest.
fn reach_chance(q: f64) -> f64 {
    (REACH_BASE + (q - DELIVERY_REFERENCE) / REACH_SPREAD).clamp(REACH_MIN, REACH_MAX)
}

/// A player's strike of a dead ball, before condition and traits.
fn free_kick_skill(free_kick: u8, curve: u8) -> f64 {
    FREE_KICK_STRIKE * f64::from(free_kick) + FREE_KICK_CURVE * f64::from(curve)
}

/// The chance a free kick of quality `fk` that clears the wall is on target.
fn free_kick_on_target(fk: f64) -> f64 {
    (FREE_KICK_ON_TARGET_BASE + (fk - 50.0) / FREE_KICK_ON_TARGET_SPREAD)
        .clamp(FREE_KICK_ON_TARGET_MIN, FREE_KICK_ON_TARGET_MAX)
}

/// The chance an on-target free kick of quality `fk` beats a keeper of `keeper`.
fn free_kick_goal(fk: f64, keeper: f64) -> f64 {
    (FREE_KICK_GOAL_BASE + (fk - keeper) / FREE_KICK_GOAL_SPREAD)
        .clamp(FREE_KICK_GOAL_MIN, FREE_KICK_GOAL_MAX)
}

/// How much a delivery of quality `q` helps the man meeting it, as an odds ratio.
pub(super) fn contest_help(q: f64) -> f64 {
    (1.0 + (q - DELIVERY_REFERENCE) / CONTEST_SPREAD).clamp(CONTEST_MIN, CONTEST_MAX)
}

impl LiveMatchState {
    /// A set piece's taker: `designated` if he is still playing, otherwise
    /// the outfielder who scores highest on `skill`.
    fn pick_set_piece_taker(
        &self,
        side: Side,
        designated: Option<&String>,
        skill: impl Fn(&PlayerData) -> f64,
    ) -> Option<PlayerSnap> {
        let team = self.team_ref(side);
        let available = |p: &&PlayerData| !self.out_of_play(&p.id);
        if let Some(id) = designated
            && let Some(taker) = team.players.iter().filter(available).find(|p| &p.id == id)
        {
            return Some(PlayerSnap::from(taker));
        }
        team.players
            .iter()
            .filter(available)
            .filter(|p| p.position != Position::Goalkeeper)
            .max_by(|a, b| skill(a).total_cmp(&skill(b)))
            .map(PlayerSnap::from)
    }

    /// The corner's taker: the club's designated one, or the best deliverer.
    fn pick_corner_taker(&self, side: Side) -> Option<PlayerSnap> {
        self.pick_set_piece_taker(side, self.set_pieces_ref(side).corner_taker.as_ref(), |p| {
            delivery_skill(p.crossing, p.curve)
        })
    }

    /// The free kick's taker: the club's designated one, or the best striker
    /// of a dead ball.
    fn pick_free_kick_taker(&self, side: Side) -> Option<PlayerSnap> {
        self.pick_set_piece_taker(
            side,
            self.set_pieces_ref(side).free_kick_taker.as_ref(),
            |p| free_kick_skill(p.free_kick, p.curve),
        )
    }

    /// Who meets a corner from `taker_id`: drawn by weight from the forwards,
    /// the two centre-backs who head best and the midfielders.
    fn snap_corner_target<R: Rng>(&self, side: Side, taker_id: &str, rng: &mut R) -> PlayerSnap {
        let team = self.team_ref(side);
        let eligible: Vec<&PlayerData> = team
            .players
            .iter()
            .filter(|p| {
                p.id != taker_id && p.position != Position::Goalkeeper && !self.out_of_play(&p.id)
            })
            .collect();
        // The centre-backs go up, whoever else heads the ball well: a full-back
        // or wing-back stays to guard the counter. A back line with no
        // centre-back slot (an XI that does not fill its formation) sends its
        // best-heading defenders instead.
        let at_centre_back =
            |p: &&PlayerData| self.slot_of(side, &p.id) == Some(PitchPosition::CenterBack);
        let centre_backs: Vec<&PlayerData> =
            eligible.iter().copied().filter(at_centre_back).collect();
        let mut defenders: Vec<&PlayerData> = if centre_backs.is_empty() {
            eligible
                .iter()
                .copied()
                .filter(|p| p.position == Position::Defender)
                .collect()
        } else {
            centre_backs
        };
        let heads_it = |p: &PlayerData| f64::from(p.heading) * duel::height_factor(p.height_cm);
        defenders.sort_by(|a, b| heads_it(b).total_cmp(&heads_it(a)));
        defenders.truncate(CENTRE_BACKS_UP);

        let weighted: Vec<(&PlayerData, f64)> = eligible
            .iter()
            .filter_map(|p| match p.position {
                Position::Forward => Some((*p, FORWARD_WEIGHT)),
                Position::Midfielder => Some((*p, MIDFIELDER_WEIGHT)),
                Position::Defender if defenders.iter().any(|d| d.id == p.id) => {
                    Some((*p, CENTRE_BACK_WEIGHT))
                }
                _ => None,
            })
            .collect();
        let total: f64 = weighted.iter().map(|(_, w)| w).sum();
        if total <= 0.0 {
            return self.snap_header_target(side, taker_id, rng);
        }
        let mut pick = rng.random_range(0.0..total);
        for (player, weight) in &weighted {
            if pick < *weight {
                return PlayerSnap::from(player);
            }
            pick -= weight;
        }
        PlayerSnap::from(weighted[weighted.len() - 1].0)
    }

    /// A corner to `att_side`, played out from the kick to the header or the
    /// clearance. Every event it produces is part of the corner.
    pub(super) fn resolve_corner<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        self.resolve_delivery(minute, att_side, SetPiece::Corner, rng)
    }

    /// A free kick to `att_side` out wide in its attacking third, crossed into
    /// the box (phase 2, P3.4, X56): the corner's delivery from the club's
    /// free-kick taker, or the best deliverer, with the centre backs up.
    pub(super) fn resolve_crossed_free_kick<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        self.resolve_delivery(minute, att_side, SetPiece::FreeKick, rng)
    }

    /// The taker of a crossed set piece: the corner taker for a corner, the
    /// free-kick taker for a free kick, else whoever delivers best.
    fn pick_delivery_taker(&self, side: Side, kind: SetPiece) -> Option<PlayerSnap> {
        match kind {
            SetPiece::Corner => self.pick_corner_taker(side),
            SetPiece::FreeKick => self.pick_set_piece_taker(
                side,
                self.set_pieces_ref(side).free_kick_taker.as_ref(),
                |p| delivery_skill(p.crossing, p.curve),
            ),
        }
    }

    /// A ball delivered into the box from a corner or a wide free kick, from
    /// the kick to the header or the clearance. Every event it produces is
    /// part of the set piece.
    fn resolve_delivery<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        kind: SetPiece,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let def_side = att_side.opposite();
        let zone = Zone::attacking_third(att_side);
        let outer_set_piece = self.active_set_piece.replace(kind);

        let Some(taker) = self.pick_delivery_taker(att_side, kind) else {
            // Nobody left to take it: the defence has the ball.
            self.possession = def_side;
            self.ball_zone = Zone::defensive_third(att_side);
            self.active_set_piece = outer_set_piece;
            return events;
        };
        let event_type = match kind {
            SetPiece::Corner => EventType::Corner,
            SetPiece::FreeKick => EventType::FreeKick,
        };
        let restart = MatchEvent::new(minute, event_type, att_side, zone)
            .with_player(&taker.id)
            .with_set_piece(kind);
        self.emit(&mut events, restart);

        let dead_ball = if taker.has_trait("DeadBallSpecialist") {
            DEAD_BALL_SPECIALIST_DELIVERY
        } else {
            1.0
        };
        let delivery = self
            .condition_adjusted_skill(&taker.id, delivery_skill(taker.crossing, taker.curve))
            * dead_ball;

        if rng.random_range(0.0..1.0f64) >= reach_chance(delivery) {
            if rng.random_range(0.0..1.0f64) < UNREACHED_CLEARED {
                let clearer = self.snap_player(def_side, Position::Defender, rng);
                let clearance = MatchEvent::new(minute, EventType::Clearance, def_side, zone)
                    .with_player(&clearer.id);
                self.emit(&mut events, clearance);
                self.possession = def_side;
                self.ball_zone = Zone::defensive_third(att_side);
            } else {
                // Played short or knocked back out: the attack goes on.
                self.possession = att_side;
                self.ball_zone = zone;
            }
            self.active_set_piece = outer_set_piece;
            return events;
        }

        let target = self.snap_corner_target(att_side, &taker.id, rng);
        let marker = self.snap_player(def_side, Position::Defender, rng);
        let cross = MatchEvent::new(minute, EventType::Cross, att_side, zone)
            .with_player(&taker.id)
            .with_secondary(&target.id);
        self.emit(&mut events, cross);
        // The same modifiers as the duel after an open-play cross, plus the
        // delivery's help.
        let won = scale_odds(
            duel::aerial_win_probability(&target, &marker),
            contest_help(delivery)
                * (self.line_strength(att_side, Position::Forward)
                    * self.slot_effectiveness(&target.id))
                / (self.line_strength(def_side, Position::Defender)
                    * self.slot_effectiveness(&marker.id)),
        );
        if rng.random_range(0.0..1.0f64) < won {
            self.ball_zone = Zone::attacking_box(att_side);
            let header_events = self.resolve_header(minute, att_side, target, taker.id, rng);
            events.extend(header_events);
        } else {
            let clearance = MatchEvent::new(minute, EventType::Clearance, def_side, zone)
                .with_player(&marker.id);
            self.emit(&mut events, clearance);
            self.possession = def_side;
            self.ball_zone = Zone::defensive_third(att_side);
        }
        self.active_set_piece = outer_set_piece;
        events
    }

    /// A shot at goal from a free kick to `att_side` in its attacking third,
    /// played out from the strike to the save, the goal or the wall. Every
    /// event it produces is part of the free kick.
    pub(super) fn resolve_direct_free_kick<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let def_side = att_side.opposite();
        let zone = Zone::attacking_third(att_side);
        let Some(taker) = self.pick_free_kick_taker(att_side) else {
            return events;
        };
        let outer_set_piece = self.active_set_piece.replace(SetPiece::FreeKick);
        let goalkeeper = self.snap_player(def_side, Position::Goalkeeper, rng);

        let dead_ball = if taker.has_trait("DeadBallSpecialist") {
            DEAD_BALL_SPECIALIST_STRIKE
        } else {
            1.0
        };
        let strike = self
            .condition_adjusted_skill(&taker.id, free_kick_skill(taker.free_kick, taker.curve))
            * dead_ball;
        let keeper = self.condition_adjusted_skill(
            &goalkeeper.id,
            (f64::from(goalkeeper.reflexes) + f64::from(goalkeeper.positioning)) / 2.0,
        ) * trait_bonus(&goalkeeper, TraitContext::Goalkeeping);
        let attempt = |event_type: EventType| {
            MatchEvent::new(minute, event_type, att_side, zone)
                .with_shot_kind(ShotKind::DirectFreeKick)
                .with_player(&taker.id)
        };

        if rng.random_range(0.0..1.0f64) < WALL_BLOCK {
            let blocked = attempt(EventType::ShotBlocked).with_detail(EventDetail::Shot {
                danger: danger_band(strike),
            });
            self.emit(&mut events, blocked);
            if rng.random_range(0.0..1.0f64) < WALL_TO_CORNER {
                let corner_events = self.resolve_corner(minute, att_side, rng);
                events.extend(corner_events);
            } else {
                self.possession = def_side;
                self.ball_zone = Zone::defensive_third(att_side);
            }
        } else if rng.random_range(0.0..1.0f64) >= free_kick_on_target(strike) {
            let miss = attempt(EventType::ShotOffTarget).with_detail(EventDetail::Shot {
                danger: danger_band(strike),
            });
            self.emit(&mut events, miss);
            let goal_kick = MatchEvent::new(
                minute,
                EventType::GoalKick,
                def_side,
                Zone::attacking_box(att_side),
            );
            self.emit(&mut events, goal_kick);
            self.possession = def_side;
            self.ball_zone = Zone::defensive_third(def_side);
        } else if rng.random_range(0.0..1.0f64) < free_kick_goal(strike, keeper) {
            let context = self.goal_context(att_side);
            let goal = attempt(EventType::Goal).with_detail(EventDetail::Goal { context });
            self.emit(&mut events, goal);
            self.add_goal(att_side);
            self.possession = def_side;
            self.ball_zone = Zone::Midfield;
        } else {
            let save = attempt(EventType::ShotSaved)
                .with_secondary(&goalkeeper.id)
                .with_detail(EventDetail::Save {
                    quality: save_quality(keeper),
                });
            self.emit(&mut events, save);
            self.after_save(minute, att_side, &mut events, rng);
        }
        self.active_set_piece = outer_set_piece;
        events
    }
}

#[cfg(test)]
mod tests {
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    use super::*;
    use crate::live_match::test_support::make_team;
    use crate::report::GoalSource;
    use crate::types::MatchConfig;

    fn corner_match(home: crate::types::TeamData) -> LiveMatchState {
        LiveMatchState::new(
            home,
            make_team("away"),
            MatchConfig::default(),
            vec![],
            vec![],
            false,
        )
    }

    /// Plays `count` home corners, the score reset after each (it is a u8).
    fn corners(state: &mut LiveMatchState, count: u32, seed: u64) -> Vec<Vec<MatchEvent>> {
        let mut rng = StdRng::seed_from_u64(seed);
        (0..count)
            .map(|_| {
                let events = state.resolve_corner(30, Side::Home, &mut rng);
                state.home_score = 0;
                events
            })
            .collect()
    }

    fn taker_of(events: &[MatchEvent]) -> Option<&str> {
        events
            .iter()
            .find(|e| e.event_type == EventType::Corner)
            .and_then(|e| e.player_id.as_deref())
    }

    /// Given a club whose designated corner taker is a defender with ordinary
    /// delivery, and then the same club with him sent off,
    /// when it takes corners,
    /// then he takes them while he plays, and the best deliverer on the pitch
    /// takes them after.
    #[test]
    fn the_designated_taker_takes_corners_until_he_is_off() {
        let mut home = make_team("home");
        home.players[6].crossing = 92;
        home.players[6].curve = 90;
        let mut state = corner_match(home);
        state.home_set_pieces.corner_taker = Some("home_d2".to_string());
        assert_eq!(taker_of(&corners(&mut state, 1, 1)[0]), Some("home_d2"));
        state.sent_off.insert("home_d2".to_string());
        assert_eq!(taker_of(&corners(&mut state, 1, 1)[0]), Some("home_m2"));
    }

    /// Given a club with an excellent corner taker and one with a poor one,
    /// when each takes 4,000 corners,
    /// then the better delivery reaches the aerial contest clearly more often.
    #[test]
    fn a_better_delivery_reaches_the_contest_more_often() {
        let contests = |crossing: u8| {
            let mut home = make_team("home");
            home.players[6].crossing = crossing;
            home.players[6].curve = crossing;
            let mut state = corner_match(home);
            state.home_set_pieces.corner_taker = Some("home_m2".to_string());
            corners(&mut state, 4_000, 3)
                .iter()
                .filter(|events| events.iter().any(|e| e.event_type == EventType::Cross))
                .count()
        };
        let (good, poor) = (contests(90), contests(45));
        assert!(good > poor + 600, "reached {good} vs {poor}");
    }

    /// Given many corners,
    /// when they are played,
    /// then the man meeting the ball is never the taker nor a keeper, the two
    /// best-heading centre-backs go up but the other defenders stay back, and
    /// every event is part of the corner, its goals corner goals.
    #[test]
    fn who_goes_up_and_what_a_corner_is_made_of() {
        let mut home = make_team("home");
        home.players[2].heading = 90;
        home.players[3].heading = 88;
        home.players[1].heading = 30;
        home.players[4].heading = 30;
        let mut state = corner_match(home);
        let mut targets = std::collections::HashSet::new();
        let mut goals = 0;
        for events in corners(&mut state, 3_000, 5) {
            let taker = taker_of(&events).expect("a taker").to_string();
            for event in &events {
                assert_eq!(event.set_piece, Some(SetPiece::Corner), "{event:?}");
                if event.event_type == EventType::Cross {
                    let target = event.secondary_player_id.clone().expect("a target");
                    assert_ne!(target, taker);
                    assert_ne!(target, "home_gk");
                    targets.insert(target);
                }
                if event.event_type == EventType::Goal {
                    goals += 1;
                    assert_eq!(event.goal_source, Some(GoalSource::Corner));
                    assert_eq!(event.secondary_player_id.as_deref(), Some(taker.as_str()));
                }
            }
        }
        assert!(targets.contains("home_d2") && targets.contains("home_d3"));
        assert!(!targets.contains("home_d1") && !targets.contains("home_d4"));
        assert!(goals > 0);
    }

    /// Given a 4-4-2 whose full-backs head the ball far better than its
    /// centre-backs,
    /// when it takes corners,
    /// then the centre-backs still go up and the full-backs stay back: it is
    /// the slot that sends a defender forward, not his heading.
    #[test]
    fn full_backs_stay_back_however_well_they_head() {
        let mut home = make_team("home");
        home.players[1].heading = 95;
        home.players[4].heading = 95;
        home.players[2].heading = 40;
        home.players[3].heading = 40;
        let mut state = corner_match(home);
        let mut targets = std::collections::HashSet::new();
        for events in corners(&mut state, 3_000, 9) {
            for event in events.iter().filter(|e| e.event_type == EventType::Cross) {
                targets.insert(event.secondary_player_id.clone().expect("a target"));
            }
        }
        assert!(targets.contains("home_d2") && targets.contains("home_d3"));
        assert!(!targets.contains("home_d1") && !targets.contains("home_d4"));
    }

    /// Given the reach chance and the help a delivery gives,
    /// when they are read at the extremes and at an average delivery,
    /// then they stay in their bands and an average delivery is neutral help.
    #[test]
    fn delivery_quality_stays_in_its_bands() {
        assert_eq!(reach_chance(DELIVERY_REFERENCE), REACH_BASE);
        assert_eq!(reach_chance(0.0), REACH_MIN);
        assert_eq!(reach_chance(200.0), REACH_MAX);
        assert_eq!(contest_help(DELIVERY_REFERENCE), 1.0);
        assert_eq!(contest_help(0.0), CONTEST_MIN);
        assert_eq!(contest_help(200.0), CONTEST_MAX);
    }

    /// Plays `count` direct free kicks for the home side, the score reset
    /// after each.
    fn free_kicks(state: &mut LiveMatchState, count: u32, seed: u64) -> Vec<Vec<MatchEvent>> {
        let mut rng = StdRng::seed_from_u64(seed);
        (0..count)
            .map(|_| {
                let events = state.resolve_direct_free_kick(30, Side::Home, &mut rng);
                state.home_score = 0;
                events
            })
            .collect()
    }

    fn free_kick_taker_of(events: &[MatchEvent]) -> Option<&str> {
        events
            .iter()
            .find(|e| e.shot_kind == Some(ShotKind::DirectFreeKick))
            .and_then(|e| e.player_id.as_deref())
    }

    /// Given a club whose designated free-kick taker is a defender, and then
    /// the same club with him sent off and one midfielder a specialist,
    /// when it shoots from free kicks,
    /// then he takes them while he plays, and the specialist after.
    #[test]
    fn the_designated_free_kick_taker_shoots_until_he_is_off() {
        let mut home = make_team("home");
        home.players[7].free_kick = 92;
        home.players[7].curve = 90;
        let mut state = corner_match(home);
        state.home_set_pieces.free_kick_taker = Some("home_d3".to_string());
        assert_eq!(
            free_kick_taker_of(&free_kicks(&mut state, 1, 1)[0]),
            Some("home_d3")
        );
        state.sent_off.insert("home_d3".to_string());
        assert_eq!(
            free_kick_taker_of(&free_kicks(&mut state, 1, 1)[0]),
            Some("home_m3")
        );
    }

    /// Given a specialist (free kick and curve 90) and a poor taker (45),
    /// when each takes 6,000 direct free kicks,
    /// then the specialist scores clearly more, and an average taker lands in
    /// the real 5–7% band once the wall has had its share.
    #[test]
    fn a_better_free_kick_taker_scores_more() {
        let goals = |skill: u8| {
            let mut home = make_team("home");
            home.players[7].free_kick = skill;
            home.players[7].curve = skill;
            let mut state = corner_match(home);
            state.home_set_pieces.free_kick_taker = Some("home_m3".to_string());
            free_kicks(&mut state, 6_000, 4)
                .iter()
                .filter(|events| {
                    events.iter().any(|e| {
                        e.event_type == EventType::Goal
                            && e.shot_kind == Some(ShotKind::DirectFreeKick)
                    })
                })
                .count()
        };
        let (good, poor, average) = (goals(90), goals(45), goals(70));
        assert!(good > poor * 2, "goals {good} vs {poor}");
        let rate = average as f64 / 6_000.0;
        assert!(
            (0.05..=0.07).contains(&rate),
            "an average taker scores {rate}"
        );
    }

    /// Given many direct free kicks,
    /// when they are played,
    /// then every attempt is a direct free kick and part of the free kick, a
    /// goal is a direct-free-kick goal with no assist, and a wall that sends
    /// it behind gives a corner, which is the corner's own.
    #[test]
    fn what_a_direct_free_kick_is_made_of() {
        let mut state = corner_match(make_team("home"));
        let (mut goals, mut corners) = (0, 0);
        for events in free_kicks(&mut state, 3_000, 6) {
            let mut in_corner = false;
            for event in &events {
                if event.event_type == EventType::Corner {
                    in_corner = true;
                    corners += 1;
                }
                if in_corner {
                    assert_eq!(event.set_piece, Some(SetPiece::Corner), "{event:?}");
                    continue;
                }
                assert_eq!(event.set_piece, Some(SetPiece::FreeKick), "{event:?}");
                if matches!(
                    event.event_type,
                    EventType::Goal
                        | EventType::ShotSaved
                        | EventType::ShotOffTarget
                        | EventType::ShotBlocked
                ) {
                    assert_eq!(event.shot_kind, Some(ShotKind::DirectFreeKick));
                    assert_eq!(event.zone, Zone::attacking_third(Side::Home));
                }
                if event.event_type == EventType::Goal {
                    goals += 1;
                    assert_eq!(event.goal_source, Some(GoalSource::DirectFreeKick));
                    assert_eq!(event.secondary_player_id, None);
                }
            }
        }
        assert!(goals > 0 && corners > 0, "goals {goals}, corners {corners}");
    }

    /// Given the on-target and goal chances of a free kick,
    /// when they are read at the extremes,
    /// then they stay in their bands.
    #[test]
    fn free_kick_chances_stay_in_their_bands() {
        assert_eq!(free_kick_on_target(0.0), FREE_KICK_ON_TARGET_MIN);
        assert_eq!(free_kick_on_target(200.0), FREE_KICK_ON_TARGET_MAX);
        assert_eq!(free_kick_goal(0.0, 99.0), FREE_KICK_GOAL_MIN);
        assert_eq!(free_kick_goal(200.0, 1.0), FREE_KICK_GOAL_MAX);
        assert_eq!(free_kick_goal(70.0, 70.0), FREE_KICK_GOAL_BASE);
    }
}
