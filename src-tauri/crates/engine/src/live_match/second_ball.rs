//! The second ball (phase 2, GĐ4, P4.2; GĐ4-tech-spec §6.4, decision X71): a
//! long ball nobody controlled drops loose, and one man of each side goes for
//! it. Whoever wins it has the ball where it fell.

use rand::{Rng, RngExt};

use crate::duel;
use crate::event::{EventType, MatchEvent, TacticalContext};
use crate::shared::{PlayStylePhase, play_style_modifier};
use crate::types::{Position, Side};

use super::LiveMatchState;
use super::presence::Column;

impl LiveMatchState {
    /// A loose ball where the ball is now, after `kicker`'s long ball: one man
    /// of each side, drawn by presence in midfield at the ball's lane. The
    /// winner has the ball there — in midfield, or, in `kicker`'s attacking
    /// third, as an attack or as the other side's build-up.
    pub(super) fn resolve_second_ball<R: Rng>(
        &mut self,
        minute: u8,
        kicker: Side,
        rng: &mut R,
    ) -> Vec<MatchEvent> {
        let other = kicker.opposite();
        let zone = self.ball_zone;
        let ours = self
            .pick_by_presence(kicker, Column::MidfieldAttack, self.lane_for(kicker), rng)
            .map(|picked| picked.player)
            .unwrap_or_else(|| self.snap_player(kicker, Position::Midfielder, rng));
        let theirs = self
            .pick_by_presence(other, Column::MidfieldDefence, self.lane_for(other), rng)
            .map(|picked| picked.player)
            .unwrap_or_else(|| self.snap_player(other, Position::Midfielder, rng));
        let ratio = (self.condition_adjusted_skill(&ours.id, 1.0)
            * play_style_modifier(self.team_ref(kicker), PlayStylePhase::Midfield))
            / (self.condition_adjusted_skill(&theirs.id, 1.0)
                * play_style_modifier(self.team_ref(other), PlayStylePhase::Midfield));
        let kicker_wins = rng.random_range(0.0..1.0f64)
            < duel::second_ball_win_probability(&ours, &theirs, ratio);
        let (side, winner, loser) = if kicker_wins {
            (kicker, &ours, &theirs)
        } else {
            (other, &theirs, &ours)
        };
        let mut events = Vec::new();
        let recovery = MatchEvent::new(minute, EventType::BallRecovery, side, zone)
            .with_player(&winner.id)
            .with_secondary(&loser.id)
            .with_tactical_context(TacticalContext::SecondBall);
        self.emit(&mut events, recovery);
        self.possession = side;
        events
    }
}
