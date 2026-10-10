use crate::event::{EventType, MatchEvent};
use crate::types::{PlayerData, PlayerRole, Position, Side, Zone};

use super::{LiveMatchState, SubstitutionRecord, is_role_valid_for_position};

// ---------------------------------------------------------------------------
// Substitution mechanics
// ---------------------------------------------------------------------------

impl LiveMatchState {
    pub(super) fn do_substitution(
        &mut self,
        side: Side,
        player_off_id: &str,
        player_on_id: &str,
    ) -> Result<(), String> {
        let subs_made = match side {
            Side::Home => &mut self.home_subs_made,
            Side::Away => &mut self.away_subs_made,
        };

        if *subs_made >= self.max_subs {
            return Err("be.error.liveMatch.maxSubstitutionsReached".into());
        }

        // Cannot substitute a player who has been sent off
        if self.sent_off.contains(player_off_id) {
            return Err("be.error.liveMatch.cannotSubstituteSentOffPlayer".into());
        }

        let team = self.team_mut(side);
        let off_idx = team
            .players
            .iter()
            .position(|p| p.id == player_off_id)
            .ok_or("be.error.liveMatch.playerNotOnPitch")?;

        // Cannot bring on a player who was already substituted off
        let already_subbed_off: std::collections::HashSet<&str> = self
            .substitutions
            .iter()
            .map(|s| s.player_off_id.as_str())
            .collect();
        if already_subbed_off.contains(player_on_id) {
            return Err("be.error.liveMatch.playerAlreadySubstitutedOff".into());
        }

        // Asked before either list is disturbed, and before the bench is
        // borrowed to take the incoming player off it.
        let nobody_in_goal = self.keeper_on_the_pitch(side).is_none();

        let bench = match side {
            Side::Home => &mut self.home_bench,
            Side::Away => &mut self.away_bench,
        };
        let on_idx = bench
            .iter()
            .position(|p| p.id == player_on_id)
            .ok_or("be.error.liveMatch.playerNotOnBench")?;

        let goes_in_goal = nobody_in_goal && bench[on_idx].position == Position::Goalkeeper;

        let mut player_on = bench.remove(on_idx);
        let player_off = self.team_mut(side).players.remove(off_idx);

        // The XI is slot-aligned (entry i plays formation slot i), so the sub
        // takes over the vacated slot: same index, and the slot's position —
        // players are simulated where they actually play, not where they'd
        // naturally play.
        //
        // Except in goal. A side whose keeper has been sent off makes an
        // outfield player way for a substitute keeper, and inheriting that
        // player's slot would make him a defender: `pick_goalkeeper` looks for
        // `Position::Goalkeeper` and would never find him, so the change would
        // cost a substitution and put nobody in goal. This is the same code
        // path the player's own substitutions take, so it fixes the same
        // change made by hand from the touchline.
        if !goes_in_goal {
            player_on.position = player_off.position;
        }

        // Initialize condition for incoming player
        self.player_conditions
            .insert(player_on.id.clone(), player_on.condition as f64);

        self.team_mut(side).players.insert(off_idx, player_on);

        // A substitute keeper belongs in the goalkeeper's slot. Left in the
        // outfield slot he came on for, the pitch would draw him there and the
        // sent-off keeper in goal, and the line he came off from would look
        // whole when it is the one a man short. Trading with the sent-off keeper
        // puts each where he is.
        if goes_in_goal
            && let Some(sent_off_keeper) =
                self.team_ref(side).players.iter().position(|p| {
                    p.position == Position::Goalkeeper && self.sent_off.contains(&p.id)
                })
            && sent_off_keeper != off_idx
        {
            let team = self.team_mut(side);
            team.players.swap(off_idx, sent_off_keeper);
            team.players[off_idx].position = player_off.position;
            team.players[sent_off_keeper].position = Position::Goalkeeper;
        }

        // Move subbed-off player to bench (they can't come back, but we keep them)
        match side {
            Side::Home => self.home_bench.push(player_off),
            Side::Away => self.away_bench.push(player_off),
        }

        *match side {
            Side::Home => &mut self.home_subs_made,
            Side::Away => &mut self.away_subs_made,
        } += 1;

        // Record the substitution
        let evt = MatchEvent::new(
            self.current_minute,
            EventType::Substitution,
            side,
            Zone::Midfield,
        )
        .with_player(player_on_id)
        .with_secondary(player_off_id);
        self.events.push(evt);

        self.substitutions.push(SubstitutionRecord {
            minute: self.current_minute,
            side,
            player_off_id: player_off_id.to_string(),
            player_on_id: player_on_id.to_string(),
        });

        Ok(())
    }

    /// Pre-match swap: exchange a starting player with a bench player without
    /// counting as a substitution. Only valid during PreKickOff phase.
    pub(super) fn do_pre_match_swap(
        &mut self,
        side: Side,
        player_off_id: &str,
        player_on_id: &str,
    ) -> Result<(), String> {
        let team = self.team_mut(side);
        let off_idx = team
            .players
            .iter()
            .position(|p| p.id == player_off_id)
            .ok_or("be.error.liveMatch.playerNotInStartingXi")?;

        let bench = match side {
            Side::Home => &mut self.home_bench,
            Side::Away => &mut self.away_bench,
        };
        let on_idx = bench
            .iter()
            .position(|p| p.id == player_on_id)
            .ok_or("be.error.liveMatch.playerNotOnBench")?;

        let mut player_on = bench.remove(on_idx);
        let player_off = self.team_mut(side).players.remove(off_idx);

        // The XI is slot-aligned (entry i plays formation slot i). Removing the
        // outgoing player and pushing the incoming one to the END shifted every
        // later starter into a different slot and dropped the newcomer into the
        // last one — the lineup visibly "reorganized" after a swap. Keep the
        // vacated index and adopt the slot's position instead.
        player_on.position = player_off.position;

        // Initialize condition for incoming player
        self.player_conditions
            .insert(player_on.id.clone(), player_on.condition as f64);

        self.team_mut(side).players.insert(off_idx, player_on);

        // Move swapped-out player to bench
        match side {
            Side::Home => self.home_bench.push(player_off),
            Side::Away => self.away_bench.push(player_off),
        }

        Ok(())
    }

