import { type RealtimeMessage, watchChannel } from "../services/onlineRealtime";
import type { AuctionNotice, LeagueNotice, MatchFrame } from "./api";
import { OnlineApiError } from "./errors";

/**
 * Following a live match, a league or the coach's own account (phase 3 S-8e, S-8-tech-spec.md
 * §3.10; S-12). Open a match with
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

/**
 * Follow auction `auctionId` (S11-11, C-5 C5-7): `onNotice` is told each bid and the close; read
 * the auction again for the rest. A notice whose `seq` is not newer than one already seen is old.
 */
export function watchAuction(
  auctionId: string,
  onNotice: (notice: AuctionNotice) => void,
  handlers: WatchHandlers = {},
): Promise<StopWatching> {
  return watchChannel(`auction:${auctionId}`, undefined, (message) =>
    dispatch(
      message,
      (data) => {
        if (data.kind === "notice") onNotice(data.data as AuctionNotice);
      },
      handlers,
    ),
  );
}

/**
 * Follow the coach's own account (S-12): `onRing` is told their friendly changed; read
 * `online.friendlies.mine` again. Holding it is what keeps a queued coach present.
 */
export function watchAccount(
  accountId: string,
  onRing: (ring: unknown) => void,
  handlers: WatchHandlers = {},
): Promise<StopWatching> {
  return watchChannel(`account:${accountId}`, undefined, (message) =>
    dispatch(
      message,
      (data) => {
        if (data.kind === "notice") onRing(data.data);
      },
      handlers,
    ),
  );
}

/** What a ring of the coach's account says: whose news it is, and for the market which (C-5). */
export type AccountRing =
  | { kind: "friendly" }
  /** The coach's coins changed, by any path (S-15, C-7s): read them and the club's money again. */
  | { kind: "finance" }
  | {
      kind: "market";
      event?: "outbid" | "won" | "sold" | "unsold" | "cancelled" | "forced" | string;
      auctionId?: string;
      /** Why a `cancelled` auction was (S-16 R16-5): `buyCapExceeded`, `playerGone`, … */
      reason?: string;
      /** For a club the level caps left out: the coach level it needs. */
      requiredLevel?: number;
      /** For the seller of an auction cancelled for the caps: the player's new auction. */
      relistedAuctionId?: string;
    }
  /**
   * The coach's items changed (S-17, C-7b): given (`granted`), used, bought, a purchase refunded,
   * or an event this build does not know. The inventory is read again for any of them.
   */
  | {
      kind: "items";
      event?: "granted" | "used" | "bought" | "refunded" | string;
      itemCode?: string;
    }
  /**
   * The club's academy (S-18, C-7c): a scouting trip is back with its report (`scoutDone`), or an
   * event this build does not know. The academy is read again for any of them.
   */
  | { kind: "academy"; event?: "scoutDone" | string; tripId?: string }
  /**
   * The coach's events (S-19, C-7d): a mission's progress moved (`progress`), one finished
   * (`completed`), or an event this build does not know. The events are read again for any of
   * them; the ring names the event, never the mission.
   */
  | { kind: "event"; event?: "progress" | "completed" | string; eventId?: string }
  | { kind: "unknown" };

/** Read a ring of the account channel; a kind this build does not know is `unknown` (E6-15). */
export function readAccountRing(data: unknown): AccountRing {
  if (typeof data !== "object" || data === null) return { kind: "unknown" };
  const ring = data as {
    kind?: unknown;
    event?: unknown;
    auctionId?: unknown;
    reason?: unknown;
    requiredLevel?: unknown;
    relistedAuctionId?: unknown;
    itemCode?: unknown;
    tripId?: unknown;
    eventId?: unknown;
  };
  if (ring.kind === "friendly") return { kind: "friendly" };
  if (ring.kind === "finance") return { kind: "finance" };
  if (ring.kind === "market") {
    return {
      kind: "market",
      event: typeof ring.event === "string" ? ring.event : undefined,
      auctionId: typeof ring.auctionId === "string" ? ring.auctionId : undefined,
      reason: typeof ring.reason === "string" ? ring.reason : undefined,
      requiredLevel: typeof ring.requiredLevel === "number" ? ring.requiredLevel : undefined,
      relistedAuctionId:
        typeof ring.relistedAuctionId === "string" ? ring.relistedAuctionId : undefined,
    };
  }
  if (ring.kind === "items") {
    return {
      kind: "items",
      event: typeof ring.event === "string" ? ring.event : undefined,
      itemCode: typeof ring.itemCode === "string" ? ring.itemCode : undefined,
    };
  }
  if (ring.kind === "academy") {
    return {
      kind: "academy",
      event: typeof ring.event === "string" ? ring.event : undefined,
      tripId: typeof ring.tripId === "string" ? ring.tripId : undefined,
    };
  }
  if (ring.kind === "event") {
    return {
      kind: "event",
      event: typeof ring.event === "string" ? ring.event : undefined,
      eventId: typeof ring.eventId === "string" ? ring.eventId : undefined,
    };
  }
  return { kind: "unknown" };
}
