import { useCallback, useEffect, useRef, useState } from "react";
import type { MatchFrame, MatchView, MineView, SentCommand } from "../../api";
import type { MatchCommand } from "../../api/engine";
import { online } from "../../client";
import {
  applyFrame,
  initialMatchState,
  type OnlineMatchState,
  withHistory,
  withSides,
} from "../../convert/matchState";
import { OnlineApiError } from "../../errors";
import { type StopWatching, watchMatch } from "../../live";
import { tracked } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";

/** Frames read per page of a match's history (the server's ceiling). */
const FRAME_PAGE = 120;

export type Connection = "connecting" | "open" | "reconnecting" | "closed";

export interface LiveMatchData {
  view: MatchView;
  state: OnlineMatchState;
  /** The viewer's own side, or null for a spectator (S8-15). */
  mine: MineView | null;
  /** The viewer's commands, newest last; outcomes not yet read again are in `state.outcomes`. */
  sent: SentCommand[];
  connection: Connection;
  /** Why the gateway refused to follow this match, if it did. */
  watchError: OnlineApiError | null;
  /** Whether the viewer's side has been theirs since the match was opened. */
  everCoached: boolean;
}

export type LiveMatch =
  | { status: "loading" }
  | { status: "failed"; error: unknown }
  | { status: "ready"; data: LiveMatchData };

async function readFrames(matchId: string, afterSeq: number, upTo?: number) {
  const frames: MatchFrame[] = [];
  let after = afterSeq;
  for (;;) {
    const page = await online.matches.frames(matchId, after, FRAME_PAGE);
    frames.push(...page.frames);
    const next = page.nextAfterSeq;
    if (next === undefined || page.frames.length === 0) return frames;
    if (upTo !== undefined && next >= upTo) return frames;
    after = next;
  }
}

async function readMine(matchId: string): Promise<MineView | null> {
  try {
    return await online.matches.mine(matchId);
  } catch (error) {
    // Not a side's coach: a spectator, with no side of their own to see (Qs8-6).
    if (error instanceof OnlineApiError && error.status === 404) return null;
    throw error;
  }
}

const coaches = (data: Pick<LiveMatchData, "mine" | "state">) =>
  data.mine !== null &&
  data.state.controllers[data.mine.side === "Home" ? "home" : "away"] === "Manager";

/**
 * A match, opened and followed (C-2 §3.6, C2-9): its view, the viewer's own side, its history
 * from the frames, then every frame after it as the server publishes it. A missed frame is read
 * again; a frame that changed a side in sight reads the sides again; a frame deciding commands
 * reads the viewer's side again, for each refusal's reason (C2-11). A finished match is read, not
 * followed.
 */
export function useLiveMatch(matchId: string) {
  const [live, setLive] = useState<LiveMatch>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const latest = useRef<LiveMatchData | null>(null);
  const key = useActionKey();

  useEffect(() => {
    let active = true;
    let stop: StopWatching | null = null;
    let queue = Promise.resolve();
    latest.current = null;
    setLive({ status: "loading" });

    const publish = (patch: Partial<LiveMatchData>) => {
      const current = latest.current;
      if (!active || !current) return;
      const next = { ...current, ...patch };
      next.everCoached = current.everCoached || coaches(next);
      latest.current = next;
      setLive({ status: "ready", data: next });
    };

    const take = async (frame: MatchFrame, refilled = false): Promise<void> => {
      const current = latest.current;
      if (!active || !current) return;
      const result = applyFrame(current.state, frame);
      if (result.kind === "stale") return;
      if (result.kind === "gap") {
        if (refilled) {
          reload();
          return;
        }
        const missed = await readFrames(matchId, result.afterSeq, frame.seq - 1);
        for (const before of missed.filter((one) => one.seq < frame.seq)) await take(before, true);
        await take(frame, true);
        return;
      }
      let state = result.state;
      let mine = current.mine;
      let sent = current.sent;
      if (result.sidesChanged) state = withSides(state, await online.matches.byId(matchId));
      if (mine !== null && frame.commands.length > 0) {
        mine = (await readMine(matchId)) ?? mine;
        sent = mine.commands;
      }
      publish({ state, mine, sent });
    };

    const open = async () => {
      const view = await online.matches.byId(matchId);
      const [mine, frames] = await Promise.all([
        readMine(matchId),
        view.lastSeq > 0 ? readFrames(matchId, 0, view.lastSeq) : Promise.resolve([]),
      ]);
      if (!active) return;
      const state = withHistory(initialMatchState(view), frames);
      const data: LiveMatchData = {
        view,
        state,
        mine,
        sent: mine?.commands ?? [],
        connection: "connecting",
        watchError: null,
        everCoached: false,
      };
      data.everCoached = coaches(data);
      latest.current = data;
      setLive({ status: "ready", data });
      if (view.status === "finished" || state.isFinished) return;
      const stopWatching = await watchMatch(
        matchId,
        state.lastSeq,
        (frame) => {
          queue = queue.then(() => take(frame)).catch(() => undefined);
        },
        {
          onStatus: (connection) => publish({ connection }),
          onError: (watchError) => publish({ watchError }),
        },
      );
      if (active) stop = stopWatching;
      else void stopWatching();
    };

    open().catch((error: unknown) => active && setLive({ status: "failed", error }));
    return () => {
      active = false;
      void stop?.();
    };
  }, [matchId, attempt, reload]);

  /** Send an order for the viewer's side; it waits for the next gap, where it is decided. */
  const send = useCallback(
    async (command: MatchCommand) => {
      const accepted = await key.run(
        (idempotencyKey) => tracked(() => online.matches.command(matchId, command, idempotencyKey)),
        JSON.stringify(command),
      );
      const current = latest.current;
      if (!current) return;
      const line: SentCommand = {
        commandId: accepted.commandId,
        command,
        status: "pending",
        sentAt: new Date().toISOString(),
      };
      const next = { ...current, sent: [...current.sent, line] };
      latest.current = next;
      setLive({ status: "ready", data: next });
    },
    [matchId, key],
  );

  return { live, reload, send };
}
