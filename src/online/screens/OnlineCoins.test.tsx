import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoinLinesPage, CoinView, FinanceView } from "../api";
import type { OnlineRequest } from "../../services/onlineTransport";
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
import { useOnlineStore } from "../store/onlineStore";

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
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const ACCOUNT = "account-1";

function coins(overrides: Partial<CoinView> = {}): CoinView {
  return {
    balance: 120,
    blocked: false,
    coinLocked: false,
    priceListVersion: 4,
    cashPerCoin: 1_000,
    exchangeDailyLimit: 50,
    exchangedToday: 20,
    nextDayAt: "2099-01-02T21:00:00Z",
    ...overrides,
  };
}

function finance(overrides: Partial<FinanceView> = {}): FinanceView {
  return {
    economy: true,
    cash: 2_000_000,
    held: 0,
    locked: false,
    season: [],
    weeklyWageBill: 40_000,
    ...overrides,
  };
}

function lines(ids: number[], nextCursor?: number): CoinLinesPage {
  return {
    items: ids.map((id) => ({
      id,
      at: "2026-10-27T10:00:00Z",
      kind: id === 1 ? "somethingNew" : "coin_exchange",
      amount: id === 1 ? 100 : -10,
      refKind: "price_list",
      refId: "00000000-0000-7000-8000-000000000004",
    })),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: ACCOUNT }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/finance": ok(finance()),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": ok(coins()),
    "GET v1/me/coins/ledger": (request) =>
      ok(request.query?.some(([name]) => name === "cursor") ? lines([2, 1]) : lines([4, 3], 3)),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

/** The exchange button: "Exchange", or "Exchange N coins" once an amount is set. */
const exchangeButton = () =>
  screen.getByRole("button", { name: /^online\.coins\.exchange(Button|Coins)/ });

const HOUR = 60 * 60 * 1000;
const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();

async function typeCoins(amount: string) {
  const input = await screen.findByLabelText("online.coins.amount");
  fireEvent.change(input, { target: { value: amount } });
}

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

describe("the account's pages", () => {
  // Given a signed-in coach with no club yet,
  // when the online mode opens,
  // then the sidebar lists the coin wallet under the account's pages, and it opens the wallet.
  it("lists the coin wallet without a club", async () => {
    serve({ "GET v1/clubs/mine": fail(404, "be.error.club.none") });
    renderOnline("/online");
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe("/online/takeover"),
    );

    expect(screen.getByText("online.nav.account")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "online.nav.coins" }));

    expect(screen.queryByRole("button", { name: "online.nav.squad" })).toBeNull();
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe("/online/coins"),
    );
  });

  // Given coins not open to anyone (no price list) and none held,
  // when the online mode opens,
  // then the header has no coin chip.
  it("hides the header's coin chip while coins are not open", async () => {
    serve({
      "GET v1/me/coins": ok(
        coins({ balance: 0, priceListVersion: undefined, cashPerCoin: undefined }),
      ),
    });
    renderOnline("/online");

    await waitFor(() => expect(sent("GET", "v1/me/coins").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /online\.header\.coins/ })).toBeNull();
  });

  // Given a price list in force, and then a balance below zero with none,
  // when the header shows,
  // then the chip shows the coins, below zero in red, and opens the wallet.
  it("shows the coins in the header, red below zero", async () => {
    serve();
    const first = renderOnline("/online");
    const chip = await screen.findByRole("button", { name: "online.header.coins:120" });
    expect(chip.className).not.toMatch(/text-red/);
    fireEvent.click(chip);
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe("/online/coins"),
    );
    first.unmount();
    server.restore();

    resetOnline();
    serve({
      "GET v1/me/coins": ok(
        coins({ balance: -30, blocked: true, priceListVersion: undefined, cashPerCoin: undefined }),
      ),
    });
    renderOnline("/online");
    const negative = await screen.findByRole("button", { name: "online.header.coins:-30" });
    expect(negative.className).toMatch(/text-red/);
  });

  // Given a server from before coins (the route answers 404),
  // when the wallet opens,
  // then it says coins are not open on this server, with no error and no header chip.
  it("tells an older server apart from a failure", async () => {
    serve({ "GET v1/me/coins": fail(404, "be.error.notFound") });
    renderOnline("/online/coins");

    expect(await screen.findByText("online.coins.notOnServer")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /online\.header\.coins/ })).toBeNull();
  });
});

