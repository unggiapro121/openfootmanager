// Squad selection and the domain → engine conversion live in `turn::squad`,
// which is where the crate's boundary rule puts them: `engine` has no knowledge
// of `domain`, and `ofm_core/turn/` is the single bridge between the two. The
// watched and unwatched paths both build their sides from there, so there is
// one answer to "who is playing" rather than one per code path.
pub use crate::turn::squad::auto_select_set_pieces;
use crate::turn::squad::build_team_with_bench;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::game::Game;
use crate::match_session::{
    Controller, InputSource, MatchSeed, MatchSession, MatchSetup, StepRecord, taker_commands,
};

use domain::league::{FixtureStatus, StandingEntry};
use domain::manager::Manager;
use engine::ai::{AiPersonality, AiProfile};
use engine::{
    MatchCommand, MatchConfig, MatchPhase, MatchReport, MatchSnapshot, MinuteResult,
    SetPieceTakers, Side, TeamData,
};
use ofm_rules::squad::kickoff_set_pieces;

const LIVE_MATCH_NO_LEAGUE_ERROR: &str = "be.error.liveMatch.noLeague";

/// Upper bound on minutes a single match can run: 120 of extra time plus generous stoppage.
/// Used only to keep a caller-supplied step count from over-reserving.
const MAX_MATCH_MINUTES: usize = 140;

/// Phases a fast-forward has to stop at, because the manager is owed a decision:
/// a team talk at either interval, or the shootout order before penalties.
fn phase_needs_manager(phase: MatchPhase) -> bool {
    matches!(
        phase,
        MatchPhase::HalfTime | MatchPhase::ExtraTimeHalfTime | MatchPhase::PenaltyShootout
    )
}
/// Shared with [`crate::matchday`], which refuses a competition index that names no competition
/// rather than quietly playing the fixture out of whatever the legacy mirror holds. One key, so
/// the two refusals cannot drift into saying different things about the same failure.
pub(crate) const LIVE_MATCH_FIXTURE_NOT_FOUND_ERROR: &str = "be.error.liveMatch.fixtureNotFound";
const LIVE_MATCH_FIXTURE_NOT_SCHEDULED_ERROR: &str = "be.error.liveMatch.fixtureNotScheduled";
/// A side with nobody available cannot play. Refused here rather than handed to
/// the engine, which has no way to resolve a pass, a shot or a goalkeeper.
const LIVE_MATCH_EMPTY_SQUAD_ERROR: &str = "be.error.liveMatch.emptySquad";

/// The match config `game`'s matches play: the one a real-world probe set on it (phase 2, GĐ5
/// P5.0, X82: calibration knobs from `OFM_KNOBS`), else the game's default. It belongs to the
/// game, not to the process, so a server running many matches never shares one (phase 3, E3-1).
fn match_config_of(game: &Game) -> MatchConfig {
    game.match_config_override.clone().unwrap_or_default()
}

/// Order the duties `takers` names for `side` at kick-off, as system inputs: the desktop's saved
/// match roles ([`ofm_rules::squad::kickoff_set_pieces`]).
fn order_kickoff_takers(session: &mut MatchSession, side: Side, takers: SetPieceTakers) {
    for command in taker_commands(side, takers) {
        // Every name here is a starter, so the check takes it; one it refused would leave the
        // duty to the engine's own choice, as an unset one always has.
        if let Err(_refused) = session.command(side, InputSource::System, command) {}
    }
}

// ---------------------------------------------------------------------------
// MatchMode — how the user wants to experience this match
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MatchMode {
    /// User controls their team live (full interactivity)
    Live,
    /// User watches as spectator (no interaction, can control speed)
    Spectator,
    /// Instantly simulate — no UI, just get the result
    Instant,
}

// ---------------------------------------------------------------------------
// LiveMatchSession — the shared match session + the game's metadata for the Tauri layer
// ---------------------------------------------------------------------------

