use rand::{Rng, RngExt};

use crate::duel;
use crate::event::{EventDetail, EventType, MatchEvent, SetPiece, ShotKind, TacticalContext};
use crate::shared::{
    PlayStylePhase, PlayerSnap, TraitContext, play_style_modifier, role_attribute_modifier,
    tactics_defensive_conversion_mod, tactics_foul_modifier, tactics_line_press,
    tactics_pressing_press, tactics_shape_modifier, tactics_tempo_progression,
    tactics_width_versus_shape, trait_bonus,
};
use crate::types::{PlayStyle, Position, PressingIntensity, Side, TeamData, Zone};

use super::LiveMatchState;
use super::helpers::{danger_band, foul_severity, save_quality};
use super::offside::OffsideMoment;
use super::presence::{Column, out_of_lane_factor};

// ---------------------------------------------------------------------------
// Action resolution
// ---------------------------------------------------------------------------

/// `probability` with its odds multiplied by `ratio`: the same scaling a duel
/// gets from multiplying one side's effective rating, for a duel that only
/// hands back a probability.
/// The chance a shot worked inside the box is fouled first, independent of
/// `foul_probability` (which tunes fouls elsewhere). Every penalty comes from
/// here. 3.6% until phase 2; raised to 6% at P2.5, because fewer shots are
/// worked inside the box since headers (P2.2) and shots from distance (P2.5)
/// stopped going through it, and penalties had fallen to 0.17 a match on the
/// real-world probe against about 0.28 in real football.
const BOX_FOUL_CHANCE: f64 = 0.06;

/// How often a one-on-one cleared goes behind for a corner (GĐ2); the
/// default of `CalibrationKnobs::corner_from_cleared_duel`.
// Was 0.25; calibrated in GĐ5 P5.3 (match probe, Premier League; `gd5-p53-report.md`): 6.9 corners a match, real 9.6–9.7 (T11).
// 0.36 → 0.38 in P5.4: fewer direct breaks, 8.8 corners a match. 0.40
// since offside (after GĐ5): fewer balls into the final third.
pub(crate) const CORNER_FROM_CLEARED_DUEL: f64 = 0.40;

/// How often a ball won from the other side's short build-up stays in their
/// third for the winner, before the winner's press scales it (GĐ5 P5.2,
/// X84); the default of `CalibrationKnobs::p_high_turnover`. Until P5.2 every
/// one did, and a ball lost in the own third was a chance about five times
/// as dangerous as in real football (0.32–0.37 shots each, real 0.069). The
/// rest is played in midfield: the passer lost it, but his side was still
/// between the ball and its goal. Start 0.30, the share of own-third losses
/// made under pressure in StatsBomb; calibrated to 0.15 (P5.2). Shots per
/// ball lost (T14) stop falling near 0.13 on the match probe even at 0, the
/// shots a ball won in midfield brings within two actions; 0.15 keeps a real
/// reward for pressing (0.18 aggressive, 0.20 with the high-press style) at
/// T14 ≈ 0.18, against 0.44 before.
pub(crate) const P_HIGH_TURNOVER: f64 = 0.15;

/// How much more often a ball won from a build-up stays high for a side that
/// presses harder (X84): its pressing dial, and the high-press style on top.
fn high_turnover_press_mod(team: &TeamData) -> f64 {
    let dial = match team.tactics.pressing_intensity {
        PressingIntensity::Passive => 0.8,
        PressingIntensity::Medium => 1.0,
        PressingIntensity::Aggressive => 1.2,
    };
    let style = if team.play_style == PlayStyle::HighPress {
        1.1
    } else {
        1.0
    };
    dial * style
}

pub(super) fn scale_odds(probability: f64, ratio: f64) -> f64 {
    let scaled = probability * ratio;
    scaled / (scaled + (1.0 - probability))
}

/// The roles that play out from the back best (phase 2, P4.4, §8.2): a
/// ball-playing centre back and a half-back.
fn build_up_role(role: crate::types::PlayerRole) -> f64 {
    use crate::types::PlayerRole as R;
    match role {
        R::BallPlayingCB | R::HalfBack => 1.05,
        _ => 1.0,
    }
}

impl LiveMatchState {
    pub(super) fn resolve_action<R: Rng>(&mut self, minute: u8, rng: &mut R) -> Vec<MatchEvent> {
        let att_side = self.possession;
        let def_side = att_side.opposite();
        let zone = self.ball_zone;
        // A break carries into the next action only if the side that broke
        // still has the ball in its attacking third, or has carried it on
        // into the box.
        self.active_break = self.on_the_break.take() == Some(att_side)
            && (zone == Zone::attacking_third(att_side) || zone.is_box_for(att_side));

        self.close_flanks_on_regain(att_side);
        // A break into an open flank is only good for the next action in the
        // attacking third.
        if zone != Zone::attacking_third(att_side) {
            self.pending_exploit = None;
        }
        // A counter-press weighs on the first build-up after the ball was
        // lost, and what led to an attack (a ball won in the other side's
        // build-up, a long ball brought down) labels the action that follows;
        // whatever happens first ends both (P4.1, P4.2).
        let counter_pressed = self.counter_pressing.take() == Some(def_side);
        let pending = self.pending_context.take().filter(|(side, _)| {
            *side == att_side
                && (zone == Zone::attacking_third(att_side) || zone.is_box_for(att_side))
        });
        let outer_context = self.active_context;
        if let Some((_, context)) = pending {
            self.active_context = Some(context);
        }
        let events = if zone.is_box_for(att_side) {
            // The box is one cell: whatever lane the ball came in from, it is
            // now in the middle of it (GĐ3-tech-spec §7.1).
            self.centre_the_ball();
            self.resolve_shot(minute, att_side, rng)
        } else if zone == Zone::attacking_third(att_side) {
            self.resolve_attacking_third(minute, att_side, def_side, rng)
        } else if zone == Zone::Midfield {
            self.resolve_midfield(minute, att_side, def_side, rng)
        } else {
            self.resolve_buildup(minute, att_side, def_side, counter_pressed, rng)
        };
        self.active_break = false;
        self.active_context = outer_context;
        events
    }

