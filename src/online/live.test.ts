import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type RealtimeMessage, setOnlineRealtime } from "../services/onlineRealtime";
import type { MatchFrame } from "./api";
import type { OnlineApiError } from "./errors";
import { watchLeague, watchMatch } from "./live";

const MATCH = "0192f0c4-0000-7000-8000-0000000000aa";
const LEAGUE = "0192f0c4-0000-7000-8000-0000000000cc";

/** A fake realtime transport: records each watch and lets the test speak on it. */
function fakeRealtime() {
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
  return { watches, restore };
}

let realtime: ReturnType<typeof fakeRealtime>;

beforeEach(() => {
  realtime = fakeRealtime();
});

afterEach(() => {
  realtime.restore();
});

describe("live watches", () => {
  // Given a screen that opened a match at step 12,
  // when it watches the match and the client hands it two frames, a status and a refusal,
  // then it watched `match:<id>` from 12, got the frames' data in order, the status, and the
  // refusal as an error with its code; stopping stops the watch.
  it("follows a match from the view's last step", async () => {
    const frames: MatchFrame[] = [];
    const states: string[] = [];
    const errors: OnlineApiError[] = [];
    const stop = await watchMatch(MATCH, 12, (frame) => frames.push(frame), {
      onStatus: (state) => states.push(state),
      onError: (error) => errors.push(error),
    });
    const [watch] = realtime.watches;
    expect(watch).toMatchObject({ channel: `match:${MATCH}`, lastSeq: 12 });

    watch?.speak({ kind: "status", state: "open" });
    watch?.speak({ kind: "frame", channel: `match:${MATCH}`, seq: 13, data: { seq: 13 } });
    watch?.speak({ kind: "frame", channel: `match:${MATCH}`, seq: 14, data: { seq: 14 } });
    watch?.speak({
      kind: "error",
      channel: `match:${MATCH}`,
      code: "be.error.realtime.tooManyChannels",
    });

    expect(frames.map((frame) => frame.seq)).toEqual([13, 14]);
    expect(states).toEqual(["open"]);
    expect(errors.map((error) => error.code)).toEqual(["be.error.realtime.tooManyChannels"]);
    await stop();
    expect(watch?.stopped).toBe(true);
  });

  // Given a screen following its league,
  // when the client hands it a notice, then says the session is over,
  // then the notice reaches the screen, and the closing carries `notSignedIn` as an error.
  it("follows a league's notices and tells when the session is over", async () => {
    const notices: unknown[] = [];
    let closedWith: OnlineApiError | undefined;
    await watchLeague(LEAGUE, (notice) => notices.push(notice), {
      onStatus: (state, error) => {
        if (state === "closed") closedWith = error;
      },
    });
    const [watch] = realtime.watches;
    expect(watch).toMatchObject({ channel: `league:${LEAGUE}`, lastSeq: undefined });

    watch?.speak({
      kind: "notice",
      channel: `league:${LEAGUE}`,
      data: { fixtureId: MATCH, status: "settled" },
    });
    watch?.speak({ kind: "status", state: "closed", code: "be.error.online.notSignedIn" });

    expect(notices).toEqual([{ fixtureId: MATCH, status: "settled" }]);
    expect(closedWith?.code).toBe("be.error.online.notSignedIn");
  });
});