/// A fixture of the game being played: the shared [`MatchSession`] (generators, controllers,
/// command check, input log, phase 3 E3-3) and what the game needs to file the result.
pub struct LiveMatchSession {
    pub session: MatchSession,
    pub mode: MatchMode,
    /// Index into the fixtures of the competition identified by
    /// `competition_id` — NOT necessarily into `game.league`, which
    /// `sync_legacy_league` resets to the user's domestic league.
    pub fixture_index: usize,
    /// Stable identity of the selected fixture, checked again before finish.
    pub fixture_id: String,
    /// Id of the competition (league or cup) this fixture belongs to; the
    /// finish path uses it to apply the report to the right competition.
    pub competition_id: String,
    /// The matchday and table of the competition *being played* — a cup, if the user is in a cup
    /// tie. Kept for callers that describe the tie itself.
    pub round_matchday: u32,
    pub round_previous_standings: Vec<StandingEntry>,
    /// The matchday and table of the user's own league, as they stood before any of today's
    /// fixtures were played, for the round digest.
    ///
    /// Two separate things, because they are two separate competitions on a cup day. The digest
    /// describes the user's league round, so it needs that league's baseline — and it has to be
    /// captured here, at session creation, because the GUI simulates the rest of the round
    /// immediately afterwards. Reading the table at finish time instead reports every delta as
    /// zero, since by then the round has been played.
    ///
    /// `None` when the user has no competition, in which case the finish path falls back to
    /// today's context.
    pub league_round_context: Option<(u32, Vec<StandingEntry>)>,
    pub home_team_id: String,
    pub away_team_id: String,
}

impl LiveMatchSession {
    /// Step one minute; the AI then gives the commands of every side it holds.
    pub fn step(&mut self) -> MinuteResult {
        self.session.step().result
    }

    /// Step multiple minutes at once (for fast-forward / instant sim).
    ///
    /// Stops early at full time, **when the match reaches a phase that needs the manager**, and
    /// the minute one of the manager's own players is hurt.
    /// Callers decide what to do from the last result, so batching straight through half time
    /// would leave the last result reading "second half" and the half-time team talk would never
    /// be offered. Stopping on the transition means a caller sees the same sequence of decision
    /// points it would have seen stepping a minute at a time.
    ///
    /// Use [`Self::run_to_completion`] to simulate a whole match without stopping.
    pub fn step_many(&mut self, count: u16) -> Vec<MinuteResult> {
        // Callers include MCP tools, where the count comes from a model and can be any u16.
        // Reserving for the request rather than for a plausible match would let `match_step(65535)`
        // allocate ~65k slots to return about 45.
        let mut results = Vec::with_capacity((count as usize).min(MAX_MATCH_MINUTES));
        let starting_phase = self.session.phase();
        let user_side = self.user_side();
        for _ in 0..count {
            let result = self.step();
            let finished = result.is_finished;
            let needs_manager = result.phase != starting_phase && phase_needs_manager(result.phase);
            // One of the manager's own players hurt this minute: he chooses who
            // comes on, or plays on a man short.
            let own_injury = user_side.is_some_and(|side| {
                result.events.iter().any(|event| {
                    event.event_type == engine::EventType::Injury && event.side == side
                })
            });
            results.push(result);
            if finished || needs_manager || own_injury {
                break;
            }
        }
        results
    }

    /// Run the entire match to completion instantly.
    pub fn run_to_completion(&mut self) -> Vec<MinuteResult> {
        let mut results = Vec::with_capacity(100);
        loop {
            let StepRecord { result, .. } = self.session.step();
            let finished = result.is_finished;
            results.push(result);
            if finished {
                break;
            }
        }
        results
    }

    pub fn snapshot(&self) -> MatchSnapshot {
        self.session.snapshot()
    }

    /// A command from the player (the screen or an MCP agent acting for him). It is given as the
    /// manager of the side he holds, so the shared check refuses an order for the other side; with
    /// no side of his (a match he only watches) it is given for the side it names.
    pub fn apply_command(&mut self, cmd: MatchCommand) -> Result<(), String> {
        let issuer = self.user_side().unwrap_or_else(|| cmd.side());
        self.session.command(issuer, InputSource::Manager, cmd)
    }

    pub fn is_finished(&self) -> bool {
        self.session.is_finished()
    }

    pub fn phase(&self) -> MatchPhase {
        self.session.phase()
    }

