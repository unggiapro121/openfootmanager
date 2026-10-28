import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoinView, InventoryView, ShopItemView, ShopView } from "../../api";
import type { OnlineRequest } from "../../../services/onlineTransport";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
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
} from "../../../test-utils/onlineTestKit";

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

vi.mock("../../../utils/backendI18n", () => ({
  resolveBackendError: (error: unknown) =>
    `resolved:${error instanceof Error ? error.message : String(error)}`,
}));

const ACCOUNT = "account-1";

function offer(itemCode: string, overrides: Partial<ShopItemView> = {}): ShopItemView {
  return { itemCode, powerClass: "c", price: 5, maxPurchase: 99, ...overrides };
}

function shop(overrides: Partial<ShopView> = {}): ShopView {
  return {
    priceListVersion: 4,
    items: [
      offer("energyDrinkSmall", { effect: { condition: 15 }, limits: { perPlayerDay: 2 } }),
      offer("medkitBandage"),
      offer("playerRename", { powerClass: "a", price: 20 }),
      offer("timeSkip", { powerClass: "b", price: 10 }),
    ],
    ...overrides,
  };
}

function coins(overrides: Partial<CoinView> = {}): CoinView {
  return {
    balance: 100,
    blocked: false,
    coinLocked: false,
    priceListVersion: 4,
    cashPerCoin: 10_000,
    exchangedToday: 0,
    nextDayAt: "2099-01-02T21:00:00Z",
    ...overrides,
  };
}

const NO_ITEMS: InventoryView = { lines: [], locked: false };

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer | ((request: OnlineRequest) => Answer)> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: ACCOUNT }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": ok(coins()),
    "GET v1/me/items": ok(NO_ITEMS),
    "GET v1/shop": ok(shop()),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

async function offerOf(code: string) {
  return screen.findByRole("article", { name: `online.items.${code}.name:${code}` });
}

const buyIn = (card: HTMLElement) =>
  within(card).getByRole("button", { name: "online.shop.buy" }) as HTMLButtonElement;

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

describe("the shop", () => {
  // Given no price list in force,
  // when the shop opens,
  // then it says the shop is not open, with no offers and no error.
  it("says the shop is shut without a price list", async () => {
    serve({ "GET v1/shop": ok({ items: [] }) });
    renderOnline("/online/shop");

    expect(await screen.findByText("online.shop.closed")).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Given an older server with no shop route,
  // when the shop opens,
  // then it says this server has no shop yet.
  it("says an older server has no shop", async () => {
    serve({ "GET v1/shop": fail(404, "be.error.notFound") });
    renderOnline("/online/shop");
    expect(await screen.findByText("online.shop.notOnServer")).toBeTruthy();
  });

  // Given a season without item rules (a drink with numbers, a medkit without), a rename card
  // and an hourglass,
  // when the shop opens,
  // then the item with its numbers says what it does and can be bought, the medkit cannot be
  // used this season, the hourglass waits for the academy, the rename card is always for sale.
  it("sells only what can be used this season", async () => {
    serve();
    renderOnline("/online/shop");

    const drink = await offerOf("energyDrinkSmall");
    expect(buyIn(drink).disabled).toBe(false);
    expect(drink.textContent).toContain("online.shop.effect.condition:15");
    expect(drink.textContent).toContain("online.shop.caps.perPlayerDay:2");
    const medkit = await offerOf("medkitBandage");
    expect(buyIn(medkit).disabled).toBe(true);
    expect(medkit.textContent).toContain("online.shop.notThisSeason");
    const hourglass = await offerOf("timeSkip");
    expect(buyIn(hourglass).disabled).toBe(true);
    expect(hourglass.textContent).toContain("online.shop.academySoon");
    expect(buyIn(await offerOf("playerRename")).disabled).toBe(false);
    expect(screen.getByText("online.shop.neverExpire")).toBeTruthy();
  });

  // Given a full row, and then the inventory locked,
  // when the shop opens,
  // then a purchase is off, saying the row is full, or that the items are locked.
  it("says why nothing more can be bought", async () => {
    serve({
      "GET v1/shop": ok(
        shop({ items: [offer("playerRename", { powerClass: "a", maxPurchase: 0 })] }),
      ),
    });
    const first = renderOnline("/online/shop");
    expect((await offerOf("playerRename")).textContent).toContain("online.shop.full");
    first.unmount();
    server.restore();

    resetOnline();
    serve({
      "GET v1/shop": ok(
        shop({ items: [offer("playerRename", { powerClass: "a", maxPurchase: 0 })] }),
      ),
      "GET v1/me/items": ok({ ...NO_ITEMS, locked: true }),
    });
    renderOnline("/online/shop");
    await waitFor(async () =>
      expect((await offerOf("playerRename")).textContent).toContain("online.shop.itemsLocked"),
    );
  });
});

describe("buying", () => {
  // Given a drink at 5 coins,
  // when the coach buys three,
  // then the dialog shows a total of 15 and the request carries the price list shown and a key.
  it("buys at the price list shown", async () => {
    serve({
      "POST v1/shop/purchases": ok({
        txnId: "t-1",
        itemCode: "energyDrinkSmall",
        quantity: 3,
        coins: 15,
        coinBalance: 85,
        held: [{ quantity: 3 }],
      }),
    });
    renderOnline("/online/shop");
    fireEvent.click(buyIn(await offerOf("energyDrinkSmall")));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("online.shop.quantity:99"), {
      target: { value: "3" },
    });
    expect(dialog.textContent).toContain("online.shop.total15");
    fireEvent.click(within(dialog).getByRole("button", { name: "online.shop.confirm" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [purchase] = sent("POST", "v1/shop/purchases");
    expect(purchase.body).toEqual({
      itemCode: "energyDrinkSmall",
      quantity: 3,
      priceListVersion: 4,
    });
    expect(purchase.idempotencyKey).toBeTruthy();
    expect(await screen.findByText(/^online\.shop\.bought:/)).toBeTruthy();
  });

  // Given a row that filled up meanwhile,
  // when the purchase is refused as too many,
  // then the quantity is set to what fits, the shop is read again in place, and the dialog stays.
  it("sets the quantity to what fits when the row is fuller than shown", async () => {
    serve({
      "POST v1/shop/purchases": fail(409, "be.error.inventory.stackFull", {
        details: { params: { max: 2 } },
      }),
    });
    renderOnline("/online/shop");
    fireEvent.click(buyIn(await offerOf("energyDrinkSmall")));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("online.shop.quantity:99"), {
      target: { value: "5" },
    });
    const shopReads = sent("GET", "v1/shop").length;

    fireEvent.click(within(dialog).getByRole("button", { name: "online.shop.confirm" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "be.error.inventory.stackFull",
    );
    expect(
      (within(dialog).getByLabelText("online.shop.quantity:99") as HTMLInputElement).value,
    ).toBe("2");
    await waitFor(() => expect(sent("GET", "v1/shop").length).toBe(shopReads + 1));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  // Given a link from a rename dialog (`?item=playerRename`),
  // when the shop opens,
  // then the rename card's purchase dialog is open.
  it("opens the purchase of the item a link names", async () => {
    serve();
    renderOnline("/online/shop?item=playerRename");
    expect((await screen.findByRole("dialog")).textContent).toContain(
      "online.shop.confirmTitle:online.items.playerRename.name:playerRename",
    );
  });
});
