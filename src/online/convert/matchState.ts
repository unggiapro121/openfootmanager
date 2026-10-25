import type { CommentarySource } from "../../components/match/commentary";
import type { MatchStatsSource } from "../../components/match/MatchPanels";
import type { RadarMatch, RadarRoster } from "../../components/match/radar/radarMatch";
import type { EngineTacticsData, MatchEvent } from "../../components/match/types";
import type {
  Controllers,
  MatchFrame,
  MatchView,
  ProjectedPlayer,
  ProjectedSide,
  SquadPlayerView,
} from "../api";
import type { MatchEvent as ServerMatchEvent, Side, TacticsConfig } from "../api/engine";

/**
 * A live match as the online screen keeps it (C-2 §3.6, C2-9): the server's view at `lastSeq`,
 * then every frame after it applied in order. The view is the anchor: reopening a match always
 * starts again from a fresh one, so a drift in what is worked out here never outlives the screen.
 */

/** One side: its shape and style, the eleven in slot order, and the bench. */
export interface LiveSide {
  name: string;
  formation: string;
  playStyle: string;
  eleven: ProjectedPlayer[];
  bench: ProjectedPlayer[];
  subsMade: number;
}

export interface OnlineMatchState {
  lastSeq: number;
  minute: number;
  phase: string;
  homeScore: number;
  awayScore: number;
  possession: Side;
  ballZone: string;
  ballLane: MatchEvent["lane"];
  possessionPct: { home: number; away: number };
  controllers: Controllers;
  home: LiveSide;
  away: LiveSide;
  maxSubs: number;
  booked: string[];
  sentOff: string[];
  /** Players hurt and still on the pitch, by the step they were hurt in. */
  injuredSince: Record<string, number>;
  events: ServerMatchEvent[];
  /** What became of each of the coach's commands decided so far, by command id. */
  outcomes: Record<string, string>;
  /** Steps in whose gap a side adjusted its tactics out of sight (S8-15). */
  adjustments: { side: Side; seq: number; minute: number }[];
  isFinished: boolean;
}

function liveSide(side: ProjectedSide): LiveSide {
  const eleven = side.players
    .filter((player) => player.onPitch)
    .sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0));
  return {
    name: side.name,
    formation: side.formation,
    playStyle: side.playStyle,
    eleven,
    bench: side.players.filter((player) => !player.onPitch),
    subsMade: 0,
  };
}

/** The match as the server's view tells it, before any frame of its history is read. */
export function initialMatchState(view: MatchView): OnlineMatchState {
  const { state } = view;
  const home = { ...liveSide(view.home), subsMade: state.homeSubsMade };
  const away = { ...liveSide(view.away), subsMade: state.awaySubsMade };
  return {
    lastSeq: view.lastSeq,
    minute: state.minute,
    phase: state.phase,
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    possession: "Home",
    ballZone: "Midfield",
    ballLane: null,
    possessionPct: { home: 50, away: 50 },
    controllers: state.controllers,
    home,
    away,
    maxSubs: state.maxSubs,
    booked: state.booked,
    sentOff: state.sentOff,
    injuredSince: Object.fromEntries(state.injured.map((id) => [id, view.lastSeq])),
    events: [],
    outcomes: {},
    adjustments: [],
    isFinished: state.isFinished,
  };
}

const eventsOf = (frame: MatchFrame): ServerMatchEvent[] => [
  ...frame.gapEvents,
  ...frame.result.events,
];

/**
 * The match's past from its frames up to the view's step: the events so far, where the ball is
 * and how the sides have shared it, and when each player still hurt was hurt. The view already
 * holds everything else at that step.
 */
export function withHistory(state: OnlineMatchState, frames: MatchFrame[]): OnlineMatchState {
  const past = frames
    .filter((frame) => frame.seq <= state.lastSeq)
    .sort((left, right) => left.seq - right.seq);
  const last = past[past.length - 1];
  const injuredSince = { ...state.injuredSince };
  for (const frame of past) {
    for (const event of eventsOf(frame)) {
      if (event.event_type === "Injury" && event.player_id && event.player_id in injuredSince) {
        injuredSince[event.player_id] = frame.seq;
      }
    }
  }
  return {
    ...state,
    events: past.flatMap(eventsOf),
    injuredSince,
    adjustments: past.flatMap((frame) =>
      frame.gapInputs
        .filter((input) => input.kind === "tacticalAdjustment")
        .map((input) => ({ side: input.side, seq: frame.seq, minute: frame.result.minute })),
    ),
    ...(last ? fromResult(last) : {}),
  };
}