    /// The side the player holds, if any: the one a manager controls.
    pub fn user_side(&self) -> Option<Side> {
        [Side::Home, Side::Away]
            .into_iter()
            .find(|side| self.session.controller(*side) == Controller::Manager)
    }

    /// Hand both sides to the AI: a match the player no longer sits through.
    pub fn hand_to_ai(&mut self) {
        self.session.set_controller(Side::Home, Controller::Ai);
        self.session.set_controller(Side::Away, Controller::Ai);
    }

    /// Whether the user managed this match themselves ("go to the field"):
    /// only such a match grows their play style mastery (phase 2 X106). One
    /// watched as a spectator, or handed to the assistant, does not.
    pub fn is_managed_by_user(&self) -> bool {
        self.mode == MatchMode::Live && self.user_side().is_some()
    }

    pub fn into_report(self) -> MatchReport {
        self.session.into_report()
    }
}

// ---------------------------------------------------------------------------
// Helper: build a LiveMatchSession from the Game state
// ---------------------------------------------------------------------------

/// Make both sides of a fixture in `game.league` fit to kick off: a club short
/// of the squad floor signs free agents first (see
/// [`crate::squad_floor::ready_for_kick_off`]). Every path that plays a club
/// fixture goes through this before building the teams — the unwatched path
/// directly, the player's own matches through [`kick_off_live_match`] — so no
/// match starts with a side that cannot be fielded.
pub(crate) fn prepare_kick_off(game: &mut Game, fixture_index: usize) {
    let Some((home_team_id, away_team_id)) = game.league.as_ref().and_then(|league| {
        league
            .fixtures
            .get(fixture_index)
            .map(|fixture| (fixture.home_team_id.clone(), fixture.away_team_id.clone()))
    }) else {
        return;
    };
    crate::squad_floor::ready_for_kick_off(game, &home_team_id);
    crate::squad_floor::ready_for_kick_off(game, &away_team_id);
}

/// Kick off a fixture in `game.league` as a live session: both squads made fit
/// to play first, then the session built.
///
/// The entry point for starting a real match. [`create_live_match`] only reads
/// the game, so it cannot sign anyone; calling it directly skips the kick-off
/// top-up, which is only right for a caller that has already done it.
pub fn kick_off_live_match(
    game: &mut Game,
    fixture_index: usize,
    mode: MatchMode,
    allows_extra_time: bool,
) -> Result<LiveMatchSession, String> {
    prepare_kick_off(game, fixture_index);
    create_live_match(game, fixture_index, mode, allows_extra_time)
}

/// The players of a match a pre-match rule may move: both sides' XI and bench, from the save.
fn match_players<'a>(game: &'a Game, snapshot: &MatchSnapshot) -> Vec<&'a domain::player::Player> {
    let in_match: HashSet<&str> = [
        &snapshot.home_team.players,
        &snapshot.away_team.players,
        &snapshot.home_bench,
        &snapshot.away_bench,
    ]
    .into_iter()
    .flatten()
    .map(|player| player.id.as_str())
    .collect();
    game.players
        .iter()
        .filter(|player| in_match.contains(player.id.as_str()))
        .collect()
}

/// The roles two starters take after trading slots before kick-off
/// (`ofm_rules::squad::pre_match_swap_roles`), as commands to apply on top of it.
pub fn pre_match_position_swap_roles(
    game: &Game,
    snapshot: &MatchSnapshot,
    side: Side,
    player_ids: [&str; 2],
) -> Vec<MatchCommand> {
    ofm_rules::squad::pre_match_swap_roles(
        &match_players(game, snapshot),
        snapshot,
        side,
        player_ids,
    )
}

/// The commands that turn `side`'s XI, before kick-off, into the strongest lineup for its
/// formation from the players in the match (`ofm_rules::squad::strongest_pre_match_lineup`).
pub fn best_pre_match_lineup(
    game: &Game,
    snapshot: &MatchSnapshot,
    side: Side,
) -> Vec<MatchCommand> {
    ofm_rules::squad::strongest_pre_match_lineup(&match_players(game, snapshot), snapshot, side)
}

pub(crate) use ofm_rules::squad::{domain_play_style, engine_play_style};

