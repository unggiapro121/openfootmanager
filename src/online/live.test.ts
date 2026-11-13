import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type RealtimeMessage, setOnlineRealtime } from "../services/onlineRealtime";
import type { MatchFrame } from "./api";
import type { OnlineApiError } from "./errors";
import { readAccountRing, watchAccount, watchLeague, watchMatch } from "./live";

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

  // Given the online shell of a signed-in coach,
  // when it watches the coach's own account and the client hands it a ring,
  // then it watched `account:<id>` with no step, and the ring reaches it (S-12).
  it("follows the coach's own account channel", async () => {
    const rings: unknown[] = [];
    await watchAccount(MATCH, (notice) => rings.push(notice));
    const [watch] = realtime.watches;
    expect(watch).toMatchObject({ channel: `account:${MATCH}`, lastSeq: undefined });

    watch?.speak({ kind: "notice", channel: `account:${MATCH}`, data: { kind: "friendly" } });

    expect(rings).toEqual([{ kind: "friendly" }]);
  });
});

describe("readAccountRing", () => {
  // Given rings of the coach's account: a friendly, a market event, a change of coins (C-7a1),
  // an item event (C-7b), an academy event (C-7c), an event's (C-7d), a scouting report back (C-24b), one of a kind this build does not know, and
  // something that is not a ring,
  // when they are read,
  // then each known kind keeps what it carries, and the rest is `unknown` (E6-15).
  it("reads the coins' finance ring beside the friendly and market ones", () => {
    expect(readAccountRing({ kind: "friendly" })).toEqual({ kind: "friendly" });
    expect(readAccountRing({ kind: "finance" })).toEqual({ kind: "finance" });
    expect(readAccountRing({ kind: "market", event: "won", auctionId: "a-1" })).toEqual({
      kind: "market",
      event: "won",
      auctionId: "a-1",
    });
    expect(readAccountRing({ kind: "items", event: "granted", itemCode: "timeSkip" })).toEqual({
      kind: "items",
      event: "granted",
      itemCode: "timeSkip",
    });
    expect(
      readAccountRing({ kind: "items", event: "revoked", itemCode: "timeSkip", quantity: 2 }),
    ).toEqual({ kind: "items", event: "revoked", itemCode: "timeSkip", quantity: 2 });
    expect(readAccountRing({ kind: "items", event: 7, quantity: "2" })).toEqual({ kind: "items" });
    expect(readAccountRing({ kind: "academy", event: "scoutDone", tripId: "t-1" })).toEqual({
      kind: "academy",
      event: "scoutDone",
      tripId: "t-1",
    });
    expect(readAccountRing({ kind: "academy", tripId: 7 })).toEqual({ kind: "academy" });
    expect(readAccountRing({ kind: "event", event: "completed", eventId: "e-1" })).toEqual({
      kind: "event",
      event: "completed",
      eventId: "e-1",
    });
    expect(readAccountRing({ kind: "event", eventId: 7 })).toEqual({ kind: "event" });
    expect(readAccountRing({ kind: "opponentReport", event: "ready", reportId: "r-1" })).toEqual({
      kind: "opponentReport",
      event: "ready",
      reportId: "r-1",
    });
    expect(readAccountRing({ kind: "opponentReport", reportId: 7 })).toEqual({
      kind: "opponentReport",
    });
    expect(
      readAccountRing({ kind: "facilities", event: "completed", facility: "stands", level: 4 }),
    ).toEqual({ kind: "facilities", event: "completed", facility: "stands", level: 4 });
    expect(readAccountRing({ kind: "facilities", level: "4" })).toEqual({ kind: "facilities" });
    expect(readAccountRing({ kind: "auction" })).toEqual({ kind: "unknown" });
    expect(readAccountRing("finance")).toEqual({ kind: "unknown" });
  });
});
