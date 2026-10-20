import type { Lane, MatchEvent } from "../types";
import { type Side, opposite } from "./radarGeometry";

/**
 * The radar's commentary: what a commentator says as each beat plays. Built
 * from the events the radar acts out and the players it casts in them, so the
 * line names who the viewer sees on the ball. Kept free of i18n: a caption
 * holds keys and player ids, and the commentary bar turns it into text.
 */

/**
 * How a caption competes for the commentary bar. `play` follows the radar as
 * it plays; `key` is a moment that must be read (a goal, a card); `filler`
 * only fills a quiet spell.
 */
export type CaptionPriority = "play" | "key" | "filler";

/** Who and what a line names: ids and facts, put into words when it is shown. */
export interface CaptionTokens {
  /** The side the line is about: its team is `{{team}}`, the other `{{opponent}}`. */
  side: Side;
  player?: string | null;
  receiver?: string | null;
  other?: string | null;
  lane?: Lane | null;
  minute?: number;
  /** The score as `home-away`. */
  score?: string;
}

export type RadarCaption =
  /** A line under `match.radar.commentary`: the first of `keys` that has lines. */
  | {
      kind: "line";
      priority: CaptionPriority;
      keys: string[];
      tokens: CaptionTokens;
      /** Picks one of the key's lines, the same one every time. */
      seed: string;
    }
  /** A key event, told as the event feed tells it (`match.commentary`). */
  | {
      kind: "event";
      priority: CaptionPriority;
      event: MatchEvent;
      /** The goal's assist, named when he was seen in the move. */
      assist: string | null;
    };

/** A caption and the step of its beat it is said on. */
export interface BeatCaption {
  step: number;
  caption: RadarCaption;
}

type Third = "own" | "middle" | "attacking";

/** Which third of the pitch `zone` is for `side`: its own, the middle, or the one it attacks. */
function thirdOf(side: Side, zone: string): Third {
  if (zone === "Midfield") return "middle";
  const isHomeEnd = zone === "HomeBox" || zone === "HomeDefense";
  return isHomeEnd === (side === "Home") ? "own" : "attacking";
}

/** Shots, goals and penalties: a lead-in as it is struck, then how it ended. */
const ATTEMPTS = new Set([
  "Goal",
  "ShotSaved",
  "ShotOffTarget",
  "ShotBlocked",
  "ShotOnTarget",
  "PenaltyGoal",
  "PenaltyMiss",
]);

/** Events told as the event feed tells them. */
const TOLD_AS_EVENTS = new Set([
  "Foul",
  "Offside",
  "PenaltyAwarded",
  "YellowCard",
  "RedCard",
  "SecondYellow",
  "Injury",
  "Substitution",
  "KickOff",
  "HalfTime",
  "SecondHalfStart",
  "FullTime",
]);

/** Moments that must be read, not swept away by the next pass. */
const KEY_EVENTS = new Set([
  "Goal",
  "PenaltyGoal",
  "PenaltyMiss",
  "PenaltyAwarded",
  "RedCard",
  "SecondYellow",
  "YellowCard",
  "Injury",
]);

function seedOf(event: MatchEvent, part: string): string {
  return `${event.minute}|${event.event_type}|${event.player_id ?? ""}|${part}`;
}

/** A line about `event`, told from its side unless `tokens` names another. */
function line(
  event: MatchEvent,
  keys: string[],
  tokens: Partial<CaptionTokens>,
  priority: CaptionPriority = "play",
): RadarCaption {
  return {
    kind: "line",
    priority,
    keys,
    tokens: { side: event.side, ...tokens },
    seed: seedOf(event, keys[0]),
  };
}

function told(event: MatchEvent, assist: string | null = null): RadarCaption {
  return {
    kind: "event",
    priority: KEY_EVENTS.has(event.event_type) ? "key" : "play",
    event,
    assist,
  };
}

/** What the beat of an event says, and on which step. */
export interface CaptionCue {
  event: MatchEvent;
  /** The event before it in the whole minute, acted out or not. */
  previous: MatchEvent | undefined;
  /** Who the radar has receive the ball, for a beat that passes it. */
  receiver: string | null;
  /** How many steps the beat has. */
  steps: number;
  /** Everyone seen on the ball earlier in the move. */
  seen: ReadonlySet<string>;
}

function passLine(event: MatchEvent, receiver: string | null): RadarCaption {
  const fast = event.tactical_context === "Counter" || event.tactical_context === "HighTurnover";
  const third = thirdOf(event.side, event.zone);
  const kind = fast
    ? "counter"
    : third === "own"
      ? "buildUp"
      : third === "middle"
        ? "midfield"
        : "attacking";
  const key = `pass.${kind}`;
  return line(event, receiver ? [key] : [`${key}.noReceiver`], {
    player: event.player_id,
    receiver,
  });
}

