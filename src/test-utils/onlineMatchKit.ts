import type {
  MatchFrame,
  MatchView,
  MineView,
  ProjectedPlayer,
  ProjectedSide,
} from "../online/api";
import type { EventType, MatchEvent, Side } from "../online/api/engine";
import { type RealtimeMessage, setOnlineRealtime } from "../services/onlineRealtime";

/** A live match's pieces as the server sends them, for the online match screen's tests. */

export function projectedPlayer(
  id: string,
  slot: number | undefined,
  overrides: Partial<ProjectedPlayer> = {},
): ProjectedPlayer {
  return {
    id,
    matchName: `P. ${id}`,
    position: slot === 0 ? "Goalkeeper" : "Midfielder",
    ovr: 60,
    shirtNumber: slot === undefined ? 20 : slot + 1,
    ...(slot === undefined ? {} : { slot }),
    onPitch: slot !== undefined,
    ...overrides,
  };
}

/** A side of eleven `<prefix>0`…`<prefix>10` in slot order, then a bench `<prefix>s1`, `<prefix>s2`. */
export function projectedSide(prefix: string, name: string): ProjectedSide {
  return {
    name,
    formation: "4-4-2",
    playStyle: "Balanced",
    players: [
      ...Array.from({ length: 11 }, (_, slot) => projectedPlayer(`${prefix}${slot}`, slot)),
      projectedPlayer(`${prefix}s1`, undefined),
      projectedPlayer(`${prefix}s2`, undefined),
    ],
  };
}

export function matchView(overrides: Partial<MatchView> = {}): MatchView {
  return {
    id: "match-1",
    fixtureId: "fx-1",
    status: "live",
    kickOffAt: "2026-10-23T12:00:00Z",
    stepMillis: 2000,
    halfTimeMillis: 60000,
    injuryWindowSteps: 3,
    lastSeq: 0,
    state: {
      minute: 0,
      phase: "PreKickOff",
      homeScore: 0,
      awayScore: 0,
      controllers: { home: "Manager", away: "Ai" },
      booked: [],
      sentOff: [],
      injured: [],
      homeSubsMade: 0,
      awaySubsMade: 0,
      maxSubs: 5,
      isFinished: false,
    },
    home: projectedSide("h", "Hà Nội FC"),
    away: projectedSide("a", "Hải Phòng"),
    ...overrides,
  };
}

export function matchEvent(
  event_type: EventType,
  side: Side,
  player_id: string | null,
  overrides: Partial<MatchEvent> = {},
): MatchEvent {
  return {
    minute: 1,
    event_type,
    side,
    zone: "Midfield",
    player_id,
    secondary_player_id: null,
    detail: null,
    shot_kind: null,
    set_piece: null,
    goal_source: null,
    lane: null,
    tactical_context: null,
    ...overrides,
  };
}

/** The frame of step `seq`, one minute per step, with nothing in its gap unless given. */
export function matchFrame(
  seq: number,
  overrides: Partial<Omit<MatchFrame, "result">> & {
    result?: Partial<MatchFrame["result"]>;
  } = {},
): MatchFrame {
  const { result, ...rest } = overrides;
  return {
    seq,
    gapInputs: [],
    gapEvents: [],
    commands: [],
    controllers: { home: "Manager", away: "Ai" },
    possessionPct: { home: 50, away: 50 },
    ...rest,
    result: {
      minute: seq,
      phase: "FirstHalf",
      events: [],
      home_score: 0,
      away_score: 0,
      possession: "Home",
      ball_zone: "Midfield",
      is_finished: false,
      ...result,
    },
  };
}

export function mineView(overrides: Partial<MineView> = {}): MineView {
  return {
    side: "Home",
    lastSeq: 0,
    tactics: {
      pressing_intensity: "Medium",
      defensive_line: "High",
      width: "Wide",
      build_up_style: "Mixed",
      marking_style: "Zonal",
      tempo: "Patient",
      defensive_shape: "Compact",
      counter_press_duration: "Short",
      break_speed: "Medium",
      cross_style: "Mixed",
      offside_trap: "Off",
    },
    roles: [],
    setPieces: { free_kick_taker: null, corner_taker: null, penalty_taker: null, captain: null },
    commands: [],
    ...overrides,
  };
}

/** A fake realtime client: records each watch and lets the test speak on it. */
export function fakeRealtime() {
  const watches: Array<{
    channel: string;
    lastSeq: number | undefined;
    speak: (message: RealtimeMessage) => void;
    stopped: boolean;
  }> = [];
  const restore = setOnlineRealtime({
    watch: (channel, lastSeq, onMessage) => {
      const watch = { channel, lastSeq, speak: onMessage, stopped: false };
      watches.push(watch);
      return Promise.resolve(async () => {
        watch.stopped = true;
      });
    },
  });
  /** Hand the last watch of `match:<matchId>` a frame. */
  const push = (matchId: string, frame: MatchFrame) => {
    const watch = [...watches].reverse().find((one) => one.channel === `match:${matchId}`);
    watch?.speak({ kind: "frame", channel: `match:${matchId}`, seq: frame.seq, data: frame });
  };
  return { watches, restore, push };
}
