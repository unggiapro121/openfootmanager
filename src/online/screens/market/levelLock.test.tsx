import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import { fail, ok, renderOnline, resetOnline } from "../../../test-utils/onlineTestKit";
import {
  ACCOUNT,
  auction,
  EMPTY_MARKET,
  finance,
  MY_CLUB,
  sentTo,
  serveMarket,
} from "./marketTestKit";

// Keys stand for the text, with their values after a colon.
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object"
        ? `${key}:${Object.values(options as Record<string, unknown>).join("|")}`
        : key,
    i18n: { language: "en" },
  }),
}));

let server: ReturnType<typeof serveMarket>;
let realtime: ReturnType<typeof fakeRealtime>;

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.useRealTimers();
});

const PLAYER_CAP = {
  canBid: false,
  requiredLevel: 7,
  bidRefusal: { code: "be.error.auction.levelCapPlayer", params: { requiredLevel: 7, cap: 74 } },
};
const SQUAD_CAP = {
  canBid: false,
  requiredLevel: 2,
  bidRefusal: {
    code: "be.error.auction.levelCapSquad",
    params: { requiredLevel: 2, level: 1, squadCap: 630, after: 641 },
  },
};

describe("the level lock on the market (C-7a2)", () => {
  // Given two open auctions, one a level cap stops the coach from bidding on and one it does not,
  // when the market opens,
  // then the first row carries the level it needs and the other carries no "can bid" mark.
  it("marks a locked row with the level it needs and no other row", async () => {
    server = serveMarket({
      "GET v1/auctions": ok({
        items: [auction({ ...PLAYER_CAP }), auction({ id: "a-2", playerId: "p8", canBid: true })],
      }),
    });
    renderOnline("/online/market");
    await screen.findAllByRole("link", { name: "Trần Văn Bình" });

    const rows = screen.getAllByRole("row").slice(1);
    expect(
      within(rows[0] as HTMLElement).getByText("online.market.levelLock.badge:7"),
    ).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByText(/online\.market\.levelLock/)).toBeNull();
  });

  // Given the open filter panel,
  // when the coach turns on "hide players over my level caps",
  // then the market asks the server for biddable auctions, keeps it in the address, and says the
  // auctions the coach leads are still under "My auctions".
  it("asks for biddable auctions and says where the led ones went", async () => {
    server = serveMarket({ "GET v1/auctions": ok({ items: [auction()] }) });
    renderOnline("/online/market");
    await screen.findByText("Trần Văn Bình");

    fireEvent.click(screen.getByRole("button", { name: "playerFilters.button" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "online.market.filter.biddable" }));

    await waitFor(() => {
      const reads = sentTo(server, "GET", "v1/auctions");
      expect(reads[reads.length - 1]?.query).toEqual(
        expect.arrayContaining([["biddable", "true"]]),
      );
    });
    expect(screen.getByText("online.market.filter.biddableHint")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "online.market.filter.biddableHintLink" }));
    expect(await screen.findByRole("tab", { name: "online.market.tabMine" })).toBeTruthy();
  });

  // Given an address that already asks for biddable auctions,
  // when the market opens,
  // then the first read carries it.
  it("reads the biddable filter from the address", async () => {
    server = serveMarket();
    renderOnline("/online/market?biddable=true");
    await waitFor(() =>
      expect(sentTo(server, "GET", "v1/auctions")[0]?.query).toEqual(
        expect.arrayContaining([["biddable", "true"]]),
      ),
    );
  });
});