describe("the wallet's banners", () => {
  // Given coins below zero and locked, as a server with `coinLocked` says,
  // when the wallet opens,
  // then both banners show, each its own.
  it("shows the balance below zero and the lock apart", async () => {
    serve({
      "GET v1/me/coins": ok(coins({ balance: -15, blocked: true, coinLocked: true })),
    });
    renderOnline("/online/coins");

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "online.coins.negative:-15",
      "online.coins.locked",
    ]);
  });

  // Given a server without `coinLocked` (before C-7s): blocked with coins above zero, then
  // blocked below zero,
  // when the wallet opens,
  // then the first is the lock, the second the balance below zero with the line that it may also
  // be locked.
  it("reads the lock from blocked on a server without coinLocked", async () => {
    const { coinLocked: _, ...older } = coins({ blocked: true });
    serve({ "GET v1/me/coins": ok(older) });
    const first = renderOnline("/online/coins");
    expect((await screen.findByRole("alert")).textContent).toBe("online.coins.locked");
    first.unmount();
    server.restore();

    resetOnline();
    const { coinLocked: __, ...belowZero } = coins({ blocked: true, balance: -5 });
    serve({ "GET v1/me/coins": ok(belowZero) });
    renderOnline("/online/coins");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("online.coins.negative:-5 online.coins.maybeLocked");
  });
});