/// Create a live match session for a specific fixture, on today's seed for its two clubs.
pub fn create_live_match(
    game: &Game,
    fixture_index: usize,
    mode: MatchMode,
    allows_extra_time: bool,
) -> Result<LiveMatchSession, String> {
    create_seeded_live_match(game, fixture_index, mode, allows_extra_time, None)
}

/// The seed of a match between two clubs on the game's day: the key of the generator the game
/// has always drawn the match from, so the engine's stream (stream 0 of the key) reads as it did
/// before the session split the AI off (phase 3, E3-3).
fn match_seed_today(game: &Game, home_team_id: &str, away_team_id: &str) -> MatchSeed {
    // The clubs tell this match from any other played today, as for a batch match.
    MatchSeed(
        game.rng_today(&format!("match/{home_team_id}/{away_team_id}"))
            .get_seed(),
    )
}

/// [`create_live_match`] on `seed`, or today's seed for the two clubs when `None`.
fn create_seeded_live_match(
    game: &Game,
    fixture_index: usize,
    mode: MatchMode,
    allows_extra_time: bool,
    seed: Option<MatchSeed>,
) -> Result<LiveMatchSession, String> {
    let league = game.league.as_ref().ok_or(LIVE_MATCH_NO_LEAGUE_ERROR)?;
    let fixture = league
        .fixtures
        .get(fixture_index)
        .ok_or(LIVE_MATCH_FIXTURE_NOT_FOUND_ERROR)?;
    if fixture.status != FixtureStatus::Scheduled {
        return Err(LIVE_MATCH_FIXTURE_NOT_SCHEDULED_ERROR.to_string());
    }

    let home_team_id = fixture.home_team_id.clone();
    let away_team_id = fixture.away_team_id.clone();

    // Build engine TeamData (starting XI = first 11 players by position)
    let (home_xi, home_bench) = build_team_with_bench(game, &home_team_id);
    let (away_xi, away_bench) = build_team_with_bench(game, &away_team_id);
    if home_xi.players.is_empty() || away_xi.players.is_empty() {
        return Err(LIVE_MATCH_EMPTY_SQUAD_ERROR.to_string());
    }
    let home_starter_ids = starter_ids(&home_xi);
    let away_starter_ids = starter_ids(&away_xi);

    // The player's club is held by its manager; every other side by the AI.
    let controller_of = |team_id: &str| {
        if game.manager.team_id.as_deref() == Some(team_id) {
            Controller::Manager
        } else {
            Controller::Ai
        }
    };
    let home_controller = controller_of(&home_team_id);
    let away_controller = controller_of(&away_team_id);
    let setup = MatchSetup {
        seed: seed.unwrap_or_else(|| match_seed_today(game, &home_team_id, &away_team_id)),
        ai_home: ai_profile_for(game, &home_team_id),
        ai_away: ai_profile_for(game, &away_team_id),
        // The desktop pauses for the manager instead (`phase_needs_manager`).
        injury_window_steps: None,
        licence_home: None,
        licence_away: None,
        set_pieces_home: None,
        set_pieces_away: None,
        home: home_xi,
        away: away_xi,
        home_bench,
        away_bench,
        config: match_config_of(game),
        allows_extra_time,
    };
    let mut session = MatchSession::new(setup, home_controller, away_controller);
    for (side, team_id, starters) in [
        (Side::Home, &home_team_id, &home_starter_ids),
        (Side::Away, &away_team_id, &away_starter_ids),
    ] {
        let match_roles = game
            .teams
            .iter()
            .find(|team| team.id == *team_id)
            .map(|team| team.match_roles.clone())
            .unwrap_or_default();
        let eleven: Vec<&domain::player::Player> = starters
            .iter()
            .filter_map(|id| game.players.iter().find(|player| &player.id == id))
            .collect();
        order_kickoff_takers(
            &mut session,
            side,
            kickoff_set_pieces(&match_roles, &eleven),
        );
    }

    Ok(LiveMatchSession {
        session,
        mode,
        fixture_index,
        fixture_id: fixture.id.clone(),
        competition_id: league.id.clone(),
        round_matchday: fixture.matchday,
        round_previous_standings: league.standings.clone(),
        league_round_context: crate::matchday::user_league_round_context(game),
        home_team_id,
        away_team_id,
    })
}