describe("the level lock on an auction (C-7a2)", () => {
  // Given an auction whose player is over the coach's player cap (cap 74, level 7 needed),
  // when its page opens,
  // then the bid box gives way to a lock that says why, what the caps are, and links the road.
  it("puts the player cap's lock in place of the bid", async () => {
    server = serveMarket({ "GET v1/auctions/a-1": ok(auction({ ...PLAYER_CAP })) });
    renderOnline("/online/auctions/a-1");

    expect(await screen.findByText("be.error.auction.levelCapPlayer:7|74")).toBeTruthy();
    expect(screen.queryByLabelText("online.market.yourBid")).toBeNull();
    expect(screen.queryByRole("button", { name: "online.market.bid" })).toBeNull();
    expect(screen.getByText("online.market.levelLock.explain")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "online.market.levelLock.roadmap" }));
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "location" }).textContent).toBe("/online/profile"),
    );
  });

  // Given an auction that would take the squad's buying strength to 641 tenths, over the 630 of
  // level 1,
  // when its page opens,
  // then the lock reads the two strengths as 64.1 and 63.0.
  it("reads the squad cap's strengths in tenths", async () => {
    server = serveMarket({ "GET v1/auctions/a-1": ok(auction({ ...SQUAD_CAP })) });
    renderOnline("/online/auctions/a-1");
    expect(await screen.findByText("be.error.auction.levelCapSquad:2|1|63.0|64.1")).toBeTruthy();
  });

  // Given an auction the level caps let the coach bid on, and a club with less cash than the
  // least bid,
  // when its page opens,
  // then the bid box is there and still refuses the bid for the cash: `canBid` is no green light.
  it("keeps every check of the bid box when the caps let the coach bid", async () => {
    server = serveMarket({
      "GET v1/auctions/a-1": ok(auction({ canBid: true })),
      "GET v1/clubs/mine/finance": ok(finance({ cash: 100_000 })),
    });
    renderOnline("/online/auctions/a-1");
    await screen.findByLabelText("online.market.yourBid");
    await waitFor(() => expect(screen.getByText(/online\.market\.problem\.overCash/)).toBeTruthy());
    expect(
      (screen.getByRole("button", { name: "online.market.bid" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  // Given an auction the caps let the coach bid on, and a server that refuses the bid as the
  // squad is full,
  // when the coach bids,
  // then the market's own sentence for a full squad shows.
  it("shows the server's other refusals when the caps let the coach bid", async () => {
    server = serveMarket({
      "GET v1/auctions/a-1": ok(auction({ canBid: true })),
      "POST v1/auctions/a-1/bids": fail(409, "be.error.auction.squadFull"),
    });
    renderOnline("/online/auctions/a-1");
    await screen.findByLabelText("online.market.yourBid");
    fireEvent.click(screen.getByRole("button", { name: "online.market.bid" }));
    // The shared resolver translates a code without parameters, so the English sentence shows.
    expect((await screen.findByRole("alert")).textContent).toMatch(/more players than the market/);
  });

  // Given an auction the caps let the coach bid on when it was read, and a squad that grew past
  // the cap before the bid,
  // when the coach bids and the server refuses it with the squad cap,
  // then the refusal reads its strengths in tenths and the auction is read again.
  it("reads the auction again after a level cap refusal", async () => {
    server = serveMarket({
      "GET v1/auctions/a-1": ok(auction({ canBid: true })),
      "POST v1/auctions/a-1/bids": fail(409, "be.error.auction.levelCapSquad", {
        details: { params: SQUAD_CAP.bidRefusal.params },
      }),
    });
    renderOnline("/online/auctions/a-1");
    await screen.findByLabelText("online.market.yourBid");
    fireEvent.click(screen.getByRole("button", { name: "online.market.bid" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "be.error.auction.levelCapSquad:2|1|63.0|64.1",
    );
    await waitFor(() => expect(sentTo(server, "GET", "v1/auctions/a-1")).toHaveLength(2));
  });

  // Given cancelled auctions, closed for the level caps, for the player gone, and for no reason
  // the server gave,
  // when each page opens,
  // then each says its own reason, and the last only that it was cancelled.
  it.each([
    ["buyCapExceeded", "online.market.result.capExceeded"],
    ["playerGone", "online.market.result.playerGone"],
    ["withdrawn", "online.market.result.cancelled"],
    [undefined, "online.market.result.cancelled"],
  ])("says why a cancelled auction closed (%s)", async (closedReason, sentence) => {
    server = serveMarket({
      "GET v1/auctions/a-1": ok(auction({ status: "cancelled", closedReason })),
    });
    renderOnline("/online/auctions/a-1");
    expect((await screen.findByRole("status", { name: "" })).textContent).toBe(sentence);
  });
});

describe("an auction cancelled for the level caps (C-7a2)", () => {
  async function accountChannel() {
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);
    return (data: Record<string, unknown>) =>
      act(() =>
        watch?.speak({
          kind: "notice",
          channel: `account:${ACCOUNT}`,
          data: { kind: "market", event: "cancelled", auctionId: "a-3", ...data },
        }),
      );
  }

  const inMarket = () =>
    serveMarket({
      "GET v1/clubs/mine/market": ok({
        ...EMPTY_MARKET,
        recent: [auction({ id: "a-3", status: "cancelled", sellerClubId: MY_CLUB })],
      }),
    });

  // Given the coach's club left out of an auction for being over the caps (level 3 needed),
  // when the ring comes,
  // then the notice says so and names the level.
  it("tells a club left out the level it needs", async () => {
    server = inMarket();
    renderOnline("/online/league");
    const ring = await accountChannel();
    ring({ reason: "buyCapExceeded", requiredLevel: 3 });
    const region = await screen.findByRole("region", { name: "online.market.notice.region" });
    expect(
      await within(region).findByText("online.market.notice.cancelledCapClub:Trần Văn Bình|3"),
    ).toBeTruthy();
  });

  // Given the seller of an auction whose winner was over the caps, and the player up again in a
  // new auction a-9,
  // when the ring comes,
  // then the notice says he is up again and opens the new auction.
  it("opens the new auction for a seller whose player is up again", async () => {
    server = inMarket();
    renderOnline("/online/league");
    const ring = await accountChannel();
    ring({ reason: "buyCapExceeded", relistedAuctionId: "a-9" });
    const region = await screen.findByRole("region", { name: "online.market.notice.region" });
    fireEvent.click(
      await within(region).findByRole("link", {
        name: "online.market.notice.cancelledCapRelisted:Trần Văn Bình",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "location" }).textContent).toBe(
        "/online/auctions/a-9",
      ),
    );
  });

  // Given rings for a seller whose player is not up yet, for a player gone, for a withdrawal, for
  // a reason this build does not know and for none,
  // when each comes,
  // then the first two have their own sentence and the rest the plain one.
  it.each([
    [{ reason: "buyCapExceeded" }, "online.market.notice.cancelledCapSeller:Trần Văn Bình"],
    [{ reason: "playerGone" }, "online.market.notice.cancelledPlayerGone:Trần Văn Bình"],
    [{ reason: "withdrawn" }, "online.market.notice.cancelled:Trần Văn Bình|"],
    [{ reason: "somethingNew" }, "online.market.notice.cancelled:Trần Văn Bình|"],
    [{}, "online.market.notice.cancelled:Trần Văn Bình|"],
  ])("says why an auction was cancelled (%o)", async (data, sentence) => {
    server = inMarket();
    renderOnline("/online/league");
    const ring = await accountChannel();
    ring(data);
    const region = await screen.findByRole("region", { name: "online.market.notice.region" });
    expect(await within(region).findByText(sentence)).toBeTruthy();
  });
});