    /// Playing out from the own third against the other side's press (phase 2,
    /// GĐ4, P4.1; GĐ4-tech-spec §5): the passer is drawn by his presence in
    /// the ball's lane, the press is the weighted rating of the other side's
    /// front there, and the passer's press resistance meets it in a duel with
    /// its own anchor (X66). Lost, the ball is the other side's where it is,
    /// in its attacking third (X67).
    fn resolve_buildup<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        counter_pressed: bool,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        if self.plays_long(att_side, rng) {
            return self.resolve_long_ball(minute, att_side, def_side, rng);
        }
        let mut events = Vec::new();
        let lane = self.lane_for(att_side);
        let passer = self
            .pick_by_presence(att_side, Column::BuildUp, lane, rng)
            .map(|picked| picked.player)
            .unwrap_or_else(|| self.snap_player(att_side, Position::Defender, rng));
        let resistance = duel::press_resistance(&passer);
        let press = self
            .press_rating(def_side, self.lane_for(def_side))
            .unwrap_or_else(|| self.midfield_press(def_side));
        let counter_press = if counter_pressed {
            super::transition::counter_press_mod(
                self.team_ref(def_side).tactics.counter_press_duration,
            )
        } else {
            1.0
        };
        let att_mod = self.condition_adjusted_skill(&passer.id, 1.0)
            * trait_bonus(&passer, TraitContext::Passing)
            * build_up_role(passer.role);
        let def_mod = self.press_modifiers(def_side) * counter_press;
        let success = duel::build_up_win_probability(resistance, press, att_mod / def_mod);
        let ball_zone = self.ball_zone;
        if rng.random_range(0.0..1.0f64) < success {
            let evt = MatchEvent::new(minute, EventType::PassCompleted, att_side, ball_zone)
                .with_player(&passer.id);
            self.emit(&mut events, evt);
            self.ball_zone = Zone::Midfield;
            self.advance_lane(att_side, &passer, rng);
        } else {
            let interceptor = self
                .pick_by_presence(def_side, Column::Press, self.lane_for(def_side), rng)
                .map(|picked| picked.player)
                .unwrap_or_else(|| self.snap_player(def_side, Position::Midfielder, rng));
            let stays_high = self.config.knobs.p_high_turnover
                * high_turnover_press_mod(self.team_ref(def_side));
            let mut evt1 = MatchEvent::new(minute, EventType::PassIntercepted, att_side, ball_zone)
                .with_player(&passer.id);
            let mut evt2 = MatchEvent::new(minute, EventType::Interception, def_side, ball_zone)
                .with_player(&interceptor.id);
            self.possession = def_side;
            if rng.random_range(0.0..1.0f64) < stays_high {
                evt1 = evt1.with_tactical_context(TacticalContext::HighTurnover);
                evt2 = evt2.with_tactical_context(TacticalContext::HighTurnover);
                self.pending_context = Some((def_side, TacticalContext::HighTurnover));
            } else {
                // Won, but not high enough to be a chance: the winner plays it
                // from midfield (X84).
                self.ball_zone = Zone::Midfield;
            }
            self.emit(&mut events, evt1);
            self.emit(&mut events, evt2);
        }
        events
    }

    /// Everything that makes `side`'s press harder beyond its players: its
    /// style's press, its pressing dial, how high its line stands (X68) and
    /// home advantage.
    fn press_modifiers(&self, side: Side) -> f64 {
        let team = self.team_ref(side);
        play_style_modifier(team, PlayStylePhase::Press, &self.config.knobs)
            * tactics_pressing_press(&team.tactics)
            * tactics_line_press(&team.tactics)
            * crate::shared::home_mod(side, &self.config)
    }

    fn resolve_midfield<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let (attacker, defender) = self.midfield_duelists(att_side, def_side, rng);

        // The players' ratings live in `duel`; what is left here is every
        // modifier the duel always had, applied exactly as strongly.
        let att_rating = self.condition_adjusted_skill(&attacker.id, 1.0)
            * trait_bonus(&attacker, TraitContext::Midfield);
        let def_rating = self.condition_adjusted_skill(&defender.id, 1.0)
            * trait_bonus(&defender, TraitContext::Tackling);

        let att_mod = play_style_modifier(
            self.team_ref(att_side),
            PlayStylePhase::Midfield,
            &self.config.knobs,
        ) * role_attribute_modifier(attacker.role, PlayStylePhase::Midfield);
        let def_mod = play_style_modifier(
            self.team_ref(def_side),
            PlayStylePhase::Midfield,
            &self.config.knobs,
        ) * role_attribute_modifier(defender.role, PlayStylePhase::Defense);
        let att_eff = att_rating
            * att_mod
            * crate::shared::home_mod(att_side, &self.config)
            * tactics_tempo_progression(&self.team_ref(att_side).tactics)
            * self.line_strength(att_side, Position::Midfielder);
        let def_eff = def_rating
            * def_mod
            * crate::shared::home_mod(def_side, &self.config)
            * self.line_strength(def_side, Position::Midfielder);
        let tempo = self.team_ref(att_side).tactics.tempo;
        let success =
            duel::midfield_win_probability(&attacker, &defender, tempo, att_eff / def_eff);

        if rng.random_range(0.0..1.0f64) < success {
            // The ball forward is to a runner, who may be caught offside.
            let runner = self
                .pick_by_presence(att_side, Column::Attack, self.lane_for(att_side), rng)
                .map_or_else(
                    || self.snap_player(att_side, Position::Forward, rng),
                    |picked| picked.player,
                );
            if self.flag_offside(
                minute,
                att_side,
                &runner,
                OffsideMoment::IntoTheFinalThird,
                &mut events,
                rng,
            ) {
                return events;
            }
            let evt = MatchEvent::new(minute, EventType::PassCompleted, att_side, Zone::Midfield)
                .with_player(&attacker.id);
            self.emit(&mut events, evt);
            self.ball_zone = Zone::attacking_third(att_side);
            self.advance_lane(att_side, &attacker, rng);
        } else {
            if rng.random_range(0.0..1.0f64) < 0.6 {
                let evt = MatchEvent::new(minute, EventType::Tackle, def_side, Zone::Midfield)
                    .with_player(&defender.id);
                self.emit(&mut events, evt);
                let foul_mod = tactics_foul_modifier(&self.team_ref(def_side).tactics);
                let foul_events = self.maybe_foul(
                    minute,
                    def_side,
                    &attacker,
                    &defender,
                    Zone::Midfield,
                    rng,
                    foul_mod,
                );
                let fouled = foul_events.iter().any(|e| e.event_type == EventType::Foul);
                events.extend(foul_events);
                if fouled {
                    // Fouled team (att_side) retains possession for the free kick
                    self.possession = att_side;
                    self.ball_zone = Zone::Midfield;
                    return events;
                }
            } else {
                let evt =
                    MatchEvent::new(minute, EventType::Interception, def_side, Zone::Midfield)
                        .with_player(&defender.id);
                self.emit(&mut events, evt);
            }
            self.possession = def_side;
            self.ball_zone = Zone::Midfield;
        }
        events
    }

    /// The chance `attacker` beats `defender` in the attacking third's
    /// one-on-one, with every modifier the duel has: ratings in `duel`, the
    /// rest here. `out_of_lane` is κ for a defender off his flank (P3.2),
    /// `space` the room behind a full back who went up (P3.6; 1 otherwise).
    pub(super) fn one_v_one_success(
        &self,
        att_side: Side,
        def_side: Side,
        attacker: &PlayerSnap,
        defender: &PlayerSnap,
        out_of_lane: f64,
        space: f64,
    ) -> f64 {
        let att_rating = self.condition_adjusted_skill(&attacker.id, 1.0)
            * trait_bonus(attacker, TraitContext::Dribbling);
        let def_rating = self.condition_adjusted_skill(&defender.id, 1.0)
            * trait_bonus(defender, TraitContext::Tackling);

        let att_mod = play_style_modifier(
            self.team_ref(att_side),
            PlayStylePhase::Attack,
            &self.config.knobs,
        ) * role_attribute_modifier(attacker.role, PlayStylePhase::Attack);
        let def_mod = play_style_modifier(
            self.team_ref(def_side),
            PlayStylePhase::Defense,
            &self.config.knobs,
        ) * role_attribute_modifier(defender.role, PlayStylePhase::Defense);
        let att_eff = att_rating
            * att_mod
            * crate::shared::home_mod(att_side, &self.config)
            * self.line_strength(att_side, Position::Forward)
            * space;
        let def_eff = def_rating
            * def_mod
            * crate::shared::home_mod(def_side, &self.config)
            * self.line_strength(def_side, Position::Defender)
            * self.centre_back_pair_factor(def_side, self.active_break)
            * tactics_shape_modifier(&self.team_ref(def_side).tactics)
            * tactics_width_versus_shape(
                &self.team_ref(att_side).tactics,
                &self.team_ref(def_side).tactics,
            )
            * out_of_lane;
        duel::one_v_one_win_probability(attacker, defender, att_eff / def_eff, &self.config.knobs)
    }

    /// The attacker lost the one-on-one: tackled (perhaps fouled) or
    /// cleared, and a cleared ball goes behind for a corner a quarter of the
    /// time.
    #[expect(
        clippy::too_many_arguments,
        reason = "a duel names both sides, both players and how it came about; owner=GĐ3"
    )]
    pub(super) fn one_v_one_lost<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        attacker: &PlayerSnap,
        defender: &PlayerSnap,
        duel_context: Option<TacticalContext>,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let zone = Zone::attacking_third(att_side);
        let is_tackle = rng.random_range(0.0..1.0f64) < 0.5;
        let fouled = if is_tackle {
            let mut evt1 = MatchEvent::new(minute, EventType::DribbleTackled, att_side, zone)
                .with_player(&attacker.id)
                .with_secondary(&defender.id);
            if let Some(context) = duel_context {
                evt1 = evt1.with_tactical_context(context);
            }
            let evt2 = MatchEvent::new(minute, EventType::Tackle, def_side, zone)
                .with_player(&defender.id);
            self.emit(&mut events, evt1);
            self.emit(&mut events, evt2);
            let foul_mod = tactics_foul_modifier(&self.team_ref(def_side).tactics);
            let foul_events =
                self.maybe_foul(minute, def_side, attacker, defender, zone, rng, foul_mod);
            let was_fouled = foul_events.iter().any(|e| e.event_type == EventType::Foul);
            events.extend(foul_events);
            was_fouled
        } else {
            // The clearance ends the duel, so it carries the duel's context.
            let mut evt = MatchEvent::new(minute, EventType::Clearance, def_side, zone)
                .with_player(&defender.id);
            if let Some(context) = duel_context {
                evt = evt.with_tactical_context(context);
            }
            self.emit(&mut events, evt);
            false
        };
        if fouled {
            // The fouled side keeps the ball for the free kick in its
            // attacking third, and now and then shoots straight from it.
            self.possession = att_side;
            self.ball_zone = zone;
            let free_kick_events = self.lane_free_kick(minute, att_side, rng);
            events.extend(free_kick_events);
            return events;
        }
        if rng.random_range(0.0..1.0f64) < self.config.knobs.corner_from_cleared_duel {
            let corner_events = self.resolve_corner(minute, att_side, rng);
            events.extend(corner_events);
            return events;
        }
        self.after_defensive_win(def_side, Some(defender), rng);
        events
    }

    /// Who meets in the attacking third's one-on-one, and κ for the defender:
    /// each drawn by presence in the ball's lane (P3.2); a defender drawn onto
    /// a flank his slot is not on plays it at κ.
    pub(super) fn attacking_third_duelists<R: Rng>(
        &self,
        att_side: Side,
        def_side: Side,
        rng: &mut R,
    ) -> (PlayerSnap, PlayerSnap, f64) {
        let attacker = self
            .pick_by_presence(att_side, Column::Attack, self.lane_for(att_side), rng)
            .map_or_else(
                || self.snap_player(att_side, Position::Forward, rng),
                |picked| picked.player,
            );
        let def_lane = self.lane_for(def_side);
        match self.pick_by_presence(def_side, Column::Defence, def_lane, rng) {
            Some(picked) => {
                let kappa = out_of_lane_factor(picked.slot, def_lane);
                (attacker, picked.player, kappa)
            }
            None => (
                attacker,
                self.snap_player(def_side, Position::Defender, rng),
                1.0,
            ),
        }
    }

    /// Who contests midfield: two midfielders, each drawn by presence in the
    /// ball's lane (P3.2, X48).
    fn midfield_duelists<R: Rng>(
        &self,
        att_side: Side,
        def_side: Side,
        rng: &mut R,
    ) -> (PlayerSnap, PlayerSnap) {
        let pick = |side: Side, column: Column, rng: &mut R| {
            self.pick_by_presence(side, column, self.lane_for(side), rng)
                .map_or_else(
                    || self.snap_player(side, Position::Midfielder, rng),
                    |picked| picked.player,
                )
        };
        let attacker = pick(att_side, Column::MidfieldAttack, rng);
        let defender = pick(def_side, Column::MidfieldDefence, rng);
        (attacker, defender)
    }

    /// A shot worked inside the box. A header from a cross is not one of
    /// these: it is played out by `resolve_header`.
    fn resolve_shot<R: Rng>(&mut self, minute: u8, att_side: Side, rng: &mut R) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let def_side = att_side.opposite();
        let zone = Zone::attacking_box(att_side);

        if rng.random_range(0.0..1.0f64) < BOX_FOUL_CHANCE {
            let fouler = self.snap_player(def_side, Position::Defender, rng);
            let fouled = self.snap_player(att_side, Position::Forward, rng);
            let foul_evt = MatchEvent::new(minute, EventType::Foul, def_side, zone)
                .with_player(&fouler.id)
                .with_secondary(&fouled.id)
                .with_detail(EventDetail::Foul {
                    severity: foul_severity(fouler.aggression),
                });
            self.emit(&mut events, foul_evt);

            if rng.random_range(0.0..1.0f64) < self.config.penalty_probability {
                let pen_evt = MatchEvent::new(minute, EventType::PenaltyAwarded, att_side, zone);
                self.emit(&mut events, pen_evt);
                let pen_events = self.resolve_in_match_penalty(minute, att_side, rng);
                events.extend(pen_events);
                let card_events = self.maybe_card(minute, def_side, &fouler.id.clone(), zone, rng);
                events.extend(card_events);
                self.ball_zone = Zone::Midfield;
                self.possession = def_side;
                return events;
            }
            let card_events = self.maybe_card(minute, def_side, &fouler.id.clone(), zone, rng);
            events.extend(card_events);
            // Foul but no penalty: advantage played, shot continues
        }

        let (shooter, assister_id) = self.box_shooter_and_assister(att_side, rng);
        let strike = self.strike_in_box(minute, att_side, &shooter, &assister_id, 1.0, None, rng);
        events.extend(strike);
        events
    }

    /// `shooter`'s shot in the box with his feet, from the keeper's side of
    /// it: on target, saved or scored. `rating_mod` scales his finishing (a
    /// first-time shot from a low cross, P3.4), `context` tags the attempt.
    #[expect(
        clippy::too_many_arguments,
        reason = "a shot names its side, shooter, assister, rating and context; owner=GĐ3"
    )]
    pub(super) fn strike_in_box<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        shooter: &PlayerSnap,
        assister_id: &str,
        rating_mod: f64,
        tactical_context: Option<TacticalContext>,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let def_side = att_side.opposite();
        let zone = Zone::attacking_box(att_side);
        let kind = ShotKind::Open;
        let tag = |event: MatchEvent| match tactical_context {
            Some(c) => event.with_tactical_context(c),
            None => event,
        };
        let goalkeeper = self.snap_player(def_side, Position::Goalkeeper, rng);

        let shoot_raw =
            (shooter.shooting as f64 + shooter.composure as f64 + shooter.decisions as f64) / 3.0;
        let shoot_rating = self.condition_adjusted_skill(&shooter.id, shoot_raw)
            * trait_bonus(shooter, TraitContext::Shooting)
            * rating_mod;
        let gk_raw = (goalkeeper.handling as f64
            + goalkeeper.reflexes as f64
            + goalkeeper.positioning as f64)
            / 3.0;
        let gk_rating = self.condition_adjusted_skill(&goalkeeper.id, gk_raw)
            * trait_bonus(&goalkeeper, TraitContext::Goalkeeping);

        let accuracy =
            (self.config.shot_accuracy_base + (shoot_rating - 50.0) / 200.0).clamp(0.15, 0.85);

        if rng.random_range(0.0..1.0f64) > accuracy {
            let detail = EventDetail::Shot {
                danger: danger_band(shoot_rating),
            };
            if rng.random_range(0.0..1.0f64) < 0.4 {
                let evt = MatchEvent::new(minute, EventType::ShotBlocked, att_side, zone)
                    .with_shot_kind(kind)
                    .with_player(&shooter.id)
                    .with_detail(detail);
                self.emit(&mut events, tag(evt));
                self.ball_zone = Zone::Midfield;
                self.possession = def_side;
            } else {
                let evt = MatchEvent::new(minute, EventType::ShotOffTarget, att_side, zone)
                    .with_shot_kind(kind)
                    .with_player(&shooter.id)
                    .with_detail(detail);
                self.emit(&mut events, tag(evt));
                let gk_evt = MatchEvent::new(minute, EventType::GoalKick, def_side, zone);
                self.emit(&mut events, gk_evt);
                self.ball_zone = Zone::defensive_third(def_side);
                self.possession = def_side;
            }
            return events;
        }

        let def_line_mod =
            tactics_defensive_conversion_mod(&self.team_ref(def_side).tactics, &self.config.knobs);
        let conversion = (self.config.goal_conversion_base * def_line_mod
            + (shoot_rating - gk_rating) / 150.0)
            .clamp(0.10, 0.70);

        if rng.random_range(0.0..1.0f64) < conversion {
            let context = self.goal_context(att_side);
            let evt = MatchEvent::new(minute, EventType::Goal, att_side, zone)
                .with_shot_kind(kind)
                .with_player(&shooter.id)
                .with_secondary(assister_id)
                .with_detail(EventDetail::Goal { context });
            self.emit(&mut events, tag(evt));
            self.add_goal(att_side);
            self.ball_zone = Zone::Midfield;
            self.possession = def_side;
        } else {
            let evt = MatchEvent::new(minute, EventType::ShotSaved, att_side, zone)
                .with_shot_kind(kind)
                .with_player(&shooter.id)
                .with_secondary(&goalkeeper.id)
                .with_detail(EventDetail::Save {
                    quality: save_quality(gk_rating),
                });
            self.emit(&mut events, tag(evt));
            self.after_save(minute, att_side, &mut events, rng);
        }

        events
    }

    /// What a save leaves: 40% of the time the keeper parries it wide for a
    /// corner, otherwise he holds it and the defending side restarts.
    pub(super) fn after_save<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        events: &mut Vec<MatchEvent>,
        rng: &mut R,
    ) {
        self.after_save_with(minute, att_side, events, 0.40, rng);
    }

    /// What a save leaves, with `to_corner` the share the keeper pushes
    /// behind: a corner, or the defending side's restart.
    pub(super) fn after_save_with<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        events: &mut Vec<MatchEvent>,
        to_corner: f64,
        rng: &mut R,
    ) {
        let def_side = att_side.opposite();
        let zone = Zone::attacking_box(att_side);
        if rng.random_range(0.0..1.0f64) < to_corner {
            let corner_events = self.resolve_corner(minute, att_side, rng);
            events.extend(corner_events);
        } else {
            let gk_evt = MatchEvent::new(minute, EventType::GoalKick, def_side, zone);
            self.emit(events, gk_evt);
            self.ball_zone = Zone::defensive_third(def_side);
            self.possession = def_side;
        }
    }

    // -----------------------------------------------------------------------
    // Foul / card / penalty
    // -----------------------------------------------------------------------

    // Foul resolution needs the full context (who, whom, where, when, tactics,
    // RNG), so the argument count is inherent.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn maybe_foul<R: Rng>(
        &mut self,
        minute: u8,
        fouling_side: Side,
        fouled: &PlayerSnap,
        fouler: &PlayerSnap,
        zone: Zone,
        rng: &mut R,
        tactics_mod: f64,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();

        let aggression_mod = fouler.aggression as f64 / 100.0;
        let foul_chance = self.config.foul_probability
            * (0.6 + aggression_mod * 0.8)
            * trait_bonus(fouler, TraitContext::Foul)
            * tactics_mod;
        if rng.random_range(0.0..1.0f64) >= foul_chance {
            return events;
        }

        let evt = MatchEvent::new(minute, EventType::Foul, fouling_side, zone)
            .with_player(&fouler.id)
            .with_secondary(&fouled.id)
            .with_detail(EventDetail::Foul {
                severity: foul_severity(fouler.aggression),
            });
        self.emit(&mut events, evt);

        let att_side = fouling_side.opposite();

        if zone.is_box_for(att_side)
            && rng.random_range(0.0..1.0f64) < self.config.penalty_probability
        {
            let evt = MatchEvent::new(minute, EventType::PenaltyAwarded, att_side, zone);
            self.emit(&mut events, evt);
            let pen_events = self.resolve_in_match_penalty(minute, att_side, rng);
            events.extend(pen_events);
        } else {
            let evt = MatchEvent::new(minute, EventType::FreeKick, att_side, zone)
                .with_set_piece(SetPiece::FreeKick);
            self.emit(&mut events, evt);
        }

        let card_events = self.maybe_card(minute, fouling_side, &fouler.id, zone, rng);
        events.extend(card_events);

        // An unknown player reads as fit enough not to change the odds.
        let fouled_fitness = self
            .team_ref(att_side)
            .players
            .iter()
            .find(|player| player.id == fouled.id)
            .map_or(80, |player| player.fitness);
        let injury_chance =
            self.config.injury_probability * crate::injury_fitness_multiplier(fouled_fitness);
        if !self.injured.contains(&fouled.id) && rng.random_range(0.0..1.0f64) < injury_chance {
            self.injured.insert(fouled.id.clone());
            let evt =
                MatchEvent::new(minute, EventType::Injury, att_side, zone).with_player(&fouled.id);
            self.emit(&mut events, evt);
        }

        events
    }

    pub(super) fn maybe_card<R: Rng>(
        &mut self,
        minute: u8,
        side: Side,
        fouler_id: &str,
        zone: Zone,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();

        let aggression_factor = self
            .team_ref(side)
            .players
            .iter()
            .find(|p| p.id == fouler_id)
            .map(|p| p.aggression as f64 / 100.0)
            .unwrap_or(0.5);
        // A man already booked holds back from the challenge that would be
        // his second (GĐ5 P5.7: second yellows ran at 0.23 a match, real
        // football's sendings-off of every kind at 0.18).
        let already_booked = self.yellows.get(fouler_id).copied().unwrap_or(0) > 0;
        let caution = if already_booked {
            self.config.knobs.booked_card_factor
        } else {
            1.0
        };
        let card_chance = self.config.yellow_card_probability * (0.5 + aggression_factor) * caution;
        if rng.random_range(0.0..1.0f64) >= card_chance {
            return events;
        }

        if rng.random_range(0.0..1.0f64) < self.config.red_card_probability {
            let evt =
                MatchEvent::new(minute, EventType::RedCard, side, zone).with_player(fouler_id);
            self.emit(&mut events, evt);
            self.sent_off.insert(fouler_id.to_string());
            return events;
        }

        let current_yellows = self.yellows.entry(fouler_id.to_string()).or_insert(0);
        *current_yellows += 1;

        if *current_yellows >= 2 {
            let evt =
                MatchEvent::new(minute, EventType::SecondYellow, side, zone).with_player(fouler_id);
            self.emit(&mut events, evt);
            self.sent_off.insert(fouler_id.to_string());
        } else {
            let evt =
                MatchEvent::new(minute, EventType::YellowCard, side, zone).with_player(fouler_id);
            self.emit(&mut events, evt);
        }

        events
    }
}

