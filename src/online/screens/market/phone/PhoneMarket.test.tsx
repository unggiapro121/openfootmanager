import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../../hooks/usePhoneLayout";
import { fakeRealtime } from "../../../../test-utils/onlineMatchKit";
import { ok, renderOnline, resetOnline } from "../../../../test-utils/onlineTestKit";
import { auction, MY_CLUB, sentTo, serveMarket } from "../marketTestKit";

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

const PLAYER = auction().player as NonNullable<ReturnType<typeof auction>["player"]>;

/** Three open auctions: a young midfielder, a striker the coach leads, a keeper with bids. */
const OPEN = [
  auction({ id: "a-1" }),
  auction({
    id: "a-2",
    playerId: "p2",
    player: {
      ...PLAYER,
      fullName: "Kim Seung-myeong",
      naturalPosition: "Striker",
      position: "Forward",
      ovr: 71,
    },
    currentPrice: 1_550_000,
    bidsCount: 2,
    leaderClubId: MY_CLUB,
    leaderName: "Cầu Vồng Nghệ An",
    mine: 1_550_000,
  }),
  auction({
    id: "a-3",
    playerId: "p3",
    player: {
      ...PLAYER,
      fullName: "Leon Moreau",
      naturalPosition: "Goalkeeper",
      position: "Goalkeeper",
      ovr: 56,
    },
    currentPrice: 750_000,
    bidsCount: 2,
  }),
];

const cards = () => within(screen.getByRole("list", { name: `${KEY}.list` })).getAllByRole("link");
const queries = () =>
  sentTo(server, "GET", "v1/auctions").map((request) => Object.fromEntries(request.query ?? []));

describe("the market on a phone", () => {
  // Given three open auctions,
  // when the market opens on a phone,
  // then each is a card naming the player, his price and how long is left, the one the coach
  // leads says so, and there is no desktop table.
  it("lists the open auctions as cards", async () => {
    server = serveMarket({ "GET v1/auctions": ok({ items: OPEN }) });
    renderOnline("/online/market");

    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(screen.queryByRole("table")).toBeNull();
    expect(cards()[0]).toHaveTextContent("Trần Văn Bình");
    expect(cards()[1]).toHaveTextContent("online.market.youLead");
    expect(screen.getByRole("tab", { name: /online\.market\.tabOpen/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // Given the market,
  // when the coach picks the defenders,
  // then the server is asked for them.
  it("asks the server for a position group", async () => {
    server = serveMarket({ "GET v1/auctions": ok({ items: OPEN }) });
    renderOnline("/online/market");
    await waitFor(() => expect(cards()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: "online.market.group.Defender" }));
    await waitFor(() => expect(queries().slice(-1)[0]).toMatchObject({ position: "Defender" }));
  });

  // Given the filter sheet,
  // when the coach asks for OVR 65 and up at no more than 2M, sorted by OVR,
  // then the server is asked with those, and the list is strongest first.
  it("filters and sorts from the sheet", async () => {
    server = serveMarket({ "GET v1/auctions": ok({ items: OPEN }) });
    renderOnline("/online/market");
    await waitFor(() => expect(cards()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: /online\.market\.filters/ }));
    const sheet = screen.getByRole("dialog", { name: "online.market.filters" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "65+" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: new RegExp(`^${KEY}\\.upTo:.*2`) }));
    fireEvent.click(within(sheet).getByRole("radio", { name: `${KEY}.sort.ovr` }));
    fireEvent.click(within(sheet).getByRole("button", { name: `${KEY}.apply` }));

    await waitFor(() =>
      expect(queries().slice(-1)[0]).toMatchObject({ minOvr: "65", maxPrice: "2000000" }),
    );
    await waitFor(() => expect(cards()[0]).toHaveTextContent("Kim Seung-myeong"));
  });

  // Given the club selling one player and holding money in another auction,
  // when the coach opens their own auctions,
  // then each list has its card, with where the club stands.
  it("shows the coach's own auctions", async () => {
    server = serveMarket({
      "GET v1/clubs/mine/market": ok({
        selling: [auction({ id: "s-1", sellerClubId: MY_CLUB })],
        holding: [OPEN[1]],
        recent: [],
      }),
    });
    renderOnline("/online/market");
    fireEvent.click(await screen.findByRole("tab", { name: /online\.market\.tabMine/ }));

    const selling = await screen.findByRole("region", { name: "online.market.selling" });
    expect(within(selling).getByText("online.market.standing.selling")).toBeInTheDocument();
    const holding = screen.getByRole("region", { name: "online.market.holding" });
    expect(within(holding).getByText("online.market.standing.leading")).toBeInTheDocument();
  });

  // Given a card,
  // when the coach taps it,
  // then the auction's page opens.
  it("opens an auction from its card", async () => {
    server = serveMarket({ "GET v1/auctions": ok({ items: OPEN }) });
    renderOnline("/online/market");
    await waitFor(() => expect(cards()).toHaveLength(3));
    fireEvent.click(cards()[0]);
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe("/online/auctions/a-1"),
    );
  });
});