function fromResult(frame: MatchFrame) {
  return {
    minute: frame.result.minute,
    phase: frame.result.phase,
    homeScore: frame.result.home_score,
    awayScore: frame.result.away_score,
    possession: frame.result.possession,
    ballZone: frame.result.ball_zone,
    ballLane: frame.ballLane ?? null,
    possessionPct: frame.possessionPct,
    isFinished: frame.result.is_finished,
  };
}

function applyInputs(state: OnlineMatchState, frame: MatchFrame): OnlineMatchState {
  const adjustments = frame.gapInputs
    .filter((input) => input.kind === "tacticalAdjustment")
    .map((input) => ({ side: input.side, seq: frame.seq, minute: frame.result.minute }));
  return { ...state, adjustments: [...state.adjustments, ...adjustments] };
}

/**
 * The sides as a newer view of the match has them: who plays where, the bench, the shape and the
 * style, after the substitutions, swaps and changes of shape a frame told of. The engine decides
 * where each player then stands (a keeper coming on, a new formation), so the client reads it
 * from the server rather than working it out again. Players no longer hurt on the pitch, replaced
 * or recovered, stop counting down.
 */
export function withSides(state: OnlineMatchState, view: MatchView): OnlineMatchState {
  const injuredSince: Record<string, number> = {};
  for (const id of view.state.injured) {
    injuredSince[id] = state.injuredSince[id] ?? Math.min(view.lastSeq, state.lastSeq);
  }
  return {
    ...state,
    home: { ...liveSide(view.home), subsMade: view.state.homeSubsMade },
    away: { ...liveSide(view.away), subsMade: view.state.awaySubsMade },
    maxSubs: view.state.maxSubs,
    injuredSince,
  };
}

function applyEvents(state: OnlineMatchState, frame: MatchFrame): OnlineMatchState {
  const booked = [...state.booked];
  const sentOff = [...state.sentOff];
  const injuredSince = { ...state.injuredSince };
  for (const event of frame.result.events) {
    const id = event.player_id;
    if (!id) continue;
    if (event.event_type === "YellowCard" && !booked.includes(id)) booked.push(id);
    if (
      (event.event_type === "RedCard" || event.event_type === "SecondYellow") &&
      !sentOff.includes(id)
    ) {
      sentOff.push(id);
    }
    if (event.event_type === "Injury") injuredSince[id] = frame.seq;
  }
  return { ...state, booked, sentOff, injuredSince };
}

/** What applying a frame gave: the match after it, a frame already had, or a frame missed. */
export type FrameResult =
  | { kind: "applied"; state: OnlineMatchState; sidesChanged: boolean }
  | { kind: "stale" }
  | { kind: "gap"; afterSeq: number };

/**
 * The match after `frame`: its step (score, clock, ball, cards, injuries), who holds each side
 * after it, and what became of the commands decided in its gap. `sidesChanged` says that the gap
 * changed a side in sight of everyone (a substitution, a swap, a shape, a style): the sides are
 * then read again from the match's view (`withSides`). A frame already applied is stale; one
 * that skips a step is a gap to read from `afterSeq`.
 */
export function applyFrame(state: OnlineMatchState, frame: MatchFrame): FrameResult {
  if (frame.seq <= state.lastSeq) return { kind: "stale" };
  if (frame.seq !== state.lastSeq + 1) return { kind: "gap", afterSeq: state.lastSeq };
  const withInputs = applyInputs(state, frame);
  const withEvents = applyEvents(withInputs, frame);
  const outcomes = { ...state.outcomes };
  for (const outcome of frame.commands) outcomes[outcome.commandId] = outcome.status;
  return {
    kind: "applied",
    sidesChanged: frame.gapInputs.some((input) => input.kind === "command"),
    state: {
      ...withEvents,
      ...fromResult(frame),
      lastSeq: frame.seq,
      controllers: frame.controllers,
      events: [...state.events, ...eventsOf(frame)],
      outcomes,
    },
  };
}

