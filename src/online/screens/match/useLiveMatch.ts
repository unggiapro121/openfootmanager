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
import type { OnlineApiError } from "../../errors";
import { type StopWatching, watchMatch } from "../../live";
import { tracked } from "../../store/onlineStore";
import { useActionKey } from "../useActionKey";
import { readFrames, readMine } from "./matchReads";

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

/**
 * Steps with no frame before the frames are read from the server instead: the realtime can stop
 * bringing them while the match plays on, and the screen must not stand still on a minute the
 * match has left. The half-time break is not counted.
 */
const STALL_STEPS = 3;

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
    let watchdog: ReturnType<typeof setInterval> | undefined;
    /** When a frame was last applied, to tell a match the realtime stopped bringing. */
    let heardAt = Date.now();
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
      heardAt = Date.now();
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
          queue = queue.then(() => take(frame)).catch(failed);
        },
        {
          onStatus: (connection) => publish({ connection }),
          onError: (watchError) => publish({ watchError }),
        },
      );
      if (active) stop = stopWatching;
      else void stopWatching();
      watchdog = setInterval(() => readOnIfStalled(view), view.stepMillis);
    };

    const failed = (error: unknown) =>
      console.warn(`[online] match ${matchId}: a frame could not be applied`, error);

    const readOnIfStalled = (view: MatchView) => {
      const current = latest.current;
      if (!active || !current || current.state.isFinished) return;
      const breakMs = current.state.phase === "HalfTime" ? view.halfTimeMillis : 0;
      const silence = STALL_STEPS * view.stepMillis + breakMs;
      if (Date.now() - heardAt < silence) return;
      heardAt = Date.now();
      const after = current.state.lastSeq;
      console.warn(`[online] match ${matchId}: no frame after step ${after} for ${silence} ms`);
      queue = queue
        .then(async () => {
          for (const frame of await readFrames(matchId, after)) await take(frame);
        })
        .catch(failed);
    };

    open().catch((error: unknown) => active && setLive({ status: "failed", error }));
    return () => {
      active = false;
      clearInterval(watchdog);
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
