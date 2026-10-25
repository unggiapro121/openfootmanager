import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServer, LEAGUE, myClub, ok, resetOnline } from "../../test-utils/onlineTestKit";
import type { FixtureView, LeagueNotice } from "../api";
import { useOnlineStore } from "../store/onlineStore";
import { LeagueWatcher, POLL_MS, SETTLE_MS } from "./LeagueWatcher";

const watched: { leagueId: string; onNotice: (notice: LeagueNotice) => void }[] = [];
const stops: ReturnType<typeof vi.fn>[] = [];

vi.mock("../live", () => ({
  watchLeague: (leagueId: string, onNotice: (notice: LeagueNotice) => void) => {
    watched.push({ leagueId, onNotice });
    const stop = vi.fn(() => Promise.resolve());
    stops.push(stop);
    return Promise.resolve(stop);
  },
}));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resetOnline();
  watched.length = 0;
  stops.length = 0;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  server?.restore();
});

function fixture(overrides: Partial<FixtureView>): FixtureView {
  return {
    id: "f-22",
    leagueId: "league-1",
    round: 22,
    kickoffAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    status: "prepared",
    home: { id: "c", name: "Home" },
    away: { id: "d", name: "Away" },
    ...overrides,
  } as FixtureView;
}

const clubReads = () => server.requests.filter((r) => r.segments.join("/") === "v1/clubs/mine");
const leagueReads = () => server.requests.filter((r) => r.segments.join("/") === "v1/leagues/mine");

describe("the league watcher", () => {
  // Given a coach in a league,
  // when a burst of fixture notices comes on the league's channel (a round settling),
  // then the club and the league are read again once, after the burst, so the next fixture and
  // the lineup lock are the server's again.
  it("reads the club and the league again after the league's notices", async () => {
    server = fakeServer({ "GET v1/clubs/mine": ok(myClub()), "GET v1/leagues/mine": ok(LEAGUE) });
    useOnlineStore.getState().setClub(myClub({ leagueId: "league-1", nextFixture: fixture({}) }));
    render(<LeagueWatcher />);
    await act(async () => {});
    expect(watched.map((w) => w.leagueId)).toEqual(["league-1"]);

    act(() => {
      for (const id of ["f-21", "f-22", "f-23"])
        watched[0]?.onNotice({ fixtureId: id, status: "settled" });
    });
    expect(clubReads()).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(SETTLE_MS);
    });
    expect(clubReads()).toHaveLength(1);
    expect(leagueReads()).toHaveLength(1);
  });

  // Given a club whose next fixture has kicked off,
  // when time passes with no notice (the realtime connection down, say),
  // then the club is read again every POLL_MS, and not while the next fixture is still ahead.
  it("reads the club again while its next fixture is under way", async () => {
    server = fakeServer({ "GET v1/clubs/mine": ok(myClub()), "GET v1/leagues/mine": ok(LEAGUE) });
    const ahead = myClub({ leagueId: "league-1", nextFixture: fixture({}) });
    useOnlineStore.getState().setClub(ahead);
    const { unmount } = render(<LeagueWatcher />);
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS * 2);
    });
    expect(clubReads()).toHaveLength(0);
    unmount();

    const started = myClub({
      leagueId: "league-1",
      nextFixture: fixture({
        kickoffAt: new Date(Date.now() - 60_000).toISOString(),
        status: "prepared",
      }),
    });
    server.routes["GET v1/clubs/mine"] = ok(started);
    useOnlineStore.getState().setClub(started);
    render(<LeagueWatcher />);
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS * 2);
    });
    expect(clubReads().length).toBeGreaterThanOrEqual(2);
  });

  // Given a coach who leaves the online mode,
  // when the watcher is gone,
  // then it stops following the league's channel.
  it("stops following the league when it is gone", async () => {
    server = fakeServer({});
    useOnlineStore.getState().setClub(myClub({ leagueId: "league-1" }));
    const { unmount } = render(<LeagueWatcher />);
    await act(async () => {});
    unmount();
    await act(async () => {});
    expect(stops[0]).toHaveBeenCalled();
  });
});