#[cfg(test)]
mod event_detail_tests {
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    use crate::event::{EventDetail, EventType, GoalContext};
    use crate::live_match::LiveMatchState;
    use crate::live_match::test_support::{make_player, make_team};
    use crate::types::{MatchConfig, Position};

    /// Given synthetic players who set only the old attributes, and one forward
    /// who declared his heading,
    /// when the match is created,
    /// then the undeclared six are read off their parent fields with the group
    /// offsets, and the declared one is kept.
    #[test]
    fn undeclared_split_attributes_are_filled_at_kick_off() {
        let mut home = make_team("home");
        home.players[10].heading = 55;
        let mut bench_gk = make_player("home_sub_gk", Position::Goalkeeper);
        bench_gk.passing = 40;
        let state = LiveMatchState::new(
            home,
            make_team("away"),
            MatchConfig::default(),
            vec![bench_gk],
            vec![],
            false,
        );
        let forward = &state.home.players[9];
        assert_eq!(
            [
                forward.long_passing,
                forward.crossing,
                forward.curve,
                forward.free_kick,
                forward.long_shots,
                forward.first_touch,
                forward.heading,
            ],
            [64, 65, 69, 63, 68, 70, 66]
        );
        assert_eq!(state.home.players[10].heading, 55);
        assert_eq!(state.home_bench[0].long_passing, 77);
        assert_eq!(state.home_bench[0].heading, 23);
    }

