import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import { fail, ok, renderOnline, resetOnline } from "../../../test-utils/onlineTestKit";
import { auction, finance, MY_CLUB, SERVER_NOW, sentTo, serveMarket } from "./marketTestKit";

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

const bidInput = () => screen.findByLabelText("online.market.yourBid");
const bidButton = () => screen.getByRole("button", { name: "online.market.bid" });

describe("OnlineAuction", () => {
  // Given an open auction whose least bid is 600,000, the next step 650,000 and the cap 2,500,000,
  // when its page opens and the coach picks each quick bid,
  // then the bid starts at the least and each quick choice puts its amount in the box.
  it("starts the bid at the least and fills it from the quick choices", async () => {
    server = serveMarket();
    renderOnline("/online/auctions/a-1");

    const input = (await bidInput()) as HTMLInputElement;
    expect(input.value).toBe("600,000");
    fireEvent.click(screen.getByRole("button", { name: /online\.market\.quick\.step/ }));
    expect(input.value).toBe("650,000");
    fireEvent.click(screen.getByRole("button", { name: /online\.market\.quick\.cap/ }));
    expect(input.value).toBe("2,500,000");
  });

  // Given a club with 1,000,000 in cash,
  // when the coach types a bid under the least, over the cap, and over the cash,
  // then each is named before anything is sent and the bid cannot be placed.
  it("names a bid it would refuse before sending it", async () => {
    server = serveMarket({ "GET v1/clubs/mine/finance": ok(finance({ cash: 1_000_000 })) });
    renderOnline("/online/auctions/a-1");
    const input = await bidInput();
    await waitFor(() => expect(sentTo(server, "GET", "v1/clubs/mine/finance").length).toBe(1));

    for (const [typed, problem] of [
      ["500000", "tooLow"],
      ["3000000", "overCap"],
      ["1200000", "overCash"],
    ]) {
      fireEvent.change(input, { target: { value: typed } });
      expect(screen.getByText(new RegExp(`online\\.market\\.problem\\.${problem}`))).toBeTruthy();
      expect((bidButton() as HTMLButtonElement).disabled).toBe(true);
    }
    expect(sentTo(server, "POST", "v1/auctions/a-1/bids")).toHaveLength(0);
  });

  // Given a club with 1,000,000 in cash,
  // when the coach bids 600,000 (60% of the cash), cancels, and bids again,
  // then the page asks first, sends nothing on cancel, and sends the bid once confirmed.
  it("asks before a bid of half the cash or more", async () => {
    server = serveMarket({
      "GET v1/clubs/mine/finance": ok(finance({ cash: 1_000_000 })),
      "POST v1/auctions/a-1/bids": ok(auction({ currentPrice: 600_000, leaderClubId: MY_CLUB })),
    });
    renderOnline("/online/auctions/a-1");
    await bidInput();
    await waitFor(() => expect(sentTo(server, "GET", "v1/clubs/mine/finance").length).toBe(1));

    fireEvent.click(bidButton());
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));
    expect(sentTo(server, "POST", "v1/auctions/a-1/bids")).toHaveLength(0);

    fireEvent.click(bidButton());
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "online.market.confirmBid" }));

    await waitFor(() => expect(sentTo(server, "POST", "v1/auctions/a-1/bids")).toHaveLength(1));
    const bid = sentTo(server, "POST", "v1/auctions/a-1/bids")[0];
    expect(bid?.body).toEqual({ amount: 600_000 });
    expect(bid?.idempotencyKey).toBeTruthy();
  });

  // Given an auction whose leader holds the cap,
  // when its page opens,
  // then the only bid is the cap itself, explained, and it asks first.
  it("offers only the cap once the leader holds it", async () => {
    server = serveMarket({
      "GET v1/auctions/a-1": ok(
        auction({
          currentPrice: 2_500_000,
          minNextBid: 2_500_000,
          leaderClubId: "club-3",
          leaderName: "Núi Rừng",
          capHolders: 1,
          bidsCount: 9,
        }),
      ),
      "GET v1/clubs/mine/finance": ok(finance({ cash: 9_000_000 })),
    });
    renderOnline("/online/auctions/a-1");

    expect(await screen.findByText("online.market.capTieExplain")).toBeTruthy();
    expect(screen.queryByLabelText("online.market.yourBid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "online.market.bidAtCap" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  // Given an open auction followed on its channel,
  // when a notice newer than any seen comes, then an older one,
  // then the auction is read again for the first and not for the second.
  it("reads the auction again on a newer notice only", async () => {
    server = serveMarket();
    renderOnline("/online/auctions/a-1");
    await bidInput();
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === "auction:a-1")).toBe(true),
    );
    const watch = realtime.watches.find((one) => one.channel === "auction:a-1");
    const notice = (seq: number) =>
      watch?.speak({
        kind: "notice",
        channel: "auction:a-1",
        data: {
          auctionId: "a-1",
          seq,
          status: "active",
          capHolders: 0,
          bidsCount: 1,
          endsAt: "2026-10-25T12:00:00.000Z",
        },
      });

    act(() => notice(5));
    await waitFor(() => expect(sentTo(server, "GET", "v1/auctions/a-1")).toHaveLength(2));
    act(() => notice(4));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sentTo(server, "GET", "v1/auctions/a-1")).toHaveLength(2);
  });

  // Given a bid the server finds too low, with its least as a parameter,
  // when the coach bids,
  // then the refusal shows the least as money and the auction is read again.
  it("shows a refusal with its money and reads the auction again", async () => {
    server = serveMarket({
      "POST v1/auctions/a-1/bids": fail(409, "be.error.auction.bidTooLow", {
        details: { params: { minimum: 700_000 } },
      }),
    });
    renderOnline("/online/auctions/a-1");
    await bidInput();

    fireEvent.click(bidButton());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/be\.error\.auction\.bidTooLow:.*700,000/);
    await waitFor(() => expect(sentTo(server, "GET", "v1/auctions/a-1")).toHaveLength(2));
  });

  // Given the coach's own listing with no bid, and then with one,
  // when its page opens,
  // then they may withdraw it (after confirming) only while no one has bid, and never bid on it.
  it("lets the seller withdraw only while nobody has bid", async () => {
    server = serveMarket({
      "GET v1/auctions/a-1": ok(auction({ sellerClubId: MY_CLUB })),
      "DELETE v1/auctions/a-1": ok(auction({ sellerClubId: MY_CLUB, status: "cancelled" })),
    });
    const { unmount } = renderOnline("/online/auctions/a-1");

    fireEvent.click(await screen.findByRole("button", { name: "online.market.withdraw" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "online.market.withdraw" }));
    expect(await screen.findByText("online.market.result.cancelled")).toBeTruthy();
    expect(sentTo(server, "DELETE", "v1/auctions/a-1")).toHaveLength(1);
    expect(screen.queryByLabelText("online.market.yourBid")).toBeNull();
    unmount();
    server.restore();

    server = serveMarket({
      "GET v1/auctions/a-1": ok(
        auction({ sellerClubId: MY_CLUB, bidsCount: 2, currentPrice: 650_000 }),
      ),
    });
    renderOnline("/online/auctions/a-1");
    expect(await screen.findByText("online.market.sellerWaits")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "online.market.withdraw" })).toBeNull();
  });

  // Given a closed auction sold to another club,
  // when its page opens,
  // then it says who bought him for how much, with no bid box and no channel followed.
  it("shows how a closed auction ended", async () => {
    server = serveMarket({
      "GET v1/auctions/a-1": ok(
        auction({
          status: "settled",
          currentPrice: 1_100_000,
          leaderName: "Núi Rừng",
          winnerClubId: "club-3",
        }),
      ),
    });
    renderOnline("/online/auctions/a-1");

    const result = await screen.findByText(/online\.market\.result\.settled/);
    expect(result.textContent).toMatch(/Núi Rừng\|.*1,100,000/);
    expect(screen.queryByLabelText("online.market.yourBid")).toBeNull();
    expect(realtime.watches.some((watch) => watch.channel === "auction:a-1")).toBe(false);
  });

  // Given an auction ending two hours after the server's now, read on a machine five seconds
  // fast,
  // when the page counts down,
  // then it shows the server's two hours, not two hours less five seconds.
  it("counts down by the server's clock", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(SERVER_NOW) + 5_000));
    server = serveMarket();
    renderOnline("/online/auctions/a-1");

    expect(await screen.findByText("02:00:00")).toBeTruthy();
  });
});
