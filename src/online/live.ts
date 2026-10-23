import { type RealtimeMessage, watchChannel } from "../services/onlineRealtime";
import type { LeagueNotice, MatchFrame } from "./api";
import { OnlineApiError } from "./errors";

/**
 * Following a live match or a league (phase 3 S-8e, S-8-tech-spec.md §3.10). Open a match with
 * `online.matches.byId`, then watch it from that view's `lastSeq`: every frame after it comes once
 * and in order, across reconnections (the Rust client remembers where each watch is).
 */

/** What a watch is told besides its frames or notices. */
export interface WatchHandlers {
  /** The connection's state; on `closed`, `error` says why (sign in again). */
  onStatus?: (
    state: "connecting" | "open" | "reconnecting" | "closed",
    error?: OnlineApiError,
  ) => void;
  /** The gateway refused this channel (`be.error.realtime.*`). */
  onError?: (error: OnlineApiError) => void;
}

/** A watch to stop when the screen leaves. */
export type StopWatching = () => Promise<void>;

function dispatch(
  message: RealtimeMessage,
  onData: (message: Extract<RealtimeMessage, { kind: "frame" | "notice" }>) => void,
  handlers: WatchHandlers,
): void {
  switch (message.kind) {
    case "frame":
    case "notice":
      onData(message);
      return;
    case "status":
      handlers.onStatus?.(
        message.state,
        message.code ? new OnlineApiError({ status: 0, code: message.code }) : undefined,
      );
      return;
    case "error":
      handlers.onError?.(new OnlineApiError({ status: 0, code: message.code }));
      return;
    default:
      // A kind this build does not know (E6-15).
      return;
  }
}

/** Follow match `matchId`: `onFrame` gets each frame after `lastSeq` (0 from kick-off). */
export function watchMatch(
  matchId: string,
  lastSeq: number,
  onFrame: (frame: MatchFrame) => void,
  handlers: WatchHandlers = {},
): Promise<StopWatching> {
  return watchChannel(`match:${matchId}`, lastSeq, (message) =>
    dispatch(
      message,
      (data) => {
        if (data.kind === "frame") onFrame(data.data as MatchFrame);
      },
      handlers,
    ),
  );
}

/** Follow league `leagueId`: `onNotice` is told each fixture that changed (read the league again). */
export function watchLeague(
  leagueId: string,
  onNotice: (notice: LeagueNotice) => void,
  handlers: WatchHandlers = {},
): Promise<StopWatching> {
  return watchChannel(`league:${leagueId}`, undefined, (message) =>
    dispatch(
      message,
      (data) => {
        if (data.kind === "notice") onNotice(data.data as LeagueNotice);
      },
      handlers,
    ),
  );
}
