import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import { fakeRealtime } from "../../../../test-utils/onlineMatchKit";
import { ok, renderOnline, resetOnline } from "../../../../test-utils/onlineTestKit";
import { auction, finance, MY_CLUB, sentTo, serveMarket } from "../marketTestKit";

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

const KEY = "online.market.phone";

let server: ReturnType<typeof serveMarket>;
let realtime: ReturnType<typeof fakeRealtime>;

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.unstubAllGlobals();
});

async function open() {
  renderOnline("/online/auctions/a-1");
  return screen.findByRole("heading", { level: 2, name: "Trần Văn Bình" });
}

const bar = () => screen.getByRole("region", { name: `${KEY}.bidBar` });
const sheet = () => screen.getByRole("dialog", { name: `${KEY}.bidTitle:Trần Văn Bình` });
const amount = () => within(sheet()).getByLabelText("online.market.yourBid") as HTMLInputElement;

describe("an auction on a phone", () => {
  // Given an open auction starting at 600,000 with no bid,
  // when its page opens on a phone,
  // then the player sits on top, the auction says nobody has bid, and the bar offers the least bid.
  it("shows the player, the auction and the least bid", async () => {
    server = serveMarket();
    await open();

    const auctionCard = screen.getByRole("region", { name: "online.market.auction" });
    expect(within(auctionCard).getByText("online.market.noLeader")).toBeInTheDocument();
    expect(within(bar()).getByRole("button", { name: "online.market.bid" })).toBeEnabled();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tabStats` }));
    expect(screen.getByText("playerProfile.attributes")).toBeInTheDocument();
  });

  // Given the bid sheet,
  // when the coach steps up once, then picks the cap,
  // then the amount follows, and at the cap the tie rule is said.
  it("steps the bid and picks the cap", async () => {
    server = serveMarket();
    await open();
    fireEvent.click(within(bar()).getByRole("button", { name: "online.market.bid" }));

    expect(amount().value).toBe("600,000");
    fireEvent.click(within(sheet()).getByRole("button", { name: `${KEY}.stepUp` }));
    expect(amount().value).toBe("650,000");
    fireEvent.click(within(sheet()).getByRole("button", { name: /online\.market\.quick\.cap/ }));
    expect(amount().value).toBe("2,500,000");
    expect(within(sheet()).getByText("online.market.capTieExplain")).toBeInTheDocument();
  });

  // Given a bid of most of the club's cash,
  // when the coach places it,
  // then the sheet asks first, and on yes the bid is sent.
  it("asks before a big bid and sends it", async () => {
    server = serveMarket({ "GET v1/clubs/mine/finance": ok(finance({ cash: 1_000_000 })) });
    await open();
    await waitFor(() =>
      expect(sentTo(server, "GET", "v1/clubs/mine/finance").length).toBeGreaterThan(0),
    );
    fireEvent.click(within(bar()).getByRole("button", { name: "online.market.bid" }));
    fireEvent.click(within(sheet()).getByRole("button", { name: /online\.market\.phone\.place/ }));

    expect(within(sheet()).getByText(/online\.market\.confirmBody/)).toBeInTheDocument();
    fireEvent.click(within(sheet()).getByRole("button", { name: "online.market.confirmBid" }));
    await waitFor(() => expect(sentTo(server, "POST", "v1/auctions/a-1/bids")).toHaveLength(1));
    expect(sentTo(server, "POST", "v1/auctions/a-1/bids")[0].body).toEqual({ amount: 600_000 });
  });

  // Given a bid over the club's cash,
  // when the coach types it,
  // then the reason shows and it cannot be placed.
  it("names a bid it would refuse", async () => {
    server = serveMarket({ "GET v1/clubs/mine/finance": ok(finance({ cash: 1_000_000 })) });
    await open();
    await waitFor(() =>
      expect(sentTo(server, "GET", "v1/clubs/mine/finance").length).toBeGreaterThan(0),
    );
    fireEvent.click(within(bar()).getByRole("button", { name: "online.market.bid" }));
    fireEvent.change(amount(), { target: { value: "1200000" } });

    expect(within(sheet()).getByText(/online\.market\.problem\.overCash/)).toBeInTheDocument();
    expect(
      within(sheet()).getByRole("button", { name: /online\.market\.phone\.place/ }),
    ).toBeDisabled();
  });

  // Given the coach's own listing with no bid,
  // when its page opens,
  // then there is no bid, and the listing can be withdrawn.
  it("lets the seller withdraw instead of bidding", async () => {
    server = serveMarket({ "GET v1/auctions/a-1": ok(auction({ sellerClubId: MY_CLUB })) });
    await open();
    expect(screen.queryByRole("region", { name: `${KEY}.bidBar` })).toBeNull();
    expect(screen.getByRole("button", { name: "online.market.withdraw" })).toBeInTheDocument();
  });

  // Given an auction a level cap keeps the coach out of,
  // when its page opens,
  // then the lock says the level it needs, and the bid is shut.
  it("shows the level lock", async () => {
    server = serveMarket({
      "GET v1/auctions/a-1": ok(auction({ canBid: false, requiredLevel: 4 })),
    });
    await open();
    expect(screen.getByText("online.market.levelLock.badge:4")).toBeInTheDocument();
    expect(within(bar()).getByRole("button", { name: `${KEY}.locked` })).toBeDisabled();
  });
});