/** Steps left before the AI replaces a hurt player of a coached side; null when none apply. */
export function injuryStepsLeft(
  state: OnlineMatchState,
  playerId: string,
  windowSteps: number | undefined,
): number | null {
  const since = state.injuredSince[playerId];
  if (since === undefined || windowSteps === undefined) return null;
  return Math.max(0, since + windowSteps - state.lastSeq);
}

/** Players of `side` already substituted off: they sit on the bench but may not come back. */
export function substitutedOff(state: OnlineMatchState, side: Side): Set<string> {
  return new Set(
    state.events
      .filter((event) => event.event_type === "Substitution" && event.side === side)
      .flatMap((event) => (event.secondary_player_id ? [event.secondary_player_id] : [])),
  );
}

/** The server's events as the game's match screens read them (E6-19). */
export function toMatchEvents(events: ServerMatchEvent[]): MatchEvent[] {
  return events;
}

/** A side's dials as the radar draws them, from the coach's own side (`/mine`). */
export function toRadarDials(tactics: TacticsConfig): EngineTacticsData {
  return { defensive_line: tactics.defensive_line, width: tactics.width };
}

const teamOf = (key: "home" | "away", side: LiveSide, dials?: EngineTacticsData) => ({
  id: key,
  name: side.name,
  formation: side.formation,
  ...(dials ? { tactics: dials } : {}),
  players: side.eleven.map((player) => ({
    id: player.id,
    name: player.matchName,
    position: player.position,
  })),
});

/**
 * The match as the radar draws it. Only the coach's own side has dials (`/mine`); the other side,
 * and both for a spectator, play the radar's default shape (S8-8, S8-15).
 */
export function toRadarMatch(
  state: OnlineMatchState,
  dials: { home?: EngineTacticsData; away?: EngineTacticsData } = {},
): RadarMatch {
  return {
    phase: state.phase,
    current_minute: state.minute,
    home_score: state.homeScore,
    away_score: state.awayScore,
    possession: state.possession,
    ball_zone: state.ballZone,
    ball_lane: state.ballLane,
    events: toMatchEvents(state.events),
    sent_off: state.sentOff,
    home_team: teamOf("home", state.home, dials.home),
    away_team: teamOf("away", state.away, dials.away),
  };
}

const everyone = (state: OnlineMatchState) => [
  ...state.home.eleven,
  ...state.home.bench,
  ...state.away.eleven,
  ...state.away.bench,
];

/**
 * Each player's short name and shirt number, for the radar and the pitch. A player of the coach's
 * own club (`squad`) carries the identity his squad page draws his portrait from, so his face is
 * the same in the match; the others are known by what the frames say.
 */
export function toRadarRoster(state: OnlineMatchState, squad: SquadPlayerView[] = []): RadarRoster {
  const own = new Map(squad.map((player) => [player.id, player]));
  return new Map(
    everyone(state).map((player) => {
      const known = own.get(player.id);
      return [
        player.id,
        {
          id: player.id,
          nationality: known?.nationality ?? null,
          full_name: known?.fullName ?? player.matchName,
          match_name: player.matchName,
          jersey_number: player.shirtNumber ?? null,
        },
      ];
    }),
  );
}

const named = (players: ProjectedPlayer[]) =>
  players.map((player) => ({ id: player.id, name: player.matchName }));

/** The match as the event feed and its commentary read it: names and events. */
export function toFeedSource(state: OnlineMatchState): CommentarySource {
  return {
    home_team: { name: state.home.name, players: named(state.home.eleven) },
    away_team: { name: state.away.name, players: named(state.away.eleven) },
    home_bench: named(state.home.bench),
    away_bench: named(state.away.bench),
    events: toMatchEvents(state.events),
  };
}

/** The match as the stats panel reads it: events, the ball's share, each side's bookings. */
export function toStatsSource(state: OnlineMatchState): MatchStatsSource {
  const bookedOf = (side: LiveSide) => {
    const ids = new Set([...side.eleven, ...side.bench].map((player) => player.id));
    return Object.fromEntries(state.booked.filter((id) => ids.has(id)).map((id) => [id, 1]));
  };
  return {
    events: toMatchEvents(state.events),
    home_possession_pct: state.possessionPct.home,
    away_possession_pct: state.possessionPct.away,
    home_yellows: bookedOf(state.home),
    away_yellows: bookedOf(state.away),
  };
}