    /// The first goal of any match must be classified as `Opener` because both
    /// scores are 0 at that point.
    #[test]
    fn first_goal_detail_is_opener() {
        // Try multiple seeds and validate the invariant whenever a goal appears.
        let mut saw_any_goal = false;
        for seed in 0u64..500 {
            let mut state = LiveMatchState::new(
                make_team("home"),
                make_team("away"),
                MatchConfig::default(),
                vec![],
                vec![],
                false,
            );
            let mut rng = StdRng::seed_from_u64(seed);

            // Step minute-by-minute until finished or the first scoring event
            // appears. A `PenaltyGoal` can score before any open-play `Goal` and
            // updates the score, so the first open-play goal is only guaranteed
            // to be an `Opener` when nothing scored before it.
            let first_scoring = loop {
                let result = state.step_minute(&mut rng);
                let scoring = result
                    .events
                    .iter()
                    .find(|e| matches!(e.event_type, EventType::Goal | EventType::PenaltyGoal))
                    .cloned();
                if let Some(evt) = scoring {
                    break Some(evt);
                }
                if result.is_finished {
                    break None;
                }
            };

            if let Some(first_evt) = first_scoring
                && first_evt.event_type == EventType::Goal
            {
                assert_eq!(
                    first_evt.detail,
                    Some(EventDetail::Goal {
                        context: GoalContext::Opener
                    }),
                    "seed {seed}: first goal detail should be Opener, got {:?}",
                    first_evt.detail
                );
                saw_any_goal = true;
            }
            // No goal scored in this seed — try the next one.
        }
        assert!(
            saw_any_goal,
            "No goal was scored in 500 seeds; increase seed range or check engine config"
        );
    }
}