function winBackLine(event: MatchEvent, previous: MatchEvent | undefined): RadarCaption {
  const player = event.player_id;
  if (event.event_type === "Tackle") return line(event, ["tackle"], { player });
  switch (event.tactical_context) {
    case "SweeperKeeperInterception": {
      const forward = previous && previous.side !== event.side ? previous.player_id : null;
      return line(event, forward ? ["sweeper"] : ["sweeper.noForward"], {
        player,
        other: forward,
      });
    }
    case "HighTurnover":
      return line(event, ["highTurnover"], { player });
    case "LongBall":
      return line(event, ["recovered"], { player });
    default: {
      const passer =
        previous?.event_type === "PassIntercepted" && previous.side !== event.side
          ? previous.player_id
          : null;
      return line(event, passer ? ["interception"] : ["interception.noPasser"], {
        player,
        other: passer,
      });
    }
  }
}

function dribbleLine(event: MatchEvent): RadarCaption {
  const tokens = { player: event.player_id, other: event.secondary_player_id, lane: event.lane };
  switch (event.tactical_context) {
    case "BallInBehind":
      return line(
        event,
        event.secondary_player_id ? ["dribble.ballInBehind"] : ["dribble.ballInBehind.alone"],
        tokens,
      );
    case "CutInside":
      return line(event, ["dribble.cutInside"], tokens);
    case "FlankExposed":
      return line(event, ["dribble.flankExposed"], tokens);
    case "Counter":
      return line(event, ["dribble.counter"], tokens);
    default:
      return line(event, ["dribble"], tokens);
  }
}

function crossLine(event: MatchEvent, receiver: string | null): RadarCaption {
  const tokens = { player: event.player_id, receiver, lane: event.lane };
  if (!receiver) return line(event, ["cross.noTarget"], tokens);
  if (event.set_piece === "Corner") return line(event, ["cross.corner"], tokens);
  if (event.set_piece === "FreeKick") return line(event, ["cross.freeKick"], tokens);
  if (event.tactical_context === "EarlyCross") return line(event, ["cross.early"], tokens);
  if (event.tactical_context === "LowCross") return line(event, ["cross.low"], tokens);
  return line(event, ["cross"], tokens);
}

function clearanceLine(event: MatchEvent, previous: MatchEvent | undefined): RadarCaption {
  const tokens = { player: event.player_id };
  if (event.tactical_context === "LowCross") return line(event, ["clearance.lowCross"], tokens);
  if (previous?.event_type === "Cross") return line(event, ["clearance.cross"], tokens);
  if (event.tactical_context === "LongBall") return line(event, ["clearance.longBall"], tokens);
  return line(event, ["clearance"], tokens);
}

/** The line as an attempt is struck, before anyone knows how it ends. */
function strikeLine(event: MatchEvent): RadarCaption {
  const tokens = { player: event.player_id };
  if (event.shot_kind === "Penalty") return line(event, ["shot.penalty"], tokens);
  if (event.shot_kind === "DirectFreeKick") return line(event, ["shot.directFreeKick"], tokens);
  if (event.shot_kind === "Header") return line(event, ["shot.header"], tokens);
  if (event.shot_kind === "LongRange") return line(event, ["shot.longRange"], tokens);
  if (event.tactical_context === "KeeperOffHisLine") return line(event, ["shot.keeperOff"], tokens);
  if (event.tactical_context === "Counter") return line(event, ["shot.counter"], tokens);
  return line(event, ["shot.open"], tokens);
}

/**
 * The line an event's play says, alone: what a pass, a run, a cross or a
 * clearance is called, whether the radar acts it out or the minute's summary
 * names it. Null for an event with nothing to say.
 */
export function playLine(
  event: MatchEvent,
  previous: MatchEvent | undefined,
  receiver: string | null,
): RadarCaption | null {
  switch (event.event_type) {
    case "PassCompleted":
      return passLine(event, receiver);
    case "PassIntercepted":
      // Told from the side that won it: the interceptor is the radar's receiver.
      return receiver
        ? line(event, ["interception"], {
            side: opposite(event.side),
            player: receiver,
            other: event.player_id,
          })
        : null;
    case "Tackle":
    case "Interception":
      return winBackLine(event, previous);
    case "BallRecovery":
      return line(event, ["secondBall"], {
        player: event.player_id,
        other: event.secondary_player_id,
      });
    case "LongBall":
      return line(event, receiver ? ["longBall"] : ["longBall.noTarget"], {
        player: event.player_id,
        receiver,
      });
    case "Dribble":
      return dribbleLine(event);
    case "DribbleTackled":
      return line(
        event,
        event.secondary_player_id ? ["dribbleTackled"] : ["dribbleTackled.noDefender"],
        { player: event.player_id, other: event.secondary_player_id },
      );
    case "Cross":
      return crossLine(event, receiver);
    case "Clearance":
      return clearanceLine(event, previous);
    case "Corner":
      return line(event, event.player_id ? ["corner"] : ["corner.noTaker"], {
        player: event.player_id,
      });
    case "FreeKick": {
      if (event.player_id) return line(event, ["freeKick.taken"], { player: event.player_id });
      const danger = thirdOf(event.side, event.zone) === "attacking";
      return line(event, [danger ? "freeKick.awardedDanger" : "freeKick.awarded"], {});
    }
    case "GoalKick":
      return line(event, ["goalKick"], {}, "filler");
    default:
      return null;
  }
}

