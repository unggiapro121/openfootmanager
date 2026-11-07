import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyGiftStateView, DailyGiftStepView, InventoryView } from "../../api";
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
import { useOnlineStore } from "../../store/onlineStore";

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

const LATER = "2099-01-02T08:00:00Z";
const DRINK = { kind: "item", item: "energyDrinkSmall", quantity: 1 } as const;
const CASH = { kind: "cash", amount: 50_000 } as const;
const COIN = { kind: "coin", amount: 10 } as const;

function step(reward: DailyGiftStepView["reward"], state: DailyGiftStepView["state"], more = {}) {
  return { reward, state, ...more } as DailyGiftStepView;
}

/** The chain drink, 50,000, drink, 10 coins as `states` say, step 0 claimed when it is. */
function chain(
  states: DailyGiftStepView["state"][],
  more: Partial<DailyGiftStateView> = {},
): DailyGiftStateView {
  const rewards = [DRINK, CASH, DRINK, COIN];
  return {
    steps: states.map((state, index) =>
      step(rewards[index], state, {
        ...(state === "claimed" ? { claimedAt: "2026-11-07T06:00:00Z" } : {}),
        ...(state === "waiting" ? { opensAt: LATER } : {}),
      }),
    ),
    available: states.includes("ready"),
    gapSeconds: 7_200,
    ...more,
  };
}

function inventory(dailyGift?: DailyGiftStateView): InventoryView {
  return { lines: [], locked: false, ...(dailyGift ? { dailyGift } : {}) };
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
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/me/coins": ok({ balance: 0 }),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

const card = () => screen.findByRole("region", { name: "online.items.dailyGift.title" });

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

describe("the daily gift chain", () => {
  // Given step 0 claimed, step 1 waiting until a later moment, steps 2 and 3 after it,
  // when the inventory opens,
  // then the card shows the four gifts in order, step 0 claimed, step 1 counting down, no
  // button to claim, and when the next gift comes.
  it("shows each step of today's chain by its state", async () => {
    serve({
      "GET v1/me/items": ok(
        inventory(chain(["claimed", "waiting", "later", "later"], { next: 1, nextAt: LATER })),
      ),
    });
    renderOnline("/online/inventory");
    const gift = await card();
    const cells = within(gift).getAllByRole("listitem");
    expect(cells).toHaveLength(4);
    expect(cells[0]).toHaveTextContent(
      "online.items.dailyGift.item:1|online.items.energyDrinkSmall.name",
    );
    expect(cells[0]).toHaveTextContent("online.items.dailyGift.claimed");
    expect(cells[1]).toHaveTextContent(/50,000/);
    expect(cells[1]).toHaveTextContent(/^.*online\.items\.dailyGift\.waiting:/);
    expect(cells[3]).toHaveTextContent("online.items.dailyGift.coin:10");
    expect(within(gift).queryByRole("button")).toBeNull();
    expect(within(gift).getByText(/^online\.items\.dailyGift\.next:/)).toBeInTheDocument();
  });

  // Given step 1, 50,000 of club money, ready,
  // when the coach claims it,
  // then only that step has a button, the claim goes out with a key, the club is read again,
  // the inventory takes the answer's and the card says what came.
  it("claims the step ready and reads the club after club money", async () => {
    const after = chain(["claimed", "claimed", "waiting", "later"], { next: 2, nextAt: LATER });
    serve({
      "GET v1/me/items": ok(inventory(chain(["claimed", "ready", "later", "later"], { next: 1 }))),
      "POST v1/me/daily-gift": ok({ step: 1, reward: CASH, inventory: inventory(after) }),
    });
    renderOnline("/online/inventory");
    const gift = await card();
    const buttons = within(gift).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(within(gift).getAllByRole("listitem")[1]).toContainElement(buttons[0]);
    const clubReads = sent("GET", "v1/clubs/mine").length;
    fireEvent.click(buttons[0]);
    expect(await within(gift).findByRole("status")).toHaveTextContent(
      /^online\.items\.dailyGift\.given:.*50,000/,
    );
    expect(sent("POST", "v1/me/daily-gift")[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(sent("GET", "v1/clubs/mine").length).toBeGreaterThan(clubReads));
    expect(useOnlineStore.getState().items?.dailyGift?.next).toBe(2);
  });

  // Given a coin step ready,
  // when the coach claims it,
  // then his coins are read again.
  it("reads the coins after a coin step", async () => {
    serve({
      "GET v1/me/items": ok(
        inventory(chain(["claimed", "claimed", "claimed", "ready"], { next: 3 })),
      ),
      "POST v1/me/daily-gift": ok({
        step: 3,
        reward: COIN,
        inventory: inventory(
          chain(["claimed", "claimed", "claimed", "claimed"], { nextAt: LATER }),
        ),
      }),
    });
    renderOnline("/online/inventory");
    const gift = await card();
    fireEvent.click(within(gift).getByRole("button"));
    await within(gift).findByRole("status");
    await waitFor(() => expect(sent("GET", "v1/me/coins").length).toBeGreaterThan(0));
    expect(within(gift).getByText(/^online\.items\.dailyGift\.done:/)).toBeInTheDocument();
  });

  // Given a step claimed meanwhile elsewhere, so the server says the next one waits,
  // when the coach claims here,
  // then the refusal shows in words with the moment it opens, and the items are read again.
  it("says when the next step opens after a refusal and reads the items again", async () => {
    serve({
      "GET v1/me/items": ok(inventory(chain(["ready", "later", "later", "later"], { next: 0 }))),
      "POST v1/me/daily-gift": fail(409, "be.error.inventory.dailyGiftWaiting", {
        details: { params: { opensAt: LATER } },
      }),
    });
    renderOnline("/online/inventory");
    fireEvent.click(within(await card()).getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^be\.error\.inventory\.dailyGiftWaiting:/,
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(LATER);
    await waitFor(() => expect(sent("GET", "v1/me/items").length).toBeGreaterThan(1));
  });

  // Given a step waiting whose moment has already passed on this machine,
  // when the inventory opens,
  // then the items are read again once for it.
  it("reads the items again once the step waiting opens", async () => {
    const past = "2020-01-01T00:00:00Z";
    serve({
      "GET v1/me/items": ok(
        inventory(chain(["claimed", "waiting", "later", "later"], { next: 1, nextAt: past })),
      ),
    });
    renderOnline("/online/inventory");
    await card();
    // The page and the account watcher read the items once each; the moment passed adds one.
    await waitFor(() => expect(sent("GET", "v1/me/items").length).toBe(3));
  });

  // Given no day of a running season, every step closed and nothing claimed,
  // when the inventory opens,
  // then each step says it is over for today and the card says there is no gift today.
  it("says there is no gift outside the days of a season", async () => {
    serve({
      "GET v1/me/items": ok(inventory(chain(["closed", "closed", "closed", "closed"]))),
    });
    renderOnline("/online/inventory");
    const gift = await card();
    expect(within(gift).getAllByText("online.items.dailyGift.closed")).toHaveLength(4);
    expect(within(gift).getByText("online.items.dailyGift.none")).toBeInTheDocument();
  });

  // Given items with no daily gift (no club, or no gift this season),
  // when the inventory opens,
  // then there is no card.
  it("shows nothing without a gift", async () => {
    serve({ "GET v1/me/items": ok(inventory()) });
    renderOnline("/online/inventory");
    await screen.findByRole("tablist");
    expect(screen.queryByRole("region", { name: "online.items.dailyGift.title" })).toBeNull();
  });
});