#[cfg(test)]
mod card_tests {
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    use crate::event::EventType;
    use crate::live_match::LiveMatchState;
    use crate::live_match::test_support::make_team;
    use crate::types::{MatchConfig, Side, Zone};

    /// Fouls by one defender, every one of which would be a yellow card, and
    /// the cards they bring with the booked man's caution at `factor`.
    fn cards(factor: f64) -> Vec<EventType> {
        let mut config = MatchConfig {
            yellow_card_probability: 1.0,
            red_card_probability: 0.0,
            ..MatchConfig::default()
        };
        config.knobs.booked_card_factor = factor;
        let mut state = LiveMatchState::new(
            make_team("home"),
            make_team("away"),
            config,
            vec![],
            vec![],
            false,
        );
        let fouler = state.away.players[2].id.clone();
        let mut rng = StdRng::seed_from_u64(7);
        (0..20)
            .flat_map(|minute| {
                state.maybe_card(minute, Side::Away, &fouler, Zone::Midfield, &mut rng)
            })
            .map(|event| event.event_type)
            .collect()
    }

    /// Given a defender who fouls again and again,
    /// when a booked man's caution is 1 (as before GĐ5 P5.7) and then 0,
    /// then the first time his second foul sends him off, and the second time
    /// he is booked once and stays on: the factor scales a booked player's
    /// chance of another card.
    #[test]
    fn a_booked_player_is_carded_less_often() {
        let reckless = cards(1.0);
        assert_eq!(reckless.first(), Some(&EventType::YellowCard));
        assert!(reckless.contains(&EventType::SecondYellow));
        assert_eq!(cards(0.0), vec![EventType::YellowCard]);
    }
}

