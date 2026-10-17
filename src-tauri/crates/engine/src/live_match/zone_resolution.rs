use rand::{Rng, RngExt};

use crate::duel;
use crate::event::{EventDetail, EventType, MatchEvent, SetPiece, ShotKind};
use crate::shared::{
    PlayStylePhase, PlayerSnap, TraitContext, play_style_modifier, role_attribute_modifier,
    tactics_buildup_mod, tactics_cross_probability, tactics_defensive_conversion_mod,
    tactics_foul_modifier, tactics_shape_modifier, tactics_tempo_progression,
    tactics_width_versus_shape, trait_bonus,
};
use crate::types::{Position, Side, Zone};

use super::LiveMatchState;
use super::helpers::{danger_band, foul_severity, save_quality};
use super::set_pieces::DIRECT_FREE_KICK_SHARE;

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

pub(super) fn scale_odds(probability: f64, ratio: f64) -> f64 {
    let scaled = probability * ratio;
    scaled / (scaled + (1.0 - probability))
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

        let events = if zone.is_box_for(att_side) {
            // The box is one cell: whatever lane the ball came in from, it is
            // now in the middle of it (GĐ3-tech-spec §7.1).
            if self.plays_grid15() {
                self.centre_the_ball();
            }
            self.resolve_shot(minute, att_side, rng)
        } else if zone == Zone::attacking_third(att_side) {
            self.resolve_attacking_third(minute, att_side, def_side, rng)
        } else if zone == Zone::Midfield {
            self.resolve_midfield(minute, att_side, def_side, rng)
        } else {
            self.resolve_buildup(minute, att_side, def_side, rng)
        };
        self.active_break = false;
        events
    }

    fn resolve_buildup<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let passer = self.snap_player(att_side, Position::Defender, rng);
        let pass_skill = self.condition_adjusted_skill(
            &passer.id,
            (passer.passing as f64
                + passer.vision as f64
                + passer.composure as f64
                + passer.teamwork as f64)
                / 4.0,
        ) * trait_bonus(&passer, TraitContext::Passing)
            * self.line_strength(att_side, Position::Defender);
        // The press comes from the midfield: a midfield a man short presses less.
        let press =
            self.effective_press(def_side) * self.line_strength(def_side, Position::Midfielder);
        let ball_zone = self.ball_zone;

        let buildup_mod = tactics_buildup_mod(&self.team_ref(att_side).tactics);
        let success_chance =
            (pass_skill * 1.3 * buildup_mod) / (pass_skill * 1.3 * buildup_mod + press);
        if rng.random_range(0.0..1.0f64) < success_chance {
            let evt = MatchEvent::new(minute, EventType::PassCompleted, att_side, ball_zone)
                .with_player(&passer.id);
            self.emit(&mut events, evt);
            self.ball_zone = Zone::Midfield;
            self.advance_lane(att_side, &passer, rng);
        } else {
            let interceptor = self.snap_player(def_side, Position::Midfielder, rng);
            let evt1 = MatchEvent::new(minute, EventType::PassIntercepted, att_side, ball_zone)
                .with_player(&passer.id);
            let evt2 = MatchEvent::new(minute, EventType::Interception, def_side, ball_zone)
                .with_player(&interceptor.id);
            self.emit(&mut events, evt1);
            self.emit(&mut events, evt2);
            self.possession = def_side;
        }
        events
    }

    fn resolve_midfield<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let attacker = self.snap_player(att_side, Position::Midfielder, rng);
        let defender = self.snap_player(def_side, Position::Midfielder, rng);

        // The players' ratings live in `duel`; what is left here is every
        // modifier the duel always had, applied exactly as strongly.
        let att_rating = self.condition_adjusted_skill(&attacker.id, 1.0)
            * trait_bonus(&attacker, TraitContext::Midfield);
        let def_rating = self.condition_adjusted_skill(&defender.id, 1.0)
            * trait_bonus(&defender, TraitContext::Tackling);

        let att_mod = play_style_modifier(self.team_ref(att_side), PlayStylePhase::Midfield)
            * role_attribute_modifier(attacker.role, PlayStylePhase::Midfield);
        let def_mod = play_style_modifier(self.team_ref(def_side), PlayStylePhase::Midfield)
            * role_attribute_modifier(defender.role, PlayStylePhase::Defense);
        let att_eff = att_rating
            * att_mod
            * crate::shared::home_mod(att_side, &self.config)
            * tactics_tempo_progression(&self.team_ref(att_side).tactics)
            * self.line_strength(att_side, Position::Midfielder);
        let def_eff = def_rating
            * def_mod
            * crate::shared::home_mod(def_side, &self.config)
            * self.line_strength(def_side, Position::Midfielder);
        let success = duel::midfield_win_probability(&attacker, &defender, att_eff / def_eff);

        if rng.random_range(0.0..1.0f64) < success {
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

    fn resolve_attacking_third<R: Rng>(
        &mut self,
        minute: u8,
        att_side: Side,
        def_side: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let mut events = Vec::new();
        let attacker = self.snap_player(att_side, Position::Forward, rng);
        let defender = self.snap_player(def_side, Position::Defender, rng);
        // A shot from distance takes the place of the one-on-one, never adds
        // to it (phase 2, P2.5).
        if let Some(long_shot) = self.try_long_shot(minute, att_side, &attacker, rng) {
            return long_shot;
        }

        // As in midfield: ratings in `duel`, every existing modifier here.
        let att_rating = self.condition_adjusted_skill(&attacker.id, 1.0)
            * trait_bonus(&attacker, TraitContext::Dribbling);
        let def_rating = self.condition_adjusted_skill(&defender.id, 1.0)
            * trait_bonus(&defender, TraitContext::Tackling);

        let att_mod = play_style_modifier(self.team_ref(att_side), PlayStylePhase::Attack)
            * role_attribute_modifier(attacker.role, PlayStylePhase::Attack);
        let def_mod = play_style_modifier(self.team_ref(def_side), PlayStylePhase::Defense)
            * role_attribute_modifier(defender.role, PlayStylePhase::Defense);
        let att_eff = att_rating
            * att_mod
            * crate::shared::home_mod(att_side, &self.config)
            * self.line_strength(att_side, Position::Forward);
        let def_eff = def_rating
            * def_mod
            * crate::shared::home_mod(def_side, &self.config)
            * self.line_strength(def_side, Position::Defender)
            * self.centre_back_pair_factor(def_side, self.active_break)
            * tactics_shape_modifier(&self.team_ref(def_side).tactics)
            * tactics_width_versus_shape(
                &self.team_ref(att_side).tactics,
                &self.team_ref(def_side).tactics,
            );
        let success = duel::one_v_one_win_probability(&attacker, &defender, att_eff / def_eff);
        let zone = Zone::attacking_third(att_side);
        let cross_prob = tactics_cross_probability(&self.team_ref(att_side).tactics);

        if rng.random_range(0.0..1.0f64) < success {
            let evt = MatchEvent::new(minute, EventType::Dribble, att_side, zone)
                .with_player(&attacker.id);
            self.emit(&mut events, evt);
            // Through on the break: a sweeper keeper comes for it first.
            if self.active_break
                && let Some(sweeper_events) =
                    self.try_sweeper_keeper(minute, att_side, &attacker, rng)
            {
                events.extend(sweeper_events);
                return events;
            }
            if rng.random_range(0.0..1.0f64) < cross_prob {
                let winger_id = attacker.id.clone();
                // Pick who the cross is aimed at before announcing it, so the
                // event can name him. Emitting draws nothing from `rng`, so the
                // draws happen in the same order as ever and no result changes.
                let header = self.snap_header_target(att_side, &winger_id, rng);
                let def_header = self.snap_player(def_side, Position::Defender, rng);
                let cross_evt = MatchEvent::new(minute, EventType::Cross, att_side, zone)
                    .with_player(&winger_id)
                    .with_secondary(&header.id);
                self.emit(&mut events, cross_evt);
                let aerial_win = scale_odds(
                    duel::aerial_win_probability(&header, &def_header),
                    (self.line_strength(att_side, Position::Forward)
                        * self.slot_effectiveness(&header.id))
                        / (self.line_strength(def_side, Position::Defender)
                            * self.slot_effectiveness(&def_header.id)),
                );
                if rng.random_range(0.0..1.0f64) < aerial_win {
                    self.ball_zone = Zone::attacking_box(att_side);
                    // He won the ball in the air, so the header is his; the
                    // cross is the assist.
                    let header_events =
                        self.resolve_header(minute, att_side, header, winger_id, rng);
                    events.extend(header_events);
                } else {
                    let clear_evt = MatchEvent::new(minute, EventType::Clearance, def_side, zone)
                        .with_player(&def_header.id);
                    self.emit(&mut events, clear_evt);
                    self.possession = def_side;
                    self.ball_zone = Zone::defensive_third(att_side);
                    self.advance_lane(def_side, &def_header, rng);
                }
            } else {
                self.ball_zone = Zone::attacking_box(att_side);
                // Through on goal on the break: the shot that follows is
                // still part of it.
                if self.active_break {
                    self.on_the_break = Some(att_side);
                }
            }
        } else {
            let is_tackle = rng.random_range(0.0..1.0f64) < 0.5;
            let fouled = if is_tackle {
                let evt1 = MatchEvent::new(minute, EventType::DribbleTackled, att_side, zone)
                    .with_player(&attacker.id)
                    .with_secondary(&defender.id);
                let evt2 = MatchEvent::new(minute, EventType::Tackle, def_side, zone)
                    .with_player(&defender.id);
                self.emit(&mut events, evt1);
                self.emit(&mut events, evt2);
                let foul_mod = tactics_foul_modifier(&self.team_ref(def_side).tactics);
                let foul_events =
                    self.maybe_foul(minute, def_side, &attacker, &defender, zone, rng, foul_mod);
                let was_fouled = foul_events.iter().any(|e| e.event_type == EventType::Foul);
                events.extend(foul_events);
                was_fouled
            } else {
                let evt = MatchEvent::new(minute, EventType::Clearance, def_side, zone)
                    .with_player(&defender.id);
                self.emit(&mut events, evt);
                false
            };
            if fouled {
                // The fouled side keeps the ball for the free kick in its
                // attacking third, and now and then shoots straight from it.
                self.possession = att_side;
                self.ball_zone = zone;
                if rng.random_range(0.0..1.0f64) < DIRECT_FREE_KICK_SHARE {
                    let free_kick_events = self.resolve_direct_free_kick(minute, att_side, rng);
                    events.extend(free_kick_events);
                }
                return events;
            }
            if rng.random_range(0.0..1.0f64) < 0.25 {
                let corner_events = self.resolve_corner(minute, att_side, rng);
                events.extend(corner_events);
                return events;
            }
            self.possession = def_side;
            self.ball_zone = Zone::defensive_third(att_side);
            self.advance_lane(def_side, &defender, rng);
        }
        events
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

        let kind = ShotKind::Open;
        let shooter = self.snap_player(att_side, Position::Forward, rng);
        let assister_id = self.snap_player(att_side, Position::Midfielder, rng).id;
        let goalkeeper = self.snap_player(def_side, Position::Goalkeeper, rng);

        let shoot_raw =
            (shooter.shooting as f64 + shooter.composure as f64 + shooter.decisions as f64) / 3.0;
        let shoot_rating = self.condition_adjusted_skill(&shooter.id, shoot_raw)
            * trait_bonus(&shooter, TraitContext::Shooting);
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
                self.emit(&mut events, evt);
                self.ball_zone = Zone::Midfield;
                self.possession = def_side;
            } else {
                let evt = MatchEvent::new(minute, EventType::ShotOffTarget, att_side, zone)
                    .with_shot_kind(kind)
                    .with_player(&shooter.id)
                    .with_detail(detail);
                self.emit(&mut events, evt);
                let gk_evt = MatchEvent::new(minute, EventType::GoalKick, def_side, zone);
                self.emit(&mut events, gk_evt);
                self.ball_zone = Zone::defensive_third(def_side);
                self.possession = def_side;
            }
            return events;
        }

        let def_line_mod = tactics_defensive_conversion_mod(&self.team_ref(def_side).tactics);
        let conversion = (self.config.goal_conversion_base * def_line_mod
            + (shoot_rating - gk_rating) / 150.0)
            .clamp(0.10, 0.70);

        if rng.random_range(0.0..1.0f64) < conversion {
            let context = self.goal_context(att_side);
            let evt = MatchEvent::new(minute, EventType::Goal, att_side, zone)
                .with_shot_kind(kind)
                .with_player(&shooter.id)
                .with_secondary(&assister_id)
                .with_detail(EventDetail::Goal { context });
            self.emit(&mut events, evt);
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
            self.emit(&mut events, evt);
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
        let card_chance = self.config.yellow_card_probability * (0.5 + aggression_factor);
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