fn starter_ids(team: &TeamData) -> Vec<String> {
    team.players
        .iter()
        .map(|player| player.id.clone())
        .collect()
}

/// How a club's AI manages a match, from its reputation and its manager's record.
fn ai_profile_for(game: &Game, team_id: &str) -> AiProfile {
    let reputation = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .map(|team| team.reputation)
        .unwrap_or(500);
    AiProfile {
        reputation,
        experience: (reputation / 10).min(100) as u8,
        personality: derive_personality(reputation, manager_for_team(game, team_id)),
    }
}

/// What a fixture nobody watched produced, with the two clubs it belongs to so
/// the caller can apply it without re-reading the fixture.
#[derive(Debug)]
pub struct UnwatchedFixture {
    pub report: MatchReport,
    pub home_team_id: String,
    pub away_team_id: String,
    /// The user's league round as it stood before this fixture was played, for
    /// the round digest — see [`crate::matchday::user_league_round_context`].
    pub league_round_context: Option<(u32, Vec<StandingEntry>)>,
}

/// Play a fixture nobody is watching, start to finish.
///
/// The same session the player's own match runs on, with one difference: no side
/// belongs to the user. `create_live_match` reads the user's club off
/// `game.manager`, which is the right answer while the player is sitting through
/// the match and exactly the wrong one here — it would leave one dugout empty,
/// and the empty one would always be the player's. A match nobody watches has an
/// AI manager on both touchlines.
///
/// The one way a fixture in `game.league` is played without anyone watching:
/// the matchday loop plays every other fixture of the day through it, and
/// [`crate::matchday::play_user_matchday_with_capture`] the player's own when
/// they delegate. It kicks off through the squad floor's gate
/// ([`kick_off_live_match`]) and decides extra time by the one predicate,
/// [`crate::matchday::fixture_allows_extra_time`], so no caller can pass the
/// wrong answer (#601). An `Err` is a side nobody could field.
pub fn play_unwatched_fixture(
    game: &mut Game,
    fixture_index: usize,
) -> Result<UnwatchedFixture, String> {
    let allows_extra_time = crate::matchday::fixture_allows_extra_time(game, fixture_index);
    let mut session =
        kick_off_live_match(game, fixture_index, MatchMode::Instant, allows_extra_time)?;
    session.hand_to_ai();
    let league_round_context = session.league_round_context.clone();
    session.run_to_completion();

    Ok(UnwatchedFixture {
        home_team_id: session.home_team_id.clone(),
        away_team_id: session.away_team_id.clone(),
        report: session.into_report(),
        league_round_context,
    })
}

/// Play a fixture of `game.league` that fell before the career opened, so it
/// leaves the same report, lineups and stats rows as any match played since.
///
/// It differs from [`play_unwatched_fixture`] in two ways, both because the
/// match belongs to the past. It does not go through the kick-off gate, which
/// signs free agents for a short squad: nobody can be signed into a match that
/// has already happened. And its randomness is drawn from the fixture's own date,
/// not today's, so two meetings of the same clubs do not replay identically.
/// An `Err` is a side with nobody to field.
pub(crate) fn play_past_fixture(
    game: &Game,
    fixture_index: usize,
) -> Result<UnwatchedFixture, String> {
    let allows_extra_time = crate::matchday::fixture_allows_extra_time(game, fixture_index);
    let (home_team_id, away_team_id, date) = game
        .league
        .as_ref()
        .and_then(|league| league.fixtures.get(fixture_index))
        .map(|fixture| {
            (
                fixture.home_team_id.clone(),
                fixture.away_team_id.clone(),
                fixture.date.clone(),
            )
        })
        .unwrap_or_default();
    let seed = MatchSeed(
        game.rng_for(
            &format!("season-replay/match/{home_team_id}/{away_team_id}"),
            &date,
        )
        .get_seed(),
    );
    let mut session = create_seeded_live_match(
        game,
        fixture_index,
        MatchMode::Instant,
        allows_extra_time,
        Some(seed),
    )?;
    session.hand_to_ai();
    let league_round_context = session.league_round_context.clone();
    session.run_to_completion();

    Ok(UnwatchedFixture {
        home_team_id: session.home_team_id.clone(),
        away_team_id: session.away_team_id.clone(),
        report: session.into_report(),
        league_round_context,
    })
}