    /// Two players in the XI trade formation slots: the pre-match swap before
    /// kick-off, `MatchCommand::SwapPositions` at any time. Either may be a
    /// sent-off player, who stays sent off in his new slot.
    ///
    /// The XI is slot-aligned, so trading slots is trading indices. The slot
    /// keeps its position, as in [`Self::do_pre_match_swap`], and a role the
    /// new position does not admit falls back to `Standard` — the caller picks
    /// a better one if it can.
    pub(super) fn swap_slots(
        &mut self,
        side: Side,
        player_a_id: &str,
        player_b_id: &str,
    ) -> Result<(), String> {
        let team = self.team_mut(side);
        let a_idx = team
            .players
            .iter()
            .position(|p| p.id == player_a_id)
            .ok_or("be.error.liveMatch.playerNotInStartingXi")?;
        let b_idx = team
            .players
            .iter()
            .position(|p| p.id == player_b_id)
            .ok_or("be.error.liveMatch.playerNotInStartingXi")?;
        if a_idx == b_idx {
            return Ok(());
        }

        let a_slot_position = team.players[a_idx].position;
        let b_slot_position = team.players[b_idx].position;
        team.players.swap(a_idx, b_idx);
        team.players[a_idx].position = a_slot_position;
        team.players[b_idx].position = b_slot_position;

        for idx in [a_idx, b_idx] {
            let player = &mut team.players[idx];
            if !is_role_valid_for_position(player.role, player.position) {
                player.role = PlayerRole::Standard;
            }
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Formation mechanics
    // -----------------------------------------------------------------------

    /// Parse a formation string like "4-4-2" into (defenders, midfielders, forwards).
    pub(super) fn parse_formation(formation: &str) -> (usize, usize, usize) {
        let parts: Vec<usize> = formation
            .split('-')
            .filter_map(|s| s.parse().ok())
            .collect();
        match parts.len() {
            3 => (parts[0], parts[1], parts[2]),
            4 => (parts[0], parts[1] + parts[2], parts[3]), // e.g. 4-2-3-1
            _ => (4, 4, 2),                                 // fallback
        }
    }

    /// Apply a formation change: set the formation string and lay the XI out in
    /// its slots, keeping the XI slot-aligned (entry i plays slot i: the keeper,
    /// then the back line, the midfield and the front line, as the pitch draws
    /// them).
    ///
    /// - The goalkeeper on the pitch takes slot 0.
    /// - A sent-off player keeps his slot: he is still on the teamsheet, and the
    ///   manager moves the gap with [`Self::swap_slots`] if he wants it elsewhere.
    ///   A sent-off keeper whose slot the keeper on the pitch needs takes that
    ///   keeper's old slot instead.
    /// - Everyone else still playing fills the remaining slots, most defensive
    ///   first (defending + tackling + strength), from the back line forward.
    ///
    /// Each slot gives its occupant its position; a role the new position does
    /// not admit falls back to `Standard`.
    pub(super) fn apply_formation(&mut self, side: Side, formation: &str) {
        let (num_def, num_mid, _) = Self::parse_formation(formation);
        let sent_off = self.sent_off.clone();
        let team = self.team_mut(side);
        team.formation = formation.to_string();

        let players = std::mem::take(&mut team.players);
        let is_off = |player: &PlayerData| sent_off.contains(&player.id);
        let keeper_idx = players
            .iter()
            .position(|p| p.position == Position::Goalkeeper && !is_off(p));

        let mut slots: Vec<Option<PlayerData>> = vec![None; players.len()];
        let mut outfield = Vec::new();
        for (idx, player) in players.into_iter().enumerate() {
            if Some(idx) == keeper_idx {
                slots[0] = Some(player);
            } else if is_off(&player) {
                let target = match keeper_idx {
                    Some(keeper) if idx == 0 => keeper,
                    _ => idx,
                };
                slots[target] = Some(player);
            } else if keeper_idx.is_none() && idx == 0 {
                // Nobody in goal: whoever stands in slot 0 stays there.
                slots[0] = Some(player);
            } else {
                outfield.push(player);
            }
        }

        outfield.sort_by_key(|p| {
            std::cmp::Reverse(
                u16::from(p.defending) + u16::from(p.tackling) + u16::from(p.strength),
            )
        });
        let mut outfield = outfield.into_iter();
        for slot in slots.iter_mut().skip(1) {
            if slot.is_none() {
                *slot = outfield.next();
            }
        }

        team.players = slots.into_iter().flatten().collect();
        for (idx, player) in team.players.iter_mut().enumerate().skip(1) {
            player.position = if idx <= num_def {
                Position::Defender
            } else if idx <= num_def + num_mid {
                Position::Midfielder
            } else {
                Position::Forward
            };
            if !is_role_valid_for_position(player.role, player.position) {
                player.role = PlayerRole::Standard;
            }
        }
    }
}
