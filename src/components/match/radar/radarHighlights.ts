import type { MatchEvent } from "../types";

/**
 * What the 2D radar acts out of a minute: only the dangerous play — an attack
 * that ends in an attempt on goal, from where the side won the ball to the
 * attempt and the corner it may win — plus a sending-off, marked without being
 * acted out. Everything else in the minute is passed over.
 */

/** Attempts on goal: each makes the move that led to it worth showing. */
const ATTEMPTS = new Set([
  "Goal",
  "ShotSaved",
  "ShotOffTarget",
  "ShotBlocked",
  "ShotOnTarget",
  "PenaltyGoal",
  "PenaltyMiss",
]);
/** Play that builds an attack, by the attacking side. */
const BUILD_UP = new Set([
  "PassCompleted",
  "Dribble",
  "Cross",
  "Corner",
  "FreeKick",
  "PenaltyAwarded",
]);
/** Where an attack starts: the side winning the ball. */
const BALL_WON = new Set(["Tackle", "Interception"]);
/** A foul by the defending side, which gives the attack its free kick or penalty. */
const FOUL = "Foul";
const SENDING_OFF = new Set(["RedCard", "SecondYellow"]);
/** The defending side's first touch that ends a corner with no shot from it. */
const CORNER_ENDS = new Set(["Clearance", "Interception", "Tackle"]);

/** Whether `event` is the attacking side playing the ball: a move can open with it. */
export function isAttackingPlay(event: MatchEvent): boolean {
  return (
    ATTEMPTS.has(event.event_type) ||
    BUILD_UP.has(event.event_type) ||
    BALL_WON.has(event.event_type)
  );
}

/** The indexes of the move that led to the attempt at `shot`, the attempt included. */
function moveTo(events: MatchEvent[], shot: number): number[] {
  const side = events[shot].side;
  const move = [shot];
  for (let index = shot - 1; index >= 0; index--) {
    const event = events[index];
    if (event.side === side && BUILD_UP.has(event.event_type)) {
      move.push(index);
      continue;
    }
    if (event.side !== side && event.event_type === FOUL) {
      move.push(index);
      continue;
    }
    if (event.side === side && BALL_WON.has(event.event_type)) {
      move.push(index);
      // A build-up lost to a high press opens the move: the pressers on the
      // passer are part of it (phase 2, GĐ4; shown from GĐ5 P5.6).
      const lost = events[index - 1];
      if (lost?.event_type === "PassIntercepted" && lost.tactical_context === "HighTurnover") {
        move.push(index - 1);
      }
    }
    break;
  }
  return move;
}

/** The events of a minute worth acting out on the radar, in order. */
export function highlightsOf(events: MatchEvent[]): MatchEvent[] {
  const kept = keptIndexes(events);
  return events.filter((_, index) => kept.has(index));
}

/**
 * A minute's dangerous play split into its moves, in order: runs of events
 * that follow one another with nothing passed over between them. The radar
 * plays each move from its start to its end, and changes scene only between
 * moves (after GĐ5).
 */
export function movesOf(events: MatchEvent[]): MatchEvent[][] {
  const kept = keptIndexes(events);
  const moves: MatchEvent[][] = [];
  let last = -2;
  events.forEach((event, index) => {
    if (!kept.has(index)) return;
    if (index === last + 1) moves[moves.length - 1].push(event);
    else moves.push([event]);
    last = index;
  });
  return moves;
}

/**
 * The build-up a minute ends on, not yet acted out: what the move to a shot
 * would start with if the shot comes next minute (`moveTo` from the end). The
 * radar holds it back and plays it with the next minute, so a move that spans
 * two minutes is played in one piece (after GĐ5).
 */
export function openMove(events: MatchEvent[]): MatchEvent[] {
  const kept = keptIndexes(events);
  const last = events[events.length - 1];
  // A move that ends on its corner is not over: the corner is still to be
  // taken, so the whole move waits for the next minute.
  if (last?.event_type === "Corner" && kept.has(events.length - 1)) {
    let start = events.length - 1;
    while (start > 0 && kept.has(start - 1)) start -= 1;
    return events.slice(start);
  }
  if (!last || kept.has(events.length - 1)) return [];
  // A foul at the end gives the other side the free kick it would start from.
  const side = last.event_type === FOUL ? (last.side === "Home" ? "Away" : "Home") : last.side;
  let start = events.length;
  for (let index = events.length - 1; index >= 0 && !kept.has(index); index--) {
    const event = events[index];
    if (event.side === side && BUILD_UP.has(event.event_type)) {
      start = index;
      continue;
    }
    if (event.side !== side && event.event_type === FOUL) {
      start = index;
      continue;
    }
    if (event.side === side && BALL_WON.has(event.event_type)) start = index;
    break;
  }
  return events.slice(start);
}

/** The indexes of a minute's events worth acting out on the radar. */
function keptIndexes(events: MatchEvent[]): Set<number> {
  const kept = new Set<number>();
  events.forEach((event, index) => {
    if (SENDING_OFF.has(event.event_type)) kept.add(index);
    // A flag for offside is acted out, though the move ends there (after GĐ5).
    if (event.event_type === "Offside") kept.add(index);
    // A sweeper keeper cutting out a break is worth showing though no shot
    // follows: the break he stopped, and him (phase 2, GĐ5 P5.6).
    if (event.tactical_context === "SweeperKeeperInterception") {
      kept.add(index);
      const before = events[index - 1];
      if (before && before.side !== event.side && BUILD_UP.has(before.event_type)) {
        kept.add(index - 1);
      }
    }
    if (!ATTEMPTS.has(event.event_type)) return;
    for (const part of moveTo(events, index)) kept.add(part);
    // The corner a shot wins plays on from it.
    const next = events[index + 1];
    if (next?.event_type === "Corner" && next.side === event.side) kept.add(index + 1);
  });
  for (const index of [...kept]) {
    if (events[index].event_type === "Corner") keepDelivery(events, index, kept);
  }
  return kept;
}

/**
 * A corner is played to its end even with no shot from it (after GĐ5): its
 * cross, if the engine names one, and the defending side's first touch that
 * deals with it. Play after that is not part of it.
 */
function keepDelivery(events: MatchEvent[], corner: number, kept: Set<number>): void {
  const side = events[corner].side;
  let index = corner + 1;
  const cross = events[index];
  if (cross?.event_type === "Cross" && cross.side === side) {
    kept.add(index);
    index += 1;
  }
  const answer = events[index];
  if (answer && answer.side !== side && CORNER_ENDS.has(answer.event_type)) kept.add(index);
}
