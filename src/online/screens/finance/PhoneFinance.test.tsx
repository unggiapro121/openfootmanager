import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_QUERY } from "../../../hooks/usePhoneLayout";
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
import type { FacilitiesView, FinanceView, LedgerPage } from "../../api";

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

const KEY = "online.finance.phone";

function finance(overrides: Partial<FinanceView> = {}): FinanceView {
  return {
    economy: true,
    cash: 3_000_000,
    held: 90_000,
    locked: false,
    season: [
      { kind: "tickets", amount: 2_872_987 },
      { kind: "wage", amount: -11_046_805 },
    ],
    weeklyWageBill: 226_821,
    arrearsDaysToForcedListing: 3,
    ...overrides,
  };
}

const FACILITIES: FacilitiesView = {
  facilities: [
    {
      facility: "training",
      level: 8,
      maxLevel: 10,
      cost: 2_500_000,
      effects: [
        { key: "finances.effect.gains", format: "multiplier", current: [1.8], next: [1.9] },
        { key: "finances.effect.injuries", format: "percentChange", current: [-10], next: [-10] },
      ],
    },
    { facility: "medical", level: 10, maxLevel: 10, cost: null, effects: [] },
    { facility: "scouting", level: 1, maxLevel: 10, cost: 9_000_000, effects: [] },
  ],
};

/** Two months of lines: a ticket and a wage in November, a wage in October. */
const LEDGER: LedgerPage = {
  items: [
    { id: 3, at: "x", gameDate: "2037-11-08", kind: "tickets", account: "cash", amount: 220_999 },
    { id: 2, at: "x", gameDate: "2037-11-08", kind: "wage", account: "cash", amount: -424_877 },
    { id: 1, at: "x", gameDate: "2037-10-26", kind: "wage", account: "cash", amount: -424_877 },
  ],
};

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
    "GET v1/clubs/mine/market": ok({ selling: [], holding: [], recent: [] }),
    "GET v1/clubs/mine/facilities": ok(FACILITIES),
    "GET v1/clubs/mine/ledger": ok(LEDGER),
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
  renderOnline("/online/finance");
  return screen.findByRole("region", { name: `${KEY}.balance` });
}

describe("the finance page on a phone", () => {
  // Given a club with cash, money held for bids and a losing season,
  // when its finance page opens on a phone,
  // then the balance card shows the cash, the money held, the season and the weekly wages, and
  // the overview splits the season and warns that wages outrun the income.
  it("shows the balance and the season", async () => {
    serve();
    const balance = await open();

    expect(within(balance).getByText("€3,000,000")).toBeInTheDocument();
    expect(
      within(balance).getByText(/online\.finance\.phone\.heldLine:€90,000/),
    ).toBeInTheDocument();
    expect(within(balance).getByText("€226,821")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: `${KEY}.tab.over` })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const season = screen.getByRole("region", { name: "online.finance.season" });
    expect(within(season).getByText(/^online\.finance\.kind\.tickets/)).toBeInTheDocument();
    expect(within(season).getByText("-€8,173,818")).toBeInTheDocument();
    expect(
      within(season).getByText(/online\.finance\.phone\.wageWarning:3\.8/),
    ).toBeInTheDocument();
  });

  // Given the facilities, one at its top level and one the club cannot afford,
  // when the coach upgrades training from its sheet,
  // then the sheet says the cost and the cash after it, the upgrade is sent once, and the page
  // says it is done; the others cannot be upgraded.
  it("upgrades a facility from its sheet", async () => {
    serve({
      "POST v1/clubs/mine/facilities/training/upgrade": ok({
        facility: "training",
        level: 9,
        cost: 2_500_000,
        cash: 500_000,
      }),
    });
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.fac` }));

    const rows = await screen.findAllByRole("button", { name: /^finances\.upgradeFacility/ });
    expect(rows[1]).toBeDisabled();
    expect(rows[2]).toBeDisabled();
    expect(screen.getByText(/online\.finance\.phone\.short/)).toBeInTheDocument();
    fireEvent.click(rows[0]);

    const sheet = screen.getByRole("dialog", { name: /online\.finance\.phone\.upTitle/ });
    expect(within(sheet).getByText("-€2,500,000")).toBeInTheDocument();
    expect(within(sheet).getByText("€500,000")).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: `${KEY}.upConfirm` }));

    await waitFor(() =>
      expect(sent("POST", "v1/clubs/mine/facilities/training/upgrade")).toHaveLength(1),
    );
    expect(await screen.findByText(/online\.finance\.upgraded/)).toBeInTheDocument();
  });

  // Given a facility whose upgrade moves one effect and leaves another as it is,
  // when the coach opens its upgrade sheet,
  // then the sheet lists every effect with its value now and after the upgrade, as the desktop's
  // dialog does, the one that moves set apart.
  it("says what an upgrade changes, effect by effect", async () => {
    serve();
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.fac` }));
    fireEvent.click(
      (await screen.findAllByRole("button", { name: /^finances\.upgradeFacility/ }))[0],
    );

    const sheet = screen.getByRole("dialog", { name: /online\.finance\.phone\.upTitle/ });
    const effects = within(sheet).getByRole("table", { name: "finances.facilityUpgradeEffect" });
    const gains = within(effects).getByRole("row", { name: /finances\.effect\.gains/ });
    expect(within(gains).getByText("×1.8")).toBeInTheDocument();
    expect(within(gains).getByText("×1.9")).toHaveClass("font-semibold");
    const injuries = within(effects).getByRole("row", { name: /finances\.effect\.injuries/ });
    expect(within(injuries).getAllByText("-10%")).toHaveLength(2);
  });

  // Given an upgrade the server refuses,
  // when the coach confirms it,
  // then the sheet says why and stays open.
  it("says why an upgrade was refused", async () => {
    serve({
      "POST v1/clubs/mine/facilities/training/upgrade": fail(409, "be.error.economy.clubLocked"),
    });
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.fac` }));
    fireEvent.click(
      (await screen.findAllByRole("button", { name: /^finances\.upgradeFacility/ }))[0],
    );
    const sheet = screen.getByRole("dialog", { name: /online\.finance\.phone\.upTitle/ });
    fireEvent.click(within(sheet).getByRole("button", { name: `${KEY}.upConfirm` }));

    expect(
      await within(sheet).findByText(/resolved:be\.error\.economy\.clubLocked/),
    ).toBeInTheDocument();
  });

  // Given the ledger,
  // when the coach opens it, then keeps only the money in,
  // then the lines stand under their months with each month's sum, and the filter keeps the
  // ticket alone.
  it("groups the ledger by month and filters it", async () => {
    serve();
    await open();
    fireEvent.click(screen.getByRole("tab", { name: `${KEY}.tab.led` }));

    const list = await screen.findByRole("list", { name: "online.finance.ledger" });
    expect(within(list).getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(within(list).getByText("-€203,878")).toBeInTheDocument();
    expect(within(list).getAllByText(/^online\.finance\.kind\.wage/)).toHaveLength(2);

    fireEvent.click(screen.getByRole("radio", { name: `${KEY}.filter.in` }));
    expect(within(list).queryByText(/^online\.finance\.kind\.wage/)).toBeNull();
    expect(within(list).getByText(/^online\.finance\.kind\.tickets/)).toBeInTheDocument();
  });
});
