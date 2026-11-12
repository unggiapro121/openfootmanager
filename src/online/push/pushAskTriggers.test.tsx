import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, fakeServer, myClub, ok, resetOnline } from "../../test-utils/onlineTestKit";
import { auction } from "../screens/market/marketTestKit";
import { useBidSender } from "../screens/market/useBid";
import { useOnlineTacticsSource } from "../screens/useOnlineTacticsSource";
import { useOnlineStore } from "../store/onlineStore";

const ask = vi.hoisted(() => vi.fn());
vi.mock("./pushDevice", () => ({ askForPushOnce: ask }));

let server: ReturnType<typeof fakeServer>;

beforeEach(() => {
  resetOnline();
  ask.mockClear();
});
afterEach(() => server?.restore());

describe("when the app first asks to notify (D-P5-15)", () => {
  // Given an auction open to the coach,
  // when his bid goes through, and when another is refused,
  // then the ask is raised after the first only.
  it("asks after a bid that went through, not after a refusal", async () => {
    const view = auction();
    server = fakeServer({ [`POST v1/auctions/${view.id}/bids`]: ok(view) });
    const { result } = renderHook(() =>
      useBidSender(
        view,
        () => undefined,
        () => undefined,
      ),
    );

    await act(async () => result.current.send(view.minNextBid));
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(1));

    server.restore();
    server = fakeServer({
      [`POST v1/auctions/${view.id}/bids`]: fail(409, "be.error.auction.bidTooLow"),
    });
    await act(async () => result.current.send(view.minNextBid + 1));
    await vi.waitFor(() => expect(result.current.busy).toBe(false));
    expect(ask).toHaveBeenCalledTimes(1);
  });

  // Given the coach's club,
  // when his line-up is saved,
  // then the ask is raised.
  it("asks after a line-up saved", async () => {
    const start = myClub();
    useOnlineStore.getState().setClub(start);
    server = fakeServer({
      "PUT v1/clubs/mine/setup": ok({ ...start, version: start.version + 1 }),
    });
    const { result } = renderHook(() => useOnlineTacticsSource(start));

    await act(() => result.current.source.setFormation("4-3-3"));

    expect(ask).toHaveBeenCalledTimes(1);
  });
});
