import type {
  EnginePlayerData,
  EngineTacticsData,
  EngineTeamData,
  MatchEvent,
  MatchSnapshot,
} from "../types";

/** Test-only builders for the match radar: two 4-4-2 sides and a snapshot around them. */

const GROUPS_442 = [
  "Goalkeeper",
  "Defender",
  "Defender",
  "Defender",
  "Defender",
  "Midfielder",
  "Midfielder",
  "Midfielder",
  "Midfielder",
  "Forward",
  "Forward",
];

const SHORT_NAMES = ["gk", "lb", "cb1", "cb2", "rb", "lm", "cm1", "cm2", "rm", "st1", "st2"];

export function radarPlayer(id: string, position: string): EnginePlayerData {
  return {
    id,
    name: `Player ${id}`,
    position,
    ovr: 70,
    condition: 90,
    traits: [],
    role: "Standard",
  } as unknown as EnginePlayerData;
}

/** A 4-4-2 side whose players are `${prefix}_gk`, `${prefix}_lb`, … `${prefix}_st2`. */
export function radarTeam(prefix: string, tactics?: Partial<EngineTacticsData>): EngineTeamData {
  return {
    id: prefix,
    name: `${prefix} FC`,
    formation: "4-4-2",
    play_style: "Balanced",
    players: GROUPS_442.map((group, index) =>
      radarPlayer(`${prefix}_${SHORT_NAMES[index]}`, group),
    ),
    tactics: tactics as EngineTacticsData | undefined,
  };
}

export function radarEvent(
  event_type: string,
  side: "Home" | "Away",
  zone: string,
  player_id: string | null = null,
  secondary_player_id: string | null = null,
  minute = 10,
): MatchEvent {
  return { minute, event_type, side, zone, player_id, secondary_player_id };
}

export function radarSnapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    phase: "FirstHalf",
    current_minute: 10,
    home_score: 0,
    away_score: 0,
    possession: "Home",
    ball_zone: "Midfield",
    home_team: radarTeam("h"),
    away_team: radarTeam("a"),
    home_bench: [],
    away_bench: [],
    home_possession_pct: 50,
    away_possession_pct: 50,
    events: [],
    home_subs_made: 0,
    away_subs_made: 0,
    max_subs: 5,
    home_set_pieces: {
      free_kick_taker: null,
      corner_taker: null,
      penalty_taker: null,
      captain: null,
    },
    away_set_pieces: {
      free_kick_taker: null,
      corner_taker: null,
      penalty_taker: null,
      captain: null,
    },
    substitutions: [],
    allows_extra_time: false,
    home_yellows: {},
    away_yellows: {},
    sent_off: [],
    ...overrides,
  };
}

export interface DrawCall {
  method: string;
  args: unknown[];
}

/**
 * A stand-in 2D context that records every call made on it — jsdom has no
 * canvas — so a test can ask what was drawn: `texts()` lists what was written.
 */
export function recordingContext() {
  const calls: DrawCall[] = [];
  const state: Record<string | symbol, unknown> = {
    measureText: (text: string) => ({ width: text.length }),
  };
  const context = new Proxy(state, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args: unknown[]) => {
        calls.push({ method: String(property), args });
      };
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
  return {
    context: context as unknown as CanvasRenderingContext2D,
    calls,
    texts: () =>
      calls.filter((call) => call.method === "fillText").map((call) => String(call.args[0])),
    clear: () => {
      calls.length = 0;
    },
  };
}
