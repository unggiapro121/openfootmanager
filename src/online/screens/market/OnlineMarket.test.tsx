import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import { fail, ok, renderOnline, resetOnline } from "../../../test-utils/onlineTestKit";
import { useOnlineStore } from "../../store/onlineStore";
import { ACCOUNT, auction, EMPTY_MARKET, MY_CLUB, sentTo, serveMarket } from "./marketTestKit";
import { NOTICE_MILLIS } from "./OnlineNotices";

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
const lastAuctionsRead = () => {
  const reads = sentTo(server, "GET", "v1/auctions");
  return reads[reads.length - 1];
};
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

describe("OnlineMarket", () => {
  // Given two pages of open auctions,
  // when the coach filters by defenders and an OVR from 60, then shows more,
  // then the filters are sent to the server and kept in the address, and the second page is read
  // from the first's cursor under the same filters.
  it("filters on the server, keeps the filters in the address and pages on", async () => {
    server = serveMarket({
      "GET v1/auctions": (request) =>
        request.query?.some(([name]) => name === "cursor")
          ? ok({ items: [auction({ id: "a-2", playerId: "p8" })] })
          : ok({ items: [auction()], nextCursor: "c-1" }),
    });
    renderOnline("/online/market");
    await screen.findByText("Trần Văn Bình");

    fireEvent.change(screen.getByLabelText("online.market.filter.position"), {
      target: { value: "Defender" },
    });
    fireEvent.change(screen.getByLabelText("online.market.filter.minOvr"), {
      target: { value: "60" },
    });
    await waitFor(() =>
      expect(lastAuctionsRead()?.query).toEqual(
        expect.arrayContaining([
          ["position", "Defender"],
          ["minOvr", "60"],
        ]),
      ),
    );
    expect(screen.getByRole("status", { name: "location" }).textContent).toBe("/online/market");
    fireEvent.click(await screen.findByRole("button", { name: "online.market.more" }));

    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: "Trần Văn Bình" })).toHaveLength(2),
    );
    expect(lastAuctionsRead()?.query).toEqual(
      expect.arrayContaining([
        ["cursor", "c-1"],
        ["position", "Defender"],
      ]),
    );
  });

  // Given a market address that carries filters (as after going back),
  // when the market opens,
  // then its first read sends those filters.
  it("reads the filters from the address", async () => {
    server = serveMarket();
    renderOnline("/online/market?position=Forward&maxAge=25");

    await waitFor(() =>
      expect(sentTo(server, "GET", "v1/auctions")[0]?.query).toEqual(
        expect.arrayContaining([
          ["position", "Forward"],
          ["maxAge", "25"],
        ]),
      ),
    );
    expect(
      (screen.getByLabelText("online.market.filter.position") as HTMLSelectElement).value,
    ).toBe("Forward");
  });

  // Given three loaded auctions,
  // when the coach sorts by OVR and then searches a name,
  // then the table orders by OVR, descending first, and only the matching player stays.
  it("sorts the loaded auctions by a column and searches them by name", async () => {
    const withPlayer = (id: string, fullName: string, ovr: number) => {
      const base = auction({ id, playerId: id });
      return { ...base, player: base.player && { ...base.player, fullName, ovr } };
    };
    server = serveMarket({
      "GET v1/auctions": ok({
        items: [
          withPlayer("a-1", "Alpha", 50),
          withPlayer("a-2", "Bravo", 80),
          withPlayer("a-3", "Cato", 65),
        ],
      }),
    });
    renderOnline("/online/market");
    await screen.findByText("Alpha");
    const names = () =>
      screen
        .getAllByRole("link")
        .map((link) => link.textContent)
        .filter((text) => ["Alpha", "Bravo", "Cato"].includes(text ?? ""));

    fireEvent.click(screen.getByRole("button", { name: "common.ovr" }));
    expect(names()).toEqual(["Bravo", "Cato", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "common.ovr" }));
    expect(names()).toEqual(["Alpha", "Cato", "Bravo"]);

    fireEvent.change(screen.getByLabelText("transfers.searchByName"), { target: { value: "cat" } });
    expect(names()).toEqual(["Cato"]);
  });

  // Given a season whose market is closed,
  // when the market opens on either tab,
  // then it says the market is closed, not that something failed.
  it("says a closed market is closed, not failed", async () => {
    server = serveMarket({
      "GET v1/auctions": fail(409, "be.error.auction.marketClosed"),
      "GET v1/clubs/mine/market": fail(409, "be.error.auction.marketClosed"),
    });
    renderOnline("/online/market");

    expect(await screen.findByText("online.market.closed")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "online.market.tabMine" }));
    expect(await screen.findByText("online.market.closed")).toBeTruthy();
  });

  // Given an auction of the coach's own club and one they lead,
  // when the market lists them,
  // then the first is marked as their club's and the second as led by them.
  it("marks the club's own auctions and the ones it leads", async () => {
    server = serveMarket({
      "GET v1/auctions": ok({
        items: [
          auction({ sellerClubId: MY_CLUB }),
          auction({ id: "a-2", currentPrice: 700_000, leaderClubId: MY_CLUB }),
        ],
      }),
    });
    renderOnline("/online/market");

    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(within(rows[0] as HTMLElement).getByText("online.market.yourClub")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("online.market.youLead")).toBeTruthy();
  });

  // Given an auction put up by a bot club and one by a person's club,
  // when the market lists them,
  // then only the bot's seller is marked AI, with its meaning for a screen reader.
  it("marks a club the AI runs", async () => {
    server = serveMarket({
      "GET v1/auctions": ok({
        items: [
          auction({ sellerName: "Bot FC", sellerIsBot: true }),
          auction({ id: "a-2", sellerName: "People FC" }),
        ],
      }),
    });
    renderOnline("/online/market");

    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(within(rows[0] as HTMLElement).getByText("online.market.aiClub")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).queryByText("online.market.aiClub")).toBeNull();
  });

  // Given a free agent the world put up beside a club's sale (S-11f),
  // when the market lists them,
  // then the free agent's seller reads as a free agent, not a nameless club, and is not marked AI.
  it("names a free agent's seller as a free agent", async () => {
    server = serveMarket({
      "GET v1/auctions": ok({
        items: [
          auction({
            sellerClubId: "00000000-0000-0000-0000-000000000000",
            sellerName: "",
            freeAgent: true,
          }),
          auction({ id: "a-2", sellerName: "People FC" }),
        ],
      }),
    });
    renderOnline("/online/market");

    const rows = (await screen.findAllByRole("row")).slice(1);
    expect(within(rows[0] as HTMLElement).getByText("online.market.freeAgent")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).queryByText("online.market.aiClub")).toBeNull();
    expect(within(rows[1] as HTMLElement).queryByText("online.market.freeAgent")).toBeNull();
  });

  // Given the club's market with one listing, one auction it holds money in and one it won,
  // when the coach opens their own tab,
  // then each group lists its auction with where the club stands.
  it("shows the club's own market by group", async () => {
    server = serveMarket({
      "GET v1/clubs/mine/market": ok({
        selling: [auction({ id: "s-1", sellerClubId: MY_CLUB })],
        holding: [auction({ id: "h-1", currentPrice: 700_000, leaderClubId: MY_CLUB })],
        recent: [
          auction({ id: "r-1", status: "settled", winnerClubId: MY_CLUB, currentPrice: 800_000 }),
        ],
      }),
    });
    renderOnline("/online/market?tab=mine");

    const selling = await screen.findByRole("list", { name: "online.market.selling" });
    expect(selling.textContent).toContain("online.market.standing.selling");
    expect(screen.getByRole("list", { name: "online.market.holding" }).textContent).toContain(
      "online.market.standing.leading",
    );
    expect(screen.getByRole("list", { name: "online.market.recent" }).textContent).toContain(
      "online.market.standing.bought",
    );
  });
});

