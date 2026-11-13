import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchdayProjectionView, MatchdayView, TicketPriceView } from "../api";
import type { OnlineRequest } from "../../services/onlineTransport";
import { finance, view } from "../../test-utils/facilitiesKit";
import { VIEW_MODE_KEY } from "./facilities/map/viewMode";
import { fakeRealtime } from "../../test-utils/onlineMatchKit";
import {
  type Answer,
  fail,
  fakeServer,
  LEAGUE,
  myClub,
  ok,
  renderOnline,
  resetOnline,
  SEASON,
} from "../../test-utils/onlineTestKit";

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

vi.mock("../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${(error as { code?: string }).code ?? String(error)}`,
}));

const projection = (
  price: TicketPriceView,
  attendance: number,
  fillPermille: number,
  revenue: number,
  lockedOut = 0,
): MatchdayProjectionView => ({
  price,
  attendance,
  fillPermille,
  revenue,
  soldOut: lockedOut > 0,
  lockedOut,
});

const played = (
  fixtureId: string,
  opponentShortName: string,
  day: number,
  attendance: number,
  lockedOut = 0,
) => ({
  fixtureId,
  opponentShortName,
  day,
  attendance,
  capacity: 9_000,
  soldOut: lockedOut > 0,
  lockedOut,
  ticketRevenue: attendance * 23,
  commerceRevenue: 50_000,
});

/** A club of 9,000 seats: three home matches played, one sold out, the next against Sông Hàn. */
function matchday(overrides: Partial<MatchdayView> = {}): MatchdayView {
  return {
    ticketPrice: "medium",
    next: {
      fixtureId: "fx-9",
      opponent: { id: "c-9", shortName: "Sông Hàn" },
      day: 12,
      projections: [
        projection("low", 9_000, 1_000, 280_000, 1_900),
        projection("medium", 8_400, 933, 322_000),
        projection("high", 7_400, 822, 348_000),
        projection("veryHigh", 6_000, 667, 331_000),
      ],
    },
    matches: [
      played("m1", "Phố Núi", 2, 8_000),
      played("m2", "Hồ Tây", 6, 9_000, 1_300),
      played("m3", "Kinh Bắc", 10, 7_200),
    ],
    summary: {
      matches: 3,
      avgFillPermille: 896,
      soldOut: 1,
      ticketRevenue: 556_600,
      commerceRevenue: 150_000,
    },
    ...overrides,
  };
}

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/finance": ok(finance()),
    "GET v1/clubs/mine/facilities": ok(view()),
    "GET v1/clubs/mine/matchday": ok(matchday()),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

const ticketCard = async () =>
  screen.findByRole("article", { name: /online\.facilities\.ticket\.title/ });
const price = (card: HTMLElement, name: TicketPriceView) =>
  within(card).getByRole("radio", { name: `online.facilities.ticket.price.${name}` });

beforeEach(() => {
  resetOnline();
  window.localStorage.clear();
  // These cases are about the List; the map has its own (OnlineFacilitiesMap.test.tsx).
  window.localStorage.setItem(VIEW_MODE_KEY, "list");
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
  vi.restoreAllMocks();
});

