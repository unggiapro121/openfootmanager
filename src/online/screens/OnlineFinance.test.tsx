import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FacilitiesView, FinanceView, LedgerPage } from "../api";
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

function finance(overrides: Partial<FinanceView> = {}): FinanceView {
  return {
    economy: true,
    cash: 2_480_000,
    held: 90_000,
    locked: false,
    season: [
      { kind: "opening", amount: 3_000_000 },
      { kind: "wage", amount: -520_000 },
      { kind: "somethingNew", amount: 1_000 },
    ],
    weeklyWageBill: 49_791,
    arrearsDaysToForcedListing: 3,
    ...overrides,
  };
}

const FACILITIES: FacilitiesView = {
  facilities: [
    {
      facility: "training",
      level: 1,
      maxLevel: 10,
      cost: 2_500_000,
      effects: [{ key: "finances.effect.gains", format: "multiplier", current: [1], next: [1.1] }],
    },
    {
      facility: "medical",
      level: 10,
      maxLevel: 10,
      cost: null,
      effects: [
        { key: "finances.effect.recovery", format: "multiplier", current: [1.9], next: null },
      ],
    },
    { facility: "scouting", level: 1, maxLevel: 10, cost: 2_500_000, effects: [] },
  ],
};

function ledger(items: number[], nextCursor?: number): LedgerPage {
  return {
    items: items.map((id) => ({
      id,
      at: "2026-10-24T10:00:00Z",
      kind: id % 2 === 0 ? "wage" : "tickets",
      account: "cash",
      amount: id % 2 === 0 ? -1_000 : 2_000,
      refKind: id % 2 === 0 ? "club" : "match",
      refId: "00000000-0000-7000-8000-000000000001",
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
    "GET v1/clubs/mine/facilities": ok(FACILITIES),
    "GET v1/clubs/mine/ledger": (request) =>
      ok(request.query?.some(([name]) => name === "cursor") ? ledger([2, 1]) : ledger([4, 3], 3)),
    ...more,
  });
}

const sent = (method: string, path: string) =>
  server.requests.filter(
    (request) => request.method === method && request.segments.join("/") === path,
  );

beforeEach(() => {
  resetOnline();
  realtime = fakeRealtime();
});
afterEach(() => {
  server?.restore();
  realtime.restore();
});

describe("OnlineFinance", () => {
  // Given a club owing two days of wages, locked by the audit, with this season's totals,
  // when its finance page opens,
  // then it shows both warnings, the three figures, each kind of the season (an unknown kind
  // by its own name) and the total.
  it("shows the club's money, its warnings and the season", async () => {
    serve({
      "GET v1/clubs/mine/finance": ok(
        finance({ locked: true, arrears: { days: 2, since: "2026-10-22" } }),
      ),
    });
    renderOnline("/online/finance");

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent)).toEqual([
      "be.error.economy.clubLocked",
      expect.stringContaining("online.finance.arrears:2|"),
    ]);
    expect(alerts[1]?.textContent).toContain("|3");
    expect(screen.getByText("online.finance.cash").nextSibling?.textContent).toMatch(/2,480,000/);
    expect(screen.getByText("online.finance.held").nextSibling?.textContent).toMatch(/90,000/);
    // 49,791 a week is 92,469 a season day (52 weeks over 28 days).
    expect(screen.getByText(/online\.finance\.wagePerDay/).textContent).toMatch(/92,469/);
    expect(screen.getByText("online.finance.kind.somethingNew:somethingNew")).toBeTruthy();
    const total = screen.getByText("online.finance.total").parentElement;
    expect(total?.textContent).toMatch(/2,481,000/);
  });

  // Given a season played without money,
  // when the finance page opens,
  // then it says so and shows no figure.
  it("says a season without money has nothing to show", async () => {
    serve({ "GET v1/clubs/mine/finance": ok(finance({ economy: false })) });
    renderOnline("/online/finance");

    expect(await screen.findByText("online.finance.noEconomy")).toBeTruthy();
    expect(screen.queryByText("online.finance.cash")).toBeNull();
  });

  // Given a ledger of four lines read two at a time,
  // when the coach shows more,
  // then the second page is read from the first's cursor and both pages are listed, a match line
  // linking to its match; no "show more" is left.
  it("pages the ledger from the cursor", async () => {
    serve();
    renderOnline("/online/finance");

    const list = await screen.findByRole("list", { name: "online.finance.ledger" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "online.finance.more" }));

    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(4));
    const second = sent("GET", "v1/clubs/mine/ledger")[1];
    expect(second?.query).toContainEqual(["cursor", "3"]);
    expect(
      within(list)
        .getAllByRole("link")
        .every(
          (link) =>
            link.getAttribute("href") === "/online/match/00000000-0000-7000-8000-000000000001",
        ),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "online.finance.more" })).toBeNull();
  });

  // Given training at level 1 and medical at the top,
  // when the coach upgrades training, the first try refused and, in a dialog opened again, the
  // second succeeding,
  // then the refusal shows in the dialog and stops it; each opening sends its own single key (the
  // server charges a level once whatever the key); the success closes the dialog and says so; the
  // medical upgrade cannot be asked.
  it("upgrades a facility, one key for each opening of the dialog", async () => {
    let tries = 0;
    serve({
      "GET v1/clubs/mine/finance": ok(finance({ cash: 3_000_000 })),
      "POST v1/clubs/mine/facilities/training/upgrade": () => {
        tries += 1;
        return tries === 1
          ? fail(409, "be.error.club.lineupLocked", { details: { params: { kickoffAt: "x" } } })
          : ok({ facility: "training", level: 2, cost: 2_500_000, cash: 1 });
      },
    });
    renderOnline("/online/finance");
    const confirmIn = (dialog: HTMLElement) =>
      within(dialog).findByRole("button", { name: /finances\.facilityUpgradeConfirm/ });

    const upgrades = await screen.findAllByRole("button", { name: "finances.upgradeFacility" });
    expect((upgrades[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(upgrades[0] as HTMLElement);
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(await confirmIn(dialog));
    expect(await within(dialog).findByText(/resolved:be\.error\.club\.lineupLocked/)).toBeTruthy();
    expect(((await confirmIn(dialog)) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "common.cancel" }));
    fireEvent.click(
      (
        await screen.findAllByRole("button", { name: "finances.upgradeFacility" })
      )[0] as HTMLElement,
    );
    dialog = await screen.findByRole("dialog");
    fireEvent.click(await confirmIn(dialog));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const keys = sent("POST", "v1/clubs/mine/facilities/training/upgrade").map(
      (request) => request.idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(await screen.findByText(/online\.finance\.upgraded/)).toBeTruthy();
  });
});

describe("the academy's row in finance", () => {
  // Given a season with academy rules: the academy as a fourth facility (its effect named only
  // `academySlots`) and its youngsters' weekly wages,
  // when the finance page opens and the academy is upgraded,
  // then the row has the academy's own name and effect label, the wages are shown, and the
  // upgrade goes to the academy's path.
  it("shows and upgrades the academy", async () => {
    serve({
      "GET v1/clubs/mine/finance": ok(finance({ cash: 9_000_000, academyWeeklyWageBill: 1_500 })),
      "GET v1/clubs/mine/facilities": ok({
        facilities: [
          ...FACILITIES.facilities,
          {
            facility: "academy",
            level: 1,
            maxLevel: 5,
            cost: 2_500_000,
            effects: [{ key: "academySlots", format: "count", current: [3], next: [4] }],
          },
        ],
      }),
      "POST v1/clubs/mine/facilities/academy/upgrade": ok({
        facility: "academy",
        level: 2,
        cost: 2_500_000,
        cash: 6_500_000,
      }),
    });
    renderOnline("/online/finance");

    expect(await screen.findByText("online.finance.facility.academy")).toBeTruthy();
    expect(screen.getByText("online.finance.facility.academyEffect")).toBeTruthy();
    expect(screen.getByText(/online\.finance\.academyWages/).textContent).toMatch(/1,500/);
    const upgrades = await screen.findAllByRole("button", { name: "finances.upgradeFacility" });
    fireEvent.click(upgrades[3] as HTMLElement);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/finances\.facilityEffects\.academySlots/)).toBeTruthy();
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /finances\.facilityUpgradeConfirm/ }),
    );
    await waitFor(() =>
      expect(sent("POST", "v1/clubs/mine/facilities/academy/upgrade")).toHaveLength(1),
    );
  });
});

