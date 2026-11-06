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
const ovrFrom = `${KEY}.from:${KEY}.field.ovr`;
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

  // Given the filter sheet over three open auctions,
  // when the coach types OVR from 65, picks the "≤ 2" price preset and the OVR order,
  // then the sheet tells what the market holds and counts what the draft would show, the server
  // is asked with those filters, and the list is strongest first.
  it("filters and sorts from the sheet", async () => {
    server = serveMarket({ "GET v1/auctions": ok({ items: OPEN }) });
    renderOnline("/online/market");
    await waitFor(() => expect(cards()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: /online\.market\.filters/ }));
    const sheet = screen.getByRole("dialog", { name: "online.market.filters" });
    expect(await within(sheet).findByText(`${KEY}.marketHas:56–71`)).toBeInTheDocument();
    await within(sheet).findByRole("button", { name: `${KEY}.show:3` });
    fireEvent.change(within(sheet).getByRole("textbox", { name: ovrFrom }), {
      target: { value: "65" },
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "≤ 2" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: `${KEY}.sort.ovr` }));
    fireEvent.click(within(sheet).getByRole("button", { name: `${KEY}.show:1` }));

    await waitFor(() =>
      expect(queries().slice(-1)[0]).toMatchObject({ minOvr: "65", maxPrice: "2000000" }),
    );
    await waitFor(() => expect(cards()[0]).toHaveTextContent("Kim Seung-myeong"));
  });

  // Given the filter sheet,
  // when the coach asks for an OVR no auction has, then for a "from" over its "to",
  // then Apply is refused, first as matching nobody, then as a range to check, with the reason.
  it("refuses a draft that matches nobody or has a wrong range", async () => {
    server = serveMarket({ "GET v1/auctions": ok({ items: OPEN }) });
    renderOnline("/online/market");
    await waitFor(() => expect(cards()).toHaveLength(3));

    fireEvent.click(screen.getByRole("button", { name: /online\.market\.filters/ }));
    const sheet = screen.getByRole("dialog", { name: "online.market.filters" });
    await within(sheet).findByRole("button", { name: `${KEY}.show:3` });
    fireEvent.change(within(sheet).getByRole("textbox", { name: ovrFrom }), {
      target: { value: "90" },
    });
    expect(within(sheet).getByRole("button", { name: `${KEY}.showNone` })).toBeDisabled();

    fireEvent.change(within(sheet).getByRole("textbox", { name: `${KEY}.to:${KEY}.field.ovr` }), {
      target: { value: "80" },
    });
    expect(within(sheet).getByRole("alert")).toHaveTextContent(`${KEY}.rangeError`);
    expect(within(sheet).getByRole("button", { name: `${KEY}.checkRanges` })).toBeDisabled();
  });

  // Given a lowest price in the address, which the server does not filter by,
  // when the market opens,
  // then the loaded page is narrowed to it, the filter shows as a chip, and a tap on the chip
  // brings the cheaper auction back.
  it("narrows the page by what the server cannot filter, one chip per filter", async () => {
    server = serveMarket({ "GET v1/auctions": ok({ items: OPEN }) });
    renderOnline("/online/market?minPrice=700000");
    await waitFor(() => expect(cards()).toHaveLength(2));
    expect(screen.getByRole("button", { name: /online\.market\.filters/ })).toHaveTextContent("1");

    const chips = screen.getByRole("toolbar", { name: `${KEY}.activeFilters` });
    fireEvent.click(
      within(chips).getByRole("button", {
        name: new RegExp(`^${KEY}\\.removeFilter:${KEY}\\.chip\\.price:`),
      }),
    );
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(screen.queryByRole("toolbar", { name: `${KEY}.activeFilters` })).toBeNull();
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