#[cfg(test)]
mod build_up_tests {
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    use crate::event::{EventType, TacticalContext};
    use crate::live_match::LiveMatchState;
    use crate::live_match::test_support::make_team;
    use crate::types::{
        CounterPressDuration, DefensiveLine, MatchConfig, PressingIntensity, Side, Zone,
    };

    fn state(away_line: DefensiveLine, away_counter_press: CounterPressDuration) -> LiveMatchState {
        let mut away = make_team("away");
        away.tactics.defensive_line = away_line;
        away.tactics.counter_press_duration = away_counter_press;
        LiveMatchState::new(
            make_team("home"),
            away,
            MatchConfig::default(),
            Vec::new(),
            Vec::new(),
            false,
        )
    }

    /// The share of 4,000 home build-ups that reach midfield against an away
    /// side with `line` and `counter_press`, the counter-press felt or not.
    fn success(
        line: DefensiveLine,
        counter_press: CounterPressDuration,
        counter_pressed: bool,
    ) -> f64 {
        let mut rng = StdRng::seed_from_u64(11);
        let mut made = 0;
        for _ in 0..4_000 {
            let mut s = state(line, counter_press);
            s.possession = Side::Home;
            s.ball_zone = Zone::defensive_third(Side::Home);
            s.resolve_buildup(1, Side::Home, Side::Away, counter_pressed, &mut rng);
            // Reaching midfield with the ball: a ball lost can end there too
            // since GĐ5 P5.2.
            if s.ball_zone == Zone::Midfield && s.possession == Side::Home {
                made += 1;
            }
        }
        f64::from(made) / 4_000.0
    }