describe("OnlineFacilities: the ticket price (c-27 §7.1)", () => {
  // Given a medium price and the next home match against Sông Hàn,
  // when the coach picks High,
  // then the line shows the server's figures for High at once, the price goes out by PUT with a
  // key, and a toast names the price and the match it applies from.
  it("shows each price's figures and sets the one chosen", async () => {
    serve({
      "PUT v1/clubs/mine/matchday/ticket-price": ok(
        matchday({
          ticketPrice: "high",
          appliesFrom: {
            fixtureId: "fx-9",
            opponent: { id: "c-9", shortName: "Sông Hàn" },
            day: 12,
          },
        }),
      ),
    });
    renderOnline("/online/facilities");

    const card = await ticketCard();
    expect(price(card, "medium")).toHaveAttribute("aria-checked", "true");
    expect(within(card).getByText("online.facilities.ticket.opponent:Sông Hàn|12")).toBeTruthy();
    expect(within(card).getByText("online.facilities.ticket.crowd:8,400|93%")).toBeTruthy();

    fireEvent.click(price(card, "high"));
    expect(price(card, "high")).toHaveAttribute("aria-checked", "true");
    expect(within(card).getByText("online.facilities.ticket.crowd:7,400|82%")).toBeTruthy();
    expect(
      await screen.findByText(
        "online.facilities.ticket.toast:online.facilities.ticket.price.high|Sông Hàn",
      ),
    ).toBeTruthy();
    const puts = sent("PUT", "v1/clubs/mine/matchday/ticket-price");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body).toEqual({ price: "high" });
    expect(puts[0]?.idempotencyKey).toBeTruthy();
  });

  // Given the low price, which sells the ground out,
  // when the coach picks it,
  // then the line says it sells out and how many the server says are left outside.
  it("says a price that sells out and the fans left outside", async () => {
    serve();
    renderOnline("/online/facilities");

    const card = await ticketCard();
    fireEvent.click(price(card, "low"));
    expect(within(card).getByText(/online\.facilities\.ticket\.soldOut:1,900/)).toBeTruthy();
  });

  // Given the server refusing the price,
  // when the coach picks one,
  // then the card says why and keeps the price that stands.
  it("keeps the price that stands when the server refuses", async () => {
    serve({
      "PUT v1/clubs/mine/matchday/ticket-price": fail(409, "be.error.matchday.disabled"),
    });
    renderOnline("/online/facilities");

    const card = await ticketCard();
    fireEvent.click(price(card, "veryHigh"));
    expect((await within(card).findByRole("alert")).textContent).toBe(
      "resolved:be.error.matchday.disabled",
    );
    expect(price(card, "medium")).toHaveAttribute("aria-checked", "true");
  });

  // Given the season's economy off,
  // when the screen opens,
  // then every price is off with the other writes (T4).
  it("turns the prices off with every other write", async () => {
    serve({ "GET v1/clubs/mine/facilities": ok(view({ economyDisabled: true })) });
    renderOnline("/online/facilities");

    const card = await ticketCard();
    for (const name of ["low", "medium", "high", "veryHigh"] as const) {
      expect(price(card, name)).toBeDisabled();
    }
  });

  // Given a season that draws no crowd,
  // when the screen opens,
  // then the stadium has its stands and no ticket price or crowd.
  it("leaves the ticket price and crowd out of a season without matchday", async () => {
    serve({ "GET v1/clubs/mine/matchday": fail(409, "be.error.matchday.disabled") });
    renderOnline("/online/facilities");

    expect(
      await screen.findByRole("article", { name: "online.facilities.name.stands" }),
    ).toBeTruthy();
    await waitFor(() => expect(sent("GET", "v1/clubs/mine/matchday")).toHaveLength(1));
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("online.facilities.crowd.title")).toBeNull();
    expect(screen.queryByRole("button", { name: "online.retry" })).toBeNull();
  });

  // Given the matchday read failing once for another reason (the network),
  // when the screen opens,
  // then the stadium says so with a retry instead of dropping the cards in silence, and a retry
  // that reads the matchday brings the ticket price back.
  it("says a failed read and reads again on retry", async () => {
    let reads = 0;
    serve({
      "GET v1/clubs/mine/matchday": () =>
        ++reads === 1 ? fail(503, "be.error.online.unreachable") : ok(matchday()),
    });
    renderOnline("/online/facilities");

    const stadium = await screen.findByRole("region", {
      name: "online.facilities.section.stadium",
    });
    expect((await within(stadium).findByRole("alert")).textContent).toBe(
      "resolved:be.error.online.unreachable",
    );
    expect(screen.queryByRole("radiogroup")).toBeNull();

    fireEvent.click(within(stadium).getByRole("button", { name: "online.retry" }));
    expect(await ticketCard()).toBeTruthy();
    expect(within(stadium).queryByRole("alert")).toBeNull();
    expect(sent("GET", "v1/clubs/mine/matchday")).toHaveLength(2);
  });
});

describe("OnlineFacilities: the season's home crowds (c-27 §7.1)", () => {
  // Given three home matches played, the second sold out,
  // when the screen opens,
  // then each has a bar from 0 to its crowd (T12), named by the opponent's short name, the sold
  // out one says so, the last is chosen and said in the live line, and the totals are the server's.
  it("draws each home match from 0 and says the one chosen", async () => {
    serve();
    renderOnline("/online/facilities");

    const chart = await screen.findByRole("group", { name: "online.facilities.crowd.chart:3" });
    const bars = within(chart).getAllByRole("button");
    expect(bars).toHaveLength(3);
    expect(bars.map((bar) => bar.textContent)).toEqual([
      "Phố Núi",
      "online.match.attendance.soldOutHồ Tây",
      "Kinh Bắc",
    ]);
    const heights = bars.map(
      (bar) => (bar.querySelector("span > span") as HTMLElement | null)?.style.height,
    );
    expect(heights).toEqual([`${(8_000 / 9_000) * 100}%`, "100%", "80%"]);
    expect(bars[1]?.getAttribute("aria-label")).toBe(
      "online.facilities.crowd.bar:Hồ Tây|6|9,000|9,000online.facilities.crowd.barSoldOut:1,300",
    );
    expect(bars[2]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/online\.facilities\.crowd\.chosen:10\|7,200\|9,000/)).toBeTruthy();

    fireEvent.click(bars[1] as HTMLElement);
    expect(bars[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/online\.facilities\.crowd\.chosenSoldOut:1,300/)).toBeTruthy();
    expect(screen.getByText(/online\.facilities\.crowd\.summary:90%\|1\|/)).toBeTruthy();
  });

  // Given no home match played yet,
  // when the screen opens,
  // then a sentence says so and what the first would draw at the price set (T8).
  it("says the first home match before any is played", async () => {
    serve({ "GET v1/clubs/mine/matchday": ok(matchday({ matches: [] })) });
    renderOnline("/online/facilities");

    expect(await screen.findByText("online.facilities.crowd.empty")).toBeTruthy();
    expect(screen.getByText("online.facilities.crowd.emptyNext:Sông Hàn|12|8,400")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /online\.facilities\.crowd\.chart/ })).toBeNull();
  });
});

describe("OnlineFacilities: opened at the stands (c-27 §7.3)", () => {
  // Given the sold-out mail's way to the stands,
  // when the screen opens at `#stands`,
  // then it scrolls the stands' card into view.
  it("scrolls to the stands' card", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    serve();
    renderOnline("/online/facilities#stands");

    const stands = await screen.findByRole("article", { name: "online.facilities.name.stands" });
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect(scrolled.mock.contexts[0]).toBe(stands);
  });
});