describe("the market's entry in the sidebar", () => {
  // Given two market rings not yet seen,
  // when an online page shows, and then the market opens,
  // then the entry carries the count, and opening the market clears it.
  it("carries unseen market news until the market opens", async () => {
    server = serveMarket();
    renderOnline("/online/league");
    act(() => useOnlineStore.setState({ marketUnseen: 2 }));

    const entry = await screen.findByRole("button", { name: "online.nav.market (2)" });
    fireEvent.click(entry);

    await waitFor(() => expect(useOnlineStore.getState().marketUnseen).toBe(0));
    expect(screen.getByRole("button", { name: "online.nav.market" })).toBeTruthy();
  });
});

describe("putting a player up for auction", () => {
  // Given a player the server quotes at 1,000,000 with a band of 600,000 to 2,500,000 and a 10%
  // tax,
  // when the coach opens the listing from his card and confirms,
  // then the price opens at the floor with what the club keeps after tax, the listing is sent at
  // that price, and the new auction's page opens.
  it("lists from the quote and opens the new auction", async () => {
    server = serveMarket({
      "GET v1/clubs/mine/players/p1/listing-quote": ok({
        marketValue: 1_000_000,
        minPrice: 600_000,
        maxPrice: 2_500_000,
        endsAt: "2026-10-26T10:00:00Z",
        transferTaxPermille: 100,
      }),
      "POST v1/clubs/mine/listings": ok(auction({ id: "a-7", sellerClubId: MY_CLUB })),
      "GET v1/auctions/a-7": ok(auction({ id: "a-7", sellerClubId: MY_CLUB })),
    });
    renderOnline("/online/squad/p1");

    fireEvent.click(await screen.findByRole("button", { name: "online.market.list" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      ((await within(dialog).findByLabelText("online.market.startPrice")) as HTMLInputElement)
        .value,
    ).toBe("600,000");
    expect(within(dialog).getByText(/online\.market\.netAfterTax:.*540,000\|10/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "online.market.listConfirm" }));

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "location" }).textContent).toBe(
        "/online/auctions/a-7",
      ),
    );
    expect(sentTo(server, "POST", "v1/clubs/mine/listings")[0]?.body).toEqual({
      playerId: "p1",
      startPrice: 600_000,
    });
  });

  // Given a player the quote refuses because he changed clubs too recently,
  // when the coach opens the listing,
  // then the reason shows, with its date, before they can confirm, and confirming is off.
  it("shows why a listing would be refused before confirming", async () => {
    server = serveMarket({
      "GET v1/clubs/mine/players/p1/listing-quote": ok({
        refusal: {
          code: "be.error.auction.cooldownActive",
          params: { until: "2026-10-30T10:00:00Z" },
        },
      }),
    });
    renderOnline("/online/squad/p1");

    fireEvent.click(await screen.findByRole("button", { name: "online.market.list" }));
    const dialog = await screen.findByRole("dialog");
    const reason = await within(dialog).findByRole("alert");
    expect(reason.textContent).toMatch(/be\.error\.auction\.cooldownActive:.*Oct/);
    expect(
      (
        within(dialog).getByRole("button", {
          name: "online.market.listConfirm",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  // Given a player already up for auction,
  // when his card shows,
  // then it links to his auction instead of offering to list him.
  it("links a listed player to his auction", async () => {
    server = serveMarket({
      "GET v1/clubs/mine/market": ok({
        ...EMPTY_MARKET,
        selling: [auction({ id: "a-5", playerId: "p1", sellerClubId: MY_CLUB })],
      }),
    });
    renderOnline("/online/squad/p1");

    const link = await screen.findByRole("link", { name: "online.market.listed" });
    expect(link.getAttribute("href")).toBe("/online/auctions/a-5");
    expect(screen.queryByRole("button", { name: "online.market.list" })).toBeNull();
  });
});

describe("OnlineNotices", () => {
  async function accountChannel() {
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);
    return (event: string, auctionId: string) =>
      act(() =>
        watch?.speak({
          kind: "notice",
          channel: `account:${ACCOUNT}`,
          data: { kind: "market", event, auctionId },
        }),
      );
  }

  // Given the coach outbid in an auction of their market,
  // when the ring comes,
  // then a notice in the live region names the player, and choosing it opens the auction.
  it("names the player of a market ring and opens his auction", async () => {
    server = serveMarket({
      "GET v1/clubs/mine/market": ok({
        ...EMPTY_MARKET,
        recent: [auction({ id: "a-3", currentPrice: 900_000, leaderClubId: "club-3" })],
      }),
      "GET v1/auctions/a-3": ok(auction({ id: "a-3" })),
    });
    renderOnline("/online/league");
    const ring = await accountChannel();

    ring("outbid", "a-3");

    const region = await screen.findByRole("region", { name: "online.market.notice.region" });
    expect(region.getAttribute("aria-live")).toBe("polite");
    const notice = await within(region).findByRole("link", {
      name: /online\.market\.notice\.outbid:Trần Văn Bình/,
    });
    fireEvent.click(notice);
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "location" }).textContent).toBe(
        "/online/auctions/a-3",
      ),
    );
  });

  // Given four market rings in a row for auctions the club's market does not hold,
  // when they come,
  // then three notices show at once, the oldest leaving for the fourth, each said without a name.
  it("shows at most three notices, the oldest leaving first", async () => {
    server = serveMarket();
    renderOnline("/online/league");
    const ring = await accountChannel();

    for (const event of ["outbid", "won", "sold", "unsold"]) ring(event, `x-${event}`);

    const region = await screen.findByRole("region", { name: "online.market.notice.region" });
    await waitFor(() => expect(within(region).getAllByRole("link")).toHaveLength(3));
    expect(region.textContent).not.toContain("outbidUnnamed");
    expect(region.textContent).toContain("unsoldUnnamed");
  });

  // Given a notice in the corner,
  // when eight seconds pass, and for another when its close button is pressed from the keyboard,
  // then each leaves.
  it("leaves after eight seconds or when closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server = serveMarket();
    renderOnline("/online/league");
    const ring = await accountChannel();
    const region = await screen.findByRole("region", { name: "online.market.notice.region" });

    ring("won", "x-1");
    await waitFor(() => expect(within(region).getAllByRole("link")).toHaveLength(1));
    act(() => {
      vi.advanceTimersByTime(NOTICE_MILLIS);
    });
    await waitFor(() => expect(within(region).queryAllByRole("link")).toHaveLength(0));

    ring("sold", "x-2");
    const close = await within(region).findByRole("button", { name: "online.market.notice.close" });
    close.focus();
    fireEvent.click(close);
    await waitFor(() => expect(within(region).queryAllByRole("link")).toHaveLength(0));
  });
});
