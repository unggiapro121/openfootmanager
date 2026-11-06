import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoinView, ShopItemView, ShopView } from "../../api";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
import { runBackAction } from "../../../lib/backActions";
import { fakeRealtime } from "../../../test-utils/onlineMatchKit";
import {
  type Answer,
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

function offer(itemCode: string, overrides: Partial<ShopItemView> = {}): ShopItemView {
  return { itemCode, powerClass: "c", price: 5, maxPurchase: 99, ...overrides };
}

const SHOP: ShopView = {
  priceListVersion: 4,
  items: [
    offer("energyDrinkSmall", { effect: { condition: 15 }, limits: { perPlayerDay: 2 } }),
    offer("tacticalNoteBasic", { price: 10, effect: { xp: 20, masteryFrom: 0, masteryUntil: 30 } }),
    offer("xpBoosterX2", { price: 500, effect: { matches: 3 } }),
  ],
};

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

let server: ReturnType<typeof fakeServer>;
let realtime: ReturnType<typeof fakeRealtime>;

function serve(more: Record<string, Answer> = {}) {
  server = fakeServer({
    "GET v1/season": ok(SEASON),
    "GET v1/clubs/mine": ok(myClub()),
    "GET v1/leagues/mine": ok(LEAGUE),
    "GET v1/me": ok({ id: "account-1" }),
    "GET v1/friendlies/mine": ok({}),
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": ok(coins()),
    "GET v1/me/items": ok({ lines: [], locked: false }),
    "GET v1/shop": ok(SHOP),
    "GET v1/clubs/mine/academy": ok({ enabled: false }),
    ...more,
  });
}

const offerOf = (code: string) =>
  screen.findByRole("article", { name: `online.items.${code}.name:${code}` });
const buyIn = (card: HTMLElement) =>
  within(card).getByRole("button", { name: /^online\.shop\.buyAria:/ }) as HTMLButtonElement;

async function openPurchase(code: string) {
  fireEvent.click(buyIn(await offerOf(code)));
  return screen.findByRole("dialog", { name: `online.items.${code}.name:${code}` });
}

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

describe("the shop on a phone", () => {
  // Given no coin sales yet (DM-3),
  // when the shop opens on a phone,
  // then the balance card shows a top-up button that is off, and no wallet link (D-S1, D-S11).
  it("shows the top-up button switched off", async () => {
    serve();
    renderOnline("/online/shop");

    const topUp = await screen.findByRole("button", { name: "online.shop.topUpSoon" });
    expect(topUp.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("link", { name: "online.shop.toWallet" })).toBeNull();
  });

  // Given a season that is over,
  // when the coach opens the season line under the balance,
  // then it says so folded, and opened it adds that bought items never expire (D-S5).
  it("folds the season's word under the balance", async () => {
    serve({ "GET v1/season": ok({ ...SEASON, status: "closed" }) });
    renderOnline("/online/shop");

    const line = await screen.findByRole("button", { name: "online.shop.noteOver:3" });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("online.shop.neverExpire")).toBeNull();
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("online.shop.neverExpire")).toBeTruthy();
  });

  // Given a tactical note,
  // when its card shows on a phone,
  // then it names the mastery band in words, with no bars (D-S7), and the stock as "Kho".
  it("names a tactical note's band in words", async () => {
    serve();
    renderOnline("/online/shop");

    const card = await offerOf("tacticalNoteBasic");
    expect(card.textContent).toContain("online.shop.mastery.low");
    expect(card.querySelector("[data-mastery-bars]")).toBeNull();
    expect(card.textContent).toContain("online.shop.heldShort");
  });

  // Given an item dearer than the balance,
  // when its card shows on a phone,
  // then the card is dimmed, its button off, and the reason is said beside it (D-S6).
  it("says why a card cannot be bought", async () => {
    serve();
    renderOnline("/online/shop");

    const card = await offerOf("xpBoosterX2");
    const button = buyIn(card);
    expect(button.disabled).toBe(true);
    const reason = within(card).getByRole("note");
    expect(reason.textContent).toContain("be.error.economy.insufficientCoin");
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    expect(card.dataset.blocked).toBe("true");
  });

  // Given a drink,
  // when the coach opens its purchase on a phone,
  // then it is a sheet whose foot has the price line, what is left, and one confirm button,
  // with no cancel and no four-line total (D-S2, D-S3), and the binding note in the body (D-S5).
  it("opens the purchase as a sheet with one button in its foot", async () => {
    serve();
    renderOnline("/online/shop");
    const dialog = await openPurchase("energyDrinkSmall");

    expect(dialog.dataset.layout).toBe("sheet");
    const foot = within(dialog).getByRole("contentinfo");
    expect(foot.textContent).toContain("5 × 1");
    expect(foot.textContent).toContain("online.shop.leftLabel");
    expect(within(foot).getByRole("button", { name: /^online\.shop\.confirm/ })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "common.cancel" })).toBeNull();
    expect(dialog.textContent).not.toContain("online.shop.total");
    expect(dialog.textContent).toContain("online.shop.bound");
  });

  // Given an open purchase sheet,
  // when the coach presses Back,
  // then the sheet closes and the shop stays (G-4).
  it("closes the sheet on Back without leaving the shop", async () => {
    serve();
    renderOnline("/online/shop");
    await openPurchase("energyDrinkSmall");

    expect(runBackAction()).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await offerOf("energyDrinkSmall")).toBeTruthy();
  });

  // Given a purchase made on a phone,
  // when the notice shows,
  // then it sits above the tab bar, not over it (G-5).
  it("puts the notice above the tab bar", async () => {
    serve({
      "POST v1/shop/purchases": ok({
        txnId: "t-1",
        itemCode: "energyDrinkSmall",
        quantity: 1,
        coins: 5,
        coinBalance: 95,
        held: [{ quantity: 1 }],
      }),
    });
    renderOnline("/online/shop");
    const dialog = await openPurchase("energyDrinkSmall");
    fireEvent.click(within(dialog).getByRole("button", { name: /^online\.shop\.confirm/ }));

    const notice = (await screen.findByText(/^online\.shop\.bought:/)).closest("[role=status]");
    expect((notice as HTMLElement).dataset.layout).toBe("above-tabs");
  });
});