describe("the club's cash in the header", () => {
  // Given a season with money,
  // when any online page shows,
  // then the header shows the club's cash, and choosing it opens the finance page.
  it("opens the finance page", async () => {
    serve();
    renderOnline("/online/league");

    const cash = await screen.findByRole("button", { name: /online\.header\.cash/ });
    fireEvent.click(cash);

    await waitFor(() =>
      expect(screen.getByRole("status", { name: "location" }).textContent).toBe("/online/finance"),
    );
  });

  // Given a season without money,
  // when an online page shows,
  // then the header shows no cash.
  it("hides when the season plays without money", async () => {
    serve({ "GET v1/clubs/mine/finance": ok(finance({ economy: false })) });
    renderOnline("/online/league");

    await waitFor(() => expect(sent("GET", "v1/clubs/mine/finance").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /online\.header\.cash/ })).toBeNull();
  });
});

describe("AccountWatcher", () => {
  // Given the coach's account channel,
  // when it rings for the market, for a friendly, and with a kind this build does not know,
  // then the market ring reads the club, its money and market again and lights the market's dot,
  // the friendly ring reads their friendly, and the unknown one changes nothing.
  it("reads again by the kind of ring", async () => {
    serve();
    renderOnline("/online/league");
    await waitFor(() =>
      expect(realtime.watches.some((watch) => watch.channel === `account:${ACCOUNT}`)).toBe(true),
    );
    await waitFor(() => expect(sent("GET", "v1/clubs/mine/market")).toHaveLength(1));
    const account = realtime.watches.find((watch) => watch.channel === `account:${ACCOUNT}`);
    const before = {
      finance: sent("GET", "v1/clubs/mine/finance").length,
      friendly: sent("GET", "v1/friendlies/mine").length,
      club: sent("GET", "v1/clubs/mine").length,
    };

    account?.speak({
      kind: "notice",
      channel: `account:${ACCOUNT}`,
      data: { kind: "market", event: "outbid", auctionId: "a-1" },
    });
    await waitFor(() => expect(sent("GET", "v1/clubs/mine/market")).toHaveLength(2));
    expect(sent("GET", "v1/clubs/mine/finance")).toHaveLength(before.finance + 1);
    // The squad changes with a won or sold player: the club is read again with the market.
    await waitFor(() => expect(sent("GET", "v1/clubs/mine")).toHaveLength(before.club + 1));
    expect(sent("GET", "v1/friendlies/mine")).toHaveLength(before.friendly);
    expect(useOnlineStore.getState().marketUnseen).toBe(1);

    account?.speak({ kind: "notice", channel: `account:${ACCOUNT}`, data: { kind: "friendly" } });
    await waitFor(() =>
      expect(sent("GET", "v1/friendlies/mine")).toHaveLength(before.friendly + 1),
    );
    account?.speak({ kind: "notice", channel: `account:${ACCOUNT}`, data: { kind: "season" } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent("GET", "v1/clubs/mine/market")).toHaveLength(2);
    expect(useOnlineStore.getState().marketUnseen).toBe(1);
  });
});