fn manager_for_team<'a>(game: &'a Game, team_id: &str) -> Option<&'a Manager> {
    let manager_id = game
        .teams
        .iter()
        .find(|team| team.id == team_id)
        .and_then(|team| team.manager_id.as_deref())?;

    game.managers
        .iter()
        .find(|manager| manager.id == manager_id)
        .or_else(|| (game.manager.id == manager_id).then_some(&game.manager))
}

/// Derive an AI personality from reputation and career statistics.
/// - Visionary: high reputation (700+) with substantial matches managed (50+)
/// - Reactive: moderate reputation with a winning record (win rate ≥ 55 %)
/// - Pragmatist: default
fn derive_personality(rep: u32, manager: Option<&Manager>) -> AiPersonality {
    if let Some(manager) = manager {
        let stats = &manager.career_stats;
        let total = stats.matches_managed;
        if rep >= 700 && total >= 50 {
            return AiPersonality::Visionary;
        }
        if total >= 20 {
            let win_rate = stats.wins as f64 / total as f64;
            if win_rate >= 0.55 {
                return AiPersonality::Reactive;
            }
        }
    }

    if rep >= 800 {
        return AiPersonality::Visionary;
    }

    AiPersonality::Pragmatist
}

#[cfg(test)]
mod tests {
    use super::{MatchMode, create_live_match, match_config_of};
    use crate::clock::GameClock;
    use crate::game::Game;
    use chrono::{TimeZone, Utc};
    use domain::league::{Fixture, FixtureStatus, League};
    use domain::manager::Manager;

    #[test]
    fn create_live_match_refuses_completed_fixture_directly() {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "manager".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        let mut game = Game::new(clock, manager, vec![], vec![], vec![], vec![]);
        game.league = Some(League {
            id: "league".to_string(),
            fixtures: vec![Fixture {
                id: "already-played".to_string(),
                home_team_id: "home".to_string(),
                away_team_id: "away".to_string(),
                status: FixtureStatus::Completed,
                ..Fixture::default()
            }],
            ..League::default()
        });

        let error = create_live_match(&game, 0, MatchMode::Instant, false)
            .err()
            .expect("the core entry point must reject a completed fixture");
        assert_eq!(error, "be.error.liveMatch.fixtureNotScheduled");
    }

    fn bare_game() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 15, 12, 0, 0).unwrap());
        let manager = Manager::new(
            "manager".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        Game::new(clock, manager, vec![], vec![], vec![], vec![])
    }

    /// Given a game nobody has set a match config on,
    /// when a match's config is read,
    /// then it is the game's default: every calibration knob at its tuned
    /// constant, whatever `OFM_KNOBS` says (GĐ5 X82).
    #[test]
    fn a_match_plays_the_default_config_unless_its_game_sets_one() {
        let config = match_config_of(&bare_game());
        let default = engine::MatchConfig::default();
        assert_eq!(config.knobs, engine::CalibrationKnobs::default());
        assert_eq!(
            serde_json::to_value(&config).expect("config serializes"),
            serde_json::to_value(&default).expect("config serializes")
        );
    }

    /// Given a game a probe has set a match config on,
    /// when a match's config is read for it and for another game,
    /// then the first plays the probe's config and the second the default:
    /// the config belongs to the game, not to the process (phase 3, E3-1).
    #[test]
    fn a_match_config_set_on_one_game_stays_with_that_game() {
        let mut probed = bare_game();
        probed.match_config_override = Some(engine::MatchConfig {
            home_advantage: 1.25,
            ..engine::MatchConfig::default()
        });
        assert_eq!(match_config_of(&probed).home_advantage, 1.25);
        assert_eq!(
            match_config_of(&bare_game()).home_advantage,
            engine::MatchConfig::default().home_advantage
        );
    }
}