describe("the exchange", () => {
  // Given no price list in force,
  // when the wallet opens,
  // then the exchange says it is not open, and no exchange can be asked.
  it("is closed without a price list", async () => {
    serve({
      "GET v1/me/coins": ok(coins({ priceListVersion: undefined, cashPerCoin: undefined })),
    });
    renderOnline("/online/coins");

    expect(await screen.findByText("online.coins.closed")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^online\.coins\.exchange(Button|Coins)/ }),
    ).toBeNull();
  });

  // Given 120 coins, 1,000 € a coin, 30 of today's 50 left and 2,000,000 € in the club,
  // when the wallet opens, then the coach types 25, then takes the most,
  // then the form opens at 10, today's cap reads 30/50, the club's money and its money after
  // follow coins × rate, and the most is the smaller of his coins and what is left today.
  it("previews the club's money and takes all that may go today", async () => {
    serve();
    renderOnline("/online/coins");

    const input = (await screen.findByLabelText("online.coins.amount")) as HTMLInputElement;
    expect(input.value).toBe("10");
    expect(screen.getByRole("button", { name: "10" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("30/50")).toBeTruthy();
    expect(screen.getByText(/^online\.coins\.resets:/)).toBeTruthy();
    await typeCoins("25");
    expect(screen.getByText(/^\D*25,000$/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/2,025,000/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "online.coins.max:30" }));
    expect(input.value).toBe("30");
    expect(exchangeButton().textContent).toBe("online.coins.exchangeCoins:30");
    expect(exchangeButton().hasAttribute("disabled")).toBe(false);
  });

  // Given 7 coins held, with more left today,
  // when the wallet opens,
  // then the form opens at 7 and the presets above it are off.
  it("turns off the presets above what may go", async () => {
    serve({ "GET v1/me/coins": ok(coins({ balance: 7 })) });
    renderOnline("/online/coins");

    const input = (await screen.findByLabelText("online.coins.amount")) as HTMLInputElement;
    expect(input.value).toBe("7");
    expect(screen.getByRole("button", { name: "5" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "10" }).hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByRole("button", { name: "online.coins.max:7" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  // Given today's 50 all exchanged,
  // when the wallet opens,
  // then the cap says it is used up and when it comes back, and there is no form to send.
  it("says when today's cap is used up", async () => {
    serve({ "GET v1/me/coins": ok(coins({ exchangedToday: 50 })) });
    renderOnline("/online/coins");

    expect(await screen.findByText("online.coins.quotaUsed")).toBeTruthy();
    expect(screen.getByText(/^online\.coins\.quotaBack:.*\|50$/)).toBeTruthy();
    expect(screen.queryByLabelText("online.coins.amount")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^online\.coins\.exchange(Button|Coins)/ }),
    ).toBeNull();
  });

  // Given each reason the exchange cannot be asked,
  // when the wallet shows,
  // then the button is off and the reason says why: no club (with the way to take one), a season
  // without money, the club locked, the coins locked, more than held, more than left today.
  it.each([
    [
      "no club",
      { "GET v1/clubs/mine": fail(404, "be.error.club.none") },
      "5",
      "online.coins.needClub",
    ],
    [
      "no money this season",
      { "GET v1/clubs/mine/finance": ok(finance({ economy: false })) },
      "5",
      "be.error.economy.disabled",
    ],
    [
      "the club locked",
      { "GET v1/clubs/mine/finance": ok(finance({ locked: true })) },
      "5",
      "be.error.economy.clubLocked",
    ],
    [
      "the coins locked",
      { "GET v1/me/coins": ok(coins({ blocked: true, coinLocked: true })) },
      "5",
      "be.error.economy.coinLocked",
    ],
    [
      "more than held",
      { "GET v1/me/coins": ok(coins({ exchangeDailyLimit: undefined })) },
      "121",
      "be.error.economy.insufficientCoin",
    ],
    ["more than left today", {}, "31", "be.error.economy.exchangeLimitReached:30"],
  ] as const)("is refused before asking: %s", async (_, routes, amount, reason) => {
    serve(routes);
    renderOnline("/online/coins");

    await typeCoins(amount);
    await waitFor(() => expect(screen.getByRole("note").textContent).toContain(reason));
    expect(exchangeButton().hasAttribute("disabled")).toBe(true);
    if (reason === "online.coins.needClub") {
      expect(
        within(screen.getByRole("note"))
          .getByRole("link", { name: "online.coins.takeOver" })
          .getAttribute("href"),
      ).toBe("/online/takeover");
    }
  });

  // Given an exchange whose first send gets no answer,
  // when the coach confirms twice,
  // then both sends carry the price list shown and one key; the answer updates the coins and the
  // club's money, closes the dialog and says what was done.
  it("sends the price list shown and keeps its key when sent again", async () => {
    let tries = 0;
    serve({
      "POST v1/me/coins/exchange": () => {
        tries += 1;
        return tries === 1
          ? fail(0, "be.error.online.unreachable")
          : ok({ txnId: "t-1", coins: 10, cash: 10_000, coinBalance: 110, clubCash: 2_010_000 });
      },
    });
    renderOnline("/online/coins");

    await typeCoins("10");
    fireEvent.click(exchangeButton());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("online.coins.oneWay")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "online.coins.confirm" }));
    await within(dialog).findByRole("alert");
    fireEvent.click(within(dialog).getByRole("button", { name: "online.coins.confirm" }));

    expect(await screen.findByText(/online\.coins\.exchanged:10\|/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The balance moved: the lines are read again, so each line's balance after holds.
    await waitFor(() =>
      expect(sent("GET", "v1/me/coins/ledger").length).toBeGreaterThanOrEqual(2),
    );
    const posts = sent("POST", "v1/me/coins/exchange");
    expect(posts.map((post) => post.body)).toEqual([
      { coins: 10, priceListVersion: 4 },
      { coins: 10, priceListVersion: 4 },
    ]);
    expect(posts[0]?.idempotencyKey).toBeTruthy();
    expect(posts[1]?.idempotencyKey).toBe(posts[0]?.idempotencyKey);
  });

  // Given a price list changed under the coach (version 4 shown, 5 in force at 1,200 €),
  // when he confirms, then confirms again,
  // then the first is refused with the new number, the coins are read again, the dialog stays
  // open showing the new rate, and the second carries version 5 under a new key.
  it("reads a changed price list again and confirms it as a new request", async () => {
    let current = coins();
    serve({
      "GET v1/me/coins": () => ok(current),
      "POST v1/me/coins/exchange": (request) => {
        const body = request.body as { priceListVersion: number };
        if (body.priceListVersion !== 5) {
          current = coins({ priceListVersion: 5, cashPerCoin: 1_200 });
          return fail(409, "be.error.economy.priceChanged", {
            details: { params: { current: 5 } },
          });
        }
        return ok({ txnId: "t-2", coins: 10, cash: 12_000, coinBalance: 110, clubCash: 1 });
      },
    });
    renderOnline("/online/coins");

    await typeCoins("10");
    fireEvent.click(exchangeButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "online.coins.confirm" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("be.error.economy.priceChanged:5");
    expect(alert.textContent).toContain("online.coins.reviewPrices");
    await waitFor(() => expect(within(dialog).getByText(/1,200/)).toBeTruthy());
    fireEvent.click(within(dialog).getByRole("button", { name: "online.coins.confirm" }));

    await screen.findByText(/online\.coins\.exchanged:10\|/);
    const posts = sent("POST", "v1/me/coins/exchange");
    expect(
      posts.map((post) => (post.body as { priceListVersion: number }).priceListVersion),
    ).toEqual([4, 5]);
    expect(posts[1]?.idempotencyKey).not.toBe(posts[0]?.idempotencyKey);
  });

  // Given today's cap reached on the server before the screen knew,
  // when the coach confirms,
  // then the refusal says how many are left and the amount becomes that number.
  it("sets the amount to what the server says is left today", async () => {
    serve({
      "POST v1/me/coins/exchange": fail(409, "be.error.economy.exchangeLimitReached", {
        details: { params: { remaining: 4 } },
      }),
    });
    renderOnline("/online/coins");

    await typeCoins("10");
    fireEvent.click(exchangeButton());
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "online.coins.confirm" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "be.error.economy.exchangeLimitReached:4",
    );
    expect((screen.getByLabelText("online.coins.amount") as HTMLInputElement).value).toBe("4");
  });
});

describe("the coin lines", () => {
  // Given four lines read two at a time, one of a kind this build does not know,
  // when the coach shows more,
  // then the second page is read from the first's cursor, both are listed, the unknown kind by
  // its own name, and no "show more" is left.
  it("pages the lines from the cursor", async () => {
    serve();
    renderOnline("/online/coins");

    const history = await screen.findByRole("region", { name: "online.coins.lines" });
    await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "online.coins.more" }));

    await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(4));
    expect(sent("GET", "v1/me/coins/ledger")[1]?.query).toContainEqual(["cursor", "3"]);
    expect(within(history).getByText("online.coins.kind.somethingNew:somethingNew")).toBeTruthy();
    expect(within(history).getAllByText("+100")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "online.coins.more" })).toBeNull();
  });

  // Given 120 coins and three lines, newest first: +20 and −15 today, +100 two days ago,
  // when the wallet opens,
  // then today's tiles read +20 in and −15 out, today's lines are under "today", and each line
  // shows the balance after it, walking back from 120: 120, 100, 115.
  it("adds up today and shows the balance after each line", async () => {
    serve({
      "GET v1/me/coins": ok(coins({ nextDayAt: hoursFromNow(20) })),
      "GET v1/me/coins/ledger": ok({
        items: [
          { id: 3, at: hoursFromNow(-0.01), kind: "event_reward", amount: 20 },
          { id: 2, at: hoursFromNow(-0.02), kind: "item_purchase", amount: -15 },
          { id: 1, at: hoursFromNow(-50), kind: "coin_adjust", amount: 100 },
        ],
      }),
    });
    renderOnline("/online/coins");

    const history = await screen.findByRole("region", { name: "online.coins.lines" });
    await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(3));
    expect(screen.getByText("online.coins.todayIn").nextSibling?.textContent).toBe("+20");
    expect(screen.getByText("online.coins.todayOut").nextSibling?.textContent).toBe("−15");
    expect(within(history).getByRole("list", { name: /^online\.coins\.todayDate:/ })).toBeTruthy();
    const rows = within(history).getAllByRole("listitem");
    expect(
      rows.map((row) => row.textContent?.replace(/^.*online\.coins\.balanceAfter /, "")),
    ).toEqual(["120", "100", "115"]);
    expect(rows[1].textContent).toContain("−15");
  });

  // Given lines in and out,
  // when the coach filters to what went out, then to what came in,
  // then each filter counts its lines and shows only them.
  it("filters the lines in and out", async () => {
    serve();
    renderOnline("/online/coins");
    const history = await screen.findByRole("region", { name: "online.coins.lines" });
    fireEvent.click(await screen.findByRole("button", { name: "online.coins.more" }));
    await waitFor(() => expect(within(history).getAllByRole("listitem")).toHaveLength(4));

    const filters = within(history).getByRole("group", { name: "online.coins.filter.label" });
    expect(
      within(filters)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual([
      "online.coins.filter.all (4)",
      "online.coins.filter.in (1)",
      "online.coins.filter.out (3)",
    ]);
    fireEvent.click(within(filters).getByRole("button", { name: /filter\.out/ }));
    expect(within(history).getAllByRole("listitem")).toHaveLength(3);
    expect(within(history).queryByText("+100")).toBeNull();
    fireEvent.click(within(filters).getByRole("button", { name: /filter\.in/ }));
    expect(within(history).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(filters)
        .getByRole("button", { name: /filter\.in/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

describe("the balance", () => {
  // Given a wallet,
  // when it opens,
  // then the balance is named with the coin's name and leads to the shop and the events.
  it("leads to the shop and the events", async () => {
    serve();
    renderOnline("/online/coins");

    const balance = await screen.findByRole("region", { name: "online.coins.balanceOf:OFM Coin" });
    expect(within(balance).getByText("120")).toBeTruthy();
    expect(
      within(balance).getByRole("link", { name: "online.coins.toShop" }).getAttribute("href"),
    ).toBe("/online/shop");
    expect(
      within(balance).getByRole("link", { name: "online.coins.toEvents" }).getAttribute("href"),
    ).toBe("/online/events");
  });
});

describe("the account's finance ring", () => {
  // Given the coach in the online mode with his account channel open,
  // when a finance ring comes (his coins changed elsewhere),
  // then his coins and the club's money are read again, and no notice shows.
  it("reads the coins and the club's money again, with no notice", async () => {
    serve();
    renderOnline("/online");
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    await waitFor(() => expect(sent("GET", "v1/me/coins").length).toBeGreaterThan(0));
    const coinsBefore = sent("GET", "v1/me/coins").length;
    const financeBefore = sent("GET", "v1/clubs/mine/finance").length;

    const watch = realtime.watches.find((one) => one.channel === `account:${ACCOUNT}`);
    act(() =>
      watch?.speak({ kind: "notice", channel: `account:${ACCOUNT}`, data: { kind: "finance" } }),
    );

    await waitFor(() => expect(sent("GET", "v1/me/coins").length).toBe(coinsBefore + 1));
    await waitFor(() =>
      expect(sent("GET", "v1/clubs/mine/finance").length).toBe(financeBefore + 1),
    );
    expect(useOnlineStore.getState().notices).toEqual([]);
  });
});

describe("the finance page", () => {
  // Given a club whose season shows an exchange of coins, and a price list in force, then none,
  // when its finance page opens,
  // then the exchange has its own label, and "exchange coins" opens the wallet only while a price
  // list is in force.
  it("names coin exchanges and leads to the wallet", async () => {
    serve({
      "GET v1/clubs/mine/finance": ok(
        finance({ season: [{ kind: "coin_exchange", amount: 10_000 }] }),
      ),
      "GET v1/clubs/mine/facilities": ok({ facilities: [] }),
      "GET v1/clubs/mine/ledger": ok({ items: [] }),
    });
    const first = renderOnline("/online/finance");

    expect(await screen.findByText("online.finance.kind.coin_exchange:coin_exchange")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "online.finance.exchangeCoins" }));
    await waitFor(() =>
      expect(screen.getByLabelText("location").textContent).toBe("/online/coins"),
    );
    first.unmount();
    server.restore();

    resetOnline();
    serve({
      "GET v1/me/coins": ok(coins({ priceListVersion: undefined, cashPerCoin: undefined })),
      "GET v1/clubs/mine/facilities": ok({ facilities: [] }),
      "GET v1/clubs/mine/ledger": ok({ items: [] }),
    });
    renderOnline("/online/finance");
    await screen.findByText("online.finance.cash");
    await waitFor(() => expect(sent("GET", "v1/me/coins").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "online.finance.exchangeCoins" })).toBeNull();
  });
});
