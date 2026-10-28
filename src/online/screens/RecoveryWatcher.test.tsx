import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServer, myClub, ok, resetOnline } from "../../test-utils/onlineTestKit";
import type { MyClubView, TrainingDayView } from "../api";
import { useOnlineStore } from "../store/onlineStore";
import { AFTER_MARK_MS, MIN_GAP_MS, RecoveryWatcher, RETRY_MS } from "./RecoveryWatcher";

const MINUTE = 60_000;
let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resetOnline();
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2099-01-01T05:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  server?.restore();
});

function withMark(nextRecoveryAt: string | number): MyClubView {
  const at =
    typeof nextRecoveryAt === "number" ? new Date(nextRecoveryAt).toISOString() : nextRecoveryAt;
  const trainingDay: TrainingDayView = {
    day: 3,
    recent: [],
    canTrain: true,
    sessionsLast7: 0,
    sessionsCap: 6,
    nextRecoveryAt: at,
    recovery: { perDay: 6, hours: 8 },
    autoOff: false,
  };
  return myClub({ trainingDay });
}

const clubReads = () => server.requests.filter((r) => r.segments.join("/") === "v1/clubs/mine");

async function pass(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

describe("the recovery watcher", () => {
  // Given a season without recovery blocks (no trainingDay),
  // when ten minutes pass,
  // then the club is never read for recovery.
  it("reads nothing without recovery blocks", async () => {
    server = fakeServer({ "GET v1/clubs/mine": ok(myClub()) });
    useOnlineStore.getState().setClub(myClub());
    render(<RecoveryWatcher />);
    await pass(10 * MINUTE);
    expect(clubReads()).toHaveLength(0);
  });

  // Given the next mark in five minutes, and the server's next mark four hours on after it,
  // when the mark passes,
  // then the club is read once, a second after it, and then not again until the new mark.
  it("reads the club once a second after each mark", async () => {
    const mark = Date.now() + 5 * MINUTE;
    const next = mark + 240 * MINUTE;
    server = fakeServer({ "GET v1/clubs/mine": ok(withMark(next)) });
    useOnlineStore.getState().setClub(withMark(mark));
    render(<RecoveryWatcher />);
    await pass(5 * MINUTE + AFTER_MARK_MS - 1);
    expect(clubReads()).toHaveLength(0);
    await pass(1);
    expect(clubReads()).toHaveLength(1);
    await pass(200 * MINUTE);
    expect(clubReads()).toHaveLength(1);
    await pass(40 * MINUTE + AFTER_MARK_MS);
    expect(clubReads()).toHaveLength(2);
  });

  // Given a server whose clock is behind: the read at the mark still answers the same mark,
  // when time passes,
  // then the club is read once more 5 s later, and then left alone.
  it("retries once when the mark did not move", async () => {
    const mark = Date.now() + MINUTE;
    server = fakeServer({ "GET v1/clubs/mine": () => ok(withMark(mark)) });
    useOnlineStore.getState().setClub(withMark(mark));
    render(<RecoveryWatcher />);
    await pass(MINUTE + AFTER_MARK_MS);
    expect(clubReads()).toHaveLength(1);
    await pass(RETRY_MS);
    expect(clubReads()).toHaveLength(2);
    await pass(10 * MINUTE);
    expect(clubReads()).toHaveLength(2);
  });

  // Given a region the server does not know (it answers with now as the next mark), or a mark
  // already past,
  // when ten minutes pass,
  // then the club is not read over and over: at most one read and one retry.
  it.each([
    ["now", () => Date.now()],
    ["past", () => Date.now() - 5 * MINUTE],
  ])("does not loop on a mark that is %s", async (_name, markOf) => {
    server = fakeServer({ "GET v1/clubs/mine": () => ok(withMark(markOf())) });
    useOnlineStore.getState().setClub(withMark(markOf()));
    render(<RecoveryWatcher />);
    await pass(10 * MINUTE);
    expect(clubReads().length).toBeLessThanOrEqual(2);
  });

  // Given two marks 30 s apart (a season of very short days),
  // when both pass,
  // then the second read waits until 60 s after the first.
  it("keeps 60 s between two reads", async () => {
    const first = Date.now() + MINUTE;
    const second = first + 30_000;
    server = fakeServer({ "GET v1/clubs/mine": ok(withMark(second)) });
    useOnlineStore.getState().setClub(withMark(first));
    render(<RecoveryWatcher />);
    await pass(MINUTE + AFTER_MARK_MS);
    expect(clubReads()).toHaveLength(1);
    server.routes["GET v1/clubs/mine"] = ok(withMark(second + 240 * MINUTE));
    await pass(30_000);
    expect(clubReads()).toHaveLength(1);
    await pass(MIN_GAP_MS - 30_000);
    expect(clubReads()).toHaveLength(2);
  });
});