    /// Given an away side whose line sits very low, and one whose line is high,
    /// when the home side plays out against each,
    /// then it gets through the low block's press more often (X68).
    #[test]
    fn a_deep_line_presses_less() {
        let none = CounterPressDuration::None;
        let deep = success(DefensiveLine::VeryLow, none, false);
        let high = success(DefensiveLine::High, none, false);
        assert!(deep > high + 0.04, "{deep:.3} vs {high:.3}");
    }

    /// Given an away side that has just lost the ball and counter-presses long,
    /// when the home side plays its first build-up,
    /// then it gets through less often than against no counter-press, and the
    /// counter-press weighs nothing on a build-up it is not pressing.
    #[test]
    fn a_counter_press_makes_the_first_build_up_harder() {
        let medium = DefensiveLine::Medium;
        let long = success(medium, CounterPressDuration::Long, true);
        let none = success(medium, CounterPressDuration::None, true);
        let not_pressed = success(medium, CounterPressDuration::Long, false);
        assert!(long < none - 0.012, "{long:.3} vs {none:.3}");
        assert!(
            (not_pressed - none).abs() < 0.03,
            "{not_pressed:.3} vs {none:.3}"
        );
    }

    /// Where the ball is, and whether it is labelled, after `n` home build-ups
    /// lost to an away side pressing at `intensity`, with `p_high_turnover`:
    /// (lost, kept high, every one in midfield untagged).
    fn lost_build_ups(
        intensity: PressingIntensity,
        p_high_turnover: f64,
        n: usize,
    ) -> (usize, usize, bool) {
        let mut rng = StdRng::seed_from_u64(17);
        let (mut lost, mut high, mut midfield_untagged) = (0, 0, true);
        for _ in 0..n {
            let mut s = state(DefensiveLine::Medium, CounterPressDuration::None);
            s.team_mut(Side::Away).tactics.pressing_intensity = intensity;
            s.config.knobs.p_high_turnover = p_high_turnover;
            s.possession = Side::Home;
            s.ball_zone = Zone::defensive_third(Side::Home);
            // Short build-ups only: a long ball is P4.2's, not a turnover.
            s.team_mut(Side::Home).tactics.build_up_style =
                crate::types::TacticsBuildUpStyle::Short;
            let events = s.resolve_buildup(1, Side::Home, Side::Away, false, &mut rng);
            if s.possession != Side::Away {
                continue;
            }
            lost += 1;
            if s.ball_zone == Zone::defensive_third(Side::Home) {
                high += 1;
            } else {
                midfield_untagged &= s.ball_zone == Zone::Midfield
                    && s.pending_context.is_none()
                    && events.iter().all(|e| e.tactical_context.is_none());
            }
        }
        (lost, high, midfield_untagged)
    }