/**
 * The captions of an event's beat. An attempt says two things: the strike as
 * the beat starts, and how it ended on its last step, so the outcome is never
 * told before the ball gets there. A goal names its assist only when he was on
 * the ball earlier in the move: the viewer saw him set it up.
 */
export function captionsFor(cue: CaptionCue): BeatCaption[] {
  const { event, previous, receiver, steps, seen } = cue;
  if (ATTEMPTS.has(event.event_type)) {
    const assistId = event.secondary_player_id;
    const assist =
      event.event_type === "Goal" && assistId && assistId !== event.player_id && seen.has(assistId)
        ? assistId
        : null;
    return [
      { step: 0, caption: strikeLine(event) },
      { step: Math.max(0, steps - 1), caption: told(event, assist) },
    ];
  }
  if (TOLD_AS_EVENTS.has(event.event_type)) return [{ step: 0, caption: told(event) }];
  const said = playLine(event, previous, receiver);
  return said ? [{ step: 0, caption: said }] : [];
}

// ---------------------------------------------------------------------------
// The minute around the radar's play
// ---------------------------------------------------------------------------

/** Events always told, even when the radar does not act them out, most important first. */
const ALWAYS_TOLD = [
  "Injury",
  "YellowCard",
  "Substitution",
  "HalfTime",
  "FullTime",
  "SecondHalfStart",
  "KickOff",
];

/** Play worth a line in a quiet minute, most telling first. */
const NOTABLE = [
  "DribbleTackled",
  "Clearance",
  "Cross",
  "Interception",
  "BallRecovery",
  "LongBall",
];

/** How the minute ended, for its summary. */
export interface MinuteState {
  possession: Side;
  ballZone: string;
  minute: number;
  homeScore: number;
  awayScore: number;
}

/** From this minute on, a quiet minute is told by the score. */
const LATE_MINUTE = 80;

function summaryLine(state: MinuteState): RadarCaption {
  const { possession, minute, homeScore, awayScore } = state;
  const score = `${homeScore}-${awayScore}`;
  const seed = `${minute}|summary`;
  if (minute >= LATE_MINUTE && minute <= 90) {
    if (homeScore === awayScore) {
      return {
        kind: "line",
        priority: "filler",
        keys: ["summary.lateLevel"],
        tokens: { side: possession, minute, score },
        seed,
      };
    }
    const trailing: Side = homeScore < awayScore ? "Home" : "Away";
    return {
      kind: "line",
      priority: "filler",
      keys: ["summary.lateTrailing"],
      tokens: { side: trailing, minute, score },
      seed,
    };
  }
  const third = thirdOf(possession, state.ballZone);
  const key =
    third === "own"
      ? "summary.ownHalf"
      : third === "middle"
        ? "summary.midfield"
        : "summary.attacking";
  return { kind: "line", priority: "filler", keys: [key], tokens: { side: possession }, seed };
}

/**
 * What the bar says about a minute beyond the play the radar acts out: every
 * key event the radar does not show (a booking, an injury, a change), and, for
 * a minute with nothing acted out, one line for it — its most telling play, or
 * how the game stands.
 */
export function minuteCaptions(
  events: MatchEvent[],
  acted: ReadonlySet<MatchEvent>,
  state: MinuteState,
): RadarCaption[] {
  const told = events
    .filter((event) => !acted.has(event) && ALWAYS_TOLD.includes(event.event_type))
    .map((event): RadarCaption => ({ kind: "event", priority: "key", event, assist: null }));
  if (acted.size > 0 || told.length > 0) return told;
  for (const type of NOTABLE) {
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.event_type !== type) continue;
      const said = playLine(event, events[index - 1], event.secondary_player_id);
      if (said) return [{ ...said, priority: "filler" }];
    }
  }
  return [summaryLine(state)];
}

// ---------------------------------------------------------------------------
// Saying them as the radar plays
// ---------------------------------------------------------------------------

/** How far the commentary has got: the beat on screen, and the last of its steps said. */
export interface CaptionMark {
  beat: object | null;
  upTo: number;
}

/** The beat and step the radar is acting out, as its run records them. */
interface Acting {
  beat: { beat: { captions?: BeatCaption[] } };
  index: number;
}

/**
 * The captions due now the radar acts out `acting`, past `mark`: every step
 * reached since, so a step passed within one frame is still said, and none is
 * said twice.
 */
export function captionsDue(
  acting: Acting | null,
  mark: CaptionMark,
): { due: RadarCaption[]; mark: CaptionMark } {
  if (!acting) return { due: [], mark };
  const from = acting.beat === mark.beat ? mark.upTo : -1;
  if (acting.index <= from) return { due: [], mark };
  const due = (acting.beat.beat.captions ?? [])
    .filter((entry) => entry.step > from && entry.step <= acting.index)
    .sort((a, b) => a.step - b.step)
    .map((entry) => entry.caption);
  return { due, mark: { beat: acting.beat, upTo: acting.index } };
}