    /// Given home build-ups lost with no ball allowed to stay high,
    /// when the away side wins them,
    /// then each is the away side's in midfield, with no `HighTurnover` label
    /// (GĐ5 P5.2, X84).
    #[test]
    fn a_ball_won_in_the_build_up_that_does_not_stay_high_is_played_in_midfield() {
        let (lost, high, midfield_untagged) = lost_build_ups(PressingIntensity::Medium, 0.0, 2_000);
        assert!(lost > 100, "{lost}");
        assert_eq!(high, 0);
        assert!(midfield_untagged);
    }

    /// Given home build-ups lost to an aggressive press and to a passive one,
    /// with the same share of balls allowed to stay high,
    /// when the away side wins them,
    /// then the aggressive press keeps more of them in the home third.
    #[test]
    fn a_harder_press_keeps_more_of_the_balls_it_wins_high() {
        let (lost_hard, high_hard, _) = lost_build_ups(PressingIntensity::Aggressive, 0.4, 8_000);
        let (lost_soft, high_soft, _) = lost_build_ups(PressingIntensity::Passive, 0.4, 8_000);
        let hard = high_hard as f64 / lost_hard as f64;
        let soft = high_soft as f64 / lost_soft as f64;
        assert!(hard > soft + 0.1, "{hard:.3} vs {soft:.3}");
    }

    /// Given a home build-up intercepted,
    /// when the away side then plays its next action in its attacking third,
    /// then the pass, the interception and every event of that action carry
    /// `HighTurnover` (X67).
    #[test]
    fn a_ball_won_in_the_build_up_is_a_high_turnover() {
        let mut rng = StdRng::seed_from_u64(3);
        for _ in 0..200 {
            let mut s = state(DefensiveLine::High, CounterPressDuration::None);
            // Every ball won stays high (GĐ5 P5.2): the old behaviour, so the
            // labelling can be tested on its own.
            s.config.knobs.p_high_turnover = 1.0;
            s.possession = Side::Home;
            s.ball_zone = Zone::defensive_third(Side::Home);
            let lost = s.resolve_action(1, &mut rng);
            if s.possession != Side::Away {
                continue;
            }
            assert!(lost.iter().all(|e| matches!(
                e.event_type,
                EventType::PassIntercepted | EventType::Interception
            ) && e.tactical_context
                == Some(TacticalContext::HighTurnover)));
            let next = s.resolve_action(1, &mut rng);
            assert!(!next.is_empty());
            assert!(
                next.iter().all(|e| e.tactical_context.is_some()),
                "{next:?}"
            );
            assert!(
                next.iter()
                    .any(|e| e.tactical_context == Some(TacticalContext::HighTurnover))
            );
            return;
        }
        panic!("no build-up was lost in 200 tries");
    }
}
